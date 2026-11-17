// Akun SWEET: daftar dengan Gmail asli + verifikasi kode OTP lewat email, login, sesi, lupa kata sandi, peran admin/pengguna.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, now, log } = require('../db');
const mailer = require('./mailer');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, email_canon TEXT UNIQUE, name TEXT, pass_hash TEXT,
  role TEXT DEFAULT 'user', verified INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0, locked_until INTEGER, created_at INTEGER, last_login INTEGER);
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, purpose TEXT, code_hash TEXT, expires_at INTEGER, attempts INTEGER DEFAULT 0, used INTEGER DEFAULT 0, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, purpose, id DESC);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER, expires_at INTEGER, ip TEXT, ua TEXT, last_seen INTEGER);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

const OTP_TTL = 10 * 60e3, OTP_GAP = 60e3, OTP_MAX_TRY = 5, SESSION_TTL = 30 * 86400e3, LOCK_AFTER = 8, LOCK_MS = 15 * 60e3;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- Validasi Gmail ----------
// Hanya akun Gmail (gmail.com / googlemail.com). Nama pengguna Gmail: 6-30 karakter huruf, angka, titik.
// Kanonik: titik dan "+label" diabaikan (aturan Gmail), supaya satu inbox tidak bisa membuat banyak akun.
function parseGmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  const m = email.match(/^([a-z0-9.+]+)@(gmail\.com|googlemail\.com)$/);
  if (!m) throw err('Gunakan alamat Gmail asli (contoh: namakamu@gmail.com). Email selain Gmail tidak bisa mendaftar.');
  const local = m[1].split('+')[0];
  const plain = local.replace(/\./g, '');
  if (plain.length < 6 || plain.length > 30 || /^\.|\.$|\.\./.test(local) || !/^[a-z0-9]/.test(plain)) throw err('Format alamat Gmail tidak valid.');
  return { email: `${local}@gmail.com`, canon: `${plain}@gmail.com` };
}

function checkPassword(p) {
  p = String(p || '');
  if (p.length < 8) throw err('Kata sandi minimal 8 karakter.');
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) throw err('Kata sandi harus berisi huruf dan angka.');
  if (p.length > 128) throw err('Kata sandi terlalu panjang.');
  return p;
}

function hashPassword(p) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(p, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(p, stored) {
  const [alg, salt, hex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hex) return false;
  const key = crypto.scryptSync(String(p), Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}

const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, role: u.role, verified: !!u.verified, disabled: !!u.disabled, created_at: u.created_at, last_login: u.last_login };
const byCanon = (canon) => db.prepare('SELECT * FROM users WHERE email_canon=?').get(canon);

// ---------- OTP ----------
async function sendOtp(email, purpose) {
  const last = db.prepare('SELECT created_at FROM otp_codes WHERE email=? AND purpose=? ORDER BY id DESC LIMIT 1').get(email, purpose);
  if (last && now() - last.created_at < OTP_GAP) throw err(`Tunggu ${Math.ceil((OTP_GAP - (now() - last.created_at)) / 1000)} detik sebelum meminta kode baru.`, 429);
  const sentToday = db.prepare('SELECT COUNT(*) c FROM otp_codes WHERE email=? AND created_at > ?').get(email, now() - 86400e3).c;
  if (sentToday >= 10) throw err('Terlalu banyak permintaan kode hari ini. Coba lagi besok.', 429);
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  db.prepare('UPDATE otp_codes SET used=1 WHERE email=? AND purpose=? AND used=0').run(email, purpose);
  db.prepare('INSERT INTO otp_codes(email,purpose,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)').run(email, purpose, sha(`${email}:${code}`), now() + OTP_TTL, now());
  if (!mailer.configured() && process.env.MAIL_DEV_LOG === 'true') {
    console.log(`[OTP-DEV] ${email} (${purpose}): ${code}`);
    return { sent: false, dev: true };
  }
  const m = mailer.otpEmail(code, purpose);
  try { await mailer.send({ to: email, ...m }); }
  catch (e) { db.prepare('UPDATE otp_codes SET used=1 WHERE email=? AND purpose=? AND used=0').run(email, purpose); throw err(`Gagal mengirim email kode: ${e.message}`, 502); }
  return { sent: true };
}

function consumeOtp(email, purpose, code) {
  const row = db.prepare('SELECT * FROM otp_codes WHERE email=? AND purpose=? AND used=0 ORDER BY id DESC LIMIT 1').get(email, purpose);
  if (!row) throw err('Kode tidak ditemukan atau sudah dipakai. Minta kode baru.');
  if (now() > row.expires_at) { db.prepare('UPDATE otp_codes SET used=1 WHERE id=?').run(row.id); throw err('Kode sudah kedaluwarsa. Minta kode baru.'); }
  if (row.attempts >= OTP_MAX_TRY) { db.prepare('UPDATE otp_codes SET used=1 WHERE id=?').run(row.id); throw err('Terlalu banyak percobaan. Minta kode baru.', 429); }
  const ok = sha(`${email}:${String(code || '').trim()}`) === row.code_hash;
  if (!ok) {
    db.prepare('UPDATE otp_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
    throw err(`Kode salah. Sisa percobaan: ${OTP_MAX_TRY - row.attempts - 1}.`);
  }
  db.prepare('UPDATE otp_codes SET used=1 WHERE id=?').run(row.id);
  return true;
}

// ---------- Sesi ----------
function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua,last_seen) VALUES(?,?,?,?,?,?,?)')
    .run(sha(token), user.id, now(), now() + SESSION_TTL, String(req.ip || ''), String(req.headers['user-agent'] || '').slice(0, 200), now());
  db.prepare('UPDATE users SET last_login=?, failed=0, locked_until=NULL WHERE id=?').run(now(), user.id);
  return token;
}
function userFromToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(sha(token));
  if (!s || now() > s.expires_at) return null;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  if (!u || u.disabled || !u.verified) return null;
  if (now() - (s.last_seen || 0) > 300e3) db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now(), s.token_hash);
  return u;
}
const destroySession = (token) => token && db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
setInterval(() => { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()); db.prepare('DELETE FROM otp_codes WHERE created_at < ?').run(now() - 7 * 86400e3); }, 3600e3);

