"""
WPlus CDP bridge — lets engine.js reach the local file server.

WhatsApp Desktop's Content-Security-Policy blocks fetch/img/media requests from the
page to 127.0.0.1, so the page cannot talk to the file server directly. Instead this
module keeps one DevTools (CDP) connection open, exposes window.__wplusBridge() to the
page with Runtime.addBinding, forwards each call to the file server (with the session
token and the WhatsApp origin, so all of its checks still apply) and answers through
window.__wplusBridgeReply(id, result).

Only the Python standard library is used (a minimal RFC 6455 client).
"""
import base64, hashlib, http.client, itertools, json, os, socket, struct, threading, time
from urllib.parse import urlsplit

BINDING = "__wplusBridge"
WA_ORIGIN = "https://web.whatsapp.com"
MAX_MEDIA_BYTES = 256 * 1024 * 1024
MAX_MESSAGE_BYTES = 512 * 1024 * 1024  # Base64 media replies are ~4/3 of MAX_MEDIA_BYTES
_WS_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WebSocket:
    """Minimal blocking WebSocket client (text frames, fragmentation, ping/pong, close)."""

    def __init__(self, url, timeout=10):
        u = urlsplit(url)
        if u.scheme != "ws" or not u.hostname:
            raise ValueError(f"unsupported WebSocket URL: {url}")
        port = u.port or 80
        self._send_lock = threading.Lock()
        self.sock = socket.create_connection((u.hostname, port), timeout=timeout)
        try:
            key = base64.b64encode(os.urandom(16)).decode()
            path = (u.path or "/") + ("?" + u.query if u.query else "")
            # No Origin header: Chromium only checks --remote-allow-origins when one is sent
            req = (f"GET {path} HTTP/1.1\r\nHost: {u.hostname}:{port}\r\nUpgrade: websocket\r\n"
                   f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
            self.sock.sendall(req.encode())
            resp = b""
            while b"\r\n\r\n" not in resp:
                chunk = self.sock.recv(4096)
                if not chunk: raise ConnectionError("handshake failed")
                resp += chunk
                if len(resp) > 65536: raise ConnectionError("handshake response too large")
            head, rest = resp.split(b"\r\n\r\n", 1)
            status, *lines = head.split(b"\r\n")
            if b" 101 " not in status + b" ":
                raise ConnectionError(status.decode(errors="replace"))
            headers = {}
            for line in lines:
                k, _, v = line.partition(b":")
                headers[k.strip().lower()] = v.strip()
            accept = base64.b64encode(hashlib.sha1(key.encode() + _WS_GUID).digest())
            if headers.get(b"sec-websocket-accept") != accept:
                raise ConnectionError("bad Sec-WebSocket-Accept")
        except BaseException:
            self.sock.close()
            raise
        self._buf = bytearray(rest)
        self.sock.settimeout(None)

    def settimeout(self, timeout):
        """Timeout for later recv() calls (None blocks); socket.timeout is raised on expiry."""
        self.sock.settimeout(timeout)

    def _read(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(max(65536, min(n - len(self._buf), 16 * 1024 * 1024)))
            if not chunk: raise ConnectionError("connection closed")
            self._buf += chunk
        data = bytes(self._buf[:n])
        del self._buf[:n]
        return data

    def _send_frame(self, opcode, payload):
        header = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126: header.append(0x80 | n)
        elif n < 65536: header += bytes([0x80 | 126]) + struct.pack("!H", n)
        else: header += bytes([0x80 | 127]) + struct.pack("!Q", n)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload)) if n < 4096 else _mask(payload, mask)
        with self._send_lock:
            self.sock.sendall(bytes(header) + masked)

    def send(self, text):
        self._send_frame(0x1, text.encode("utf-8"))

    def recv(self):
        """Return the next complete text message (str), or None when the socket closes."""
        parts, size = [], 0
        while True:
            b1, b2 = self._read(2)
            opcode, n = b1 & 0x0F, b2 & 0x7F
            if n == 126: n = struct.unpack("!H", self._read(2))[0]
            elif n == 127: n = struct.unpack("!Q", self._read(8))[0]
            if size + n > MAX_MESSAGE_BYTES:
                raise ConnectionError("message too large")
            if b2 & 0x80: mask = self._read(4)
            payload = self._read(n)
            if b2 & 0x80: payload = _mask(payload, mask)
            if opcode == 0x8:
                try: self._send_frame(0x8, payload[:2])  # Echo the close code
                except OSError: pass
                return None
            if opcode == 0x9: self._send_frame(0xA, payload); continue
            if opcode == 0xA: continue
            parts.append(payload)
            size += n
            if b1 & 0x80:
                return b"".join(parts).decode("utf-8", errors="replace")

    def close(self):
        try: self._send_frame(0x8, b"")
        except OSError: pass
        try: self.sock.close()
        except OSError: pass


