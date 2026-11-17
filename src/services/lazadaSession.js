// Cookies sesi Seller Center (sellercenter.lazada.co.id) — disimpan PERMANEN di database (tabel kv, kunci "lazada_cookies").
// Upload dari Dashboard › Sistem. cookies.txt lama di folder proyek otomatis diimpor sekali ke database.
// Isi cookie TIDAK PERNAH ditampilkan / dicatat di log; hanya nama, jumlah, dan masa berlaku yang dilaporkan.
// Format: Netscape cookies.txt, JSON (Cookie-Editor / EditThisCookie), atau header "a=b; c=d".
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { kvGet, kvSet, log } = require('../db');

const FILE = () => process.env.LAZADA_COOKIES_FILE ? path.resolve(process.env.LAZADA_COOKIES_FILE) : path.join(__dirname, '../../cookies.txt');
const BASE = 'https://sellercenter.lazada.co.id';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
// Cookie yang biasanya menandakan sesi login Lazada
const SESSION_HINTS = /^(lzd_sid|_tb_token_|lzd_uid|sc_sid|asc_sid|t_sid|CSRFT|_m_h5_tk)$/i;

function parse(raw) {
  const text = String(raw || '').trim();
  const out = [];
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const j = JSON.parse(text); const arr = Array.isArray(j) ? j : j.cookies || [];
      for (const c of arr) if (c && c.name) out.push({ name: c.name, value: String(c.value ?? ''), domain: c.domain || '', path: c.path || '/', expires: Number(c.expirationDate || c.expires || c.expiry || 0) || 0 });
      return out;
    } catch (_) { /* format lain */ }
  }
  if (!text.includes('\t') && text.includes('=') && !/^#/.test(text)) {
    for (const part of text.replace(/^cookie:\s*/i, '').split(';')) { const i = part.indexOf('='); if (i > 0) out.push({ name: part.slice(0, i).trim(), value: part.slice(i + 1).trim(), domain: '', path: '/', expires: 0 }); }
    return out;
  }
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('#HttpOnly_')) line = line.slice(10);
    else if (line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length >= 7) out.push({ domain: f[0], path: f[2] || '/', expires: Number(f[4]) || 0, name: f[5], value: f.slice(6).join('\t') });
  }
  return out;
}

const lazadaOnly = (all) => all.filter((c) => !c.domain || /lazada/i.test(c.domain));

// ---------- Penyimpanan permanen (database) ----------
function stored() {
  let s = kvGet('lazada_cookies', null);
  if (!s) {
    // Impor sekali dari cookies.txt lama
    try {
      const raw = fs.readFileSync(FILE(), 'utf8');
      if (lazadaOnly(parse(raw)).length) {
        s = { raw, ua: process.env.LAZADA_COOKIES_UA || '', at: Date.now(), by: 'impor cookies.txt', source: 'file' };
        kvSet('lazada_cookies', s);
        log('sistem', 'lazada', 'cookies.txt diimpor ke database');
      }
    } catch (_) { /* belum ada file */ }
  }
  return s;
}

function load() {
  const s = stored();
  if (!s) return { found: false, cookies: [] };
  const all = parse(s.raw);
  const rel = lazadaOnly(all);
  const nowS = Date.now() / 1000;
  const expired = rel.filter((c) => c.expires && c.expires < nowS);
  return { found: true, cookies: rel, total: all.length, expired, ua: s.ua, at: s.at, by: s.by };
}

function cookieHeader(host = 'sellercenter.lazada.co.id') {
  const nowS = Date.now() / 1000;
  return load().cookies
    .filter((c) => (!c.expires || c.expires > nowS) && (!c.domain || host.endsWith(c.domain.replace(/^\./, ''))))
    .map((c) => `${c.name}=${c.value}`).join('; ');
}

let last = kvGet('lazada_cookies_check', null);
function status() {
  const s = load();
  const nowS = Date.now() / 1000;
  const sess = s.cookies.filter((c) => SESSION_HINTS.test(c.name));
  const nextExp = s.cookies.filter((c) => c.expires && c.expires > nowS).sort((a, b) => a.expires - b.expires)[0];
  return {
    found: s.found, cookies: s.cookies.length, expired: (s.expired || []).length,
    expired_names: (s.expired || []).map((c) => c.name).slice(0, 12),
    session_cookies: sess.map((c) => ({ name: c.name, expires: c.expires ? c.expires * 1000 : null, expired: !!(c.expires && c.expires < nowS) })),
    next_expiry: nextExp ? { name: nextExp.name, at: nextExp.expires * 1000 } : null,
    uploaded_at: s.at || null, uploaded_by: s.by || null, ua: !!s.ua, storage: 'database', session: last
  };
}

