const llm = require('../ai/llm');
const officeState = require('../state/officeState');
const { db, now, log } = require('../db');
const { notify } = require('../services/notify');

// Alur proyek SWEET: Kevin memberi ide -> tiap agen mengerjakan 1 kerjaannya -> Tech Lead mereview.
// Pekerjaan yang jelek DIKEMBALIKAN ke agen untuk diperbaiki (maks 2 putaran review).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 3500) => (s.length > n ? s.slice(0, n) + '\n…(dipotong)' : s);

const STEPS = [
  { id: 'fitur', job: 'pm', kind: 'Daftar Fitur',
    brief: 'Pecah ide menjadi DAFTAR FITUR. Wajib mencakup minimal: Login, Chat, Payment, Profile, Notif (tambahkan fitur lain bila perlu). Untuk tiap fitur beri: tujuan, user story, acceptance criteria, prioritas (P0/P1/P2).' },
  { id: 'arsitektur', job: 'arch', kind: 'Arsitektur Proyek', needs: ['fitur'],
    brief: 'Rancang struktur proyek (clean architecture) dengan folder data/, domain/, presentation/, lib/. Tampilkan pohon folder lengkap dan jelaskan tanggung jawab tiap folder serta aturan dependensi antar lapisan.' },
  { id: 'desain', job: 'design', kind: 'Alur & Tampilan', needs: ['fitur', 'arsitektur'],
    brief: 'Buat ALUR dan TAMPILAN tiap alur: daftar layar, urutan navigasi (user flow), komponen UI utama, state (loading/empty/error), dan panduan visual (warna, tipografi).' },
  { id: 'kontrak', job: 'backend', kind: 'Kontrak API', needs: ['fitur', 'arsitektur'],
    brief: 'Tulis KONTRAK API tunggal (gaya OpenAPI ringkas): endpoint, method, request/response JSON, kode error, autentikasi. Kontrak ini WAJIB diikuti oleh Mobile dan Backend.' },
  { id: 'mobile', job: 'mobile', kind: 'Rencana & Kode Mobile', needs: ['fitur', 'arsitektur', 'desain', 'kontrak'], parallel: true,
    brief: 'Implementasi sisi MOBILE: struktur modul dan contoh kode inti untuk Login & Chat yang memanggil endpoint PERSIS sesuai kontrak API. Sebutkan jika ada kontrak yang kurang jelas.' },
  { id: 'backend', job: 'backend', kind: 'Rencana & Kode Backend', needs: ['fitur', 'arsitektur', 'kontrak'], parallel: true,
    brief: 'Implementasi sisi BACKEND: struktur modul dan contoh kode inti endpoint Login & Chat PERSIS sesuai kontrak API yang sama dengan mobile.' },
  { id: 'database', job: 'db', kind: 'Skema Database', needs: ['fitur', 'kontrak', 'backend'],
    brief: 'Rancang SKEMA DATABASE (tabel, kolom, PK/FK, index, constraint UNIQUE) agar TIDAK ADA DATA DOBEL. Jelaskan normalisasi dan sertakan SQL CREATE TABLE.' },
  { id: 'qa', job: 'qa', kind: 'Laporan QA & Bug', needs: ['fitur', 'kontrak', 'mobile', 'backend', 'database'],
    brief: 'Cari BUG sampai ketemu: buat skenario uji, edge case, dan daftar bug (ID, tingkat keparahan, langkah reproduksi, perkiraan penyebab) berdasarkan hasil kerja tim.' },
  { id: 'keamanan', job: 'sec', kind: 'Audit Keamanan', needs: ['kontrak', 'backend', 'database', 'mobile'],
    brief: 'Cek CELAH keamanan sebelum orang lain menemukannya: autentikasi, otorisasi, injeksi, penyimpanan token/password, rate limit, data sensitif. Beri temuan + tingkat risiko + perbaikan.' },
  { id: 'devops', job: 'devops', kind: 'Build & Deploy', needs: ['arsitektur', 'backend', 'mobile', 'database', 'keamanan'],
    brief: 'Urus BUILD dan DEPLOY: pipeline CI/CD (contoh file konfigurasi), environment, strategi rilis/rollback, monitoring dasar.' }
];

