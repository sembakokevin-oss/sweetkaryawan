// Koneksi MetaTrader 5 (akun HFM) untuk agent Aurel.
// Node tidak bisa bicara langsung ke MT5, jadi server menyalakan scripts/mt5_bridge.py (paket resmi MetaTrader5, khusus Windows)
// yang membuka server lokal 127.0.0.1:MT5_BRIDGE_PORT dengan kunci MT5_BRIDGE_KEY.
// Harga & saldo HANYA dari akun HFM. Bila bridge belum terhubung, semua fungsi menolak (agent menunggu).
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const { log } = require('../db');

const ROOT = path.join(__dirname, '../..');
const cfg = () => ({
  login: process.env.MT5_LOGIN || '', server: process.env.MT5_SERVER || '', nickname: process.env.MT5_NICKNAME || '',
  type: process.env.MT5_ACCOUNT_TYPE || 'Cent', platform: 'MetaTrader 5',
  port: Number(process.env.MT5_BRIDGE_PORT || 8765), key: process.env.MT5_BRIDGE_KEY || '',
  autostart: String(process.env.MT5_AUTOSTART || 'true') !== 'false',
  configured: !!(process.env.MT5_LOGIN && process.env.MT5_PASSWORD && process.env.MT5_SERVER)
});

const B = { state: 'mati', live: false, error: null, health: null, child: null, tail: [], restarts: 0, startedAt: 0, checkedAt: 0 };
const push = (l) => { B.tail.push(String(l).slice(0, 300)); if (B.tail.length > 40) B.tail = B.tail.slice(-40); };

async function call(method, p, body, timeout = 20000) {
  const c = cfg();
  const r = await axios({ method, url: `http://127.0.0.1:${c.port}${p}`, data: body, timeout, headers: { 'X-Key': c.key }, validateStatus: () => true });
  if (r.status >= 400) throw new Error((r.data && r.data.error) || `bridge HTTP ${r.status}`);
  return r.data;
}

async function checkHealth() {
  const c = cfg();
  if (!c.configured || !c.key) { B.live = false; return B; }
  if (B.checking) return B;
  B.checking = true;
  try {
    const h = await call('get', '/health', null, 70000);
    B.health = h; B.checkedAt = Date.now();
    if (h.connected && !B.live) { log('aurel', 'trading', `Terhubung ke MetaTrader 5 ${h.server} (login ${h.login}, simbol ${h.symbol})`); }
    if (!h.connected && B.live) log('aurel', 'risiko', `Koneksi MT5 terputus: ${h.error || ''}`);
    B.live = !!h.connected; B.error = h.connected ? null : h.error; B.state = h.connected ? 'aktif' : 'bridge aktif, MT5 belum login';
  } catch (e) {
    if (B.live) log('aurel', 'risiko', `Bridge MT5 tidak menjawab: ${e.message}`);
    B.live = false;
    if (!B.child) B.state = process.platform === 'win32' ? 'mati' : 'butuh Windows';
    if (!B.error || !B.child) B.error = B.error || e.message;
  } finally { B.checking = false; }
  return B;
}

function pythonCmd() {
  if (process.env.PYTHON_CMD) { const p = process.env.PYTHON_CMD.trim().split(/\s+/); return { cmd: p[0], pre: p.slice(1) }; }
  return process.platform === 'win32' ? { cmd: 'python', pre: [] } : { cmd: 'python3', pre: [] };
}

