// Penghasilan Lynk.id.
// Lynk.id tidak menyediakan API publik yang terverifikasi, jadi ada 3 jalur pencatatan:
//  1) Input manual (dashboard / Telegram /lynk 150000 catatan)
//  2) Impor CSV hasil ekspor transaksi dari dashboard lynk.id (kolom tanggal/nominal dideteksi otomatis)
//  3) Webhook: POST /api/lynk/webhook?secret=LYNK_WEBHOOK_SECRET  body JSON { amount, note, id }  (mis. dari Zapier/Make/email parser)
const { db, log } = require('../db');
const { notify } = require('./notify');

const rp = (n) => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const toNumber = (v) => Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;

function record({ amount, note = 'Lynk.id', ref = null, ts = Date.now(), silent = false }) {
  const v = toNumber(amount);
  if (!v) throw new Error('Nominal tidak valid');
  const r = db.prepare('INSERT OR IGNORE INTO income(ts,source,amount,note,ref) VALUES(?,?,?,?,?)').run(ts, 'lynk', v, String(note).slice(0, 200), ref || `lynk:${ts}:${v}`);
  if (!r.changes) return { status: 'duplikat', amount: v };
  log('tomi', 'lynk', `Penghasilan Lynk.id ${rp(v)} — ${note}`);
  if (!silent) notify({ type: 'money', title: `Lynk.id +${rp(v)}`, text: note, telegram: false });
  return { status: 'ok', amount: v };
}

function splitCsvLine(line, sep) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function importCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV kosong');
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const head = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const iAmt = col('amount', 'nominal', 'total', 'harga', 'price', 'jumlah');
  const iDate = col('date', 'tanggal', 'waktu', 'time', 'created');
  const iNote = col('product', 'produk', 'item', 'nama', 'name', 'title');
  const iId = col('id', 'invoice', 'order', 'transaksi');
  const iStatus = col('status');
  if (iAmt < 0) throw new Error('Kolom nominal tidak ditemukan (amount/nominal/total)');
  let added = 0, dup = 0, skipped = 0, sum = 0;
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    if (iStatus >= 0 && /fail|gagal|cancel|batal|pending|expired/i.test(c[iStatus] || '')) { skipped++; continue; }
    const amount = toNumber(c[iAmt]);
    if (!amount) { skipped++; continue; }
    const ts = iDate >= 0 && !Number.isNaN(Date.parse(c[iDate])) ? Date.parse(c[iDate]) : Date.now();
    const ref = `lynk:${iId >= 0 && c[iId] ? c[iId] : `${ts}:${amount}`}`;
    const r = record({ amount, note: iNote >= 0 ? c[iNote] || 'Lynk.id' : 'Lynk.id', ref, ts, silent: true });
    if (r.status === 'ok') { added++; sum += amount; } else dup++;
  }
  if (added) notify({ type: 'money', title: `Impor Lynk.id: ${added} transaksi`, text: `Total ${rp(sum)}${dup ? ` • ${dup} duplikat dilewati` : ''}`, telegram: false });
  return { added, duplicate: dup, skipped, total: sum };
}

function webhook(body, secret) {
  if (!process.env.LYNK_WEBHOOK_SECRET || secret !== process.env.LYNK_WEBHOOK_SECRET) { const e = new Error('secret salah'); e.status = 401; throw e; }
  const amount = body.amount ?? body.total ?? body.nominal ?? body.price;
  return record({ amount, note: body.note || body.product || body.product_name || 'Lynk.id', ref: body.id ? `lynk:${body.id}` : null });
}

function summary() {
  const row = db.prepare("SELECT COUNT(*) c, SUM(amount) s FROM income WHERE source='lynk'").get();
  return { url: process.env.LYNK_URL || 'https://lynk.id', transaksi: row.c, total: row.s || 0, recent: db.prepare("SELECT * FROM income WHERE source='lynk' ORDER BY ts DESC LIMIT 20").all() };
}

module.exports = { record, importCsv, webhook, summary };
