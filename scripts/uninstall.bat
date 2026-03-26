@echo off
title WPlus Uninstaller
echo.
echo   Removing WPlus...
powershell -Command "Remove-ItemProperty -Path 'HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments' -Name '*' -Force -ErrorAction SilentlyContinue; [System.Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','','User')"
echo   Done. Restart WhatsApp Desktop to complete removal.
echo.
pause
