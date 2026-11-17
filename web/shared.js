/* SWEET AI Agent Office — util bersama: ikon, navbar, notifikasi animasi, SSE realtime, jam kantor, API, suara */
(function () {
  // ---------- Ikon SVG (garis, gaya konsisten) ----------
  const P = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    office: 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3M3 21h18',
    door: 'M5 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M13.5 12h.01',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a1.94 1.94 0 0 0 3.4 0',
    sound: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
    mute: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
    cart: 'M3 3h2l2.4 12.2a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6M9 21h.01M18 21h.01',
    bag: 'M6 7h12l1 14H5zM9 7a3 3 0 0 1 6 0',
    megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1M15 8a4 4 0 0 1 0 8M18 5a8 8 0 0 1 0 14',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12',
    wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2M16 14.5h.01',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    rocket: 'M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-5-5zM9 12l-4-1 3-3h4M12 15l1 4 3-3v-4',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M19 11a7 7 0 0 1-14 0M12 18v3',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1',
    target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    truck: 'M1 4h14v12H1zM15 9h4l3 3v4h-7M5.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
    coin: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M15 8.5c-.6-.9-1.7-1.5-3-1.5-1.9 0-3 1-3 2.3 0 3.2 6 1.7 6 4.9 0 1.3-1.3 2.3-3 2.3-1.4 0-2.5-.6-3.1-1.6M12 5v2M12 17v2',
    alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0M12 9v4M12 17h.01',
    check: 'M20 6 9 17l-5-5',
    x: 'M18 6 6 18M6 6l12 12',
    refresh: 'M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12A9 9 0 0 1 18.5 5.7L21 8M21 3v5h-5M3 21v-5h5',
    play: 'M6 4l14 8-14 8z',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
    box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
    tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8M7.5 7.5h.01',
    trend: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
    receipt: 'M4 2v20l3-2 3 2 3-2 3 2 3-2 2 2V2l-2 2-3-2-3 2-3-2-3 2-3-2zM8 8h8M8 12h8M8 16h5',
    crown: 'M2 18 4 7l5 5 3-7 3 7 5-5 2 11zM2 21h20',
    fast: 'M13 19l9-7-9-7zM2 19l9-7-9-7z',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M22 6l-10 7L2 6',
    bed: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',
    gold: 'M3 20h8l-1.5-5h-5zM13 20h8l-1.5-5h-5zM8 13h8l-1.5-5h-5zM12 2v2M17 4l-1 1.5M7 4l1 1.5',
    trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    move: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
    drone: 'M5 5a2 2 0 1 0 0 .01M19 5a2 2 0 1 0 0 .01M5 19a2 2 0 1 0 0 .01M19 19a2 2 0 1 0 0 .01M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3M10 10h4v4h-4z',
    mouse: 'M12 2a6 6 0 0 0-6 6v8a6 6 0 0 0 12 0V8a6 6 0 0 0-6-6M12 6v4',
    keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
    calendar: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M8 2v4M16 2v4',
    layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    flag: 'M5 22V3M5 4h11l-2 4 2 4H5',
    shield2: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10M9 12l2 2 4-4',
    power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
    coffee: 'M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2',
    book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
    tv: 'M2 7h20v13H2zM17 2l-5 5-5-5',
    game: 'M6 12h4M8 10v4M15 13h.01M18 11h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.4 2L9 15h6l1.6 2a3 3 0 0 0 5.4-2l-.7-6.4a4 4 0 0 0-4-3.6',
    walk: 'M13 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2M10 22l2-7 3 3v6M7 13l2-5 4 1 3 3M9 8 6 11',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10',
    cookie: 'M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5M8.5 8.5h.01M16 15.5h.01M12 12h.01M11 17h.01M7 14h.01'
  };
  const icon = (n, s = 18, w = 1.9) => `<span class="ic"><svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${P[n] || P.bell}"/></svg></span>`;
  const TYPE_ICON = { trade: 'trend', order: 'cart', resi: 'printer', money: 'coin', ad: 'megaphone', warn: 'alert', success: 'check', agent: 'users', project: 'file', info: 'bell' };
  const TYPE_COLOR = { trade: 'var(--gold)', order: 'var(--green)', resi: 'var(--blue)', money: 'var(--gold)', ad: 'var(--accent2)', warn: 'var(--red)', success: 'var(--green)', agent: 'var(--purple)', project: 'var(--teal)', info: '#a08f94' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
  const num = (n) => Math.round(n || 0).toLocaleString('id-ID');
  const initials = (name) => String(name || '?').replace(/^@/, '').split(/[\s_]+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  // Avatar: foto bila ada, selain itu inisial berwarna
  const avatar = (a, size = 38) => `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.34)}px;${a.photo ? `background-image:url('${a.photo}')` : `background:linear-gradient(135deg,${a.color || '#7d1d36'},#1a1014)`}">${a.photo ? '' : esc(initials(a.name))}</span>`;
  const store = { get(k, d) { try { const v = localStorage.getItem('sweet:' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('sweet:' + k, JSON.stringify(v)); } catch (_) {} } };

  function timeAgo(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 45) return 'baru saja';
    if (s < 3600) return Math.round(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.round(s / 3600) + ' jam lalu';
    return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  }
  const clock = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  function md(src) {
    let s = esc(src || '');
    const blocks = [];
    s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, c) => { blocks.push(`<pre><code>${c}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
    s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^(\s*)[-*] (.*)$/gm, '$1<li>$2</li>').replace(/^\d+\. (.*)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>').replace(/<\/ul>\s*<ul>/g, '');
    s = s.split(/\n{2,}/).map((p) => (/^\s*<(h\d|ul|pre|\u0000)/.test(p) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`)).join('');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
  }

  async function api(path, opt = {}) {
    const o = { method: opt.method || (opt.body !== undefined ? 'POST' : 'GET'), headers: {} };
    if (opt.body !== undefined) {
      if (typeof opt.body === 'string') { o.headers['Content-Type'] = 'text/plain'; o.body = opt.body; }
      else { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
    }
    const r = await fetch(path, o);
    if (r.status === 401) { location.href = '/login'; throw new Error('Perlu login'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // ---------- Suara notifikasi ----------
  let actx;
  function chime(type) {
    if (!store.get('sound', true)) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') return;
      const notes = type === 'money' || type === 'order' ? [660, 880, 1320] : type === 'warn' ? [440, 330] : type === 'ad' ? [587, 784] : [740, 988];
      notes.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const t0 = actx.currentTime + i * 0.11;
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.12, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.4);
      });
    } catch (_) {}
  }
  addEventListener('pointerdown', () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (_) {} }, { once: true });

  function confetti(x, y) {
    const colors = ['#c9446a', '#d6b26e', '#3fb37f', '#5b8def', '#9b7bdb', '#f4ede9'];
    for (let i = 0; i < 28; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', (Math.random() * 260 - 130) + 'px');
      c.style.setProperty('--dy', (Math.random() * 220 + 60) + 'px');
      c.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      document.body.appendChild(c); setTimeout(() => c.remove(), 1500);
    }
  }

  // ---------- Toast ----------
  function toast({ type = 'info', title, text = '', actions = [], ms = 6500, ts = Date.now(), amount = null }) {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `toast t-${type}`; el.style.setProperty('--d', ms + 'ms');
    el.innerHTML = `<div class="ti">${icon(TYPE_ICON[type] || 'bell', 20)}</div><div class="tx"><div class="tt">${esc(title)}</div>${amount ? `<div class="amt">+${rp(amount)}</div>` : ''}${text ? `<div class="bd">${esc(text)}</div>` : ''}<div class="tm">${clock(ts)} • SWEET</div><div class="ac"></div></div><button class="x" title="Tutup">${icon('x', 14)}</button><div class="bar"></div>`;
    const ac = el.querySelector('.ac');
    if (!actions.length) ac.remove();
    let closed = false, timer, left = ms, started = Date.now();
    const close = () => { if (closed) return; closed = true; clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 700); };
    actions.forEach((a) => {
      const b = document.createElement('button'); b.className = `btn sm ${a.cls || ''}`; b.textContent = a.label;
      b.onclick = async () => { b.disabled = true; try { await a.fn(); } catch (e) { toast({ type: 'warn', title: 'Gagal', text: e.message }); } close(); };
      ac.appendChild(b);
    });
    el.querySelector('.x').onclick = close;
    el.addEventListener('mouseenter', () => { clearTimeout(timer); left -= Date.now() - started; });
    el.addEventListener('mouseleave', () => { started = Date.now(); timer = setTimeout(close, Math.max(1500, left)); });
    box.prepend(el);
    [...box.children].slice(5).forEach((c) => c.remove());
    timer = setTimeout(close, ms);
    chime(type);
    if (type === 'money' || type === 'order') setTimeout(() => { const r = el.getBoundingClientRect(); confetti(r.left + 30, r.top + 20); }, 450);
    return el;
  }

  const amountOf = (n) => { const m = String(n.title + ' ' + (n.text || '')).match(/Rp\s?([\d.]+)/); return m ? Number(m[1].replace(/\./g, '')) : null; };
  function fromServer(n) {
    const actions = [];
    if (n.data && n.data.ad_id) {
      actions.push({ label: 'Terima', cls: 'green', fn: () => api(`/api/ads/${n.data.ad_id}/approve`, { method: 'POST' }) });
      actions.push({ label: 'Tolak', cls: 'ghost', fn: () => api(`/api/ads/${n.data.ad_id}/reject`, { method: 'POST' }) });
    }
    toast({ type: n.type, title: n.title, text: n.text, actions, ms: actions.length ? 20000 : 7000, ts: n.ts, amount: n.type === 'order' ? amountOf(n) : null });
  }

  // ---------- Bus event realtime (SSE) ----------
  const listeners = {};
  const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  const emit = (ev, d) => (listeners[ev] || []).forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } });
  let es;
  function connect() {
    if (es) return;
    es = new EventSource('/api/events');
    ['agent', 'office', 'activity', 'roster', 'tick', 'players'].forEach((ev) => es.addEventListener(ev, (e) => emit(ev, JSON.parse(e.data))));
    es.addEventListener('clock', (e) => setClock(JSON.parse(e.data)));
    es.addEventListener('notify', (e) => {
      const n = JSON.parse(e.data);
      if (!window.SWEET_SILENT && !(n.data && n.data.silent)) fromServer(n);
      bumpBell(1); emit('notify', n);
    });
    es.onopen = () => emit('online', true);
    es.onerror = () => emit('online', false);
  }

  // ---------- Jam kantor (diekstrapolasi dari server) ----------
  let clk = null;
  function setClock(c) { clk = { ...c, localAt: Date.now() }; emit('clock', c); }
  const simNow = () => (clk ? clk.simMs + (Date.now() - clk.localAt) * clk.speed : Date.now());
  const simHour = () => ((simNow() + 7 * 3600e3) % 86400e3) / 3600e3;
  const simTime = (sec) => new Date(simNow() + 7 * 3600e3).toISOString().slice(11, sec ? 19 : 16);

  // ---------- Navbar ----------
  let unread = 0;
  function bumpBell(d) {
    unread = Math.max(0, unread + d); renderBell();
    const b = document.getElementById('bell'); if (b && d > 0) { b.classList.remove('ring'); void b.offsetWidth; b.classList.add('ring'); }
  }
  function renderBell() {
    const b = document.getElementById('bell'); if (!b) return;
    b.classList.toggle('has', unread > 0);
    b.querySelector('.dot').textContent = unread > 99 ? '99+' : unread;
  }

  function nav(active) {
    const el = document.getElementById('nav'); if (!el) return;
    const L = (href, id, ic, label) => `<a href="${href}" class="${active === id ? 'on' : ''}">${icon(ic, 16)} <span>${label}</span></a>`;
    el.innerHTML = `<a class="brand" href="/"><img class="logo" src="/logo.svg" alt="SWEET" width="38" height="38"><div><b>SWEET <em>AI</em> Office</b><small>Kantor AI · Bos Kevin</small></div></a>
      <nav class="links">${L('/', 'home', 'home', 'Beranda')}${L('/office', 'office', 'office', 'Office')}${L('/ruangan', 'ruangan', 'door', 'Ruang Agen')}${L('/stayhome', 'stayhome', 'bed', 'Stay Home')}${L('/trading', 'trading', 'trend', 'Trading')}${L('/dashboard', 'dashboard', 'chart', 'Dashboard')}</nav>
      <div class="right">
        <div class="chips"><span class="chip" id="c-mode"><i></i>Kerja</span><span class="chip" id="c-ai"><i></i>AI</span><span class="chip" id="c-lz"><i></i>Lazada</span></div>
        <span class="clock" id="navclock" title="Jam kantor (WIB)">${icon('clock', 15)}<span>--:--</span></span>
        <button class="iconbtn" id="sndbtn" title="Suara notifikasi">${icon(store.get('sound', true) ? 'sound' : 'mute', 17)}</button>
        <button class="iconbtn" id="bell" title="Notifikasi">${icon('bell', 17)}<span class="dot">0</span></button>
        <button class="userbtn" id="userbtn" title="Akun"><span class="avatar" style="width:30px;height:30px;font-size:11px">··</span></button>
      </div>`;
    const menu = document.createElement('div'); menu.id = 'bellmenu'; document.body.appendChild(menu);
    document.getElementById('sndbtn').onclick = (e) => { const v = !store.get('sound', true); store.set('sound', v); e.currentTarget.innerHTML = icon(v ? 'sound' : 'mute', 17); if (v) chime('info'); };
    document.getElementById('bell').onclick = async () => {
      menu.classList.toggle('open');
      if (!menu.classList.contains('open')) return;
      const d = await api('/api/notifications?limit=30');
      menu.innerHTML = `<div class="hd">Notifikasi <button class="btn xs ghost" id="readall">Tandai dibaca</button></div>` +
        (d.items.map((n) => `<div class="it ${n.read ? '' : 'unread'}" style="--c:${TYPE_COLOR[n.type] || '#aaa'}">${icon(TYPE_ICON[n.type] || 'bell', 16)}<div><b>${esc(n.title)}</b><span>${esc(String(n.text || '').slice(0, 220))}</span><span class="mono" style="font-size:10.5px">${timeAgo(n.ts)}</span></div></div>`).join('') || '<div class="empty">Belum ada notifikasi</div>');
      document.getElementById('readall').onclick = async () => { await api('/api/notifications/read', { method: 'POST' }); unread = 0; renderBell(); menu.querySelectorAll('.unread').forEach((x) => x.classList.remove('unread')); };
    };
    document.addEventListener('click', (e) => { if (!e.target.closest('#bell') && !e.target.closest('#bellmenu')) menu.classList.remove('open'); });
    const tick = () => { const c = document.querySelector('#navclock span:last-child'); if (c) c.textContent = simTime(true) + (clk && clk.speed > 1 ? ` · ${clk.speed}x` : ''); };
    tick(); setInterval(tick, 250);
    health(); setInterval(health, 20000); connect();
    on('office', (o) => setMode(o.mode));
    loadUser();
  }

  // ---------- Akun yang sedang masuk ----------
  let me = null;
  async function loadUser() {
    try { me = (await api('/api/auth/me')).user; } catch (_) { me = null; }
    window.SWEET.user = me;
    const b = document.getElementById('userbtn'); if (!b || !me) return;
    b.innerHTML = avatar({ name: me.name, color: me.role === 'admin' ? '#a52a4a' : '#3a2a31' }, 30);
    const um = document.createElement('div'); um.id = 'usermenu'; document.body.appendChild(um);
    um.innerHTML = `<div class="uh">${avatar({ name: me.name, color: me.role === 'admin' ? '#a52a4a' : '#3a2a31' }, 40)}<div><b>${esc(me.name)}</b><span>${esc(me.email)}</span><em class="tag ${me.role === 'admin' ? 'demo' : ''}">${me.role === 'admin' ? 'Admin — kontrol penuh' : 'Pengguna — lihat saja'}</em></div></div>
      ${me.role === 'admin' ? `<a href="/dashboard#pengguna">${icon('users', 16)} Kelola pengguna</a>` : ''}<a href="/dashboard#akun">${icon('lock', 16)} Ganti kata sandi</a><a href="/logout" class="out">${icon('logout', 16)} Keluar</a>`;
    b.onclick = (e) => { e.stopPropagation(); um.classList.toggle('open'); };
    document.addEventListener('click', (e) => { if (!e.target.closest('#usermenu')) um.classList.remove('open'); });
    if (me.role !== 'admin') {
      document.body.classList.add('viewer');
      const v = document.createElement('div'); v.className = 'viewerbar'; v.innerHTML = `${icon('eye', 14)} Mode lihat saja — hanya admin yang bisa memberi perintah atau mengubah data.`;
      document.body.appendChild(v);
    }
    emit('user', me);
  }

  const MODE_LABEL = { rapat: 'Rapat', istirahat: 'Istirahat', pulang: 'Di luar jam kerja', kerja: 'Kerja' };
  function setMode(mode) {
    const c = document.getElementById('c-mode'); if (!c) return;
    c.className = 'chip ok mode-' + mode;
    c.innerHTML = `<i></i>${MODE_LABEL[mode] || mode}`;
  }

  async function health() {
    try {
      const h = await api('/api/health');
      const set = (id, cls, t) => { const c = document.getElementById(id); if (c) { c.className = 'chip ' + cls; c.innerHTML = `<i></i>${t}`; } };
      const ai = h.ai.order[0];
      set('c-ai', ai ? 'ok' : 'warn', ai ? `AI: ${ai[0].toUpperCase() + ai.slice(1)}` : 'AI: simulasi');
      set('c-lz', h.lazada === 'live' ? 'ok' : 'warn', h.lazada === 'live' ? 'Lazada LIVE' : h.lazada === 'perlu-otorisasi' ? 'Lazada: otorisasi' : (h.demo ? 'Lazada DEMO' : 'Lazada simulasi'));
      setMode(h.mode);
      if (h.clock) setClock(h.clock);
      unread = h.unread; renderBell();
      window.SWEET.health = h; emit('health', h);
    } catch (_) {}
  }

  window.SWEET = { api, toast, nav, esc, rp, num, md, timeAgo, clock, on, emit, store, chime, confetti, icon, avatar, initials, user: null, simNow, simHour, simTime, get clk() { return clk; }, TYPE_ICON, TYPE_COLOR, health: null };
})();
