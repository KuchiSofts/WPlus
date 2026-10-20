#!/usr/bin/env python3
# WPlus File Server — stores backed-up messages/media and serves media to the injected JS
#
# Security model:
#   - Listens on 127.0.0.1 only and rejects requests whose Host header is not local
#     (protects against DNS rebinding).
#   - Browser requests must come from a WhatsApp origin (https://*.whatsapp.com).
#     Any other Origin is rejected, including no-preflight "text/plain" POSTs.
#   - Every request (except CORS preflight) must carry the per-session token that
#     wplus.py injects together with engine.js (X-WPlus-Token header or ?t= query).
#   - File access is confined to the media folders inside the data directory.

import json, os, re, base64, time, threading, hashlib, hmac, secrets, mimetypes, socket
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, unquote, parse_qs

PORT = 18733
MAX_BODY = 256 * 1024 * 1024          # 256 MB — large enough for base64-encoded videos
RETENTION_MS = 60 * 60 * 60 * 1000    # 60h — WhatsApp "delete for everyone" window is ~2.5 days
TOKEN = None                          # Set by start_server()

_lock = threading.RLock()             # Guards all reads/writes of the JSON files

DATA_DIR = MEDIA_DIRS = NEW_MSGS = DEL_MSGS = None

def configure(data_dir, create=True):
    """Point the server at a data directory and (optionally) create the media folders."""
    global DATA_DIR, MEDIA_DIRS, NEW_MSGS, DEL_MSGS
    DATA_DIR = os.path.realpath(data_dir)
    MEDIA_DIRS = {
        "image": os.path.join(DATA_DIR, "Images"),
        "sticker": os.path.join(DATA_DIR, "Images"),
        "video": os.path.join(DATA_DIR, "Videos"),
        "ptt": os.path.join(DATA_DIR, "Sounds"),
        "audio": os.path.join(DATA_DIR, "Sounds"),
        "document": os.path.join(DATA_DIR, "Docs"),
    }
    if create:
        for d in set(MEDIA_DIRS.values()):
            os.makedirs(d, exist_ok=True)
    NEW_MSGS = os.path.join(DATA_DIR, "new_messages.json")
    DEL_MSGS = os.path.join(DATA_DIR, "deleted_messages.json")

# Default: <project root>/data when run from source
configure(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"), create=False)

def load_json(path, default=None):
    """Read a JSON list file. A missing file gives the default. A corrupt one is moved
    aside (<name>.<time>.bad) so the next save cannot destroy it. Other read errors
    (file locked, no permission) are raised: callers write the result back, and
    treating them as "empty" would wipe the saved messages."""
    if default is None:
        default = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return default
    except ValueError:
        try: os.replace(path, f"{path}.{time.strftime('%Y%m%d_%H%M%S')}.bad")
        except OSError: pass
        return default
    if isinstance(default, list):
        if not isinstance(data, list):
            return default
        return [m for m in data if isinstance(m, dict)]
    return data

def save_json(path, data):
    tmp = f"{path}.{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

# ── Path safety ───────────────────────────────────────────────
def _media_roots():
    return sorted(set(os.path.realpath(d) for d in MEDIA_DIRS.values()))

def safe_media_path(rel):
    """Resolve a data-relative media path (e.g. 'Images/x.jpg').
    Returns the absolute path only if it lies inside one of the media folders."""
    if not rel or not isinstance(rel, str) or "\0" in rel:
        return None
    rel = rel.replace("\\", "/")
    if rel.startswith("/") or re.match(r"^[A-Za-z]:", rel):
        return None
    full = os.path.realpath(os.path.join(DATA_DIR, *rel.split("/")))
    for root in _media_roots():
        try:
            if full != root and os.path.commonpath([full, root]) == root:
                return full
        except ValueError:  # different drives
            continue
    return None

def _remove_media(rel):
    path = safe_media_path(rel)
    if path and os.path.isfile(path):
        try:
            os.remove(path)
            return True
        except OSError:
            pass
    return False

# ── Media extraction ──────────────────────────────────────────
TYPE_EXT = {"image": "jpg", "video": "mp4", "ptt": "ogg", "audio": "mp3", "sticker": "webp", "document": "bin"}
MIME_EXT = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/webm": "webm", "video/3gpp": "3gp", "video/quicktime": "mov",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
    "audio/amr": "amr", "audio/wav": "wav", "audio/webm": "weba",
    "application/pdf": "pdf", "application/zip": "zip", "text/plain": "txt",
}
SERVE_MIME = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif",
    "mp4": "video/mp4", "webm": "video/webm", "3gp": "video/3gpp", "mov": "video/quicktime",
    "ogg": "audio/ogg", "mp3": "audio/mpeg", "m4a": "audio/mp4", "aac": "audio/aac",
    "amr": "audio/amr", "wav": "audio/wav", "weba": "audio/webm", "pdf": "application/pdf",
}
B64_PREFIXES = ("/9j/", "AAAA", "UklG", "iVBOR", "JVBER", "T2dn", "GkXE", "data:")
B64_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r")