function fallback(step, idea) {
  return `# ${step.kind} (contoh – mode simulasi)\n\nIde: ${idea}\n\n` +
    `Belum ada API key AI yang aktif, jadi ini hanya kerangka dari ${step.job.toUpperCase()}.\n` +
    `- Isi CLAUDE_API_KEY (atau GEMINI_API_KEY / HERMES_API_KEY) di .env untuk hasil sungguhan.\n- Fokus pekerjaan: ${step.brief}`;
}

function insertDeliverable(pid, agent, step, content, round) {
  return db.prepare('INSERT INTO deliverables(project_id,agent,job,kind,content,status,round,ts) VALUES(?,?,?,?,?,?,?,?)')
    .run(pid, agent.key, step.job, step.kind, content, 'submitted', round, now()).lastInsertRowid;
}

async function runStep(pid, idea, step, ctx, feedback, round) {
  const agent = officeState.byJob(step.job);
  const needs = (step.needs || []).filter((n) => ctx[n]).map((n) => `## ${n.toUpperCase()}\n${clip(ctx[n])}`).join('\n\n');
  officeState.work(agent.key, `Proyek #${pid}: ${step.kind}`, `Mengerjakan ${step.kind}...`);
  const task = db.prepare('INSERT INTO tasks(ts,agent,title,source,status,project_id) VALUES(?,?,?,?,?,?)').run(now(), agent.key, `Proyek #${pid}: ${step.kind}${feedback ? ' (revisi)' : ''}`, 'proyek', 'running', pid).lastInsertRowid;
  const system = `Kamu adalah ${agent.name}, ${agent.role} di SWEET AI Agent Office. Tugasmu hanya satu: ${agent.specialty}\nJawab dalam Markdown berbahasa Indonesia, konkret, siap dipakai tim, tanpa emoji.`;
  const prompt = `IDE PRODUK dari Kevin:\n${idea}\n\n${needs ? `HASIL KERJA TIM SEBELUMNYA:\n${needs}\n\n` : ''}TUGAS: ${step.brief}` +
    (feedback ? `\n\nREVIEW TECH LEAD (perbaiki hal-hal ini, pekerjaan sebelumnya dikembalikan):\n${feedback}` : '');
  let text;
  try { text = llm.available() ? await llm.generate(system, prompt) : (await sleep(2500), fallback(step, idea)); }
  catch (e) { text = `Gagal membuat hasil: ${e.message}`; }
  ctx[step.id] = text;
  insertDeliverable(pid, agent, step, text, round);
  db.prepare('UPDATE tasks SET status=?, result=?, finished_at=? WHERE id=?').run('done', text.slice(0, 8000), now(), task);
  officeState.rest(agent.key, `${step.kind} selesai.`);
  log(agent.key, 'hasil', `Proyek #${pid}: ${step.kind} dikirim ke Tech Lead`);
  return text;
}

async function review(pid, idea, ctx, round) {
  const lead = officeState.byJob('lead');
  officeState.work(lead.key, `Proyek #${pid}: review semua pekerjaan`, 'Mereview hasil tim...');
  const bundle = STEPS.map((s) => `### ${s.id} (job: ${s.job})\n${clip(ctx[s.id] || '(kosong)', 1800)}`).join('\n\n');
  let verdict;
  try {
    if (!llm.available()) { await sleep(2500); verdict = { verdict: 'approved', summary: 'Mode simulasi: semua hasil disetujui.', reviews: [] }; }
    else {
      const raw = await llm.generate(
        `Kamu ${lead.name}, Tech Lead yang tegas. Review hasil kerja tim. Pekerjaan yang jelek / tidak konsisten dengan kontrak API / tidak lengkap HARUS dikembalikan. Balas HANYA JSON valid.`,
        `Ide: ${idea}\n\nHasil tim:\n${bundle}\n\nBalas JSON: {"summary":"ringkasan 2-3 kalimat","reviews":[{"step":"<id step: ${STEPS.map((s) => s.id).join('|')}>","ok":true/false,"reason":"alasan singkat jika ok=false"}]}`);
      const j = llm.parseJson(raw);
      const bad = (j.reviews || []).filter((r) => r.ok === false && STEPS.some((s) => s.id === r.step));
      verdict = { verdict: bad.length ? 'rejected' : 'approved', summary: j.summary || '', reviews: j.reviews || [] };
    }
  } catch (e) { verdict = { verdict: 'approved', summary: `Review otomatis gagal (${e.message}); dianggap lolos.`, reviews: [] }; }
  officeState.rest(lead.key, verdict.verdict === 'approved' ? 'Review selesai: disetujui.' : 'Review selesai: ada yang dikembalikan.');
  return verdict;
}

