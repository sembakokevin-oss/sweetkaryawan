# Menghapus jadwal autostart SWEET AI Agent Office dari Task Scheduler.
$Name = 'SWEET AI Agent Office'
if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false
  Write-Host "[OK] Autostart dihapus." -ForegroundColor Green
} else { Write-Host "Autostart belum terpasang." }
