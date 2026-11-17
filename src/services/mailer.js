// Pengirim email SMTP tanpa dependensi tambahan (Gmail: smtp.gmail.com, port 465 SSL atau 587 STARTTLS).
// Gmail wajib memakai App Password (aktifkan Verifikasi 2 Langkah, lalu buat di https://myaccount.google.com/apppasswords).
const net = require('net');
const tls = require('tls');
const os = require('os');

const cfg = () => ({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: String(process.env.SMTP_PASS || '').replace(/\s+/g, ''),
  from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : Number(process.env.SMTP_PORT || 465) === 465
});
const configured = () => { const c = cfg(); return !!(c.user && c.pass); };

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addr = (s) => { const m = String(s).match(/<([^>]+)>/); return (m ? m[1] : s).trim(); };
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

function buildMessage({ from, to, subject, text, html }) {
  const boundary = 'sweet_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const fromName = String(from).includes('<') ? from.replace(/<.*>/, '').trim().replace(/^"|"$/g, '') : '';
  const fromHdr = fromName ? `${encHeader(fromName)} <${addr(from)}>` : addr(from);
  const domain = addr(from).split('@')[1] || 'localhost';
  return [
    `From: ${fromHdr}`, `To: <${addr(to)}>`, `Subject: ${encHeader(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(text || '')),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(html || text || '')),
    `--${boundary}--`, ''
  ].join('\r\n');
}

function send({ to, subject, text, html }) {
  const c = cfg();
  if (!configured()) return Promise.reject(new Error('Pengiriman email belum dikonfigurasi (isi SMTP_USER dan SMTP_PASS di .env)'));
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiter = null, done = false;
    const timer = setTimeout(() => fail(new Error('Server email tidak merespons (timeout)')), 30000);
    function fail(e) { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (_) {} reject(e); }
    function onData(d) {
      buf += d.toString('utf8');
      // respons lengkap: baris terakhir "NNN " (spasi setelah kode)
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const resp = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n');
          if (waiter) { const w = waiter; waiter = null; w(resp); }
          return;
        }
      }
    }
    const read = () => new Promise((r) => { waiter = r; });
    async function cmd(line, expect) {
      if (line !== null) sock.write(line + '\r\n');
      const resp = await read();
      const code = Number(resp.slice(0, 3));
      if (!expect.includes(code)) {
        const shown = /^AUTH|^[A-Za-z0-9+/=]{8,}$/.test(line || '') ? '(autentikasi)' : line;
        let hint = '';
        if (code === 535) hint = ' — username/App Password Gmail salah. Pakai App Password 16 huruf, bukan password akun.';
        throw new Error(`SMTP ${shown || 'connect'}: ${resp.split('\n').pop()}${hint}`);
      }
      return resp;
    }
    function attach(s) { sock = s; sock.on('data', onData); sock.on('error', fail); }
    async function run() {
      await cmd(null, [220]);
      const host = os.hostname().replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost';
      let ehlo = await cmd(`EHLO ${host}`, [250]);
      if (!c.secure && /STARTTLS/i.test(ehlo)) {
        await cmd('STARTTLS', [220]);
        const raw = sock; raw.removeAllListeners('data');
        await new Promise((r, j) => { const t = tls.connect({ socket: raw, servername: c.host }, r); t.on('error', j); attach(t); });
        ehlo = await cmd(`EHLO ${host}`, [250]);
      }
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(c.user), [334]);
      await cmd(b64(c.pass), [235]);
      await cmd(`MAIL FROM:<${addr(c.from)}>`, [250]);
      await cmd(`RCPT TO:<${addr(to)}>`, [250, 251]);
      await cmd('DATA', [354]);
      const msg = buildMessage({ from: c.from, to, subject, text, html }).replace(/\r\n\./g, '\r\n..');
      await cmd(msg + '\r\n.', [250]);
      sock.write('QUIT\r\n');
      done = true; clearTimeout(timer); setTimeout(() => sock.destroy(), 200);
      resolve({ ok: true });
    }
    try {
      attach(c.secure ? tls.connect({ host: c.host, port: c.port, servername: c.host }) : net.connect(c.port, c.host));
      run().catch(fail);
    } catch (e) { fail(e); }
  });
}

// Template email kode OTP
function otpEmail(code, purpose) {
  const title = purpose === 'reset' ? 'Reset kata sandi' : 'Verifikasi akun';
  const desc = purpose === 'reset' ? 'Gunakan kode berikut untuk membuat kata sandi baru.' : 'Gunakan kode berikut untuk menyelesaikan pendaftaran akun SWEET AI Agent Office.';
  const text = `${title} SWEET AI Agent Office\n\nKode OTP kamu: ${code}\nBerlaku 10 menit. Jangan berikan kode ini kepada siapa pun.\n\nJika kamu tidak meminta kode ini, abaikan email ini.`;
  const html = `<div style="background:#0d0809;padding:32px 12px;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:460px;margin:0 auto;background:#171013;border:1px solid #3a2129;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#b3304f,#4a0f20);padding:22px 26px;color:#fff;font-weight:800;font-size:18px">SWEET AI Agent Office</div>
    <div style="padding:26px;color:#e9dfdc">
      <div style="font-size:16px;font-weight:700;margin-bottom:6px">${title}</div>
      <div style="color:#b9a9ad;font-size:14px;margin-bottom:20px">${desc}</div>
      <div style="font:800 34px Consolas,monospace;letter-spacing:10px;color:#ffd99a;background:#0d0809;border:1px dashed #7d1d36;border-radius:12px;padding:16px;text-align:center">${code}</div>
      <div style="color:#8d7f83;font-size:12.5px;margin-top:18px">Kode berlaku 10 menit. Jangan berikan kode ini kepada siapa pun, termasuk yang mengaku dari SWEET.<br>Jika kamu tidak meminta kode ini, abaikan email ini.</div>
    </div>
  </div></div>`;
  return { subject: `${code} adalah kode ${title.toLowerCase()} SWEET`, text, html };
}

module.exports = { send, configured, otpEmail, cfg };
