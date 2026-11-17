// Tools yang bisa dipakai agen AI. Setiap agen hanya mendapat tools sesuai kerjaannya (1 agen = 1 kerjaan).
const lazada = require('../services/lazada');
const ads = require('../services/ads');
const stats = require('../services/stats');
const { db, settings } = require('../db');

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const S = { type: 'string' }, I = { type: 'integer' }, N = { type: 'number' };
const arr = (items) => ({ type: 'array', items });

const TOOLS = [
  // ---- read: data ringkas untuk siapa saja yang perlu gambaran ----
  { group: 'read', name: 'store_overview', description: 'Ringkasan toko: KPI pendapatan, pesanan menunggu, resi aktif, iklan.', input: obj(), run: () => ({ kpi: stats.kpi(), mode_lazada: lazada.mode }) },
  { group: 'read', name: 'orders_in_database', description: 'Pesanan tersimpan di database SWEET beserta resi dan total.', input: obj({ limit: I }), run: (a) => stats.recentOrders(a.limit || 15) },

  // ---- order: Dimas ----
  { group: 'order', name: 'lazada_list_orders', description: 'Daftar pesanan Lazada. status opsional: pending, ready_to_ship, shipped, delivered, canceled.', input: obj({ days: I, status: S }), run: (a) => lazada.listOrders(a.days || 2, a.status || '') },
  { group: 'order', name: 'orders_in_database', description: 'Pesanan di database SWEET beserta resi.', input: obj({ limit: I }), run: (a) => stats.recentOrders(a.limit || 15) },
  { group: 'order', name: 'lazada_get_order', description: 'Detail satu pesanan beserta item-itemnya.', input: obj({ order_id: S }, ['order_id']),
    run: async (a) => ({ order: await lazada.getOrder(a.order_id), items: await lazada.getOrderItems(a.order_id) }) },
  { group: 'order', name: 'lazada_pack_order', description: 'Pack pesanan untuk daftar order_item_id.', input: obj({ order_item_ids: arr(I), shipping_provider: S }, ['order_item_ids']),
    run: (a) => lazada.packOrder(a.order_item_ids, a.shipping_provider) },
  { group: 'order', name: 'lazada_ready_to_ship', description: 'Tandai siap kirim (RTS) untuk order_item_id.', input: obj({ order_item_ids: arr(I), tracking_number: S, shipment_provider: S }, ['order_item_ids']),
    run: (a) => lazada.readyToShip(a.order_item_ids, a.tracking_number, a.shipment_provider) },

  // ---- product: Bayu (dan Mira untuk melihat produk) ----
  { group: 'product', name: 'products_in_database', description: 'Daftar produk tersimpan (SKU, harga, stok). Gunakan dulu sebelum memanggil Lazada.', input: obj({ low_stock_only: { type: 'boolean' } }),
    run: (a) => (a.low_stock_only ? db.prepare('SELECT * FROM products WHERE quantity <= ? ORDER BY quantity').all(settings().low_stock) : db.prepare('SELECT * FROM products ORDER BY name').all()) },
  { group: 'product', name: 'lazada_list_products', description: 'Daftar produk dari Lazada (filter: all, live, inactive, sold-out).', input: obj({ filter: S, offset: I }), run: (a) => lazada.listProducts(a.filter || 'all', a.offset || 0) },
  { group: 'product', name: 'lazada_update_price_stock', description: 'Ubah harga dan/atau stok SKU (seller_sku).', input: obj({ seller_sku: S, price: N, quantity: I }, ['seller_sku']),
    run: async (a) => { const r = await lazada.updatePriceQuantity(a.seller_sku, { price: a.price, quantity: a.quantity });
      if (a.price !== undefined) db.prepare('UPDATE products SET price=?, updated_at=? WHERE seller_sku=?').run(a.price, Date.now(), a.seller_sku);
      if (a.quantity !== undefined) db.prepare('UPDATE products SET quantity=?, updated_at=? WHERE seller_sku=?').run(a.quantity, Date.now(), a.seller_sku);
      return r; } },
  { group: 'product', name: 'lazada_create_product', description: 'Upload produk baru ke Lazada.',
    input: obj({ name: S, description: S, brand: S, category_id: I, price: N, quantity: I, seller_sku: S, weight_kg: N, image_urls: arr(S) }, ['name', 'price', 'category_id']),
    run: (a) => lazada.createProduct(a) },

  // ---- chat: Sari ----
  { group: 'chat', name: 'lazada_list_chats', description: 'Daftar sesi chat pembeli terbaru.', input: obj(), run: () => lazada.listChats() },
  { group: 'chat', name: 'lazada_read_chat', description: 'Baca satu sesi chat pembeli.', input: obj({ session_id: S }, ['session_id']), run: (a) => lazada.readChat(a.session_id) },
  { group: 'chat', name: 'lazada_reply_chat', description: 'Balas chat pembeli.', input: obj({ session_id: S, text: S }, ['session_id', 'text']), run: (a) => lazada.replyChat(a.session_id, a.text) },

  // ---- ads: Mira ----
  { group: 'ads', name: 'propose_ad', description: 'Buat PROPOSAL iklan/promo untuk satu produk. Iklan baru jalan setelah Kevin menekan Terima. type: diskon (butuh sku & sale_price) atau sponsored.',
    input: obj({ product_name: S, sku: S, type: S, budget: N, days: I, sale_price: N, copy: { type: 'string', description: 'Teks iklan yang menarik' } }, ['product_name', 'copy']),
    run: (a) => ads.propose({ ...a, by: 'mira' }) },
  { group: 'ads', name: 'list_ads', description: 'Daftar iklan (proposed, running, rejected, finished).', input: obj(), run: () => ads.list(20) },

  // ---- sales: Tomi ----
  { group: 'sales', name: 'sales_report', description: 'Pendapatan: KPI, per hari, produk terlaris, jumlah pembeli.', input: obj({ days: I }),
    run: (a) => ({ kpi: stats.kpi(), per_hari: stats.revenueByDay(a.days || 7), terlaris: stats.topProducts(a.days || 30), pembeli: stats.buyers(a.days || 30) }) },

  // ---- db: Nola ----
  { group: 'db', name: 'database_health', description: 'Cek kesehatan database SWEET: jumlah baris tiap tabel dan data dobel.', input: obj(), run: () => stats.dbHealth() },

  // ---- system: Robo ----
  { group: 'system', name: 'system_status', description: 'Status sistem: uptime, memori, koneksi Lazada.', input: obj(),
    run: () => ({ uptime_menit: Math.round(process.uptime() / 60), memori_mb: Math.round(process.memoryUsage().rss / 1048576), lazada: lazada.mode, node: process.version, db: db.engine }) }
];

function toolsFor(agent) {
  const groups = agent.tools || [];
  const seen = new Set();
  return TOOLS.filter((t) => groups.includes(t.group) && !seen.has(t.name) && seen.add(t.name));
}

// Format untuk Claude
const forClaude = (list) => list.map((t) => ({ name: t.name, description: t.description, input_schema: t.input }));

// Format untuk Gemini (tipe huruf besar)
function upper(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const o = { ...schema };
  if (o.type) o.type = String(o.type).toUpperCase();
  if (o.properties) o.properties = Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, upper(v)]));
  if (o.items) o.items = upper(o.items);
  if (Array.isArray(o.required) && !o.required.length) delete o.required;
  return o;
}
const forGemini = (list) => list.map((t) => ({ name: t.name, description: t.description, parameters: upper(t.input) }));

module.exports = { TOOLS, toolsFor, forClaude, forGemini };
