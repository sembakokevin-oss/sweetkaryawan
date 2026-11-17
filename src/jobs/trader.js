// Agent #16 Aurel — XAUUSD Trader, bekerja 24 jam di tambang emas.
// Tiap 15 detik: baca akun MT5 HFM (harga pasar broker, tanpa sumber lain), sinkron riwayat ke database, cek risiko,
// analisa tren, lalu pasang / batalkan Buy Limit & Sell Limit (selalu dengan SL & TP).
// Semua hasil kerja masuk ke halaman /trading.
const mt5 = require('../services/mt5');
const strategy = require('../trading/strategy');
const feed = require('../trading/feed');
const learn = require('../trading/learn');
const zones = require('../trading/zones');
const officeState = require('../state/officeState');
const llm = require('../ai/llm');
const { db, now, log, settings } = require('../db');
const { notify } = require('../services/notify');

const KEY = 'aurel', MAGIC = 160016;
const TF = (process.env.TRADING_TF || 'M15').toUpperCase();
const TTL_MIN = Number(process.env.TRADING_ORDER_TTL_MIN || 240);
const MAX_LOT = Number(process.env.TRADING_MAX_LOT || 0.05);
const USD_IDR = Number(process.env.USD_IDR || 16300);
const MIN_USD = Number(process.env.TRADING_MIN_BALANCE_USD || 5); // saldo minimal agar Aurel boleh pasang order (akun cent: $5 = 500 USC)
const WIB = 7 * 3600e3;

const DTYPE = { 0: 'buy', 1: 'sell', 2: 'balance', 3: 'credit', 4: 'charge', 5: 'correction', 6: 'bonus', 7: 'commission' };
const ENTRY = { 0: 'in', 1: 'out', 2: 'inout', 3: 'out_by' };
const OTYPE = { 0: 'buy', 1: 'sell', 2: 'buy_limit', 3: 'sell_limit', 4: 'buy_stop', 5: 'sell_stop', 6: 'buy_stop_limit', 7: 'sell_stop_limit', 8: 'close_by' };
const OSTATE = { 0: 'started', 1: 'placed', 2: 'canceled', 3: 'partial', 4: 'filled', 5: 'rejected', 6: 'expired' };
const LABEL = { buy_limit: 'BUY LIMIT', sell_limit: 'SELL LIMIT', buy: 'BUY', sell: 'SELL', buy_stop: 'BUY STOP', sell_stop: 'SELL STOP' };

const S = { mode: 'live', offline: true, account: null, symbol: null, positions: [], orders: [], analysis: null, note: 'Menyiapkan…', error: null, guard: null,
  lastHist: {}, cooldownUntil: 0, tickN: 0, lastPlaced: null, startedAt: now(), funds: { ok: false, reason: 'Membaca saldo akun…' } };

const factor = (cur) => (/^us[c¢]$/i.test(String(cur || '')) ? 0.01 : 1);
const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '-' : Number(v).toFixed(d));
const dayWib = (ms) => new Date(ms + WIB).toISOString().slice(0, 10);

