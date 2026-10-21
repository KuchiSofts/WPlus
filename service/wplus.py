#!/usr/bin/env python3
"""
WPlus — Self-contained WhatsApp Desktop Plugin
by KuchiSofts — github.com/KuchiSofts

Single exe that contains everything:
- System tray service
- CDP injector
- File server for media
- engine.js + ui.js (embedded)

On first run, creates data/ folder structure.
"""
import sys, os, json, http.client, time, subprocess, threading, ssl, secrets

CURRENT_VERSION = "2.0.1"  # Keep in sync with engine.js and package.json
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
# Bundled assets live in _MEIPASS when frozen (--add-data "assets/icon-64.png;assets")
ASSETS_DIR = next((d for d in (os.path.join(BUNDLE_DIR, "assets"), os.path.join(EXE_DIR, "assets"))
                   if os.path.isdir(d)), os.path.join(BUNDLE_DIR, "assets"))

# ── First Run Setup ──────────────────────────────────────────
CDP_PORT = 9222
# WebView2 policy value names are matched against the host app's executable name,
# so the debug port is only opened for WhatsApp — not for every WebView2 app.
WA_EXE_NAMES = ("WhatsApp.Root.exe", "WhatsApp.exe")
WEBVIEW2_POLICY_KEY = r"Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments"
# Our CDP client (cdpbridge.WebSocket) sends no Origin header, so a specific
# origin here is enough; it stops web pages from opening the DevTools socket.
WEBVIEW2_ARGS = f"--remote-debugging-port={CDP_PORT} --remote-allow-origins=http://127.0.0.1:{CDP_PORT}"

def _is_legacy_wplus_args(value):
    """Matches the global value older WPlus versions wrote for ALL WebView2 apps."""
    return isinstance(value, str) and f"--remote-debugging-port={CDP_PORT}" in value

def _broadcast_env_change():
    try:
        import ctypes
        ctypes.windll.user32.SendMessageTimeoutW(0xFFFF, 0x001A, 0, "Environment", 0x0002, 2000, None)
    except Exception: pass

def _hklm_policy_ok():
    """True if the machine-wide policy already opens the debug port for WhatsApp."""
    import winreg
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, WEBVIEW2_POLICY_KEY, 0, winreg.KEY_READ)
        try: return all(winreg.QueryValueEx(key, exe)[0] == WEBVIEW2_ARGS for exe in WA_EXE_NAMES)
        finally: winreg.CloseKey(key)
    except OSError:
        return False

def _set_hklm_policy():
    """Write the machine-wide policy through one elevated (UAC) PowerShell call.
    WebView2 150+ ignores the HKCU policy and the environment variable in many setups,
    so HKLM is the only reliable place. Returns True if the policy is in place afterwards."""
    import ctypes
    from ctypes import wintypes
    names = ",".join(f"'{n}'" for n in WA_EXE_NAMES)
    script = (f"$k='HKLM:\\{WEBVIEW2_POLICY_KEY}'; New-Item -Path $k -Force | Out-Null; "
              f"foreach($n in {names}){{ New-ItemProperty -Path $k -Name $n -Value '{WEBVIEW2_ARGS}' -PropertyType String -Force | Out-Null }}")

    class SHELLEXECUTEINFOW(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("fMask", wintypes.ULONG), ("hwnd", wintypes.HWND),
                    ("lpVerb", wintypes.LPCWSTR), ("lpFile", wintypes.LPCWSTR), ("lpParameters", wintypes.LPCWSTR),
                    ("lpDirectory", wintypes.LPCWSTR), ("nShow", ctypes.c_int), ("hInstApp", wintypes.HINSTANCE),
                    ("lpIDList", ctypes.c_void_p), ("lpClass", wintypes.LPCWSTR), ("hkeyClass", wintypes.HKEY),
                    ("dwHotKey", wintypes.DWORD), ("hIcon", wintypes.HANDLE), ("hProcess", wintypes.HANDLE)]
    info = SHELLEXECUTEINFOW()
    info.cbSize = ctypes.sizeof(info)
    info.fMask = 0x40  # SEE_MASK_NOCLOSEPROCESS
    info.lpVerb = "runas"
    info.lpFile = "powershell.exe"
    info.lpParameters = f'-NoProfile -WindowStyle Hidden -Command "{script}"'
    info.nShow = 0
    try:
        if not ctypes.windll.shell32.ShellExecuteExW(ctypes.byref(info)):
            return False  # UAC prompt declined
        ctypes.windll.kernel32.WaitForSingleObject(info.hProcess, 30000)
        ctypes.windll.kernel32.CloseHandle(info.hProcess)
    except Exception:
        return False
    return _hklm_policy_ok()

