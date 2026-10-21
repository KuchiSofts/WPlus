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
import sys, os, re, json, http.client, time, subprocess, threading, ssl, secrets

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

def _dir_writable(d):
    """True if files can be created in d (created if missing). os.access() ignores
    NTFS permissions, so actually try it."""
    try:
        os.makedirs(d, exist_ok=True)
        probe = os.path.join(d, f".wplus-write-test-{os.getpid()}.tmp")
        with open(probe, "w"): pass
        os.remove(probe)
        return True
    except OSError:
        return False

# data/ (and the extracted JS) live next to the exe. If that folder is read-only
# (e.g. the exe was put in Program Files), use %LOCALAPPDATA%\WPlus instead.
APP_DIR = EXE_DIR
if not _dir_writable(os.path.join(EXE_DIR, "data")):
    APP_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "WPlus")
DATA_DIR = os.path.join(APP_DIR, "data")
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
        os.makedirs(os.path.join(APP_DIR, d), exist_ok=True)

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

    # Extract bundled JS files next to data/ (if not already there or outdated)
    for filename in ["engine.js", "ui.js"]:
        src = os.path.join(BUNDLE_DIR, filename)
        dst = os.path.join(APP_DIR, filename)
        if os.path.exists(src) and os.path.normcase(os.path.abspath(src)) != os.path.normcase(os.path.abspath(dst)):
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
    """Start the file server and return the port it listens on. If the port is taken
    by another program, any free port is used: the page reaches the server only
    through the CDP bridge, which is told the actual port."""
    global FILE_SERVER_PORT
    if fileserver is None:
        raise RuntimeError(f"fileserver module not found ({fileserver_error})")
    try:
        server = fileserver.start_server(port, data_dir=DATA_DIR, token=SERVER_TOKEN)
    except OSError:
        server = fileserver.start_server(0, data_dir=DATA_DIR, token=SERVER_TOKEN)
    FILE_SERVER_PORT = server.server_address[1]
    return FILE_SERVER_PORT

# ── Tray Icon ────────────────────────────────────────────────
from PIL import Image, ImageDraw
import pystray

FILES = {
    "wplus_del": os.path.join(DATA_DIR, "deleted_messages.json"),
    "wplus_cfg": os.path.join(DATA_DIR, "settings.json"),
}
LOG_FILE = os.path.join(DATA_DIR, "debug.log")
STATUS_FILE = os.path.join(DATA_DIR, "status.txt")

