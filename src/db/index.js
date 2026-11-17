// SWEET AI Agent Office — database SQLite (file: data/sweet.db)
// Memakai SQLite bawaan Node (node:sqlite, Node 22.13+) atau better-sqlite3 (otomatis terpasang lewat npm install).
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SWEET_DATA_DIR || path.join(__dirname, '../../data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'sweet.db');

function openDb() {
  const errors = [];
  try {
    const BetterSqlite = require('better-sqlite3');
    const d = new BetterSqlite(FILE);
    d.pragma('journal_mode = WAL');
    return { raw: d, engine: 'better-sqlite3' };
  } catch (e) { errors.push(`better-sqlite3: ${e.message.split('\n')[0]}`); }
  try {
    const origEmit = process.emitWarning;
    process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : origEmit.call(process, w, ...a));
    const { DatabaseSync } = require('node:sqlite');
    process.emitWarning = origEmit;
    const d = new DatabaseSync(FILE);
    d.exec('PRAGMA journal_mode = WAL');
    return { raw: d, engine: 'node:sqlite' };
  } catch (e) { errors.push(`node:sqlite: ${e.message.split('\n')[0]}`); }
  console.error('Database tidak bisa dibuka.\n   Jalankan "npm install" (memasang better-sqlite3) atau pakai Node.js 22.13+.\n   ' + errors.join('\n   '));
  process.exit(1);
}

const { raw, engine } = openDb();

// Nilai undefined/boolean dinormalkan supaya kedua engine berperilaku sama.
const clean = (args) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const cache = new Map();
const db = {
  engine,
  exec: (sql) => raw.exec(sql),
  prepare(sql) {
    if (cache.has(sql)) return cache.get(sql);
    const st = raw.prepare(sql);
    const w = {
      run: (...a) => { const r = st.run(...clean(a)); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
      get: (...a) => st.get(...clean(a)),
      all: (...a) => st.all(...clean(a))
    };
    cache.set(sql, w);
    return w;
  },
  transaction(fn) {
    return (...a) => { raw.exec('BEGIN'); try { const r = fn(...a); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } };
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS recruits (
  key TEXT PRIMARY KEY, name TEXT, role TEXT, specialty TEXT,
  telegram_username TEXT UNIQUE, telegram_id INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, agent TEXT, kind TEXT, text TEXT);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity(agent, id DESC);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, agent TEXT, title TEXT, source TEXT,
  status TEXT, result TEXT, project_id INTEGER, finished_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent, id DESC);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, idea TEXT, status TEXT,
  round INTEGER DEFAULT 1, step TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, agent TEXT, job TEXT,
  kind TEXT, content TEXT, status TEXT, review TEXT, round INTEGER, ts INTEGER);
CREATE INDEX IF NOT EXISTS idx_deliv_project ON deliverables(project_id);
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY, ts INTEGER, created_at INTEGER, buyer TEXT, total REAL,
  status TEXT, items TEXT, tracking_code TEXT, shipment_provider TEXT, source TEXT);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE TABLE IF NOT EXISTS income (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, source TEXT, amount REAL, note TEXT, ref TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS idx_income_ts ON income(ts);
CREATE TABLE IF NOT EXISTS products (
  seller_sku TEXT PRIMARY KEY, item_id TEXT, name TEXT, price REAL, sale_price REAL,
  quantity INTEGER, status TEXT, image TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, product_name TEXT, sku TEXT, type TEXT,
  budget REAL, days INTEGER, sale_price REAL, copy TEXT, status TEXT, result TEXT, by_agent TEXT);
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, topic TEXT, status TEXT,
  ended_at INTEGER, summary TEXT, action_items TEXT);
CREATE TABLE IF NOT EXISTS meeting_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, ts INTEGER, agent TEXT, text TEXT);
CREATE INDEX IF NOT EXISTS idx_mnotes ON meeting_notes(meeting_id);
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, source TEXT, target TEXT, text TEXT, status TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT, agent TEXT, title TEXT, content TEXT, stats TEXT, ts INTEGER, UNIQUE(day, agent));
CREATE INDEX IF NOT EXISTS idx_reports_day ON reports(day DESC);
CREATE TABLE IF NOT EXISTS trade_equity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, mode TEXT, balance REAL, equity REAL, profit REAL, margin REAL);
CREATE INDEX IF NOT EXISTS idx_teq ON trade_equity(mode, ts);
CREATE TABLE IF NOT EXISTS trade_deals (
  mode TEXT, ticket INTEGER, ts INTEGER, symbol TEXT, type TEXT, entry TEXT, volume REAL, price REAL, profit REAL,
  commission REAL, swap REAL, fee REAL, order_ticket INTEGER, position_id INTEGER, comment TEXT, magic INTEGER, PRIMARY KEY(mode, ticket));