// ---------- Alur akun ----------
async function register({ name, email, password }) {
  const g = parseGmail(email);
  checkPassword(password);
  name = String(name || '').trim().slice(0, 60);
  if (name.length < 2) throw err('Nama minimal 2 karakter.');
  const ex = byCanon(g.canon);
  if (ex && ex.verified) throw err('Email ini sudah terdaftar. Silakan masuk.');
  if (ex) db.prepare('UPDATE users SET email=?, name=?, pass_hash=? WHERE id=?').run(g.email, name, hashPassword(password), ex.id);
  else db.prepare('INSERT INTO users(email,email_canon,name,pass_hash,role,verified,created_at) VALUES(?,?,?,?,?,?,?)').run(g.email, g.canon, name, hashPassword(password), 'user', 0, now());
  const r = await sendOtp(g.email, 'register');
  return { email: g.email, ...r };
}

function verifyRegister({ email, code }, req) {
  const g = parseGmail(email);
  const u = byCanon(g.canon);
  if (!u) throw err('Pendaftaran tidak ditemukan. Daftar ulang.');
  if (u.verified) throw err('Akun sudah terverifikasi. Silakan masuk.');
  consumeOtp(u.email, 'register', code);
  db.prepare('UPDATE users SET verified=1 WHERE id=?').run(u.id);
  log('sistem', 'akun', `Akun baru terverifikasi: ${u.email}`);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
  return { user: publicUser(user), token: createSession(user, req) };
}

async function resend({ email, purpose = 'register' }) {
  const g = parseGmail(email);
  const u = byCanon(g.canon);
  if (purpose === 'register') {
    if (!u) throw err('Pendaftaran tidak ditemukan. Daftar ulang.');
    if (u.verified) throw err('Akun sudah terverifikasi. Silakan masuk.');
  }
  if (purpose === 'reset' && (!u || !u.verified)) return { sent: true }; // jangan bocorkan email mana yang terdaftar
  return sendOtp(u.email, purpose);
}

function login({ email, password }, req) {
  let g;
  try { g = parseGmail(email); } catch (_) { throw err('Email atau kata sandi salah.', 401); }
  const u = byCanon(g.canon);
  if (!u) { verifyPassword(password, 'scrypt$00$00'); throw err('Email atau kata sandi salah.', 401); }
  if (u.locked_until && now() < u.locked_until) throw err(`Terlalu banyak percobaan gagal. Coba lagi ${Math.ceil((u.locked_until - now()) / 60e3)} menit lagi.`, 429);
  if (!verifyPassword(password, u.pass_hash)) {
    const f = (u.failed || 0) + 1;
    db.prepare('UPDATE users SET failed=?, locked_until=? WHERE id=?').run(f, f >= LOCK_AFTER ? now() + LOCK_MS : null, u.id);
    throw err('Email atau kata sandi salah.', 401);
  }
  if (!u.verified) throw Object.assign(err('Email belum diverifikasi. Masukkan kode OTP yang dikirim ke Gmail kamu.', 403), { needVerify: true, email: u.email });
  if (u.disabled) throw err('Akun ini dinonaktifkan oleh admin.', 403);
  log('sistem', 'akun', `${u.email} masuk`);
  return { user: publicUser(u), token: createSession(u, req) };
}

