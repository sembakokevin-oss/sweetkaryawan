// Strategi XAUUSD agent Aurel: ikut tren, masuk saat harga koreksi memakai Buy Limit / Sell Limit.
// Tren  : EMA20 vs EMA50 di timeframe kerja (default M15) + kemiringan EMA50.
// Entry : Buy Limit di bawah harga (EMA20 atau bid - 0.6 ATR), Sell Limit di atas harga.
// Risiko: SL 1.5 ATR, TP 2.2 ATR (RR ~1:1.5). Order kedaluwarsa setelah 4 jam.

function ema(vals, n) {
  const k = 2 / (n + 1), out = [];
  let e = vals[0];
  vals.forEach((v, i) => { e = i ? v * k + e * (1 - k) : v; out.push(e); });
  return out;
}
function atr(bars, n = 14) {
  const tr = bars.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l));
  let a = tr.slice(0, n).reduce((s, v) => s + v, 0) / Math.min(n, tr.length);
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}
function rsi(closes, n = 14) {
  let g = 0, l = 0;
  for (let i = 1; i <= n && i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function analyze(bars) {
  const closed = bars.length > 60 ? bars.slice(0, -1) : bars; // abaikan candle yang belum selesai
  const c = closed.map((b) => b.c);
  const e20 = ema(c, 20), e50 = ema(c, 50);
  const i = c.length - 1;
  const a = {
    close: c[i], ema20: e20[i], ema50: e50[i], ema50prev: e50[Math.max(0, i - 10)],
    atr: atr(closed.slice(-120), 14), rsi: rsi(c.slice(-150), 14), bars: closed.length
  };
  const up = a.ema20 > a.ema50 && a.ema50 > a.ema50prev && a.close > a.ema50;
  const down = a.ema20 < a.ema50 && a.ema50 < a.ema50prev && a.close < a.ema50;
  a.trend = up ? 'naik' : down ? 'turun' : 'datar';
  return a;
}

const round = (v, d) => Number(Number(v).toFixed(d));

// sym: { bid, ask, point, digits, trade_stops_level }
function signal(bars, sym, opt = {}) {
  if (!bars || bars.length < 80) return { action: 'none', note: 'Data candle belum cukup' };
  const a = analyze(bars);
  const d = sym.digits ?? 2, pt = sym.point || 0.01;
  const gap = Math.max((sym.trade_stops_level || 0) * pt, 10 * pt);
  const spread = sym.ask - sym.bid;
  const slK = opt.slAtr || 1.5, tpK = opt.tpAtr || 2.2;
  if (!a.atr || a.atr <= 0) return { action: 'none', note: 'ATR tidak valid', a };
  if (spread > a.atr * 0.4) return { action: 'none', note: `Spread terlalu lebar (${spread.toFixed(d)})`, a };
  if (a.trend === 'naik') {
    if (a.rsi > 78) return { action: 'none', note: `Tren naik tapi RSI ${a.rsi.toFixed(0)} terlalu jenuh beli`, a };
    let price = Math.min(a.ema20, sym.bid - 0.6 * a.atr);
    price = Math.min(price, sym.ask - gap - spread);
    const sl = price - slK * a.atr, tp = price + tpK * a.atr;
    return { action: 'buy_limit', price: round(price, d), sl: round(sl, d), tp: round(tp, d), a,
      reason: `Tren naik (EMA20 ${a.ema20.toFixed(d)} > EMA50 ${a.ema50.toFixed(d)}), RSI ${a.rsi.toFixed(0)}. Tunggu koreksi ke ${price.toFixed(d)}, SL ${slK} ATR, TP ${tpK} ATR.` };
  }
  if (a.trend === 'turun') {
    if (a.rsi < 22) return { action: 'none', note: `Tren turun tapi RSI ${a.rsi.toFixed(0)} terlalu jenuh jual`, a };
    let price = Math.max(a.ema20, sym.ask + 0.6 * a.atr);
    price = Math.max(price, sym.bid + gap + spread);
    const sl = price + slK * a.atr, tp = price - tpK * a.atr;
    return { action: 'sell_limit', price: round(price, d), sl: round(sl, d), tp: round(tp, d), a,
      reason: `Tren turun (EMA20 ${a.ema20.toFixed(d)} < EMA50 ${a.ema50.toFixed(d)}), RSI ${a.rsi.toFixed(0)}. Tunggu pantulan ke ${price.toFixed(d)}, SL ${slK} ATR, TP ${tpK} ATR.` };
  }
  return { action: 'none', note: `Tren datar (EMA20 ${a.ema20.toFixed(d)} ≈ EMA50 ${a.ema50.toFixed(d)}) — menunggu setup`, a };
}

module.exports = { ema, atr, rsi, analyze, signal };
