# Jalankan SWEET AI Agent Office otomatis setiap kali login Windows (Task Scheduler, tanpa hak admin).
# Pemakaian: klik kanan > Run with PowerShell, atau: powershell -ExecutionPolicy Bypass -File scripts\autostart-install.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Name = 'SWEET AI Agent Office'
$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Root\scripts\start.bat`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Settings $Settings -Description 'Server kantor AI SWEET (dashboard, office, bot Telegram)' -Force | Out-Null
Write-Host "[OK] '$Name' akan berjalan otomatis saat login." -ForegroundColor Green
Write-Host "     Hapus dengan: scripts\autostart-remove.ps1"