function save(raw, { ua = '', by = 'dashboard' } = {}) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('File cookies kosong');
  if (text.length > 1024 * 1024) throw new Error('File cookies terlalu besar');
  const all = parse(text);
  const rel = lazadaOnly(all);
  if (!rel.length) throw new Error('Tidak ada cookie Lazada di file ini. Ekspor cookies saat login di sellercenter.lazada.co.id (format Netscape cookies.txt atau JSON).');
  kvSet('lazada_cookies', { raw: text, ua: String(ua || '').slice(0, 400), at: Date.now(), by, source: 'upload' });
  last = null; kvSet('lazada_cookies_check', null);
  log('sistem', 'lazada', `cookies Seller Center disimpan ke database (${rel.length} cookie, oleh ${by})`);
  return { saved: true, cookies: rel.length, total: all.length };
}

function clear() { kvSet('lazada_cookies', null); kvSet('lazada_cookies_check', null); last = null; return { cleared: true }; }

// ---------- Cek sesi: ikuti redirect sambil membawa cookie, deteksi halaman login ----------
const LOGIN_RE = /\/login|signin|passport|member\.lazada|\/seller\/login|auth\/login/i;
async function checkRaw() {
  const s = load();
  if (!s.found) return { ok: false, reason: 'Belum ada cookies. Upload cookies.txt di Dashboard › Sistem.' };
  if (!s.cookies.length) return { ok: false, reason: 'Tidak ada cookie Lazada' };
  const live = s.cookies.filter((c) => !c.expires || c.expires > Date.now() / 1000);
  if (!live.length) return { ok: false, reason: `Semua ${s.cookies.length} cookie sudah kedaluwarsa. Login ulang di browser lalu ekspor & upload lagi.` };
  const jar = new Map(live.map((c) => [c.name, c.value]));
  const ua = s.ua || process.env.LAZADA_COOKIES_UA || DEFAULT_UA;
  let url = `${BASE}/apps/home/new`, hops = 0, res;
  try {
    while (hops < 8) {
      res = await axios.get(url, {
        headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8', Referer: `${BASE}/` },
        maxRedirects: 0, validateStatus: () => true, timeout: 20000, responseType: 'text', transformResponse: (x) => x
      });
      for (const sc of [].concat(res.headers['set-cookie'] || [])) { const [kv] = sc.split(';'); const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
      const loc = res.headers.location;
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url).toString();
        if (LOGIN_RE.test(new URL(url).pathname) || /member\.lazada|passport/i.test(new URL(url).host)) {
          return { ok: false, status: res.status, reason: 'Diarahkan ke halaman login — sesi Seller Center sudah kedaluwarsa. Login ulang di browser (Chrome yang sama), ekspor cookies lagi, lalu upload.', final: new URL(url).host + new URL(url).pathname };
        }
        hops++; continue;
      }
      break;
    }
    const body = String(res.data || '').slice(0, 200000);
    const finalPath = new URL(url).pathname;
    if (res.status === 200 && (LOGIN_RE.test(finalPath) || /id="login-form"|name="loginForm"|"isLogin"\s*:\s*false/i.test(body))) {
      return { ok: false, status: 200, reason: 'Halaman login ditampilkan — sesi kedaluwarsa. Login ulang di browser lalu upload cookies baru.' };
    }
    if (res.status === 200) return { ok: true, status: 200, reason: `Sesi aktif (${new URL(url).pathname})` };
    if (res.status === 403) return { ok: false, status: 403, reason: 'Ditolak Lazada (403). Pastikan cookies diekspor dari browser yang sama dan coba lagi.' };
    return { ok: false, status: res.status, reason: `Respons HTTP ${res.status}` };
  } catch (e) { return { ok: false, reason: `Tidak bisa menghubungi Seller Center: ${e.code || e.message}` }; }
}

async function check() {
  const r = await checkRaw();
  last = { ok: !!r.ok, reason: r.reason, at: Date.now() };
  kvSet('lazada_cookies_check', last);
  return r;
}

module.exports = { status, check, cookieHeader, save, clear, parse };
