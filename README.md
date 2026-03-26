<p align="center">
  <img src="assets/icon-128.png" alt="WPlus" width="80">
</p>

<h1 align="center">WPlus</h1>

<p align="center">
  <strong>Message protection & privacy toolkit for WhatsApp Desktop</strong>
</p>

<p align="center">
  <a href="https://github.com/KuchiSofts/WPlus/releases/latest"><img src="https://img.shields.io/github/v/release/KuchiSofts/WPlus?style=flat-square&color=25D366" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/KuchiSofts/WPlus?style=flat-square" alt="License"></a>
  <a href="https://github.com/KuchiSofts/WPlus/releases"><img src="https://img.shields.io/github/downloads/KuchiSofts/WPlus/total?style=flat-square&color=blue" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square" alt="Windows">
</p>

<p align="center">
  Free &bull; Open Source &bull; No accounts &bull; No servers &bull; No tracking
</p>

---

## Quick Start

**Download [WPlus.exe](https://github.com/KuchiSofts/WPlus/releases/latest) &rarr; Run it &rarr; Done.**

On first run WPlus configures itself automatically. If WhatsApp is already open you will be asked to restart it once. The **W+** shield icon appears in your system tray.

---

## Features

### Message Protection
| Feature | Description |
|---------|-------------|
| **Save deleted messages** | Incoming messages are backed up. If someone deletes a message you still see the original. |
| **Force restore** | Shield button in chat header loads full history and restores all deleted messages. |
| **Media preservation** | Deleted images, videos, and voice messages saved to disk. |
| **Navigate to message** | Click any saved message to jump directly to it in the chat. |

### Privacy
| Feature | Description |
|---------|-------------|
| **Blur messages** | Blur text in conversations. Hover to reveal. |
| **Blur contacts** | Hide names everywhere including inside group messages. |
| **Blur photos** | Blur profile pictures. Hover to reveal. |
| **Hide typing** | Others cannot see you typing. |
| **Hide online** | Appear offline while using WhatsApp. |
| **No read receipts** | Disable blue ticks. |
| **Private audio** | Listen to voice messages without notifying sender. |

### Tools
| Feature | Description |
|---------|-------------|
| **Export contacts** | Download all contacts as CSV. |
| **Chat statistics** | Message counts, top chats, group counts. |
| **Load older messages** | Scroll-up button to load chat history. |
| **Fullscreen media** | Image zoom, video player with volume, audio player. |
| **Auto-update** | Checks for new releases on startup. |
| **Debug logging** | Full event log for troubleshooting. |

---

## How It Works

WPlus runs as a lightweight system tray app. It connects to WhatsApp Desktop through its WebView2 debug bridge and injects two JavaScript files.

```
WPlus.exe (tray)
  ├── Detects WhatsApp process
  ├── Connects via Chrome DevTools Protocol
  ├── Injects engine.js + ui.js
  ├── Syncs data to disk
  ├── Re-injects on WhatsApp restart
  └── Cleans up on exit
```

**No files are modified.** WPlus runs in memory only.

---

## Tray Menu

Right-click the **W+** icon:

| Option | Description |
|--------|-------------|
| **Re-inject Plugin** | Force re-inject |
| **Check for Updates** | Check for new versions |
| **Open Data Folder** | Browse saved messages and media |
| **GitHub** | Visit the repository |
| **Quit WPlus** | Stop and uninject |

---

## Data Storage

```
WPlus.exe
 └── data/
     ├── deleted_messages.json
     ├── settings.json
     ├── Images/
     ├── Videos/
     ├── Sounds/
     └── Docs/
```

Everything stays on your machine. Nothing is sent externally.

---

## Requirements

- **WhatsApp Desktop** (Microsoft Store)
- **Windows 10/11**

No Python or Node.js needed. `WPlus.exe` is fully self-contained.

---

## Building from Source

```bash
git clone https://github.com/KuchiSofts/WPlus.git
cd WPlus
pip install pystray Pillow pyinstaller
npm install && npm run build

pyinstaller --onefile --windowed --name WPlus --icon assets/WPlus.ico \
  --add-data "engine.js;." --add-data "ui.js;." \
  --add-data "service/fileserver.py;." --add-data "assets/icon-64.png;assets" \
  service/wplus.py
```

<details>
<summary><strong>Project Structure</strong></summary>

```
WPlus/
├── src/                    TypeScript source
│   ├── engine.ts           Engine entry
│   ├── types.ts            Type definitions
│   ├── constants.ts        Config
│   ├── features/
│   │   ├── messages.ts     Backup & restore
│   │   ├── navigation.ts   Chat navigation
│   │   └── privacy.ts      Privacy hooks
│   └── utils/
│       ├── debug.ts        Logging
│       ├── modules.ts      WhatsApp module finder
│       ├── server.ts       File server client
│       └── storage.ts      Storage helpers
├── service/                Python backend
│   ├── wplus.py            Main entry
│   ├── injector.py         CDP injector
│   └── fileserver.py       Media server
├── engine.js + ui.js       Compiled JS
└── assets/                 Icons
```
</details>

---

## FAQ

<details>
<summary><strong>Is this safe?</strong></summary>
Yes. WPlus runs locally and never sends data externally. Source code is fully open.
</details>

<details>
<summary><strong>Will this get my account banned?</strong></summary>
WPlus only reads messages and modifies the local UI. It does not send automated messages or interact with WhatsApp servers.
</details>

<details>
<summary><strong>How do I update?</strong></summary>
WPlus checks automatically on startup. You can also right-click tray &rarr; Check for Updates.
</details>

<details>
<summary><strong>How do I uninstall?</strong></summary>
Delete WPlus.exe and the data folder. To remove the registry key run scripts/uninstall.bat or delete HKCU\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments manually.
</details>

---

## License

[MIT](LICENSE) &mdash; Free for everyone, forever.

<p align="center"><sub>Built by <a href="https://github.com/KuchiSofts">KuchiSofts</a></sub></p>
