@echo off
title WPlus Installer
echo.
echo   WPlus - WhatsApp Message Protection
echo   ====================================
echo   by KuchiSofts (github.com/KuchiSofts)
echo.
echo   Enabling the debug bridge for WhatsApp Desktop only...
echo   (Windows asks for administrator permission once - WebView2 150+
echo    only honors the machine-wide policy.)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0webview2-policy.ps1"
echo   Done.
echo.
echo   Installing Python dependencies...
pip install pystray Pillow >nul 2>&1
echo   Done.
echo.
echo   Please restart WhatsApp Desktop (close fully + reopen).
echo   Then run WPlus.bat (in the project folder) to activate.
echo.
pause