// ---------- Sinkron database ----------
const upDeal = db.prepare(`INSERT OR IGNORE INTO trade_deals(mode,ticket,ts,symbol,type,entry,volume,price,profit,commission,swap,fee,order_ticket,position_id,comment,magic)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const upOrder = db.prepare(`INSERT INTO trade_orders(mode,ticket,ts_setup,ts_done,symbol,type,state,volume,price,sl,tp,comment,magic,position_id,reason)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(mode,ticket) DO UPDATE SET ts_done=excluded.ts_done, state=excluded.state, sl=excluded.sl, tp=excluded.tp, position_id=excluded.position_id,
  reason=COALESCE(trade_orders.reason, excluded.reason)`);

function saveOrder(m, o, state, reason = null) {
  upOrder.run(m, o.ticket, (o.time_setup || 0) * 1000, o.time_done ? o.time_done * 1000 : null, o.symbol, OTYPE[o.type] || String(o.type), state,
    o.volume_initial ?? o.volume_current ?? o.volume, o.price_open, o.sl || 0, o.tp || 0, o.comment || '', o.magic || 0, o.position_id || 0, reason);
}

async function syncHistory(m, force) {
  const nowS = Math.floor(Date.now() / 1000);
  const last = S.lastHist[m];
  if (!force && last && S.tickN % (m === 'live' ? 4 : 1)) return [];
  const had = db.prepare('SELECT COUNT(*) c FROM trade_deals WHERE mode=?').get(m).c;
  const from = last ? last - 3 * 86400 : nowS - 120 * 86400;
  const h = await mt5.api.history(from, nowS + 60);
  const fresh = [];
  db.transaction(() => {
    (h.deals || []).forEach((d) => {
      const r = upDeal.run(m, d.ticket, d.time * 1000, d.symbol || '', DTYPE[d.type] || String(d.type), ENTRY[d.entry] || String(d.entry), d.volume, d.price,
        d.profit || 0, d.commission || 0, d.swap || 0, d.fee || 0, d.order || 0, d.position_id || 0, d.comment || '', d.magic || 0);
      if (r.changes) fresh.push(d);
    });
    (h.orders || []).forEach((o) => saveOrder(m, o, OSTATE[o.state] || String(o.state)));
  })();
  S.lastHist[m] = nowS;
  return had ? fresh : []; // sinkron pertama: jangan banjiri notifikasi
}

let lastSnap = 0;
function snapshot(m, acc, force) {
  if (!acc) return;
  const t = now();
  const prev = db.prepare('SELECT equity FROM trade_equity WHERE mode=? ORDER BY ts DESC LIMIT 1').get(m);
  const moved = prev && Math.abs(acc.equity - prev.equity) > Math.max(1, Math.abs(prev.equity) * 0.003);
  if (!force && !moved && t - lastSnap < 5 * 60e3) return;
  lastSnap = t;
  db.prepare('INSERT INTO trade_equity(ts,mode,balance,equity,profit,margin) VALUES(?,?,?,?,?,?)').run(t, m, acc.balance, acc.equity, acc.profit || 0, acc.margin || 0);
}

// ---------- Kejadian (order terisi / posisi ditutup) ----------
function announce(m, deals) {
  const cur = S.account && S.account.currency, f = factor(cur);
  deals.filter((d) => d.type === 0 || d.type === 1).forEach((d) => {
    const side = d.type === 0 ? 'BUY' : 'SELL';
    if (d.entry === 0) {
      log(KEY, 'isi', `${side} ${d.volume} ${d.symbol} terisi di ${fmt(d.price)}`);
      notify({ type: 'trade', title: `Aurel: ${side} ${d.volume} ${d.symbol} terisi`, text: `Harga ${fmt(d.price)}`, data: { ticket: d.ticket, mode: m }, telegram: false });
    } else {
      const pnl = (d.profit || 0) + (d.commission || 0) + (d.swap || 0) + (d.fee || 0);
      const why = /\[sl/i.test(d.comment || '') ? ' (kena SL)' : /\[tp/i.test(d.comment || '') ? ' (kena TP)' : '';
      const txt = `${pnl >= 0 ? '+' : ''}${fmt(pnl)} ${cur || ''} (≈ $${fmt(pnl * f)})`;
      log(KEY, 'tutup', `Posisi ${d.volume} ${d.symbol} ditutup${why}: ${txt}`);
      notify({ type: pnl >= 0 ? 'money' : 'warn', title: `Aurel: posisi ditutup ${pnl >= 0 ? 'profit' : 'rugi'}${why}`, text: txt , data: { trade: true, profit: pnl, usd: pnl * f, mode: m }, telegram: false });
    }
  });
}

// ---------- Risiko ----------
function dayStartEquity(m, acc) {
  const t0 = new Date(Date.now() + WIB); t0.setUTCHours(0, 0, 0, 0);
  const r = db.prepare('SELECT equity FROM trade_equity WHERE mode=? AND ts>=? ORDER BY ts LIMIT 1').get(m, t0.getTime() - WIB)
    || db.prepare('SELECT equity FROM trade_equity WHERE mode=? ORDER BY ts DESC LIMIT 1').get(m);
  return r ? r.equity : acc.equity;
}
function checkGuard(m, acc) {
  const st = settings();
  const base = dayStartEquity(m, acc);
  const pnl = acc.equity - base;
  const limit = -Math.abs(st.trading_daily_loss_pct) / 100 * base;
  if (base > 0 && pnl <= limit) {
    if (!S.guard) { log(KEY, 'risiko', `Batas rugi harian ${st.trading_daily_loss_pct}% tercapai (${fmt(pnl)} ${acc.currency}). Order baru dihentikan sampai besok.`); notify({ type: 'warn', title: 'Aurel berhenti: batas rugi harian', text: `${fmt(pnl)} ${acc.currency} hari ini • order baru dihentikan sampai besok`, telegram: false }); }
    S.guard = { reason: `Batas rugi harian ${st.trading_daily_loss_pct}% tercapai`, day: dayWib(now()) };
  } else if (S.guard && S.guard.day !== dayWib(now())) S.guard = null;
  return S.guard;
}

// ---------- Saldo akun ----------
// Tanpa saldo / saldo habis → Aurel tidak memasang order. Begitu saldo masuk → otomatis jalan lagi.
function fundsCheck(acc) {
  if (!acc || acc.balance === undefined || acc.balance === null) return { ok: false, reason: 'Data saldo akun belum terbaca' };
  const f = factor(acc.currency), cur = acc.currency || '', min = MIN_USD / f;
  const base = { min, min_usd: MIN_USD, balance: acc.balance, equity: acc.equity, currency: cur, cent: f === 0.01 };
  if (acc.trade_allowed === false) return { ...base, ok: false, reason: 'Akun belum mengizinkan trading (cek MetaTrader 5 / status akun HFM)' };
  if ((acc.balance || 0) <= 0 && (acc.equity || 0) <= 0) return { ...base, ok: false, empty: true, reason: `Saldo akun ${f === 0.01 ? 'cent ' : ''}masih kosong — isi saldo di HFM dulu, Aurel menunggu` };
  if ((acc.equity || 0) < min) return { ...base, ok: false, empty: true, reason: `Saldo habis / kurang: ${fmt(acc.equity)} ${cur} (≈ $${fmt((acc.equity || 0) * f)}), minimal ${fmt(min)} ${cur} (≈ $${MIN_USD}) — isi saldo dulu` };
  if (acc.margin_free !== undefined && acc.margin_free < min * 0.5) return { ...base, ok: false, reason: `Margin bebas tidak cukup (${fmt(acc.margin_free)} ${cur})` };
  return { ...base, ok: true, reason: '' };
}
function updateFunds(m, acc) {
  const was = S.funds, now2 = fundsCheck(acc);
  S.funds = now2;
  if (was && was.ok !== now2.ok && was.reason !== 'Membaca saldo akun…') {
    if (now2.ok) {
      log(KEY, 'trading', `Saldo tersedia ${fmt(acc.balance)} ${acc.currency || ''} — Aurel mulai trading XAUUSD lagi`);
      notify({ type: 'success', title: 'Saldo masuk — Aurel mulai trading', text: `${fmt(acc.balance)} ${acc.currency || ''} (≈ $${fmt(acc.balance * factor(acc.currency))}) • XAUUSD akun ${now2.cent ? 'cent' : ''}`, telegram: false });
    } else {
      log(KEY, 'risiko', `${now2.reason}. Aurel berhenti pasang order.`);
      notify({ type: 'warn', title: now2.empty ? 'Saldo kosong — Aurel berhenti' : 'Aurel berhenti trading', text: now2.reason, telegram: false });
    }
  } else if (!was || was.reason === 'Membaca saldo akun…') {
    if (!now2.ok) log(KEY, 'risiko', `${now2.reason}. Aurel tidak akan pasang order sampai saldo tersedia.`);
  }
  return now2;
}

// ---------- Review AI (opsional) ----------
async function aiReview(sg, sym) {
  if (!settings().trading_ai_review) return { approve: true, note: '' };
  if (!(llm.hasClaude() || llm.hasGemini() || llm.hasHermes())) return { approve: true, note: '' };
  const a = sg.a;
  const prompt = `Kamu Aurel, trader XAUUSD disiplin di perusahaan SWEET. Nilai rencana order ini dan jawab HANYA JSON {"approve":true|false,"note":"alasan singkat bahasa Indonesia, maks 25 kata"}.
Data ${TF}: harga bid ${sym.bid}, ask ${sym.ask}, EMA20 ${fmt(a.ema20)}, EMA50 ${fmt(a.ema50)}, EMA50 10 candle lalu ${fmt(a.ema50prev)}, ATR ${fmt(a.atr)}, RSI ${fmt(a.rsi, 0)}, tren ${a.trend}.
Rencana: ${LABEL[sg.action]} di ${sg.price}, SL ${sg.sl}, TP ${sg.tp}, lot kecil, kedaluwarsa ${TTL_MIN} menit.
${sg.lesson ? 'Statistik candle yang dipelajari Aurel: ' + sg.lesson : ''}
${sg.zoneNote ? 'SnR / Order Block: ' + sg.zoneNote : ''}
Tolak bila jelas berlawanan dengan data. Jangan menolak hanya karena ragu.`;
  try {
    const txt = await Promise.race([llm.generate('Kamu analis risiko trading emas. Jawab JSON saja.', prompt), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))]);
    const j = llm.parseJson(txt);
    return { approve: j.approve !== false, note: String(j.note || '').slice(0, 200), ai: true };
  } catch (e) { return { approve: true, note: '', aiError: e.message }; }
}

// ---------- Keputusan ----------
async function manage(m, sym, pos, ord) {
  const st = settings();
  const own = ord.filter((o) => o.magic === MAGIC), ownPos = pos.filter((p) => p.magic === MAGIC);
  if (!S.funds.ok) {
    for (const o of own) {
      try { await mt5.api.cancel(o.ticket); log(KEY, 'batal', `${LABEL[OTYPE[o.type]]} #${o.ticket} dibatalkan (${S.funds.empty ? 'saldo kosong/habis' : S.funds.reason})`); } catch (e) { log(KEY, 'error', `Gagal batal #${o.ticket}: ${e.message}`); }
    }
    if (own.length) await syncHistory(m, true);
    S.note = S.funds.reason + (ownPos.length ? ` • ${ownPos.length} posisi tetap dijaga SL/TP` : '');
    return;
  }
  if (!sym || !sym.fresh) { S.note = 'Pasar emas tutup / harga belum bergerak — Aurel memantau'; return; }
  const bars = S.bars && S.bars.length ? S.bars : (await feed.candles(TF, 400)).bars;
  const sg = strategy.signal(bars, sym);
  S.analysis = sg.a ? { ...sg.a, tf: TF } : null;
  // kelola order yang menggantung
  for (const o of own) {
    const age = Date.now() / 1000 - (o.time_setup || 0);
    const flip = sg.a && ((o.type === 2 && sg.a.trend === 'turun') || (o.type === 3 && sg.a.trend === 'naik'));
    const stale = age > TTL_MIN * 60 + 60;
    if (flip || stale || !st.trading_enabled || S.guard || !S.funds.ok) {
      const why = !st.trading_enabled ? 'trading dimatikan' : !S.funds.ok ? (S.funds.empty ? 'saldo kosong/habis' : S.funds.reason) : S.guard ? S.guard.reason : flip ? 'tren berbalik' : 'kedaluwarsa';
      try { await mt5.api.cancel(o.ticket); log(KEY, 'batal', `${LABEL[OTYPE[o.type]]} #${o.ticket} di ${fmt(o.price_open)} dibatalkan (${why})`); await syncHistory(m, true); }
      catch (e) { log(KEY, 'error', `Gagal batal #${o.ticket}: ${e.message}`); }
    }
  }
  if (!st.trading_enabled) { S.note = 'Trading dimatikan Bos — Aurel hanya memantau'; return; }
  if (!S.funds.ok) { S.note = S.funds.reason; return; }
  if (S.guard) { S.note = S.guard.reason; return; }
  const ordNow = (await mt5.api.orders()).filter((o) => o.magic === MAGIC);
  if (ownPos.length >= st.trading_max_positions) { S.note = `Mengawal ${ownPos.length} posisi terbuka`; return; }
  if (ordNow.length >= st.trading_max_pending) { S.note = `Menunggu ${LABEL[OTYPE[ordNow[0].type]]} terisi di ${fmt(ordNow[0].price_open)}`; return; }
  if (sg.action === 'none') { S.note = sg.note; return; }
  if (Date.now() < S.cooldownUntil) { S.note = 'Jeda sebentar sebelum order berikutnya'; return; }
  // saring dengan statistik candle yang sudah dipelajari
  const adv = learn.advice(S.learnSrc || feed.source(), bars, sg.action);
  if (adv.text) sg.lesson = adv.text;
  if (!adv.ok) { S.note = `Menahan ${LABEL[sg.action]} — ${adv.text}`; log(KEY, 'belajar', S.note); S.cooldownUntil = Date.now() + 15 * 60e3; return; }
  // entry, SL & TP mengikuti SnR dan Order Block (M15 + H1) yang sudah dipelajari
  if (S.zones && S.zones.length) {
    const pl = zones.plan(sg, S.zones, sym, S.learnSrc || feed.source(), sg.a ? sg.a.trend : 'datar');
    if (pl.hold) { S.note = `Menahan ${LABEL[sg.action]} — ${pl.note}`; log(KEY, 'belajar', S.note); S.cooldownUntil = Date.now() + 10 * 60e3; return; }
    const gap = Math.max((sym.trade_stops_level || 0) * (sym.point || 0.01), 0.1) + (sym.ask - sym.bid);
    const okSide = sg.action === 'buy_limit' ? pl.price < sym.ask - gap : pl.price > sym.bid + gap;
    if (okSide) { sg.price = pl.price; sg.sl = pl.sl; sg.tp = pl.tp; }
    if (pl.note) sg.zoneNote = pl.note;
  }
  officeState.setStep(KEY, 'analisa', `Review setup ${LABEL[sg.action]}…`);
  const rv = await aiReview(sg, sym);
  if (!rv.approve) { S.note = `AI menahan ${LABEL[sg.action]}: ${rv.note}`; log(KEY, 'analisa', S.note); S.cooldownUntil = Date.now() + 15 * 60e3; return; }
  const lot = Math.max(0.01, Math.min(MAX_LOT, Number(st.trading_lot) || 0.01));
  const reason = sg.reason + (sg.zoneNote ? ` • ${sg.zoneNote}` : '') + (sg.lesson ? ` • ${sg.lesson}` : '') + (rv.note ? ` • AI: ${rv.note}` : '');
  try {
    const r = await mt5.api.placePending({ type: sg.action, price: sg.price, sl: sg.sl, tp: sg.tp, volume: lot, expiration_minutes: TTL_MIN, comment: 'SWEET Aurel' });
    if (!r.ok) throw new Error((r.result && (r.result.comment || r.result.retcode)) || 'ditolak broker');
    const ticket = r.result && r.result.order;
    if (ticket) saveOrder(m, { ticket, time_setup: Math.floor(Date.now() / 1000), symbol: sym.name, type: sg.action === 'buy_limit' ? 2 : 3, volume_initial: r.volume || lot, price_open: r.price || sg.price, sl: sg.sl, tp: sg.tp, magic: MAGIC, comment: 'SWEET Aurel' }, 'placed', reason);
    S.lastPlaced = { type: sg.action, price: r.price || sg.price, ts: now() };
    S.cooldownUntil = Date.now() + 2 * 60e3;
    log(KEY, 'order', `${LABEL[sg.action]} ${r.volume || lot} ${sym.name} di ${fmt(r.price || sg.price)} • SL ${fmt(sg.sl)} • TP ${fmt(sg.tp)}. ${reason}`);
    notify({ type: 'trade', title: `Aurel pasang ${LABEL[sg.action]} ${sym.name}`, text: `${r.volume || lot} lot di ${fmt(r.price || sg.price)} • SL ${fmt(sg.sl)} • TP ${fmt(sg.tp)}`, data: { mode: m }, telegram: false });
    S.note = `${LABEL[sg.action]} terpasang di ${fmt(r.price || sg.price)}`;
  } catch (e) {
    S.cooldownUntil = Date.now() + 5 * 60e3;
    S.note = `Order ditolak: ${e.message}`;
    log(KEY, 'error', `Gagal pasang ${LABEL[sg.action]}: ${e.message}`);
  }
}

