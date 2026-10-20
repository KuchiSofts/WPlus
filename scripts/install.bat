@echo off
title WPlus Installer
echo.
echo   WPlus - WhatsApp Message Protection
echo   ====================================
echo   by KuchiSofts (github.com/KuchiSofts)
echo.
echo   Enabling the debug bridge for WhatsApp Desktop only...
powershell -NoProfile -Command "$k='HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'; $v='--remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222'; New-Item -Path $k -Force -ErrorAction SilentlyContinue | Out-Null; foreach($n in 'WhatsApp.Root.exe','WhatsApp.exe'){ New-ItemProperty -Path $k -Name $n -Value $v -PropertyType String -Force | Out-Null }; $old=(Get-ItemProperty -Path $k -Name '*' -ErrorAction SilentlyContinue).'*'; if($old -like '*remote-debugging-port=9222*'){ Remove-ItemProperty -Path $k -Name '*' -Force }; if([Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','User') -like '*remote-debugging-port=9222*'){ [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS',$null,'User') }"
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
