require('dotenv').config(); // harus paling awal

const { startServer } = require('./server');
const { startBot } = require('./bot/telegram');
const { startAutopilot } = require('./jobs/autopilot');
const { startShift } = require('./jobs/shift');
const llm = require('./ai/llm');
const { db, DATA_DIR } = require('./db');
require('./services/auth').seedAdmin();

console.log('SWEET AI Agent Office (SweetOffice.com) — Bos: Kevin');
console.log(`Database : ${DATA_DIR}/sweet.db (${db.engine})`);
console.log(`AI       : ${llm.order().filter((p) => ({ claude: llm.hasClaude, gemini: llm.hasGemini, hermes: llm.hasHermes })[p]()).join(' > ') || 'belum ada (mode simulasi)'}`);
if (llm.hasClaude()) llm.claudeModel().then((m) => console.log(`Claude   : ${m}`)).catch(() => {});

startServer();
startBot();
startAutopilot();
startShift();
require('./jobs/home').startHome();
require('./jobs/trader').startTrader();
require('./services/hermes').ensure().catch(() => {});

process.on('unhandledRejection', (e) => console.error('[unhandled]', e && e.message ? e.message : e));
