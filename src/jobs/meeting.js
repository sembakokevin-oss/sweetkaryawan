// Rapat kantor: /rapat -> semua agen jalan ke Ruang Rapat, bergiliran melapor (balon bicara di Office),
// notulen tersimpan di database. /bubar -> kesimpulan + action item dibagikan, agen kembali ke ruangan.
const llm = require('../ai/llm');
const officeState = require('../state/officeState');
const stats = require('../services/stats');
const { db, now, log } = require('../db');
const { notify } = require('../services/notify');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rp = stats.rupiah;
let current = null; // { id, topic, cancelled }

function lastWork(key) {
  const t = db.prepare("SELECT title, status FROM tasks WHERE agent=? ORDER BY id DESC LIMIT 1").get(key);
  return t ? `${t.status === 'done' ? 'menyelesaikan' : t.status === 'running' ? 'sedang mengerjakan' : 'mencoba'} "${t.title.slice(0, 70)}"` : null;
}

// Laporan tanpa AI: dari data nyata di database
function dataUpdate(a, k) {
  const w = lastWork(a.key);
  switch (a.job) {
    case 'order': return `Ada ${k.pending_orders} pesanan menunggu proses dan ${k.active_resi} resi aktif. Hari ini ${k.today_orders} pesanan masuk.`;
    case 'analis': return `Omzet hari ini ${rp(k.today_revenue)} dari ${k.today_buyers} pembeli (kemarin ${rp(k.yesterday_revenue)}). 7 hari: ${rp(k.week_revenue)}.`;
    case 'stock': return k.low_stock ? `${k.low_stock} produk stoknya menipis, saya siapkan usulan restock.` : 'Stok semua produk aman.';
    case 'ads': return `${k.ads_running} iklan berjalan, ${k.ads_proposed} proposal menunggu keputusan Bos Kevin.`;
    case 'cs': return 'Chat pembeli terpantau. Belum ada komplain berat yang perlu keputusan Bos.';
    default: return w ? `Terakhir saya ${w}. Siap lanjut sesuai arahan.` : `Fokus saya: ${a.specialty}`;
  }
}

async function buildUpdates(topic, agents) {
  const k = stats.kpi();
  if (!llm.available()) return { updates: agents.map((a) => ({ key: a.key, text: dataUpdate(a, k) })), summary: null };
  const ctx = agents.map((a) => `- ${a.key} (${a.name}, ${a.role}): kerjaan "${a.specialty}". Aktivitas terakhir: ${lastWork(a.key) || 'belum ada tugas'}. Data: ${dataUpdate(a, k)}`).join('\n');
  try {
    const raw = await llm.generate(
      'Kamu menulis notulen rapat kantor SWEET AI Agent Office. Setiap agen memberi laporan singkat 1-2 kalimat sesuai kerjaannya (1 agen = 1 kerjaan), relevan dengan topik rapat, berbahasa Indonesia santai-profesional, berbicara kepada Bos Kevin, tanpa emoji. Jangan mengarang angka; pakai data yang diberikan. Balas HANYA JSON.',
      `Topik rapat: ${topic}\nKPI toko: ${JSON.stringify(k)}\n\nAgen:\n${ctx}\n\nBalas JSON: {"updates":[{"key":"<key>","text":"laporan"}]}`);
    const j = llm.parseJson(raw);
    const map = Object.fromEntries((j.updates || []).map((u) => [u.key, u.text]));
    return { updates: agents.map((a) => ({ key: a.key, text: map[a.key] || dataUpdate(a, k) })), summary: null };
  } catch (e) {
    return { updates: agents.map((a) => ({ key: a.key, text: dataUpdate(a, k) })), summary: null, error: e.message };
  }
}

async function runMeeting(m) {
  await sleep(5000); // beri waktu agen berjalan ke ruang rapat
  const agents = officeState.agents.filter((a) => a.type === 'builtin');
  officeState.say('chelsea', `Rapat dimulai: ${m.topic}. Silakan lapor bergiliran.`, 5000);
  const { updates } = await buildUpdates(m.topic, agents);
  for (const u of updates) {
    if (m.cancelled) return;
    officeState.setSpeaker(u.key);
    officeState.say(u.key, u.text, 4300);
    db.prepare('INSERT INTO meeting_notes(meeting_id,ts,agent,text) VALUES(?,?,?,?)').run(m.id, now(), u.key, u.text);
    await sleep(4500);
  }
  if (!m.cancelled) {
    officeState.setSpeaker(null);
    const names = Object.fromEntries(agents.map((a) => [a.key, a.name]));
    notify({ type: 'info', title: `Notulen rapat #${m.id}: ${m.topic}`,
      text: updates.map((u) => `${names[u.key]}: ${u.text}`).join('\n') + '\n\nKetik /bubar untuk menutup rapat & membagi tugas.', telegram: true, data: { meeting_id: m.id } });
  }
}

