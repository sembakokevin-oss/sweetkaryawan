// SnR (Support & Resistance) dan Order Block untuk XAUUSD — dideteksi dari candle MT5 HFM, lalu dipelajari Aurel.
//
// Support / Resistance : titik swing high/low (fractal 3 candle kiri-kanan) yang dikelompokkan bila jaraknya ≤ 0.25 ATR.
//                        Makin sering disentuh makin kuat. Dihitung di M15 dan H1 (H1 = level lebih kuat).
// Order Block          : candle berlawanan terakhir sebelum gerakan impulsif (≥ 1.5 ATR dalam ≤ 3 candle) yang
//                        menembus struktur (break of structure). Bullish OB = candle merah terakhir sebelum naik kuat,
//                        Bearish OB = candle hijau terakhir sebelum turun kuat. Zona = high–low candle itu.
//                        Status: fresh (belum disentuh) → tested (sudah disentuh) → broken (ditutup tembus = tidak berlaku).
//
// Belajar: setiap kali harga datang ke zona (support, resistance, OB bull, OB bear), Aurel melihat 8 candle berikutnya:
//   MEMANTUL bila harga bergerak ≥ 1.2 ATR menjauh dari zona sebelum menembus,
//   TEMBUS   bila candle menutup ≥ 0.6 ATR di balik zona (atau keduanya di candle yang sama — dihitung tembus).
// Statistik pantulan per jenis zona + tren disimpan di tabel trade_learn (kunci "zone|jenis|tren"), terpisah per sumber.
const { db, kvGet, kvSet } = require('../db');
const { ema } = require('./strategy');

const K = 3;          // lebar fractal
const H = 8;          // candle ke depan untuk menilai pantulan
const LOOK = 250;     // jangkauan swing ke belakang
const TYPES = { support: 'Support', resistance: 'Resistance', ob_bull: 'Bullish Order Block', ob_bear: 'Bearish Order Block' };

function atrSeries(bars, n = 14) {
  const out = []; let a = 0;
  bars.forEach((b, i) => {
    const tr = i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l;
    a = i < n ? (a * i + tr) / (i + 1) : (a * (n - 1) + tr) / n; out.push(a);
  });
  return out;
}
function trendSeries(bars, atr) {
  const c = bars.map((b) => b.c), e20 = ema(c, 20), e50 = ema(c, 50);
  return bars.map((_, i) => { const d = e20[i] - e50[i]; return Math.abs(d) < atr[i] * 0.1 ? 'datar' : d > 0 ? 'naik' : 'turun'; });
}

function swings(bars) {
  const out = [];
  for (let j = K; j < bars.length - K; j++) {
    let hi = true, lo = true;
    for (let k = j - K; k <= j + K; k++) { if (k === j) continue; if (bars[k].h >= bars[j].h) hi = false; if (bars[k].l <= bars[j].l) lo = false; }
    if (hi) out.push({ j, t: bars[j].t, price: bars[j].h, kind: 'high' });
    if (lo) out.push({ j, t: bars[j].t, price: bars[j].l, kind: 'low' });
  }
  return out;
}

// Level SnR yang sudah diketahui pada candle ke-i (hanya swing yang sudah terkonfirmasi sebelum i)
function levelsAt(sw, i, atrI, minTouch = 2) {
  const tol = atrI * 0.25;
  const pts = sw.filter((s) => s.j + K < i && s.j >= i - LOOK).sort((a, b) => a.price - b.price);
  const cl = [];
  pts.forEach((p) => {
    const last = cl[cl.length - 1];
    if (last && Math.abs(p.price - last.price) <= tol) { last.sum += p.price; last.touches++; last.price = last.sum / last.touches; last.last_t = Math.max(last.last_t, p.t); last.kinds.add(p.kind); }
    else cl.push({ price: p.price, sum: p.price, touches: 1, last_t: p.t, kinds: new Set([p.kind]) });
  });
  return cl.filter((c) => c.touches >= minTouch).map((c) => ({ price: c.price, touches: c.touches, last_t: c.last_t, flip: c.kinds.size > 1 }));
}