// ---------- Belajar candle setiap saat ----------
const hhmm = (sec) => new Date(sec * 1000 + WIB).toISOString().slice(11, 16);
async function learnStep() {
  const c = await feed.candles(TF, 400);
  S.bars = c.bars; S.learnSrc = c.source;
  const lessons = learn.study(c.source, c.bars);
  S.learned = learn.summary(c.source, 1).total;
  await zoneStep(c);
  const srcTxt = 'harga pasar HFM';
  if (lessons.length > 6) {
    log(KEY, 'belajar', `Mempelajari ${lessons.length} candle ${TF} dari ${srcTxt}. Total pengalaman: ${S.learned} candle.`);
    S.lesson = { text: `Mempelajari ${lessons.length} candle ${TF}`, short: `Belajar ${lessons.length} candle ${TF}`, at: Date.now() };
    return;
  }
  if (!lessons.length) return;
  const l = lessons[lessons.length - 1], st = l.stat;
  const text = `Candle ${hhmm(l.t)} ${learn.PAT[l.pattern]} saat tren ${l.trend} → ${l.r >= 0 ? 'naik' : 'turun'} ${Math.abs(l.r).toFixed(2)} ATR dalam 1 jam. Pola ini naik ${Math.round(st.prob_up * 100)}% dari ${st.n} sampel (${srcTxt}).`;
  log(KEY, 'belajar', text);
  S.lesson = { text, short: `Belajar candle ${hhmm(l.t)}: ${learn.PAT[l.pattern]}`, at: Date.now() };
}

