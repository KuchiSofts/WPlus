#!/usr/bin/env pythonw
# WPlus Service v1.3 — System Tray App
# by KuchiSofts — github.com/KuchiSofts
# Smart tray service: auto-detect, inject, sync, uninject on exit

import json, http.client, time, os, sys, subprocess, threading
from PIL import Image, ImageDraw, ImageFont
import pystray

script_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(script_dir)  # Parent of service/
sys.path.insert(0, script_dir)
from fileserver import start_server as start_file_server
DATA_DIR = os.path.join(project_dir, "data")
os.makedirs(DATA_DIR, exist_ok=True)

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
    p = os.path.join(project_dir, "_cdp.json")
    with open(p, "w", encoding="utf-8") as f: f.write(cdp)
    try:
        r = subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-Command",
            f'$ws=New-Object System.Net.WebSockets.ClientWebSocket;$ct=[System.Threading.CancellationToken]::None;$ws.ConnectAsync([System.Uri]::new("{ws_url}"),$ct).Wait();$msg=[System.IO.File]::ReadAllText("{p}");$b=[System.Text.Encoding]::UTF8.GetBytes($msg);$ws.SendAsync([System.ArraySegment[byte]]::new($b),[System.Net.WebSockets.WebSocketMessageType]::Text,$true,$ct).Wait();$buf=New-Object byte[] 262144;$ws.ReceiveAsync([System.ArraySegment[byte]]::new($buf),$ct).Wait()|Out-Null;[System.Text.Encoding]::UTF8.GetString($buf).Trim([char]0);$ws.Dispose()'],
            capture_output=True, text=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
        os.remove(p)
        return json.loads(r.stdout.strip()).get("result", {}).get("result", {}).get("value")
    except:
        try: os.remove(p)
        except: pass
        return None

