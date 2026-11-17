// Alur kerja meja 15 agen (mengikuti jam kantor & timelapse):
//   jam tugas -> memantau PC -> cek toko Lazada -> print resi (jika ada pembeli) -> cek promosi produk (habis = tanda $)
//   -> print resi (resi otomatis masuk dashboard) -> menunggu keputusan -> tanda ! mendesak + meja berkedip -> ulang
//   19:00 jam kerja habis -> setiap agen membuat laporan harian (masuk dashboard) -> pulang ke Stay Home. 20:00-04:00 kantor tutup.
const officeState = require('../state/officeState');
const clock = require('../state/clock');
const stats = require('../services/stats');
const ads = require('../services/ads');
const orders = require('../services/orders');
const pipeline = require('./pipeline');
const { db, now, log, settings, kvGet, kvSet } = require('../db');
const { notify } = require('../services/notify');

const rp = stats.rupiah;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const jitter = () => 0.75 + Math.random() * 0.5;
const URGENT_SIM_MIN = Number(process.env.URGENT_MINUTES || 60);

// Langkah siklus; durasi dalam menit-kantor
const CYCLE = ['monitor', 'cek_toko', 'print1', 'cek_promo', 'print2', 'menunggu'];
const DUR = { tugas: 4, monitor: 25, cek_toko: 6, print: 4, cek_promo: 6, menunggu: 6, laporan: 10, skip: 1 };
const LABEL = { tugas: 'Jam tugas dimulai', monitor: 'Memantau PC', cek_toko: 'Cek toko Lazada', print: 'Print resi', cek_promo: 'Cek promosi produk', menunggu: 'Menunggu keputusan', laporan: 'Membuat laporan harian' };

const run = {};   // key -> { i, nextAt, step, data }
const counters = {}; // key -> statistik shift
let shiftStartReal = kvGet('shift_start_real', null);
const newCounter = () => ({ monitor: 0, cek_toko: 0, printed: 0, promo: 0, urgent: 0, menunggu: 0, newBuyers: 0, notes: [] });
const C = (key) => (counters[key] = counters[key] || newCounter());

// ---------- Pemeriksaan sesuai kerjaan (data nyata) ----------
const CHECKS = {
  stock() {
    const low = db.prepare('SELECT * FROM products WHERE quantity <= ? ORDER BY quantity').all(settings().low_stock);
    const warned = new Set(kvGet('low_warned', []));
    const fresh = low.filter((p) => !warned.has(`${p.seller_sku}:${clock.day}`));
    if (fresh.length) {
      notify({ type: 'warn', title: `Stok menipis: ${fresh.length} produk`, text: fresh.map((p) => `${p.name} (${p.seller_sku}) sisa ${p.quantity}`).join('\n') });
      fresh.forEach((p) => warned.add(`${p.seller_sku}:${clock.day}`));
      kvSet('low_warned', [...warned].slice(-200));
    }
    return low.length ? `${low.length} produk stok menipis` : 'Semua stok aman';
  },
  analis() { const k = stats.kpi(); return `Omzet hari ini ${rp(k.today_revenue)} • ${k.today_orders} pesanan • ${k.today_buyers} pembeli`; },
  order() { const k = stats.kpi(); return `${k.pending_orders} pesanan menunggu • ${k.active_resi} resi aktif`; },
  ads() {
    if (kvGet('ads_auto_day') === clock.day) return `${db.prepare("SELECT COUNT(*) c FROM ads WHERE status='running'").get().c} iklan berjalan dipantau`;
    kvSet('ads_auto_day', clock.day);
    const top = stats.topProducts(14, 5);
    const busy = new Set(db.prepare("SELECT product_name FROM ads WHERE status IN ('proposed','running')").all().map((a) => a.product_name));
    const target = top.find((p) => !busy.has(p.name));
    if (!target) return 'Semua produk terlaris sudah diiklankan';
    const prod = db.prepare('SELECT * FROM products WHERE lower(name)=lower(?)').get(target.name);
    ads.propose({ product_name: target.name, sku: prod?.seller_sku, type: 'sponsored', budget: 50000, days: 3,
      copy: `${target.name} — favorit pembeli SWEET, sudah ${target.qty} terjual. Stok terbatas, checkout sekarang!`, by: 'mira' });
    return `Proposal iklan harian untuk ${target.name}`;
  },
  db() { const h = stats.dbHealth(); const dup = h.duplikat.pemasukan + h.duplikat.nama_produk; return dup ? `Menemukan ${dup} indikasi data dobel` : `Database sehat (${h.counts.orders} pesanan)`; },
  devops() { return `Server sehat • uptime ${Math.round(process.uptime() / 60)} menit • RAM ${Math.round(process.memoryUsage().rss / 1048576)} MB`; }
};