state = {"status": "Starting...", "injected": False, "syncs": 0, "running": True, "ws_url": None, "bridge": None,
         "icon": None}

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
    changed = state["status"] != msg
    state["status"] = msg
    try:
        with open(STATUS_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
    except OSError: pass
    # pystray builds the menu once; rebuild it so "Status:" shows the current state
    icon = state["icon"]
    if changed and icon is not None:
        try: icon.update_menu()
        except Exception: pass

def load_file(path, default="[]"):
    try:
        with open(path, "r", encoding="utf-8") as f: return f.read()
    except (OSError, ValueError): return default

def save_file(path, data):
    """Write through a temp file so a crash or a concurrent reader never sees half a file."""
    tmp = f"{path}.{threading.get_ident()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f: f.write(data)
        os.replace(tmp, path)
    except OSError:
        try: os.remove(tmp)
        except OSError: pass

def get_wa_target():
    try:
        c = http.client.HTTPConnection("127.0.0.1", CDP_PORT, timeout=3)
        c.request("GET", "/json")
        targets = json.loads(c.getresponse().read())
        c.close()
        for t in targets:
            # No webSocketDebuggerUrl means another DevTools client owns the page
            if ("whatsapp" in t.get("url", "") and t.get("type") == "page"
                    and t.get("webSocketDebuggerUrl")):
                return t
    except (OSError, ValueError, http.client.HTTPException, AttributeError, TypeError): pass
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

def read_js(filename):
    """The extracted copy (users may edit it), else the bundled one."""
    for d in (APP_DIR, BUNDLE_DIR):
        try:
            with open(os.path.join(d, filename), "r", encoding="utf-8") as f: return f.read()
        except OSError: continue
    raise FileNotFoundError(filename)

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
    engine, ui = read_js("engine.js"), read_js("ui.js")
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
        try: return 1 if fileserver.merge_deleted(entries) else 0
        except OSError as e:  # File locked/unreadable: keep it, retry on the next sync
            log(f"Could not save deleted messages: {e}")
            return 0
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

def ver_tuple(v):
    """'v2.0.10' -> (2, 0, 10). Pre-release/build suffixes ('-beta', '+x') are ignored
    and trailing zeros dropped, so '2.1' == '2.1.0'. Returns () if there is no number."""
    m = re.match(r"\s*[vV]?(\d+(?:\.\d+)*)", str(v or ""))
    if not m:
        return ()
    t = [int(x) for x in m.group(1).split(".")]
    while len(t) > 1 and t[-1] == 0:
        t.pop()
    return tuple(t)

def check_for_update():
    """Check GitHub releases for a newer version. Returns (has_update, latest_tag, download_url);
    latest_tag is None if the check itself failed (offline, rate-limited, bad reply)."""
    try:
        data = fetch_latest_release()
        if not data:
            return False, None, None

        latest_tag = str(data.get("tag_name") or "").lstrip("vV")
        if not ver_tuple(latest_tag):
            return False, None, None

        if ver_tuple(latest_tag) > ver_tuple(CURRENT_VERSION):
            # Find the exe/zip download URL
            dl_url = data.get("html_url") or ""
            for asset in data.get("assets") or []:
                if str(asset.get("name", "")).endswith((".exe", ".zip")):
                    dl_url = asset.get("browser_download_url") or dl_url
                    break
            # The URL is opened with os.startfile: only ever hand it a GitHub https link
            if not str(dl_url).startswith("https://github.com/"):
                dl_url = f"https://github.com/{GITHUB_REPO}/releases/latest"
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

def in_background(fn):
    """Run a tray menu callback on its own thread: pystray calls callbacks on the
    tray message loop, which freezes the icon and menu while they run."""
    def wrapper(icon, item):
        threading.Thread(target=fn, args=(icon, item), daemon=True).start()
    wrapper.__name__ = fn.__name__
    return wrapper

def on_quit(icon, item):
    # The service thread does the final sync + uninject when it sees running=False
    # (doing it here raced with that thread, which could re-inject right after).
    log("Shutting down...")
    state["running"] = False
    icon.stop()

@in_background
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

@in_background
def on_check_update(icon, item):
    has_update, latest, url = check_for_update()
    if has_update:
        notify_update(latest, url)
        return
    try:
        import ctypes
        if latest is None:
            ctypes.windll.user32.MessageBoxW(0,
                "Could not check for updates (no connection to GitHub).\n\n"
                f"Running WPlus v{CURRENT_VERSION}",
                "WPlus — Update Check Failed", 0x30)
        else:
            ctypes.windll.user32.MessageBoxW(0,
                f"You're up to date!\n\nRunning WPlus v{CURRENT_VERSION}",
                "WPlus — No Updates", 0x40)
    except Exception: pass

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
    try:
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            f.write(f"WPlus Service started {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    except OSError: pass

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
        elif latest is None:
            log("Update check failed")
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
            try: hklm = _hklm_policy_ok()
            except Exception: hklm = True
            # Without the machine-wide policy (UAC prompt declined) WebView2 150+ keeps the port closed
            log("No debug port — restart WhatsApp" if hklm else
                "No debug port — restart WPlus and allow the admin prompt, then restart WhatsApp")
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
            if not state["running"]: break
            sync_tick += 1

            # ── Detect WhatsApp lifecycle ─────────────────
            change = detect_wa_change()

            if change == "stopped":
                if state["injected"]:
                    log("WhatsApp closed — saving data")
                    try: sync(state["ws_url"])
                    except Exception: pass
                    state["injected"] = False
                    state["ws_url"] = None
                    stop_bridge()
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
        except Exception as e:
            log(f"Error: {type(e).__name__}: {e}"[:200])
            time.sleep(5)

    if state["ws_url"]:
        try: sync(state["ws_url"])
        except Exception: pass
        try: uninject(state["ws_url"])
        except Exception: pass
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

def startup_command():
    if getattr(sys, 'frozen', False):
        return f'"{sys.executable}"'
    # Source mode: run the script with pythonw so no console window opens
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    return f'"{pyw if os.path.exists(pyw) else sys.executable}" "{os.path.abspath(__file__)}"'

def get_startup_value():
    import winreg
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY, 0, winreg.KEY_READ)
        try: return winreg.QueryValueEx(key, STARTUP_NAME)[0]
        finally: winreg.CloseKey(key)
    except OSError:
        return None

def startup_value_stale(value):
    """True if a Run entry points at files that no longer exist (WPlus was moved)."""
    paths = re.findall(r'"([^"]+)"', str(value or ""))
    return bool(paths) and not all(os.path.exists(x) for x in paths)

def refresh_startup_entry():
    """Re-point an enabled Run entry at this copy if the old path is gone."""
    value = get_startup_value()
    if value and startup_value_stale(value) and value != startup_command():
        set_startup(True)

def set_startup(enable):
    import winreg
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY, 0, winreg.KEY_WRITE)
        if enable:
            winreg.SetValueEx(key, STARTUP_NAME, 0, winreg.REG_SZ, startup_command())
        else:
            try: winreg.DeleteValue(key, STARTUP_NAME)
            except: pass
        winreg.CloseKey(key)
        return True
    except:
        return False