def _ext_for(mime, msg_type):
    mime = (mime or "").split(";")[0].strip().lower()
    ext = MIME_EXT.get(mime)
    if not ext and mime:
        guess = mimetypes.guess_extension(mime) or ""
        ext = guess.lstrip(".")
    if not ext or not re.fullmatch(r"[a-z0-9]{1,5}", ext):
        ext = TYPE_EXT.get(msg_type, "bin")
    return ext

def _safe_sender(sender):
    s = str(sender or "unknown").split("@")[0]
    s = re.sub(r"[^0-9A-Za-z_-]", "", s)[:32]
    return s or "unknown"

def _save_media(data):
    """Extract base64 media and save to file. Returns data-relative path or None."""
    media_b64 = data.get("media") or None
    body_b64 = data.get("body") or ""
    msg_type = data.get("type", "")
    if not isinstance(media_b64, str):
        media_b64 = None
    if not isinstance(body_b64, str):
        body_b64 = ""

    # Body might be base64 media (WhatsApp stores thumbnails there)
    if not media_b64 and len(body_b64) > 100 and msg_type in TYPE_EXT:
        if body_b64.startswith(B64_PREFIXES) or (len(body_b64) > 500 and all(c in B64_CHARS for c in body_b64[:200])):
            media_b64 = body_b64

    if not media_b64:
        return None

    mime = data.get("mime") if isinstance(data.get("mime"), str) else ""
    raw_b64 = media_b64
    if raw_b64.startswith("data:"):
        head, _, raw_b64 = raw_b64.partition(",")
        mime = head[5:].split(";")[0] or mime

    try:
        raw_bytes = base64.b64decode(raw_b64)
    except (ValueError, TypeError):
        return None
    if not raw_bytes:
        return None

    ext = _ext_for(mime, msg_type)
    sender = _safe_sender(data.get("sender"))
    ts = time.strftime("%Y%m%d_%H%M%S")
    tag = hashlib.sha1(str(data.get("id") or secrets.token_hex(8)).encode("utf-8")).hexdigest()[:10]
    folder = MEDIA_DIRS.get(msg_type, MEDIA_DIRS["document"])

    filename = f"WPlus_{sender}_{ts}_{tag}.{ext}"
    n = 1
    while os.path.exists(os.path.join(folder, filename)):
        n += 1
        filename = f"WPlus_{sender}_{ts}_{tag}_{n}.{ext}"

    filepath = os.path.join(folder, filename)
    with open(filepath, "wb") as f:
        f.write(raw_bytes)
    return os.path.relpath(filepath, DATA_DIR).replace(os.sep, "/")

def _store_media(entry):
    """Move base64 media out of a message entry into a file. Never keeps base64 in JSON."""
    if not entry.get("mediaFile"):
        path = _save_media(entry)
        if path:
            entry["mediaFile"] = path
    entry.pop("media", None)
    body = entry.get("body")
    if entry.get("mediaFile") and isinstance(body, str) and len(body) > 200:
        entry["body"] = ""
    return entry

def _msg_time(m):
    try: return float(m.get("time") or 0)
    except (TypeError, ValueError): return 0.0