CREATE INDEX IF NOT EXISTS idx_tdeals ON trade_deals(mode, ts DESC);
CREATE TABLE IF NOT EXISTS trade_orders (
  mode TEXT, ticket INTEGER, ts_setup INTEGER, ts_done INTEGER, symbol TEXT, type TEXT, state TEXT, volume REAL,
  price REAL, sl REAL, tp REAL, comment TEXT, magic INTEGER, position_id INTEGER, reason TEXT, PRIMARY KEY(mode, ticket));
CREATE INDEX IF NOT EXISTS idx_torders ON trade_orders(mode, ts_setup DESC);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, type TEXT, title TEXT, text TEXT, data TEXT, read INTEGER DEFAULT 0);
`);
// Migrasi kolom untuk database versi lama
for (const sql of ['ALTER TABLE tasks ADD COLUMN source TEXT', 'ALTER TABLE orders ADD COLUMN printed_at INTEGER', 'ALTER TABLE orders ADD COLUMN printed_by TEXT',
  'ALTER TABLE ads ADD COLUMN ends_at INTEGER', 'ALTER TABLE ads ADD COLUMN sim_ts INTEGER']) {
  try { db.exec(sql); } catch (_) { /* kolom sudah ada */ }
}

const now = () => Date.now();

let onLog = null;
function log(agent, kind, text) {
  const row = { ts: now(), agent: agent || 'sistem', kind: kind || 'info', text: String(text).slice(0, 600) };
  const r = db.prepare('INSERT INTO activity(ts,agent,kind,text) VALUES(?,?,?,?)').run(row.ts, row.agent, row.kind, row.text);
  if (onLog) try { onLog({ id: r.lastInsertRowid, ...row }); } catch (_) {}
}
const setLogListener = (fn) => { onLog = fn; };
const activity = (agent, limit = 30) => agent
  ? db.prepare('SELECT * FROM activity WHERE agent=? ORDER BY id DESC LIMIT ?').all(agent, limit)
  : db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').all(limit);

const kvGet = (k, d = null) => { const r = db.prepare('SELECT v FROM kv WHERE k=?').get(k); return r ? JSON.parse(r.v) : d; };
const kvSet = (k, v) => db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v));

// Pengaturan yang bisa diubah dari dashboard / Telegram (disimpan di database, default dari .env)
const flagEnv = (n, d) => (process.env[n] === undefined || process.env[n] === '' ? d : String(process.env[n]).toLowerCase() === 'true');
const DEFAULTS = () => ({
  auto_reply: flagEnv('LAZADA_AUTO_REPLY', false),
  auto_pack: flagEnv('LAZADA_AUTO_PACK', false),
  demo_orders: flagEnv('DEMO_ORDERS', true),
  autowork: flagEnv('AGENT_AUTOWORK', true),
  auto_schedule: flagEnv('AUTO_SCHEDULE', true),
  telegram_notify: flagEnv('TELEGRAM_NOTIFY', false),
  auto_print: flagEnv('AUTO_PRINT_RESI', true),
  low_stock: Number(process.env.LOW_STOCK_LIMIT || 5),
  trading_enabled: flagEnv('TRADING_ENABLED', true),
  trading_ai_review: flagEnv('TRADING_AI_REVIEW', true),
  trading_lot: Number(process.env.TRADING_LOT || 0.01),
  trading_max_pending: Number(process.env.TRADING_MAX_PENDING || 1),
  trading_max_positions: Number(process.env.TRADING_MAX_POSITIONS || 1),
  trading_daily_loss_pct: Number(process.env.TRADING_DAILY_LOSS_PCT || 5)
});
const settings = () => ({ ...DEFAULTS(), ...kvGet('settings', {}) });
function setSetting(k, v) {
  if (!(k in DEFAULTS())) throw new Error(`Pengaturan "${k}" tidak dikenal`);
  const s = kvGet('settings', {});
  s[k] = typeof DEFAULTS()[k] === 'number' ? Number(v) : (v === true || v === 'true' || v === 'on' || v === 1);
  kvSet('settings', s);
  return settings();
}

module.exports = { db, DATA_DIR, now, log, activity, kvGet, kvSet, settings, setSetting, setLogListener };
