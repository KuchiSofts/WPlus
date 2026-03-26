#!/usr/bin/env python3
"""
WPlus v2.0 — WhatsApp Desktop Plugin Service
by KuchiSofts — github.com/KuchiSofts
Single entry point for the exe build — combines tray service + injector + file server
"""
import sys
import os

# Set paths relative to exe or script location
if getattr(sys, 'frozen', False):
    # Running as exe (PyInstaller)
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # Running as script
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Add service dir to path
SERVICE_DIR = os.path.join(BASE_DIR, "service") if os.path.exists(os.path.join(BASE_DIR, "service")) else BASE_DIR
sys.path.insert(0, SERVICE_DIR)

import json, http.client, time, subprocess, threading, base64
from PIL import Image, ImageDraw, ImageFont
import pystray

DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

# Import file server
from fileserver import start_server as start_file_server

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

def inject(ws_url):
    cdp_eval(ws_url, 'if(window.__wplus&&window.__wplus.cleanup)window.__wplus.cleanup()')
    restored = 0
    for key, path in FILES.items():
        data = load_file(path, "null")
        if data and data != "null":
            cdp_eval(ws_url, f'localStorage.setItem("{key}",{json.dumps(data)})')
            restored += 1
    # Load JS files from project root
    engine_path = os.path.join(BASE_DIR, "engine.js")
    ui_path = os.path.join(BASE_DIR, "ui.js")
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

# Tray icon
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
    os.startfile(BASE_DIR)

def create_tray():
    return pystray.Icon("WPlus", create_icon(), "WPlus v2.0 — by KuchiSofts",
        menu=pystray.Menu(
            pystray.MenuItem(lambda text: f"Status: {state['status']}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Re-inject Plugin", on_reinject),
            pystray.MenuItem("Open Data Folder", on_open_data),
            pystray.MenuItem("Open WPlus Folder", on_open_folder),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit WPlus", on_quit),
        ))

def service_loop():
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        f.write(f"WPlus Service started {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write(f"[WPlus] Session started {time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    try:
        start_file_server(18733)
        log("File server on port 18733")
    except Exception as e:
        log(f"File server error: {e}")

    sync_tick = 0
    while state["running"]:
        try:
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

            time.sleep(5)
            sync_tick += 1
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
            if sync_tick % 12 == 0:
                alive = cdp_eval(state["ws_url"], 'window.__wplus&&window.__wplus.ready?"yes":"no"')
                if alive != "yes":
                    log("Plugin lost, re-injecting...")
                    state["injected"] = False
                    continue
            changes = sync(state["ws_url"])
            if changes > 0: state["syncs"] += changes
        except KeyboardInterrupt: break
        except: time.sleep(5)

    if state["ws_url"]:
        try: sync(state["ws_url"])
        except: pass
        try: uninject(state["ws_url"])
        except: pass
    log("Service stopped")

def main():
    icon = create_tray()
    t = threading.Thread(target=service_loop, daemon=True)
    t.start()
    icon.run()
    state["running"] = False
    t.join(timeout=10)

if __name__ == "__main__":
    main()
