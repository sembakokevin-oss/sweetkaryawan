// Ekspor data SWEET ke CSV (folder exports/).   Jalankan: npm run export   [opsional: jumlah hari, default 30]
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
const fs = require('fs');
const { db } = require('../src/db');

const days = Math.max(1, Number(process.argv[2]) || 30);
const since = Date.now() - days * 86400e3;
const dir = path.join(process.cwd(), 'exports');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace(/[T:]/g, '-');
const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const wib = (ms) => (ms ? new Date(ms + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') : '');

function write(name, header, rows) {
  const file = path.join(dir, `${name}_${stamp}.csv`);
  fs.writeFileSync(file, '\uFEFF' + [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n'));
  console.log(`  ${rows.length.toString().padStart(5)} baris → ${path.relative(process.cwd(), file)}`);
}

console.log(`Ekspor data ${days} hari terakhir:`);
write('pesanan', ['order_id', 'waktu', 'pembeli', 'total', 'status', 'produk', 'kurir', 'resi', 'dicetak', 'dicetak_oleh', 'sumber'],
  db.prepare('SELECT * FROM orders WHERE created_at >= ? ORDER BY created_at').all(since).map((o) => [o.order_id, wib(o.created_at), o.buyer, o.total, o.status,
    JSON.parse(o.items || '[]').map((i) => i.name).join(' | '), o.shipment_provider, o.tracking_code, wib(o.printed_at), o.printed_by, o.source]));
write('pendapatan', ['waktu', 'sumber', 'nominal', 'catatan', 'ref'],
  db.prepare('SELECT * FROM income WHERE ts >= ? ORDER BY ts').all(since).map((r) => [wib(r.ts), r.source, r.amount, r.note, r.ref]));
write('iklan', ['id', 'dibuat', 'produk', 'sku', 'tipe', 'budget', 'hari', 'harga_promo', 'status', 'hasil'],
  db.prepare('SELECT * FROM ads WHERE ts >= ? ORDER BY id').all(since).map((a) => [a.id, wib(a.ts), a.product_name, a.sku, a.type, a.budget, a.days, a.sale_price, a.status, a.result]));
write('laporan_harian', ['tanggal', 'agen', 'judul', 'isi'],
  db.prepare('SELECT * FROM reports WHERE ts >= ? ORDER BY day, agent').all(since).map((r) => [r.day, r.agent, r.title, r.content]));
write('tugas_agen', ['waktu', 'agen', 'tugas', 'sumber', 'status'],
  db.prepare('SELECT * FROM tasks WHERE ts >= ? ORDER BY id').all(since).map((t) => [wib(t.ts), t.agent, t.title, t.source, t.status]));
console.log('Selesai. File CSV bisa dibuka di Excel / Google Sheets.');
