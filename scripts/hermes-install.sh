#!/usr/bin/env bash
# Pasang & siapkan Hermes Agent (NousResearch) untuk SWEET — Linux / macOS / WSL2.
#   bash scripts/hermes-install.sh            pasang Hermes (installer resmi) lalu aktifkan API server
#   bash scripts/hermes-install.sh --config   hanya aktifkan API server (Hermes sudah terpasang)
# Kunci API server diambil dari HERMES_KEY (dikirim oleh hermes-install.ps1) atau dari .env proyek.
set -euo pipefail
INSTALL_URL="https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
KEY="${HERMES_KEY:-}"
if [ -z "$KEY" ] && [ -f "$HERE/../.env" ]; then KEY="$(grep -E '^HERMES_API_KEY=' "$HERE/../.env" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^"//;s/"$//')"; fi
export PATH="$HOME/.local/bin:$HOME/.hermes/bin:$PATH"

configure() {
  [ -n "$KEY" ] || { echo "HERMES_API_KEY kosong di .env proyek."; exit 1; }
  mkdir -p "$HOME/.hermes"
  touch "$HOME/.hermes/.env"
  for kv in "API_SERVER_ENABLED=true" "API_SERVER_KEY=$KEY" "API_SERVER_HOST=127.0.0.1" "API_SERVER_PORT=8642"; do
    k="${kv%%=*}"
    if grep -q "^$k=" "$HOME/.hermes/.env"; then sed -i "s|^$k=.*|$kv|" "$HOME/.hermes/.env"; else echo "$kv" >> "$HOME/.hermes/.env"; fi
  done
  chmod 600 "$HOME/.hermes/.env"
  echo "[OK] API server Hermes diaktifkan di ~/.hermes/.env (port 8642, kunci = HERMES_API_KEY proyek)."
}

if [ "${1:-}" != "--config" ]; then
  if command -v hermes >/dev/null 2>&1; then
    echo "[OK] Hermes sudah terpasang: $(command -v hermes)"
  else
    command -v curl >/dev/null 2>&1 || { echo "curl belum terpasang (sudo apt install curl)."; exit 1; }
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
    echo "Mengunduh installer resmi Hermes: $INSTALL_URL"
    curl -fsSL -o "$TMP/install.sh" "$INSTALL_URL"
    read -r -p "Jalankan installer Hermes sekarang? [y/N] " ans
    case "${ans:-N}" in y|Y) bash "$TMP/install.sh" ;; *) echo "Dibatalkan."; exit 0 ;; esac
    export PATH="$HOME/.local/bin:$HOME/.hermes/bin:$PATH"
  fi
fi
configure
cat <<'TXT'

Langkah berikutnya (sekali saja):
  1. Pilih model / penyedia AI untuk Hermes:   hermes setup     (atau: hermes model)
  2. Jalankan server SWEET (scripts\start.bat). SWEET akan menyalakan "hermes gateway" otomatis.
     Manual: hermes gateway      Cek: curl -s http://127.0.0.1:8642/health
TXT
