@echo off
:: WPlus — Starts the tray app from source (no console window)
:: Requires Python 3 with: pip install pystray Pillow
start "" pythonw "%~dp0service\wplus.py"
