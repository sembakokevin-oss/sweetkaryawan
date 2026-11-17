// Stay Home: rumah agen di luar jam kerja (19:30 - 04:00).
// Setiap agen punya kamar (1 kamar = 1 kasur = 2 agen) dan melakukan aktivitas idle sesuai jam:
// tidur, santai di kamar, ngopi, belajar, baca buku, nonton TV, main game, ngobrol berdua, jalan-jalan di taman.
const officeState = require('../state/officeState');
const clock = require('../state/clock');

const ACT = {
  tidur: { label: 'Tidur', dur: [150, 360] },
  santai: { label: 'Santai di kamar', dur: [30, 80] },
  ngopi: { label: 'Ngopi', spots: 8, dur: [25, 60] },
  belajar: { label: 'Belajar', spots: 4, dur: [40, 100] },
  baca: { label: 'Baca buku', spots: 4, dur: [30, 90] },
  nonton: { label: 'Nonton TV', spots: 3, dur: [40, 100] },
  main: { label: 'Main game', spots: 2, dur: [30, 80] },
  ngobrol: { label: 'Ngobrol', pairs: 4, dur: [20, 50] },
  jalan: { label: 'Jalan-jalan di taman', dur: [20, 45] }
};
const ROOMS = 8;

function weights(h) {
  if (h >= 19.5 && h < 21.5) return { ngopi: 3, ngobrol: 3, nonton: 3, main: 2, jalan: 2, belajar: 2, baca: 2, santai: 2, tidur: 0.4 };
  if (h >= 21.5 && h < 23) return { tidur: 4, nonton: 1.5, baca: 2, belajar: 1, ngobrol: 1, santai: 2, main: 1, ngopi: 0.5 };
  if (h >= 23 || h < 3.5) return { tidur: 16, baca: 0.4, santai: 0.4, ngopi: 0.2 };
  if (h >= 3.5 && h < 5) return { ngopi: 4, santai: 2, jalan: 1, tidur: 1 };
  return { ngopi: 3, ngobrol: 3, nonton: 3, main: 2, jalan: 2, belajar: 2, baca: 2, santai: 2 };
}

const LINES = [
  ['Tadi resinya banyak banget ya', 'Iya, printer sampai panas haha'],
  ['Besok target omzet naik lagi!', 'Siap, gas terus!'],
  ['Kopi buatanmu enak juga', 'Rahasianya gula aren'],
  ['Proyek aplikasi kemarin seru', 'Tech Lead sempat balikin satu, untung beres'],
  ['Capek tapi senang hari ini', 'Sama, besok semangat lagi'],
  ['Mau main game habis ini?', 'Boleh, satu ronde aja'],
  ['Promo yang habis sudah diperpanjang?', 'Tinggal tunggu Bos Kevin terima'],
  ['Kamu sudah bikin laporan?', 'Sudah, masuk dashboard tadi jam 7'],
  ['Besok rapat jam berapa?', 'Biasanya Bos panggil pagi'],
  ['Lihat bintangnya bagus ya', 'Iya, tenang banget malam ini']
];

const state = new Map(); // key -> { act, spot, partner, until, line }
const pick = (w) => { const e = Object.entries(w).filter(([, v]) => v > 0); let r = Math.random() * e.reduce((s, [, v]) => s + v, 0); for (const [k, v] of e) { r -= v; if (r <= 0) return k; } return e[0][0]; };
const rnd = (a, b) => a + Math.random() * (b - a);
const atHome = () => officeState.mode === 'pulang';

// Kamar tetap: agen bawaan urut nomor, lalu rekrutan. 2 agen per kamar.
function roomOf(key) {
  const list = officeState.agents.filter((a) => a.type === 'builtin').sort((a, b) => a.no - b.no).concat(officeState.agents.filter((a) => a.type === 'recruit'));
  const i = list.findIndex((a) => a.key === key);
  return i < 0 ? { room: 0, side: 0 } : { room: Math.floor(i / 2) % ROOMS, side: i % 2 };
}
function roommates() {
  const list = officeState.agents.filter((a) => a.type === 'builtin').sort((a, b) => a.no - b.no).concat(officeState.agents.filter((a) => a.type === 'recruit'));
  const rooms = Array.from({ length: ROOMS }, (_, i) => ({ room: i + 1, agents: [] }));
  list.forEach((a, i) => rooms[Math.floor(i / 2) % ROOMS].agents.push(a.key));
  return rooms;
}

