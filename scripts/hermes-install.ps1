# Pasang Hermes Agent di WSL2 dan hubungkan ke SWEET (kunci dari .env proyek).
#   powershell -ExecutionPolicy Bypass -File scripts\hermes-install.ps1            pasang + konfigurasi
#   powershell -ExecutionPolicy Bypass -File scripts\hermes-install.ps1 --config   konfigurasi saja
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  Write-Host '[X] WSL belum tersedia. Buka PowerShell sebagai Administrator, jalankan:  wsl --install' -ForegroundColor Red
  Write-Host '    Restart komputer, buat user Ubuntu, lalu jalankan skrip ini lagi.'
  exit 1
}
$distros = (wsl.exe -l -q 2>$null) -replace "`0", '' | Where-Object { $_.Trim() }
if (-not $distros) { Write-Host '[X] WSL belum punya distro. Jalankan:  wsl --install -d Ubuntu' -ForegroundColor Red; exit 1 }

$key = ''
$envFile = Join-Path $Root '.env'
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^HERMES_API_KEY=' } | Select-Object -First 1
  if ($line) { $key = ($line -replace '^HERMES_API_KEY=', '').Trim().Trim('"') }
}
if (-not $key) { Write-Host '[X] HERMES_API_KEY kosong di .env' -ForegroundColor Red; exit 1 }

$script = Join-Path $PSScriptRoot 'hermes-install.sh'
$wslPath = (wsl.exe -e wslpath -a "$script").Trim()
$env:HERMES_KEY = $key
$env:WSLENV = 'HERMES_KEY'
Write-Host "[*] Menjalankan di WSL2: $wslPath" -ForegroundColor Cyan
wsl.exe -e bash "$wslPath" @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ''
Write-Host '[OK] Selesai. Restart server SWEET (scripts\start.bat) — Hermes akan dinyalakan otomatis.' -ForegroundColor Green