// Semua order block di seri candle, dengan indeks konfirmasi & riwayat status
function orderBlocks(bars, atr) {
  const obs = [];
  for (let m = 12; m < bars.length - 1; m++) {
    const b = bars[m], a = atr[m] || 1;
    const prevHigh = Math.max(...bars.slice(m - 10, m).map((x) => x.h)), prevLow = Math.min(...bars.slice(m - 10, m).map((x) => x.l));
    for (let c = m + 1; c <= Math.min(m + 3, bars.length - 1); c++) {
      if (b.c < b.o && bars[c].c - b.h >= 1.5 * a && bars[c].c > prevHigh) { obs.push({ type: 'ob_bull', m, c, t: b.t, top: b.h, bottom: b.l }); break; }
      if (b.c > b.o && b.l - bars[c].c >= 1.5 * a && bars[c].c < prevLow) { obs.push({ type: 'ob_bear', m, c, t: b.t, top: b.h, bottom: b.l }); break; }
    }
  }
  // status setelah konfirmasi
  obs.forEach((o) => {
    o.status = 'fresh'; o.touch_i = null; o.broken_i = null;
    for (let i = o.c + 1; i < bars.length; i++) {
      const x = bars[i];
      if (o.type === 'ob_bull') {
        if (o.touch_i === null && x.l <= o.top) { o.touch_i = i; o.status = 'tested'; }
        if (x.c < o.bottom) { o.broken_i = i; o.status = 'broken'; break; }
      } else {
        if (o.touch_i === null && x.h >= o.bottom) { o.touch_i = i; o.status = 'tested'; }
        if (x.c > o.top) { o.broken_i = i; o.status = 'broken'; break; }
      }
    }
  });
  return obs;
}

// Hasil reaksi harga setelah menyentuh zona di candle i
function outcome(bars, atr, i, dir, edge, far) {
  // dir +1 = diharapkan naik (support / OB bull), -1 = diharapkan turun
  const a = atr[i] || 1;
  for (let j = i; j <= Math.min(i + H, bars.length - 1); j++) {
    const x = bars[j];
    const broke = dir > 0 ? x.c < far - 0.6 * a : x.c > far + 0.6 * a;
    const bounced = dir > 0 ? x.h >= edge + 1.2 * a : x.l <= edge - 1.2 * a;
    if (broke) return { bounce: false, r: dir > 0 ? (x.c - edge) / a : (edge - x.c) / a, at: j };
    if (bounced && j > i) return { bounce: true, r: 1.2, at: j };
  }
  const last = bars[Math.min(i + H, bars.length - 1)];
  return { bounce: false, neutral: true, r: dir > 0 ? (last.c - edge) / a : (edge - last.c) / a, at: i + H };
}

db.exec(`CREATE TABLE IF NOT EXISTS trade_learn (source TEXT, key TEXT, n INTEGER, up INTEGER, sum_r REAL, last_ts INTEGER, PRIMARY KEY(source, key));`);
const upsert = db.prepare(`INSERT INTO trade_learn(source,key,n,up,sum_r,last_ts) VALUES(?,?,1,?,?,?)
  ON CONFLICT(source,key) DO UPDATE SET n=n+1, up=up+excluded.up, sum_r=sum_r+excluded.sum_r, last_ts=excluded.last_ts`);
const getRow = db.prepare('SELECT * FROM trade_learn WHERE source=? AND key=?');
function stat(source, type, trend) {
  const r = getRow.get(source, `zone|${type}|${trend}`);
  return r ? { n: r.n, up: r.up, prob: r.up / r.n, avg_r: r.sum_r / r.n } : { n: 0, up: 0, prob: 0.5, avg_r: 0 };
}

