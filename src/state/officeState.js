// State kantor: posisi/aktivitas agen, mode kantor (kerja / rapat / istirahat), rekrutmen.
// Setiap perubahan dikirim realtime ke Office 3D & Dashboard lewat SSE (event "agent" & "office").
const fs = require('fs');
const path = require('path');
const { AGENTS, BOSS, NPCS, LAYOUT } = require('../agents/config');
const { db, DATA_DIR, log, now } = require('../db');
const { broadcast } = require('../services/notify');

const ROOT = path.join(__dirname, '../..');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
const FOTO_DIR = path.join(ROOT, 'models', 'foto');
const NPC_DIR = path.join(ROOT, 'models', 'npc');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const EXT = ['.jpg', '.jpeg', '.png', '.webp'];
function findPhoto(dir, url, key) {
  for (const e of EXT) if (fs.existsSync(path.join(dir, key + e))) return `${url}/${key}${e}`;
  if (fs.existsSync(path.join(dir, `${key}_face.jpg`))) return `${url}/${key}_face.jpg`;
  return null;
}

class OfficeState {
  constructor() {
    this.agents = AGENTS.map((a) => this._build(a));
    db.prepare('SELECT * FROM recruits ORDER BY created_at').all().forEach((r) => this.agents.push(this._recruitAgent(r)));
    this.boss = { ...BOSS, current_task: 'Memimpin SWEET', thought: 'Memantau kantor', busy: false };
    this.npcs = NPCS.map((n) => ({ ...n }));
    this.mode = 'kerja';            // kerja | rapat | istirahat | pulang
    this.meeting = null;            // { id, topic, speaker }
    this.started = now();
  }

  _build(a) {
    return {
      ...a, type: a.type || 'builtin', room: a.room || `room_${a.job}`,
      telegram_username: a.telegram_username || null, telegram_id: a.telegram_id || null,
      last_activity: now(), current_task: 'Idle', thought: 'Siap menerima tugas', tool_used: null, busy: false, say: null, done_today: 0,
      step: null, step_label: '', flag: null, flag_note: '', blink: false, printing: false
    };
  }
  _recruitAgent(r) {
    return this._build({ ...r, type: 'recruit', dept: 'rekrut', job: `rekrut_${r.key}`, room: 'bullpen', color: '#8aa0b5', furniture: 'desk', tools: ['read'] });
  }

  _avatarPath(u) { return path.join(AVATAR_DIR, `${u.toLowerCase()}.jpg`); }
  _photoFor(a) {
    if (a.type === 'recruit') {
      const p = this._avatarPath(a.telegram_username);
      return fs.existsSync(p) ? `/avatars/${a.telegram_username.toLowerCase()}.jpg?v=${Math.floor(fs.statSync(p).mtimeMs)}` : null;
    }
    return findPhoto(FOTO_DIR, '/models/foto', a.key);
  }

  _public(a, slot) {
    const { tools, routine, ...rest } = a;
    const o = { ...rest, photo: this._photoFor(a) };
    if (slot !== undefined) o.slot = slot;
    return o;
  }

  get_state() {
    let ri = 0;
    return {
      agents: this.agents.map((a) => this._public(a, a.type === 'recruit' ? ri++ : undefined)),
      boss: { ...this.boss, photo: findPhoto(FOTO_DIR, '/models/foto', 'kevin') },
      npcs: this.npcs.map((n) => ({ ...n, photo: findPhoto(NPC_DIR, '/models/npc', n.key) || findPhoto(FOTO_DIR, '/models/foto', n.key) })),
      layout: LAYOUT,
      mode: this.mode,
      meeting: this.meeting,
      is_meeting: this.mode === 'rapat',
      meeting_topic: this.meeting ? this.meeting.topic : '',
      timestamp: now() / 1000
    };
  }

  _emitOffice() { broadcast('office', { mode: this.mode, meeting: this.meeting }); }

  find(ref) {
    if (!ref) return null;
    const r = String(ref).replace(/^@/, '').toLowerCase().trim();
    return this.agents.find((a) => a.key === r || a.job === r || String(a.no) === r || (a.telegram_username || '').toLowerCase() === r ||
      a.name.toLowerCase() === r || a.name.toLowerCase().replace('@', '') === r || a.role.toLowerCase() === r) || null;
  }
  byJob(job) { return this.agents.find((a) => a.job === job) || null; }

