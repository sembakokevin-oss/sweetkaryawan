// Feed harga XAUUSD realtime — HANYA dari harga pasar broker HFM lewat MetaTrader 5.
// Tidak ada sumber harga lain: bila MT5 belum terhubung, grafik & agent menunggu (status "offline").
// Harga dikirim ke browser lewat SSE event "tick" (±1 detik) dan dipakai Aurel untuk analisa & belajar candle.
const mt5 = require('../services/mt5');
const { broadcast } = require('../services/notify');

const TF_SEC = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
const LABEL = { mt5: 'HFM MetaTrader 5 · harga pasar broker (live)', offline: 'MT5 HFM belum terhubung — harga belum tersedia' };
let tick = null, lastSent = '';

const source = () => (mt5.live() ? 'mt5' : 'offline');

async function candles(tf = 'M15', count = 300) {
  tf = TF_SEC[tf] ? tf : 'M15';
  if (!mt5.live()) return { source: 'offline', tf, bars: [] };
  return { source: 'mt5', tf, bars: await mt5.api.rates(tf, count) };
}

let busy = false;
async function loop() {
  if (busy) return;
  busy = true;
  try {
    if (mt5.live()) {
      const y = await mt5.api.symbol();
      tick = { s: 'mt5', label: LABEL.mt5, bid: y.bid, ask: y.ask, digits: y.digits, name: y.name, open: y.fresh, t: y.tick_time || Math.floor(Date.now() / 1000) };
    } else if (!tick || tick.s !== 'offline') {
      tick = { s: 'offline', label: LABEL.offline, t: Math.floor(Date.now() / 1000) };
    }
    const k = `${tick.s}:${tick.bid}:${tick.ask}`;
    if (k !== lastSent) { lastSent = k; broadcast('tick', tick); }
  } catch (_) { /* bridge sibuk / terputus: dicoba lagi detik berikutnya */ } finally { busy = false; }
}

function start() { setInterval(loop, 1000); }

module.exports = { start, candles, source, tick: () => tick, info: () => ({ source: source(), label: LABEL[source()], bridge: mt5.info().bridge }), TF_SEC };
