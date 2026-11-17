const { db, now, settings } = require('../db');

// Pusat notifikasi: simpan ke database dan tampilkan di website (SSE).
// Teruskan ke Telegram hanya bila pengaturan telegram_notify dinyalakan (default: mati).
const clients = new Set();
let telegramSender = null;

function addSseClient(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => { clearInterval(ping); clients.delete(res); });
}

function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch (_) { clients.delete(c); } }
}

// type: info | success | warn | order | resi | money | ad | agent | project
function notify({ type = 'info', title, text = '', data = null, telegram = true }) {
  const row = db.prepare('INSERT INTO notifications(ts,type,title,text,data) VALUES(?,?,?,?,?)')
    .run(now(), type, title, text, data ? JSON.stringify(data) : null);
  const n = { id: row.lastInsertRowid, ts: now(), type, title, text, data };
  broadcast('notify', n);
  if (telegram && telegramSender && settings().telegram_notify) telegramSender(n).catch(() => {});
  return n;
}

const list = (limit = 30) => db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit)
  .map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
const unread = () => db.prepare('SELECT COUNT(*) c FROM notifications WHERE read=0').get().c;
const markAllRead = () => db.prepare('UPDATE notifications SET read=1').run();
const setTelegramSender = (fn) => { telegramSender = fn; };

module.exports = { notify, broadcast, addSseClient, list, unread, markAllRead, setTelegramSender };