def ensure_debug_port():
    """Enable the WebView2 debug port for WhatsApp only (needed for CDP injection).
    Also migrates the global '*' policy / environment variable set by older versions.
    Returns True if anything changed (WhatsApp needs a restart)."""
    import winreg
    changed = False
    # Machine-wide policy first: the only one current WebView2 runtimes honor everywhere
    if not _hklm_policy_ok() and _set_hklm_policy():
        changed = True
    try:
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, WEBVIEW2_POLICY_KEY, 0,
                                 winreg.KEY_READ | winreg.KEY_WRITE)
        # Remove the old global value (applied to every WebView2 app)
        try:
            if _is_legacy_wplus_args(winreg.QueryValueEx(key, "*")[0]):
                winreg.DeleteValue(key, "*")
                changed = True
        except OSError: pass
        for exe in WA_EXE_NAMES:
            try: existing = winreg.QueryValueEx(key, exe)[0]
            except OSError: existing = None
            if existing != WEBVIEW2_ARGS:
                winreg.SetValueEx(key, exe, 0, winreg.REG_SZ, WEBVIEW2_ARGS)
                changed = True
        winreg.CloseKey(key)
    except OSError: pass
    # Remove the old user environment variable (also applied to every WebView2 app)
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0,
                             winreg.KEY_READ | winreg.KEY_WRITE)
        try:
            if _is_legacy_wplus_args(winreg.QueryValueEx(key, "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")[0]):
                winreg.DeleteValue(key, "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
                _broadcast_env_change()
                changed = True
        except OSError: pass
        winreg.CloseKey(key)
    except OSError: pass
    return changed

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

    # Older versions wrote a patched copy of the file server next to the exe
    try: os.remove(os.path.join(EXE_DIR, "_fileserver.py"))
    except OSError: pass

# ── File Server ──────────────────────────────────────────────
# Source mode: fileserver.py sits next to this file in service/.
# Frozen mode: PyInstaller bundles it as a module (or via --add-data into _MEIPASS).
FILE_SERVER_PORT = 18733
SERVER_TOKEN = secrets.token_urlsafe(32)  # Per-session secret shared with the injected JS
fileserver, fileserver_error = None, None
for _dir in (os.path.dirname(os.path.abspath(__file__)), BUNDLE_DIR):
    if _dir not in sys.path: sys.path.insert(0, _dir)
try:
    import fileserver
except Exception as e:
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("fileserver", os.path.join(BUNDLE_DIR, "fileserver.py"))
        fileserver = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fileserver)
    except Exception as e2:
        fileserver, fileserver_error = None, f"{e} / {e2}"

import cdpbridge  # Page <-> file server channel (WhatsApp's CSP blocks direct requests)

def start_file_server(port):
    if fileserver is None:
        raise RuntimeError(f"fileserver module not found ({fileserver_error})")
    fileserver.start_server(port, data_dir=DATA_DIR, token=SERVER_TOKEN)

# ── Tray Icon ────────────────────────────────────────────────
from PIL import Image, ImageDraw
import pystray

FILES = {
    "wplus_del": os.path.join(DATA_DIR, "deleted_messages.json"),
    "wplus_cfg": os.path.join(DATA_DIR, "settings.json"),
}
LOG_FILE = os.path.join(DATA_DIR, "debug.log")
STATUS_FILE = os.path.join(DATA_DIR, "status.txt")

state = {"status": "Starting...", "injected": False, "syncs": 0, "running": True, "ws_url": None, "bridge": None}

def ensure_bridge(ws_url):
    """Keep one live CDP bridge session to the WhatsApp page."""
    b = state["bridge"]
    if b and b.alive() and b.ws_url == ws_url:
        return True
    if b: b.stop()
    b = cdpbridge.Bridge(ws_url, FILE_SERVER_PORT, SERVER_TOKEN,
                         extra_routes={"/latest-release": latest_release_for_page}, log=log)
    state["bridge"] = b
    ok = b.start_and_wait() and b.alive()
    if not ok: log("Bridge could not connect")
    return ok

def stop_bridge():
    b, state["bridge"] = state["bridge"], None
    if b: b.stop()

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
        c = http.client.HTTPConnection("127.0.0.1", CDP_PORT, timeout=3)
        c.request("GET", "/json")
        targets = json.loads(c.getresponse().read())
        c.close()
        for t in targets:
            if "whatsapp" in t.get("url", "") and t["type"] == "page": return t
    except: pass
    return None

def cdp_eval(ws_url, code, timeout=60):
    """Evaluate JS in the WhatsApp page and return the result value (None on any error).
    Uses a direct DevTools WebSocket connection: no helper process or temp file, and
    calls from the tray thread and the service thread cannot interfere."""
    return cdpbridge.evaluate(ws_url, code, timeout=timeout)

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
    # Pull anything the page saved since the last sync before overwriting it with the file copy
    try: sync_key(ws_url, "wplus_del", FILES["wplus_del"])
    except Exception: pass
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
    token = f"window.__WPLUS_TOKEN__={json.dumps(SERVER_TOKEN)};\n"
    result = cdp_eval(ws_url, token + engine + ";\n" + ui)
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

