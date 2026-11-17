// EXPLORE NOW — pengunjung co-op / multiplayer di kantor 3D.
// Setiap browser yang sedang jalan-jalan mengirim posisinya (±6x per detik); server menyiarkan daftar pengunjung lewat SSE "players".
const { broadcast } = require('./notify');

const players = new Map(); // id -> { id, uid, name, char, x, y, z, ry, anim, punchAt, say, at }
const CHARS = ['kama', 'garuda'];
const clean = (s, n) => String(s || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : 0; };
let dirty = false, lastSent = 0;

function update(user, b = {}) {
  const id = clean(b.cid, 40);
  if (!id) throw new Error('cid wajib');
  const name = clean(b.name, 24);
  if (!name) throw new Error('Nama pengunjung wajib diisi');
  const p = players.get(id) || { id, uid: user && user.id };
  if (p.uid && user && p.uid !== user.id) throw new Error('cid dipakai akun lain');
  Object.assign(p, { name, char: CHARS.includes(b.char) ? b.char : 'kama', x: num(b.x, -300, 300), y: num(b.y, -2, 20), z: num(b.z, -300, 300), ry: num(b.ry, -100, 100),
    anim: ['walk', 'run'].includes(b.anim) ? b.anim : 'idle', punchAt: num(b.punchAt, 0, 1e14), punchSide: Number(b.punchSide) < 0 ? -1 : 1, jumpAt: num(b.jumpAt, 0, 1e14), say: clean(b.say, 120), at: Date.now() });
  players.set(id, p);
  dirty = true;
  return { ok: true, online: list().length };
}
function leave(b = {}) { if (players.delete(clean(b.cid, 40))) dirty = true; return { ok: true }; }
const list = () => [...players.values()].filter((p) => Date.now() - p.at < 10000).map(({ uid, at, ...p }) => p);

setInterval(() => {
  const t = Date.now();
  for (const [id, p] of players) if (t - p.at > 10000) { players.delete(id); dirty = true; }
  if (dirty && t - lastSent >= 150) { dirty = false; lastSent = t; broadcast('players', { list: list(), t }); }
}, 150);

module.exports = { update, leave, list };
