<p align="center">
  <img src="assets/icon-128.png" alt="WPlus" width="96">
</p>

<h1 align="center">WPlus</h1>

<p align="center">
  <strong>Free &amp; open source message protection and privacy toolkit for WhatsApp Desktop on Windows</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/KuchiSofts/WPlus?style=flat-square" alt="License: MIT"></a>
  <a href="https://github.com/KuchiSofts/WPlus/releases/latest"><img src="https://img.shields.io/github/v/release/KuchiSofts/WPlus?style=flat-square&amp;color=25D366" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6?style=flat-square" alt="Platform: Windows 10 | 11">
  <a href="https://github.com/KuchiSofts/WPlus/releases"><img src="https://img.shields.io/github/downloads/KuchiSofts/WPlus/total?style=flat-square&amp;color=blue" alt="Downloads"></a>
</p>

WPlus is a small system-tray app that adds a privacy panel to the official
WhatsApp Desktop app. It keeps a copy of messages that get deleted for
everyone, adds blur and "stealth" options, and runs entirely on your PC — no
account, no cloud, no telemetry.

> [!IMPORTANT]
> WPlus modifies how the WhatsApp Desktop client behaves. Using modified or
> third-party add-ons may violate WhatsApp's Terms of Service. Use it at your
> own risk — see the [FAQ](#faq).

---

## Features

### Message protection

| Feature | What it does |
|---------|--------------|
| **Keep deleted messages** | Incoming messages are backed up locally for 60 hours. If the sender deletes one for everyone, WPlus restores the original text in the chat and keeps a copy. |
| **Saved messages list** | Browse every deleted message WPlus caught from the panel, open a preview, or jump to it in the chat. |
| **Media preservation** | Deleted photos, videos and voice notes (and documents that were already downloaded) are saved as files in `data/`. |
| **Restore button** | A shield button in the chat header loads older history and restores deleted messages in the open chat. |
| **View-once capture** | WPlus tries to keep a copy of view-once photos and videos you receive (in WhatsApp's local browser storage) and lifts the one-view limit in your client. Please respect the sender's intent — they chose to share it once. |

### Privacy

| Feature | What it does |
|---------|--------------|
| **Blur messages** | Blurs message text and chat-list previews. Hover to reveal. |
| **Blur contacts** | Blurs names in the chat list, headers and group messages. |
| **Blur photos** | Blurs images in chats. |
| **Blur avatars** | Blurs profile pictures. |
| **Hide typing** | Others don't see "typing…" / "recording…". |
| **Hide online** | You don't appear "online". |
| **No blue ticks** | Read messages without sending read receipts. |
| **Private listen** | Play voice messages without the "played" notification. |

### Tools

| Feature | What it does |
|---------|--------------|
| **Export contacts** | Download your contacts as a CSV file. |
| **Chat stats** | Chat, group, unread and loaded-message counts. |
| **Load older messages** | A button that pulls earlier history into the open chat. |
| **Media viewer** | Full-screen image zoom, video and audio player with save. |
| **Update check** | Checks GitHub for a newer release (can be turned off). |
| **Debug logging** | Off by default. When on, keeps an event log for troubleshooting. |

---

## Install

1. Download **`WPlus.exe`** from the [latest release](https://github.com/KuchiSofts/WPlus/releases/latest).
2. Put it in its own folder (WPlus creates a `data/` folder next to it) and run it.
3. On first run WPlus enables the debug bridge for WhatsApp Desktop and asks
   you to **restart WhatsApp once** (quit it from the tray, then reopen it).
4. The **W+** shield appears in the system tray and a WPlus button appears in
   WhatsApp's left sidebar.

The executable is not code-signed, so Windows SmartScreen may warn you the
first time. You can verify what it does by reading the source or by
[running from source](#run-from-source).

**Requirements:** Windows 10 or 11 and the official WhatsApp Desktop app from
the Microsoft Store (the WebView2-based version). No Python or Node.js needed
for the release build.

### Tray menu

Right-click the **W+** icon: *Re-inject Plugin*, *Check for Updates*,
*Run at Startup*, *Open Data Folder*, *Open WPlus Folder*, *GitHub*,
*Quit WPlus* (removes the plugin from the running WhatsApp window).

---

## Run from source

Requires Python 3.9+ on Windows.

```bash
git clone https://github.com/KuchiSofts/WPlus.git
cd WPlus
pip install pystray Pillow
pythonw service/wplus.py      # or double-click WPlus.bat
```

`scripts/install.bat` does the same registry setup as the exe and installs the
Python packages.

### Build the exe

```bash
pip install pystray Pillow pyinstaller
pyinstaller --onefile --windowed --name WPlus --icon assets/WPlus.ico \
  --add-data "engine.js;." --add-data "ui.js;." \
  --add-data "service/fileserver.py;." --add-data "assets/icon-64.png;assets" \
  service/wplus.py
```

`engine.js` and `ui.js` in the project root are the actual source — there is
no JavaScript build step. `npm run check` runs a syntax check on both.

---

## How it works

```
WPlus.exe (tray app)
 ├─ Waits for WhatsApp Desktop (WhatsApp.Root.exe)
 ├─ Connects to its WebView2 via the Chrome DevTools Protocol on 127.0.0.1:9222
 ├─ Injects engine.js + ui.js into the WhatsApp page
 │    └─ engine.js hooks WhatsApp Web's internal modules (chats, messages,
 │       presence, receipts) and ui.js draws the panel
 ├─ Runs a local file server on 127.0.0.1:18733 that stores backed-up media
 ├─ Syncs settings and saved messages to data/
 └─ Re-injects after WhatsApp restarts or reloads; removes the plugin on quit
```

**What WPlus changes on your system**

- **Registry:** the WebView2 policy key
  `Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`
  gets values named `WhatsApp.Root.exe` and `WhatsApp.exe` with
  `--remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222`.
  This opens a DevTools port for WhatsApp only — no other WebView2 app is
  affected.
  - It is written under **HKLM** (machine-wide). WebView2 runtime 150 and newer
    ignore the per-user (HKCU) policy and the environment variable in many
    setups, so on first run Windows shows **one UAC prompt** to allow this.
  - The same values are also written under **HKCU** as a fallback for older
    runtimes (used if you decline the UAC prompt).
  - Versions before 2.0.1 set this for *all* WebView2 apps (value `*` and the
    `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable); 2.0.1
    removes those automatically.
- **Optional:** *Run at Startup* adds a `WPlus` value under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
- **Files:** everything else lives in the `data/` folder next to the exe.

WhatsApp's own program files are not modified; the plugin lives in the
running WhatsApp window. It is removed when you quit WPlus and is gone after
WhatsApp restarts.

**Local server security.** The file server listens on 127.0.0.1 only, accepts
browser requests only from `https://*.whatsapp.com`, requires a random
per-session token that is injected with the scripts, and can only read or
delete files inside the `data/` media folders. Note that any program running
under your Windows account can use the debug port to control WhatsApp
Desktop while it is enabled. See [SECURITY.md](SECURITY.md).

---

## Data & privacy

WPlus has no servers and collects no analytics. Data is stored **unencrypted**
in `data/` next to the exe:

| Path | Contents |
|------|----------|
| `data/new_messages.json` | Rolling backup of incoming messages (text, sender, chat name) from the last 60 hours, so they can be restored if deleted. Older entries and their media are removed automatically. |
| `data/deleted_messages.json` | Messages that were deleted for everyone and caught by WPlus. Kept until you use *Clear all*. |
| `data/Images/`, `Videos/`, `Sounds/`, `Docs/` | Media files for the messages above. |
| `data/settings.json` | Your panel toggles. |
| `data/status.txt` | Tray app status log (connection state only, no message content). |
| `data/debug.log` | Only when *Debug logging* is turned on. May contain message previews and phone numbers. Deleted when logging is turned off. |

WPlus also keeps working copies in WhatsApp's own browser storage
(`localStorage` keys starting with `wplus_`; view-once captures are kept
there under `wplus_vo`).

**Network:** the only request WPlus makes on its own is the update check to
`api.github.com` (GitHub sees your IP address, as with any web request).
Turn it off with *Settings → Check for updates* in the panel.

---

## Uninstall

1. Right-click the tray icon → **Quit WPlus**.
2. Remove the registry changes — either run `scripts/uninstall.bat` from the
   source folder, or paste this into an **administrator** PowerShell:

   ```powershell
   foreach ($k in 'HKLM:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments','HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments') {
     'WhatsApp.Root.exe','WhatsApp.exe' | ForEach-Object { Remove-ItemProperty -Path $k -Name $_ -ErrorAction SilentlyContinue } }
   $k = 'HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
   if ((Get-ItemProperty $k -Name '*' -ErrorAction SilentlyContinue).'*' -like '*9222*') { Remove-ItemProperty $k -Name '*' }
   if ([Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','User') -like '*9222*') { [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $null, 'User') }
   Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'WPlus' -ErrorAction SilentlyContinue
   ```

3. Restart WhatsApp Desktop.
4. Delete `WPlus.exe` and its `data/` folder (this deletes your saved messages
   and media).

---

## FAQ

<details>
<summary><strong>Can my account get banned?</strong></summary>

Possibly. WPlus doesn't send automated messages or talk to WhatsApp's
servers directly, but it changes how the official client behaves (for
example, not sending read receipts or presence updates). WhatsApp's Terms of
Service prohibit modified or unauthorized clients, and WhatsApp may act on
that at its discretion. There is no guarantee either way — use it at your own
risk.
</details>

<details>
<summary><strong>Is it safe?</strong></summary>

The code is fully open and runs locally. Keep in mind that saved messages are
stored unencrypted on your disk, and that while WPlus is set up, other
programs on your PC can reach WhatsApp through the debug port. Read
[SECURITY.md](SECURITY.md) for details.
</details>

<details>
<summary><strong>Why did a feature stop working after a WhatsApp update?</strong></summary>

WPlus relies on WhatsApp Web's internal modules and page structure, which
change without notice. Update WPlus, try *Re-inject Plugin*, and open an
issue if it still fails (turning on *Debug logging* helps — remove personal
data from the log before sharing it).
</details>

<details>
<summary><strong>Does it work with WhatsApp Web in a browser or on macOS?</strong></summary>

No. WPlus targets the Windows WhatsApp Desktop app only.
</details>

<details>
<summary><strong>How do I update?</strong></summary>

WPlus checks for new releases on startup. You can also use
*Check for Updates* in the tray menu, then replace `WPlus.exe` with the new
one (keep the `data/` folder).
</details>

---

## Project structure

```
WPlus/
├── engine.js              Injected engine: hooks, message backup/restore, privacy toggles
├── ui.js                  Injected panel UI
├── service/
│   ├── wplus.py           Tray app: setup, WhatsApp detection, CDP injection, sync
│   └── fileserver.py      Local media/message server (127.0.0.1:18733)
├── scripts/
│   ├── install.bat        Registry setup + Python packages (run from source)
│   ├── uninstall.bat      Removes registry changes
│   └── webview2-policy.ps1  Sets/removes the WebView2 debug-port policy (used by both)
├── assets/                Icons
├── data/                  Created at runtime (git-ignored)
├── WPlus.bat              Starts the tray app from source
├── SECURITY.md
└── THIRD_PARTY_NOTICES.md
```

---

## Contributing

Issues and pull requests are welcome.

- Edit `engine.js` / `ui.js` directly and run `npm run check`
  (or `node --check engine.js ui.js`).
- For Python changes run `python -m py_compile service/*.py`.
- Test against the current Microsoft Store version of WhatsApp Desktop and
  mention the version in your PR.
- Never commit anything from `data/` — it contains real messages.
- Report security issues privately as described in [SECURITY.md](SECURITY.md).

---

## Credits

- The technique of reaching WhatsApp Web's internal modules is inspired by
  [WA-JS](https://github.com/wppconnect-team/wa-js) by the
  [wppconnect-team](https://github.com/wppconnect-team).
- Built with [pystray](https://github.com/moses-palmer/pystray),
  [Pillow](https://python-pillow.org/) and
  [PyInstaller](https://pyinstaller.org/) — see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) © KuchiSofts

## Disclaimer

WPlus is not affiliated with, endorsed by, or sponsored by WhatsApp LLC or
Meta Platforms, Inc. WhatsApp is a trademark of WhatsApp LLC.

This software is provided "as is", without warranty of any kind. You are
responsible for how you use it, including respecting other people's privacy
and the laws that apply to you.
