// Operasi pesanan: pack, siap kirim (RTS), cetak resi. Dipakai dashboard, Telegram, dan alur kerja agen.
const lazada = require('./lazada');
const officeState = require('../state/officeState');
const { db, now, log } = require('../db');
const { notify } = require('./notify');

const DEAD = "('canceled','failed','returned')";
const get = (id) => db.prepare('SELECT * FROM orders WHERE order_id=?').get(String(id));
const upsert = (o) => require('../jobs/autopilot').upsertOrder(o);

async function itemIds(orderId) {
  const it = await lazada.getOrderItems(orderId);
  return (it.data || []).map((x) => Number(x.order_item_id)).filter(Boolean);
}

const clock = require('../state/clock');
const closedGuard = () => { if (clock.closed) throw new Error('Kantor sedang tutup (20:00–04:00). Pesanan diproses lagi mulai 04:00.'); };

async function pack(orderId, shippingProvider) {
  closedGuard();
  const o = get(orderId);
  if (!o) throw new Error('Pesanan tidak ditemukan');
  let tracking = o.tracking_code, provider = o.shipment_provider;
  if (o.source === 'lazada') {
    const r = await lazada.packOrder(await itemIds(o.order_id), shippingProvider);
    const pk = r.data?.pack_order_list?.[0]?.order_item_list?.[0];
    tracking = pk?.tracking_number || tracking; provider = pk?.shipment_provider || provider;
  } else if (!tracking) { provider = 'J&T Express'; tracking = `JNT${Math.floor(1e11 + Math.random() * 9e11)}`; }
  upsert({ ...o, items: JSON.parse(o.items || '[]'), status: 'packed', tracking_code: tracking, provider });
  log('dimas', 'pack', `Pesanan #${o.order_id} dikemas`);
  return { status: 'ok', tracking_code: tracking, provider };
}

async function rts(orderId) {
  closedGuard();
  const o = get(orderId);
  if (!o) throw new Error('Pesanan tidak ditemukan');
  if (o.source === 'lazada') await lazada.readyToShip(await itemIds(o.order_id), o.tracking_code, o.shipment_provider);
  upsert({ ...o, items: JSON.parse(o.items || '[]'), status: 'ready_to_ship', tracking_code: o.tracking_code, provider: o.shipment_provider });
  log('dimas', 'rts', `Pesanan #${o.order_id} siap dikirim`);
  return { status: 'ok' };
}

// Ambil satu resi yang belum dicetak (atomik, supaya dua agen tidak mencetak resi yang sama)
function claimForPrint(agentKey) {
  if (clock.closed) return null;
  const o = db.prepare(`SELECT * FROM orders WHERE tracking_code IS NOT NULL AND tracking_code!='' AND printed_at IS NULL AND status NOT IN ${DEAD} ORDER BY created_at LIMIT 1`).get();
  if (!o) return null;
  const r = db.prepare('UPDATE orders SET printed_at=?, printed_by=? WHERE order_id=? AND printed_at IS NULL').run(now(), agentKey, o.order_id);
  return r.changes ? get(o.order_id) : null;
}

function announcePrinted(o, agentKey) {
  const a = officeState.find(agentKey);
  log(agentKey, 'resi', `Resi #${o.order_id} dicetak (${o.shipment_provider || 'kurir'} ${o.tracking_code})`);
  notify({ type: 'resi', title: `Resi dicetak #${o.order_id}`, text: `${o.shipment_provider || 'Kurir'} ${o.tracking_code} • ${o.buyer}\nDicetak oleh ${a ? a.name : agentKey}`, telegram: false, data: { order_id: o.order_id, printed: true } });
}

const printed = (limit = 30) => db.prepare('SELECT * FROM orders WHERE printed_at IS NOT NULL ORDER BY printed_at DESC LIMIT ?').all(limit)
  .map((o) => ({ ...o, items: JSON.parse(o.items || '[]') }));
const waitingPrint = () => db.prepare(`SELECT COUNT(*) c FROM orders WHERE tracking_code IS NOT NULL AND tracking_code!='' AND printed_at IS NULL AND status NOT IN ${DEAD}`).get().c;
const pendingNoResi = () => db.prepare("SELECT * FROM orders WHERE status IN ('pending','unpaid') AND (tracking_code IS NULL OR tracking_code='') ORDER BY created_at LIMIT 5").all();

module.exports = { closedGuard, get, pack, rts, claimForPrint, announcePrinted, printed, waitingPrint, pendingNoResi, itemIds };
