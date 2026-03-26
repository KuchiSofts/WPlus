#!/usr/bin/env python3
"""
WPlus v2.0 — Self-contained WhatsApp Desktop Plugin
by KuchiSofts — github.com/KuchiSofts

Single exe that contains everything:
- System tray service
- CDP injector
- File server for media
- engine.js + ui.js (embedded)

On first run, creates data/ folder structure.
"""
import sys, os, json, http.client, time, subprocess, threading, base64, tempfile, ssl

CURRENT_VERSION = "2.0.0"
GITHUB_REPO = "KuchiSofts/WPlus"

# ── Path Setup ───────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    # Running as PyInstaller exe
    EXE_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = sys._MEIPASS  # PyInstaller temp extraction dir
else:
    # Running as script — project root is parent of service/
    EXE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    BUNDLE_DIR = EXE_DIR

DATA_DIR = os.path.join(EXE_DIR, "data")
ASSETS_DIR = os.path.join(EXE_DIR, "assets")

# ── First Run Setup ──────────────────────────────────────────
def ensure_debug_port():
    """Enable WebView2 debug port via registry (needed for CDP injection)"""
    import winreg
    key_path = r"Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments"
    value = "--remote-debugging-port=9222 --remote-allow-origins=*"
    try:
        # Check if already set
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ)
        existing = winreg.QueryValueEx(key, "*")[0]
        winreg.CloseKey(key)
        if "9222" in existing:
            return False  # Already configured
    except (FileNotFoundError, OSError):
        pass
    # Set registry key
    try:
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE)
        winreg.SetValueEx(key, "*", 0, winreg.REG_SZ, value)
        winreg.CloseKey(key)
    except: pass
    # Also set user environment variable as backup
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_WRITE)
        winreg.SetValueEx(key, "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 0, winreg.REG_SZ, value)
        winreg.CloseKey(key)
    except: pass
    return True  # Was first time — WhatsApp needs restart

def setup():
    """Create folders, extract files, configure registry"""
    for d in ["data", "data/Images", "data/Videos", "data/Sounds", "data/Docs"]:
        os.makedirs(os.path.join(EXE_DIR, d), exist_ok=True)

    # Enable debug port on first run
    first_run = ensure_debug_port()
    if first_run:
        # Show a notification that WhatsApp needs restart
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0,
                "WPlus has been configured!\n\n"
                "Please restart WhatsApp Desktop for changes to take effect.\n"
                "(Close WhatsApp from the system tray, then reopen it)\n\n"
                "WPlus will wait and connect automatically.",
                "WPlus — First Time Setup", 0x40)
        except: pass

    # Extract bundled JS files to exe directory (if not already there or outdated)
    for filename in ["engine.js", "ui.js"]:
        src = os.path.join(BUNDLE_DIR, filename)
        dst = os.path.join(EXE_DIR, filename)
        if os.path.exists(src):
            # Always overwrite with bundled version (ensures updates)
            try:
                with open(src, "r", encoding="utf-8") as f: content = f.read()
                with open(dst, "w", encoding="utf-8") as f: f.write(content)
            except: pass

    # Extract fileserver.py
    src_fs = os.path.join(BUNDLE_DIR, "fileserver.py")
    if os.path.exists(src_fs):
        try:
            with open(src_fs, "r", encoding="utf-8") as f: content = f.read()
            # Patch DATA_DIR to point to exe directory
            content = content.replace(
                'os.path.dirname(os.path.dirname(os.path.abspath(__file__)))',
                f'r"{EXE_DIR}"'
            ).replace(
                'os.path.dirname(os.path.abspath(__file__))',
                f'r"{EXE_DIR}"'
            )
            dst_fs = os.path.join(EXE_DIR, "_fileserver.py")
            with open(dst_fs, "w", encoding="utf-8") as f: f.write(content)
        except: pass

setup()

# ── File Server ──────────────────────────────────────────────
# Import the extracted fileserver
sys.path.insert(0, EXE_DIR)
try:
    # Try importing the patched version
    import importlib.util
    spec = importlib.util.spec_from_file_location("fileserver", os.path.join(EXE_DIR, "_fileserver.py"))
    if spec and spec.loader:
        fileserver = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fileserver)
        start_file_server = fileserver.start_server
    else:
        raise ImportError("No fileserver")
