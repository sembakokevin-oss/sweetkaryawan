// Iklan & promo: Mira membuat PROPOSAL -> Kevin menekan Terima -> langsung dijalankan.
// type 'diskon' : harga promo (SalePrice) di SKU lewat Lazada API (dieksekusi otomatis saat Terima).
// type 'sponsored': paket kampanye (budget, hari, teks iklan) dicatat & dilacak.
// Masa promo dihitung dengan jam kantor (ikut timelapse). Saat habis, agen memberi tanda $ dan mengusulkan perpanjangan.
const { db, now, log } = require('../db');
const lazada = require('./lazada');
const officeState = require('../state/officeState');
const clock = require('../state/clock');
const { notify } = require('./notify');

const fmt = (n) => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const get = (id) => db.prepare('SELECT * FROM ads WHERE id=?').get(id);
const list = (limit = 50) => db.prepare('SELECT * FROM ads ORDER BY id DESC LIMIT ?').all(limit);
const listeners = [];
const onChange = (fn) => listeners.push(fn);
const changed = (ad) => listeners.forEach((fn) => { try { fn(ad); } catch (_) {} });

function propose({ product_name, sku, type = 'sponsored', budget = 50000, days = 3, sale_price = null, copy = '', by = 'mira', note = '' }) {
  if (!product_name) throw new Error('product_name wajib diisi');
  const t = type === 'diskon' ? 'diskon' : 'sponsored';
  const r = db.prepare('INSERT INTO ads(ts,product_name,sku,type,budget,days,sale_price,copy,status,by_agent,sim_ts) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(now(), product_name, sku || null, t, Number(budget) || 0, Number(days) || 3, sale_price ? Number(sale_price) : null, copy, 'proposed', by, clock.now());
  const ad = get(r.lastInsertRowid);
  log(by, 'iklan', `Proposal iklan #${ad.id}: ${product_name}`);
  notify({
    type: 'ad', title: `Proposal iklan #${ad.id}: ${product_name}`,
    text: `${note ? note + '\n' : ''}${t === 'diskon' ? `Diskon menjadi ${fmt(ad.sale_price)}` : `Budget ${fmt(ad.budget)}`} • ${ad.days} hari\n"${String(copy).slice(0, 140)}"`,
    data: { ad_id: ad.id, actions: ['approve', 'reject'] }
  });
  changed(ad);
  return ad;
}

async function approve(id) {
  const ad = get(id);
  if (!ad) throw new Error('Iklan tidak ditemukan');
  if (ad.status !== 'proposed') throw new Error(`Iklan #${id} sudah ${ad.status}`);
  let result = '';
  try {
    if (ad.type === 'diskon' && ad.sku && ad.sale_price) {
      const d = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 10);
      await lazada.updatePriceQuantity(ad.sku, { salePrice: ad.sale_price, saleStart: d(0), saleEnd: d(ad.days * 86400e3) });
      result = lazada.live ? 'Harga promo dipasang di Lazada.' : 'Simulasi: harga promo dipasang.';
    } else {
      result = lazada.live
        ? 'Paket kampanye disetujui & dilacak. Pasang iklan berbayar di Seller Center (Sponsored Solutions) memakai paket ini.'
        : 'Simulasi: kampanye berjalan.';
    }
    const endsAt = clock.now() + ad.days * 86400e3;
    db.prepare('UPDATE ads SET status=?, result=?, ends_at=? WHERE id=?').run('running', result, endsAt, id);
    officeState.update_agent(ad.by_agent, { thought: `Iklan #${id} berjalan` });
    log(ad.by_agent, 'iklan', `Iklan #${id} disetujui Kevin dan berjalan sampai ${clock.dayOf(endsAt)} ${clock.hhmm(endsAt)}`);
    notify({ type: 'success', title: `Iklan #${id} berjalan`, text: `${ad.product_name} — ${result}` });
  } catch (e) {
    db.prepare('UPDATE ads SET status=?, result=? WHERE id=?').run('failed', e.message, id);
    notify({ type: 'warn', title: `Iklan #${id} gagal`, text: e.message });
    changed(get(id));
    throw e;
  }
  const out = get(id); changed(out);
  return out;
}

function reject(id) {
  const ad = get(id);
  if (!ad) throw new Error('Iklan tidak ditemukan');
  db.prepare('UPDATE ads SET status=? WHERE id=?').run('rejected', id);
  log(ad.by_agent, 'iklan', `Iklan #${id} ditolak Kevin`);
  notify({ type: 'info', title: `Iklan #${id} ditolak`, text: ad.product_name, telegram: false });
  const out = get(id); changed(out);
  return out;
}

function finish(id, reason = 'Diselesaikan Kevin') {
  db.prepare('UPDATE ads SET status=?, result=? WHERE id=?').run('finished', reason, id);
  const out = get(id); changed(out);
  return out;
}

// Promo yang masa berlakunya sudah habis (menurut jam kantor)
const expired = () => db.prepare("SELECT * FROM ads WHERE status='running' AND ends_at IS NOT NULL AND ends_at < ?").all(clock.now());
const pending = () => db.prepare("SELECT * FROM ads WHERE status='proposed' ORDER BY id").all();

module.exports = { propose, approve, reject, finish, list, get, expired, pending, onChange };
