# SWEET AI Agent Office — instalasi awal (Windows PowerShell)
# Jalankan lewat scripts\setup.bat (atau: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($t) { Write-Host "`n== $t" -ForegroundColor Magenta }
function Ok($t)   { Write-Host "   [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   [!]  $t" -ForegroundColor Yellow }

Write-Host "SWEET AI Agent Office — setup" -ForegroundColor White

Step "Memeriksa Node.js"
try { $v = (node -v).Trim() } catch { $v = $null }
if (-not $v) {
  Warn "Node.js belum terpasang. Unduh versi LTS (22.x) dari https://nodejs.org lalu jalankan setup ini lagi."
  exit 1
}
$major = [int]($v.TrimStart('v').Split('.')[0])
if ($major -lt 18) { Warn "Node.js $v terlalu lama. Pasang versi 22 LTS."; exit 1 }
Ok "Node.js $v"

Step "Memasang dependensi (npm install)"
npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { Warn "npm install gagal. Periksa koneksi internet lalu ulangi."; exit 1 }
Ok "Dependensi terpasang"

Step "Menyiapkan konfigurasi"
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Ok ".env dibuat dari .env.example — isi API key & token Telegram di file .env"
} else { Ok ".env sudah ada (tidak diubah)" }
New-Item -ItemType Directory -Force -Path "data" | Out-Null
Ok "Folder data siap"

Step "Pemeriksaan sistem"
node scripts/check.js

Write-Host "`nSelesai. Jalankan scripts\start.bat lalu buka http://localhost:8080" -ForegroundColor White