// ---------- Belajar SnR & Order Block ----------
async function zoneStep(c) {
  if (!S.barsH1 || Date.now() - (S.h1At || 0) > 60e3) { try { S.barsH1 = (await feed.candles('H1', 300)).bars; S.h1At = Date.now(); } catch (_) { /* H1 opsional */ } }
  S.zones = [zones.analyze(c.bars, TF), ...(S.barsH1 && S.barsH1.length > 60 ? [zones.analyze(S.barsH1, 'H1')] : [])];
  const ev = zones.study(c.source, c.bars);
  S.zoneLearned = zones.summary(c.source).total;
  if (!ev.length) return;
  if (ev.length > 6) {
    log(KEY, 'belajar', `Mempelajari ${ev.length} sentuhan SnR & Order Block di ${TF}. Total pengalaman zona: ${S.zoneLearned} kejadian.`);
    S.lesson = { text: `Mempelajari ${ev.length} sentuhan SnR & Order Block`, short: `Belajar ${ev.length} sentuhan SnR & OB`, at: Date.now() };
    return;
  }
  const e = ev[ev.length - 1], st = e.stat, d = (S.symbol && S.symbol.digits) || 2;
  const where = e.type.startsWith('ob') ? `${e.label} ${e.bottom.toFixed(d)}–${e.top.toFixed(d)}` : `${e.label} ${e.price.toFixed(d)}${e.touches ? ` (${e.touches}x sentuh)` : ''}`;
  const res = e.bounce ? 'memantul' : e.neutral ? 'tertahan tanpa arah jelas' : 'ditembus';
  const text = `Candle ${hhmm(e.t)} harga menyentuh ${where} saat tren ${e.trend} → ${res} (${e.r >= 0 ? '+' : ''}${e.r.toFixed(2)} ATR). ${e.label} di tren ${e.trend} memantul ${Math.round(st.prob * 100)}% dari ${st.n} kejadian.`;
  log(KEY, 'belajar', text);
  S.lesson = { text, short: `Belajar ${e.type.startsWith('ob') ? 'Order Block' : 'SnR'} ${hhmm(e.t)}: ${res}`, at: Date.now() };
}

