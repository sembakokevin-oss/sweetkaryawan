// Mesin kerja agen: Claude (tool use) -> Gemini (function calling) -> Hermes/teks.
// Setiap tugas tercatat di tabel tasks + activity, dan animasi "bekerja" muncul di Office.
const llm = require('./llm');
const { toolsFor, forClaude, forGemini } = require('./tools');
const lazada = require('../services/lazada');
const officeState = require('../state/officeState');
const { db, now, log } = require('../db');

const history = new Map(); // chatKey:agent -> [{role, text}]
const MAX_STEPS = 8;

function systemPrompt(agent) {
  return [
    `Kamu adalah ${agent.name}, ${agent.role} (agent #${agent.no || '-'}) di SWEET AI Agent Office (SweetOffice.com). Bosmu bernama Kevin.`,
    `Pekerjaanmu (1 agen = 1 kerjaan): ${agent.specialty}`,
    'Gunakan bahasa Indonesia yang ramah, ringkas, dan profesional. Format Markdown sederhana. Hindari emoji, kecuali satu untuk hal yang benar-benar penting (peringatan).',
    'Jangan mengarang data toko: ambil lewat tools. Jika tugas di luar bidangmu, sebutkan agen yang tepat (Kamala PM, Indra Arsitek, Nadine Desainer, Felix Mobile, Norman Backend, Nola Database, Wucing QA, Raka Security, Robo DevOps, Chelsea Tech Lead, Sari CS, Dimas Order, Bayu Stok, Mira Iklan, Tomi Analis).',
    'Tindakan yang mengubah data dilakukan sesuai perintah Kevin dan dilaporkan jelas. Untuk iklan, SELALU buat proposal lewat propose_ad (jangan jalankan sendiri).',
    'Jika perintah berisiko atau ambigu (mis. mengubah banyak harga sekaligus), minta konfirmasi dulu.',
    `Mode Lazada: ${lazada.live ? 'LIVE (data asli)' : lazada.mode.toUpperCase() + ' (data contoh) — sebutkan jika relevan'}.`
  ].join('\n');
}

async function runTool(agent, tools, name, input, text) {
  const tool = tools.find((t) => t.name === name);
  officeState.work(agent.key, text, `Memakai ${name}...`, name);
  log(agent.key, 'tool', name);
  try { return tool ? await tool.run(input || {}) : { error: 'tool tidak dikenal' }; } catch (e) { return { error: e.message }; }
}

async function viaClaude(agent, text, past) {
  const tools = toolsFor(agent);
  const messages = [...past.map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: text }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const d = await llm.claudeMessages({ system: systemPrompt(agent), messages, tools: forClaude(tools) });
    const content = d.content || [];
    messages.push({ role: 'assistant', content });
    const uses = content.filter((c) => c.type === 'tool_use');
    if (d.stop_reason !== 'tool_use' || !uses.length) return content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    const results = [];
    for (const u of uses) {
      const out = await runTool(agent, tools, u.name, u.input, text);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return 'Selesai (batas langkah tercapai).';
}

async function viaGemini(agent, text, past) {
  const tools = toolsFor(agent);
  const contents = [...past.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })), { role: 'user', parts: [{ text }] }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const body = { systemInstruction: { parts: [{ text: systemPrompt(agent) }] }, contents };
    if (tools.length) body.tools = [{ functionDeclarations: forGemini(tools) }];
    const d = await llm.geminiCall(body);
    const parts = d.candidates?.[0]?.content?.parts || [];
    if (!parts.length) return 'Maaf, tidak ada jawaban dari AI.';
    contents.push({ role: 'model', parts });
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return parts.map((p) => p.text || '').join('').trim();
    const responses = [];
    for (const { functionCall: fc } of calls) {
      const out = await runTool(agent, tools, fc.name, fc.args, text);
      responses.push({ functionResponse: { name: fc.name, response: { result: out } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return 'Selesai (batas langkah tercapai).';
}

async function think(agent, text, past) {
  const errors = [];
  for (const p of llm.order()) {
    try {
      if (p === 'claude' && llm.hasClaude()) return { text: await viaClaude(agent, text, past), provider: 'claude' };
      if (p === 'gemini' && llm.hasGemini()) return { text: await viaGemini(agent, text, past), provider: 'gemini' };
      if (p === 'hermes' && llm.hasHermes()) {
        const ctx = past.map((m) => `${m.role === 'user' ? 'Kevin' : agent.name}: ${m.text}`).join('\n');
        return { text: await llm.generate(systemPrompt(agent), (ctx ? ctx + '\n\n' : '') + text), provider: 'hermes' };
      }
    } catch (e) { errors.push(`${p}: ${llm.errMsg(e)}`); }
  }
  if (errors.length) throw new Error(errors.join(' | '));
  return { text: `(mode simulasi) Belum ada API key AI aktif. Tugas diterima oleh ${agent.name}: "${text}"`, provider: 'simulasi' };
}

// Jalankan satu tugas untuk satu agen
async function runAgent(agent, text, chatKey = 'default', source = 'telegram') {
  if (!agent) throw new Error('Agen tidak ditemukan');
  text = String(text || '').trim();
  const task = db.prepare('INSERT INTO tasks(ts,agent,title,source,status) VALUES(?,?,?,?,?)').run(now(), agent.key, text.slice(0, 200), source, 'running');
  officeState.work(agent.key, text, text);
  const key = `${chatKey}:${agent.key}`;
  const past = history.get(key) || [];
  try {
    const r = await think(agent, text, past);
    const answer = r.text || 'Selesai.';
    history.set(key, [...past, { role: 'user', text }, { role: 'assistant', text: answer }].slice(-12));
    db.prepare('UPDATE tasks SET status=?, result=?, finished_at=? WHERE id=?').run('done', answer.slice(0, 8000), now(), task.lastInsertRowid);
    officeState.rest(agent.key, 'Tugas selesai ');
    log(agent.key, 'selesai', answer.slice(0, 200));
    return answer;
  } catch (e) {
    history.delete(key);
    db.prepare('UPDATE tasks SET status=?, result=?, finished_at=? WHERE id=?').run('failed', e.message.slice(0, 2000), now(), task.lastInsertRowid);
    officeState.rest(agent.key, 'Ada kendala…');
    log(agent.key, 'gagal', e.message.slice(0, 200));
    return `Maaf, ada kendala saat memproses: ${e.message}`;
  }
}

module.exports = { runAgent, systemPrompt };
