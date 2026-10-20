# Third-Party Notices

WPlus itself is licensed under the [MIT License](LICENSE).

The release build (`WPlus.exe`) is produced with PyInstaller and bundles the
components below. Running from source uses the same libraries, installed with
`pip install pystray Pillow`.

| Component | Used for | License | Source |
|-----------|----------|---------|--------|
| [Python](https://www.python.org/) runtime and standard library | Tray app, file server | PSF License Agreement (PSF-2.0) | https://github.com/python/cpython |
| [Pillow](https://python-pillow.org/) | Tray icon image | MIT-CMU (HPND) | https://github.com/python-pillow/Pillow |
| [pystray](https://github.com/moses-palmer/pystray) | System tray icon and menu | LGPL-3.0 | https://github.com/moses-palmer/pystray |
| [six](https://github.com/benjaminp/six) (pystray dependency) | Python 2/3 compatibility | MIT | https://github.com/benjaminp/six |
| [PyInstaller](https://pyinstaller.org/) bootloader | Packaging `WPlus.exe` | GPL-2.0-or-later with the PyInstaller bootloader exception | https://github.com/pyinstaller/pyinstaller |

Notes:

- **pystray (LGPL-3.0):** pystray is used unmodified. Its complete source code
  is available at the link above. You can use WPlus with a different or
  modified version of pystray by running it from source
  (see [Run from source](README.md#run-from-source)).
- **PyInstaller:** the bootloader exception allows distributing the bundled
  executable under the application's own license (MIT for WPlus).
- License identifiers for Pillow were taken from the installed package
  metadata; the others are as published by each project on PyPI / GitHub.
  Refer to each project for the full license text.

WPlus does not include any code from WhatsApp, Meta, or Microsoft. At runtime
it talks to the Microsoft Edge WebView2 runtime that WhatsApp Desktop already
uses; WebView2 is not redistributed with WPlus.