async function forgot({ email }) {
  const g = parseGmail(email);
  const u = byCanon(g.canon);
  if (u && u.verified && !u.disabled) await sendOtp(u.email, 'reset');
  return { sent: true };
}

function reset({ email, code, password }, req) {
  const g = parseGmail(email);
  checkPassword(password);
  const u = byCanon(g.canon);
  if (!u || !u.verified) throw err('Kode tidak valid.');
  consumeOtp(u.email, 'reset', code);
  db.prepare('UPDATE users SET pass_hash=?, failed=0, locked_until=NULL WHERE id=?').run(hashPassword(password), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  log('sistem', 'akun', `${u.email} mengganti kata sandi (lupa sandi)`);
  return { user: publicUser(u), token: createSession(u, req) };
}

function changePassword(user, { old, password }) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if (!verifyPassword(old, u.pass_hash)) throw err('Kata sandi lama salah.');
  checkPassword(password);
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(password), u.id);
  return { status: 'ok' };
}

// ---------- Admin ----------
const listUsers = () => db.prepare('SELECT * FROM users ORDER BY role=\'admin\' DESC, id').all().map(publicUser);
function updateUser(admin, id, { role, disabled }) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) throw err('Pengguna tidak ditemukan', 404);
  const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND disabled=0").get().c;
  if (u.id === admin.id && (role === 'user' || disabled)) throw err('Tidak bisa menurunkan / menonaktifkan akun sendiri.');
  if (u.role === 'admin' && (role === 'user' || disabled) && admins <= 1) throw err('Harus ada minimal satu admin aktif.');
  if (role && ['admin', 'user'].includes(role)) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
  if (disabled !== undefined) { db.prepare('UPDATE users SET disabled=? WHERE id=?').run(disabled ? 1 : 0, id); if (disabled) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); }
  log('kevin', 'akun', `Admin mengubah ${u.email}: ${role ? 'peran ' + role : ''}${disabled !== undefined ? (disabled ? ' dinonaktifkan' : ' diaktifkan') : ''}`);
  return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}
function deleteUser(admin, id) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) throw err('Pengguna tidak ditemukan', 404);
  if (u.id === admin.id) throw err('Tidak bisa menghapus akun sendiri.');
  if (u.role === 'admin' && db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c <= 1) throw err('Harus ada minimal satu admin.');
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  log('kevin', 'akun', `Admin menghapus akun ${u.email}`);
  return { status: 'ok' };
}

// ---------- Akun admin awal (dari .env, lalu kata sandi dihapus dari .env) ----------
function seedAdmin() {
  const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD;
  if (!email) return;
  let g;
  try { g = parseGmail(email); } catch (e) { console.warn('ADMIN_EMAIL tidak valid:', e.message); return; }
  const ex = byCanon(g.canon);
  if (ex) {
    if (ex.role !== 'admin' || !ex.verified || ex.disabled) db.prepare("UPDATE users SET role='admin', verified=1, disabled=0 WHERE id=?").run(ex.id);
    // ADMIN_PASSWORD diisi lagi di .env = reset kata sandi admin (jalur pemulihan)
    if (pass) { db.prepare('UPDATE users SET pass_hash=?, failed=0, locked_until=NULL WHERE id=?').run(hashPassword(pass), ex.id); console.log(`Kata sandi admin ${g.email} diperbarui dari .env`); }
  } else {
    if (!pass) { console.warn('ADMIN_PASSWORD kosong — akun admin belum dibuat.'); return; }
    db.prepare('INSERT INTO users(email,email_canon,name,pass_hash,role,verified,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(g.email, g.canon, process.env.ADMIN_NAME || 'Kevin', hashPassword(pass), 'admin', 1, now());
    console.log(`Akun admin dibuat: ${g.email}`);
  }
  // Kata sandi admin sudah aman (ter-hash) di database; hapus dari .env
  if (pass) {
    try {
      const f = path.join(__dirname, '../../.env');
      const s = fs.readFileSync(f, 'utf8');
      const n = s.replace(/^ADMIN_PASSWORD=.*$/m, 'ADMIN_PASSWORD=   # sudah tersimpan (ter-hash) di database; ganti lewat Dashboard > Pengguna');
      if (n !== s) fs.writeFileSync(f, n);
    } catch (_) {}
    delete process.env.ADMIN_PASSWORD;
  }
}

module.exports = { register, verifyRegister, resend, login, forgot, reset, changePassword, listUsers, updateUser, deleteUser, seedAdmin, userFromToken, destroySession, publicUser, parseGmail, mailerConfigured: mailer.configured };
