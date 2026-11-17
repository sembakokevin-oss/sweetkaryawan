#!/usr/bin/env bash
# SWEET AI Agent Office — jalankan di Linux / WSL / macOS dengan restart otomatis.
set -u
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install --no-fund --no-audit
[ -f .env ] || { cp .env.example .env; echo "[!] .env dibuat dari .env.example — isi API key terlebih dulu."; }
mkdir -p logs
while true; do
  echo "[$(date '+%F %T')] Menjalankan SWEET AI Agent Office (Ctrl+C untuk berhenti)"
  node src/index.js
  code=$?
  [ "$code" -eq 0 ] && break
  [ "$code" -eq 130 ] && break
  echo "[$(date '+%F %T')] Server berhenti (kode $code), restart dalam 5 detik" | tee -a logs/restart.log
  sleep 5
done