def evaluate(ws_url, expression, timeout=60):
    """Run one Runtime.evaluate on a fresh DevTools connection and return the result
    value (returnByValue), or None on any error, exception, timeout or undefined result.
    Events and replies to other ids that arrive first are skipped."""
    deadline = time.monotonic() + timeout
    try:
        ws = WebSocket(ws_url, timeout=min(10, timeout))
    except (OSError, ValueError, TypeError):
        return None
    try:
        ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                            "params": {"expression": expression, "returnByValue": True}}))
        while True:
            left = deadline - time.monotonic()
            if left <= 0: return None
            ws.settimeout(left)
            raw = ws.recv()
            if raw is None: return None
            try: msg = json.loads(raw)
            except ValueError: continue
            if not isinstance(msg, dict) or msg.get("id") != 1: continue
            res = msg.get("result") or {}
            if "exceptionDetails" in res: return None
            return (res.get("result") or {}).get("value")
    except (OSError, ValueError):
        return None
    finally:
        ws.close()


def _mask(data, mask):
    # XOR via big integers: fast enough for multi-megabyte media payloads
    n = len(data)
    key = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "little") ^ int.from_bytes(key, "little")).to_bytes(n, "little")


class Bridge(threading.Thread):
    """One CDP session to the WhatsApp page that serves window.__wplusBridge calls."""

    def __init__(self, ws_url, server_port, token, extra_routes=None, log=None):
        super().__init__(daemon=True)
        self.ws_url, self.port, self.token = ws_url, server_port, token
        self.extra_routes = extra_routes or {}
        self.log = log or (lambda m: None)
        self.ws = None
        self._ids = itertools.count(1001)  # next() is atomic; _handle runs on many threads
        self._ready = threading.Event()

    def start_and_wait(self, timeout=10):
        self.start()
        return self._ready.wait(timeout)

    def alive(self):
        return self.is_alive() and self.ws is not None

    def stop(self):
        ws, self.ws = self.ws, None
        if ws: ws.close()

    def _cmd(self, method, params=None):
        ws = self.ws
        if ws is None: raise ConnectionError("bridge closed")
        ws.send(json.dumps({"id": next(self._ids), "method": method, "params": params or {}}))

    def run(self):
        ws = None
        try:
            ws = self.ws = WebSocket(self.ws_url)
            self._cmd("Runtime.enable")
            self._cmd("Runtime.addBinding", {"name": BINDING})
            self._ready.set()
            while self.ws is ws:
                raw = ws.recv()
                if raw is None: break
                try: msg = json.loads(raw)
                except ValueError: continue
                if not isinstance(msg, dict) or msg.get("method") != "Runtime.bindingCalled": continue
                p = msg.get("params")
                if isinstance(p, dict) and p.get("name") == BINDING:
                    threading.Thread(target=self._handle, args=(p.get("payload", ""), p.get("executionContextId")),
                                     daemon=True).start()
        except Exception as e:
            if self.ws is ws: self.log(f"Bridge closed: {e}")
        finally:
            if self.ws is ws: self.ws = None
            if ws: ws.close()
            self._ready.set()

    def _handle(self, payload, context_id):
        try:
            req = json.loads(payload)
            rid = int(req["id"])
        except Exception:
            return
        try:
            route = self.extra_routes.get(req.get("path"))
            result = {"status": 200, "json": route()} if route else self._forward(req)
        except Exception as e:
            result = {"status": 500, "json": {"ok": False, "error": str(e)[:200]}}
        expr = f"window.__wplusBridgeReply&&window.__wplusBridgeReply({rid},{json.dumps(result)})"
        params = {"expression": expr}
        if context_id: params["contextId"] = context_id
        try: self._cmd("Runtime.evaluate", params)
        except Exception: pass

    def _forward(self, req):
        method = "POST" if req.get("method") == "POST" else "GET"
        path = str(req.get("path") or "/")
        if not path.startswith("/") or "\r" in path or "\n" in path:
            return {"status": 400, "json": None}
        headers = {"Origin": WA_ORIGIN, "X-WPlus-Token": self.token}
        body = None
        if method == "POST":
            body = json.dumps(req.get("body")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        try:
            conn.request(method, path, body=body, headers=headers)
            resp = conn.getresponse()
            ctype = resp.getheader("Content-Type", "") or ""
            data = resp.read(MAX_MEDIA_BYTES + 1)
        finally:
            conn.close()
        if path.startswith("/media/"):
            if resp.status != 200 or len(data) > MAX_MEDIA_BYTES:
                return {"status": resp.status}
            return {"status": 200, "mime": ctype.split(";")[0], "b64": base64.b64encode(data).decode("ascii")}
        try: parsed = json.loads(data.decode("utf-8")) if data else None
        except ValueError: parsed = None
        return {"status": resp.status, "json": parsed}