function publish(key) {
  const s = state.get(key);
  const a = officeState.find(key);
  if (!a) return;
  const r = roomOf(key);
  let home = null;
  if (s) {
    const partner = s.partner && officeState.find(s.partner);
    home = { act: s.act, spot: s.spot, partner: s.partner || null, room: r.room, side: r.side,
      label: s.act === 'ngobrol' && partner ? `Ngobrol dengan ${partner.name}` : s.act === 'lembur' ? 'Lembur di kantor' : ACT[s.act].label };
  }
  officeState.update_agent(key, { home });
}

function used(act) { return new Set([...state.values()].filter((s) => s.act === act).map((s) => s.spot)); }
function freeSpot(act) {
  const n = ACT[act].spots || ACT[act].pairs;
  if (!n) return 0;
  const u = used(act);
  for (let i = 0; i < n; i++) if (!u.has(i)) return i;
  return -1;
}
const until = (act) => Date.now() + clock.realMs(rnd(...ACT[act].dur), 9000, 80000);

function assign(a) {
  if (a.busy) { state.set(a.key, { act: 'lembur', until: Date.now() + 15000 }); publish(a.key); return; }
  const w = weights(clock.hourOf(clock.now()));
  for (let tries = 0; tries < 6; tries++) {
    const act = pick(w);
    if (act === 'ngobrol') {
      const pairIdx = freeSpot('ngobrol');
      if (pairIdx < 0) continue;
      // cari teman yang sedang bangun dan tidak sedang ngobrol
      const mates = officeState.agents.filter((b) => b.key !== a.key && !b.busy && atHome() && state.get(b.key) && !['tidur', 'ngobrol', 'lembur'].includes(state.get(b.key).act));
      if (!mates.length) continue;
      const b = mates[Math.floor(Math.random() * mates.length)];
      const t = until('ngobrol');
      const line = Math.floor(Math.random() * LINES.length);
      state.set(a.key, { act: 'ngobrol', spot: pairIdx, partner: b.key, until: t, line, role: 0 });
      state.set(b.key, { act: 'ngobrol', spot: pairIdx, partner: a.key, until: t, line, role: 1 });
      publish(a.key); publish(b.key);
      return;
    }
    const spot = freeSpot(act);
    if (spot < 0) continue;
    state.set(a.key, { act, spot, until: until(act) });
    publish(a.key);
    return;
  }
  state.set(a.key, { act: 'santai', spot: 0, until: until('santai') });
  publish(a.key);
}

let lastChat = 0;
function tick() {
  if (!atHome()) {
    if (state.size) { [...state.keys()].forEach((k) => { state.delete(k); publish(k); }); }
    return;
  }
  const t = Date.now();
  officeState.agents.forEach((a) => {
    if (a.type === 'trader') return; // trader kerja 24 jam di tambang
    const s = state.get(a.key);
    if (!s || t >= s.until || (s.act === 'lembur' && !a.busy) || (a.busy && s.act !== 'lembur')) {
      if (s && s.act === 'ngobrol' && s.partner) { const p = state.get(s.partner); if (p && p.partner === a.key) { state.delete(s.partner); } }
      assign(a);
    }
  });
  // Obrolan bergantian (balon bicara)
  if (t - lastChat > 5000) {
    lastChat = t;
    const seen = new Set();
    for (const [k, s] of state) {
      if (s.act !== 'ngobrol' || seen.has(k)) continue;
      seen.add(k); seen.add(s.partner);
      s.turn = ((s.turn || 0) + 1) % 2;
      const speaker = s.turn === s.role ? k : s.partner;
      const pair = LINES[s.line];
      officeState.say(speaker, pair[s.turn] || pair[0], 4500);
    }
  }
}

function snapshot() {
  const counts = {};
  const agents = officeState.agents.filter((a) => a.type !== 'trader').map((a) => {
    const h = a.home;
    if (h) counts[h.act] = (counts[h.act] || 0) + 1;
    return { key: a.key, name: a.name, role: a.role, color: a.color, photo: officeState._public(a).photo, home: h, ...roomOf(a.key) };
  });
  return { active: atHome(), closed: clock.closed, phase: clock.phase, counts, agents, rooms: roommates(), labels: Object.fromEntries(Object.entries(ACT).map(([k, v]) => [k, v.label])) };
}

function startHome() { setInterval(tick, 1000); }

module.exports = { startHome, snapshot, ACT };