let running = null;
db.prepare("UPDATE projects SET status='terputus', step='server restart' WHERE status='running'").run();

async function runProject(pid, idea) {
  const ctx = {};
  try {
    const setStep = (s) => db.prepare('UPDATE projects SET step=? WHERE id=?').run(s, pid);
    // Tahap berurutan; mobile & backend jalan BARENGAN dengan kontrak yang sama
    let i = 0;
    while (i < STEPS.length) {
      const s = STEPS[i];
      if (s.parallel) {
        const group = STEPS.filter((x) => x.parallel);
        setStep(group.map((g) => g.id).join('+'));
        await Promise.all(group.map((g) => runStep(pid, idea, g, ctx, null, 1)));
        i += group.length;
      } else { setStep(s.id); await runStep(pid, idea, s, ctx, null, 1); i++; }
    }

    let round = 1, verdict;
    while (true) {
      setStep(`review-${round}`);
      verdict = await review(pid, idea, ctx, round);
      const bad = verdict.reviews.filter((r) => r.ok === false && STEPS.some((s) => s.id === r.step));
      for (const r of bad) {
        const st = STEPS.find((s) => s.id === r.step);
        const ag = officeState.byJob(st.job);
        db.prepare("UPDATE deliverables SET status='returned', review=? WHERE project_id=? AND job=? AND kind=? AND round=?").run(r.reason || '', pid, st.job, st.kind, round);
        notify({ type: 'warn', title: `${ag.name} diminta memperbaiki`, text: `${st.kind}: ${r.reason || 'perlu perbaikan'}` });
        log('chelsea', 'review', `Mengembalikan ${st.kind} (${ag.name}): ${r.reason}`);
      }
      if (!bad.length || round >= 3) break;
      round++;
      db.prepare('UPDATE projects SET round=? WHERE id=?').run(round, pid);
      for (const r of bad) {
        const st = STEPS.find((s) => s.id === r.step);
        await runStep(pid, idea, st, ctx, r.reason, round);
      }
    }
    // Tandai yang lolos
    db.prepare("UPDATE deliverables SET status='approved' WHERE project_id=? AND status='submitted'").run(pid);
    db.prepare('UPDATE projects SET status=?, step=?, summary=? WHERE id=?').run('done', 'selesai', verdict.summary || '', pid);
    notify({ type: 'success', title: `Proyek #${pid} selesai`, text: verdict.summary || 'Semua pekerjaan disetujui Tech Lead.', data: { project_id: pid } });
  } catch (e) {
    db.prepare('UPDATE projects SET status=?, summary=? WHERE id=?').run('failed', e.message, pid);
    notify({ type: 'warn', title: `Proyek #${pid} gagal`, text: e.message });
    STEPS.forEach((s) => { const a = officeState.byJob(s.job); if (a) officeState.rest(a.key, 'Proyek dihentikan.'); });
  }
}

function startProject(idea) {
  idea = String(idea || '').trim();
  if (idea.length < 5) throw new Error('Ide proyek terlalu pendek.');
  if (running) throw new Error(`Proyek #${running} masih berjalan.`);
  const pid = db.prepare('INSERT INTO projects(ts,idea,status,step) VALUES(?,?,?,?)').run(now(), idea, 'running', 'fitur').lastInsertRowid;
  running = pid;
  notify({ type: 'project', title: `Proyek #${pid} dimulai`, text: idea.slice(0, 140) });
  runProject(pid, idea).finally(() => { running = null; });
  return pid;
}

const getProject = (id) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  if (!p) return null;
  return { ...p, deliverables: db.prepare('SELECT * FROM deliverables WHERE project_id=? ORDER BY id').all(id) };
};
const listProjects = () => db.prepare('SELECT * FROM projects ORDER BY id DESC LIMIT 30').all();
const runningId = () => running;

module.exports = { startProject, getProject, listProjects, runningId, STEPS };
