// SWEET AI Agent Office — bot Telegram untuk Bos Kevin.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');
const officeState = require('../state/officeState');
const lazada = require('../services/lazada');
const lazadaSession = require('../services/lazadaSession');
const ads = require('../services/ads');
const stats = require('../services/stats');
const lynk = require('../services/lynk');
const pipeline = require('../jobs/pipeline');
const meeting = require('../jobs/meeting');
const shift = require('../jobs/shift');
const clock = require('../state/clock');
const orders = require('../services/orders');
const llm = require('../ai/llm');
const notifySvc = require('../services/notify');
const { runAgent } = require('../ai/engine');
const { db, log, settings, setSetting, now } = require('../db');

const OWNER_FILE = path.join(officeState.DATA_DIR, 'owner.json');
const rp = stats.rupiah;
const t = (ms) => new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
let bot = null;

// ---------- Pemilik ----------
function ownerIds() {
  const env = (process.env.OWNER_TELEGRAM_IDS || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  let saved = [];
  try { saved = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8')).ids || []; } catch (_) {}
  return [...new Set([...env, ...saved])];
}
const isOwner = (ctx) => ownerIds().includes(ctx.from && ctx.from.id);
const claimOwner = (ctx) => fs.writeFileSync(OWNER_FILE, JSON.stringify({ ids: [ctx.from.id] }));
const baseUrl = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8080}`;

async function sendLong(ctx, text, extra) {
  const s = String(text || '(kosong)');
  for (let i = 0; i < s.length; i += 3800) await ctx.reply(s.slice(i, i + 3800), i + 3800 >= s.length ? extra : undefined);
}

// Emoji hanya untuk notifikasi penting
const ICON = { order: '🛒', money: '💰', warn: '⚠️', ad: '📣' };

// Notifikasi sistem -> Telegram pemilik (iklan dapat tombol Terima/Tolak)
async function sendNotification(n) {
  if (!bot) return;
  const extra = n.data?.ad_id ? Markup.inlineKeyboard([[Markup.button.callback('Terima', `ad:ok:${n.data.ad_id}`), Markup.button.callback('Tolak', `ad:no:${n.data.ad_id}`)]]) : undefined;
  for (const id of ownerIds()) {
    try { await bot.telegram.sendMessage(id, `${ICON[n.type] ? ICON[n.type] + ' ' : ''}${n.title}\n${n.text || ''}`.trim().slice(0, 3900), extra); } catch (e) { console.warn('[notify]', e.message); }
  }
}

async function syncAvatar(ctx, agent) {
  try {
    if (officeState.hasAvatar(agent.telegram_username)) return;
    const photos = await ctx.telegram.getUserProfilePhotos(ctx.from.id, 0, 1);
    if (!photos.total_count) return;
    const sizes = photos.photos[0];
    const link = await ctx.telegram.getFileLink(sizes[sizes.length - 1].file_id);
    const img = await axios.get(link.href, { responseType: 'arraybuffer' });
    officeState.saveAvatar(agent.telegram_username, Buffer.from(img.data));
  } catch (e) { console.warn('[avatar]', e.message); }
}

function agentFromText(text) {
  for (const raw of (text || '').match(/@(\w+)/g) || []) { const a = officeState.find(raw); if (a) return a; }
  return null;
}

const HELP = `SWEET AI Agent Office — perintah Bos Kevin

KANTOR
/menu – menu tombol • /status – kondisi kantor
/web – link Beranda, Office, Ruang Agen, Dashboard
/rapat [topik] – semua agen ke Ruang Rapat & melapor bergiliran
/bubar – tutup rapat: kesimpulan + action item, agen langsung kerjakan
/notulen [id] – notulen rapat • /rapat_list – riwayat rapat
/istirahat – agen ke Lounge • /kerja – kembali bekerja
/jam – jam kantor • /timelapse 1|60|300|900 – kecepatan waktu
/lompat HH:MM – lompat ke jam tertentu (mis. /lompat 18:55)
/laporan_harian [tanggal] – laporan akhir jam kerja

AGEN (1 agen = 1 kerjaan)
/agen – status semua agen • /agen nama – detail & aktivitas
/tugas @agen perintah – beri tugas ke 1 agen
/tim dev|toko perintah – perintah ke satu tim
/semua perintah – perintah ke semua agen
/kerjaan @agen – riwayat tugas agen

PROYEK (10 agen)
/proyek <ide> – PM → Arsitek → Desainer → API → Mobile+Backend → DB → QA → Security → DevOps → Review Tech Lead
/proyek_status [id] • /proyek_list • /hasil <id> <tahap>

TOKO LAZADA
/pesanan [n] • /resi • /resi_cetak • /pack <order_id> • /rts <order_id>
/pendapatan [hari] • /laporan • /terlaris • /pembeli
/produk • /stok – stok menipis • /harga <sku> <harga> • /setstok <sku> <jumlah>
/chat – chat pembeli • /balas <session_id> <teks>
/iklan <produk> – Mira buat proposal • /iklan_list • /terima <id> • /tolak <id>
/sync – sinkron pesanan & produk sekarang

LYNK.ID
/lynk <jumlah> [catatan] – catat penghasilan • /lynk_cek – ringkasan

REKRUTMEN
/rekrut @username [peran] • /pecat @username • /karyawan

SISTEM
/ai – status AI • /set <pengaturan> on|off • /pengaturan
/otorisasi – hubungkan Lazada • /sesi – cek cookies.txt • /notif

Atau tulis pesan biasa / sebut agen: "@mira iklankan Kopi Arabika"`;

function createBot() {
  const b = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  b.use(async (ctx, next) => {
    if (ctx.from?.username) { const a = officeState.linkTelegramUser(ctx.from); if (a) await syncAvatar(ctx, a); }
    return next();
  });

  const owner = (fn) => async (ctx, ...r) => {
    if (!isOwner(ctx)) return ctx.reply('Perintah ini khusus Bos Kevin (pemilik).');
    try { await fn(ctx, ...r); } catch (e) { ctx.reply(`⚠️ Gagal: ${e.message}`); }
  };
  const cmd = (names, fn) => b.command(names, owner(fn));
  const args = (ctx) => ctx.message.text.split(/\s+/).slice(1);
  const rest = (ctx) => ctx.message.text.split(/\s+/).slice(1).join(' ').trim();
  const typing = (ctx) => ctx.sendChatAction('typing').catch(() => {});
  const logCmd = (ctx) => log('kevin', 'telegram', ctx.message.text.slice(0, 160));

  b.start(async (ctx) => {
    if (!ownerIds().length) { claimOwner(ctx); return ctx.reply(`Halo ${ctx.from.first_name}! Kamu terdaftar sebagai PEMILIK (Bos Kevin) SWEET AI Agent Office. \n\nKetik /menu atau /bantuan.`); }
    if (isOwner(ctx)) return ctx.reply('Selamat datang kembali, Bos Kevin! \nKetik /menu atau /bantuan.');
    const a = officeState.find(ctx.from.username);
    if (a) return ctx.reply(`Selamat bergabung, ${a.name}! Kamu terdaftar sebagai ${a.role}. Karakter 3D-mu sudah ada di kantor.`);
    return ctx.reply('Bot ini khusus pemilik SWEET AI Agent Office. Minta pemilik merekrut username Telegram kamu.');
  });

  cmd(['bantuan', 'help'], (ctx) => ctx.reply(HELP));
  cmd('ping', (ctx) => ctx.reply(`pong • uptime ${Math.round(process.uptime() / 60)} menit • Lazada: ${lazada.mode} • AI: ${llm.order().filter((p) => ({ claude: llm.hasClaude, gemini: llm.hasGemini, hermes: llm.hasHermes })[p]()).join('→') || 'simulasi'}`));

  const menuKb = () => Markup.inlineKeyboard([
    [Markup.button.callback('Pesanan', 'menu:pesanan'), Markup.button.callback('Resi', 'menu:resi'), Markup.button.callback('Pendapatan', 'menu:pendapatan')],
    [Markup.button.callback('Laporan', 'menu:laporan'), Markup.button.callback('Terlaris', 'menu:terlaris'), Markup.button.callback('Stok', 'menu:stok')],
    [Markup.button.callback('Iklan', 'menu:iklan'), Markup.button.callback('Tim Agen', 'menu:agen'), Markup.button.callback('Proyek', 'menu:proyek')],
    [officeState.mode === 'rapat' ? Markup.button.callback('Bubarkan Rapat', 'menu:bubar') : Markup.button.callback('Mulai Rapat', 'menu:rapat'),
      officeState.mode === 'istirahat' ? Markup.button.callback('Kembali Kerja', 'menu:kerja') : Markup.button.callback('Istirahat', 'menu:istirahat')],
    [Markup.button.callback('Sinkron Toko', 'menu:sync'), Markup.button.callback('Link Web', 'menu:web')]
  ]);
  cmd('menu', (ctx) => ctx.reply(`Menu SWEET • mode kantor: ${officeState.mode.toUpperCase()}`, menuKb()));

  const web = (ctx) => ctx.reply(`SWEET AI Agent Office\nBeranda: ${baseUrl()}/\nOffice: ${baseUrl()}/office\nRuang Agen: ${baseUrl()}/ruangan\nDashboard: ${baseUrl()}/dashboard\n(buka di komputer yang menjalankan server, atau isi PUBLIC_URL di .env)`);
  cmd(['web', 'dashboard', 'office', 'ruangan'], web);

  // ----- Status kantor -----
  const agenList = () => officeState.agents.map((a) => `${a.busy ? '[kerja]' : '[idle] '} #${a.no || '–'} ${a.name} — ${a.role}\n     ${a.busy ? a.current_task : (a.step_label || a.thought)}${a.flag ? `  [${a.flag}] ${a.flag_note}` : ''}`).join('\n');
  const statusText = () => {
    const k = stats.kpi(); const busy = officeState.agents.filter((a) => a.busy).length;
    const c = clock.snapshot();
    return `Jam kantor ${c.time} (${c.label}${c.speed > 1 ? `, timelapse ${c.speed}x` : ''})\nKondisi kantor: ${officeState.mode.toUpperCase()}${officeState.meeting ? ` (rapat #${officeState.meeting.id}: ${officeState.meeting.topic})` : ''}\n` +
      `Resi menunggu dicetak: ${orders.waitingPrint()} • tanda mendesak: ${officeState.agents.filter((a) => a.flag === '!').length}\n` +
      `${busy}/${officeState.agents.length} agen sedang bekerja • ${k.tasks_today} tugas hari ini\n` +
      `Hari ini ${rp(k.today_revenue)} • ${k.today_orders} pesanan • ${k.today_buyers} pembeli\n` +
      `${k.pending_orders} menunggu proses • ${k.active_resi} resi aktif • ${k.ads_proposed} iklan menunggu Terima\n` +
      `Proyek: ${pipeline.runningId() ? `#${pipeline.runningId()} berjalan` : 'tidak ada'} • Lazada: ${lazada.mode}`;
  };
  cmd('status', (ctx) => ctx.reply(statusText()));

  // ----- Agen -----
  cmd(['agen', 'karyawan'], (ctx) => {
    const a = args(ctx)[0] && officeState.find(args(ctx)[0]);
    if (a) {
      const act = db.prepare('SELECT ts,text FROM activity WHERE agent=? ORDER BY id DESC LIMIT 8').all(a.key);
      const done = db.prepare("SELECT COUNT(*) c FROM tasks WHERE agent=? AND status='done'").get(a.key).c;
      return ctx.reply(`${a.name} — ${a.role} (agent #${a.no || '-'})\n${a.specialty}\n${a.busy ? `Sedang: ${a.current_task}` : 'Idle'}\n${a.thought}\n${done} tugas selesai\n\nAktivitas terbaru:\n` +
        (act.map((x) => `• ${t(x.ts)} ${x.text}`).join('\n') || '(belum ada)'));
    }
    ctx.reply(`Tim SWEET (${officeState.agents.length} agen)\n\n${agenList()}`);
  });
  cmd('kerjaan', (ctx) => {
    const a = officeState.find(args(ctx)[0]);
    if (!a) return ctx.reply('Format: /kerjaan @agen\nContoh: /kerjaan @dimas');
    const rows = db.prepare('SELECT * FROM tasks WHERE agent=? ORDER BY id DESC LIMIT 10').all(a.key);
    ctx.reply(`Kerjaan ${a.name}\n\n` + (rows.map((r) => `${r.status === 'done' ? '' : r.status === 'running' ? '' : ''} ${t(r.ts)} [${r.source || '-'}] ${r.title}`).join('\n') || '(belum ada)'));
  });
  cmd('tugas', async (ctx) => {
    const [ref, ...tx] = args(ctx);
    const a = officeState.find(ref);
    if (!a || !tx.length) return ctx.reply('Format: /tugas @agen perintah\nContoh: /tugas @bayu cek stok yang menipis');
    logCmd(ctx); await typing(ctx);
    sendLong(ctx, `${a.name}:\n${await runAgent(a, tx.join(' '), String(ctx.chat.id), 'telegram')}`);
  });
  const teamCmd = async (ctx, list, text, label) => {
    if (!text) return ctx.reply(`Tulis perintahnya. Contoh: /${label} buat laporan singkat pekerjaan hari ini`);
    logCmd(ctx);
    await ctx.reply(`Perintah dikirim ke ${list.length} agen (${label}). Hasil dikirim satu per satu…`);
    for (const a of list) { await typing(ctx); await sendLong(ctx, `${a.name}:\n${await runAgent(a, text, `tg-${label}`, 'telegram')}`); }
    ctx.reply('Semua agen selesai.');
  };
  cmd('semua', (ctx) => teamCmd(ctx, officeState.agents.filter((a) => a.type === 'builtin'), rest(ctx), 'semua'));
  cmd('tim', (ctx) => {
    const [dept, ...tx] = args(ctx);
    if (!['dev', 'toko'].includes(dept)) return ctx.reply('Format: /tim dev|toko perintah\nContoh: /tim toko cek kondisi toko hari ini');
    return teamCmd(ctx, officeState.agents.filter((a) => a.dept === dept), tx.join(' '), `tim ${dept}`);
  });

  // ----- Rapat & mode kantor -----
  const startMeeting = (ctx, topic) => {
    const m = meeting.start(topic || 'Koordinasi Rutin', 'telegram');
    return ctx.reply(`Rapat #${m.id} dimulai: ${m.topic}\n\nSemua agen berjalan ke Ruang Rapat.\nMereka akan melapor bergiliran (lihat balon bicara di ${baseUrl()}/office).\nNotulen lengkap tampil di website (Dashboard › Rapat), atau ketik /notulen.\n\nKetik /bubar untuk menutup rapat.`);
  };
  const endMeeting = async (ctx) => {
    await ctx.reply('Menutup rapat dan menyusun kesimpulan…'); await typing(ctx);
    const r = await meeting.end({ followUp: true });
    sendLong(ctx, `Rapat #${r.id} dibubarkan (${r.topic})\n\nKesimpulan:\n${r.summary}\n\nAction item (langsung dikerjakan):\n${r.actions.map((x) => `• ${officeState.find(x.agent)?.name || x.agent}: ${x.task}`).join('\n')}\n\nSemua agen kembali ke ruangan masing-masing.`);
  };
  cmd('rapat', (ctx) => { logCmd(ctx); return startMeeting(ctx, rest(ctx)); });
  cmd(['bubar', 'selesai'], (ctx) => { logCmd(ctx); return endMeeting(ctx); });
  cmd('notulen', (ctx) => {
    const id = Number(args(ctx)[0]) || meeting.list(1)[0]?.id;
    const m = id && meeting.get(id);
    if (!m) return ctx.reply('Belum ada rapat.');
    sendLong(ctx, `Notulen rapat #${m.id} — ${m.topic}\n${t(m.ts)} • ${m.status}\n\n` +
      (m.notes.map((n) => `• ${officeState.find(n.agent)?.name || n.agent}: ${n.text}`).join('\n') || '(belum ada laporan)') +
      (m.summary ? `\n\nKesimpulan: ${m.summary}` : '') + (m.action_items.length ? `\n\nAction item:\n${m.action_items.map((x) => `• ${x.agent}: ${x.task}`).join('\n')}` : ''));
  });
  cmd('rapat_list', (ctx) => {
    const l = meeting.list(10);
    ctx.reply(l.length ? 'Riwayat rapat\n\n' + l.map((m) => `#${m.id} ${t(m.ts)} • ${m.topic} (${m.status})`).join('\n') + '\n\nDetail: /notulen <id>' : 'Belum ada rapat.');
  });
  cmd('istirahat', (ctx) => { meeting.breakTime(true); ctx.reply('Jam istirahat! Semua agen menuju Lounge. Ketik /kerja untuk kembali bekerja.'); });
  cmd('kerja', (ctx) => { meeting.breakTime(false); ctx.reply('Semua agen kembali ke ruangan dan bekerja.'); });

  // ----- Proyek -----
  cmd('proyek', (ctx) => {
    const idea = rest(ctx);
    if (!idea) return ctx.reply('Format: /proyek <ide>\nContoh: /proyek aplikasi chat dengan pembayaran');
    logCmd(ctx);
    const id = pipeline.startProject(idea);
    ctx.reply(`Proyek #${id} dimulai!\n\n Kamala (PM) → daftar fitur\n Indra (Arsitek) → data/ domain/ presentation/ lib/\n Nadine (Desainer) → alur & tampilan\n Norman → kontrak API\n Felix (Mobile) + Norman (Backend) → kerja barengan, 1 kontrak\n Nola (DB) → tabel tanpa dobel\n Wucing (QA) → cari bug\n Raka (Security) → cek celah\n Robo (DevOps) → build & deploy\nChelsea (Tech Lead) → review, yang jelek dikembalikan\n\nPantau: /proyek_status ${id} atau ${baseUrl()}/dashboard#proyek`);
  });
  cmd('proyek_status', (ctx) => {
    const id = Number(args(ctx)[0]) || pipeline.listProjects()[0]?.id;
    const p = id && pipeline.getProject(id);
    if (!p) return ctx.reply('Belum ada proyek.');
    ctx.reply(`Proyek #${p.id} [${p.status}] tahap: ${p.step} • putaran review ${p.round}\n${p.idea.slice(0, 160)}\n\n` +
      p.deliverables.map((x) => `${x.status === 'approved' ? '' : x.status === 'returned' ? '' : ''} ${x.kind} (${x.agent}) r${x.round}${x.review ? ` — ${x.review.slice(0, 80)}` : ''}`).join('\n') + (p.summary ? `\n\n${p.summary}` : ''));
  });
  cmd('proyek_list', (ctx) => {
    const l = pipeline.listProjects();
    ctx.reply(l.length ? l.slice(0, 10).map((p) => `#${p.id} [${p.status}] ${p.idea.slice(0, 60)}`).join('\n') : 'Belum ada proyek.');
  });
  cmd('hasil', (ctx) => {
    const [id, ...stepArr] = args(ctx); const step = stepArr.join(' ').toLowerCase();
    const p = pipeline.getProject(Number(id));
    if (!p) return ctx.reply('Format: /hasil <id proyek> <tahap>\nTahap: fitur, arsitektur, desain, kontrak, mobile, backend, database, qa, keamanan, devops');
    const st = pipeline.STEPS.find((s) => s.id === step || s.kind.toLowerCase().includes(step));
    const d = [...p.deliverables].reverse().find((x) => !st || x.kind === st.kind);
    if (!d) return ctx.reply('Hasil belum ada.');
    sendLong(ctx, `${d.kind} — ${officeState.find(d.agent)?.name} (putaran ${d.round}, ${d.status})\n\n${d.content}`);
  });

  // ----- Toko -----
  const pesanan = (ctx, nArg) => {
    const n = Math.min(Number(nArg) || 8, 25);
    const o = stats.recentOrders(n);
    ctx.reply(o.length ? `Pesanan terbaru\n\n` + o.map((x) => `#${x.order_id} • ${x.buyer} • ${rp(x.total)} • ${x.status}${x.source === 'demo' ? ' (demo)' : ''}\n   ${x.items.map((i) => i.name).join(', ')}${x.tracking_code ? `\n   ${x.shipment_provider || ''} ${x.tracking_code}` : ''}`).join('\n') : 'Belum ada pesanan.');
  };
  cmd('pesanan', (ctx) => pesanan(ctx, args(ctx)[0]));
  const resi = (ctx) => {
    const o = db.prepare("SELECT * FROM orders WHERE tracking_code IS NOT NULL AND tracking_code!='' ORDER BY created_at DESC LIMIT 15").all();
    ctx.reply(o.length ? 'Resi\n\n' + o.map((x) => `#${x.order_id} • ${x.buyer}\n   ${x.shipment_provider || 'Kurir'}: ${x.tracking_code} (${x.status})`).join('\n') : 'Belum ada resi.');
  };
  cmd('resi', resi);
  const orderAction = (action) => async (ctx) => {
    const id = args(ctx)[0];
    if (!id) return ctx.reply(`Format: /${action} <order_id>`);
    const r = action === 'pack' ? await orders.pack(id) : await orders.rts(id);
    ctx.reply(action === 'pack' ? `Pesanan #${id} dikemas.${r.tracking_code ? `\nResi: ${r.provider || ''} ${r.tracking_code}` : ''}` : `Pesanan #${id} ditandai siap kirim.`);
  };
  cmd('pack', orderAction('pack'));
  cmd('rts', orderAction('rts'));

  const pendapatan = (ctx, dArg) => {
    const d = Math.min(Number(dArg) || 7, 60);
    const rows = stats.revenueByDay(d); const k = stats.kpi();
    ctx.reply(`Pendapatan ${d} hari\n\n` + rows.map((r) => `${r.date}  ${rp(r.total)}  (${r.orders} order, ${r.buyers} pembeli)`).join('\n') +
      `\n\nTotal periode: ${rp(rows.reduce((s, r) => s + r.total, 0))}\nHari ini: ${rp(k.today_revenue)} (kemarin ${rp(k.yesterday_revenue)})\nLazada: ${rp(k.by_source.lazada)} • Lynk.id: ${rp(k.by_source.lynk)} • Lain: ${rp(k.by_source.manual)}`);
  };
  cmd('pendapatan', (ctx) => pendapatan(ctx, args(ctx)[0]));
  const laporan = (ctx) => {
    const k = stats.kpi();
    ctx.reply(`Laporan SWEET\n\nHari ini: ${rp(k.today_revenue)} (${k.today_orders} pesanan, ${k.today_buyers} pembeli, rata-rata ${rp(k.today_aov)})\n7 hari: ${rp(k.week_revenue)} • 30 hari: ${rp(k.month_revenue)}\nTotal: ${rp(k.total_revenue)} dari ${k.total_buyers} pembeli\nMenunggu proses: ${k.pending_orders} • Resi aktif: ${k.active_resi}\nStok menipis: ${k.low_stock}\nIklan berjalan: ${k.ads_running} • menunggu Terima: ${k.ads_proposed}\nTugas agen hari ini: ${k.tasks_today}\nLazada: ${lazada.mode}`);
  };
  cmd('laporan', laporan);
  const terlaris = (ctx) => { const l = stats.topProducts(30); ctx.reply(l.length ? 'Produk terlaris (30 hari)\n\n' + l.map((p, i) => `${i + 1}. ${p.name} — ${p.qty} terjual • ${rp(p.revenue)}`).join('\n') : 'Belum ada data penjualan.'); };
  cmd('terlaris', terlaris);
  cmd('pembeli', (ctx) => { const l = stats.buyers(30); ctx.reply(l.length ? 'Pembeli teratas (30 hari)\n\n' + l.map((b, i) => `${i + 1}. ${b.buyer} — ${b.orders}x • ${rp(b.total)}`).join('\n') : 'Belum ada pembeli.'); });
  const stok = (ctx) => {
    const low = db.prepare('SELECT * FROM products WHERE quantity <= ? ORDER BY quantity').all(settings().low_stock);
    ctx.reply(low.length ? `Stok menipis (≤ ${settings().low_stock})\n\n` + low.map((p) => `• ${p.name} (${p.seller_sku}) sisa ${p.quantity}`).join('\n') + '\n\nUbah: /setstok <sku> <jumlah>' : 'Semua stok aman.');
  };
  cmd('stok', stok);
  cmd('produk', (ctx) => {
    const l = db.prepare('SELECT * FROM products ORDER BY name').all();
    ctx.reply(l.length ? 'Produk\n\n' + l.map((p) => `• ${p.name}\n   ${p.seller_sku} • ${rp(p.price)} • stok ${p.quantity}`).join('\n') : 'Belum ada produk. Ketik /sync.');
  });
  const skuUpdate = (field) => async (ctx) => {
    const [sku, val] = args(ctx);
    if (!sku || val === undefined) return ctx.reply(`Format: /${field === 'price' ? 'harga' : 'setstok'} <sku> <${field === 'price' ? 'harga' : 'jumlah'}>`);
    const v = Number(String(val).replace(/[^\d]/g, ''));
    await lazada.updatePriceQuantity(sku, field === 'price' ? { price: v } : { quantity: v });
    db.prepare(`UPDATE products SET ${field === 'price' ? 'price' : 'quantity'}=?, updated_at=? WHERE seller_sku=?`).run(v, now(), sku);
    log('bayu', 'harga/stok', `SKU ${sku}: ${field === 'price' ? 'harga' : 'stok'} → ${v} (perintah Kevin)`);
    officeState.say('bayu', `Siap Bos! ${sku} ${field === 'price' ? `harga jadi ${rp(v)}` : `stok jadi ${v}`}`);
    ctx.reply(`${sku}: ${field === 'price' ? `harga ${rp(v)}` : `stok ${v}`}${lazada.live ? '' : ' (simulasi)'}`);
  };
  cmd('harga', skuUpdate('price'));
  cmd('setstok', skuUpdate('qty'));
  cmd('chat', async (ctx) => { await typing(ctx); sendLong(ctx, await runAgent(officeState.byJob('cs'), 'Cek chat pembeli Lazada dan ringkas isinya beserta session_id (jangan balas dulu).', String(ctx.chat.id), 'telegram')); });
  cmd('balas', async (ctx) => {
    const [sid, ...tx] = args(ctx);
    if (!sid || !tx.length) return ctx.reply('Format: /balas <session_id> <teks>');
    await lazada.replyChat(sid, tx.join(' '));
    log('sari', 'chat', `Membalas sesi ${sid} (perintah Kevin)`);
    ctx.reply(`Terkirim ke sesi ${sid}${lazada.live ? '' : ' (simulasi)'}.`);
  });

  cmd('sync', async (ctx) => {
    await ctx.reply('Sinkron pesanan & produk…');
    const ap = require('../jobs/autopilot');
    await ap.syncNow(); const n = await ap.syncProducts();
    ctx.reply(`Selesai (${n} SKU). /pesanan untuk melihat pesanan.`);
  });

  cmd('iklan', async (ctx) => {
    const p = rest(ctx);
    if (!p) return ctx.reply('Format: /iklan <nama produk>\nMira membuat proposal, kamu tinggal tekan Terima.');
    logCmd(ctx); await typing(ctx);
    if (llm.available()) await runAgent(officeState.byJob('ads'), `Buat proposal iklan untuk produk "${p}" memakai propose_ad (pilih diskon atau sponsored yang paling cocok, teks iklan menarik, budget wajar).`, String(ctx.chat.id), 'telegram');
    else ads.propose({ product_name: p, type: 'sponsored', budget: 50000, days: 3, copy: `${p} pilihan terbaik dari SWEET! Promo terbatas, checkout sekarang.`, by: 'mira' });
    ctx.reply('Proposal dibuat. Tekan Terima di website (Dashboard › Iklan) atau lewat /iklan_list.');
  });
  const iklanList = (ctx) => {
    const l = ads.list(10);
    if (!l.length) return ctx.reply('Belum ada iklan. Gunakan /iklan <produk>');
    ctx.reply('Iklan\n\n' + l.map((a) => `#${a.id} ${a.product_name} • ${a.type} • ${rp(a.type === 'diskon' ? a.sale_price : a.budget)} • ${a.status}`).join('\n'),
      Markup.inlineKeyboard(l.filter((a) => a.status === 'proposed').slice(0, 5).map((a) => [Markup.button.callback(`Terima #${a.id}`, `ad:ok:${a.id}`), Markup.button.callback(`Tolak #${a.id}`, `ad:no:${a.id}`)])));
  };
  cmd('iklan_list', iklanList);
  cmd('terima', async (ctx) => { const a = await ads.approve(Number(args(ctx)[0])); ctx.reply(`Iklan #${a.id} berjalan.\n${a.result}`); });
  cmd('tolak', (ctx) => { const a = ads.reject(Number(args(ctx)[0])); ctx.reply(`Iklan #${a.id} ditolak.`); });

  // ----- Lynk.id -----
  cmd('lynk', (ctx) => {
    const [amt, ...note] = args(ctx);
    if (!amt) return ctx.reply('Format: /lynk <jumlah> [catatan]\nContoh: /lynk 150000 ebook resep');
    const r = lynk.record({ amount: amt, note: note.join(' ') || 'Lynk.id' });
    ctx.reply(`Tercatat ${rp(r.amount)} dari Lynk.id.\nRingkasan: /lynk_cek • Impor CSV: Dashboard › Pendapatan`);
  });
  cmd('lynk_cek', (ctx) => {
    const s = lynk.summary();
    ctx.reply(`Lynk.id\nTotal tercatat: ${rp(s.total)} dari ${s.transaksi} transaksi\n\n` + s.recent.slice(0, 8).map((r) => `• ${t(r.ts)} ${rp(r.amount)} — ${r.note}`).join('\n') + `\n\nCek akun: ${s.url}`);
  });

  cmd('notif', (ctx) => {
    const l = notifySvc.list(8);
    ctx.reply(l.length ? l.map((n) => `${n.title}\n${n.text || ''}`).join('\n\n').slice(0, 3900) : 'Belum ada notifikasi.');
  });

  // ----- Jam kantor, timelapse, laporan harian -----
  const clockText = () => { const c = clock.snapshot(); return `Jam kantor ${c.time} • ${c.day}\nFase: ${c.label}${c.closed ? ' — tidak ada cetak resi & pesanan tidak diproses' : c.night ? ' (lampu menyala)' : ''}\nKecepatan: ${c.speed === 1 ? 'waktu nyata' : `timelapse ${c.speed}x`}\n\nJadwal: ${c.schedule}`; };
  cmd('jam', (ctx) => ctx.reply(clockText()));
  cmd('timelapse', (ctx) => {
    const v = Number(args(ctx)[0]);
    if (!v) return ctx.reply(`Format: /timelapse 1|60|300|900\n1 = waktu nyata, 300 = satu hari kantor ±5 menit.\n\n${clockText()}`);
    clock.setSpeed(v); log('kevin', 'jam', `Timelapse ${v}x`);
    ctx.reply(clockText());
  });
  cmd('lompat', (ctx) => { clock.jump(args(ctx)[0]); ctx.reply(clockText()); });
  cmd('laporan_harian', (ctx) => {
    const day = args(ctx)[0] || shift.reports.days(1)[0]?.day;
    const items = day ? shift.reports.byDay(day) : [];
    if (!items.length) return ctx.reply('Belum ada laporan harian. Laporan dibuat otomatis saat jam kerja habis (19:00), atau gunakan /lompat 18:58 dengan timelapse.');
    const comp = items.find((r) => r.agent === 'perusahaan');
    sendLong(ctx, `${comp ? comp.content.replace(/^#+ /gm, '') : `Laporan ${day}`}\n\nLaporan per agen (${items.filter((r) => !['perusahaan', 'ringkasan_ai'].includes(r.agent)).length}) lengkap di ${baseUrl()}/dashboard#laporan`);
  });
  cmd('resi_cetak', (ctx) => {
    const l = orders.printed(12);
    ctx.reply(l.length ? 'Resi tercetak\n\n' + l.map((o) => `#${o.order_id} • ${o.shipment_provider || 'Kurir'} ${o.tracking_code}\n   ${o.buyer} • dicetak ${officeState.find(o.printed_by)?.name || o.printed_by}`).join('\n') + `\n\nMenunggu dicetak: ${orders.waitingPrint()}` : 'Belum ada resi yang dicetak.');
  });

  // ----- Rekrutmen -----
  cmd('rekrut', (ctx) => {
    const p = args(ctx);
    if (!p.length) return ctx.reply('Format: /rekrut @username [peran]\nContoh: /rekrut @budi_toko Admin Gudang');
    const r = officeState.recruit(p[0], p.slice(1).join(' '));
    if (!r.ok) return ctx.reply(`${r.error}`);
    notifySvc.notify({ type: 'agent', title: `${r.agent.name} bergabung`, text: `Peran: ${r.agent.role}`, telegram: false });
    ctx.reply(`${r.agent.name} direkrut sebagai ${r.agent.role}.\nKarakternya muncul di area Tim Baru.\nMinta dia /start ke bot ini agar foto profilnya jadi wajah karakter.`);
  });
  cmd('pecat', (ctx) => { const r = officeState.fire(args(ctx)[0]); ctx.reply(r.ok ? `${r.agent.name} dikeluarkan.` : `${r.error}`); });

  // ----- Sistem -----
  cmd('ai', async (ctx) => {
    const s = await llm.status();
    ctx.reply(`AI SWEET\nUrutan: ${s.order.join(' → ') || 'simulasi'}\nClaude: ${s.claude || ''}\nGemini: ${s.gemini || ''}\nHermes: ${s.hermes || ''}`);
  });
  const settingsText = () => Object.entries(settings()).map(([k, v]) => `• ${k}: ${typeof v === 'boolean' ? (v ? 'ON' : 'off') : v}`).join('\n');
  cmd('pengaturan', (ctx) => ctx.reply(`Pengaturan\n${settingsText()}\n\nUbah: /set auto_pack on`));
  cmd('set', (ctx) => {
    const [k, v] = args(ctx);
    if (!k || v === undefined) return ctx.reply(`Format: /set <pengaturan> on|off|angka\n\n${settingsText()}`);
    setSetting(k, v === 'on' ? true : v === 'off' ? false : v);
    log('kevin', 'pengaturan', `${k} → ${v}`);
    ctx.reply(`${k} = ${v}\n\n${settingsText()}`);
  });
  cmd('otorisasi', (ctx) => {
    if (!lazada.hasApp) return ctx.reply('Isi LAZADA_APP_KEY dan LAZADA_APP_SECRET di .env (dari open.lazada.com), lalu restart.');
    ctx.reply(`Buka link ini, login Seller Center lalu setujui akses:\n\n${lazada.authUrl()}`);
  });
  cmd('sesi', async (ctx) => { const r = await lazadaSession.check(); ctx.reply(`Cookies Seller Center: ${r.ok ? '' : ''} ${r.reason}`); });

  // ----- Tombol -----
  b.action(/^menu:(.+)$/, owner(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const m = ctx.match[1];
    const map = {
      pesanan: () => pesanan(ctx), resi: () => resi(ctx), pendapatan: () => pendapatan(ctx), laporan: () => laporan(ctx),
      terlaris: () => terlaris(ctx), stok: () => stok(ctx), iklan: () => iklanList(ctx), web: () => web(ctx),
      agen: () => ctx.reply(`Tim SWEET\n\n${agenList()}`),
      proyek: () => ctx.reply('Kirim: /proyek <ide aplikasi kamu>\nContoh: /proyek aplikasi marketplace kopi'),
      rapat: () => startMeeting(ctx, 'Koordinasi Rutin'), bubar: () => endMeeting(ctx),
      istirahat: () => { meeting.breakTime(true); return ctx.reply('Semua agen ke Lounge.'); },
      kerja: () => { meeting.breakTime(false); return ctx.reply('Semua agen kembali bekerja.'); },
      sync: async () => { const ap = require('../jobs/autopilot'); await ap.syncNow(); await ap.syncProducts(); return ctx.reply('Sinkron selesai.'); }
    };
    if (map[m]) await map[m]();
  }));
  b.action(/^ad:(ok|no):(\d+)$/, owner(async (ctx) => {
    const id = Number(ctx.match[2]);
    try {
      if (ctx.match[1] === 'ok') { const a = await ads.approve(id); await ctx.answerCbQuery('Iklan berjalan '); await ctx.editMessageReplyMarkup().catch(() => {}); await ctx.reply(`Iklan #${id} berjalan.\n${a.result}`); }
      else { ads.reject(id); await ctx.answerCbQuery('Ditolak'); await ctx.editMessageReplyMarkup().catch(() => {}); }
    } catch (e) { await ctx.answerCbQuery(e.message.slice(0, 150), { show_alert: true }).catch(() => {}); }
  }));

  // ----- Pesan biasa -----
  b.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || !isOwner(ctx)) return;
    const isGroup = ctx.chat.type !== 'private';
    const mentioned = agentFromText(text);
    const botMention = ctx.botInfo && text.includes(`@${ctx.botInfo.username}`);
    if (isGroup && !mentioned && !botMention) return;
    const agent = mentioned || officeState.byJob('pm');
    const clean = (ctx.botInfo ? text.split(`@${ctx.botInfo.username}`).join('') : text).trim();
    await typing(ctx);
    sendLong(ctx, `${agent.name}:\n${await runAgent(agent, clean, String(ctx.chat.id), 'telegram')}`);
  });

  b.catch((err) => console.error('[Telegram error]', err.message));
  return b;
}

