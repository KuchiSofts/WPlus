@echo off
title WPlus Installer
echo.
echo   WPlus - WhatsApp Message Protection
echo   ====================================
echo   by KuchiSofts (github.com/KuchiSofts)
echo.
echo   Enabling debug bridge for WhatsApp Desktop...
powershell -Command "New-Item -Path 'HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments' -Force -ErrorAction SilentlyContinue | Out-Null; New-ItemProperty -Path 'HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments' -Name '*' -Value '--remote-debugging-port=9222 --remote-allow-origins=*' -PropertyType String -Force -ErrorAction SilentlyContinue | Out-Null; [System.Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','--remote-debugging-port=9222 --remote-allow-origins=*','User')"
echo   Done.
echo.
echo   Installing Python dependencies...
pip install pystray Pillow >nul 2>&1
echo   Done.
echo.
echo   Please restart WhatsApp Desktop (close fully + reopen).
echo   Then run WPlus.bat to activate.
echo.
pause