function startBridge(alt = false) {
  const c = cfg();
  if (B.child) return { status: 'sudah berjalan' };
  if (!c.configured) throw new Error('MT5_LOGIN / MT5_PASSWORD / MT5_SERVER belum diisi di .env');
  if (!c.key) throw new Error('MT5_BRIDGE_KEY kosong di .env');
  if (process.platform !== 'win32' && !process.env.PYTHON_CMD) throw new Error('Bridge MetaTrader 5 hanya berjalan di Windows (paket MetaTrader5 khusus Windows)');
  let { cmd, pre } = pythonCmd();
  if (alt) { cmd = 'py'; pre = ['-3']; }
  const script = path.join(ROOT, 'scripts', 'mt5_bridge.py');
  B.state = 'menyalakan'; B.error = null; B.startedAt = Date.now();
  push(`$ ${cmd} ${[...pre, 'scripts/mt5_bridge.py'].join(' ')}`);
  try { B.child = spawn(cmd, [...pre, script], { cwd: ROOT, env: { ...process.env, PYTHONUNBUFFERED: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { B.child = null; B.state = 'gagal'; B.error = e.message; throw e; }
  const onOut = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => {
    push(l.replace(String(process.env.MT5_PASSWORD || '\u0000'), '***'));
    if (/listening/i.test(l)) { B.state = 'bridge aktif'; setTimeout(checkHealth, 500); }
    if (/belum terpasang|No module named/i.test(l)) B.error = 'Paket MetaTrader5 belum terpasang — jalankan scripts\\mt5-install.bat';
    if (/Gagal konek MT5|Login MT5 gagal/.test(l)) B.error = l.replace(/^\d\d:\d\d:\d\d\s*/, '');
  });
  B.child.stdout.on('data', onOut); B.child.stderr.on('data', onOut);
  B.child.on('error', (e) => {
    B.child = null;
    if (e.code === 'ENOENT' && !alt && process.platform === 'win32' && !process.env.PYTHON_CMD) { push('python tidak ditemukan, mencoba "py -3"'); try { startBridge(true); } catch (_) {} return; }
    B.state = 'gagal'; B.error = e.code === 'ENOENT' ? 'Python belum terpasang — jalankan scripts\\mt5-install.bat' : e.message; push(B.error);
  });
  B.child.on('exit', (code) => {
    push(`[bridge keluar, kode ${code}]`);
    B.child = null; B.live = false;
    if (code === 3) B.error = 'Paket MetaTrader5 belum terpasang — jalankan scripts\\mt5-install.bat';
    B.state = B.error ? 'gagal' : 'mati';
    if (code !== 3 && code !== 2 && B.restarts < 20 && Date.now() - B.startedAt > 5000) {
      B.restarts++; setTimeout(() => { try { startBridge(); } catch (_) {} }, Math.min(60000, 5000 * B.restarts));
    }
  });
  return { status: 'menyalakan' };
}
function stopBridge() { if (B.child) { B.child.kill(); B.child = null; } B.live = false; B.state = 'mati'; return { status: 'mati' }; }

// ---------- API (hanya lewat bridge MT5 HFM) ----------
const live = () => B.live;
const mode = () => (B.live ? 'live' : 'offline');
const viaBridge = {
  account: () => call('get', '/account'),
  symbol: () => call('get', '/symbol'),
  rates: (tf = 'M15', count = 300) => call('get', `/rates?tf=${tf}&count=${count}`),
  positions: () => call('get', '/positions'),
  orders: () => call('get', '/orders'),
  history: (from, to) => call('get', `/history?from=${Math.floor(from)}&to=${Math.floor(to)}`, null, 40000),
  placePending: (o) => call('post', '/order', o),
  cancel: (ticket) => call('post', '/cancel', { ticket }),
  close: (ticket) => call('post', '/close', { ticket })
};
const api = new Proxy({}, { get: (_, k) => async (...a) => { if (!B.live) throw new Error('MT5 HFM belum terhubung'); return viaBridge[k](...a); } });

function info() {
  const c = cfg();
  return { mode: mode(), configured: c.configured, login: c.login, server: c.server, nickname: c.nickname, account_type: c.type, platform: c.platform,
    bridge: { state: B.state, live: B.live, error: B.error, symbol: B.health && B.health.symbol, terminal: B.health && B.health.terminal, tail: B.tail.slice(-12), windows: process.platform === 'win32' } };
}

function init() {
  const c = cfg();
  if (c.configured && c.autostart && process.platform === 'win32') {
    checkHealth().then(() => { if (!B.live) { try { startBridge(); } catch (e) { B.error = e.message; } } });
  } else if (c.configured && process.platform !== 'win32') { B.state = 'butuh Windows'; B.error = 'Bridge MT5 hanya berjalan di Windows'; }
  setInterval(checkHealth, 15000);
}

module.exports = { init, api, info, mode, live, startBridge, stopBridge, checkHealth };
