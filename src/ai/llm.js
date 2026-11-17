// Lapisan AI SWEET: Claude (utama) -> Gemini -> Hermes. Urutan bisa diatur lewat AI_PROVIDER.
const axios = require('axios');

const claudeKey = () => process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '';
const hasClaude = () => !!claudeKey();
const hasGemini = () => !!process.env.GEMINI_API_KEY;
const hasHermes = () => !!process.env.HERMES_API_KEY;
const available = () => hasClaude() || hasGemini() || hasHermes();

// ---------------- Claude (Anthropic Messages API) ----------------
const CLAUDE_URL = () => (process.env.CLAUDE_API_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
const claudeHeaders = () => ({ 'x-api-key': claudeKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
let detectedModel = null;

// Jika CLAUDE_MODEL kosong, pilih model Sonnet terbaru yang tersedia untuk API key ini.
async function claudeModel() {
  if (process.env.CLAUDE_MODEL) return process.env.CLAUDE_MODEL;
  if (detectedModel) return detectedModel;
  try {
    const r = await axios.get(`${CLAUDE_URL()}/v1/models?limit=50`, { headers: claudeHeaders(), timeout: 15000 });
    const ids = (r.data.data || []).map((m) => m.id);
    detectedModel = ids.find((i) => /sonnet/i.test(i)) || ids[0];
  } catch (_) { /* pakai default */ }
  detectedModel = detectedModel || 'claude-sonnet-4-5';
  return detectedModel;
}

async function claudeMessages({ system, messages, tools, maxTokens = 4096 }) {
  const body = { model: await claudeModel(), max_tokens: maxTokens, system, messages };
  if (tools && tools.length) body.tools = tools;
  const r = await axios.post(`${CLAUDE_URL()}/v1/messages`, body, { headers: claudeHeaders(), timeout: 180000 });
  return r.data;
}

async function viaClaude(system, prompt) {
  const d = await claudeMessages({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 6000 });
  const text = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  if (!text) throw new Error('Claude mengembalikan jawaban kosong');
  return text;
}

// ---------------- Gemini ----------------
async function geminiCall(body) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, body,
    { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' }, timeout: 120000 });
  return r.data;
}
async function viaGemini(system, prompt) {
  const d = await geminiCall({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }] });
  const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini mengembalikan jawaban kosong');
  return text;
}

// ---------------- Hermes (OpenAI-compatible) ----------------
let hermesDownUntil = 0;
async function viaHermes(system, prompt) {
  if (Date.now() < hermesDownUntil) throw new Error('Hermes belum aktif (coba lagi nanti)');
  const base = (process.env.HERMES_API_URL || 'http://127.0.0.1:8642/v1').replace(/\/+$/, '');
  try {
    const r = await axios.post(`${base}/chat/completions`, {
      model: process.env.HERMES_MODEL || 'hermes-agent',
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
    }, { headers: { Authorization: `Bearer ${process.env.HERMES_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 180000 });
    const text = r.data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Hermes mengembalikan jawaban kosong');
    return text;
  } catch (e) {
    if (!e.response && ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH'].includes(e.code)) hermesDownUntil = Date.now() + 60000;
    throw e;
  }
}

function order() {
  const pref = (process.env.AI_PROVIDER || 'claude').toLowerCase();
  const all = ['claude', 'gemini', 'hermes'];
  return [pref, ...all.filter((p) => p !== pref)].filter((p) => all.includes(p));
}
const has = { claude: hasClaude, gemini: hasGemini, hermes: hasHermes };
const via = { claude: viaClaude, gemini: viaGemini, hermes: viaHermes };
const errMsg = (e) => e.response?.data?.error?.message || e.response?.data?.message || e.message;

// Teks biasa (proyek, rapat, review, proposal)
async function generate(system, prompt) {
  const errors = [];
  for (const p of order()) {
    if (!has[p]()) continue;
    try { return await via[p](system, prompt); } catch (e) { errors.push(`${p}: ${errMsg(e)}`); }
  }
  throw new Error(errors.length ? errors.join(' | ') : 'Tidak ada AI yang dikonfigurasi (isi CLAUDE_API_KEY / GEMINI_API_KEY / HERMES_API_KEY)');
}

function parseJson(text) {
  const t = String(text).replace(/```json|```/gi, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('JSON tidak ditemukan');
  return JSON.parse(t.slice(s, e + 1));
}

async function status() {
  return {
    order: order().filter((p) => has[p]()),
    claude: hasClaude() ? (process.env.CLAUDE_MODEL || detectedModel || 'auto') : false,
    gemini: hasGemini() ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash') : false,
    hermes: hasHermes() ? (process.env.HERMES_API_URL || 'http://127.0.0.1:8642/v1') : false
  };
}

module.exports = { generate, parseJson, available, hasClaude, hasGemini, hasHermes, order, claudeMessages, claudeModel, geminiCall, errMsg, status };
