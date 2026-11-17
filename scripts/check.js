// SWEET AI Agent Office — pemeriksaan sistem.   Jalankan: npm run check   (atau scripts\check.bat)
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
const fs = require('fs');
const net = require('net');
const axios = require('axios');

const C = { ok: '\x1b[32m', bad: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[90m', b: '\x1b[1m', r: '\x1b[0m' };
let fails = 0;
const ok = (m) => console.log(`  ${C.ok}[ OK ]${C.r} ${m}`);
const bad = (m) => { fails++; console.log(`  ${C.bad}[GAGAL]${C.r} ${m}`); };
const warn = (m) => console.log(`  ${C.warn}[INFO]${C.r} ${m}`);
const head = (m) => console.log(`\n${C.b}${m}${C.r}`);

const portFree = (port, host) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, host);
});

(async () => {
  console.log(`${C.b}SWEET AI Agent Office — pemeriksaan sistem${C.r}`);

  head('Lingkungan');
  const major = Number(process.versions.node.split('.')[0]);
  major >= 18 ? ok(`Node.js ${process.version}`) : bad(`Node.js ${process.version} — butuh versi 18 atau lebih baru (disarankan 22 LTS)`);
  fs.existsSync('.env') ? ok('File .env ditemukan') : bad('File .env belum ada — jalankan scripts\\setup.bat');
  fs.existsSync('node_modules/express') ? ok('Dependensi terpasang') : bad('Dependensi belum terpasang — jalankan npm install');
  fs.existsSync('node_modules/better-sqlite3') ? ok('better-sqlite3 terpasang') : warn('better-sqlite3 tidak terpasang — memakai SQLite bawaan Node (butuh Node 22.13+)');

  head('Database');
  try { const { db, DATA_DIR } = require('../src/db'); ok(`SQLite siap (${db.engine}) di ${path.relative(process.cwd(), DATA_DIR) || DATA_DIR}`); }
  catch (e) { bad('Database: ' + e.message); }

  head('Server');
  const port = Number(process.env.PORT) || 8080, host = process.env.HOST || '127.0.0.1';
  (await portFree(port, host)) ? ok(`Port ${port} bebas`) : warn(`Port ${port} sedang dipakai (server mungkin sudah berjalan)`);

  head('Akun & email OTP');
  process.env.ADMIN_EMAIL ? ok(`Admin: ${process.env.ADMIN_EMAIL}`) : warn('ADMIN_EMAIL kosong');
  require('../src/services/mailer').configured() ? ok(`SMTP siap (${process.env.SMTP_USER})`) : warn('SMTP_USER / SMTP_PASS kosong — pendaftaran akun baru belum bisa menerima kode OTP');

  const llm = require('../src/ai/llm');
  head(`AI (urutan: ${llm.order().join(' > ')})`);
  if (llm.hasClaude()) {
    try {
      const model = await llm.claudeModel();
      const d = await llm.claudeMessages({ system: 'Jawab satu kata.', messages: [{ role: 'user', content: 'Balas: siap' }], maxTokens: 10 });
      ok(`Claude terhubung • model ${model} • "${(d.content || []).map((c) => c.text || '').join('').trim()}"`);
    } catch (e) { bad('Claude: ' + llm.errMsg(e)); }
  } else warn('Claude: CLAUDE_API_KEY kosong');
  if (llm.hasGemini()) {
    try { await llm.geminiCall({ contents: [{ role: 'user', parts: [{ text: 'Balas: siap' }] }] }); ok('Gemini terhubung'); }
    catch (e) { bad('Gemini: ' + llm.errMsg(e)); }
  } else warn('Gemini: tidak dipakai');
  if (llm.hasHermes()) {
    const base = (process.env.HERMES_API_URL || 'http://127.0.0.1:8642/v1').replace(/\/+$/, '');
    const hp = await require('../src/services/hermes').ping();
    hp.api ? ok('Hermes aktif di ' + base) : warn(`Hermes belum berjalan di ${base} — server SWEET menyalakannya otomatis saat start. Belum terpasang? jalankan scripts\\hermes-install.bat`);
  }

  head('Telegram');
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try { const r = await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`, { timeout: 10000 }); ok(`Bot @${r.data.result.username}`); }
    catch (e) { bad('Token Telegram ditolak: ' + (e.response?.data?.description || e.message)); }
  } else warn('TELEGRAM_BOT_TOKEN kosong');

  head('Lazada');
  const lazada = require('../src/services/lazada');
  lazada.mode === 'live' ? ok('Lazada Open Platform LIVE') : warn(`Mode ${lazada.mode}${lazada.mode === 'simulasi' ? ' — isi LAZADA_APP_KEY & LAZADA_APP_SECRET untuk data asli' : ' — buka Dashboard > Sistem > Otorisasi'}`);
  const sess = require('../src/services/lazadaSession').status();
  sess.found ? ok(`cookies.txt: ${sess.cookies} cookie Lazada${sess.expired ? `, ${sess.expired} kedaluwarsa` : ''}`) : warn('cookies.txt belum ada — upload di Dashboard > Sistem');

  console.log(`\n${fails ? `${C.bad}${fails} masalah ditemukan.${C.r}` : `${C.ok}Semua pemeriksaan lulus.${C.r}`}  Jalankan: ${C.b}npm start${C.r} lalu buka http://localhost:${port}\n`);
  process.exit(fails ? 1 : 0);
})();