// ---------- Kirim status ke kantor 3D ----------
function publish() {
  const acc = S.account, sym = S.symbol;
  const pending = S.orders.filter((o) => o.type === 2 || o.type === 3).map((o) => ({ ticket: o.ticket, type: LABEL[OTYPE[o.type]], price: o.price_open, lot: o.volume_current ?? o.volume_initial, sl: o.sl, tp: o.tp, own: o.magic === MAGIC }));
  const positions = S.positions.map((p) => ({ ticket: p.ticket, type: p.type === 0 ? 'BUY' : 'SELL', lot: p.volume, open: p.price_open, profit: p.profit, own: p.magic === MAGIC }));
  const trade = { mode: S.offline ? 'offline' : 'live', symbol: sym && sym.name, bid: sym && sym.bid, ask: sym && sym.ask, open: !!(sym && sym.fresh), currency: acc && acc.currency,
    balance: acc && acc.balance, equity: acc && acc.equity, profit: acc && acc.profit, usd: acc ? acc.equity * factor(acc.currency) : null, pending, positions,
    enabled: settings().trading_enabled, guard: S.guard && S.guard.reason, note: S.note, trend: S.analysis && S.analysis.trend, funds_ok: S.funds.ok, funds: S.funds.reason,
    lesson: S.lesson && S.lesson.text, learned: S.learned || 0, zone_learned: S.zoneLearned || 0, source: feed.source() };
  let step = 'monitor', label = S.note;
  if (pending.length) step = 'limit';
  else if (positions.length) step = 'posisi';
  else if (S.lesson && Date.now() - S.lesson.at < 25000) { step = 'belajar'; label = S.lesson.short; }
  else if (S.analysis) step = 'analisa';
  if (positions.length) { const p = positions[0]; label = `${p.type} ${p.lot} • ${p.profit >= 0 ? '+' : ''}${fmt(p.profit)} ${acc ? acc.currency : ''}`; }
  if (!S.funds.ok && !positions.length) { step = 'menunggu'; label = S.offline ? 'Menunggu koneksi MT5 HFM' : S.funds.empty ? 'Menunggu saldo masuk' : S.funds.reason; }
  const flag = S.offline || S.guard || S.error ? '!' : !S.funds.ok ? '$' : null;
  const flagNote = S.offline ? S.note : S.guard ? S.guard.reason : S.error ? S.error : !S.funds.ok ? S.funds.reason : '';
  officeState.update_agent(KEY, { step, step_label: label, trade, flag, flag_note: flagNote, blink: !!S.guard,
    current_task: 'Trading XAUUSD 24 jam', thought: S.note });
}

