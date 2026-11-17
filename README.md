# SWEET AI Agent Office (SweetOffice.com)

Kantor virtual berisi 16 karyawan AI (1 agen = 1 kerjaan) milik **Bos Kevin**.
Tim produk membangun aplikasi dari satu ide, tim toko mengurus **Lazada**, agent #16 trading emas **XAUUSD** 24 jam di akun HFM MetaTrader 5, semua bisa diperintah dari **website** dan **Telegram**.

## Menjalankan (Windows)
```
scripts\setup.bat   # sekali saja: cek Node.js, npm install, siapkan .env, pemeriksaan sistem
scripts\start.bat   # menjalankan server (restart otomatis bila berhenti)
```
Atau lewat npm: `npm install`, `npm run check`, `npm start`. Semua alat bantu ada di folder `scripts/` (lihat `scripts/README.md`).
| Halaman | Alamat | Isi |
|---|---|---|
| Beranda | http://localhost:8080/ | ringkasan live, tim |
| Office | http://localhost:8080/office | kantor 3D, slide ruangan (‹ ›), klik agen = detail & beri tugas, rapat/istirahat |
| Ruang Agen | http://localhost:8080/ruangan | slide tiap ruangan agen: profil, kerjaan, hasil, aktivitas, perintah |
| Stay Home | http://localhost:8080/stayhome | rumah agen 3D di luar jam kerja: 8 kamar (1 kamar = 1 kasur = 2 agen), ruang TV, dapur & kopi, ruang belajar, taman |
| Trading | http://localhost:8080/trading | Trading Terminal & Performance agent Aurel: ekuitas, PnL floating & terealisasi, return 24j/7h/30h, grafik PnL/ekuitas/ROI, kalender PnL, alokasi, posisi aktif, order limit, riwayat order, fills, jurnal, pengaturan & STOP darurat |
| Dashboard | http://localhost:8080/dashboard | pendapatan, checkout live + resi, produk & stok, iklan (tinggal Terima), Lynk.id, pusat perintah, proyek, rapat, chat, log, sistem |