function start(topic = 'Koordinasi Rutin', source = 'telegram') {
  if (current) throw new Error(`Rapat #${current.id} masih berlangsung (${current.topic}). Ketik /bubar dulu.`);
  topic = String(topic || 'Koordinasi Rutin').slice(0, 140);
  const id = db.prepare('INSERT INTO meetings(ts,topic,status) VALUES(?,?,?)').run(now(), topic, 'berlangsung').lastInsertRowid;
  current = { id, topic, cancelled: false };
  officeState.setMode('rapat', { id, topic, speaker: null });
  log('sistem', 'rapat', `Rapat #${id} dimulai: ${topic} (${source})`);
  notify({ type: 'project', title: `Rapat #${id} dimulai`, text: `${topic}\nSemua agen menuju Ruang Rapat.`, telegram: source !== 'telegram' });
  runMeeting(current).catch((e) => log('sistem', 'error', `Rapat: ${e.message}`));
  return { id, topic };
}

async function end({ followUp = true } = {}) {
  if (!current) throw new Error('Tidak ada rapat yang berlangsung.');
  const m = current; m.cancelled = true; current = null;
  const notes = db.prepare('SELECT agent, text FROM meeting_notes WHERE meeting_id=? ORDER BY id').all(m.id);
  let summary = `Rapat "${m.topic}" selesai dengan ${notes.length} laporan.`;
  let actions = [];
  if (llm.available() && notes.length) {
    try {
      const raw = await llm.generate('Kamu Chelsea, Tech Lead SWEET. Buat kesimpulan rapat dan action item konkret, masing-masing untuk SATU agen sesuai kerjaannya. Balas HANYA JSON.',
        `Topik: ${m.topic}\nNotulen:\n${notes.map((n) => `${n.agent}: ${n.text}`).join('\n')}\n\nBalas JSON: {"summary":"2-3 kalimat","actions":[{"agent":"<key agen>","task":"tugas singkat"}]}`);
      const j = llm.parseJson(raw);
      summary = j.summary || summary;
      actions = (j.actions || []).filter((x) => officeState.find(x.agent)).slice(0, 10);
    } catch (e) { log('sistem', 'error', `Kesimpulan rapat: ${e.message}`); }
  }
  if (!actions.length) {
    actions = officeState.agents.filter((a) => a.type === 'builtin' && a.routine).slice(0, 15)
      .map((a) => ({ agent: a.key, task: a.routine[Math.floor(Math.random() * a.routine.length)] }));
  }
  db.prepare('UPDATE meetings SET status=?, ended_at=?, summary=?, action_items=? WHERE id=?').run('selesai', now(), summary, JSON.stringify(actions), m.id);
  officeState.manualMode = false;
  officeState.setMode('kerja', null);
  officeState.say('chelsea', 'Rapat dibubarkan. Kembali ke ruangan masing-masing!', 5000);
  log('sistem', 'rapat', `Rapat #${m.id} dibubarkan`);

  // Tindak lanjut: setiap agen langsung mengerjakan action item-nya (terlihat di Office & tercatat sebagai tugas)
  if (followUp) {
    actions.forEach((x, i) => setTimeout(() => {
      const a = officeState.find(x.agent); if (!a) return;
      const t = db.prepare('INSERT INTO tasks(ts,agent,title,source,status) VALUES(?,?,?,?,?)').run(now(), a.key, `[Rapat #${m.id}] ${x.task}`.slice(0, 200), 'rapat', 'running');
      officeState.work(a.key, x.task, `Tindak lanjut rapat: ${x.task}`);
      setTimeout(() => {
        db.prepare('UPDATE tasks SET status=?, result=?, finished_at=? WHERE id=?').run('done', 'Action item rapat ditindaklanjuti.', now(), t.lastInsertRowid);
        officeState.rest(a.key, `Action item rapat selesai `);
      }, 25000 + Math.random() * 35000);
    }, 6000 + i * 1500));
  }
  const text = `${summary}\n\nAction item:\n${actions.map((x) => `• ${officeState.find(x.agent)?.name || x.agent}: ${x.task}`).join('\n')}`;
  notify({ type: 'success', title: `Rapat #${m.id} dibubarkan`, text, telegram: false, data: { meeting_id: m.id } });
  return { id: m.id, topic: m.topic, summary, actions, notes };
}

const status = () => current && { id: current.id, topic: current.topic };
const list = (limit = 15) => db.prepare('SELECT * FROM meetings ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ ...r, action_items: r.action_items ? JSON.parse(r.action_items) : [] }));
const get = (id) => {
  const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(id);
  if (!m) return null;
  return { ...m, action_items: m.action_items ? JSON.parse(m.action_items) : [], notes: db.prepare('SELECT * FROM meeting_notes WHERE meeting_id=? ORDER BY id').all(id) };
};

// Istirahat: semua agen ke lounge
function breakTime(on) {
  if (current) throw new Error('Sedang rapat. /bubar dulu.');
  officeState.manualMode = true;
  officeState.setMode(on ? 'istirahat' : 'kerja', null);
  log('sistem', 'kantor', on ? 'Jam istirahat — agen ke Lounge' : 'Kembali bekerja');
  notify({ type: 'info', title: on ? 'Jam istirahat' : 'Kembali bekerja', text: on ? 'Agen menuju Lounge.' : 'Agen kembali ke ruangan.', telegram: false });
}

// Rapat lama yang tidak ditutup (server restart) ditandai selesai
db.prepare("UPDATE meetings SET status='terputus' WHERE status='berlangsung'").run();

module.exports = { start, end, status, list, get, breakTime };
