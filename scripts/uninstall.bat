@echo off
title WPlus Uninstaller
echo.
echo   Removing WPlus registry settings...
echo   (Windows asks for administrator permission to remove the machine-wide policy.)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0webview2-policy.ps1" -Remove
echo   Done. Restart WhatsApp Desktop to complete removal.
echo   Your saved messages stay in the data folder - delete it manually if you no longer need them.
echo.
pause
