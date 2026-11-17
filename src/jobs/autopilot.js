const lazada = require('../services/lazada');
const officeState = require('../state/officeState');
const { db, now, log, kvGet, kvSet, settings } = require('../db');
const { notify } = require('../services/notify');
const { rupiah } = require('../services/stats');
const { runAgent } = require('../ai/engine');
const clock = require('../state/clock');

// Autopilot toko Lazada:
//  - Sinkron pesanan ke database (pembeli, total, produk, STATUS, RESI) -> notifikasi & pendapatan di dashboard.
//  - Opsional LAZADA_AUTO_REPLY=true : Sari membalas chat. LAZADA_AUTO_PACK=true : Dimas mem-pack pesanan baru.
//  - Mode simulasi + DEMO_ORDERS=true : membuat pesanan DEMO agar dashboard terlihat hidup.

const DEAD = ['canceled', 'failed', 'returned'];

function parseDate(s) {
  if (!s) return Date.now();
  const iso = String(s).replace(' +', '+').replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const t = Date.parse(iso); return Number.isNaN(t) ? Date.now() : t;
}

function upsertOrder(o) {
  const old = db.prepare('SELECT * FROM orders WHERE order_id=?').get(o.order_id);
  const items = JSON.stringify(o.items || []);
  if (!old) {
    db.prepare('INSERT INTO orders(order_id,ts,created_at,buyer,total,status,items,tracking_code,shipment_provider,source) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(o.order_id, now(), o.created_at, o.buyer, o.total, o.status, items, o.tracking_code || null, o.provider || null, o.source);
    const names = (o.items || []).map((i) => i.name).filter(Boolean).join(', ') || 'pesanan baru';
    if (!DEAD.includes(o.status)) {
      db.prepare('INSERT OR IGNORE INTO income(ts,source,amount,note,ref) VALUES(?,?,?,?,?)').run(o.created_at, 'lazada', o.total, `Order #${o.order_id}`, `lazada:${o.order_id}`);
    }
    log('dimas', 'order', `Pesanan baru #${o.order_id} ${rupiah(o.total)}`);
    notify({ type: 'order', title: `Checkout baru ${rupiah(o.total)}${o.source === 'demo' ? ' (DEMO)' : ''}`, text: `#${o.order_id} • ${o.buyer}\n${names}`, data: { order_id: o.order_id } });
    notify({ type: 'money', title: `Pemasukan ${rupiah(o.total)}`, text: `Checkout dari ${o.buyer}`, telegram: false, data: { silent: true, order_id: o.order_id } });
    if (o.tracking_code) notify({ type: 'resi', title: `Resi tersedia #${o.order_id}`, text: `${o.provider || 'Kurir'}: ${o.tracking_code}` });
    return 'new';
  }
  const keepItems = (o.items || []).length ? items : old.items;
  db.prepare('UPDATE orders SET status=?, items=?, total=? WHERE order_id=?').run(o.status, keepItems, o.total || old.total, o.order_id);
  if (DEAD.includes(o.status)) db.prepare('DELETE FROM income WHERE ref=?').run(`lazada:${o.order_id}`);
  if (o.tracking_code && o.tracking_code !== old.tracking_code) {
    db.prepare('UPDATE orders SET tracking_code=?, shipment_provider=? WHERE order_id=?').run(o.tracking_code, o.provider || null, o.order_id);
    log('dimas', 'resi', `Resi #${o.order_id}: ${o.tracking_code}`);
    notify({ type: 'resi', title: `Resi tersedia #${o.order_id}`, text: `${o.provider || 'Kurir'}: ${o.tracking_code}`, data: { order_id: o.order_id } });
    return 'resi';
  }
  if (old.status !== o.status) {
    log('dimas', 'status', `#${o.order_id}: ${old.status} → ${o.status}`);
    if (o.status === 'delivered') notify({ type: 'success', title: `Pesanan #${o.order_id} sampai`, text: o.buyer, telegram: false });
    if (DEAD.includes(o.status)) notify({ type: 'warn', title: `Pesanan #${o.order_id} ${o.status}`, text: `${o.buyer} • ${rupiah(o.total)}` });
    return 'status';
  }
  return 'same';
}

async function syncLive() {
  const od = await lazada.listOrders(2, '', 0, 50);
  const orders = od.data?.orders || [];
  for (const raw of orders) {
    const id = String(raw.order_id);
    const old = db.prepare('SELECT tracking_code FROM orders WHERE order_id=?').get(id);
    let items = [], tracking = old?.tracking_code, provider;
    if (!old || !old.tracking_code) {
      try {
        const it = await lazada.getOrderItems(raw.order_id);
        items = (it.data || []).map((x) => ({ item_id: x.order_item_id, name: x.name, sku: x.sku, price: parseFloat(x.paid_price) || 0, status: x.status }));
        const withTrack = (it.data || []).find((x) => x.tracking_code);
        if (withTrack) { tracking = withTrack.tracking_code; provider = withTrack.shipment_provider; }
      } catch (_) { /* item belum tersedia */ }
    }
    upsertOrder({
      order_id: id, created_at: parseDate(raw.created_at), buyer: raw.customer_first_name || 'Pembeli',
      total: parseFloat(raw.price) || 0, status: (raw.statuses || ['pending'])[0], items, tracking_code: tracking, provider, source: 'lazada'
    });
  }
  return orders.length;
}

// ---------- Produk -> database (stok & harga) ----------
function saveProduct(p) {
  db.prepare(`INSERT INTO products(seller_sku,item_id,name,price,sale_price,quantity,status,image,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(seller_sku) DO UPDATE SET item_id=excluded.item_id,name=excluded.name,price=excluded.price,sale_price=excluded.sale_price,
    quantity=excluded.quantity,status=excluded.status,image=excluded.image,updated_at=excluded.updated_at`)
    .run(p.seller_sku, String(p.item_id || ''), p.name, p.price, p.sale_price || null, p.quantity, p.status || 'active', p.image || null, now());
}
async function syncProducts() {
  if (!lazada.live) {
    if (!db.prepare('SELECT COUNT(*) c FROM products').get().c) lazada.SIM_PRODUCTS.forEach((p) => saveProduct({ seller_sku: p.sku, item_id: p.item_id, name: p.name, price: p.price, quantity: p.qty }));
    return db.prepare('SELECT COUNT(*) c FROM products').get().c;
  }
  let offset = 0, n = 0;
  for (let page = 0; page < 10; page++) {
    const d = await lazada.listProducts('all', offset, 50);
    const items = d.data?.products || [];
    items.forEach((it) => (it.skus || []).forEach((k) => {
      saveProduct({ seller_sku: k.SellerSku, item_id: it.item_id, name: it.attributes?.name || it.name || k.SellerSku, price: Number(k.price) || 0,
        sale_price: Number(k.special_price) || null, quantity: Number(k.quantity ?? k.Available ?? 0), status: k.Status || it.status, image: (k.Images || [])[0] });
      n++;
    }));
    if (items.length < 50) break;
    offset += 50;
  }
  return n;
}

// ---------- DEMO (hanya saat simulasi) ----------
const DEMO = [['Kopi Arabika 250g', 65000], ['Gelas Keramik Polos', 28000], ['Tumbler Stainless 500ml', 89000], ['Kaos Polos Premium', 75000]];
const BUYERS = ['Budi', 'Siti', 'Andi', 'Rina', 'Dewi', 'Agus', 'Maya', 'Joko'];
const COURIERS = ['JNE', 'J&T Express', 'SiCepat', 'Anteraja', 'Lazada Logistics'];
function demoTick() {
  const [name, price] = DEMO[Math.floor(Math.random() * DEMO.length)];
  const qty = 1 + Math.floor(Math.random() * 3);
  const id = String(Date.now()).slice(-9);
  const buyer = BUYERS[Math.floor(Math.random() * BUYERS.length)];
  const prod = db.prepare('SELECT * FROM products WHERE name=?').get(name);
  upsertOrder({ order_id: id, created_at: Date.now(), buyer, total: price * qty, status: 'pending', source: 'demo',
    items: [{ name: `${name} x${qty}`, sku: prod?.seller_sku || name.slice(0, 5).toUpperCase(), price: price * qty }] });
  if (prod) db.prepare('UPDATE products SET quantity=MAX(0, quantity-?), updated_at=? WHERE seller_sku=?').run(qty, now(), prod.seller_sku);
  officeState.work(officeState.byJob('order').key, `Pesanan DEMO #${id}`, `Memproses pesanan ${buyer}...`);
  setTimeout(() => officeState.rest(officeState.byJob('order').key, `Pesanan #${id} diproses `), 15000);
  setTimeout(() => {
    const c = COURIERS[Math.floor(Math.random() * COURIERS.length)];
    upsertOrder({ order_id: id, created_at: Date.now(), buyer, total: price * qty, status: 'ready_to_ship', source: 'demo',
      items: [], tracking_code: `${c.slice(0, 3).toUpperCase()}${Math.floor(1e11 + Math.random() * 9e11)}`, provider: c });
  }, 25000);
  // sebagian pesanan jadi "terkirim"
  setTimeout(() => {
    const o = db.prepare('SELECT * FROM orders WHERE order_id=?').get(id);
    if (o) upsertOrder({ order_id: id, created_at: o.created_at, buyer, total: o.total, status: 'delivered', source: 'demo', items: JSON.parse(o.items || '[]'), tracking_code: o.tracking_code, provider: o.shipment_provider });
  }, 120000);
}

async function tick() {
  if (clock.closed) return; // kantor tutup 20:00-04:00: tidak menerima / memproses pesanan
  const dimas = officeState.byJob('order');
  try {
    if (lazada.live) {
      officeState.work(dimas.key, 'Sinkron pesanan Lazada', 'Memeriksa pesanan & resi...');
      const n = await syncLive();
      log(dimas.key, 'sync', `Sinkron ${n} pesanan`);
      if (!kvGet('products_synced_at') || Date.now() - kvGet('products_synced_at') > 30 * 60e3) {
        const p = await syncProducts(); kvSet('products_synced_at', Date.now()); log('bayu', 'sync', `Sinkron ${p} SKU produk`);
      }

      if (settings().auto_pack) {
        const pend = db.prepare("SELECT order_id FROM orders WHERE status='pending' AND source='lazada'").all();
        if (pend.length) notify({ type: 'agent', title: 'Dimas mem-pack pesanan', text: await runAgent(dimas, `Pack pesanan pending ini: ${pend.map((p) => p.order_id).join(', ')}. Ambil item-itemnya dulu, lalu laporkan singkat.`, 'autopilot') });
      }
      if (settings().auto_reply) {
        const sari = officeState.byJob('cs');
        const cd = await lazada.listChats();
        const sessions = cd.data?.session_list || cd.data?.sessions || [];
        const seen = new Set(kvGet('chats_seen', []));
        for (const s of sessions) {
          const stamp = `${s.session_id}:${s.last_message_time || s.last_message_id || ''}`;
          if (!(s.unread_count > 0) || seen.has(stamp)) continue;
          seen.add(stamp);
          notify({ type: 'agent', title: `Sari menangani chat`, text: await runAgent(sari, `Ada chat belum dibaca di sesi ${s.session_id}. Baca lalu balas dengan sopan. Jika perlu keputusan Kevin (refund/komplain berat), jangan balas, ringkas saja.`, 'autopilot') });
        }
        kvSet('chats_seen', [...seen].slice(-300));
      }
    }
  } catch (e) {
    console.warn('[autopilot]', e.message);
    log(dimas.key, 'error', e.message);
  } finally {
    officeState.rest(dimas.key, 'Sinkron selesai.');
  }
}

function startAutopilot() {
  const min = Number(process.env.LAZADA_AUTOPILOT_MINUTES ?? 2);
  if (min) {
    console.log(`Autopilot Lazada aktif tiap ${min} menit (sinkron saat mode LIVE).`);
    setInterval(() => tick().catch(() => {}), min * 60e3);
    setTimeout(() => tick().catch(() => {}), 15e3);
  } else console.log('Autopilot Lazada dimatikan.');
  syncProducts().catch((e) => console.warn('[produk]', e.message));
  const demoEvery = Math.max(20, Number(process.env.DEMO_ORDER_SECONDS || 90));
  setInterval(() => { if (!lazada.live && settings().demo_orders && !clock.closed) demoTick(); }, demoEvery * 1000);
  setTimeout(() => { if (!lazada.live && settings().demo_orders && !clock.closed) demoTick(); }, 10e3);
  // Saat kantor buka lagi (04:00), langsung sinkron pesanan yang masuk selama tutup
  clock.onPhase((p, prev) => { if (prev === 'malam' && p !== 'malam') setTimeout(() => tick().catch(() => {}), 3000); });
  if (!lazada.live) console.log(`Mode simulasi: pesanan DEMO ${settings().demo_orders ? 'aktif' : 'mati'} (atur di Dashboard › Sistem).`);
}

// Saat toko Lazada asli terhubung: hapus data contoh (pesanan DEMO, pendapatannya, produk simulasi)
function purgeDemo() {
  const ids = db.prepare("SELECT order_id FROM orders WHERE source='demo'").all().map((r) => r.order_id);
  db.transaction(() => {
    ids.forEach((id) => db.prepare('DELETE FROM income WHERE ref=?').run(`lazada:${id}`));
    db.prepare("DELETE FROM orders WHERE source='demo'").run();
    lazada.SIM_PRODUCTS.forEach((p) => db.prepare('DELETE FROM products WHERE seller_sku=?').run(p.sku));
  })();
  kvSet('products_synced_at', 0);
  return ids.length;
}

module.exports = { startAutopilot, syncNow: tick, syncProducts, upsertOrder, purgeDemo };