def is_wa_running():
    try:
        r = subprocess.run(["powershell", "-Command",
            "Get-Process -Name 'WhatsApp*' -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { 'yes' }"],
            capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
        return "yes" in r.stdout
    except: return False

# ── Inject / Uninject ────────────────────────────────────────
def inject(ws_url):
    # Uninject previous instance first
    cdp_eval(ws_url, 'if(window.__wplus&&window.__wplus.cleanup)window.__wplus.cleanup()')

    # Restore saved data
    restored = 0
    for key, path in FILES.items():
        data = load_file(path, "null")
        if data and data != "null":
            cdp_eval(ws_url, f'localStorage.setItem("{key}",{json.dumps(data)})')
            restored += 1

    # Inject engine + UI
    with open(os.path.join(project_dir, "engine.js"), "r", encoding="utf-8") as f: engine = f.read()
    with open(os.path.join(project_dir, "ui.js"), "r", encoding="utf-8") as f: ui = f.read()
    result = cdp_eval(ws_url, engine + ";\n" + ui)
    return result == "ok", restored

def uninject(ws_url):
    """Remove plugin completely — restore WhatsApp to original state"""
    try:
        cdp_eval(ws_url, '''(function(){
            if(window.__wplus && window.__wplus.cleanup) window.__wplus.cleanup();
            ["wplus-btn","wplus-panel","wplus-css","wplus-header-restore","wplus-style",
             "wplus-css-blurMessages","wplus-css-blurContacts","wplus-css-blurPhotos"].forEach(function(id){
                var e=document.getElementById(id); if(e) e.remove();
            });
            document.querySelectorAll(".wplus-restore-btn,.wplus-b,.wpp,.wplus-msg-highlight,[id*=wplus]").forEach(function(e){e.remove();});
            document.querySelectorAll(".wplus-blur-t,.wplus-blur-p").forEach(function(e){
                e.classList.remove("wplus-blur-t","wplus-blur-p");
            });
            window.__wplus = undefined;
        })()''')
        log("Plugin uninjected")
    except: pass

def sync(ws_url):
    changes = 0
    # Check immediate sync flag
    cdp_eval(ws_url, '(function(){var f=localStorage.getItem("wplus_sync_now");if(f)localStorage.removeItem("wplus_sync_now");})()')
    for key, path in FILES.items():
        val = cdp_eval(ws_url, f'localStorage.getItem("{key}")')
        if val and val != "null":
            current = load_file(path, "")
            if val != current:
                save_file(path, val)
                changes += 1
    # Sync debug log (less frequent — only every 5th call)
    if not hasattr(sync, '_count'): sync._count = 0
    sync._count += 1
    if sync._count % 5 == 0:
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

# ── Tray Icon ────────────────────────────────────────────────
def create_icon():
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([8, 4, 56, 56], radius=8, fill="#25D366")
    try: font = ImageFont.truetype("segoeui.ttf", 22)
    except: font = ImageFont.load_default()
    draw.text((14, 14), "W+", fill="white", font=font)
    return img

def on_quit(icon, item):
    log("Shutting down...")
    # Uninject before exit
    if state["ws_url"]:
        try: sync(state["ws_url"])
        except: pass
        try: uninject(state["ws_url"])
        except: pass
    state["running"] = False
    icon.stop()

def on_reinject(icon, item):
    # Uninject first, then mark for re-inject
    if state["ws_url"]:
        try: uninject(state["ws_url"])
        except: pass
    state["injected"] = False
    log("Re-injecting...")

def on_open_data(icon, item):
    os.startfile(DATA_DIR)

def create_tray():
    return pystray.Icon("WPlus", create_icon(), "WPlus — WhatsApp Plugin",
        menu=pystray.Menu(
            pystray.MenuItem(lambda text: f"Status: {state['status']}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Re-inject Plugin", on_reinject),
            pystray.MenuItem("Open Data Folder", on_open_data),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit WPlus", on_quit),
        ))

# ── Service Loop ─────────────────────────────────────────────
def service_loop():
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        f.write(f"WPlus Service started {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write(f"[WPlus] Session started {time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    # Start file server for media saving
    try:
        start_file_server(18733)
        log("File server on port 18733")
    except Exception as e:
        log(f"File server error: {e}")

    sync_tick = 0

    while state["running"]:
        try:
            # Phase 1: Wait for WhatsApp + inject
            if not state["injected"]:
                log("Waiting for WhatsApp...")
                while state["running"] and not is_wa_running():
                    time.sleep(3)
                if not state["running"]: break

                log("Connecting...")
                time.sleep(8)

                wa = None
                for _ in range(20):
                    if not state["running"]: break
                    wa = get_wa_target()
                    if wa: break
                    time.sleep(2)

                if not wa:
                    log("Connection failed")
                    time.sleep(5)
                    continue

                state["ws_url"] = wa["webSocketDebuggerUrl"]
                log("Injecting...")

                ok, restored = inject(state["ws_url"])
                if ok:
                    state["injected"] = True
                    log(f"Active ({restored} restored)")
                else:
                    log("Inject failed")
                    time.sleep(5)
                    continue

            # Phase 2: Sync loop (every 5 seconds)
            time.sleep(5)
            sync_tick += 1

            # Check WhatsApp alive
            wa = get_wa_target()
            if not wa:
                if state["injected"]:
                    log("WhatsApp closed")
                    try: sync(state["ws_url"])
                    except: pass
                    state["injected"] = False
                    state["ws_url"] = None
                continue

            state["ws_url"] = wa["webSocketDebuggerUrl"]

            # Check plugin alive (every 60 seconds)
            if sync_tick % 12 == 0:
                alive = cdp_eval(state["ws_url"], 'window.__wplus&&window.__wplus.ready?"yes":"no"')
                if alive != "yes":
                    log("Plugin lost, re-injecting...")
                    state["injected"] = False
                    continue

            # Sync
            changes = sync(state["ws_url"])
            if changes > 0:
                state["syncs"] += changes

        except KeyboardInterrupt:
            break
        except:
            time.sleep(5)

    # Final cleanup
    if state["ws_url"]:
        try: sync(state["ws_url"])
        except: pass
        try: uninject(state["ws_url"])
        except: pass
    log("Service stopped")

# ── Entry ────────────────────────────────────────────────────
def main():
    icon = create_tray()
    t = threading.Thread(target=service_loop, daemon=True)
    t.start()
    icon.run()
    state["running"] = False
    t.join(timeout=10)

if __name__ == "__main__":
    main()