// Pelajari sentuhan zona yang hasilnya (8 candle ke depan) sudah diketahui
function study(source, bars) {
  if (!bars || bars.length < 120) return [];
  const closed = bars.slice(0, -1);
  const atr = atrSeries(closed), trend = trendSeries(closed, atr), sw = swings(closed), obs = orderBlocks(closed, atr);
  const upto = kvGet(`learn_zone_upto_${source}`, 0);
  const events = [];
  for (let i = 60; i + H < closed.length; i++) {
    if (closed[i].t <= upto) continue;
    const prev = closed[i - 1], x = closed[i], a = atr[i], tol = a * 0.15;
    levelsAt(sw, i, a).forEach((L) => {
      if (L.price < prev.c && x.l <= L.price + tol && prev.l > L.price + tol) events.push({ i, type: 'support', price: L.price, touches: L.touches, ...outcome(closed, atr, i, 1, L.price, L.price) });
      if (L.price > prev.c && x.h >= L.price - tol && prev.h < L.price - tol) events.push({ i, type: 'resistance', price: L.price, touches: L.touches, ...outcome(closed, atr, i, -1, L.price, L.price) });
    });
    obs.filter((o) => o.touch_i === i).forEach((o) => {
      const bull = o.type === 'ob_bull';
      events.push({ i, type: o.type, price: bull ? o.top : o.bottom, top: o.top, bottom: o.bottom, ...outcome(closed, atr, i, bull ? 1 : -1, bull ? o.top : o.bottom, bull ? o.bottom : o.top) });
    });
  }
  const lastI = closed.length - 1 - H;
  if (lastI >= 60) kvSet(`learn_zone_upto_${source}`, closed[lastI].t);
  db.transaction(() => events.forEach((e) => upsert.run(source, `zone|${e.type}|${trend[e.i]}`, e.bounce ? 1 : 0, e.r, closed[e.i].t)))();
  return events.map((e) => ({ ...e, t: closed[e.i].t, trend: trend[e.i], label: TYPES[e.type], stat: stat(source, e.type, trend[e.i]) }));
}

// Zona yang berlaku sekarang (untuk keputusan & grafik)
function analyze(bars, tf = 'M15') {
  if (!bars || bars.length < 60) return { tf, levels: [], obs: [], atr: 0 };
  const closed = bars.slice(0, -1), atr = atrSeries(closed), i = closed.length, a = atr[atr.length - 1];
  const price = bars[bars.length - 1].c;
  const lv = levelsAt(swings(closed), i + K + 1, a).map((L) => ({ ...L, tf, type: L.price < price ? 'support' : 'resistance', strength: L.touches * (tf === 'H1' ? 2 : 1) }));
  const obs = orderBlocks(closed, atr).filter((o) => o.status !== 'broken' && o.m >= closed.length - 300)
    .map((o) => ({ type: o.type, top: o.top, bottom: o.bottom, t: o.t, status: o.status, tf }));
  return { tf, levels: lv, obs: obs.slice(-8), atr: a, price };
}