let running = false;
async function tick() {
  if (running) return;
  running = true; S.tickN++;
  try {
    const m = 'live';
    if (!mt5.live()) {
      if (!S.offline) log(KEY, 'risiko', 'Koneksi MT5 HFM terputus — Aurel berhenti dan menunggu harga pasar dari broker');
      const b = mt5.info().bridge;
      Object.assign(S, { offline: true, account: null, symbol: null, positions: [], orders: [], analysis: null, error: null,
        funds: { ok: false, reason: 'Menunggu koneksi MT5 HFM' }, note: `Menunggu koneksi MT5 HFM (bridge: ${b.state}${b.error ? ` — ${b.error}` : ''})` });
      return;
    }
    if (S.offline) { S.offline = false; log(KEY, 'trading', 'Terhubung ke harga pasar XAUUSD broker HFM (MetaTrader 5) — Aurel mulai bekerja'); }
    const [acc, sym, pos, ord] = await Promise.all([mt5.api.account(), mt5.api.symbol(), mt5.api.positions(), mt5.api.orders()]);
    Object.assign(S, { account: acc, symbol: sym, positions: pos || [], orders: ord || [], error: null });
    db.transaction(() => (ord || []).forEach((o) => saveOrder(m, o, 'placed')))();
    const fresh = await syncHistory(m);
    if (fresh.length) { announce(m, fresh); snapshot(m, acc, true); } else snapshot(m, acc);
    await learnStep();
    updateFunds(m, acc);
    checkGuard(m, acc);
    await manage(m, sym, S.positions, S.orders);
    const [pos2, ord2] = await Promise.all([mt5.api.positions(), mt5.api.orders()]);
    S.positions = pos2 || []; S.orders = ord2 || [];
  } catch (e) {
    S.error = e.message; S.note = `Gangguan: ${e.message}`;
    if (S.tickN % 20 === 1) log(KEY, 'error', e.message);
  } finally { running = false; publish(); }
}