except:
    # Fallback: inline minimal file server
    from http.server import HTTPServer, BaseHTTPRequestHandler
    class MinHandler(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_OPTIONS(self):
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
            self.wfile.write(b"[]")
        def do_POST(self):
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
    def start_file_server(port):
        s = HTTPServer(("127.0.0.1", port), MinHandler)
        threading.Thread(target=s.serve_forever, daemon=True).start()

# ── Tray Icon ────────────────────────────────────────────────
from PIL import Image, ImageDraw, ImageFont
import pystray

FILES = {
    "wplus_del": os.path.join(DATA_DIR, "deleted_messages.json"),
    "wplus_cfg": os.path.join(DATA_DIR, "settings.json"),
}
LOG_FILE = os.path.join(DATA_DIR, "debug.log")
STATUS_FILE = os.path.join(DATA_DIR, "status.txt")

state = {"status": "Starting...", "injected": False, "syncs": 0, "running": True, "ws_url": None}

def log(msg):
    state["status"] = msg
    try:
        with open(STATUS_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
    except: pass

def load_file(path, default="[]"):
    try:
        with open(path, "r", encoding="utf-8") as f: return f.read()
    except: return default

def save_file(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f: f.write(data)
    except: pass

def get_wa_target():
    try:
        c = http.client.HTTPConnection("127.0.0.1", 9222, timeout=3)
        c.request("GET", "/json")
        targets = json.loads(c.getresponse().read())
        c.close()
        for t in targets:
            if "whatsapp" in t.get("url", "") and t["type"] == "page": return t
    except: pass
    return None

def cdp_eval(ws_url, code):
    cdp = json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": code, "returnByValue": True}})
    p = os.path.join(DATA_DIR, "_cdp.json")
    with open(p, "w", encoding="utf-8") as f: f.write(cdp)
    try:
        r = subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-Command",
            f'$ws=New-Object System.Net.WebSockets.ClientWebSocket;$ct=[System.Threading.CancellationToken]::None;'
            f'$ws.ConnectAsync([System.Uri]::new("{ws_url}"),$ct).Wait();'
            f'$msg=[System.IO.File]::ReadAllText("{p}");'
            f'$b=[System.Text.Encoding]::UTF8.GetBytes($msg);'
            f'$ws.SendAsync([System.ArraySegment[byte]]::new($b),[System.Net.WebSockets.WebSocketMessageType]::Text,$true,$ct).Wait();'
            f'$buf=New-Object byte[] 262144;'
            f'$ws.ReceiveAsync([System.ArraySegment[byte]]::new($buf),$ct).Wait()|Out-Null;'
            f'[System.Text.Encoding]::UTF8.GetString($buf).Trim([char]0);$ws.Dispose()'],
            capture_output=True, text=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
        os.remove(p)
        return json.loads(r.stdout.strip()).get("result", {}).get("result", {}).get("value")
    except:
        try: os.remove(p)
        except: pass
        return None

# ── Fast WhatsApp Detection ──────────────────────────────────
_last_wa_pid = None

def _find_wa_process():
    """Fast WhatsApp process detection using tasklist (much faster than PowerShell)"""
    try:
        r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq WhatsApp.Root.exe", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
        for line in r.stdout.strip().split("\n"):
            if "WhatsApp" in line:
                parts = line.strip('"').split('","')
                if len(parts) >= 2:
                    try: return int(parts[1].strip('"'))
                    except: return -1
        return 0
    except:
        return 0

def is_wa_running():
    return _find_wa_process() > 0

def detect_wa_change():
    """Detect if WhatsApp restarted (new PID). Returns: 'same', 'started', 'stopped', 'restarted'"""
    global _last_wa_pid
    pid = _find_wa_process()

    if pid > 0 and _last_wa_pid is None:
        _last_wa_pid = pid
        return "started"
    elif pid > 0 and _last_wa_pid and pid != _last_wa_pid:
        _last_wa_pid = pid
        return "restarted"
    elif pid == 0 and _last_wa_pid:
        _last_wa_pid = None
        return "stopped"
    elif pid > 0:
        return "same"
    else:
        return "stopped"

def inject(ws_url):
    cdp_eval(ws_url, 'if(window.__wplus&&window.__wplus.cleanup)window.__wplus.cleanup()')
    restored = 0
    for key, path in FILES.items():
        data = load_file(path, "null")
        if data and data != "null":
            cdp_eval(ws_url, f'localStorage.setItem("{key}",{json.dumps(data)})')
            restored += 1
    engine_path = os.path.join(EXE_DIR, "engine.js")
    ui_path = os.path.join(EXE_DIR, "ui.js")
    with open(engine_path, "r", encoding="utf-8") as f: engine = f.read()
    with open(ui_path, "r", encoding="utf-8") as f: ui = f.read()
    result = cdp_eval(ws_url, engine + ";\n" + ui)
    return result == "ok", restored

def uninject(ws_url):
    try:
        cdp_eval(ws_url, '''(function(){
            if(window.__wplus&&window.__wplus.cleanup)window.__wplus.cleanup();
            document.querySelectorAll("[id*=wplus],.wplus-restore-btn,.wplus-b,.wpp").forEach(function(e){e.remove();});
            document.querySelectorAll(".wplus-blur-t,.wplus-blur-p").forEach(function(e){e.classList.remove("wplus-blur-t","wplus-blur-p");});
            window.__wplus=undefined;
        })()''')
    except: pass

def sync(ws_url):
    changes = 0
    cdp_eval(ws_url, '(function(){var f=localStorage.getItem("wplus_sync_now");if(f)localStorage.removeItem("wplus_sync_now");})()')
    for key, path in FILES.items():
        val = cdp_eval(ws_url, f'localStorage.getItem("{key}")')
        if val and val != "null":
            current = load_file(path, "")
            if val != current:
                save_file(path, val)
                changes += 1
    if not hasattr(sync, '_c'): sync._c = 0
    sync._c += 1
    if sync._c % 5 == 0:
        try:
            log_val = cdp_eval(ws_url, 'localStorage.getItem("wplus_log")')
            if log_val and log_val != "null":
                entries = json.loads(log_val)
                if isinstance(entries, list) and entries:
                    lines = [f"WPlus Debug Log — {time.strftime('%Y-%m-%d %H:%M:%S')}", "=" * 50, ""]
                    for e in entries:
                        lines.append(f"[{e.get('ts','?')}] [{e.get('cat','?')}] {e.get('msg','')}" +
                                     (f" | {e.get('data','')}" if e.get('data') else ""))
                    with open(LOG_FILE, "w", encoding="utf-8") as f: f.write("\n".join(lines) + "\n")
        except: pass
    return changes

# ── Update Checker ────────────────────────────────────────────
def check_for_update():
    """Check GitHub releases for a newer version. Returns (has_update, latest_tag, download_url) or (False, None, None)"""
    try:
        ctx = ssl.create_default_context()
        conn = http.client.HTTPSConnection("api.github.com", timeout=10, context=ctx)
        conn.request("GET", f"/repos/{GITHUB_REPO}/releases/latest",
                     headers={"User-Agent": f"WPlus/{CURRENT_VERSION}"})
        resp = conn.getresponse()
        if resp.status != 200:
            return False, None, None
        data = json.loads(resp.read())
        conn.close()

        latest_tag = data.get("tag_name", "").lstrip("v")
        if not latest_tag:
            return False, None, None

        # Compare versions
        def ver_tuple(v):
            return tuple(int(x) for x in v.split(".") if x.isdigit())

        if ver_tuple(latest_tag) > ver_tuple(CURRENT_VERSION):
            # Find the exe/zip download URL
            dl_url = data.get("html_url", f"https://github.com/{GITHUB_REPO}/releases/latest")
            for asset in data.get("assets", []):
                if asset.get("name", "").endswith((".exe", ".zip")):
                    dl_url = asset.get("browser_download_url", dl_url)
                    break
            return True, latest_tag, dl_url

        return False, latest_tag, None
    except:
        return False, None, None

def notify_update(latest, url):
    """Show a Windows notification about the update"""
    try:
        import ctypes
        result = ctypes.windll.user32.MessageBoxW(0,
            f"WPlus v{latest} is available!\n\n"
            f"You are running v{CURRENT_VERSION}.\n\n"
            f"Would you like to download the update?",
            "WPlus — Update Available", 0x44)  # Yes/No + Info icon
        if result == 6:  # User clicked Yes
            os.startfile(url)
    except: pass

# ── Tray Icon Creation ───────────────────────────────────────
def create_icon():
    # Try to load from assets folder first
    ico_path = os.path.join(ASSETS_DIR, "icon-64.png")
    if os.path.exists(ico_path):
        try: return Image.open(ico_path)
        except: pass
    # Fallback: generate programmatically
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Shield
    pts = [(12,12),(32,6),(52,12),(52,38),(32,58),(12,38)]
    draw.polygon(pts, fill="#25D366")
    # Plus
    draw.rounded_rectangle([20,28,44,36], radius=2, fill="white")
    draw.rounded_rectangle([28,20,36,44], radius=2, fill="white")
    return img

def on_quit(icon, item):
    log("Shutting down...")
    if state["ws_url"]:
        try: sync(state["ws_url"])
        except: pass
        try: uninject(state["ws_url"])
        except: pass
    state["running"] = False
    icon.stop()

def on_reinject(icon, item):
    if state["ws_url"]:
        try: uninject(state["ws_url"])
        except: pass
    state["injected"] = False
    log("Re-injecting...")

def on_open_data(icon, item):
    os.startfile(DATA_DIR)

def on_open_folder(icon, item):
    os.startfile(EXE_DIR)

def on_check_update(icon, item):
    has_update, latest, url = check_for_update()
    if has_update:
        notify_update(latest, url)
    else:
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0,
                f"You're up to date!\n\nRunning WPlus v{CURRENT_VERSION}",
                "WPlus — No Updates", 0x40)
        except: pass

def on_github(icon, item):
    os.startfile(f"https://github.com/{GITHUB_REPO}")

def on_toggle_startup(icon, item):
    enabled = is_startup_enabled()
    if set_startup(not enabled):
        log(f"Startup {'disabled' if enabled else 'enabled'}")

def startup_checked(item):
    return is_startup_enabled()

def create_tray():
    return pystray.Icon("WPlus", create_icon(), f"WPlus v{CURRENT_VERSION} — by KuchiSofts",
        menu=pystray.Menu(
            pystray.MenuItem(lambda text: f"Status: {state['status']}", None, enabled=False),
            pystray.MenuItem(lambda text: f"v{CURRENT_VERSION}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Re-inject Plugin", on_reinject),
            pystray.MenuItem("Check for Updates", on_check_update),
            pystray.MenuItem("Run at Startup", on_toggle_startup, checked=startup_checked),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open Data Folder", on_open_data),
            pystray.MenuItem("Open WPlus Folder", on_open_folder),
            pystray.MenuItem("GitHub", on_github),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit WPlus", on_quit),
        ))

# ── Service Loop ─────────────────────────────────────────────
def service_loop():
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        f.write(f"WPlus Service started {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write(f"[WPlus] Session started {time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    try:
        start_file_server(18733)
        log("File server on port 18733")
    except Exception as e:
        log(f"File server: {e}")

    # Background update check (non-blocking)
    def bg_update_check():
        time.sleep(10)  # Wait for app to settle
        has_update, latest, url = check_for_update()
        if has_update:
            log(f"Update available: v{latest}")
            notify_update(latest, url)
        else:
            log(f"Up to date (v{CURRENT_VERSION})")
    threading.Thread(target=bg_update_check, daemon=True).start()

    # Initialize WhatsApp detection state
    if is_wa_running():
        log("WhatsApp already running")
        _find_wa_process()  # Set initial PID
        detect_wa_change()  # Initialize state
    else:
        log("Waiting for WhatsApp...")

    sync_tick = 0

    def do_inject():
        """Connect to WhatsApp debug port and inject plugin"""
        log("Connecting...")
        wa = None
        for _ in range(20):
            if not state["running"]: return False
            wa = get_wa_target()
            if wa: break
            time.sleep(2)
        if not wa:
            log("No debug port — restart WhatsApp")
            return False
        state["ws_url"] = wa["webSocketDebuggerUrl"]
        log("Injecting...")
        ok, restored = inject(state["ws_url"])
        if ok:
            state["injected"] = True
            log(f"Active ({restored} restored)")
            return True
        else:
            log("Inject failed")
            return False

    while state["running"]:
        try:
            time.sleep(3)
            sync_tick += 1

            # ── Detect WhatsApp lifecycle ─────────────────
            change = detect_wa_change()

            if change == "stopped":
                if state["injected"]:
                    log("WhatsApp closed — saving data")
                    try: sync(state["ws_url"])
                    except: pass
                    state["injected"] = False
                    state["ws_url"] = None
                continue

            if change == "started":
                log("WhatsApp started — waiting for WebView2...")
                time.sleep(8)  # Wait for WebView2 to initialize
                do_inject()
                continue

            if change == "restarted":
                log("WhatsApp restarted — re-injecting...")
                state["injected"] = False
                state["ws_url"] = None
                time.sleep(8)
                do_inject()
                continue

            # ── WhatsApp is running (change == "same") ────
            if not state["injected"]:
                # Not yet injected — try now
                if not do_inject():
                    time.sleep(5)
                continue

            # ── Check plugin alive (every 60s) ────────────
            if sync_tick % 20 == 0:
                wa = get_wa_target()
                if not wa:
                    log("Debug port lost")
                    state["injected"] = False
                    state["ws_url"] = None
                    continue
                state["ws_url"] = wa["webSocketDebuggerUrl"]
                alive = cdp_eval(state["ws_url"], 'window.__wplus&&window.__wplus.ready?"yes":"no"')
                if alive != "yes":
                    log("Plugin lost (page reload?) — re-injecting...")
                    state["injected"] = False
                    continue

            # ── Sync data ─────────────────────────────────
            if sync_tick % 2 == 0:  # Every 6 seconds
                changes = sync(state["ws_url"])
                if changes > 0:
                    state["syncs"] += changes

        except KeyboardInterrupt: break
        except: time.sleep(5)

    if state["ws_url"]:
        try: sync(state["ws_url"])
        except: pass
        try: uninject(state["ws_url"])
        except: pass
    log("Service stopped")

# ── Run at Startup ────────────────────────────────────────────
STARTUP_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
STARTUP_NAME = "WPlus"

def is_startup_enabled():
    import winreg
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY, 0, winreg.KEY_READ)
        val, _ = winreg.QueryValueEx(key, STARTUP_NAME)
        winreg.CloseKey(key)
        return bool(val)
    except:
        return False

def set_startup(enable):
    import winreg
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY, 0, winreg.KEY_WRITE)
        if enable:
            exe_path = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__)
            winreg.SetValueEx(key, STARTUP_NAME, 0, winreg.REG_SZ, f'"{exe_path}"')
        else:
            try: winreg.DeleteValue(key, STARTUP_NAME)
            except: pass
        winreg.CloseKey(key)
        return True
    except:
        return False

