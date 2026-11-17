// SWEET AI Agent Office — server web: halaman (Beranda, Office, Ruang Agen, Dashboard) + REST API + SSE realtime.
const express = require('express');
const cors = require('cors');
const path = require('path');
const officeState = require('../state/officeState');
const lazada = require('../services/lazada');
const lazadaSession = require('../services/lazadaSession');
const ads = require('../services/ads');
const stats = require('../services/stats');
const lynk = require('../services/lynk');
const notifySvc = require('../services/notify');
const pipeline = require('../jobs/pipeline');
const meeting = require('../jobs/meeting');
const autopilot = require('../jobs/autopilot');
const shift = require('../jobs/shift');
const orders = require('../services/orders');
const clock = require('../state/clock');
const auth = require('../services/auth');
const mailer = require('../services/mailer');
const llm = require('../ai/llm');
const { runAgent } = require('../ai/engine');
const { db, activity, log, settings, setSetting, setLogListener, now } = require('../db');

const ROOT = path.join(__dirname, '../..');
const WEB = path.join(ROOT, 'web');
const app = express();
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

// Aktivitas agen dikirim realtime ke semua halaman
setLogListener((row) => notifySvc.broadcast('activity', row));

const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : false }));
app.use(express.json({ limit: '2mb' }));

// ---------- Akun & login (database) ----------
const COOKIE = 'sweet_session';
const cookieOf = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const setSession = (req, res, token) => res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${req.secure ? '; Secure' : ''}`);
const clearSession = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);

// Halaman & endpoint yang boleh dibuka tanpa login
const PUBLIC_PAGES = ['/login', '/register', '/lupa-password'];
const PUBLIC_PREFIX = ['/api/auth/', '/lazada/callback', '/callback', '/api/lynk/webhook', '/api/err', '/shared.css', '/shared.js', '/auth.js', '/favicon.ico', '/favicon.svg', '/logo.svg', '/models/'];
app.use((req, res, next) => {
  req.user = auth.userFromToken(cookieOf(req)[COOKIE]);
  if (req.user || PUBLIC_PAGES.includes(req.path) || PUBLIC_PREFIX.some((p) => req.path.startsWith(p))) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Perlu login' });
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
});
// Hanya admin yang boleh mengubah data / memerintah agen. Pengguna biasa = lihat saja.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.path.startsWith('/auth/') || req.path.startsWith('/explore/') || ['/err', '/lynk/webhook'].includes(req.path)) return next();
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Hanya admin yang bisa melakukan ini. Akunmu berstatus lihat saja.' });
});

// Pembatas percobaan per IP (anti spam OTP / tebak sandi)
const hits = new Map();
const limit = (max, windowMs) => (req, res, next) => {
  const k = `${req.path}:${req.ip}`, t = Date.now();
  const arr = (hits.get(k) || []).filter((x) => t - x < windowMs); arr.push(t); hits.set(k, arr);
  if (arr.length > max) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' });
  next();
};
const authWrap = (fn) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (r && r.token) { setSession(req, res, r.token); delete r.token; }
    res.json({ status: 'ok', ...r });
  } catch (e) { res.status(e.status || 400).json({ status: 'error', error: e.message, needVerify: e.needVerify, email: e.email }); }
};
app.get('/login', (req, res) => (req.user ? res.redirect('/dashboard') : res.sendFile(path.join(WEB, 'auth.html'))));
app.get('/register', (req, res) => (req.user ? res.redirect('/dashboard') : res.sendFile(path.join(WEB, 'auth.html'))));
app.get('/lupa-password', (req, res) => res.sendFile(path.join(WEB, 'auth.html')));
app.get('/api/auth/config', (req, res) => res.json({ mail: auth.mailerConfigured(), dev: !auth.mailerConfigured() && process.env.MAIL_DEV_LOG === 'true' }));
app.get('/api/auth/me', (req, res) => res.json({ user: auth.publicUser(req.user) || null }));
app.post('/api/auth/register', limit(8, 15 * 60e3), authWrap((req) => auth.register(req.body || {})));
app.post('/api/auth/verify', limit(20, 15 * 60e3), authWrap((req) => auth.verifyRegister(req.body || {}, req)));
app.post('/api/auth/resend', limit(6, 15 * 60e3), authWrap((req) => auth.resend(req.body || {})));
app.post('/api/auth/login', limit(20, 15 * 60e3), authWrap((req) => auth.login(req.body || {}, req)));
app.post('/api/auth/forgot', limit(6, 15 * 60e3), authWrap((req) => auth.forgot(req.body || {})));
app.post('/api/auth/reset', limit(20, 15 * 60e3), authWrap((req) => auth.reset(req.body || {}, req)));
app.post('/api/auth/logout', (req, res) => { auth.destroySession(cookieOf(req)[COOKIE]); clearSession(res); res.json({ status: 'ok' }); });
app.post('/api/auth/password', authWrap((req) => { if (!req.user) throw Object.assign(new Error('Perlu login'), { status: 401 }); return auth.changePassword(req.user, req.body || {}); }));
app.get('/logout', (req, res) => { auth.destroySession(cookieOf(req)[COOKIE]); clearSession(res); res.redirect('/login'); });

// ---------- Halaman ----------
app.get('/', (req, res) => res.sendFile(path.join(WEB, 'index.html')));
app.get('/office', (req, res) => res.sendFile(path.join(ROOT, 'office_full.html')));
app.get('/ruangan', (req, res) => res.sendFile(path.join(WEB, 'ruangan.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(WEB, 'dashboard.html')));
app.get('/stayhome', (req, res) => res.sendFile(path.join(WEB, 'stayhome.html')));
app.get('/trading', (req, res) => res.sendFile(path.join(WEB, 'trading.html')));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

// ---------- Aset ----------
app.use('/models', express.static(path.join(ROOT, 'models')));
app.use('/avatars', express.static(officeState.AVATAR_DIR));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three')));
app.use(express.static(WEB, { index: false }));

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) { res.status(e.status || 400).json({ status: 'error', error: e.message }); }
};
const need = (v, msg) => { if (v === undefined || v === null || v === '') throw new Error(msg); return v; };

// ---------- Sistem ----------
app.get('/api/events', (req, res) => notifySvc.addSseClient(res));
app.get('/api/health', wrap(async () => ({
  brand: 'SWEET AI Agent Office', site: 'SweetOffice.com', boss: 'Kevin',
  ai: await llm.status(), claude: llm.hasClaude(), gemini: llm.hasGemini(), hermes: llm.hasHermes(), hermes_live: require('../services/hermes').isLive(),
  telegram: !!process.env.TELEGRAM_BOT_TOKEN, lazada: lazada.mode, cookies: lazadaSession.status(),
  demo: settings().demo_orders && !lazada.live, db: db.engine, mode: officeState.mode, meeting: meeting.status(),
  unread: notifySvc.unread(), project: pipeline.runningId(), clock: clock.snapshot(), resi_waiting: orders.waitingPrint(), uptime: Math.round(process.uptime()), settings: settings(), lynk_url: process.env.LYNK_URL || 'https://lynk.id'
})));
app.get('/api/settings', (req, res) => res.json(settings()));
app.post('/api/settings', wrap((req) => {
  let s = settings();
  Object.entries(req.body || {}).forEach(([k, v]) => { s = setSetting(k, v); });
  log('sistem', 'pengaturan', `Pengaturan diubah: ${Object.keys(req.body || {}).join(', ')}`);
  return s;
}));
app.get('/api/state', (req, res) => res.json(officeState.get_state()));
app.get('/api/activity', (req, res) => res.json(activity(req.query.agent || null, Math.min(Number(req.query.limit) || 40, 300))));

// ---------- Kantor: rapat & istirahat ----------
app.post('/api/meeting', wrap((req) => ({ status: 'ok', ...meeting.start(req.body?.topic, 'dashboard') })));
app.post('/api/dismiss', wrap(async (req) => ({ status: 'ok', ...(await meeting.end({ followUp: req.body?.followUp !== false })) })));
app.post('/api/break', wrap((req) => { meeting.breakTime(req.body?.on !== false); return { status: 'ok', mode: officeState.mode }; }));
app.get('/api/meetings', (req, res) => res.json(meeting.list(20)));
app.get('/api/meetings/:id', wrap((req) => meeting.get(Number(req.params.id)) || Promise.reject(new Error('Rapat tidak ditemukan'))));

// ---------- Rekrutmen ----------
app.post('/api/recruit', wrap((req) => {
  const r = officeState.recruit(req.body?.username, req.body?.role);
  if (!r.ok) throw new Error(r.error);
  notifySvc.notify({ type: 'agent', title: `${r.agent.name} bergabung`, text: `Peran: ${r.agent.role}`, telegram: false });
  return { status: 'ok', agent: officeState._public(r.agent) };
}));
app.post('/api/fire', wrap((req) => { const r = officeState.fire(req.body?.key); if (!r.ok) throw new Error(r.error); return { status: 'ok' }; }));

// ---------- Agen ----------
app.get('/api/agents', (req, res) => {
  const t0 = stats.startOfToday();
  const counts = Object.fromEntries(db.prepare('SELECT agent, COUNT(*) c FROM tasks WHERE ts >= ? GROUP BY agent').all(t0).map((r) => [r.agent, r.c]));
  const totals = Object.fromEntries(db.prepare("SELECT agent, COUNT(*) c FROM tasks WHERE status='done' GROUP BY agent").all().map((r) => [r.agent, r.c]));
  res.json(officeState.get_state().agents.map((a) => ({ ...a, tasks_today: counts[a.key] || 0, tasks_done: totals[a.key] || 0 })));
});
app.get('/api/agent/:key', wrap((req) => {
  const a = officeState.find(req.params.key);
  if (!a) throw new Error('Agen tidak ditemukan');
  return {
    agent: officeState._public(a),
    tasks: db.prepare('SELECT * FROM tasks WHERE agent=? ORDER BY id DESC LIMIT 20').all(a.key),
    deliverables: db.prepare('SELECT id,project_id,kind,status,review,round,ts,substr(content,1,8000) content FROM deliverables WHERE agent=? ORDER BY id DESC LIMIT 10').all(a.key),
    activity: activity(a.key, 40),
    stats: {
      today: db.prepare('SELECT COUNT(*) c FROM tasks WHERE agent=? AND ts >= ?').get(a.key, stats.startOfToday()).c,
      done: db.prepare("SELECT COUNT(*) c FROM tasks WHERE agent=? AND status='done'").get(a.key).c,
      failed: db.prepare("SELECT COUNT(*) c FROM tasks WHERE agent=? AND status='failed'").get(a.key).c
    }
  };
}));
app.post('/api/agent/task', wrap(async (req) => {
  const a = officeState.find(req.body?.key);
  need(a, 'Agen tidak ditemukan'); need(req.body?.text, 'Perintah wajib diisi');
  return { status: 'ok', agent: a.name, answer: await runAgent(a, String(req.body.text), 'dashboard', 'dashboard') };
}));
app.get('/api/tasks', (req, res) => res.json(db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(Math.min(Number(req.query.limit) || 50, 300))));

// Pusat perintah: satu perintah ke satu agen / tim / semua agen — langsung jalan di latar belakang.
function targetsOf(target) {
  if (target === 'all') return officeState.agents.filter((a) => a.type === 'builtin');
  if (target === 'dev' || target === 'toko') return officeState.agents.filter((a) => a.dept === target);
  const a = officeState.find(target); return a ? [a] : [];
}
async function runCommand(id, list, text, source) {
  const results = [];
  for (const a of list) {
    const ans = await runAgent(a, text, `cmd${id}`, source);
    results.push(`${a.name}: ${ans}`);
    notifySvc.notify({ type: 'agent', title: `${a.name} menyelesaikan perintah`, text: ans.slice(0, 300), telegram: false, data: { command_id: id, agent: a.key } });
  }
  db.prepare('UPDATE commands SET status=?, result=? WHERE id=?').run('selesai', results.join('\n\n').slice(0, 20000), id);
}
app.post('/api/command', wrap((req) => {
  const text = need(String(req.body?.text || '').trim(), 'Perintah wajib diisi');
  const target = req.body?.target || 'kamala';
  const list = targetsOf(target);
  if (!list.length) throw new Error('Target agen tidak ditemukan');
  const id = db.prepare('INSERT INTO commands(ts,source,target,text,status) VALUES(?,?,?,?,?)').run(now(), 'dashboard', target, text, 'berjalan').lastInsertRowid;
  log('kevin', 'perintah', `→ ${target}: ${text}`);
  runCommand(id, list, text, 'dashboard').catch((e) => db.prepare('UPDATE commands SET status=?, result=? WHERE id=?').run('gagal', e.message, id));
  return { status: 'ok', id, agents: list.map((a) => a.name) };
}));
app.get('/api/commands', (req, res) => res.json(db.prepare('SELECT * FROM commands ORDER BY id DESC LIMIT 30').all()));

// ---------- Proyek ----------
app.get('/api/projects', (req, res) => res.json({ items: pipeline.listProjects(), steps: pipeline.STEPS.map((s) => ({ id: s.id, job: s.job, kind: s.kind })), running: pipeline.runningId() }));
app.get('/api/projects/:id', wrap((req) => { const p = pipeline.getProject(req.params.id); if (!p) throw new Error('Proyek tidak ditemukan'); return p; }));
app.post('/api/projects', wrap((req) => ({ status: 'ok', id: pipeline.startProject(req.body?.idea) })));

// ---------- Notifikasi ----------
app.get('/api/notifications', (req, res) => res.json({ items: notifySvc.list(Math.min(Number(req.query.limit) || 40, 200)), unread: notifySvc.unread() }));
app.post('/api/notifications/read', (req, res) => { notifySvc.markAllRead(); res.json({ status: 'ok' }); });

// ---------- Statistik & pendapatan ----------
app.get('/api/stats', wrap((req) => {
  const days = Math.min(Number(req.query.days) || 7, 90);
  return { kpi: stats.kpi(), revenue: stats.revenueByDay(days), orders: stats.recentOrders(Math.min(Number(req.query.orders) || 40, 200)),
    top: stats.topProducts(days), buyers: stats.buyers(days), ads: ads.list(20), mode: lazada.mode };
}));
app.get('/api/income', (req, res) => {
  const src = req.query.source;
  res.json(src ? db.prepare('SELECT * FROM income WHERE source=? ORDER BY ts DESC LIMIT ?').all(src, 300) : db.prepare('SELECT * FROM income ORDER BY ts DESC LIMIT ?').all(Math.min(Number(req.query.limit) || 80, 500)));
});
app.post('/api/income', wrap((req) => {
  const amount = Number(req.body?.amount);
  need(amount || null, 'Nominal wajib diisi');
  if (req.body?.source === 'lynk') return lynk.record({ amount, note: req.body?.note || 'Lynk.id' });
  db.prepare('INSERT INTO income(ts,source,amount,note,ref) VALUES(?,?,?,?,?)').run(now(), 'manual', amount, req.body?.note || '', `manual:${now()}`);
  notifySvc.notify({ type: 'money', title: `Pemasukan +${stats.rupiah(amount)}`, text: req.body?.note || '', telegram: false });
  return { status: 'ok' };
}));
app.delete('/api/income/:id', wrap((req) => {
  const r = db.prepare("DELETE FROM income WHERE id=? AND source!='lazada'").run(req.params.id);
  return { status: r.changes ? 'ok' : 'tidak bisa dihapus (pemasukan Lazada otomatis)' };
}));
app.get('/api/lynk', (req, res) => res.json(lynk.summary()));
app.post('/api/lynk/import', express.text({ type: '*/*', limit: '5mb' }), wrap((req) => lynk.importCsv(typeof req.body === 'string' ? req.body : req.body?.csv)));
app.post('/api/lynk/webhook', wrap((req) => lynk.webhook(req.body || {}, req.query.secret || req.headers['x-lynk-secret'])));

// ---------- Iklan ----------
app.get('/api/ads', (req, res) => res.json(ads.list(80)));
app.post('/api/ads/propose', wrap((req) => ads.propose({ ...req.body, by: 'mira' })));
app.post('/api/ads/auto', wrap(async (req) => {
  const p = need(req.body?.product_name, 'product_name wajib diisi');
  const answer = await runAgent(officeState.byJob('ads'), `Buat proposal iklan untuk produk "${p}"${req.body.sku ? ` (SKU ${req.body.sku})` : ''} memakai propose_ad. Pilih type yang paling cocok, buat teks iklan menarik dan budget wajar.`, 'dashboard', 'dashboard');
  if (!llm.available()) ads.propose({ product_name: p, sku: req.body.sku, type: 'sponsored', budget: 50000, days: 3, copy: `${p} pilihan terbaik dari SWEET! Promo terbatas, checkout sekarang.`, by: 'mira' });
  return { status: 'ok', answer };
}));
app.post('/api/ads/:id/approve', wrap(async (req) => ads.approve(Number(req.params.id))));
app.post('/api/ads/:id/reject', wrap((req) => ads.reject(Number(req.params.id))));
app.post('/api/ads/:id/finish', wrap((req) => ads.finish(Number(req.params.id))));

// ---------- Pesanan & resi ----------
app.get('/api/orders', (req, res) => res.json(stats.recentOrders(Math.min(Number(req.query.limit) || 100, 300), req.query.status || '')));
app.post('/api/orders/:id/pack', wrap(async (req) => {
  const dimas = officeState.byJob('order');
  officeState.work(dimas.key, `Pack pesanan #${req.params.id}`, 'Mengemas paket...');
  try { return await orders.pack(req.params.id, req.body?.shipping_provider); }
  finally { officeState.rest(dimas.key, `Pesanan #${req.params.id} dikemas`); }
}));
app.post('/api/orders/:id/rts', wrap((req) => orders.rts(req.params.id)));
app.get('/api/resi', (req, res) => res.json({ printed: orders.printed(Math.min(Number(req.query.limit) || 40, 200)), waiting: orders.waitingPrint() }));
app.post('/api/orders/:id/print', wrap((req) => {
  orders.closedGuard();
  const o = orders.get(req.params.id);
  if (!o || !o.tracking_code) throw new Error('Pesanan belum punya resi');
  db.prepare('UPDATE orders SET printed_at=?, printed_by=COALESCE(printed_by, ?) WHERE order_id=?').run(now(), 'kevin', o.order_id);
  return { status: 'ok' };
}));
app.get('/api/orders/:id/label', async (req, res) => {
  try {
    const o = db.prepare('SELECT * FROM orders WHERE order_id=?').get(req.params.id);
    if (!o) throw new Error('Pesanan tidak ditemukan');
    if (o.source !== 'lazada') {
      const items = JSON.parse(o.items || '[]');
      return res.send(`<!doctype html><meta charset="utf-8"><title>Label #${o.order_id}</title><body style="font-family:sans-serif;padding:24px"><div style="border:2px dashed #333;padding:20px;max-width:420px">
        <h2 style="margin:0">${o.shipment_provider || 'Kurir'}</h2><h1 style="font-family:monospace;letter-spacing:2px">${o.tracking_code || '(belum ada resi)'}</h1>
        <p><b>Order:</b> #${o.order_id}<br><b>Penerima:</b> ${String(o.buyer).replace(/[<>&]/g, '')}<br><b>Isi:</b> ${items.map((i) => String(i.name).replace(/[<>&]/g, '')).join(', ')}</p>
        <p style="color:#888">Label contoh (pesanan ${o.source}). Pesanan Lazada asli memakai label resmi dari Lazada.</p></div><script>print()</script>`);
    }
    const r = await lazada.getDocument(await orders.itemIds(o.order_id), 'shippingLabel');
    const f = r.data?.document?.file;
    if (!f) throw new Error('Label belum tersedia (pack pesanan dulu)');
    res.type(r.data.document.mime_type || 'text/html').send(Buffer.from(f, 'base64'));
  } catch (e) { res.status(400).send(`<p>${String(e.message).replace(/[<>&]/g, '')}</p>`); }
});