// ---------- Data untuk halaman /trading ----------
function closedPnl(m, from = 0, to = Date.now() + 1) {
  return db.prepare("SELECT COALESCE(SUM(profit+commission+swap+fee),0) s, COUNT(*) n, SUM(CASE WHEN profit+commission+swap+fee>0 THEN 1 ELSE 0 END) w FROM trade_deals WHERE mode=? AND entry IN ('out','inout','out_by') AND type IN ('buy','sell') AND ts BETWEEN ? AND ?").get(m, from, to);
}
function equityAt(m, ts) {
  return db.prepare('SELECT equity FROM trade_equity WHERE mode=? AND ts<=? ORDER BY ts DESC LIMIT 1').get(m, ts)
    || db.prepare('SELECT equity FROM trade_equity WHERE mode=? ORDER BY ts LIMIT 1').get(m);
}
function summary() {
  const m = S.mode, acc = S.account || {}, f = factor(acc.currency), st = settings();
  const first = db.prepare("SELECT MIN(ts) t FROM trade_deals WHERE mode=? AND type IN ('buy','sell')").get(m).t;
  const all = closedPnl(m);
  const ret = (ms) => { const e0 = equityAt(m, Date.now() - ms); return e0 && e0.equity ? ((acc.equity - e0.equity) / e0.equity) * 100 : 0; };
  const peak = db.prepare('SELECT MAX(equity) e FROM trade_equity WHERE mode=?').get(m).e;
  return {
    mode: S.offline ? 'offline' : 'live', online: !S.offline, mt5: mt5.info(), feed: feed.info(), learned: S.learned || 0, zone_learned: S.zoneLearned || 0,
    zones: (S.zones || []).map((z) => ({ tf: z.tf, atr: z.atr, levels: z.levels, obs: z.obs })), lesson: S.lesson ? S.lesson.text : null, usd_idr: USD_IDR, factor: f, tf: TF,
    account: { login: acc.login, server: acc.server, name: acc.name, company: acc.company, currency: acc.currency, leverage: acc.leverage, balance: acc.balance, equity: acc.equity,
      profit: acc.profit, margin: acc.margin, margin_free: acc.margin_free, margin_level: acc.margin_level, trade_allowed: acc.trade_allowed },
    kpi: { equity: acc.equity, equity_usd: (acc.equity || 0) * f, unrealized: acc.profit || 0, closed: all.s, closed_usd: all.s * f, trades: all.n, wins: all.w || 0,
      win_rate: all.n ? ((all.w || 0) / all.n) * 100 : 0, since: first, peak, ret: { d1: ret(86400e3), d7: ret(7 * 86400e3), d30: ret(30 * 86400e3) } },
    symbol: S.symbol, analysis: S.analysis, note: S.note, error: S.error, guard: S.guard, funds: S.funds,
    positions: S.positions.map((p) => ({ ...p, side: p.type === 0 ? 'BUY' : 'SELL', own: p.magic === MAGIC })),
    pending: S.orders.map((o) => ({ ...o, kind: LABEL[OTYPE[o.type]] || OTYPE[o.type], own: o.magic === MAGIC,
      reason: (db.prepare('SELECT reason FROM trade_orders WHERE mode=? AND ticket=?').get(m, o.ticket) || {}).reason })),
    settings: { enabled: st.trading_enabled, ai_review: st.trading_ai_review, lot: st.trading_lot, max_lot: MAX_LOT, max_pending: st.trading_max_pending, max_positions: st.trading_max_positions, daily_loss_pct: st.trading_daily_loss_pct, ttl_min: TTL_MIN, min_balance_usd: MIN_USD },
    agent: (() => { const a = officeState.find(KEY); return a ? { key: a.key, name: a.name, role: a.role, color: a.color, step: a.step, step_label: a.step_label, photo: officeState._public(a).photo } : null; })()
  };
}
function series(days = 30) {
  const m = S.mode, from = Date.now() - days * 86400e3;
  let eq = db.prepare('SELECT ts, balance, equity FROM trade_equity WHERE mode=? AND ts>=? ORDER BY ts').all(m, from);
  if (eq.length > 400) { const k = Math.ceil(eq.length / 400); eq = eq.filter((_, i) => i % k === 0 || i === eq.length - 1); }
  let cum = closedPnl(m, 0, from).s;
  const pnl = db.prepare("SELECT ts, profit+commission+swap+fee p FROM trade_deals WHERE mode=? AND entry IN ('out','inout','out_by') AND type IN ('buy','sell') AND ts>=? ORDER BY ts").all(m, from)
    .map((d) => { cum += d.p; return { ts: d.ts, pnl: d.p, cum }; });
  return { mode: m, factor: factor(S.account && S.account.currency), currency: S.account && S.account.currency, equity: eq, pnl };
}
function calendar(month) {
  const m = S.mode;
  const [y, mo] = (month || dayWib(now()).slice(0, 7)).split('-').map(Number);
  const from = Date.UTC(y, mo - 1, 1) - WIB, to = Date.UTC(y, mo, 1) - WIB;
  const rows = db.prepare("SELECT ts, profit+commission+swap+fee p FROM trade_deals WHERE mode=? AND entry IN ('out','inout','out_by') AND type IN ('buy','sell') AND ts>=? AND ts<?").all(m, from, to);
  const days = {};
  rows.forEach((r) => { const d = Number(dayWib(r.ts).slice(8, 10)); days[d] = days[d] || { pnl: 0, n: 0 }; days[d].pnl += r.p; days[d].n++; });
  return { month: `${y}-${String(mo).padStart(2, '0')}`, days, total: rows.reduce((s, r) => s + r.p, 0), active: Object.keys(days).length, factor: factor(S.account && S.account.currency), currency: S.account && S.account.currency };
}
const orders = (limit = 50) => db.prepare('SELECT * FROM trade_orders WHERE mode=? ORDER BY COALESCE(ts_done, ts_setup) DESC LIMIT ?').all(S.mode, limit);
const deals = (limit = 100) => db.prepare("SELECT * FROM trade_deals WHERE mode=? ORDER BY ts DESC LIMIT ?").all(S.mode, limit);

