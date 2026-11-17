// Aurel belajar dari candle: setiap candle yang sudah selesai dicatat polanya (engulfing, hammer, doji, ...) beserta tren saat itu,
// lalu dilihat hasilnya 4 candle kemudian (±1 jam di M15). Statistik "pola + tren → peluang naik & rata-rata gerak (ATR)"
// disimpan di database dan dipakai Aurel sebelum memasang Buy Limit / Sell Limit.
// Statistik dipisah per sumber harga (mt5 / ref / synthetic) supaya data sintetis tidak mencemari pelajaran dari harga asli.
const { db, kvGet, kvSet } = require('../db');
const { ema } = require('./strategy');

db.exec(`CREATE TABLE IF NOT EXISTS trade_learn (source TEXT, key TEXT, n INTEGER, up INTEGER, sum_r REAL, last_ts INTEGER, PRIMARY KEY(source, key));`);

const H = 4; // jumlah candle ke depan untuk menilai hasil
const PAT = { engulf_naik: 'Bullish engulfing', engulf_turun: 'Bearish engulfing', hammer: 'Hammer (pin bar bawah)', shooting_star: 'Shooting star (pin bar atas)',
  doji: 'Doji', inside: 'Inside bar', marubozu_naik: 'Marubozu naik', marubozu_turun: 'Marubozu turun', naik: 'Candle naik biasa', turun: 'Candle turun biasa' };

function pattern(b, p) {
  const range = b.h - b.l, body = Math.abs(b.c - b.o), up = b.h - Math.max(b.o, b.c), low = Math.min(b.o, b.c) - b.l;
  if (range <= 1e-9 || body <= range * 0.1) return 'doji';
  if (p) {
    const pb = Math.abs(p.c - p.o);
    if (b.c > b.o && p.c < p.o && b.c >= p.o && b.o <= p.c && body > pb) return 'engulf_naik';
    if (b.c < b.o && p.c > p.o && b.c <= p.o && b.o >= p.c && body > pb) return 'engulf_turun';
  }
  if (low >= body * 2 && up <= body * 0.6) return 'hammer';
  if (up >= body * 2 && low <= body * 0.6) return 'shooting_star';
  if (p && b.h <= p.h && b.l >= p.l) return 'inside';
  if (body >= range * 0.85) return b.c > b.o ? 'marubozu_naik' : 'marubozu_turun';
  return b.c > b.o ? 'naik' : 'turun';
}

function series(bars) {
  const c = bars.map((b) => b.c), e20 = ema(c, 20), e50 = ema(c, 50);
  const atr = []; let a = 0;
  bars.forEach((b, i) => { const tr = i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l; a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14; atr.push(a); });
  return { c, e20, e50, atr };
}
const trendAt = (S, i) => { const d = S.e20[i] - S.e50[i]; return Math.abs(d) < S.atr[i] * 0.1 ? 'datar' : d > 0 ? 'naik' : 'turun'; };
const contextAt = (bars, S, i) => ({ pattern: pattern(bars[i], bars[i - 1]), trend: trendAt(S, i) });

const upsert = db.prepare(`INSERT INTO trade_learn(source,key,n,up,sum_r,last_ts) VALUES(?,?,1,?,?,?)
  ON CONFLICT(source,key) DO UPDATE SET n=n+1, up=up+excluded.up, sum_r=sum_r+excluded.sum_r, last_ts=excluded.last_ts`);
const getRow = db.prepare('SELECT * FROM trade_learn WHERE source=? AND key=?');

// Pelajari candle baru (yang hasil 4 candle ke depannya sudah diketahui). Mengembalikan pelajaran baru.
function study(source, bars) {
  if (!bars || bars.length < 70) return [];
  const closed = bars.slice(0, -1); // abaikan candle yang masih berjalan
  const S = series(closed);
  const upto = kvGet(`learn_upto_${source}`, 0);
  const lessons = [];
  db.transaction(() => {
    for (let i = 55; i + H < closed.length; i++) {
      if (closed[i].t <= upto) continue;
      const ctx = contextAt(closed, S, i), key = `${ctx.trend}|${ctx.pattern}`;
      const r = (closed[i + H].c - closed[i].c) / (S.atr[i] || 1);
      upsert.run(source, key, r > 0 ? 1 : 0, r, closed[i].t);
      lessons.push({ t: closed[i].t, key, ...ctx, r });
    }
  })();
  if (lessons.length) kvSet(`learn_upto_${source}`, lessons[lessons.length - 1].t);
  return lessons.map((l) => ({ ...l, stat: stat(source, l.key) }));
}

function stat(source, key) {
  const r = getRow.get(source, key);
  if (!r) return { key, n: 0, up: 0, prob_up: 0.5, avg_r: 0 };
  return { key, n: r.n, up: r.up, prob_up: r.up / r.n, avg_r: r.sum_r / r.n };
}

// Saran untuk order yang akan dipasang, berdasarkan candle terakhir yang selesai
function advice(source, bars, action) {
  if (!bars || bars.length < 70) return { ok: true, text: '' };
  const closed = bars.slice(0, -1), S = series(closed), i = closed.length - 1;
  const ctx = contextAt(closed, S, i), key = `${ctx.trend}|${ctx.pattern}`, st = stat(source, key);
  const buy = action === 'buy_limit', prob = buy ? st.prob_up : 1 - st.prob_up;
  const label = `${PAT[ctx.pattern]} saat tren ${ctx.trend}`;
  if (st.n < 20) return { ok: true, key, label, n: st.n, prob, text: `Pola terakhir: ${label} (sampel baru ${st.n}, belum dipakai menyaring)` };
  const ok = prob >= 0.42;
  return { ok, key, label, n: st.n, prob, avg_r: st.avg_r,
    text: `Pelajaran candle: ${label} → ${buy ? 'naik' : 'turun'} ${Math.round(prob * 100)}% dari ${st.n} sampel (rata-rata ${st.avg_r >= 0 ? '+' : ''}${st.avg_r.toFixed(2)} ATR/1 jam)` };
}

function summary(source, limit = 12) {
  const rows = db.prepare("SELECT * FROM trade_learn WHERE source=? AND key NOT LIKE 'zone|%' ORDER BY n DESC LIMIT ?").all(source, limit);
  const total = db.prepare("SELECT COALESCE(SUM(n),0) n FROM trade_learn WHERE source=? AND key NOT LIKE 'zone|%'").get(source).n;
  return { source, total, horizon: H, patterns: rows.map((r) => { const [trend, p] = r.key.split('|'); return { key: r.key, trend, pattern: p, label: PAT[p] || p, n: r.n, prob_up: r.up / r.n, avg_r: r.sum_r / r.n, last_ts: r.last_ts * 1000 }; }) };
}

module.exports = { study, advice, summary, stat, PAT, H };