## Akun & login
- Semua halaman wajib login. Daftar di `/register` hanya dengan **Gmail asli**: kode OTP 6 digit dikirim ke inbox Gmail dan harus dimasukkan sebelum akun dibuat (email palsu tidak akan menerima kode). Ada juga lupa kata sandi lewat OTP.
- **Admin** (kontrol penuh) dibuat dari `ADMIN_EMAIL` / `ADMIN_PASSWORD` di `.env`; kata sandinya otomatis dihapus dari `.env` setelah tersimpan ter-hash di database. Pengguna lain berstatus **lihat saja**; admin bisa menjadikan admin / menonaktifkan / menghapus di Dashboard › Pengguna.
- Pengiriman OTP memakai Gmail SMTP: isi `SMTP_USER` (Gmail pengirim) dan `SMTP_PASS` (**App Password** 16 huruf — aktifkan Verifikasi 2 Langkah lalu buat di https://myaccount.google.com/apppasswords). Uji di Dashboard › Pengguna › Kirim tes.

## Tim
**Produk & Engineering:** #1 Kamala (PM: pecah ide → Login, Chat, Payment, Profile, Notif) · #2 Indra (Architect: data/ domain/ presentation/ lib/) · #3 Nadine (Designer: alur & tampilan) · #4 Felix (Mobile) & #5 Norman (Backend) — kerja barengan, 1 kontrak API · #6 Nola (Database: tabel tanpa dobel) · #7 Wucing (QA: cari bug) · #8 Raka (Security: cek celah) · #9 Robo (DevOps: build & deploy) · #10 Chelsea (Tech Lead: review, yang jelek dikembalikan).

**Toko Lazada:** #11 Sari (CS chat) · #12 Dimas (Order & Resi) · #13 Bayu (Stok & Harga) · #14 Mira (Iklan, jalan setelah Bos tekan Terima) · #15 Tomi (Analis).

**Trading (tambang emas, 24 jam):** #16 Aurel (XAUUSD Trader).

## Trading XAUUSD — agent Aurel di tambang emas
- Akun: HFM Cent, MetaTrader 5. Login/server/password disimpan di `.env` (`MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER`, `MT5_NICKNAME`). Password **tidak pernah** dikirim ke browser; papan di tambang hanya menampilkan `••••••`.
- Koneksi: server SWEET menyalakan `scripts/mt5_bridge.py` (paket resmi Python `MetaTrader5`, khusus Windows) di `127.0.0.1:MT5_BRIDGE_PORT` dengan kunci `MT5_BRIDGE_KEY`. Sekali pasang: `scripts\mt5-install.bat`, pasang terminal MetaTrader 5 HFM, login sekali + aktifkan Algo Trading, lalu `scripts\start.bat`. Manual: `scripts\mt5-start.bat`.
- Harga, saldo, dan order **hanya** dari harga pasar broker HFM (MT5). Tidak ada sumber harga lain. Selama bridge belum terhubung, Aurel berhenti dan `/trading` menampilkan status OFFLINE.
- Strategi (tiap 15 detik, timeframe `TRADING_TF`, default M15): tren dari EMA20/EMA50 + kemiringan, entry koreksi dengan **Buy Limit** (tren naik) atau **Sell Limit** (tren turun), SL 1.5 ATR, TP 2.2 ATR, order kedaluwarsa 4 jam, dibatalkan bila tren berbalik. Opsional review AI (Claude/Gemini/Hermes) sebelum order.
- Harga realtime: kartu **Harga XAUUSD Realtime** di `/trading` — candlestick M1/M5/M15/H1/H4, EMA20/EMA50, garis Buy/Sell Limit, entry, SL & TP, harga bergerak tiap ±1 detik (SSE). Sumber: harga pasar XAUUSD broker HFM lewat MetaTrader 5 (akun cent).
- Belajar candle: setiap candle yang selesai dicatat polanya (engulfing, hammer, shooting star, doji, inside bar, marubozu) + tren, lalu dinilai hasilnya 4 candle kemudian. Statistik peluang naik & rata-rata gerak (ATR) per pola tersimpan di database (`trade_learn`, terpisah per sumber harga), tampil di `/trading`, masuk jurnal, dan dipakai Aurel: setup yang menurut statistik (≥20 sampel) peluangnya di bawah 42% ditahan.
- SnR & Order Block: Aurel mendeteksi Support/Resistance (swing high/low yang dikelompokkan, M15 + H1, makin sering disentuh makin kuat) dan Order Block (candle berlawanan terakhir sebelum gerakan impulsif ≥1.5 ATR yang menembus struktur; status fresh → diuji → tembus). Setiap sentuhan zona dipelajari: memantul (≥1.2 ATR menjauh) atau ditembus dalam 8 candle, disimpan per jenis zona + tren. Saat memasang Buy/Sell Limit, entry & SL ditempatkan di zona terbaik (support / OB bull untuk buy, resistance / OB bear untuk sell) yang peluang pantulnya ≥45%, TP dibatasi sebelum zona berlawanan; bila ruang ke zona berlawanan terlalu sempit, order ditahan. Zona tampil di grafik `/trading` (garis S/R dengan jumlah sentuhan, kotak OB) dan tabel pelajarannya di bawah grafik.
- Saldo: Aurel hanya memasang order bila akun punya saldo. Saldo kosong / habis (ekuitas di bawah `TRADING_MIN_BALANCE_USD`, default $5 = 500 USC di akun cent) → order limit dibatalkan, tidak ada order baru, meja Aurel memasang tanda **$** dan /trading menampilkan peringatan. Begitu saldo masuk, Aurel otomatis mulai trading XAUUSD lagi (simbol emas akun cent dideteksi otomatis, atau isi `MT5_SYMBOL`).
- Risiko: lot default 0.01 (maks `TRADING_MAX_LOT`, default 0.05), maks 1 order limit & 1 posisi, batas rugi harian 5% (order baru berhenti sampai besok), setiap order wajib SL & TP, hanya mengelola order ber-magic 160016 (order manual tidak disentuh). Admin bisa ubah di `/trading` atau tekan **STOP darurat**.
- Kantor 3D: tambang emas di timur kantor (pintu samping) — goa, rel & lori emas yang didorong penambang Ujang keluar-masuk goa dan menuang emas ke tumpukan, meja gaming Aurel dengan **bendera BUY LIMIT / SELL LIMIT** + teks di atasnya, papan akun, layar grafik XAUUSD. Bos Kevin keliling kantor & tambang memantau sambil mengejek; 2 security bersenjata (Bima & Joko) patroli memutari kantor dan tambang.
- Bukan nasihat keuangan: trading emas berisiko kehilangan modal; mulai dari lot terkecil.

## Alur kerja meja & jam kantor
Setiap agen di mejanya (PC gaming, monitor gaming lengkung, kursi gaming, printer resi) mengikuti alur:
jam kerja 05:00 → memantau PC → cek toko Lazada → print resi (jika ada pembeli) → cek promosi produk (habis = tanda **$**) → print resi (resi otomatis masuk dashboard) → menunggu keputusan → tanda **!** mendesak + meja berkedip → 19:00 jam kerja habis, setiap agen membuat laporan harian (masuk Dashboard › Laporan Harian).

- Jam kerja **05:00–19:00 WIB**, 12:00 istirahat (Lounge), 19:00 laporan harian, 19:30 agen pulang ke **Stay Home**. **20:00–04:00 kantor tutup**: tidak ada cetak resi, pesanan tidak disinkron/diproses (diproses saat buka 04:00), agen tidur/ngopi/belajar/ngobrol di rumah. Jam dinding analog berputar, malam hari kantor gelap dan lampu menyala.
- **Timelapse** 1x / 60x / 300x / 900x dan tombol lompat jam (Pagi, Siang, Sore, Malam) di halaman Office, Dashboard › Sistem, atau Telegram `/timelapse 300`, `/lompat 18:58`.
- Nominal uang tampil di kantor: papan pendapatan, uang melayang "+Rp" di meja Dimas setiap checkout.
- Matikan/nyalakan di Dashboard › Sistem: jadwal otomatis, alur kerja meja, print resi otomatis, auto-pack, auto-balas chat.

## EXPLORE NOW (halaman Office)
Tombol **EXPLORE NOW** di `/office` (atau buka `/office#explore`):
- **Camera Movement** — kamera bebas (WASD geser, Q/E putar, R/F sudut, tahan klik kanan untuk rotate, scroll zoom).
- **POI Camera** — lompat otomatis tiap 9 detik ke titik menarik (ruang Bos, rapat, lounge, tiap meja agen, gerbang & goa tambang, lori emas, meja Aurel, papan akun, ikuti Bos / security), tombol ‹ › dan Auto.
- **Drone FPV** — klik layar untuk kendali mouse (pointer lock), WASD terbang, Space/E naik, Q/C turun, Shift boost, scroll = kecepatan, ESC menampilkan mouse.
- **TOUR 3 Menit** — tur sinematik otomatis dengan keterangan dan progress bar.
- **Jalan-jalan sebagai karakter** — pilih **Kama Pinkypie** atau **Satria Garuda Hitam**, isi nama pengunjung (wajib), lalu **MASUK KANTOR**. WASD jalan, Shift lari, klik kanan sekali = jalan ke titik itu, tahan klik kanan = rotate kamera, scroll zoom, F pukul (SFX disintesis WebAudio), E lihat kerjaan agen terdekat, Enter chat (tampil di atas kepala). Bisa naik tangga ke lantai atas, menembus pintu samping ke tambang emas; dinding tidak bisa ditembus.
- **Co-op / multiplayer** — semua pengguna yang login dan sedang jalan-jalan saling terlihat (nama di atas kepala, gerakan, pukulan, chat) lewat SSE; tombol Hi-Resolution Mode dan suara di pojok kanan bawah.

## Stay Home
Mulai 19:30 agen pulang ke rumah (`/stayhome`) dan bergerak sendiri dengan animasi idle: tidur di kasur (berdua per kamar, lampu kamar mati bila keduanya tidur), santai main HP di kamar, ngopi di dapur, belajar & baca buku, nonton TV, main game, ngobrol berdua (balon obrolan bergantian), dan jalan-jalan keliling taman. Aktivitas mengikuti jam: sore ramai ngopi/ngobrol, lewat 23:00 hampir semua tidur, 03:30 bangun ngopi, 04:00 berangkat ke kantor. Agen yang masih mengerjakan tugas Bos tetap "lembur" di kantor. Panel kanan menampilkan isi tiap kamar; klik kamar / agen untuk fokus.

## AI
Hermes Agent dinyalakan otomatis oleh server (`hermes gateway`, kunci = `HERMES_API_KEY`). Belum terpasang? Jalankan `scripts\hermes-install.bat` sekali (WSL2), lalu `hermes setup` untuk memilih model.

`AI_PROVIDER=claude` (utama) dengan cadangan Gemini dan Hermes. `CLAUDE_MODEL` kosong = otomatis memilih model Sonnet terbaru untuk API key-mu.
Agen toko memakai *tool* (data pesanan, produk, chat, iklan) — hanya tool sesuai kerjaannya.

## Database
SQLite di `data/sweet.db` (pesanan, pemasukan, produk, iklan, tugas, aktivitas, proyek, rapat & notulen, perintah, notifikasi).
Memakai `better-sqlite3`; jika tidak terpasang, otomatis memakai SQLite bawaan Node 22.13+.

## Lazada
1. Buat aplikasi di https://open.lazada.com → isi `LAZADA_APP_KEY` & `LAZADA_APP_SECRET`.
2. Daftarkan Callback URL `http://localhost:8080/lazada/callback`.
3. Dashboard › Sistem › **Otorisasi toko Lazada** (atau `/otorisasi` di Telegram).
Tanpa ini sistem berjalan di **mode simulasi** dengan pesanan DEMO.
Fitur: sinkron pesanan + resi, pack, siap kirim, label resi, sinkron produk, ubah harga/stok, chat pembeli, harga promo (iklan diskon).

## Seller Center (cookies)
Dashboard › Sistem › **Upload cookies.txt** — tersimpan permanen di database (tetap ada setelah restart), User-Agent browser ikut disimpan (atau `npm run cookies -- "C:\path\cookies.txt"`). Ekspor cookies saat login di sellercenter.lazada.co.id memakai ekstensi browser (Netscape cookies.txt / JSON). Sistem menyimpan file di komputer ini dan mengecek apakah sesi masih login. Data pesanan resmi tetap lewat Lazada Open Platform.

## Lynk.id
Lynk.id tidak punya API publik, jadi penghasilan dicatat lewat: input manual (`/lynk 150000 ebook`), **impor CSV** ekspor transaksi Lynk.id di Dashboard › Pendapatan, atau webhook `POST /api/lynk/webhook?secret=LYNK_WEBHOOK_SECRET` (`{"amount":150000,"note":"Ebook","id":"INV1"}`). Transaksi dengan id sama tidak dobel.

## Telegram (khusus pemilik)
Ketik `/bantuan`. Yang utama:
- **Jam:** `/jam` `/timelapse 1|60|300|900` `/lompat HH:MM` `/laporan_harian [tanggal]` `/resi_cetak`
- **Kantor:** `/menu` `/status` `/web` `/rapat [topik]` (agen berkumpul & melapor bergiliran, notulen dikirim) · `/bubar` (kesimpulan + action item yang langsung dikerjakan) · `/notulen` `/rapat_list` `/istirahat` `/kerja`
- **Agen:** `/agen [nama]` `/tugas @agen perintah` `/tim dev|toko perintah` `/semua perintah` `/kerjaan @agen`
- **Proyek:** `/proyek <ide>` `/proyek_status` `/proyek_list` `/hasil <id> <tahap>`
- **Toko:** `/pesanan` `/resi` `/pack <id>` `/rts <id>` `/pendapatan` `/laporan` `/terlaris` `/pembeli` `/produk` `/stok` `/harga <sku> <harga>` `/setstok <sku> <jml>` `/chat` `/balas` `/iklan <produk>` `/iklan_list` `/terima` `/tolak` `/sync`
- **Lainnya:** `/lynk` `/lynk_cek` `/rekrut` `/pecat` `/ai` `/set` `/pengaturan` `/otorisasi` `/sesi` `/notif`

## Keamanan
- `.env` berisi API key — jangan dibagikan / di-upload (sudah di `.gitignore`).
- Server default hanya bisa dibuka dari komputer ini (`HOST=127.0.0.1`). Jika dibuka ke jaringan, isi `DASHBOARD_PASSWORD`.
- `cookies.txt` hanya dipakai untuk cek sesi Seller Center, isinya tidak pernah ditampilkan.

## Struktur
```
src/index.js            entry: server + bot + autopilot + kerja otomatis
src/db/                 database SQLite & pengaturan
src/agents/config.js    15 agen, furnitur ruangan, tata letak kantor
src/state/officeState.js status agen realtime, mode kerja/rapat/istirahat, rekrutmen
src/ai/                 llm.js (Claude/Gemini/Hermes), engine.js (agen + tools), tools.js
src/state/clock.js      jam kantor WIB + timelapse + fase (pagi/kerja/istirahat/laporan/malam)
src/jobs/               autopilot (Lazada), pipeline (proyek 10 agen), meeting (rapat), shift (alur kerja meja + laporan harian)
src/services/           lazada, orders (pack/RTS/cetak resi), ads, stats, lynk, notify (SSE + Telegram), lazadaSession
scripts/                setup, start/stop, check, export CSV, import cookies, reset demo, autostart Windows
src/server/index.js     halaman + REST API + SSE
src/bot/telegram.js     bot Telegram
office_full.html        halaman Office
web/                    beranda, dashboard, ruangan, shared.css/js, js/office3d.js
```