async function cancelOrder(ticket) { const r = await mt5.api.cancel(Number(ticket)); log(KEY, 'batal', `Order #${ticket} dibatalkan oleh Bos Kevin`); await syncHistory(S.mode, true); tick(); return r; }
async function closePosition(ticket) { const r = await mt5.api.close(Number(ticket)); log(KEY, 'tutup', `Posisi #${ticket} ditutup oleh Bos Kevin`); setTimeout(() => syncHistory(S.mode, true).then((f) => announce(S.mode, f)).catch(() => {}), 1500); tick(); return r; }
async function panic() {
  const { setSetting } = require('../db');
  setSetting('trading_enabled', false);
  const ord = (await mt5.api.orders()).filter((o) => o.magic === MAGIC), pos = (await mt5.api.positions()).filter((p) => p.magic === MAGIC);
  for (const o of ord) { try { await mt5.api.cancel(o.ticket); } catch (_) {} }
  for (const p of pos) { try { await mt5.api.close(p.ticket); } catch (_) {} }
  log(KEY, 'risiko', `STOP darurat oleh Bos: ${ord.length} order dibatalkan, ${pos.length} posisi ditutup, trading dimatikan`);
  notify({ type: 'warn', title: 'Trading dihentikan (STOP darurat)', text: `${ord.length} order dibatalkan • ${pos.length} posisi ditutup`, telegram: false });
  setTimeout(tick, 1000);
  return { canceled: ord.length, closed: pos.length };
}

// Laporan harian Aurel (dipanggil saat laporan kantor dibuat)
function report(day, from, to) {
  const m = S.mode, c = closedPnl(m, from - 12 * 3600e3, to), acc = S.account || {}, f = factor(acc.currency);
  const placed = db.prepare("SELECT COUNT(*) n FROM trade_orders WHERE mode=? AND ts_setup BETWEEN ? AND ? AND magic=?").get(m, from - 12 * 3600e3, to, MAGIC).n;
  const content = [`# Laporan harian — Aurel (XAUUSD Trader)`, `Tanggal ${day} • kerja 24 jam di tambang emas • akun HFM MetaTrader 5`, '', '## Ringkasan',
    `- Ekuitas: ${fmt(acc.equity)} ${acc.currency || ''} (≈ $${fmt((acc.equity || 0) * f)})`, `- Order limit dipasang: ${placed}`, `- Posisi ditutup: ${c.n} • profit ${c.w || 0} • rugi ${c.n - (c.w || 0)}`,
    `- PnL terealisasi: ${fmt(c.s)} ${acc.currency || ''} (≈ $${fmt(c.s * f)})`, `- Posisi terbuka sekarang: ${S.positions.length} • order menggantung: ${S.orders.length}`, '', '## Catatan', `- ${S.note}`].join('\n');
  db.prepare('INSERT OR IGNORE INTO reports(day,agent,title,content,stats,ts) VALUES(?,?,?,?,?,?)').run(day, KEY, 'Laporan Aurel', content, JSON.stringify({ trades: c.n, wins: c.w || 0, pnl: c.s, placed }), now());
}

function startTrader() {
  mt5.init();
  // Bersihkan sisa data simulasi versi lama: semua harga & saldo sekarang hanya dari akun HFM
  db.transaction(() => {
    ['trade_equity', 'trade_deals', 'trade_orders'].forEach((t) => db.prepare(`DELETE FROM ${t} WHERE mode<>'live'`).run());
    db.prepare("DELETE FROM trade_learn WHERE source<>'mt5'").run();
    db.prepare("DELETE FROM kv WHERE k='sim_broker' OR (k LIKE 'learn_upto_%' AND k<>'learn_upto_mt5')").run();
  })();
  feed.start();
  officeState.update_agent(KEY, { current_task: 'Trading XAUUSD 24 jam', thought: 'Memantau XAUUSD' });
  setTimeout(tick, 1500);
  setInterval(tick, 15000);
  console.log(`Trading  : agent Aurel XAUUSD 24 jam • ${mt5.info().configured ? `akun MT5 ${process.env.MT5_LOGIN} @ ${process.env.MT5_SERVER}` : 'akun MT5 belum diisi'} • harga hanya dari MT5 HFM (menunggu bridge terhubung)`);
}

module.exports = { startTrader, summary, series, calendar, orders, deals, cancelOrder, closePosition, panic, report, tick, KEY };
