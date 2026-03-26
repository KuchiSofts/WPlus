<p align="center">
  <img src="https://img.shields.io/badge/WPlus-v2.0-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WPlus">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT License">
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
</p>

<h1 align="center">WPlus</h1>
<p align="center"><strong>Message protection & privacy toolkit for WhatsApp Desktop</strong></p>
<p align="center">Free, open source, no accounts, no servers, no tracking.</p>

---

## Features

| Feature | Description |
|---------|-------------|
| **Deleted Messages** | Saves incoming messages. If deleted, view the original content with media. |
| **Force Restore** | Shield icon in chat header — loads full history and restores all deleted messages. |
| **Blur Messages** | Blur text in conversations. Hover to reveal. |
| **Blur Contacts** | Hide names everywhere — sidebar, header, inside messages. |
| **Blur Photos** | Blur profile pictures. Hover to reveal. |
| **Hide Typing** | Others can't see you typing. |
| **Hide Online** | Appear offline while using WhatsApp. |
| **No Read Receipts** | Disable blue ticks. |
| **Private Audio** | Listen to voice messages without notifying sender. |
| **Export Contacts** | Download all contacts as CSV. |
| **Chat Statistics** | View chat analytics and top conversations. |
| **Load Older Messages** | Scroll-up button to load chat history. |
| **Media Viewer** | Fullscreen image viewer with zoom, video player with volume control. |
| **Message Preview** | Click saved messages to preview content without navigating. |
| **Debug System** | Full event logging for troubleshooting. |

## Installation

### Requirements
- **WhatsApp Desktop** (Microsoft Store)
- **Python 3.10+** with `pystray` and `Pillow`
- **Node.js 18+** (for building from TypeScript source)
- **Windows 10/11**

### Quick Start

```bash
git clone https://github.com/KuchiSofts/WPlus.git
cd WPlus
scripts\install.bat     # First-time setup (one time only)
# Restart WhatsApp Desktop
WPlus.bat               # Start the tray service
```

### Building from Source

```bash
npm install
npm run build           # Compiles src/ → dist/
```

## Architecture

```
WPlus/
├── src/                          # TypeScript source
│   ├── engine.ts                 # Main engine entry
│   ├── ui.ts                     # UI entry (WIP)
│   ├── types.ts                  # Type definitions
│   ├── constants.ts              # Config & selectors
│   ├── features/
│   │   ├── messages.ts           # Message backup & restore
│   │   ├── navigation.ts         # Chat navigation & history loading
│   │   └── privacy.ts            # Blur, typing, online, receipts
│   └── utils/
│       ├── debug.ts              # Debug logging
│       ├── modules.ts            # WhatsApp module finder
│       ├── server.ts             # File server client
│       └── storage.ts            # localStorage helpers
├── engine.js                     # Compiled engine (injected into WhatsApp)
├── ui.js                         # Compiled UI (injected into WhatsApp)
├── service/                      # Python backend
│   ├── wplus_service.pyw         # System tray service
│   ├── injector.py               # CDP injector (CLI)
│   └── fileserver.py             # Local HTTP server for media
├── scripts/
│   ├── install.bat               # First-time setup
│   └── uninstall.bat             # Remove WPlus
├── data/                         # User data (gitignored)
│   ├── Images/                   # Saved image files
│   ├── Videos/                   # Saved video files
│   ├── Sounds/                   # Saved audio files
│   ├── Docs/                     # Saved documents
│   ├── deleted_messages.json     # Permanent deleted message archive
│   └── new_messages.json         # Rolling 24h message backup
├── WPlus.bat                     # One-click launcher
├── tsconfig.json
├── build.mjs
└── package.json
```

### How It Works

```
WhatsApp Desktop (WebView2)
    │ CDP (Chrome DevTools Protocol)
    │
├── engine.js    Hooks into WhatsApp's internal modules:
│                ChatCollection, Msg events, Composing,
│                Presence, ConversationSeen, ChatLoadMessages
│
├── ui.js        Settings panel (matches WhatsApp's native design),
│                deleted messages viewer, media viewer, debug panel
│
└── service/     Python tray service:
    ├── Auto-detects WhatsApp process
    ├── Injects engine.js + ui.js via CDP
    ├── Syncs data to disk every 5 seconds
    ├── Saves media to organized folders
    ├── Uninjects cleanly on exit
    └── Re-injects on WhatsApp restart
```

### Privacy

- All data stored locally — never sent anywhere
- No external servers, analytics, or telemetry
- No accounts or registration
- Media saved to local folders only
- Privacy hooks use WhatsApp's own internal APIs

## Uninstall

```bash
scripts\uninstall.bat
# Restart WhatsApp Desktop
```

## Contributing

1. Fork this repository
2. `npm install` and `npm run build`
3. Edit TypeScript in `src/`
4. Test with `python service/injector.py`
5. Submit a PR

## Credits

Developed by **[KuchiSofts](https://github.com/KuchiSofts)**.

<p align="center"><sub>MIT License — Free for everyone, forever.</sub></p>
