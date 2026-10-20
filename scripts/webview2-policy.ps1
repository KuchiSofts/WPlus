# Opens (or with -Remove, closes) the WebView2 debug port for WhatsApp Desktop only.
# WebView2 150+ ignores the per-user policy in many setups, so the machine-wide (HKLM)
# policy is written too; this needs administrator rights, so the script elevates itself.
param([switch]$Remove, [switch]$MachineOnly)

$sub   = 'Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
$names = 'WhatsApp.Root.exe', 'WhatsApp.exe'
$args9222 = '--remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222'

function Set-Policy($root) {
    $k = "${root}:\$sub"
    if ($Remove) {
        foreach ($n in $names) { Remove-ItemProperty -Path $k -Name $n -Force -ErrorAction SilentlyContinue }
    } else {
        New-Item -Path $k -Force -ErrorAction SilentlyContinue | Out-Null
        foreach ($n in $names) { New-ItemProperty -Path $k -Name $n -Value $args9222 -PropertyType String -Force | Out-Null }
    }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if ($MachineOnly) { Set-Policy 'HKLM'; exit }

# Machine-wide policy (one UAC prompt when not already elevated)
if ($isAdmin) { Set-Policy 'HKLM' }
else {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-MachineOnly')
    if ($Remove) { $a += '-Remove' }
    try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList $a }
    catch { Write-Host '  Administrator permission was declined - using the per-user policy only.' }
}

# Per-user policy (fallback for older WebView2 runtimes)
Set-Policy 'HKCU'

# Clean up the global values written by WPlus versions before 2.0.1 (applied to ALL WebView2 apps)
$k = "HKCU:\$sub"
$old = (Get-ItemProperty -Path $k -Name '*' -ErrorAction SilentlyContinue).'*'
if ($old -like '*remote-debugging-port=9222*') { Remove-ItemProperty -Path $k -Name '*' -Force }
if ([Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', 'User') -like '*remote-debugging-port=9222*') {
    [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $null, 'User')
}
if ($Remove) {
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'WPlus' -Force -ErrorAction SilentlyContinue
}