// Rencana entry berbasis zona untuk sinyal tren (Buy Limit / Sell Limit)
function plan(sg, zs, sym, source, trendNow) {
  const a = (zs.find((z) => z.tf === 'M15') || zs[0] || {}).atr || (sg.a && sg.a.atr) || 1;
  const d = sym.digits ?? 2, rnd = (v) => Number(Number(v).toFixed(d));
  const levels = zs.flatMap((z) => z.levels), obs = zs.flatMap((z) => z.obs);
  const buy = sg.action === 'buy_limit', px = buy ? sym.bid : sym.ask;
  const cands = [];
  obs.filter((o) => (buy ? o.type === 'ob_bull' && o.top < px : o.type === 'ob_bear' && o.bottom > px)).forEach((o) => cands.push({ kind: o.type, tf: o.tf, entry: buy ? o.top : o.bottom, far: buy ? o.bottom : o.top, label: `${TYPES[o.type]} ${o.tf} ${o.bottom.toFixed(d)}–${o.top.toFixed(d)} (${o.status === 'fresh' ? 'belum disentuh' : 'sudah diuji'})`, fresh: o.status === 'fresh' }));
  levels.filter((L) => (buy ? L.type === 'support' : L.type === 'resistance')).forEach((L) => cands.push({ kind: buy ? 'support' : 'resistance', tf: L.tf, entry: buy ? L.price + 0.1 * a : L.price - 0.1 * a, far: L.price, label: `${buy ? 'Support' : 'Resistance'} ${L.tf} ${L.price.toFixed(d)} (${L.touches}x sentuh)`, strength: L.strength }));
  const scored = cands.map((c) => {
    const dist = Math.abs(px - c.entry) / a, st = stat(source, c.kind, trendNow);
    const prob = st.n >= 15 ? st.prob : 0.5;
    return { ...c, dist, st, prob, score: prob * 2 + (c.fresh ? 0.3 : 0) + (c.tf === 'H1' ? 0.3 : 0) + Math.min(0.4, (c.strength || 0) * 0.05) - dist * 0.15 };
  }).filter((c) => c.dist >= 0.25 && c.dist <= 2.6 && (c.st.n < 15 || c.prob >= 0.45)).sort((x, y) => y.score - x.score);
  const best = scored[0];
  let price = sg.price, sl = sg.sl, label = '';
  if (best) {
    price = best.entry; sl = buy ? best.far - 0.35 * a : best.far + 0.35 * a;
    const risk = Math.abs(price - sl);
    if (risk < 0.8 * a) sl = buy ? price - 0.8 * a : price + 0.8 * a;
    if (risk > 2.5 * a) return { hold: true, note: `Zona ${best.label} terlalu lebar untuk SL aman` };
    label = `${best.label}${best.st.n >= 15 ? ` · memantul ${Math.round(best.prob * 100)}% dari ${best.st.n} kejadian` : ` · data pantulan baru ${best.st.n}`}`;
  }
  // penghalang TP: level / OB berlawanan terdekat
  const risk = Math.abs(price - sl);
  const blockers = [...levels.filter((L) => (buy ? L.type === 'resistance' && L.price > price : L.type === 'support' && L.price < price)).map((L) => ({ p: L.price, label: `${buy ? 'resistance' : 'support'} ${L.tf} ${L.price.toFixed(d)}` })),
    ...obs.filter((o) => (buy ? o.type === 'ob_bear' && o.bottom > price : o.type === 'ob_bull' && o.top < price)).map((o) => ({ p: buy ? o.bottom : o.top, label: `${TYPES[o.type]} ${o.tf}` }))]
    .sort((x, y) => (buy ? x.p - y.p : y.p - x.p));
  const blk = blockers[0];
  let tp = buy ? price + Math.max(2.2 * a, 1.5 * risk) : price - Math.max(2.2 * a, 1.5 * risk);
  if (blk) {
    const room = Math.abs(blk.p - price);
    if (room < 1.2 * risk) return { hold: true, note: `Ruang ke ${blk.label} hanya ${(room / a).toFixed(1)} ATR — TP terhalang, Aurel menunggu` };
    const tpB = buy ? blk.p - 0.1 * a : blk.p + 0.1 * a;
    if (buy ? tpB < tp : tpB > tp) tp = tpB;
  }
  return { hold: false, zone: best || null, price: rnd(price), sl: rnd(sl), tp: rnd(tp),
    note: best ? `Entry di ${label}. TP ${blk ? `sebelum ${blk.label}` : 'target 2.2 ATR'}.` : (blk ? `Tanpa zona dekat; TP dibatasi sebelum ${blk.label}.` : '') };
}

function summary(source) {
  const rows = db.prepare("SELECT * FROM trade_learn WHERE source=? AND key LIKE 'zone|%' ORDER BY n DESC").all(source);
  return { source, horizon: H, total: rows.reduce((s, r) => s + r.n, 0),
    rows: rows.map((r) => { const [, type, trend] = r.key.split('|'); return { type, trend, label: TYPES[type] || type, n: r.n, bounce: r.up / r.n, avg_r: r.sum_r / r.n, last_ts: r.last_ts * 1000 }; }) };
}

module.exports = { analyze, study, plan, summary, stat, TYPES, swings, orderBlocks, levelsAt, atrSeries };
