// Jam kantor SWEET (WIB) dengan timelapse.
// speed 1 = waktu nyata. speed > 1 = timelapse (mis. 300x: 1 hari kantor = 4,8 menit).
// Jadwal: 04:00 agen datang • 05:00 jam tugas • 12:00 istirahat • 13:00 kerja
//         19:00 jam kerja habis -> laporan • 19:30 pulang ke Stay Home • 20:00-04:00 KANTOR TUTUP
//         (saat tutup tidak ada cetak resi, pesanan tidak diproses / disinkron, agen di rumah)
const { kvGet, kvSet } = require('../db');
const { broadcast } = require('../services/notify');

const WIB = 7 * 3600e3;
const SPEEDS = [1, 60, 300, 900];
const saved = kvGet('clock', null);
let speed = saved && SPEEDS.includes(saved.speed) ? saved.speed : 1;
let simMs = speed > 1 && saved ? saved.simMs : Date.now();
let lastReal = Date.now();
const listeners = [];

const hourOf = (ms) => ((ms + WIB) % 86400e3) / 3600e3;
const dayOf = (ms) => new Date(ms + WIB).toISOString().slice(0, 10);
const hhmm = (ms) => new Date(ms + WIB).toISOString().slice(11, 16);

const OPEN = 5, CLOSE = 19;          // jam kerja 05:00 - 19:00 WIB
function phaseOf(h) {
  if (h < 4) return 'malam';
  if (h < OPEN) return 'datang';
  if (h < 12) return 'kerja';
  if (h < 13) return 'istirahat';
  if (h < CLOSE) return 'kerja';
  if (h < CLOSE + 0.5) return 'laporan';
  if (h < 20) return 'pulang';
  return 'malam';
}
const PHASE_LABEL = { malam: 'Kantor tutup', datang: 'Agen datang', kerja: 'Jam kerja', istirahat: 'Istirahat', laporan: 'Laporan harian', pulang: 'Pulang ke rumah' };
const SCHEDULE = '04:00 datang • 05:00 jam kerja • 12:00 istirahat • 13:00 kerja • 19:00 laporan • 19:30 pulang • 20:00-04:00 tutup';

let phase = phaseOf(hourOf(simMs));
let day = dayOf(simMs);

const now = () => simMs;
function snapshot() {
  const h = hourOf(simMs);
  return { simMs, speed, at: Date.now(), hour: h, time: hhmm(simMs), day, phase, label: PHASE_LABEL[phase], night: h >= 19 || h < 5, closed: phase === 'malam', speeds: SPEEDS, schedule: SCHEDULE };
}
function persist() { kvSet('clock', { speed, simMs }); }
function emit() { broadcast('clock', snapshot()); }

function tick() {
  const r = Date.now();
  const dt = r - lastReal; lastReal = r;
  simMs = speed === 1 ? r : simMs + dt * speed;
  const p = phaseOf(hourOf(simMs)), d = dayOf(simMs);
  if (p !== phase || d !== day) {
    const prev = phase, prevDay = day;
    phase = p; day = d;
    listeners.forEach((fn) => { try { fn(p, prev, d, prevDay); } catch (e) { console.error('[clock]', e.message); } });
    emit();
  }
}

function setSpeed(s) {
  s = Number(s);
  if (!SPEEDS.includes(s)) throw new Error(`Kecepatan harus salah satu dari ${SPEEDS.join(', ')}`);
  tick();
  speed = s;
  if (s === 1) simMs = Date.now();
  persist(); tick(); emit();
  return snapshot();
}

// Lompat ke jam tertentu hari ini (otomatis mengaktifkan timelapse bila sedang waktu nyata)
function jump(time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('Format jam HH:MM');
  tick();
  const base = new Date(simMs + WIB); base.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
  let t = base.getTime() - WIB;
  if (t < simMs - 60e3) t += 86400e3; // jam yang sudah lewat = besok
  if (speed === 1) speed = 60;
  simMs = t; lastReal = Date.now();
  persist(); tick(); emit();
  return snapshot();
}

const onPhase = (fn) => listeners.push(fn);
// Durasi kerja dalam menit-kantor -> milidetik nyata (dibatasi supaya tetap terlihat)
const realMs = (simMinutes, min = 2500, max = 25000) => Math.max(min, Math.min(max, (simMinutes * 60e3) / speed));

setInterval(tick, 500);
setInterval(() => { persist(); emit(); }, 15000);

module.exports = { now, snapshot, setSpeed, jump, onPhase, realMs, phaseOf, hourOf, dayOf, hhmm, get speed() { return speed; }, get phase() { return phase; }, get day() { return day; }, get closed() { return phase === 'malam'; }, PHASE_LABEL, SPEEDS, SCHEDULE, OPEN, CLOSE };
