# scripts/ — alat bantu SWEET AI Agent Office

| File | Fungsi |
|---|---|
| `setup.bat` / `setup.ps1` | Instalasi awal: cek Node.js, `npm install`, buat `.env` dari `.env.example`, folder `data`, lalu pemeriksaan sistem |
| `start.bat` | Menjalankan server dengan **restart otomatis** bila berhenti (log restart di `logs/restart.log`) |
| `stop.bat [port]` | Menghentikan server yang berjalan di port (default 8080) |
| `dev.bat` | Mode pengembangan — server restart otomatis setiap file `src/` diubah |
| `check.bat` / `check.js` | Pemeriksaan lengkap: Node, dependensi, database, port, Claude/Gemini/Hermes, Telegram, Lazada, cookies.txt |
| `open.bat [halaman]` | Membuka `dashboard` (default), `office`, `ruangan`, atau `beranda` di browser |
| `export.bat [hari]` / `export.js` | Ekspor pesanan, pendapatan, iklan, laporan harian, dan tugas agen ke CSV (`exports/`) |
| `import-cookies.js` | Memasang cookies.txt Seller Center dari file: `npm run cookies -- "C:\path\cookies.txt"` |
| `reset-demo.js` | Menghapus pesanan & pemasukan DEMO (mode simulasi). Hentikan server dulu |
| `autostart-install.ps1` | Server berjalan otomatis saat login Windows (Task Scheduler, tanpa admin) |
| `autostart-remove.ps1` | Menghapus autostart |
| `hermes-install.bat` / `.ps1` / `.sh` | Pasang Hermes Agent di WSL2 dan aktifkan API server dengan kunci `HERMES_API_KEY` dari .env |
| `hermes-start.bat` | Menjalankan `hermes gateway` manual (biasanya otomatis dinyalakan server SWEET) |
| `mt5-install.bat` | Sekali saja: memasang paket Python `MetaTrader5` untuk agent trading Aurel (butuh Python 3 64-bit + terminal MetaTrader 5 HFM) |
| `mt5-start.bat` | Menjalankan jembatan MetaTrader 5 (`mt5_bridge.py`) manual — biasanya otomatis dinyalakan server SWEET |
| `mt5_bridge.py` | Jembatan lokal 127.0.0.1 antara server SWEET dan terminal MT5 (akun, harga, order Buy/Sell Limit, riwayat) |
| `start.sh` | Menjalankan di Linux / WSL / macOS dengan restart otomatis |

Perintah npm yang setara: `npm run setup`, `npm start`, `npm run dev`, `npm run check`, `npm run export`, `npm run reset-demo`, `npm run cookies -- <file>`.
