// Pasang cookies.txt Seller Center dari file hasil ekspor browser, lalu cek sesinya.
// Jalankan: npm run cookies -- "C:\Users\User\Downloads\cookies.txt"
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
const fs = require('fs');
const session = require('../src/services/lazadaSession');

(async () => {
  const src = process.argv[2];
  if (!src) { console.log('Pemakaian: npm run cookies -- <path file cookies.txt / .json>\nAtau upload langsung di Dashboard > Sistem > Seller Center.'); process.exit(1); }
  if (!fs.existsSync(src)) { console.error(`File tidak ditemukan: ${src}`); process.exit(1); }
  try {
    const r = session.save(fs.readFileSync(src, 'utf8'), { ua: process.env.LAZADA_COOKIES_UA || '', by: 'skrip import-cookies' });
    console.log(`Tersimpan permanen di database: ${r.cookies} cookie Lazada (dari ${r.total} cookie).`);
    const c = await session.check();
    console.log(c.ok ? `Sesi Seller Center aktif — ${c.reason}` : `Sesi belum aktif — ${c.reason}`);
    process.exit(c.ok ? 0 : 2);
  } catch (e) { console.error('Gagal: ' + e.message); process.exit(1); }
})();