def sync_key(ws_url, key, path):
    """Copy one localStorage key to disk. Returns 1 if the file changed."""
    val = cdp_eval(ws_url, f'localStorage.getItem("{key}")')
    if not val or val == "null":
        return 0
    if key == "wplus_del" and fileserver is not None:
        # deleted_messages.json is owned by the file server: merge the browser copy
        # into it (keeps mediaFile, moves any base64 media to disk) instead of overwriting
        try: entries = json.loads(val)
        except ValueError: return 0
        return 1 if fileserver.merge_deleted(entries) else 0
    if val != load_file(path, ""):
        save_file(path, val)
        return 1
    return 0

def sync(ws_url):
    changes = 0
    cdp_eval(ws_url, '(function(){var f=localStorage.getItem("wplus_sync_now");if(f)localStorage.removeItem("wplus_sync_now");})()')
    for key, path in FILES.items():
        changes += sync_key(ws_url, key, path)
    if not hasattr(sync, '_c'): sync._c = 0
    sync._c += 1
    if sync._c % 5 == 0:
        try:
            log_val = cdp_eval(ws_url, 'String(localStorage.getItem("wplus_log"))')  # None = CDP error
            if log_val == "null":
                # Debug logging is off (the engine clears wplus_log) — don't keep an old log on disk
                if os.path.exists(LOG_FILE): os.remove(LOG_FILE)
            elif log_val:
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
def fetch_latest_release():
    """Latest GitHub release as a dict ({} on failure)."""
    try:
        ctx = ssl.create_default_context()
        conn = http.client.HTTPSConnection("api.github.com", timeout=10, context=ctx)
        conn.request("GET", f"/repos/{GITHUB_REPO}/releases/latest",
                     headers={"User-Agent": f"WPlus/{CURRENT_VERSION}"})
        resp = conn.getresponse()
        data = json.loads(resp.read()) if resp.status == 200 else {}
        conn.close()
        return data
    except Exception:
        return {}

def latest_release_for_page():
    """Answer for the panel's update check (it cannot reach api.github.com itself)."""
    data = fetch_latest_release()
    return {"tag_name": data.get("tag_name", ""), "html_url": data.get("html_url", "")}

def check_for_update():
    """Check GitHub releases for a newer version. Returns (has_update, latest_tag, download_url) or (False, None, None)"""
    try:
        data = fetch_latest_release()
        if not data:
            return False, None, None

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
    stop_bridge()
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

    try:
        start_file_server(FILE_SERVER_PORT)
        log(f"File server on port {FILE_SERVER_PORT}")
    except Exception as e:
        log(f"File server: {e}")

    # Background update check (non-blocking)
    def bg_update_check():
        time.sleep(10)  # Wait for app to settle
        try:
            with open(FILES["wplus_cfg"], "r", encoding="utf-8") as f:
                if json.load(f).get("checkUpdates") is False:
                    return  # Turned off in the WPlus panel
        except (OSError, ValueError, AttributeError): pass
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
        ensure_bridge(state["ws_url"])
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
                ensure_bridge(state["ws_url"])
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
    stop_bridge()
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
            if getattr(sys, 'frozen', False):
                cmd = f'"{sys.executable}"'
            else:
                # Source mode: run the script with pythonw so no console window opens
                pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
                cmd = f'"{pyw if os.path.exists(pyw) else sys.executable}" "{os.path.abspath(__file__)}"'
            winreg.SetValueEx(key, STARTUP_NAME, 0, winreg.REG_SZ, cmd)
        else:
            try: winreg.DeleteValue(key, STARTUP_NAME)
            except: pass
        winreg.CloseKey(key)
        return True
    except:
        return False

# ── Single Instance ──────────────────────────────────────────
def kill_old_instances():
    """Stop previous WPlus instances only: WPlus.exe processes and python/pythonw
    processes whose command line runs wplus.py (or the old wplus_service.pyw).
    Never touches unrelated Python processes, this process or its parent
    (the PyInstaller onefile bootloader is also named WPlus.exe)."""
    keep = f"{os.getpid()},{os.getppid()}"
    ps = (
        f"$keep=@({keep}); "
        "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { "
        "$keep -notcontains $_.ProcessId -and ("
        "$_.Name -eq 'WPlus.exe' -or "
        "(($_.Name -eq 'python.exe' -or $_.Name -eq 'pythonw.exe') -and "
        "$_.CommandLine -match '[\\\\/]wplus(_service)?\\.pyw?\"?(\\s|$)')) } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; 'killed:' + $_.ProcessId }"
    )
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, timeout=15,
            creationflags=subprocess.CREATE_NO_WINDOW)
        killed = [l for l in r.stdout.strip().split("\n") if l.startswith("killed:")]
        if killed:
            time.sleep(1)  # Wait for old process to fully exit
            return len(killed)
    except Exception: pass
    return 0

# ── Entry Point ──────────────────────────────────────────────
def main():
    # Registry/folder setup runs here, not at import, so the helpers can be imported (tests)
    setup()

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