// ---------- Langkah-langkah ----------
function lastCheck(a) { return kvGet(`lastcheck_${a.key}`, now() - 3600e3); }

const STEP = {
  monitor(a) {
    const job = pipeline.runningId() && a.dept === 'dev' ? `Proyek #${pipeline.runningId()}` : pick(a.routine || ['Merapikan pekerjaan']);
    officeState.setStep(a.key, 'monitor', `Memantau PC · ${job}`, { printing: false });
    C(a.key).monitor++;
    return { dur: DUR.monitor, done: () => {
      let result = null;
      try { if (CHECKS[a.job]) result = CHECKS[a.job](); } catch (e) { result = `Kendala: ${e.message}`; }
      if (result) { officeState.update_agent(a.key, { thought: result }); C(a.key).notes.push(result); }
      if (clock.speed <= 60) {
        db.prepare('INSERT INTO tasks(ts,agent,title,source,status,result,finished_at) VALUES(?,?,?,?,?,?,?)').run(now(), a.key, job, 'otomatis', 'done', result || 'Selesai', now());
      }
    } };
  },
  cek_toko(a) {
    const since = lastCheck(a);
    const n = db.prepare("SELECT COUNT(*) c FROM orders WHERE created_at > ? AND status NOT IN ('canceled','failed')").get(since).c;
    kvSet(`lastcheck_${a.key}`, now());
    C(a.key).cek_toko++;
    officeState.setStep(a.key, 'cek_toko', n ? `Cek toko Lazada · ${n} pembeli baru` : 'Cek toko Lazada · belum ada pembeli baru');
    if (n) { C(a.key).newBuyers += n; if (a.job === 'order') officeState.say(a.key, `Ada ${n} pembeli baru, resi segera dicetak.`, 4000); }
    return { dur: DUR.cek_toko };
  },
  async print(a) {
    if (!settings().auto_print) return { dur: DUR.skip, label: 'Print resi otomatis dimatikan' };
    // Dimas mengemas pesanan tanpa resi bila auto_pack aktif
    if (a.job === 'order' && settings().auto_pack) {
      for (const o of orders.pendingNoResi()) { try { await orders.pack(o.order_id); } catch (_) { /* coba lagi siklus berikutnya */ } }
    }
    const o = orders.claimForPrint(a.key);
    if (!o) { officeState.setStep(a.key, 'print', 'Print resi · tidak ada resi baru', { printing: false }); return { dur: DUR.skip }; }
    officeState.setStep(a.key, 'print', `Print resi #${o.order_id}`, { printing: true });
    return { dur: DUR.print, done: () => {
      officeState.update_agent(a.key, { printing: false });
      C(a.key).printed++;
      orders.announcePrinted(o, a.key);
    } };
  },
  cek_promo(a) {
    officeState.setStep(a.key, 'cek_promo', 'Cek promosi produk');
    C(a.key).promo += 0;
    return { dur: DUR.cek_promo, done: () => {
      const ex = ads.expired();
      if (!ex.length) return;
      for (const ad of ex) {
        ads.finish(ad.id, 'Masa promo habis');
        C(a.key).promo++;
        log(a.key, 'promo', `Promo #${ad.id} ${ad.product_name} habis`);
        const re = ads.propose({ product_name: ad.product_name, sku: ad.sku, type: ad.type, budget: ad.budget, days: ad.days, sale_price: ad.sale_price, copy: ad.copy, by: 'mira',
          note: `Promo #${ad.id} habis (ditemukan ${a.name}). Perpanjang?` });
        officeState.setFlag(a.key, '$', `Promo ${ad.product_name} habis — menunggu Terima (#${re.id})`);
        const mira = officeState.byJob('ads');
        if (mira && mira.key !== a.key) officeState.setFlag(mira.key, '$', `Perpanjangan promo ${ad.product_name} (#${re.id})`);
      }
    } };
  },
  menunggu(a) {
    const p = ads.pending();
    C(a.key).menunggu++;
    if (!p.length) { officeState.setStep(a.key, 'menunggu', 'Menunggu keputusan · tidak ada yang tertunda'); return { dur: DUR.skip }; }
    officeState.setStep(a.key, 'menunggu', `Menunggu keputusan Kevin · ${p.length} proposal`);
    return { dur: DUR.menunggu };
  }
};