# ── Single Instance ──────────────────────────────────────────
def kill_old_instances():
    """Kill any existing WPlus.exe processes (except current)"""
    my_pid = os.getpid()
    try:
        r = subprocess.run(["powershell", "-Command",
            f"Get-Process -Name 'WPlus' -ErrorAction SilentlyContinue | "
            f"Where-Object {{ $_.Id -ne {my_pid} }} | "
            f"ForEach-Object {{ Stop-Process -Id $_.Id -Force; 'killed:' + $_.Id }}"],
            capture_output=True, text=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW)
        killed = [l for l in r.stdout.strip().split("\n") if l.startswith("killed:")]
        if killed:
            time.sleep(1)  # Wait for old process to fully exit
            return len(killed)
    except: pass
    # Also kill pythonw running wplus_service
    try:
        subprocess.run(["powershell", "-Command",
            f"Get-Process -Name 'pythonw' -ErrorAction SilentlyContinue | "
            f"Where-Object {{ $_.Id -ne {my_pid} }} | Stop-Process -Force"],
            capture_output=True, text=True, timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW)
    except: pass
    return 0

# ── Entry Point ──────────────────────────────────────────────
def main():
    # Kill any existing WPlus instances
    killed = kill_old_instances()
    if killed:
        log(f"Replaced {killed} old instance(s)")

    icon = create_tray()
    t = threading.Thread(target=service_loop, daemon=True)
    t.start()
    icon.run()
    state["running"] = False
    t.join(timeout=10)

if __name__ == "__main__":
    main()