// ---------- Produk ----------
app.get('/api/products', (req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY name').all()));
app.post('/api/products/sync', wrap(async () => ({ status: 'ok', count: await autopilot.syncProducts() })));
app.post('/api/lazada/products', wrap((req) => lazada.createProduct(req.body)));
app.post('/api/lazada/sku', wrap(async (req) => {
  const { seller_sku, price, quantity } = req.body || {};
  need(seller_sku, 'seller_sku wajib diisi');
  const p = price === '' || price === undefined ? undefined : Number(price);
  const q = quantity === '' || quantity === undefined ? undefined : Number(quantity);
  officeState.work('bayu', `Update SKU ${seller_sku}`, 'Memperbarui harga/stok...');
  try {
    const r = await lazada.updatePriceQuantity(seller_sku, { price: p, quantity: q });
    if (p !== undefined) db.prepare('UPDATE products SET price=?, updated_at=? WHERE seller_sku=?').run(p, now(), seller_sku);
    if (q !== undefined) db.prepare('UPDATE products SET quantity=?, updated_at=? WHERE seller_sku=?').run(q, now(), seller_sku);
    log('bayu', 'harga/stok', `SKU ${seller_sku}: harga=${p ?? '-'} stok=${q ?? '-'}`);
    return r;
  } finally { officeState.rest('bayu', `SKU ${seller_sku} diperbarui `); }
}));

// ---------- Chat pembeli ----------
app.get('/api/lazada/chats', wrap(() => lazada.listChats(20)));
app.get('/api/lazada/chats/:id', wrap((req) => lazada.readChat(req.params.id)));
app.post('/api/lazada/chats/:id/reply', wrap(async (req) => { const r = await lazada.replyChat(req.params.id, need(req.body?.text, 'Teks wajib diisi')); log('sari', 'chat', `Membalas sesi ${req.params.id}`); return r; }));
app.post('/api/lazada/chats/:id/ai', wrap(async (req) => ({ answer: await runAgent(officeState.byJob('cs'), `Baca chat sesi ${req.params.id} lalu ${req.body?.send ? 'balas dengan sopan' : 'buatkan DRAFT balasan (jangan dikirim)'}.`, 'dashboard', 'dashboard') })));

// ---------- Lazada ----------
app.get('/api/lazada/auth-url', wrap(() => { if (!lazada.hasApp) throw new Error('LAZADA_APP_KEY/SECRET belum diisi di .env'); return { url: lazada.authUrl() }; }));
// OAuth Lazada: Lazada mengarahkan browser ke /callback?code=xxxx (alamat lama /lazada/callback tetap jalan)
async function lazadaCallback(req, res) {
  const page = (ok, title, body) => res.status(ok ? 200 : 400).send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="icon" href="/favicon.svg"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0708;color:#f4ede9;font:15px/1.6 system-ui,sans-serif;padding:16px}.c{max-width:520px;background:#161013;border:1px solid ${ok ? 'rgba(63,179,127,.45)' : 'rgba(226,80,95,.45)'};border-radius:18px;padding:28px;text-align:center}h2{margin:12px 0 6px}a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:11px;background:linear-gradient(135deg,#a52a4a,#5e1528);color:#fff;text-decoration:none;font-weight:700}code{background:#271b20;padding:2px 6px;border-radius:6px}</style></head><body><div class="c"><img src="/logo.svg" width="64" alt=""><h2>${title}</h2>${body}<br><a href="/dashboard#sistem">Buka Dashboard</a></div>${ok ? '<script>setTimeout(()=>location.href="/dashboard#sistem",4000)</script>' : ''}</body></html>`);
  const code = String(req.query.code || '').trim();
  if (req.query.error) return page(false, 'Otorisasi Lazada dibatalkan', `<p>${String(req.query.error_description || req.query.error).replace(/[<>&"]/g, '')}</p>`);
  if (!code) return page(false, 'Parameter code tidak ada', '<p>Alamat ini dipanggil Lazada setelah kamu menyetujui otorisasi, dalam bentuk <code>/callback?code=xxxx</code>.</p>');
  if (!lazada.hasApp) return page(false, 'App Key / Secret belum diisi', '<p>Isi <code>LAZADA_APP_KEY</code> dan <code>LAZADA_APP_SECRET</code> di file .env lalu jalankan ulang server.</p>');
  try {
    const d = await lazada.exchangeCode(code);
    const purged = autopilot.purgeDemo();
    log('sistem', 'lazada', `Toko Lazada terhubung (${d.account || d.country || 'ok'}) — mode LIVE, ${purged} data demo dihapus`);
    notifySvc.notify({ type: 'success', title: 'Toko Lazada terhubung — LIVE', text: `${d.account || ''} ${d.country ? '(' + d.country + ')' : ''} • pesanan, resi, stok & chat sekarang dari Lazada asli` });
    autopilot.syncNow().catch(() => {});
    autopilot.syncProducts().catch(() => {});
    page(true, 'Toko Lazada berhasil terhubung', `<p>Akun <b>${String(d.account || '-').replace(/[<>&"]/g, '')}</b> ${d.country ? '(' + String(d.country).toUpperCase() + ')' : ''}. SWEET sekarang memakai data Lazada asli — pesanan DEMO dimatikan.</p>`);
  } catch (e) { page(false, 'Gagal menghubungkan Lazada', `<p>${String(e.message).replace(/[<>&"]/g, '')}</p><p style="color:#8d7f83;font-size:13px">Kode otorisasi hanya berlaku sekali & sebentar. Ulangi dari Dashboard › Sistem › Otorisasi toko Lazada. Pastikan Callback URL di Lazada Open Platform sama persis dengan <code>${lazada.cfg.redirect}</code>.</p>`); }
}
app.get('/callback', lazadaCallback);
app.get('/lazada/callback', lazadaCallback);
app.get('/api/lazada/status', (req, res) => res.json({ mode: lazada.mode, live: lazada.live, has_app: lazada.hasApp, app_key: lazada.cfg.appKey || null, redirect: lazada.cfg.redirect, token: lazada.tokenInfo() }));
app.post('/api/lazada/disconnect', wrap(() => { lazada.disconnect(); log('sistem', 'lazada', 'Otorisasi toko Lazada diputus oleh admin'); return { mode: lazada.mode }; }));
app.get('/api/lazada/session', wrap(() => lazadaSession.check()));
app.get('/api/lazada/seller', wrap(() => lazada.sellerInfo()));
app.post('/api/lazada/sync', wrap(async () => { await autopilot.syncNow(); return { status: 'ok' }; }));

// ---------- Jam kantor & timelapse ----------
app.get('/api/clock', (req, res) => res.json(clock.snapshot()));
app.post('/api/clock', wrap((req) => {
  if (req.body?.speed !== undefined) clock.setSpeed(req.body.speed);
  if (req.body?.jump) clock.jump(req.body.jump);
  log('kevin', 'jam', `Jam kantor: ${clock.hhmm(clock.now())} • ${clock.speed}x`);
  return clock.snapshot();
}));

// ---------- Laporan harian ----------
app.get('/api/reports', (req, res) => res.json(shift.reports.days(60)));
app.get('/api/reports/:day', wrap((req) => ({ day: req.params.day, items: shift.reports.byDay(req.params.day) })));
app.post('/api/reports/build', wrap(() => ({ status: 'ok', count: shift.reports.build(clock.day), day: clock.day })));
app.post('/api/reports/:day/ai', wrap(async (req) => {
  const items = shift.reports.byDay(req.params.day);
  if (!items.length) throw new Error('Laporan tidak ditemukan');
  if (!llm.available()) throw new Error('Belum ada API key AI');
  const text = await llm.generate('Kamu Chelsea, Tech Lead SWEET. Ringkas laporan harian untuk Bos Kevin: 3-5 poin penting, masalah, dan rekomendasi besok. Bahasa Indonesia, Markdown singkat, tanpa emoji.',
    items.map((r) => r.content).join('\n\n').slice(0, 30000));
  db.prepare('INSERT INTO reports(day,agent,title,content,stats,ts) VALUES(?,?,?,?,?,?) ON CONFLICT(day,agent) DO UPDATE SET content=excluded.content, ts=excluded.ts')
    .run(req.params.day, 'ringkasan_ai', 'Ringkasan AI', text, '{}', now());
  return { status: 'ok', content: text };
}));

// ---------- Cookies Seller Center (upload dari dashboard) ----------
app.post('/api/lazada/cookies', express.text({ type: 'text/*', limit: '1mb' }), wrap(async (req) => {
  const body = req.body;
  const raw = typeof body === 'string' ? body : body?.raw;
  const r = lazadaSession.save(raw, { ua: (typeof body === 'object' && body?.ua) || req.headers['user-agent'], by: req.user ? req.user.email : 'dashboard' });
  const chk = await lazadaSession.check();
  notifySvc.notify({ type: chk.ok ? 'success' : 'warn', title: chk.ok ? 'Seller Center terhubung' : 'Cookies tersimpan di database, sesi belum aktif', text: `${r.cookies} cookie Lazada • ${chk.reason}`, telegram: false });
  return { ...r, session: chk, status: lazadaSession.status() };
}));
app.get('/api/lazada/cookies', (req, res) => res.json(lazadaSession.status()));
app.delete('/api/lazada/cookies', wrap(() => { lazadaSession.clear(); log('sistem', 'lazada', 'cookies Seller Center dihapus dari database'); return { status: 'ok' }; }));

// ---------- Stay Home ----------
app.get('/api/home', (req, res) => res.json(require('../jobs/home').snapshot()));

// ---------- EXPLORE NOW (pengunjung co-op di kantor 3D) ----------
const explore = require('../services/explore');
app.get('/api/explore/players', (req, res) => res.json({ list: explore.list() }));
app.post('/api/explore/state', wrap((req) => explore.update(req.user, req.body || {})));
app.post('/api/explore/leave', express.text({ type: '*/*' }), wrap((req) => explore.leave(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {})));

// ---------- Trading XAUUSD (agent Aurel, akun HFM MetaTrader 5) ----------
const trader = require('../jobs/trader');
const mt5 = require('../services/mt5');
app.get('/api/trading', (req, res) => res.json(trader.summary()));
app.get('/api/trading/candles', wrap(async (req) => {
  const feed = require('../trading/feed');
  const c = await feed.candles(String(req.query.tf || 'M15').toUpperCase(), Math.min(Number(req.query.count) || 200, 1000));
  return { ...c, zones: require('../trading/zones').analyze(c.bars, c.tf), tick: feed.tick(), info: feed.info() };
}));
app.get('/api/trading/learn', (req, res) => { const feed = require('../trading/feed'); const src = req.query.source || 'mt5'; res.json({ ...require('../trading/learn').summary(src, Math.min(Number(req.query.limit) || 12, 40)), zones: require('../trading/zones').summary(src) }); });
app.get('/api/trading/series', (req, res) => res.json(trader.series(Math.min(Number(req.query.days) || 30, 365))));
app.get('/api/trading/calendar', (req, res) => res.json(trader.calendar(/^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null)));
app.get('/api/trading/orders', (req, res) => res.json(trader.orders(Math.min(Number(req.query.limit) || 50, 500))));
app.get('/api/trading/deals', (req, res) => res.json(trader.deals(Math.min(Number(req.query.limit) || 100, 1000))));
app.get('/api/trading/journal', (req, res) => res.json(activity('aurel', Math.min(Number(req.query.limit) || 40, 200))));
app.get('/api/trading/board', (req, res) => { const i = mt5.info(); res.json({ nickname: i.nickname, login: i.login, server: i.server, type: i.account_type, platform: i.platform, mode: i.mode }); });
app.post('/api/trading/settings', wrap((req) => {
  const b = req.body || {}, map = { enabled: 'trading_enabled', ai_review: 'trading_ai_review', lot: 'trading_lot', max_pending: 'trading_max_pending', max_positions: 'trading_max_positions', daily_loss_pct: 'trading_daily_loss_pct' };
  const maxLot = Number(process.env.TRADING_MAX_LOT || 0.05);
  if (b.lot !== undefined && !(Number(b.lot) >= 0.01 && Number(b.lot) <= maxLot)) throw new Error(`Lot harus 0.01 – ${maxLot} (batas TRADING_MAX_LOT di .env)`);
  if (b.max_pending !== undefined && !(Number(b.max_pending) >= 1 && Number(b.max_pending) <= 3)) throw new Error('Maks order limit 1 – 3');
  if (b.max_positions !== undefined && !(Number(b.max_positions) >= 1 && Number(b.max_positions) <= 3)) throw new Error('Maks posisi 1 – 3');
  if (b.daily_loss_pct !== undefined && !(Number(b.daily_loss_pct) >= 1 && Number(b.daily_loss_pct) <= 20)) throw new Error('Batas rugi harian 1 – 20%');
  Object.entries(map).forEach(([k, key]) => { if (b[k] !== undefined) setSetting(key, b[k]); });
  log('aurel', 'pengaturan', `Bos mengubah pengaturan trading: ${Object.keys(b).map((k) => `${k}=${b[k]}`).join(', ')}`);
  setTimeout(() => trader.tick(), 300);
  return trader.summary().settings;
}));
app.post('/api/trading/cancel/:ticket', wrap((req) => trader.cancelOrder(req.params.ticket)));
app.post('/api/trading/close/:ticket', wrap((req) => trader.closePosition(req.params.ticket)));
app.post('/api/trading/panic', wrap(() => trader.panic()));
app.post('/api/trading/bridge/start', wrap(() => mt5.startBridge()));
app.post('/api/trading/bridge/stop', wrap(() => mt5.stopBridge()));

// ---------- Hermes Agent ----------
const hermes = require('../services/hermes');
app.get('/api/hermes', wrap(() => hermes.status()));
app.post('/api/hermes/start', wrap(async () => { hermes.start(); await new Promise((r) => setTimeout(r, 4000)); return hermes.status(); }));
app.post('/api/hermes/stop', wrap(() => hermes.stop()));

// ---------- Pengguna (khusus admin) ----------
const adminOnly = (req) => { if (!req.user || req.user.role !== 'admin') throw Object.assign(new Error('Khusus admin'), { status: 403 }); };
app.get('/api/users', wrap((req) => { adminOnly(req); return { items: auth.listUsers(), mail: mailer.configured() }; }));
app.post('/api/users/:id', wrap((req) => auth.updateUser(req.user, Number(req.params.id), req.body || {})));
app.delete('/api/users/:id', wrap((req) => auth.deleteUser(req.user, Number(req.params.id))));
app.post('/api/mail/test', wrap(async (req) => { await mailer.send({ to: req.body?.to || req.user.email, subject: 'Tes email SWEET AI Agent Office', text: 'Pengiriman email SWEET berhasil.', html: '<p>Pengiriman email <b>SWEET AI Agent Office</b> berhasil.</p>' }); return { status: 'ok' }; }));

app.post('/api/err', express.text({ type: '*/*' }), (req, res) => { console.error('[Browser]', String(req.body).slice(0, 500)); res.end(); });
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ada' }));

function startServer() {
  return app.listen(PORT, HOST, () => {
    const u = `http://localhost:${PORT}`;
    console.log(`SWEET AI Agent Office → ${u}\n   ${u}/   ${u}/office   ${u}/ruangan   ${u}/stayhome   ${u}/trading   ${u}/dashboard`);

  });
}

module.exports = { startServer, app };