const startBot = () => {
  if (!process.env.TELEGRAM_BOT_TOKEN) { console.warn('TELEGRAM_BOT_TOKEN belum diisi di .env, bot tidak dijalankan.'); return; }
  bot = createBot();
  notifySvc.setTelegramSender(sendNotification);
  bot.telegram.setMyCommands([
    { command: 'menu', description: 'Menu tombol' }, { command: 'bantuan', description: 'Semua perintah' },
    { command: 'status', description: 'Kondisi kantor & toko' }, { command: 'web', description: 'Link website' },
    { command: 'agen', description: 'Status semua agen' }, { command: 'tugas', description: 'Beri tugas ke agen' },
    { command: 'semua', description: 'Perintah ke semua agen' }, { command: 'rapat', description: 'Mulai rapat' },
    { command: 'bubar', description: 'Bubarkan rapat + action item' }, { command: 'notulen', description: 'Notulen rapat' },
    { command: 'istirahat', description: 'Agen ke lounge' }, { command: 'kerja', description: 'Kembali bekerja' },
    { command: 'jam', description: 'Jam kantor' }, { command: 'timelapse', description: 'Kecepatan waktu kantor' },
    { command: 'laporan_harian', description: 'Laporan akhir jam kerja' }, { command: 'resi_cetak', description: 'Resi yang sudah dicetak' },
    { command: 'proyek', description: 'Jalankan tim 10 agen' }, { command: 'proyek_status', description: 'Progres proyek' },
    { command: 'pesanan', description: 'Pesanan terbaru' }, { command: 'resi', description: 'Daftar resi' },
    { command: 'pendapatan', description: 'Pemasukan' }, { command: 'laporan', description: 'KPI lengkap' },
    { command: 'terlaris', description: 'Produk terlaris' }, { command: 'stok', description: 'Stok menipis' },
    { command: 'iklan', description: 'Proposal iklan produk' }, { command: 'iklan_list', description: 'Daftar iklan' },
    { command: 'lynk', description: 'Catat penghasilan Lynk.id' }, { command: 'rekrut', description: 'Rekrut @username' }
  ]).catch(() => {});
  bot.launch().catch((e) => console.error('Gagal menjalankan bot Telegram:', e.message));
  console.log('Telegram : bot berjalan');
  const stop = (s) => { try { bot.stop(s); } catch (_) {} };
  process.once('SIGINT', () => { stop('SIGINT'); process.exit(0); });
  process.once('SIGTERM', () => { stop('SIGTERM'); process.exit(0); });
};

module.exports = { startBot };
