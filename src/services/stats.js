const { db } = require('../db');

const WIB = 7 * 3600e3;
const dayKey = (ms) => new Date(ms + WIB).toISOString().slice(0, 10);
const startOfToday = () => { const d = new Date(Date.now() + WIB); d.setUTCHours(0, 0, 0, 0); return d.getTime() - WIB; };
const LIVE = "status NOT IN ('canceled','failed','returned')";

function revenueByDay(days = 7) {
  const since = startOfToday() - (days - 1) * 86400e3;
  const map = {};
  for (let i = 0; i < days; i++) { const k = dayKey(since + i * 86400e3); map[k] = { date: k, lazada: 0, lynk: 0, manual: 0, total: 0, orders: 0, buyers: 0 }; }
  db.prepare('SELECT ts, source, amount FROM income WHERE ts >= ?').all(since).forEach((r) => {
    const k = dayKey(r.ts); if (!map[k]) return;
    const s = map[k][r.source] !== undefined ? r.source : 'manual';
    map[k][s] += r.amount; map[k].total += r.amount;
  });
  const buyersPerDay = {};
  db.prepare(`SELECT created_at, buyer FROM orders WHERE created_at >= ? AND ${LIVE}`).all(since).forEach((o) => {
    const k = dayKey(o.created_at); if (!map[k]) return;
    map[k].orders++; (buyersPerDay[k] = buyersPerDay[k] || new Set()).add(o.buyer);
  });
  Object.entries(buyersPerDay).forEach(([k, s]) => { map[k].buyers = s.size; });
  return Object.values(map);
}

function kpi() {
  const t0 = startOfToday();
  const sum = (sql, ...a) => db.prepare(sql).get(...a).s || 0;
  const cnt = (sql, ...a) => db.prepare(sql).get(...a).c || 0;
  const bySource = { lazada: 0, lynk: 0, manual: 0 };
  db.prepare('SELECT source, SUM(amount) s FROM income GROUP BY source').all().forEach((r) => { bySource[r.source] = r.s; });
  const todayOrders = cnt(`SELECT COUNT(*) c FROM orders WHERE created_at >= ? AND ${LIVE}`, t0);
  const todayLazada = sum("SELECT SUM(amount) s FROM income WHERE ts >= ? AND source='lazada'", t0);
  return {
    today_revenue: sum('SELECT SUM(amount) s FROM income WHERE ts >= ?', t0),
    yesterday_revenue: sum('SELECT SUM(amount) s FROM income WHERE ts >= ? AND ts < ?', t0 - 86400e3, t0),
    today_orders: todayOrders,
    today_buyers: cnt(`SELECT COUNT(DISTINCT buyer) c FROM orders WHERE created_at >= ? AND ${LIVE}`, t0),
    today_aov: todayOrders ? todayLazada / todayOrders : 0,
    week_revenue: sum('SELECT SUM(amount) s FROM income WHERE ts >= ?', t0 - 6 * 86400e3),
    month_revenue: sum('SELECT SUM(amount) s FROM income WHERE ts >= ?', t0 - 29 * 86400e3),
    total_revenue: sum('SELECT SUM(amount) s FROM income'),
    total_orders: cnt(`SELECT COUNT(*) c FROM orders WHERE ${LIVE}`),
    total_buyers: cnt(`SELECT COUNT(DISTINCT buyer) c FROM orders WHERE ${LIVE}`),
    pending_orders: cnt("SELECT COUNT(*) c FROM orders WHERE status IN ('pending','packed','ready_to_ship','unpaid')"),
    active_resi: cnt("SELECT COUNT(*) c FROM orders WHERE tracking_code IS NOT NULL AND tracking_code != '' AND status NOT IN ('delivered','canceled','failed','returned')"),
    ads_running: cnt("SELECT COUNT(*) c FROM ads WHERE status='running'"),
    ads_proposed: cnt("SELECT COUNT(*) c FROM ads WHERE status='proposed'"),
    low_stock: cnt('SELECT COUNT(*) c FROM products WHERE quantity <= ?', Number(process.env.LOW_STOCK_LIMIT || 5)),
    tasks_today: cnt('SELECT COUNT(*) c FROM tasks WHERE ts >= ?', t0),
    by_source: bySource
  };
}

function recentOrders(limit = 50, status = '') {
  const rows = status
    ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map((o) => ({ ...o, items: o.items ? JSON.parse(o.items) : [] }));
}

// Produk terlaris dihitung dari item pesanan
function topProducts(days = 30, limit = 8) {
  const since = startOfToday() - (days - 1) * 86400e3;
  const map = {};
  db.prepare(`SELECT items, total FROM orders WHERE created_at >= ? AND ${LIVE}`).all(since).forEach((o) => {
    let items = [];
    try { items = JSON.parse(o.items || '[]'); } catch (_) {}
    items.forEach((i) => {
      const name = String(i.name || 'Produk').replace(/\s*x\d+$/, '');
      const qty = Number((String(i.name).match(/x(\d+)$/) || [])[1]) || Number(i.qty) || 1;
      map[name] = map[name] || { name, qty: 0, revenue: 0, orders: 0 };
      map[name].qty += qty; map[name].revenue += Number(i.price) || 0; map[name].orders++;
    });
  });
  return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

function buyers(days = 30, limit = 10) {
  const since = startOfToday() - (days - 1) * 86400e3;
  return db.prepare(`SELECT buyer, COUNT(*) orders, SUM(total) total, MAX(created_at) last FROM orders WHERE created_at >= ? AND ${LIVE} GROUP BY buyer ORDER BY total DESC LIMIT ?`).all(since, limit);
}

function dbHealth() {
  const tables = ['orders', 'income', 'products', 'ads', 'tasks', 'activity', 'projects', 'deliverables', 'meetings', 'notifications', 'recruits'];
  const counts = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]));
  const dupIncome = db.prepare('SELECT COUNT(*) c FROM (SELECT note, amount, ts FROM income GROUP BY note, amount, ts HAVING COUNT(*) > 1)').get().c;
  const dupProducts = db.prepare('SELECT COUNT(*) c FROM (SELECT name FROM products GROUP BY lower(name) HAVING COUNT(*) > 1)').get().c;
  return { engine: db.engine, counts, duplikat: { pemasukan: dupIncome, nama_produk: dupProducts }, catatan: 'orders.order_id, income.ref, products.seller_sku bersifat UNIK sehingga tidak bisa dobel.' };
}

const rupiah = (n) => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');

module.exports = { revenueByDay, kpi, recentOrders, topProducts, buyers, dbHealth, rupiah, startOfToday, dayKey };