// Tanda mendesak: keputusan yang terlalu lama tertunda, stok habis, pesanan tertahan
function refreshFlags() {
  const p = ads.pending();
  const oldest = p.length ? Math.min(...p.map((x) => x.sim_ts || x.ts)) : null;
  const urgentAds = oldest !== null && clock.now() - oldest > URGENT_SIM_MIN * 60e3;
  const zero = db.prepare('SELECT COUNT(*) c FROM products WHERE quantity <= 0').get().c;
  const stuck = db.prepare("SELECT COUNT(*) c FROM orders WHERE status IN ('pending','unpaid') AND created_at < ?").get(now() - Math.max(60e3, 2 * 3600e3 / clock.speed)).c;
  const want = {};
  if (urgentAds) {
    const note = `${p.length} proposal iklan menunggu keputusan Kevin`;
    want[officeState.byJob('ads')?.key] = note;
    Object.entries(run).forEach(([k, r]) => { if (r.step === 'menunggu') want[k] = note; });
  }
  if (zero) want[officeState.byJob('stock')?.key] = `${zero} produk stok habis`;
  if (stuck) want[officeState.byJob('order')?.key] = `${stuck} pesanan tertahan belum diproses`;
  const pendingIds = new Set(p.map((x) => x.id));
  officeState.agents.forEach((a) => {
    if (a.type !== 'builtin') return;
    if (want[a.key]) {
      if (a.flag !== '!') { C(a.key).urgent++; log(a.key, 'mendesak', want[a.key]); }
      officeState.setFlag(a.key, '!', want[a.key]);
    } else if (a.flag === '!') officeState.setFlag(a.key, null);
    else if (a.flag === '$') {
      const id = Number((a.flag_note.match(/#(\d+)\)/) || [])[1]);
      if (!id || !pendingIds.has(id)) officeState.setFlag(a.key, null);
    }
  });
}

// ---------- Jadwal ----------
const working = () => settings().auto_schedule ? ['kerja', 'laporan'].includes(clock.phase) : true;

async function advance(a) {
  const r = run[a.key] = run[a.key] || { i: -1, nextAt: 0 };
  if (r.pending) return;
  r.pending = true;
  try {
    if (r.done) { try { await r.done(); } catch (e) { log(a.key, 'error', e.message); } r.done = null; }
    if (clock.phase === 'laporan' && settings().auto_schedule) {
      if (r.step !== 'laporan') { officeState.setStep(a.key, 'laporan', LABEL.laporan, { printing: false }); r.step = 'laporan'; }
      r.nextAt = Date.now() + 3000; return;
    }
    let step, res;
    if (r.i < 0) { step = 'tugas'; officeState.setStep(a.key, 'tugas', `Jam tugas · ${clock.hhmm(clock.now())}`); res = { dur: DUR.tugas }; r.i = 0; }
    else {
      const name = CYCLE[r.i % CYCLE.length]; r.i++;
      step = name.startsWith('print') ? 'print' : name;
      res = await STEP[step](a);
    }
    r.step = step; r.done = res.done || null;
    r.nextAt = Date.now() + clock.realMs(res.dur) * jitter();
  } finally { r.pending = false; }
}

function tick() {
  if (!working() || officeState.mode !== 'kerja') return;
  const t = Date.now();
  officeState.agents.forEach((a) => {
    if (a.type !== 'builtin' || a.busy) return;
    const r = run[a.key];
    if (!r || t >= r.nextAt) advance(a).catch((e) => log(a.key, 'error', e.message));
  });
}

// ---------- Laporan harian ----------
function buildReports(day) {
  if (db.prepare('SELECT COUNT(*) c FROM reports WHERE day=?').get(day).c) return 0;
  const from = shiftStartReal || stats.startOfToday(), to = now();
  const sum = (sql, ...x) => db.prepare(sql).get(...x).s || 0;
  const cnt = (sql, ...x) => db.prepare(sql).get(...x).c || 0;
  let n = 0;
  const totals = newCounter();
  officeState.agents.filter((a) => a.type === 'builtin').forEach((a) => {
    const c = C(a.key);
    Object.keys(totals).forEach((k) => { if (typeof totals[k] === 'number') totals[k] += c[k]; });
    const tasks = db.prepare("SELECT title, status FROM tasks WHERE agent=? AND ts BETWEEN ? AND ? AND source != 'otomatis' ORDER BY id DESC LIMIT 6").all(a.key, from, to);
    const done = cnt("SELECT COUNT(*) c FROM tasks WHERE agent=? AND ts BETWEEN ? AND ? AND status='done'", a.key, from, to);
    const failed = cnt("SELECT COUNT(*) c FROM tasks WHERE agent=? AND ts BETWEEN ? AND ? AND status='failed'", a.key, from, to);
    const lastNote = c.notes[c.notes.length - 1];
    const content = [
      `# Laporan harian — ${a.name} (${a.role})`,
      `Tanggal ${day} • jam kerja 05:00–19:00`,
      '',
      '## Ringkasan',
      `- Memantau PC: ${c.monitor} kali`,
      `- Cek toko Lazada: ${c.cek_toko} kali (${c.newBuyers} pembeli baru terpantau)`,
      `- Resi dicetak: ${c.printed}`,
      `- Promo habis ditemukan: ${c.promo}`,
      `- Menunggu keputusan: ${c.menunggu} kali • tanda mendesak: ${c.urgent}`,
      `- Tugas selesai: ${done}${failed ? ` • gagal: ${failed}` : ''}`,
      '',
      '## Pekerjaan utama',
      ...(tasks.length ? tasks.map((x) => `- ${x.title} (${x.status === 'done' ? 'selesai' : x.status})`) : [`- ${a.specialty}`]),
      ...(lastNote ? ['', '## Catatan', `- ${lastNote}`] : [])
    ].join('\n');
    db.prepare('INSERT OR IGNORE INTO reports(day,agent,title,content,stats,ts) VALUES(?,?,?,?,?,?)')
      .run(day, a.key, `Laporan ${a.name}`, content, JSON.stringify({ ...c, notes: undefined, done, failed }), now());
    n++;
  });
  const rev = sum('SELECT SUM(amount) s FROM income WHERE ts BETWEEN ? AND ?', from, to);
  const ord = cnt("SELECT COUNT(*) c FROM orders WHERE created_at BETWEEN ? AND ? AND status NOT IN ('canceled','failed')", from, to);
  const buyers = cnt("SELECT COUNT(DISTINCT buyer) c FROM orders WHERE created_at BETWEEN ? AND ? AND status NOT IN ('canceled','failed')", from, to);
  const k = stats.kpi();
  const company = [
    `# Laporan perusahaan SWEET — ${day}`,
    '',
    '## Keuangan (selama jam kerja)',
    `- Pendapatan: ${rp(rev)}`,
    `- Pesanan: ${ord} dari ${buyers} pembeli`,
    `- Pendapatan hari ini (total): ${rp(k.today_revenue)} • 7 hari: ${rp(k.week_revenue)}`,
    '',
    '## Operasional',
    `- Resi dicetak: ${totals.printed} • resi aktif: ${k.active_resi} • menunggu proses: ${k.pending_orders}`,
    `- Promo habis: ${totals.promo} • iklan berjalan: ${k.ads_running} • menunggu Terima: ${k.ads_proposed}`,
    `- Tanda mendesak: ${totals.urgent} • stok menipis: ${k.low_stock}`,
    `- Total siklus kerja agen: ${totals.monitor}`
  ].join('\n');
  try { require('./trader').report(day, from, to); n++; } catch (e) { log('aurel', 'error', `Laporan trading gagal: ${e.message}`); }
  db.prepare('INSERT OR IGNORE INTO reports(day,agent,title,content,stats,ts) VALUES(?,?,?,?,?,?)')
    .run(day, 'perusahaan', 'Laporan perusahaan', company, JSON.stringify({ revenue: rev, orders: ord, buyers, printed: totals.printed, promo: totals.promo, urgent: totals.urgent }), now());
  notify({ type: 'project', title: `Laporan harian ${day} masuk dashboard`, text: `${n} laporan agen + laporan perusahaan\nPendapatan ${rp(rev)} • ${ord} pesanan • ${totals.printed} resi dicetak`, data: { report_day: day } });
  log('sistem', 'laporan', `Laporan harian ${day} dibuat (${n} agen)`);
  return n + 1;
}

// ---------- Transisi jam ----------
function applyPhase(p) {
  if (!settings().auto_schedule || officeState.mode === 'rapat' || officeState.manualMode) return;
  const mode = p === 'istirahat' ? 'istirahat' : ['kerja', 'laporan', 'datang'].includes(p) ? 'kerja' : 'pulang';
  if (officeState.mode !== mode) officeState.setMode(mode, null);
}

clock.onPhase((p, prev, day, prevDay) => {
  officeState.manualMode = false;
  if (p === 'kerja' && ['datang', 'malam'].includes(prev)) {
    shiftStartReal = now(); kvSet('shift_start_real', shiftStartReal);
    Object.keys(counters).forEach((k) => delete counters[k]);
    Object.keys(run).forEach((k) => delete run[k]);
    log('sistem', 'kantor', `Jam tugas dimulai ${day} 05:00`);
    notify({ type: 'info', title: 'Jam tugas dimulai', text: `${day} • 15 agen kantor mulai bekerja (Aurel trading 24 jam)`, telegram: false });
  }
  if (p === 'istirahat') log('sistem', 'kantor', 'Jam istirahat 12:00');
  if (p === 'kerja' && prev === 'istirahat') log('sistem', 'kantor', 'Kembali bekerja 13:00');
  if (p === 'laporan') log('sistem', 'kantor', 'Jam kerja habis 19:00 — agen membuat laporan');
  if (p === 'pulang') log('sistem', 'kantor', '19:30 agen pulang ke Stay Home');
  if (p === 'malam') { log('sistem', 'kantor', '20:00 kantor tutup — tidak ada cetak resi & pesanan tidak diproses sampai 04:00'); notify({ type: 'info', title: 'Kantor tutup', text: '20:00–04:00 • agen istirahat di Stay Home. Pesanan diproses lagi mulai pagi.', telegram: false }); }
  if (p === 'datang' && prev === 'malam') { log('sistem', 'kantor', '04:00 kantor buka — agen berangkat dari rumah'); notify({ type: 'info', title: 'Kantor buka', text: '04:00 agen berangkat • jam kerja mulai 05:00', telegram: false }); }
  // Laporan dibuat saat meninggalkan jam laporan (atau bila jam dilompati melewati jam kerja)
  if (['pulang', 'malam'].includes(p) && ['laporan', 'kerja', 'istirahat'].includes(prev)) {
    buildReports(prevDay || day);
    officeState.agents.forEach((a) => { if (a.type === 'builtin') officeState.setStep(a.key, null, '', { printing: false }); });
  }
  applyPhase(p);
});

function startShift() {
  applyPhase(clock.phase);
  setInterval(tick, 500);
  setInterval(refreshFlags, 4000);
  setInterval(() => applyPhase(clock.phase), 3000);
  ads.onChange(() => setTimeout(refreshFlags, 200));
  console.log(`Jam kantor: ${clock.hhmm(clock.now())} (${clock.PHASE_LABEL[clock.phase]}), kecepatan ${clock.speed}x`);
}

const reports = {
  days: (limit = 30) => db.prepare("SELECT day, COUNT(*) n, MAX(ts) ts FROM reports GROUP BY day ORDER BY day DESC LIMIT ?").all(limit),
  byDay: (day) => db.prepare('SELECT * FROM reports WHERE day=? ORDER BY agent=\'perusahaan\' DESC, id').all(day).map((r) => ({ ...r, stats: JSON.parse(r.stats || '{}') })),
  build: (day) => buildReports(day || clock.day)
};

module.exports = { startShift, reports, buildReports, CHECKS, LABEL };
