# Security Policy

## Supported versions

Only the latest release receives security fixes. Please update before
reporting an issue.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/KuchiSofts/WPlus/security/advisories/new)

Include the WPlus version, your Windows version, and steps to reproduce.
You should get a first response within a few days. Once a fix is released the
advisory will be published and you will be credited unless you prefer
otherwise.

## What WPlus exposes on your machine

WPlus is designed to stay local. These are the parts worth knowing about when
assessing its security:

- **WebView2 remote-debugging port (127.0.0.1:9222).** WPlus injects its
  scripts into WhatsApp Desktop through the Chrome DevTools Protocol. To do
  that it sets the WebView2 policy
  `HKCU\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`
  for `WhatsApp.Root.exe` and `WhatsApp.exe` only, with
  `--remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222`.
  The port listens on the loopback interface only, and web pages cannot open
  the DevTools WebSocket. **Any program running under your Windows account
  can still use this port to control WhatsApp Desktop** — this is inherent to
  how the injection works. Run `scripts/uninstall.bat` to remove it.
- **Local file server (127.0.0.1:18733).** Stores and serves backed-up media
  for the injected scripts. It:
  - binds to 127.0.0.1 only (exclusively, so no other program can share the
    port; if 18733 is taken it uses a free port) and rejects non-local `Host` headers;
  - accepts browser requests only from `https://*.whatsapp.com` origins;
  - requires a random per-session token that the tray app injects together
    with the scripts;
  - reads and deletes files only inside the `data/` media folders.
- **Data at rest.** Saved messages and media are stored unencrypted in the
  `data/` folder next to `WPlus.exe` (or `%LOCALAPPDATA%\WPlus\data` when that
  folder is not writable). Anyone with access to your Windows
  account can read them. See [Data & privacy](README.md#data--privacy).
- **Network.** The only outbound request WPlus makes on its own is the update
  check to `api.github.com` (can be turned off in the panel).

Versions before 2.0.1 had a file server that accepted requests from any
website and a debug port enabled for every WebView2 app. Please update.