def _expire_new(msgs):
    """Drop backed-up messages older than RETENTION_MS and delete their media files."""
    cutoff = time.time() * 1000 - RETENTION_MS
    expired = [m for m in msgs if _msg_time(m) < cutoff]
    remaining = [m for m in msgs if _msg_time(m) >= cutoff]
    keep = {m.get("mediaFile") for m in load_json(DEL_MSGS, []) if isinstance(m, dict)}
    files = 0
    for exp in expired:
        mf = exp.get("mediaFile")
        if mf and mf not in keep and _remove_media(mf):
            files += 1
    return remaining, len(expired), files

# ── Public helpers (used by wplus.py) ─────────────────────────
def merge_deleted(entries):
    """Merge the browser's copy of deleted messages into deleted_messages.json.
    The file is the source of truth: existing entries keep their mediaFile, and
    base64 media is written to disk instead of being stored in JSON.
    Returns the number of entries added or updated."""
    if not isinstance(entries, list):
        return 0
    with _lock:
        del_msgs = load_json(DEL_MSGS, [])
        by_id = {m.get("id"): m for m in del_msgs if isinstance(m, dict) and m.get("id")}
        changed = 0
        for e in entries:
            if not isinstance(e, dict) or not e.get("id"):
                continue
            cur = by_id.get(e["id"])
            if cur is None:
                cur = {k: v for k, v in e.items() if not str(k).startswith("__")}
                _store_media(cur)
                del_msgs.append(cur)
                by_id[cur["id"]] = cur
                changed += 1
                continue
            updated = False
            if not cur.get("mediaFile") and e.get("media"):
                tmp = dict(cur, media=e.get("media"), mime=e.get("mime") or cur.get("mime"))
                path = _save_media(tmp)
                if path:
                    cur["mediaFile"] = path
                    updated = True
            for k, v in e.items():
                if k in ("media", "body") or str(k).startswith("__"):
                    continue
                if v and not cur.get(k):
                    cur[k] = v
                    updated = True
            if updated:
                _store_media(cur)
                changed += 1
        if changed:
            save_json(DEL_MSGS, del_msgs)
        return changed

def load_deleted():
    with _lock:
        return load_json(DEL_MSGS, [])

# ── Request checks ────────────────────────────────────────────
def is_allowed_origin(origin):
    try:
        u = urlsplit(origin)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and (host == "whatsapp.com" or host.endswith(".whatsapp.com"))

