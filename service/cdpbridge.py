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
import base64, http.client, json, os, socket, struct, threading
from urllib.parse import urlsplit

BINDING = "__wplusBridge"
WA_ORIGIN = "https://web.whatsapp.com"
MAX_MEDIA_BYTES = 256 * 1024 * 1024


class WebSocket:
    """Minimal blocking WebSocket client (text frames, fragmentation, ping/pong, close)."""

    def __init__(self, url, timeout=10):
        u = urlsplit(url)
        self.sock = socket.create_connection((u.hostname, u.port or 80), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        path = u.path + ("?" + u.query if u.query else "")
        # No Origin header: Chromium only checks --remote-allow-origins when one is sent
        req = (f"GET {path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n"
               f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk: raise ConnectionError("handshake failed")
            resp += chunk
        head, self._buf = resp.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError(head.split(b"\r\n", 1)[0].decode(errors="replace"))
        self.sock.settimeout(None)
        self._send_lock = threading.Lock()

    def _read(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self._buf)))
            if not chunk: raise ConnectionError("connection closed")
            self._buf += chunk
        data, self._buf = self._buf[:n], self._buf[n:]
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
        parts = []
        while True:
            b1, b2 = self._read(2)
            opcode, n = b1 & 0x0F, b2 & 0x7F
            if n == 126: n = struct.unpack("!H", self._read(2))[0]
            elif n == 127: n = struct.unpack("!Q", self._read(8))[0]
            if b2 & 0x80: mask = self._read(4)
            payload = self._read(n)
            if b2 & 0x80: payload = _mask(payload, mask)
            if opcode == 0x8: return None
            if opcode == 0x9: self._send_frame(0xA, payload); continue
            if opcode == 0xA: continue
            parts.append(payload)
            if b1 & 0x80:
                return b"".join(parts).decode("utf-8", errors="replace")

    def close(self):
        try: self._send_frame(0x8, b"")
        except OSError: pass
        try: self.sock.close()
        except OSError: pass


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
        self._id = 1000
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
        self._id += 1
        self.ws.send(json.dumps({"id": self._id, "method": method, "params": params or {}}))

    def run(self):
        try:
            self.ws = WebSocket(self.ws_url)
            self._cmd("Runtime.enable")
            self._cmd("Runtime.addBinding", {"name": BINDING})
            self._ready.set()
            while self.ws:
                raw = self.ws.recv()
                if raw is None: break
                msg = json.loads(raw)
                if msg.get("method") == "Runtime.bindingCalled" and msg["params"].get("name") == BINDING:
                    p = msg["params"]
                    threading.Thread(target=self._handle, args=(p.get("payload", ""), p.get("executionContextId")),
                                     daemon=True).start()
        except Exception as e:
            self.log(f"Bridge closed: {e}")
        finally:
            self._ready.set()
            self.ws = None

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