# ── Single Instance ──────────────────────────────────────────
_SCRIPT_RE = re.compile(r'[\\/]wplus(_service)?\.pyw?"?(\s|$)', re.I)
_MUTEX_NAME = "Local\\KuchiSofts.WPlus.Service"
_mutex = None

def _instance_exe_names():
    names = {"wplus.exe"}
    if getattr(sys, 'frozen', False):
        names.add(os.path.basename(sys.executable).lower())  # e.g. a renamed WPlus-2.0.1.exe
    return names

def select_old_instances(procs, me, parent, exe_names):
    """PIDs of other WPlus instances in a Win32_Process list, children first.
    Never this process, its parent (the PyInstaller onefile bootloader is also
    WPlus.exe) or its own children; never unrelated Python processes."""
    keep = {me, parent}
    found = {}
    for p in procs:
        try: pid, ppid = int(p.get("ProcessId")), int(p.get("ParentProcessId") or 0)
        except (TypeError, ValueError): continue
        if pid in keep or ppid == me or pid <= 4:
            continue
        name = str(p.get("Name") or "").lower()
        cmd = str(p.get("CommandLine") or "")
        if name in exe_names or (name in ("python.exe", "pythonw.exe") and _SCRIPT_RE.search(cmd)):
            found[pid] = ppid
    # Children (the onefile app / venv interpreter) before their parent, so a bootloader
    # can still remove its temp folder when its child exits
    return sorted(found, key=lambda pid: found[pid] not in found)

def _list_processes():
    ps = ("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
          "@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | "
          "Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
        capture_output=True, encoding="utf-8", errors="replace", timeout=20,
        creationflags=subprocess.CREATE_NO_WINDOW)
    data = json.loads(r.stdout or "[]")
    return [data] if isinstance(data, dict) else data

def _pid_alive(pid):
    import ctypes
    k32 = ctypes.WinDLL("kernel32")
    k32.OpenProcess.restype = ctypes.c_void_p
    h = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if not h: return True  # Cannot tell (e.g. access denied): try to stop it anyway
    try: return k32.WaitForSingleObject(ctypes.c_void_p(h), 0) == 0x102  # WAIT_TIMEOUT
    finally: k32.CloseHandle(ctypes.c_void_p(h))

def kill_old_instances():
    """Stop previous WPlus instances only: WPlus.exe processes (and this exe's own
    name if it was renamed) and python/pythonw processes whose command line runs
    wplus.py (or the old wplus_service.pyw). Returns how many were stopped."""
    try:
        pids = select_old_instances(_list_processes(), os.getpid(), os.getppid(), _instance_exe_names())
    except Exception:
        return 0
    killed = 0
    for pid in pids:
        if not _pid_alive(pid):
            continue  # A bootloader that already exited after its child
        try:
            os.kill(pid, 9)  # TerminateProcess on Windows
            killed += 1
        except OSError:
            pass
        time.sleep(0.3)
    if killed:
        time.sleep(1)  # Wait for old process to fully exit
    return killed

def acquire_single_instance(wait=5.0):
    """Hold a named mutex for the life of the process. False if another instance
    still holds it after `wait` seconds (e.g. one running elevated that could not
    be stopped)."""
    global _mutex
    import ctypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.restype = ctypes.c_void_p
    k32.CreateMutexW.argtypes = (ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p)
    end = time.time() + wait
    while True:
        h = k32.CreateMutexW(None, False, _MUTEX_NAME)
        if h and ctypes.get_last_error() != 183:  # ERROR_ALREADY_EXISTS
            _mutex = h
            return True
        if h: k32.CloseHandle(ctypes.c_void_p(h))
        if not h or time.time() >= end:
            return not h  # Could not create a mutex at all: do not block startup
        time.sleep(0.5)

# ── Entry Point ──────────────────────────────────────────────
def main():
    # Registry/folder setup runs here, not at import, so the helpers can be imported (tests)
    setup()

    # Kill any existing WPlus instances
    killed = kill_old_instances()
    if killed:
        log(f"Replaced {killed} old instance(s)")
    if not acquire_single_instance():
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0,
                "WPlus is already running and could not be replaced.\n\n"
                "Quit it from the system tray (or Task Manager) and start WPlus again.",
                "WPlus", 0x30)
        except Exception: pass
        return
    refresh_startup_entry()

    icon = create_tray()
    state["icon"] = icon
    t = threading.Thread(target=service_loop, daemon=True)
    t.start()
    icon.run()
    state["icon"] = None
    state["running"] = False
    t.join(timeout=30)  # Final sync + uninject

if __name__ == "__main__":
    main()
