// Hapus data DEMO (pesanan & pemasukan contoh dari mode simulasi). Data Lazada asli, Lynk.id, dan laporan tidak disentuh.
// Jalankan: npm run reset-demo        (hentikan server terlebih dulu)
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
const { db } = require('../src/db');

const ids = db.prepare("SELECT order_id FROM orders WHERE source='demo'").all().map((r) => r.order_id);
const tx = db.transaction(() => {
  let inc = 0;
  for (const id of ids) inc += db.prepare('DELETE FROM income WHERE ref=?').run(`lazada:${id}`).changes;
  const ord = db.prepare("DELETE FROM orders WHERE source='demo'").run().changes;
  const notif = db.prepare("DELETE FROM notifications WHERE title LIKE '%(DEMO)%'").run().changes;
  return { ord, inc, notif };
});
const r = tx();
console.log(`Data demo dihapus: ${r.ord} pesanan, ${r.inc} pemasukan, ${r.notif} notifikasi.`);
console.log('Matikan pesanan DEMO permanen: Dashboard > Sistem > "Pesanan DEMO" (atau DEMO_ORDERS=false di .env).');