class Handler(BaseHTTPRequestHandler):
    timeout = 60  # A client that stops sending must not hold a worker thread forever

    def log_message(self, *args): pass  # Silent

    def _host_ok(self):
        port = self.server.server_address[1]
        host = (self.headers.get("Host") or "").lower()
        return host in (f"127.0.0.1:{port}", f"localhost:{port}")

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        return origin is None or is_allowed_origin(origin)

    def _token_ok(self):
        if not TOKEN:
            return False
        token = self.headers.get("X-WPlus-Token")
        if not token:
            token = (parse_qs(urlsplit(self.path).query).get("t") or [""])[0]
        return hmac.compare_digest(str(token), TOKEN)

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-WPlus-Token")
            if self.headers.get("Access-Control-Request-Private-Network"):
                self.send_header("Access-Control-Allow-Private-Network", "true")

    def _deny(self, code=403):
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _guard(self):
        """Common checks for GET/POST. Returns True if the request may proceed."""
        if not self._host_ok() or not self._origin_ok() or not self._token_ok():
            self._deny(403)
            return False
        return True

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        if not self._host_ok() or not origin or not is_allowed_origin(origin):
            self._deny(403)
            return
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self._guard():
            return
        path = urlsplit(self.path).path
        # Serve media files: /media/Images/filename.jpg
        if path.startswith("/media/"):
            filepath = safe_media_path(unquote(path[7:]))
            if filepath and os.path.isfile(filepath):
                ext = filepath.rsplit(".", 1)[-1].lower()
                try:
                    size = os.path.getsize(filepath)
                    with open(filepath, "rb") as f:
                        self.send_response(200)
                        self._cors()
                        self.send_header("Content-Type", SERVE_MIME.get(ext, "application/octet-stream"))
                        self.send_header("Content-Length", str(size))
                        self.send_header("X-Content-Type-Options", "nosniff")
                        self.end_headers()
                        while True:
                            chunk = f.read(1024 * 1024)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                except (OSError, ConnectionError):
                    pass
                return
        self._deny(404)

    def do_POST(self):
        if not self._guard():
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self._deny(413)
            return
        body = self.rfile.read(length)
        try:
            data = json.loads(body or b"{}")
        except ValueError:
            data = None
        if not isinstance(data, dict):
            self._deny(400)
            return

        try:
            self._post(urlsplit(self.path).path, data)
        except OSError:
            try: self._deny(500)
            except OSError: pass

    def _post(self, path, data):
        # Save a new message (backup)
        if path == "/msg/new":
            if not data.get("id"):
                self._deny(400)
                return
            with _lock:
                msgs = load_json(NEW_MSGS, [])
                if not any(m.get("id") == data.get("id") for m in msgs):
                    entry = {k: v for k, v in data.items() if not str(k).startswith("__")}
                    _store_media(entry)
                    if entry.get("mediaFile"):
                        entry.pop("body", None)  # base64 thumbnail — the file is enough
                    msgs.append(entry)
                    msgs, _, _ = _expire_new(msgs)
                    save_json(NEW_MSGS, msgs)
            self._ok({"saved": True})
            return

        # Message deleted — move from new to deleted
        if path == "/msg/deleted":
            msg_id = data.get("id")
            if not msg_id:
                self._deny(400)
                return
            with _lock:
                new_msgs = load_json(NEW_MSGS, [])
                found = None
                remaining = []
                for m in new_msgs:
                    if found is None and m.get("id") == msg_id:
                        found = m
                    else:
                        remaining.append(m)

                del_msgs = load_json(DEL_MSGS, [])
                existing = next((m for m in del_msgs if isinstance(m, dict) and m.get("id") == msg_id), None)
                entry = existing if existing is not None else (found or {})
                if existing is not None and found:
                    for k, v in found.items():
                        if v and not entry.get(k):
                            entry[k] = v

                # Merge with incoming data (has the backed-up content)
                for k, v in data.items():
                    if str(k).startswith("__"):
                        continue
                    if v and not entry.get(k):
                        entry[k] = v

                _store_media(entry)
                if existing is None:
                    del_msgs.append(entry)
                save_json(DEL_MSGS, del_msgs)
                if found is not None:
                    save_json(NEW_MSGS, remaining)

            self._ok({"deleted": True, "hasMedia": bool(entry.get("mediaFile")),
                      "mediaFile": entry.get("mediaFile") or ""})
            return

        # Clear all saved deleted messages (UI "Clear all")
        if path == "/deleted/clear":
            with _lock:
                count = len(load_json(DEL_MSGS, []))
                save_json(DEL_MSGS, [])
            self._ok({"cleared": count})
            return

        # Migrate — re-process old deleted messages, save their media to files
        if path == "/migrate":
            with _lock:
                del_msgs = load_json(DEL_MSGS, [])
                migrated = 0
                dirty = False
                for msg in del_msgs:
                    if not isinstance(msg, dict):
                        continue
                    before = (msg.get("mediaFile"), "media" in msg, msg.get("body"))
                    _store_media(msg)
                    if msg.get("mediaFile") and not before[0]:
                        migrated += 1
                    if before != (msg.get("mediaFile"), "media" in msg, msg.get("body")):
                        dirty = True
                if dirty:
                    save_json(DEL_MSGS, del_msgs)
            self._ok({"migrated": migrated, "total": len(del_msgs)})
            return

        # Cleanup — remove expired new messages + their media
        if path == "/cleanup":
            with _lock:
                msgs = load_json(NEW_MSGS, [])
                remaining, removed, files = _expire_new(msgs)
                save_json(NEW_MSGS, remaining)
            self._ok({"removed": removed, "files": files, "remaining": len(remaining)})
            return

        self._deny(404)

    def _ok(self, data):
        payload = json.dumps(data).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

class Server(ThreadingHTTPServer):
    daemon_threads = True
    # SO_REUSEADDR on Windows lets a second process bind the same port and steal
    # requests, so bind exclusively instead.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

def start_server(port=PORT, data_dir=None, token=None):
    """Start the server in a background thread. Returns the HTTPServer
    (server.server_address[1] is the bound port; pass port=0 for any free port).
    Raises OSError if the port is already in use."""
    global TOKEN
    configure(data_dir or DATA_DIR)
    TOKEN = token or secrets.token_urlsafe(32)
    server = Server(("127.0.0.1", port), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server