  update_agent(key, data) {
    const a = this.agents.find((x) => x.key === key);
    if (!a) return;
    Object.assign(a, data, { last_activity: now() });
    broadcast('agent', { key: a.key, busy: a.busy, current_task: a.current_task, thought: a.thought, tool_used: a.tool_used, say: a.say, done_today: a.done_today,
      step: a.step, step_label: a.step_label, flag: a.flag, flag_note: a.flag_note, blink: a.blink, printing: a.printing, home: a.home || null, trade: a.trade || null });
  }
  work(key, task, thought, tool = null) {
    const a = this.agents.find((x) => x.key === key);
    const wasBusy = a && a.busy;
    this.update_agent(key, { busy: true, current_task: String(task).slice(0, 90), thought: String(thought || task).slice(0, 140), tool_used: tool });
    if (!wasBusy) log(key, 'kerja', String(task).slice(0, 200));
  }
  // Langkah alur kerja meja (dikirim ke Office: ikon di atas meja, printer, tanda $ / !, meja berkedip)
  setStep(key, step, label, extra = {}) {
    this.update_agent(key, { step, step_label: label || '', ...extra });
  }
  setFlag(key, flag, note = '') {
    const a = this.agents.find((x) => x.key === key);
    if (!a || (a.flag === flag && a.flag_note === note)) return;
    this.update_agent(key, { flag, flag_note: note, blink: flag === '!' });
  }
  rest(key, thought = 'Tugas selesai') {
    const a = this.agents.find((x) => x.key === key);
    this.update_agent(key, { busy: false, current_task: 'Idle', thought, tool_used: null, done_today: (a?.done_today || 0) + 1 });
  }
  say(key, text, ms = 7000) {
    this.update_agent(key, { say: String(text).slice(0, 160) });
    setTimeout(() => { const a = this.agents.find((x) => x.key === key); if (a && a.say === String(text).slice(0, 160)) this.update_agent(key, { say: null }); }, ms);
  }

  // ---- Mode kantor ----
  setMode(mode, meeting = null) {
    this.mode = mode;
    this.meeting = meeting;
    this._emitOffice();
  }
  setSpeaker(key) { if (this.meeting) { this.meeting.speaker = key; this._emitOffice(); } }

  // ---- Rekrutmen via username Telegram ----
  recruit(username, role) {
    const u = String(username || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
    if (!/^[A-Za-z0-9_]{5,32}$/.test(u)) return { ok: false, error: 'Username Telegram tidak valid (5-32 karakter huruf/angka/_).' };
    if (this.find(u)) return { ok: false, error: `@${u} sudah menjadi karyawan.` };
    const rec = { key: `tg_${u.toLowerCase()}`, name: `@${u}`, role: (role || 'Staf Baru').trim().slice(0, 40) || 'Staf Baru',
      specialty: 'Mendukung operasional SWEET sesuai arahan Kevin.', telegram_username: u, telegram_id: null, created_at: now() };
    db.prepare('INSERT INTO recruits(key,name,role,specialty,telegram_username,telegram_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(rec.key, rec.name, rec.role, rec.specialty, u, null, rec.created_at);
    const agent = this._recruitAgent(rec);
    this.agents.push(agent);
    log('sistem', 'rekrut', `${agent.name} direkrut sebagai ${agent.role}`);
    broadcast('roster', {});
    return { ok: true, agent };
  }

  fire(ref) {
    const a = this.find(ref);
    if (!a) return { ok: false, error: 'Karyawan tidak ditemukan.' };
    if (a.type !== 'recruit') return { ok: false, error: 'Karyawan bawaan (agent #1-#16) tidak bisa dipecat.' };
    db.prepare('DELETE FROM recruits WHERE key=?').run(a.key);
    this.agents = this.agents.filter((x) => x !== a);
    log('sistem', 'rekrut', `${a.name} dikeluarkan dari kantor`);
    broadcast('roster', {});
    return { ok: true, agent: a };
  }

  linkTelegramUser(user) {
    if (!user || !user.username) return null;
    const a = this.find(user.username);
    if (!a || a.type !== 'recruit') return null;
    if (a.telegram_id !== user.id) {
      a.telegram_id = user.id;
      db.prepare('UPDATE recruits SET telegram_id=? WHERE key=?').run(user.id, a.key);
      log('sistem', 'rekrut', `${a.name} bergabung via Telegram`);
    }
    return a;
  }
  saveAvatar(u, buf) { fs.writeFileSync(this._avatarPath(u), buf); broadcast('roster', {}); }
  hasAvatar(u) { return fs.existsSync(this._avatarPath(u)); }
}

const state = new OfficeState();
state.AVATAR_DIR = AVATAR_DIR;
state.DATA_DIR = DATA_DIR;
module.exports = state;
