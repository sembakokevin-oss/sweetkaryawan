// Hermes Agent (NousResearch) — dinyalakan otomatis oleh server SWEET.
// SWEET menjalankan "hermes gateway" dengan API server aktif dan kunci = HERMES_API_KEY dari .env,
// jadi kunci di kedua sisi selalu cocok. Di Windows, Hermes berjalan di WSL2 (wsl.exe).
const { spawn } = require('child_process');
const axios = require('axios');
const { log } = require('../db');

const cfg = () => {
  const url = (process.env.HERMES_API_URL || 'http://127.0.0.1:8642/v1').replace(/\/+$/, '');
  let port = 8642, host = '127.0.0.1';
  try { const u = new URL(url); port = Number(u.port) || 8642; host = u.hostname; } catch (_) {}
  return { url, root: url.replace(/\/v1$/, ''), key: process.env.HERMES_API_KEY || '', port, host,
    autostart: String(process.env.HERMES_AUTOSTART || 'true') !== 'false',
    local: ['127.0.0.1', 'localhost'].includes(host), cli: (process.env.HERMES_CLI || '').trim() };
};

let child = null, tail = [], lastError = null, restarts = 0, startedAt = null, state = 'mati';
const push = (line) => { tail.push(String(line).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300)); if (tail.length > 60) tail = tail.slice(-60); };

let live = false;
async function ping() {
  const r = await pingRaw(); live = r.api; return r;
}
async function pingRaw() {
  const c = cfg();
  const headers = c.key ? { Authorization: `Bearer ${c.key}` } : {};
  try { await axios.get(`${c.root}/health`, { timeout: 2500, headers }); return { api: true }; } catch (_) {}
  try { await axios.get(`${c.url}/models`, { timeout: 2500, headers }); return { api: true }; }
  catch (e) { return { api: false, auth: e.response && e.response.status === 401 }; }
}

function command() {
  const c = cfg();
  const inner = 'export PATH="$HOME/.local/bin:$HOME/.hermes/bin:$HOME/.cargo/bin:$PATH"; exec hermes gateway';
  if (c.cli) {
    // HERMES_CLI mis. "wsl -e hermes" atau "hermes"
    const parts = c.cli.split(/\s+/);
    return { cmd: parts[0], args: [...parts.slice(1), 'gateway'] };
  }
  if (process.platform === 'win32') return { cmd: 'wsl.exe', args: ['-e', 'bash', '-lc', inner] };
  return { cmd: 'bash', args: ['-lc', inner] };
}

function start() {
  const c = cfg();
  if (child) return { status: 'sudah berjalan' };
  if (!c.key) throw new Error('HERMES_API_KEY kosong di .env');
  if (!c.local) throw new Error(`HERMES_API_URL mengarah ke ${c.host} (bukan komputer ini), jadi tidak dinyalakan dari sini.`);
  const { cmd, args } = command();
  const env = { ...process.env, API_SERVER_ENABLED: 'true', API_SERVER_KEY: c.key, API_SERVER_PORT: String(c.port), API_SERVER_HOST: '127.0.0.1' };
  if (process.platform === 'win32') env.WSLENV = [process.env.WSLENV, 'API_SERVER_ENABLED', 'API_SERVER_KEY', 'API_SERVER_PORT', 'API_SERVER_HOST'].filter(Boolean).join(':');
  state = 'menyalakan'; lastError = null; startedAt = Date.now();
  push(`$ ${cmd} ${args.join(' ').replace(c.key, '***')}`);
  try { child = spawn(cmd, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { child = null; state = 'gagal'; lastError = e.message; throw e; }
  const onOut = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => {
    push(l);
    if (/API server listening/i.test(l)) { state = 'aktif'; restarts = 0; log('sistem', 'hermes', 'Hermes gateway aktif'); }
    if (/command not found|not recognized|No such file|tidak dikenali/i.test(l)) lastError = 'Hermes belum terpasang. Jalankan scripts\\hermes-install.bat';
  });
  child.stdout.on('data', onOut); child.stderr.on('data', onOut);
  child.on('error', (e) => { lastError = e.code === 'ENOENT' ? `${cmd} tidak ditemukan${process.platform === 'win32' ? ' — WSL belum terpasang (wsl --install)' : ''}` : e.message; push(lastError); });
  child.on('exit', (code) => {
    push(`[keluar dengan kode ${code}]`);
    child = null;
    if (code === 127) lastError = lastError || 'Hermes belum terpasang. Jalankan scripts\\hermes-install.bat';
    state = lastError ? 'gagal' : 'mati';
    // restart otomatis bila sebelumnya sempat aktif / tidak ada error instalasi
    if (!/belum terpasang|tidak ditemukan/.test(lastError || '') && restarts < 3 && Date.now() - startedAt > 5000) {
      restarts++; setTimeout(() => { try { start(); } catch (_) {} }, 5000 * restarts);
    }
  });
  return { status: 'menyalakan' };
}

function stop() { if (child) { child.kill(); child = null; state = 'mati'; } return { status: 'mati' }; }

async function status() {
  const c = cfg();
  const p = await ping();
  if (p.api) state = 'aktif';
  return { api: p.api, auth_error: !!p.auth, url: c.url, state: p.api ? 'aktif' : state, managed: !!child, autostart: c.autostart, error: p.api ? null : lastError, log: tail.slice(-15) };
}

// Saat server SWEET start: nyalakan Hermes bila belum aktif
async function ensure() {
  const c = cfg();
  if (c.key) setInterval(() => ping().catch(() => {}), 20000);
  if (!c.key || !c.autostart || !c.local) { if (c.key) ping().catch(() => {}); return; }
  if ((await ping()).api) { state = 'aktif'; console.log(`Hermes   : aktif di ${c.url}`); return; }
  try { start(); console.log('Hermes   : menyalakan "hermes gateway"...'); }
  catch (e) { console.warn('Hermes   :', e.message); return; }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await ping()).api) { state = 'aktif'; console.log(`Hermes   : aktif di ${c.url}`); return; }
    if (!child) break;
  }
  console.warn(`Hermes   : belum aktif${lastError ? ` — ${lastError}` : ''} (lihat Dashboard › Sistem)`);
}

process.on('exit', () => { if (child) try { child.kill(); } catch (_) {} });

module.exports = { status, start, stop, ensure, ping, isLive: () => live };
