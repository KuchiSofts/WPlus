@echo off
title WPlus Uninstaller
echo.
echo   Removing WPlus registry settings...
powershell -NoProfile -Command "$k='HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'; foreach($n in 'WhatsApp.Root.exe','WhatsApp.exe'){ Remove-ItemProperty -Path $k -Name $n -Force -ErrorAction SilentlyContinue }; $old=(Get-ItemProperty -Path $k -Name '*' -ErrorAction SilentlyContinue).'*'; if($old -like '*remote-debugging-port=9222*'){ Remove-ItemProperty -Path $k -Name '*' -Force }; if([Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','User') -like '*remote-debugging-port=9222*'){ [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS',$null,'User') }; Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'WPlus' -Force -ErrorAction SilentlyContinue"
echo   Done. Restart WhatsApp Desktop to complete removal.
echo   Your saved messages stay in the data folder - delete it manually if you no longer need them.
echo.
pause
