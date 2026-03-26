#!/usr/bin/env python3
# WPlus File Server — serves saved media and accepts file uploads from injected JS
# Runs on localhost:18733

import json, os, base64, time, threading
from http.server import HTTPServer, BaseHTTPRequestHandler

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
MEDIA_DIRS = {
    "image": os.path.join(DATA_DIR, "Images"),
    "sticker": os.path.join(DATA_DIR, "Images"),
    "video": os.path.join(DATA_DIR, "Videos"),
    "ptt": os.path.join(DATA_DIR, "Sounds"),
    "audio": os.path.join(DATA_DIR, "Sounds"),
    "document": os.path.join(DATA_DIR, "Docs"),
}
for d in set(MEDIA_DIRS.values()):
    os.makedirs(d, exist_ok=True)

NEW_MSGS = os.path.join(DATA_DIR, "new_messages.json")
DEL_MSGS = os.path.join(DATA_DIR, "deleted_messages.json")
SETTINGS = os.path.join(DATA_DIR, "settings.json")

def load_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return default if default is not None else []

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass  # Silent

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        # Serve media files: /media/Images/filename.jpg
        if self.path.startswith("/media/"):
            filepath = os.path.join(DATA_DIR, self.path[7:].replace("/", os.sep))
            if os.path.exists(filepath):
                self.send_response(200)
                self._cors()
                ext = filepath.rsplit(".", 1)[-1].lower()
                mime = {"jpg":"image/jpeg","jpeg":"image/jpeg","png":"image/png","webp":"image/webp",
                        "mp4":"video/mp4","ogg":"audio/ogg","mp3":"audio/mpeg","pdf":"application/pdf"}.get(ext, "application/octet-stream")
                self.send_header("Content-Type", mime)
                self.end_headers()
                with open(filepath, "rb") as f:
                    self.wfile.write(f.read())
                return

        # Get deleted messages
        if self.path == "/deleted":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            data = load_json(DEL_MSGS, [])
            self.wfile.write(json.dumps(data).encode())
            return

        # Get settings
        if self.path == "/settings":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            data = load_json(SETTINGS, {})
            self.wfile.write(json.dumps(data).encode())
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body)
        except:
            self.send_response(400)
            self.end_headers()
            return

        # Save a new message (backup)
        if self.path == "/msg/new":
            msgs = load_json(NEW_MSGS, [])
            # Deduplicate
            if not any(m.get("id") == data.get("id") for m in msgs):
                # Save media to file if present
                media_path = self._save_media(data)
                if media_path:
                    data["mediaFile"] = media_path
                    data.pop("media", None)  # Remove base64 from JSON
                    data.pop("body", None) if data.get("mediaFile") else None
                msgs.append(data)
                # Clean old (>24h)
                cutoff = time.time() * 1000 - 86400000
                msgs = [m for m in msgs if m.get("time", 0) > cutoff]
                save_json(NEW_MSGS, msgs)
            self._ok({"saved": True})
            return

        # Message deleted — move from new to deleted
        if self.path == "/msg/deleted":
            msg_id = data.get("id")
            # Find in new messages
            new_msgs = load_json(NEW_MSGS, [])
            found = None
            remaining = []
            for m in new_msgs:
                if m.get("id") == msg_id:
                    found = m
                else:
                    remaining.append(m)

            # Merge with incoming data (has the backed-up content)
            if found:
                for k, v in data.items():
                    if v and k not in found:
                        found[k] = v
                entry = found
            else:
                entry = data

            # Save media if not already saved
            if not entry.get("mediaFile"):
                media_path = self._save_media(entry)
                if media_path:
                    entry["mediaFile"] = media_path
                    entry.pop("media", None)

            # Remove raw base64 body for media messages
            if entry.get("mediaFile") and entry.get("body") and len(entry.get("body","")) > 200:
                entry["body"] = ""

            # Add to deleted messages
            del_msgs = load_json(DEL_MSGS, [])
            if not any(m.get("id") == msg_id for m in del_msgs):
                del_msgs.append(entry)
                save_json(DEL_MSGS, del_msgs)

            # Remove from new messages
            save_json(NEW_MSGS, remaining)

            self._ok({"deleted": True, "hasMedia": bool(entry.get("mediaFile"))})
            return

        # Save settings
        if self.path == "/settings":
            save_json(SETTINGS, data)
            self._ok({"saved": True})
            return

        self.send_response(404)
        self.end_headers()

    def _save_media(self, data):
        """Extract base64 media and save to file. Returns relative path or None."""
        media_b64 = data.get("media") or None
        body_b64 = data.get("body") or ""

        # Check if body is base64 media
        if not media_b64 and len(body_b64) > 200:
            if body_b64.startswith("/9j/") or body_b64.startswith("AAAA") or body_b64.startswith("UklG"):
                media_b64 = body_b64

        if not media_b64:
            return None

        # Determine type and extension
        msg_type = data.get("type", "image")
        ext_map = {"image": "jpg", "video": "mp4", "ptt": "ogg", "audio": "mp3", "sticker": "webp", "document": "bin"}
        ext = ext_map.get(msg_type, "bin")

        # Handle data: URLs
        raw_b64 = media_b64
        if raw_b64.startswith("data:"):
            parts = raw_b64.split(",", 1)
            if len(parts) == 2:
                raw_b64 = parts[1]
                # Extract extension from mime
                mime = parts[0].split(";")[0].split(":")[1] if ":" in parts[0] else ""
                if "png" in mime: ext = "png"
                elif "webp" in mime: ext = "webp"
                elif "mp4" in mime: ext = "mp4"
                elif "ogg" in mime: ext = "ogg"

        try:
            raw_bytes = base64.b64decode(raw_b64)
        except:
            return None

        # Generate filename
        sender = (data.get("sender", "unknown") or "unknown").split("@")[0]
        ts = time.strftime("%Y%m%d_%H%M%S")
        filename = f"WPlus_{sender}_{ts}.{ext}"

        # Save to folder
        folder = MEDIA_DIRS.get(msg_type, MEDIA_DIRS["document"])
        filepath = os.path.join(folder, filename)
        with open(filepath, "wb") as f:
            f.write(raw_bytes)

        # Return relative path for serving
        rel = os.path.relpath(filepath, DATA_DIR).replace(os.sep, "/")
        return rel

    def _ok(self, data):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

def start_server(port=18733):
    server = HTTPServer(("127.0.0.1", port), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server
