// SWEET AI Agent Office — renderer kantor 3D (three.js)
// Dipakai oleh /office (seluruh kantor + slide ruangan) dan /ruangan (fokus satu ruangan).
import * as THREE from 'three';
import { buildModel, CHARACTERS } from './chars.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const HAIR = ['#2b2018', '#3d2b1f', '#141414', '#6b4a2f', '#8a4b2a', '#242a35'];
const SKIN = ['#f1c9a5', '#e8b88f', '#d9a27a', '#f3d2b5', '#c98d63'];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export async function createOffice(container, opts = {}) {
  const S = window.SWEET;
  const state = await S.api('/api/state');
  const L = state.layout;
  const DH = L.deck.h;

  // ---------- Renderer, scene, camera ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';

  const overlay = document.createElement('div');
  overlay.className = 'o3d-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  container.appendChild(overlay);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1216');
  scene.fog = new THREE.Fog('#1a1216', 220, 520);
  const camera = new THREE.PerspectiveCamera(26, 1, 1, 800);

  const hemi = new THREE.HemisphereLight('#fff8ee', '#b9a88f', 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3e0', 1.55);
  sun.position.set(-30, 70, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -78, right: 84, top: 62, bottom: -62, near: 10, far: 220 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  sun.target.position.set(12, 0, 20);
  scene.add(sun, sun.target);

  // ---------- Helpers ----------
  const matCache = new Map();
  const mat = (color, o = {}) => {
    const k = color + JSON.stringify(o);
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02, ...o }));
    return matCache.get(k);
  };
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 18);
  const SPH = new THREE.SphereGeometry(1, 18, 14);
  function box(parent, w, h, d, color, x, y, z, o = {}) {
    const m = new THREE.Mesh(BOX, typeof color === 'string' ? mat(color, o.m) : color);
    m.scale.set(w, h, d); m.position.set(x, y + h / 2, z);
    m.castShadow = o.cast !== false; m.receiveShadow = o.receive !== false;
    if (o.ry) m.rotation.y = o.ry;
    parent.add(m); return m;
  }
  function cyl(parent, r, h, color, x, y, z, o = {}) {
    const m = new THREE.Mesh(CYL, typeof color === 'string' ? mat(color, o.m) : color);
    m.scale.set(r, h, r); m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true;
    parent.add(m); return m;
  }
  function sph(parent, r, color, x, y, z, o = {}) {
    const m = new THREE.Mesh(SPH, mat(color, o.m)); m.scale.set(r, (o.sy || 1) * r, r); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    t.userData = { c, ctx }; return t;
  }
  function plant(parent, x, y, z, s = 1) {
    cyl(parent, 0.32 * s, 0.45 * s, '#d9cbb5', x, y, z);
    sph(parent, 0.5 * s, '#5aa457', x, y + 0.85 * s, z);
    sph(parent, 0.36 * s, '#6dbb63', x + 0.2 * s, y + 1.15 * s, z - 0.1 * s);
  }

  const animators = []; // fungsi(t, dt) untuk animasi properti ruangan
  const colliders = []; // dinding untuk mode jalan-jalan (x0,x1,z0,z1, level 0 = lantai bawah, 1 = lantai atas)
  const addCol = (x0, x1, z0, z1, level = 0) => colliders.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), level });
  const labels = [];    // { el, pos:Vector3, kind }
  function addLabel(html, pos, cls) {
    const el = document.createElement('div'); el.className = `o3d-label ${cls || ''}`; el.innerHTML = html;
    overlay.appendChild(el); const l = { el, pos, kind: cls }; labels.push(l); return l;
  }

  // ---------- Lantai & gedung ----------
  const F = L.floor;
  const woodTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#dcc6a2'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? '#d6bf99' : '#e0caa8'; g.fillRect(0, i * 32, w, 31);
      g.fillStyle = 'rgba(120,90,50,.12)'; g.fillRect(0, i * 32 + 31, w, 1);
      for (let j = 0; j < 3; j++) g.fillRect(((i * 97 + j * 171) % w), i * 32, 1, 31);
    }
  });
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping; woodTex.repeat.set(8, 8);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: '#2a1c22', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.42; ground.receiveShadow = true; scene.add(ground);
  const slab = box(scene, F.x1 - F.x0, 0.4, F.z1 - F.z0, new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 }), (F.x0 + F.x1) / 2, -0.4, (F.z0 + F.z1) / 2);
  slab.castShadow = false;
  // Dinding luar: belakang tinggi (jendela), samping rendah, depan sangat rendah
  const windowMat = new THREE.MeshStandardMaterial({ color: '#cfe2ee', emissive: '#bcd8ea', emissiveIntensity: 0.35, roughness: 0.2 });
  box(scene, F.x1 - F.x0, 6.2, 0.5, '#efe5d3', (F.x0 + F.x1) / 2, 0, F.z0 - 0.25);
  for (let i = 0; i < 9; i++) {
    const x = F.x0 + 6 + i * ((F.x1 - F.x0 - 12) / 8);
    box(scene, 5.4, 1.5, 0.08, windowMat, x, 4.1, F.z0 + 0.02);
  }
  const signTex = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#2a241d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd9b8'; g.font = '700 54px "JetBrains Mono",monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('S W E E T   ·   A I   A G E N T   O F F I C E', w / 2 + 60, h / 2 + 2, 840);
  });
  { const img = new Image(); img.onload = () => { signTex.userData.ctx.drawImage(img, 22, 10, 108, 108); signTex.needsUpdate = true; }; img.src = '/logo.svg'; }
  box(scene, 26, 2, 0.12, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }), 0, 3.7, F.z0 + 0.06);
  box(scene, 0.4, 1.4, F.z1 - F.z0, '#efe5d3', F.x0 - 0.2, 0, (F.z0 + F.z1) / 2);
  addCol(F.x0 - 80, F.x1 + 0.2, F.z0 - 0.5, F.z0, 0); addCol(F.x0 - 0.4, F.x0, F.z0, F.z1, 0); addCol(F.x0 - 0.2, F.x1 + 0.4, F.z1, F.z1 + 0.4, 0);
  // dinding timur dengan pintu samping menuju tambang emas (di sekitar lorong utara)
  { const g0 = L.northZ - 2.4, g1 = L.northZ + 2.4;
    addCol(F.x1, F.x1 + 0.4, F.z0, g0, 0); addCol(F.x1, F.x1 + 0.4, g1, F.z1, 0);
    box(scene, 0.4, 1.4, g0 - F.z0, '#efe5d3', F.x1 + 0.2, 0, (F.z0 + g0) / 2);
    box(scene, 0.4, 1.4, F.z1 - g1, '#efe5d3', F.x1 + 0.2, 0, (g1 + F.z1) / 2);
    box(scene, 0.5, 2.6, 0.5, '#7d1d36', F.x1 + 0.2, 0, g0); box(scene, 0.5, 2.6, 0.5, '#7d1d36', F.x1 + 0.2, 0, g1); }
  // halaman luar (kantor + tambang) dan jalur patroli security
  const YD = L.yard;
  if (YD) {
    const yard = box(scene, YD.x1 - YD.x0, 0.38, YD.z1 - YD.z0, '#33292a', (YD.x0 + YD.x1) / 2, -0.4, (YD.z0 + YD.z1) / 2, { cast: false }); yard.receiveShadow = true;
    const P = L.perimeter;
    P.forEach((a, i) => { const b = P[(i + 1) % P.length]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const seg = box(scene, len + 2.2, 0.03, 2.2, '#4a3d3a', (a[0] + b[0]) / 2, -0.02, (a[1] + b[1]) / 2, { cast: false }); seg.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); });
    box(scene, L.mine.x0 - F.x1 + 1, 0.03, 4.4, '#5b4b44', (F.x1 + L.mine.x0) / 2, -0.01, L.northZ, { cast: false });
  }
  box(scene, F.x1 - F.x0 + 0.8, 0.5, 0.4, '#e9dfcc', (F.x0 + F.x1) / 2, 0, F.z1 + 0.2);
  // Wall art di dinding belakang lantai bawah (terlihat seperti di foto: poster warna)
  ['#e0743a', '#7b61d1', '#1f9aa3', '#2f9e5b'].forEach((c, i) => box(scene, 1.6, 1.6, 0.08, c, -36 + i * 2.4, DH + 0.8, L.deck.z1 + 0.06));

  // ---------- Mezzanine (lantai atas) ----------
  const D = L.deck;
  addCol(D.x0, D.x1, D.z0, D.z1, 0); addCol(36, 39.6, -4, -1.8, 0); // blok mezzanine & landing tangga (padat dari bawah)
  addCol(D.x0, D.x1, D.z0 - 1, D.z0, 1); addCol(D.x0 - 1, D.x0, D.z0, D.z1, 1); addCol(D.x1, D.x1 + 1, D.z0, D.z1, 1);
  box(scene, D.x1 - D.x0, DH, D.z1 - D.z0, '#d4bb94', (D.x0 + D.x1) / 2, 0, (D.z0 + D.z1) / 2);
  box(scene, D.x1 - D.x0, 0.08, D.z1 - D.z0, new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 }), (D.x0 + D.x1) / 2, DH - 0.02, (D.z0 + D.z1) / 2);
  // Pagar kaca + pegangan
  const glass = new THREE.MeshStandardMaterial({ color: '#cfe6f2', transparent: true, opacity: 0.35, roughness: 0.1 });
  const railEnd = 35.6;
  box(scene, railEnd - D.x0, 0.9, 0.06, glass, (D.x0 + railEnd) / 2, DH, D.z1 - 0.1, { cast: false });
  box(scene, railEnd - D.x0, 0.08, 0.14, '#3a312a', (D.x0 + railEnd) / 2, DH + 0.92, D.z1 - 0.1);
  for (let x = D.x0; x <= railEnd; x += 4) box(scene, 0.08, 0.95, 0.08, '#3a312a', x, DH, D.z1 - 0.1);
  // Tangga di sisi kanan
  const ST = { x0: 25, x1: 36, z: -2.9, w: 2.1 };
  const steps = 13;
  for (let i = 0; i < steps; i++) {
    const sw = (ST.x1 - ST.x0) / steps;
    box(scene, sw + 0.02, (i + 1) * (DH / steps), ST.w, i % 2 ? '#cdb28a' : '#d6bd97', ST.x0 + (i + 0.5) * sw, 0, ST.z);
  }
  box(scene, 3.6, DH, 2.2, '#d4bb94', 37.8, 0, -2.9);
  const stairRail = new THREE.Mesh(BOX, mat('#3a312a'));
  const rl = Math.hypot(ST.x1 - ST.x0, DH);
  stairRail.scale.set(rl, 0.08, 0.1); stairRail.position.set((ST.x0 + ST.x1) / 2, DH / 2 + 0.95, ST.z + ST.w / 2);
  stairRail.rotation.z = Math.atan2(DH, ST.x1 - ST.x0); scene.add(stairRail);

  // Meja resepsionis (Juan)
  box(scene, 4, 1, 1.2, '#f7f2ea', -35, 0, 0.6); box(scene, 4.2, 0.08, 1.4, '#3a312a', -35, 1, 0.6);
  addLabel('RESEPSIONIS', new THREE.Vector3(-35, 1.4, 1.6), 'small');
  plant(scene, -39.5, 0, -2.5, 1.2); plant(scene, 22, 0, -2.6, 1);

  // ---------- Layar dinding per ruangan (konten animasi sesuai kerjaan) ----------
  const screens = []; // { tex, theme, agentKey }
  function wallScreen(parent, w, h, x, y, z, theme, agentKey) {
    const tex = canvasTex(256, 144, (g) => { g.fillStyle = '#1d2430'; g.fillRect(0, 0, 256, 144); });
    box(parent, w + 0.16, h + 0.16, 0.08, '#2a241d', x, y - 0.08, z - 0.02);
    const m = box(parent, w, h, 0.06, new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.4 }), x, y, z + 0.02, { cast: false });
    screens.push({ tex, theme, agentKey, mesh: m });
    return m;
  }
  function drawScreen(sc, t, busy) {
    const g = sc.tex.userData.ctx, W = 256, H = 144;
    g.fillStyle = busy ? '#16202c' : '#202733'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, 0, W, 16);
    g.fillStyle = busy ? '#4ade80' : '#94a3b8'; g.beginPath(); g.arc(10, 8, 3.5, 0, TAU); g.fill();
    g.fillStyle = '#cbd5e1'; g.font = '700 9px monospace'; g.fillText(busy ? 'BEKERJA' : 'IDLE', 18, 11);
    const k = Math.floor(t * 2);
    const th = sc.theme;
    if (th === 'mine') {
      const tr = sc.agentKey && chars[sc.agentKey] && chars[sc.agentKey].data.trade;
      g.fillStyle = '#d6b26e'; g.font = '700 10px monospace'; g.fillText(`${(tr && tr.symbol) || 'XAUUSD'} ${tr && tr.bid ? tr.bid.toFixed(2) : ''}`, 70, 11);
      let p = 72; sc.seed = sc.seed || 1;
      for (let i = 0; i < 26; i++) {
        const r1 = Math.sin(i * 12.9898 + k * 0.37) * 43758.5453, rnd = r1 - Math.floor(r1);
        const o = p, c = p + (rnd - 0.47 - (tr && tr.trend === 'turun' ? 0.08 : tr && tr.trend === 'naik' ? -0.08 : 0)) * 16; p = Math.max(26, Math.min(130, c));
        const hi = Math.min(o, p) - 4 - rnd * 5, lo = Math.max(o, p) + 4 + rnd * 5;
        g.fillStyle = p <= o ? '#34d399' : '#f87171'; g.fillRect(10 + i * 9.4 + 3, hi, 1, lo - hi); g.fillRect(10 + i * 9.4, Math.min(o, p), 7, Math.max(1.5, Math.abs(p - o)));
      }
      const pd = tr && tr.pending && tr.pending[0];
      if (pd) { g.strokeStyle = /BUY/.test(pd.type) ? '#34d399' : '#f87171'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(8, /BUY/.test(pd.type) ? 118 : 34); g.lineTo(250, /BUY/.test(pd.type) ? 118 : 34); g.stroke(); g.setLineDash([]); g.fillStyle = g.strokeStyle; g.fillText(pd.type, 180, /BUY/.test(pd.type) ? 114 : 30); }
    } else if (['charts', 'billboard'].includes(th) || th === 'meeting' || th === 'boss') {
      for (let i = 0; i < 8; i++) {
        const v = 0.25 + 0.65 * Math.abs(Math.sin(i * 1.7 + (busy ? t * 1.3 : 0.5)));
        g.fillStyle = ['#60a5fa', '#f59e0b', '#34d399', '#f472b6'][i % 4];
        g.fillRect(16 + i * 29, H - 12 - v * 100, 20, v * 100);
      }
    } else if (th === 'kanban' || th === 'bugboard') {
      ['TODO', 'JALAN', 'BERES'].forEach((c, i) => {
        g.fillStyle = '#94a3b8'; g.fillText(c, 14 + i * 82, 30);
        for (let j = 0; j < 4; j++) {
          if ((j + i + (busy ? k : 0)) % 5 === 0) continue;
          g.fillStyle = th === 'bugboard' && i === 0 ? '#f87171' : ['#fde68a', '#bfdbfe', '#bbf7d0'][i];
          g.fillRect(12 + i * 82, 38 + j * 25, 70, 19);
        }
      });
    } else if (th === 'easel' || th === 'phone') {
      for (let i = 0; i < 3; i++) {
        g.fillStyle = '#f8fafc'; g.fillRect(22 + i * 76, 26, 56, 106);
        g.fillStyle = ['#e0743a', '#7b61d1', '#1f9aa3'][(i + (busy ? k : 0)) % 3]; g.fillRect(26 + i * 76, 32, 48, 22);
        g.fillStyle = '#cbd5e1'; for (let j = 0; j < 4; j++) g.fillRect(26 + i * 76, 62 + j * 14, 48 - j * 6, 7);
      }
    } else {
      const cols = ['#93c5fd', '#fca5a5', '#86efac', '#fde68a', '#c4b5fd', '#94a3b8'];
      for (let i = 0; i < 9; i++) {
        const seed = (i + (busy ? k : 0)) * 7919;
        const ind = (seed % 4) * 10, len = 40 + (seed % 140);
        g.fillStyle = cols[seed % cols.length]; g.fillRect(12 + ind, 24 + i * 13, Math.min(len, 220 - ind), 6);
      }
      if (busy && k % 2) { g.fillStyle = '#e5e7eb'; g.fillRect(12 + ((k * 13) % 180), 24 + 8 * 13, 6, 8); }
    }
    sc.tex.needsUpdate = true;
  }

  // ---------- Furnitur per tema ----------
  // Set meja gaming: meja hitam + strip RGB, PC gaming kaca RGB, monitor gaming lengkung, keyboard RGB, kursi gaming, printer resi.
  // Agen duduk di belakang meja menghadap kamera (+z).
  const rgbMats = [];
  function deskSet(g, x, z, color, opt = {}) {
    const ac = color || '#a52a4a';
    const top = box(g, 2.8, 0.07, 1.15, new THREE.MeshStandardMaterial({ color: '#17171c', roughness: 0.45, metalness: 0.3, emissive: '#000000' }), x, 0.74, z);
    [-1.25, 1.25].forEach((dx) => { box(g, 0.1, 0.74, 0.12, '#24242b', x + dx, 0, z - 0.45); box(g, 0.1, 0.74, 0.12, '#24242b', x + dx, 0, z + 0.45); });
    // strip RGB di tepi depan meja (berkedip merah bila mendesak)
    const stripMat = new THREE.MeshStandardMaterial({ color: '#111', emissive: ac, emissiveIntensity: 1.2 });
    box(g, 2.8, 0.035, 0.03, stripMat, x, 0.72, z + 0.59, { cast: false });
    rgbMats.push(stripMat);
    // monitor gaming lengkung (layar menghadap agen, belakang monitor terlihat kamera dengan logo menyala)
    const curve = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.55, 24, 1, true, -0.32, 0.64), new THREE.MeshStandardMaterial({ color: '#0f0f14', roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }));
    curve.position.set(x, 1.12, z - 2.4); curve.castShadow = true; g.add(curve);
    const screenMat = new THREE.MeshStandardMaterial({ color: '#7fb6ff', emissive: '#5aa0ff', emissiveIntensity: 0.7, side: THREE.BackSide });
    const scr = new THREE.Mesh(new THREE.CylinderGeometry(2.18, 2.18, 0.5, 24, 1, true, -0.3, 0.6), screenMat);
    scr.position.copy(curve.position); g.add(scr);
    box(g, 0.08, 0.32, 0.08, '#2a2a33', x, 0.8, z - 0.12);
    box(g, 0.5, 0.03, 0.3, '#2a2a33', x, 0.78, z - 0.12);
    const logo = box(g, 0.14, 0.14, 0.01, new THREE.MeshStandardMaterial({ color: '#111', emissive: ac, emissiveIntensity: 1.5 }), x, 1.1, z - 0.18, { cast: false });
    rgbMats.push(logo.material);
    // keyboard RGB + mouse pad
    const kb = box(g, 0.95, 0.035, 0.28, new THREE.MeshStandardMaterial({ color: '#141418', emissive: '#7c3aed', emissiveIntensity: 0.6 }), x - 0.15, 0.81, z - 0.38, { cast: false });
    rgbMats.push(kb.material);
    box(g, 0.5, 0.01, 0.38, '#1b1b22', x + 0.68, 0.81, z - 0.36, { cast: false });
    box(g, 0.08, 0.04, 0.13, '#222', x + 0.68, 0.82, z - 0.36, { cast: false });
    // PC gaming (casing kaca dengan lampu RGB & kipas)
    const pcX = x + 1.75;
    box(g, 0.5, 1.05, 0.95, '#121216', pcX, 0, z, { m: { metalness: 0.5, roughness: 0.35 } });
    const glassMat = new THREE.MeshStandardMaterial({ color: '#1a1030', emissive: ac, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 });
    box(g, 0.02, 0.85, 0.75, glassMat, pcX - 0.26, 0.1, z, { cast: false });
    rgbMats.push(glassMat);
    [0.3, 0.65].forEach((y) => { const fan = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 20), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#22d3ee', emissiveIntensity: 1.2 })); fan.position.set(pcX, y, z + 0.48); g.add(fan); rgbMats.push(fan.material); });
    // printer resi kecil di sisi kiri meja + kertas yang keluar saat mencetak
    const prX = x - 1.05, prZ = z + 0.05;
    box(g, 0.5, 0.22, 0.42, '#e5e7eb', prX, 0.81, prZ, { m: { roughness: 0.6 } });
    box(g, 0.44, 0.03, 0.06, '#333', prX, 1.0, prZ + 0.14, { cast: false });
    const prLed = box(g, 0.04, 0.03, 0.01, new THREE.MeshStandardMaterial({ color: '#111', emissive: '#22c55e', emissiveIntensity: 1 }), prX + 0.18, 0.96, prZ + 0.215, { cast: false });
    const paper = box(g, 0.34, 0.005, 0.3, new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.15 }), prX, 1.035, prZ + 0.1, { cast: false });
    paper.visible = false;
    // kursi gaming (bucket seat + sandaran tinggi + aksen warna agen)
    const cz = z - 0.95;
    const chair = new THREE.Group(); chair.position.set(x, 0, cz); g.add(chair);
    box(chair, 0.66, 0.12, 0.62, '#1b1b20', 0, 0.42, 0);
    box(chair, 0.18, 0.12, 0.62, ac, -0.3, 0.46, 0); box(chair, 0.18, 0.12, 0.62, ac, 0.3, 0.46, 0);
    box(chair, 0.62, 1.15, 0.12, '#1b1b20', 0, 0.52, -0.33);
    box(chair, 0.14, 1.1, 0.13, ac, -0.25, 0.55, -0.33); box(chair, 0.14, 1.1, 0.13, ac, 0.25, 0.55, -0.33);
    box(chair, 0.34, 0.2, 0.14, '#1b1b20', 0, 1.5, -0.32);
    [-0.37, 0.37].forEach((dx) => box(chair, 0.06, 0.28, 0.4, '#2a2a30', dx, 0.5, 0.02));
    cyl(chair, 0.05, 0.42, '#555', 0, 0, 0);
    for (let i = 0; i < 5; i++) { const leg = box(chair, 0.36, 0.04, 0.06, '#333', Math.cos(i * TAU / 5) * 0.18, 0.04, Math.sin(i * TAU / 5) * 0.18); leg.rotation.y = -i * TAU / 5; }
    return { seat: { x, z: cz + 0.05, face: 0 }, stripMat, screenMat, paper, prLed, top, accent: ac, pos: new THREE.Vector3(x, 0, z) };
  }

  const themeBuilders = {
    kanban(g, w, d) {
      box(g, 0.12, 1.5, 3.4, '#ffffff', -w / 2 + 0.35, 0.8, 0.5);
      const cols = ['#fde68a', '#fbcfe8', '#bbf7d0', '#bfdbfe'];
      for (let i = 0; i < 12; i++) box(g, 0.04, 0.32, 0.32, cols[i % 4], -w / 2 + 0.43, 1.0 + (i % 3) * 0.42, -0.8 + Math.floor(i / 3) * 0.75, { cast: false });
      cyl(g, 0.7, 0.05, '#f6efe2', 4, 0.7, 2); cyl(g, 0.07, 0.7, '#999', 4, 0, 2);
      [[3.1, 2], [4.9, 2]].forEach(([a, b]) => cyl(g, 0.25, 0.45, '#e0743a', a, 0, b));
    },
    blueprint(g, w) {
      const top = box(g, 2.2, 0.06, 1.5, '#4a7fc1', -4, 0.95, 1.6); top.rotation.x = -0.25;
      [-0.9, 0.9].forEach((dx) => box(g, 0.08, 0.95, 1.2, '#8b7355', -4 + dx, 0, 1.6));
      box(g, 0.5, 2.0, 3.2, '#e8dcc6', w / 2 - 0.5, 0, -0.6);
      ['#60a5fa', '#34d399', '#f472b6', '#fbbf24'].forEach((c, i) => box(g, 0.42, 0.36, 0.7, c, w / 2 - 0.5, 0.3 + i * 0.45, -0.6 + (i % 2 ? 0.6 : -0.6)));
    },
    easel(g) {
      const art = canvasTex(128, 128, (c) => { ['#e0743a', '#7b61d1', '#1f9aa3', '#f2c14e'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(30 + i * 22, 40 + (i % 2) * 40, 26, 0, TAU); c.fill(); }); });
      box(g, 0.08, 2, 0.08, '#8b6b4a', -4.4, 0, 1.4); box(g, 0.08, 2, 0.08, '#8b6b4a', -3.6, 0, 1.4);
      box(g, 1.3, 1.1, 0.06, new THREE.MeshStandardMaterial({ map: art }), -4, 1.0, 1.5);
      sph(g, 0.6, '#e58fb5', 4, 0.4, 2, { sy: 0.6 });
      ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'].forEach((c, i) => box(g, 0.5, 0.5, 0.05, c, 2.4 + i * 0.6, 1.6, -5.35, { cast: false }));
    },
    phone(g) {
      box(g, 1.1, 2.0, 0.18, '#1f2937', -4.4, 0.3, 1.2);
      box(g, 0.95, 1.75, 0.02, new THREE.MeshStandardMaterial({ color: '#a7f3d0', emissive: '#6ee7b7', emissiveIntensity: 0.5 }), -4.4, 0.42, 1.3, { cast: false });
      box(g, 0.6, 0.3, 0.6, '#d1d5db', -4.4, 0, 1.2);
      box(g, 2.2, 0.06, 0.6, '#e8dcc6', 4.2, 1.1, -0.6);
      for (let i = 0; i < 5; i++) box(g, 0.25, 0.45, 0.04, ['#111', '#334155', '#e5e7eb'][i % 3], 3.4 + i * 0.4, 1.16, -0.6);
    },
    rack(g, w) {
      [w / 2 - 1.1, w / 2 - 2.3].forEach((x) => {
        box(g, 1, 2.3, 0.9, '#2b2f38', x, 0, -1.2);
        for (let i = 0; i < 6; i++) {
          const led = box(g, 0.08, 0.05, 0.02, new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 1 }), x - 0.3 + (i % 3) * 0.12, 0.4 + Math.floor(i / 3) * 0.6 + (i % 2) * 0.3, -0.74, { cast: false });
          animators.push((t, dt, busyOf) => { led.material.emissiveIntensity = (Math.sin(t * (busyOf() ? 9 : 2) + i * 1.7) > 0.2) ? 1.4 : 0.1; });
        }
      });
    },
    dbstack(g, w) {
      for (let i = 0; i < 3; i++) {
        cyl(g, 0.75, 0.5, '#5aa9c9', -4.2, 0.1 + i * 0.62, 1.4);
        const ring = cyl(g, 0.77, 0.06, new THREE.MeshStandardMaterial({ color: '#bfe9ff', emissive: '#7dd3fc', emissiveIntensity: 0.8 }), -4.2, 0.55 + i * 0.62, 1.4);
        animators.push((t, dt, busyOf) => { ring.material.emissiveIntensity = busyOf() ? 0.6 + 0.6 * Math.sin(t * 5 + i) : 0.3; });
      }
      [0, 1].forEach((i) => box(g, 0.9, 1.3, 0.7, '#9aa5b1', w / 2 - 0.8 - i * 1, 0, -1.2));
    },
    bugboard(g, w) {
      box(g, 0.1, 1.5, 3, '#c79a63', -w / 2 + 0.35, 0.8, 0.4);
      for (let i = 0; i < 9; i++) {
        const b = sph(g, 0.1, '#ef4444', -w / 2 + 0.45, 1.0 + (i % 3) * 0.4, -0.7 + Math.floor(i / 3) * 0.9);
        animators.push((t, dt, busyOf) => { b.scale.setScalar(busyOf() ? 0.1 + 0.04 * Math.sin(t * 6 + i) : 0.1); });
      }
      cyl(g, 0.35, 0.04, '#bae6fd', 4, 0.9, 1.8); box(g, 0.08, 0.8, 0.08, '#6b4a2f', 4, 0.1, 2.25);
      box(g, 1.8, 0.75, 0.9, '#f6efe2', 4, 0, 1.9);
    },
    vault(g, w) {
      box(g, 1.3, 1.5, 1.1, '#4b5563', w / 2 - 1.2, 0, 1.2);
      cyl(g, 0.25, 0.06, '#d4a12a', w / 2 - 1.2, 0.85, 1.78).rotation.x = Math.PI / 2;
      const sh = canvasTex(128, 128, (c) => { c.fillStyle = '#d96c6c'; c.beginPath(); c.moveTo(64, 10); c.lineTo(112, 30); c.quadraticCurveTo(110, 96, 64, 120); c.quadraticCurveTo(18, 96, 16, 30); c.closePath(); c.fill(); c.fillStyle = '#fff'; c.font = '700 54px sans-serif'; c.textAlign = 'center'; c.fillText('✓', 64, 86); });
      box(g, 1.2, 1.2, 0.04, new THREE.MeshStandardMaterial({ map: sh, transparent: true }), -3.6, 1.4, -5.35, { cast: false });
      box(g, 0.06, 2.4, 0.06, '#555', -w / 2 + 0.6, 0, 3.8);
      const cam = box(g, 0.45, 0.22, 0.25, '#e5e7eb', -w / 2 + 0.8, 2.3, 3.8);
      animators.push((t) => { cam.rotation.y = Math.sin(t * 0.7) * 0.8; });
    },
    rocket(g) {
      const r = new THREE.Group(); r.position.set(-4.2, 0, 1.4); g.add(r);
      cyl(r, 0.35, 1.6, '#e5e7eb', 0, 0.35, 0);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.6, 18), mat('#ef4444')); cone.position.y = 2.25; cone.castShadow = true; r.add(cone);
      [0, 1, 2].forEach((i) => { const f = box(r, 0.06, 0.5, 0.45, '#ef4444', Math.cos(i * TAU / 3) * 0.35, 0.3, Math.sin(i * TAU / 3) * 0.35); f.rotation.y = -i * TAU / 3; });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 12), new THREE.MeshStandardMaterial({ color: '#fb923c', emissive: '#f97316', emissiveIntensity: 1.5, transparent: true, opacity: 0.9 }));
      flame.rotation.x = Math.PI; flame.position.y = 0.05; r.add(flame);
      box(g, 1.2, 0.35, 1.2, '#9aa8b5', -4.2, 0, 1.4);
      animators.push((t, dt, busyOf) => { const b = busyOf(); flame.visible = b; flame.scale.y = 1 + 0.35 * Math.sin(t * 20); r.position.y = b ? 0.05 + 0.04 * Math.sin(t * 15) : 0; });
      for (let i = 0; i < 6; i++) {
        const l = box(g, 0.5, 0.12, 0.04, new THREE.MeshStandardMaterial({ color: '#86efac', emissive: '#22c55e', emissiveIntensity: 0.2 }), 2 + i * 0.7, 2.1, -5.35, { cast: false });
        animators.push((t, dt, busyOf) => { l.material.emissiveIntensity = busyOf() && Math.floor(t * 4) % 6 === i ? 1.6 : 0.2; });
      }
    },
    review(g, w) {
      box(g, 0.5, 2.2, 3.4, '#8b6b4a', w / 2 - 0.5, 0, -0.6);
      for (let i = 0; i < 12; i++) box(g, 0.32, 0.42, 0.18, ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'][i % 5], w / 2 - 0.55, 0.3 + Math.floor(i / 4) * 0.62, -1.8 + (i % 4) * 0.7);
      box(g, 2.2, 0.45, 0.9, '#c9a227', -4, 0, 2); box(g, 2.2, 0.5, 0.25, '#b38f1f', -4, 0.45, 1.6);
      box(g, 0.3, 0.1, 0.3, '#22c55e', 0.9, 0.82, -1.5); box(g, 0.3, 0.1, 0.3, '#ef4444', -0.9, 0.82, -1.5);
    },
    headset(g, w) {
      const bub = canvasTex(256, 128, (c) => { c.fillStyle = '#f08fa0'; c.beginPath(); c.roundRect(10, 10, 236, 86, 30); c.fill(); c.beginPath(); c.moveTo(60, 90); c.lineTo(50, 120); c.lineTo(90, 92); c.fill(); c.fillStyle = '#fff'; c.font = '700 40px sans-serif'; c.textAlign = 'center'; c.fillText('Halo kak!', 128, 66); });
      box(g, 2.2, 1.1, 0.04, new THREE.MeshStandardMaterial({ map: bub, transparent: true }), -3.6, 1.5, -5.35, { cast: false });
      const hs = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 20, Math.PI), mat('#111')); hs.position.set(0.9, 0.95, -1.4); g.add(hs);
      box(g, 2, 0.45, 0.85, '#f08fa0', 4, 0, 2); box(g, 2, 0.5, 0.22, '#e27b8e', 4, 0.45, 1.65);
    },
    parcels(g, w) {
      for (let i = 0; i < 10; i++) box(g, 0.8, 0.6, 0.7, i % 3 ? '#c8a06a' : '#b88b52', -4.6 + (i % 3) * 0.85, Math.floor(i / 3) * 0.6, 1.2 + (i % 2) * 0.2);
      box(g, 1.4, 0.08, 0.9, '#6b7280', 4, 0.3, 2); [-0.6, 0.6].forEach((dx) => cyl(g, 0.15, 0.08, '#111', 4 + dx, 0.05, 2.3));
      box(g, 0.08, 1.2, 0.9, '#6b7280', 3.3, 0.3, 2);
      for (let i = 0; i < 2; i++) box(g, 0.7, 0.5, 0.6, '#c8a06a', 4.2, 0.38 + i * 0.5, 2);
    },
    shelves(g, w) {
      [-w / 2 + 0.5, w / 2 - 0.5].forEach((x) => {
        box(g, 0.6, 2.2, 3.6, '#e8dcc6', x, 0, 0.2);
        for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) box(g, 0.4, 0.38, 0.5, ['#f87171', '#60a5fa', '#fbbf24', '#34d399', '#c084fc'][(i + j) % 5], x, 0.15 + j * 0.52, -1.4 + i * 0.7);
      });
    },
    billboard(g) {
      box(g, 0.12, 1.6, 0.12, '#444', -4.2, 0, 1.6);
      const bb = canvasTex(256, 128, (c) => { c.fillStyle = '#e8754a'; c.fillRect(0, 0, 256, 128); });
      const bm = box(g, 2.4, 1.3, 0.1, new THREE.MeshStandardMaterial({ map: bb, emissive: '#fff', emissiveMap: bb, emissiveIntensity: 0.5 }), -4.2, 1.6, 1.6);
      const words = ['PROMO!', 'DISKON 20%', 'SPONSORED', 'CHECKOUT!'];
      let last = -1;
      animators.push((t, dt, busyOf) => {
        const k = Math.floor(t / (busyOf() ? 1 : 3)) % 4; if (k === last) return; last = k;
        const c = bb.userData.ctx; c.fillStyle = ['#e8754a', '#7b61d1', '#1f9aa3', '#cf9a1f'][k]; c.fillRect(0, 0, 256, 128);
        c.fillStyle = '#fff'; c.font = '800 38px sans-serif'; c.textAlign = 'center'; c.fillText(words[k], 128, 76); bb.needsUpdate = true;
      });
      const meg = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 14, 1, true), mat('#f59e0b', { side: THREE.DoubleSide }));
      meg.rotation.z = Math.PI / 2; meg.position.set(1.1, 0.95, -1.4); g.add(meg);
      bm.castShadow = true;
    },
    charts(g) {
      box(g, 0.1, 2.2, 0.1, '#444', -4.2, 0, 1.6);
      box(g, 2.6, 1.6, 0.08, '#f8fafc', -4.2, 1.0, 1.6);
      for (let i = 0; i < 6; i++) {
        const bar = box(g, 0.28, 1, 0.06, ['#5b8fd9', '#f59e0b', '#34d399'][i % 3], -5.2 + i * 0.4, 1.15, 1.66, { cast: false });
        animators.push((t, dt, busyOf) => { const v = 0.2 + 0.9 * Math.abs(Math.sin(i * 1.3 + (busyOf() ? t * 1.6 : 0))); bar.scale.y = v; bar.position.y = 1.15 + v / 2; });
      }
      cyl(g, 0.6, 0.05, '#f6efe2', 4, 0.7, 2); cyl(g, 0.06, 0.7, '#999', 4, 0, 2);
    },
    lounge(g, w, d) {
      const rug = box(g, 9, 0.03, 5, '#e9b97a', -2, 0, 0.6, { cast: false }); rug.receiveShadow = true;
      box(g, 6, 0.5, 1.1, '#e07a3f', -2.5, 0, -2.4); box(g, 6, 0.7, 0.3, '#c96530', -2.5, 0.45, -2.9);
      box(g, 1.1, 0.5, 3, '#e07a3f', -6, 0, -0.5); box(g, 0.3, 0.7, 3, '#c96530', -6.5, 0.45, -0.5);
      box(g, 2.4, 0.08, 1.2, '#7a5634', -2.2, 0.42, 0.4); [-1, 1].forEach((dx) => box(g, 0.08, 0.42, 1, '#7a5634', -2.2 + dx, 0, 0.4));
      cyl(g, 0.08, 0.14, '#fff', -2.6, 0.5, 0.4); cyl(g, 0.08, 0.14, '#fff', -1.8, 0.5, 0.3);
      box(g, 2.6, 1, 0.8, '#f6efe2', 6.5, 0, -2.6); box(g, 0.6, 0.7, 0.5, '#374151', 6.2, 1, -2.7);
      const steam = sph(g, 0.12, '#ffffff', 6.2, 1.9, -2.6, { m: { transparent: true, opacity: 0.6 } });
      animators.push((t) => { const p = (t * 0.6) % 1; steam.position.y = 1.8 + p * 0.8; steam.material.opacity = 0.6 * (1 - p); steam.scale.setScalar(0.1 + p * 0.15); });
      box(g, 3, 1.7, 0.08, '#111827', 2, 1.0, -3.85);
      plant(g, -w / 2 + 0.8, 0, d / 2 - 0.8, 1.1); plant(g, w / 2 - 0.8, 0, d / 2 - 0.8, 1.1);
    },
    meeting(g) {
      box(g, 13.5, 0.1, 2.4, '#7a5634', 0, 0.74, 0);
      [-6, -2, 2, 6].forEach((x) => box(g, 0.3, 0.74, 1.6, '#5e4228', x, 0, 0));
      for (let i = 0; i < 7; i++) {
        const x = -6 + i * 2;
        box(g, 0.62, 0.08, 0.6, '#3b3f4a', x, 0.44, -1.85); box(g, 0.62, 0.6, 0.08, '#3b3f4a', x, 0.5, -2.15);
        box(g, 0.62, 0.08, 0.6, '#3b3f4a', x, 0.44, 1.85); box(g, 0.62, 0.6, 0.08, '#3b3f4a', x, 0.5, 2.15);
      }
      [[-7.5, 0], [7.5, 0]].forEach(([x, z]) => box(g, 0.6, 0.08, 0.62, x > 0 ? '#c9a227' : '#3b3f4a', x, 0.44, z));
      for (let i = 0; i < 6; i++) box(g, 0.5, 0.02, 0.35, '#fff', -5 + i * 2, 0.85, (i % 2 ? 0.5 : -0.5), { cast: false });
    },
    boss(g, w, d) {
      const rug = box(g, 7, 0.03, 4.4, '#8c2f39', 0, 0, 0, { cast: false }); rug.receiveShadow = true;
      box(g, 3.6, 0.1, 1.5, '#5a3d22', 0, 0.8, -0.2); box(g, 3.4, 0.8, 1.3, '#6b4a2b', 0, 0, -0.2);
      box(g, 0.9, 0.1, 0.8, '#2a1f17', 0, 0.48, -1.35); box(g, 0.9, 1.3, 0.15, '#2a1f17', 0, 0.5, -1.75);
      box(g, 1, 0.55, 0.06, '#111827', -0.9, 0.9, -0.5); box(g, 0.25, 0.25, 0.25, '#d4a12a', 1.1, 0.9, -0.3);
      box(g, 0.5, 2.2, 3, '#5a3d22', w / 2 - 0.6, 0, -1);
      for (let i = 0; i < 3; i++) { cyl(g, 0.12, 0.35, '#d4a12a', w / 2 - 0.6, 0.6 + i * 0.6, -1.8 + i * 0.6); sph(g, 0.16, '#f2c14e', w / 2 - 0.6, 1.05 + i * 0.6, -1.8 + i * 0.6); }
      box(g, 2.8, 0.45, 0.9, '#3d2b1f', -5.5, 0, 1.6); box(g, 2.8, 0.55, 0.25, '#2a1f17', -5.5, 0.45, 1.2);
      plant(g, -w / 2 + 0.8, 0, -d / 2 + 0.8, 1.2); plant(g, w / 2 - 0.8, 0, d / 2 - 0.8, 1.2);
    },
    bullpen() { /* meja rekrutan dibuat dinamis */ },
    desk() {}
  };


  // ---------- Tambang emas (agent #16 Aurel, XAUUSD 24 jam) ----------
  const MINEX = { cart: null, pile: null, pileN: 6, flag: null, cloth: null, clothMat: null, limitLbl: null, pileLbl: null, boardTex: null, board: null, miner: null };
  function buildMine(r) {
    const M = L.mine, cx = (M.x0 + M.x1) / 2, cz = (M.z0 + M.z1) / 2;
    addCol(50, M.cave.x - 2.7, M.z0, -3.6); addCol(M.cave.x + 2.7, 92, M.z0, -3.6); addCol(M.cave.x - 2.7, M.cave.x + 2.7, M.z0, -5.4);
    addCol(M.x1 - 0.5, M.x1 + 0.2, M.z0, M.z1); addCol(M.x0, M.x1, M.z1 - 0.5, M.z1 + 0.2);
    addCol(M.x0, M.x0 + 0.5, M.z0 + 9, M.gate.z - 2.6); addCol(M.x0, M.x0 + 0.5, M.gate.z + 2.6, M.z1);
    rooms[r.id] = { ...r, group: scene, y0: 0 };
    roomByAgent[r.agent] = r.id;
    const dirt = canvasTex(256, 256, (g) => { g.fillStyle = '#7a6247'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 1600; i++) { g.fillStyle = ['#6d573f', '#86704f', '#5f4b36', '#8f7a58'][i % 4]; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2); } });
    dirt.wrapS = dirt.wrapT = THREE.RepeatWrapping; dirt.repeat.set(6, 9);
    const ground = box(scene, M.x1 - M.x0, 0.4, M.z1 - M.z0, new THREE.MeshStandardMaterial({ map: dirt, roughness: 1 }), cx, -0.39, cz, { cast: false }); ground.receiveShadow = true;
    // pagar kayu + tali, gerbang di sisi barat (arah kantor)
    const post = (x, z) => box(scene, 0.22, 1.1, 0.22, '#6b4a2b', x, 0, z);
    for (let z = M.z0 + 10; z <= M.z1; z += 3) { if (Math.abs(z - M.gate.z) > 3) post(M.x0 + 0.3, z); post(M.x1 - 0.3, z); }
    for (let x = M.x0 + 0.3; x <= M.x1; x += 3) post(x, M.z1 - 0.3);
    box(scene, 0.06, 0.06, M.z1 - M.z0 - 10, '#c9b27a', M.x1 - 0.3, 0.9, (M.z0 + 10 + M.z1) / 2, { cast: false });
    box(scene, M.x1 - M.x0, 0.06, 0.06, '#c9b27a', cx, 0.9, M.z1 - 0.3, { cast: false });
    box(scene, 0.4, 3.2, 0.4, '#6b4a2b', M.x0 + 0.3, 0, M.gate.z - 2.6); box(scene, 0.4, 3.2, 0.4, '#6b4a2b', M.x0 + 0.3, 0, M.gate.z + 2.6);
    const gateTex = canvasTex(512, 96, (g) => { g.fillStyle = '#3a2410'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#ffd77a'; g.font = '800 44px "JetBrains Mono",monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAMBANG EMAS SWEET', 256, 50); });
    box(scene, 0.3, 0.3, 5.6, '#6b4a2b', M.x0 + 0.3, 3.0, M.gate.z);
    [-2.6, 2.6].forEach((dx) => box(scene, 0.22, 3.6, 0.22, '#6b4a2b', M.x0 + 5 + dx, 0, M.gate.z + 4.6));
    box(scene, 5.8, 1.0, 0.14, new THREE.MeshStandardMaterial({ map: gateTex, emissive: '#ffffff', emissiveMap: gateTex, emissiveIntensity: 0.35 }), M.x0 + 5, 2.7, M.gate.z + 4.7);
    // gunung batu dengan urat emas
    const rockM = [new THREE.MeshStandardMaterial({ color: '#6e5b4a', roughness: 0.95, flatShading: true }), new THREE.MeshStandardMaterial({ color: '#5c4a3c', roughness: 0.95, flatShading: true })];
    const goldM = new THREE.MeshStandardMaterial({ color: '#f2c14e', emissive: '#c99a2e', emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.25 });
    [[60, -9.5, 6.5, 0], [84, -9.5, 6.5, 0], [72, -13.5, 6, 2.5], [52.5, -10, 4.5, 0], [89, -6, 4, 0], [66, -12.5, 5, 1], [78, -12.5, 5, 1]].forEach(([x, z, rad, y], i) => {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rad, 1), rockM[i % 2]); m.position.set(x, y + rad * 0.55, z); m.scale.y = 0.85; m.rotation.y = i; m.castShadow = true; m.receiveShadow = true; scene.add(m);
      for (let k = 0; k < 7; k++) { const a = Math.random() * Math.PI - Math.PI / 2, h = Math.random() * rad * 0.8; const v = new THREE.Mesh(new THREE.OctahedronGeometry(0.22 + Math.random() * 0.18), goldM); v.position.set(x + Math.sin(a) * rad * 0.92, y + 0.6 + h, z + Math.cos(a) * rad * 0.92); scene.add(v); }
    });
    // mulut goa + rangka kayu
    const C = M.cave;
    box(scene, 5.4, 4.2, 4.5, '#0b0806', C.x, 0, C.z - 1.6, { m: { roughness: 1 } });
    box(scene, 6.4, 1.6, 3.8, '#5c4a3c', C.x, 4.2, C.z - 1.9);
    [-2.85, 2.85].forEach((dx) => box(scene, 0.45, 4.6, 0.45, '#6b4a2b', C.x + dx, 0, C.z + 0.6));
    box(scene, 6.4, 0.5, 0.5, '#6b4a2b', C.x, 4.4, C.z + 0.6);
    const caveTex = canvasTex(256, 64, (g) => { g.fillStyle = '#2a1a0c'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#ffd77a'; g.font = '800 30px "JetBrains Mono",monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GOA EMAS', 128, 34); });
    box(scene, 2.6, 0.65, 0.08, new THREE.MeshStandardMaterial({ map: caveTex, emissive: '#fff', emissiveMap: caveTex, emissiveIntensity: 0.3 }), C.x, 4.35, C.z + 0.9, { cast: false });
    // lentera
    const lantM = new THREE.MeshStandardMaterial({ color: '#3a2a20', emissive: '#ffb347', emissiveIntensity: 0 });
    const lantG = new THREE.Group(); lantG.visible = false; scene.add(lantG);
    [[C.x - 3.3, C.z + 1], [C.x + 3.3, C.z + 1], [M.desk.x - 3, M.desk.z - 2], [M.desk.x + 3.6, M.desk.z - 2], [M.pile.x + 2.5, M.pile.z - 2], [M.x0 + 1, M.gate.z - 3.2]].forEach(([x, z]) => {
      box(scene, 0.12, 2.6, 0.12, '#3a2a20', x, 0, z);
      const b = new THREE.Mesh(SPH, lantM); b.scale.setScalar(0.22); b.position.set(x, 2.75, z); lantG.add(b);
    });
    lamps.push({ group: lantG, mat: lantM });
    // rel lori dari goa ke tumpukan emas
    const rz0 = C.z - 1, rz1 = M.railEnd;
    [-0.55, 0.55].forEach((dx) => box(scene, 0.08, 0.1, rz1 - rz0, '#8a8f96', C.x + dx, 0.06, (rz0 + rz1) / 2, { m: { metalness: 0.7, roughness: 0.35 } }));
    for (let z = rz0; z <= rz1; z += 1) box(scene, 1.6, 0.06, 0.25, '#5a3d22', C.x, 0.01, z, { cast: false });
    // lori / gerobak emas
    const cart = new THREE.Group(); cart.position.set(C.x, 0, C.z - 1); scene.add(cart);
    const body = new THREE.Group(); body.position.y = 0.32; cart.add(body);
    box(body, 1.3, 0.12, 1.9, '#4b5058', 0, 0.12, 0, { m: { metalness: 0.6, roughness: 0.4 } });
    [[-0.64, 0, 0.06, 1.9], [0.64, 0, 0.06, 1.9]].forEach(([x, z, w, d]) => box(body, w, 0.75, d, '#5a5f66', x, 0.18, z, { m: { metalness: 0.6, roughness: 0.4 } }));
    [-0.95, 0.95].forEach((z) => box(body, 1.34, 0.75, 0.06, '#5a5f66', 0, 0.18, z, { m: { metalness: 0.6, roughness: 0.4 } }));
    const wheels = [];
    [[-0.55, -0.6], [0.55, -0.6], [-0.55, 0.6], [0.55, 0.6]].forEach(([x, z]) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 14), mat('#2a2a2e')); w.rotation.z = Math.PI / 2; w.position.set(x, 0.24, z); cart.add(w); wheels.push(w); });
    const load = new THREE.Group(); load.position.y = 0.9; body.add(load);
    for (let i = 0; i < 14; i++) { const nug = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + Math.random() * 0.1), goldM); nug.position.set((Math.random() - 0.5) * 0.9, Math.random() * 0.25, (Math.random() - 0.5) * 1.4); load.add(nug); }
    MINEX.cart = { g: cart, body, wheels, load, z0: C.z - 1.2, z1: rz1 - 0.5, x: C.x };
    // tumpukan emas di luar goa
    const pile = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 9), new THREE.MeshStandardMaterial({ color: '#f2c14e', emissive: '#a87a1e', emissiveIntensity: 0.35, metalness: 0.85, roughness: 0.28, flatShading: true }));
    pile.position.set(M.pile.x, 0, M.pile.z); pile.castShadow = true; scene.add(pile); MINEX.pile = pile;
    for (let i = 0; i < 9; i++) box(scene, 0.7, 0.22, 0.32, goldM, M.pile.x + 3.2 + (i % 3) * 0.75, Math.floor(i / 3) * 0.23, M.pile.z + 1.8, { m: {} });
    MINEX.pileLbl = addLabel('', new THREE.Vector3(M.pile.x, 3.6, M.pile.z), 'minebd');
    // peti, beliung, kereta dorong (dekorasi)
    [[M.pile.x + 5, M.pile.z - 3], [M.pile.x + 6.2, M.pile.z - 3]].forEach(([x, z]) => box(scene, 1, 0.8, 0.9, '#8a6237', x, 0, z));
    [[C.x - 5, C.z + 3], [C.x + 5.5, C.z + 3.5]].forEach(([x, z], i) => { const h = box(scene, 0.08, 1.4, 0.08, '#6b4a2b', x, 0.1, z); h.rotation.z = 0.5 - i; const hd = box(scene, 0.7, 0.1, 0.1, '#8a8f96', x - 0.3 + i * 0.6, 1.3, z); hd.rotation.z = 0.5 - i; });
    // panggung meja Aurel (open air) + lampu tali
    const D0 = M.desk;
    box(scene, 8, 0.05, 6.2, '#8b6b4a', D0.x + 0.6, 0.005, D0.z - 0.6, { cast: false });
    [[-3.3, -3.6], [4.5, -3.6], [-3.3, 2.4], [4.5, 2.4]].forEach(([dx, dz]) => box(scene, 0.16, 3, 0.16, '#5a3d22', D0.x + dx, 0, D0.z + dz));
    const bulbs = [];
    for (let i = 0; i < 9; i++) { const m = new THREE.MeshStandardMaterial({ color: '#fff', emissive: ['#ffd166', '#ef476f', '#06d6a0', '#118ab2'][i % 4], emissiveIntensity: 1 }); const b = new THREE.Mesh(SPH, m); b.scale.setScalar(0.1); b.position.set(D0.x - 3.3 + i * 0.975, 2.95 - Math.sin(i / 8 * Math.PI) * 0.3, D0.z - 3.6); scene.add(b); bulbs.push(m); }
    animators.push((t) => bulbs.forEach((m, i) => { m.emissiveIntensity = 0.6 + 0.6 * Math.sin(t * 3 + i); }));
    const ag = state.agents.find((a) => a.key === r.agent);
    const ds = deskSet(scene, D0.x, D0.z, ag?.color || '#d6b26e');
    desks[r.agent] = { ...ds, world: new THREE.Vector3(D0.x, 0, D0.z) };
    seats[r.agent] = { x: ds.seat.x, y: 0, z: ds.seat.z, face: 0 };
    // papan akun trading (password tidak ditampilkan)
    const B = M.board;
    [-4.3, 4.3].forEach((dx) => box(scene, 0.25, 5.6, 0.25, '#5a3d22', B.x + dx, 0, B.z));
    const btex = canvasTex(1024, 560, () => {}); MINEX.boardTex = btex;
    box(scene, 8.9, 4.9, 0.2, '#2a1a0c', B.x, 1.0, B.z - 0.05);
    box(scene, 8.6, 4.6, 0.06, new THREE.MeshStandardMaterial({ map: btex, emissive: '#ffffff', emissiveMap: btex, emissiveIntensity: 0.55, roughness: 0.6 }), B.x, 1.15, B.z + 0.08, { cast: false });
    // layar grafik XAUUSD
    [-2.4, 2.4].forEach((dx) => box(scene, 0.18, 4.2, 0.18, '#2a2a30', B.x + 8.6 + dx, 0, B.z));
    wallScreen(scene, 4.6, 2.6, B.x + 8.6, 1.4, B.z + 0.1, 'mine', r.agent);
    // tiang bendera BUY LIMIT / SELL LIMIT di samping meja
    const Fp = M.flag;
    const flag = new THREE.Group(); flag.position.set(Fp.x, 0, Fp.z); flag.visible = false; scene.add(flag);
    cyl(flag, 0.06, 3.4, '#d9d9d9', 0, 0, 0); sph(flag, 0.11, '#f2c14e', 0, 3.45, 0);
    const clothGeo = new THREE.PlaneGeometry(1.5, 0.95, 12, 4); clothGeo.translate(0.75, 0, 0);
    const clothMat = new THREE.MeshStandardMaterial({ color: '#1f9d5c', side: THREE.DoubleSide, roughness: 0.7 });
    const cloth = new THREE.Mesh(clothGeo, clothMat); cloth.position.set(0.04, 2.9, 0); cloth.castShadow = true; flag.add(cloth);
    MINEX.flag = flag; MINEX.cloth = cloth; MINEX.clothMat = clothMat; MINEX.clothBase = clothGeo.attributes.position.array.slice();
    MINEX.limitLbl = addLabel('', new THREE.Vector3(Fp.x + 0.75, 3.75, Fp.z), 'limit');
    const lbl = addLabel(`<em>#${r.no}</em>${S.esc(r.label)}`, new THREE.Vector3(D0.x + 0.6, 0.4, D0.z + 3), 'room');
    lbl.room = r.id; lbl.agent = r.agent;
    if (ag) rooms[r.id].agentName = ag.name;
    addLabel('TAMBANG EMAS', new THREE.Vector3(cx, 0.3, M.z1 - 2), 'small');
  }
  function drawBoard(info, trade) {
    if (!MINEX.boardTex) return;
    const g = MINEX.boardTex.userData.ctx, W = 1024, H = 560;
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1d0f08'); gr.addColorStop(1, '#3a2410'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#d6b26e'; g.lineWidth = 6; g.strokeRect(12, 12, W - 24, H - 24);
    g.fillStyle = '#ffd77a'; g.font = '800 40px "JetBrains Mono",monospace'; g.fillText('CENT TRADING ACCOUNT', 40, 74);
    g.fillStyle = '#e9cf98'; g.font = '700 24px "JetBrains Mono",monospace'; g.fillText('METATRADER 5 · HFM', 40, 110);
    const rows = [['Nickname', info.nickname || '-'], ['Trading account ID (Login)', info.login || '-'], ['Server', info.server || '-'], ['Password', '•••••••••• (aman di .env)']];
    rows.forEach(([a, b], i) => { g.fillStyle = '#c9b48a'; g.font = '600 26px "JetBrains Mono",monospace'; g.fillText(a, 40, 168 + i * 48); g.fillStyle = '#ffffff'; g.font = '800 28px "JetBrains Mono",monospace'; g.fillText(': ' + b, 470, 168 + i * 48); });
    g.fillStyle = 'rgba(214,178,110,.35)'; g.fillRect(40, 352, W - 80, 3);
    const t = trade || {};
    const live = t.mode === 'live';
    g.fillStyle = live ? '#7ff0b3' : '#ffd166'; g.font = '800 26px "JetBrains Mono",monospace';
    g.fillText(`AGENT AUREL #16 · XAUUSD · 24 JAM · ${live ? 'LIVE HFM' : 'MENUNGGU MT5'}`, 40, 396);
    g.fillStyle = '#ffffff'; g.font = '800 34px "JetBrains Mono",monospace';
    const f = /^us[c¢]$/i.test(t.currency || '') ? 0.01 : 1;
    g.fillText(t.equity !== undefined && t.equity !== null ? `Ekuitas ${Number(t.equity).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${t.currency || ''} ≈ $${(t.equity * f).toFixed(2)}` : 'Ekuitas -', 40, 446);
    g.font = '700 26px "JetBrains Mono",monospace'; g.fillStyle = '#e9cf98';
    const p = (t.pending || [])[0], q = (t.positions || [])[0];
    g.fillText(`${t.symbol || 'XAUUSD'} ${t.bid ? t.bid.toFixed(2) : '-'} · ${q ? `${q.type} ${q.lot} ${q.profit >= 0 ? '+' : ''}${Number(q.profit).toFixed(2)}` : p ? `${p.type} @ ${Number(p.price).toFixed(2)}` : (t.open === false ? 'pasar tutup' : 'menunggu setup')}`, 40, 492);
    g.fillStyle = '#c9b48a'; g.font = '600 20px "JetBrains Mono",monospace'; g.fillText(String(t.note || '').slice(0, 70), 40, 530);
    MINEX.boardTex.needsUpdate = true;
  }

  // ---------- Ruangan ----------
  const rooms = {};
  const desks = {};      // agentKey -> referensi meja (strip RGB, layar, printer)
  const lamps = [];      // lampu ruangan (menyala saat malam)
  const seats = {};      // agentKey -> {x,y,z,face}
  const roomByAgent = {};
  L.rooms.forEach((r) => {
    if (r.outdoor) { buildMine(r); return; }
    const y0 = r.level ? DH : 0;
    const g = new THREE.Group(); g.position.set(r.x, y0, r.z); scene.add(g);
    rooms[r.id] = { ...r, group: g, y0 };
    const fl = box(g, r.w - 0.3, 0.05, r.d - 0.3, r.floor, 0, 0.005, 0, { cast: false }); fl.receiveShadow = true;
    const wallC = '#fbf8f2', trim = r.color || '#d9c7a8';
    const backH = r.level ? 3.2 : 2.6, sideH = r.level ? 1.3 : 1.15, frontH = 0.95;
    box(g, r.w, backH, 0.18, wallC, 0, 0, -r.d / 2);
    { const lv = r.level ? 1 : 0, hw = r.w / 2, hd = r.d / 2; addCol(r.x - hw, r.x + hw, r.z - hd - 0.1, r.z - hd + 0.1, lv); addCol(r.x - hw - 0.1, r.x - hw + 0.1, r.z - hd, r.z + hd, lv); addCol(r.x + hw - 0.1, r.x + hw + 0.1, r.z - hd, r.z + hd, lv);
      if (r.id !== 'bullpen') { const dr = r.level ? 3 : 2.6; addCol(r.x - hw, r.x - dr / 2, r.z + hd - 0.08, r.z + hd + 0.08, lv); addCol(r.x + dr / 2, r.x + hw, r.z + hd - 0.08, r.z + hd + 0.08, lv); } }
    box(g, r.w, 0.08, 0.2, trim, 0, backH, -r.d / 2);
    [-1, 1].forEach((s) => { box(g, 0.18, sideH, r.d, wallC, s * r.w / 2, 0, 0); box(g, 0.2, 0.06, r.d, trim, s * r.w / 2, sideH, 0); });
    if (r.id !== 'bullpen') {
      const door = r.level ? 3 : 2.6, seg = (r.w - door) / 2;
      [-1, 1].forEach((s) => { box(g, seg, frontH, 0.14, wallC, s * (door / 2 + seg / 2), 0, r.d / 2); box(g, seg, 0.06, 0.16, trim, s * (door / 2 + seg / 2), frontH, r.d / 2); });
    }
    if (r.agent) {
      const ag = state.agents.find((a) => a.key === r.agent);
      const ds = deskSet(g, 0, -1.6, ag?.color);
      desks[r.agent] = { ...ds, world: new THREE.Vector3(r.x, y0, r.z - 1.6) };
      seats[r.agent] = { x: r.x + ds.seat.x, y: y0, z: r.z + ds.seat.z, face: 0 };
      roomByAgent[r.agent] = r.id;
      wallScreen(g, 3.2, 1.7, 0, 1.0, -r.d / 2 + 0.12, r.theme, r.agent);
      plant(g, -r.w / 2 + 0.8, 0, r.d / 2 - 0.8); plant(g, r.w / 2 - 0.8, 0, r.d / 2 - 0.8, 0.9);
    }
    if (r.id === 'meeting') wallScreen(g, 4.5, 2.2, 0, 0.8, -r.d / 2 + 0.12, 'meeting', null);
    if (r.id === 'boss') wallScreen(g, 3, 1.6, 4, 1.2, -r.d / 2 + 0.12, 'boss', null);
    // Lampu gantung ruangan (hanya terlihat & menyala saat malam)
    const lampMat = new THREE.MeshStandardMaterial({ color: '#3a2a20', emissive: '#ffd59a', emissiveIntensity: 0 });
    const lampG = new THREE.Group(); lampG.visible = false; g.add(lampG);
    const lampY = (r.level ? 3.6 : 3.1);
    [-r.w / 4, r.w / 4].forEach((dx) => {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.28, 18, 1, true), new THREE.MeshStandardMaterial({ color: '#c9a66b', side: THREE.DoubleSide, metalness: 0.5, roughness: 0.35 }));
      shade.position.set(dx, lampY, 0.6); lampG.add(shade);
      const bulb = new THREE.Mesh(SPH, lampMat); bulb.scale.setScalar(0.15); bulb.position.set(dx, lampY - 0.12, 0.6); lampG.add(bulb);
    });
    lamps.push({ group: lampG, mat: lampMat });
    const before = animators.length;
    (themeBuilders[r.theme] || themeBuilders.desk)(g, r.w, r.d, r);
    for (let i = before; i < animators.length; i++) animators[i].busyOf = r.agent ? (() => !!(chars[r.agent] && chars[r.agent].data.busy)) : (() => false);
    const ag = r.agent && state.agents.find((a) => a.key === r.agent);
    const lbl = addLabel(`${r.no ? `<em>#${r.no}</em>` : ''}${S.esc(r.label)}`, new THREE.Vector3(r.x, y0 + 0.4, r.z + r.d / 2 + 0.2), 'room');
    lbl.room = r.id; lbl.agent = r.agent;
    if (ag) rooms[r.id].agentName = ag.name;
  });
  // Lampu malam: sedikit PointLight besar (hemat GPU), lampu ruangan memakai emissive
  const nightLights = [];
  [[0, 6, 8, 46], [0, 6, 21.5, 46], [0, 6, 35, 46], [0, 6, 48.5, 50], [0, DH + 4.5, -10.5, 50], [-26, DH + 4, -10.5, 22], [26, DH + 4, -10.5, 22], [62, 6, 9, 40], [72, 5, 1, 24], [75, 6, 27, 34]].forEach(([x, y, z, d]) => {
    const pl = new THREE.PointLight('#ffcf8a', 0, d, 1.2); pl.position.set(x, y, z); scene.add(pl); nightLights.push(pl);
  });
  seats.kevin = { x: 26, y: DH, z: rooms.boss.z - 0.2 - 1.3, face: 0 };

  // Spot rapat & lounge
  const meetingSeats = [];
  const MR = rooms.meeting;
  for (let i = 0; i < 7; i++) meetingSeats.push({ x: MR.x - 6 + i * 2, y: DH, z: MR.z - 1.8, face: 0, sit: true });
  for (let i = 0; i < 7; i++) meetingSeats.push({ x: MR.x - 6 + i * 2, y: DH, z: MR.z + 1.8, face: Math.PI, sit: true });
  meetingSeats.push({ x: MR.x - 7.5, y: DH, z: MR.z, face: Math.PI / 2, sit: true });
  const meetingHead = { x: MR.x + 7.5, y: DH, z: MR.z, face: -Math.PI / 2, sit: true };
  const LR = rooms.lounge;
  const loungeSpots = [];
  for (let i = 0; i < 6; i++) loungeSpots.push({ x: LR.x - 5 + i * 1, y: DH, z: LR.z - 2.35, face: 0, sit: true });
  for (let i = 0; i < 3; i++) loungeSpots.push({ x: LR.x - 6, y: DH, z: LR.z - 1.5 + i * 1, face: Math.PI / 2, sit: true });
  for (let i = 0; i < 12; i++) loungeSpots.push({ x: LR.x + 1 + (i % 4) * 1.3, y: DH, z: LR.z + 0.2 + Math.floor(i / 4) * 1.2, face: Math.PI + (i % 2 ? 0.6 : -0.6), sit: false });

  // ---------- Rute jalan (lorong -> tangga -> mezzanine) ----------
  const NZ = L.northZ, WZ = D.walkZ, CO = L.corridorOffset;
  const hub = { x: 24.2, y: 0, z: NZ };
  const nearestAisle = (x) => L.aisles.reduce((b, a) => (Math.abs(a - x) < Math.abs(b - x) ? a : b), L.aisles[0]);
  function areaOf(p) {
    for (const r of L.rooms) {
      const onLevel = r.level ? p.y > DH / 2 : p.y <= DH / 2;
      if (onLevel && Math.abs(p.x - r.x) <= r.w / 2 && Math.abs(p.z - r.z) <= r.d / 2) return r.id;
    }
    return p.y > DH / 2 ? 'deck' : 'floor';
  }
  // Keluar dari ruangan: hindari meja (geser ke samping dulu), lalu lewat pintu depan
  function exitNodes(r, p) {
    const y = r.level ? DH : 0, out = [];
    if (r.id !== 'bullpen' && p.z < r.z - 1) { const side = r.id === 'boss' ? 2.6 : 2; out.push({ x: r.x + side, y, z: p.z }, { x: r.x + side, y, z: r.z + 0.8 }); }
    const dx = r.id === 'bullpen' ? p.x : r.x;
    out.push({ x: dx, y, z: r.z + r.d / 2 - 0.9 });
    return out;
  }
  const STAIR = [{ x: 37.8, y: DH, z: WZ }, { x: 37.8, y: DH, z: -2.9 }, { x: 36, y: DH, z: -2.9 }, { x: 25, y: 0, z: -2.9 }, { x: 24.2, y: 0, z: -1.2 }, hub];
  function chain(p) {
    const area = areaOf(p);
    if (area === 'room_xau') return [{ x: L.mine.gate.x, y: 0, z: NZ }, { x: F.x1 - 1.2, y: 0, z: NZ }, hub];
    if (area === 'deck') return [{ x: p.x, y: DH, z: WZ }, ...STAIR];
    if (area === 'floor') return [{ x: p.x, y: 0, z: NZ }, hub];
    const r = rooms[area];
    if (r.level) return [...exitNodes(r, p), { x: r.x, y: DH, z: WZ }, ...STAIR];
    const zc = r.z + CO, xa = nearestAisle(r.id === 'bullpen' ? p.x : r.x + 0.01);
    const ex = exitNodes(r, p), lastX = ex[ex.length - 1].x;
    return [...ex, { x: lastX, y: 0, z: zc }, { x: xa, y: 0, z: zc }, { x: xa, y: 0, z: NZ }, hub];
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.z - b.z) < 0.01 && Math.abs(a.y - b.y) < 0.01;
  function route(from, to) {
    const fa = areaOf(from), ta = areaOf(to);
    if (fa === ta && fa !== 'floor' && fa !== 'deck') return [to];
    const fr = rooms[fa], tr = rooms[ta];
    if (fr && tr && fr.level && tr.level) {
      const ea = exitNodes(fr, from), eb = exitNodes(tr, to);
      return [...ea, { x: fr.x, y: DH, z: WZ }, { x: tr.x, y: DH, z: WZ }, ...eb.reverse(), to];
    }
    if (fr && tr && !fr.level && !tr.level && Math.abs(fr.z - tr.z) < 0.1 && fr.id !== 'bullpen') {
      const ea = exitNodes(fr, from), eb = exitNodes(tr, to);
      return [...ea, { x: fr.x, y: 0, z: fr.z + CO }, { x: tr.x, y: 0, z: tr.z + CO }, ...eb.reverse(), to];
    }
    const A = chain(from), B = chain(to);
    let ia = A.length - 1, ib = B.length - 1;
    for (let i = 0; i < A.length; i++) { const j = B.findIndex((b) => same(b, A[i])); if (j >= 0) { ia = i; ib = j; break; } }
    return [...A.slice(0, ia + 1), ...B.slice(0, ib).reverse(), to];
  }

  // ---------- Karakter ----------
  const faceCache = new Map();
  function faceTexture(photo, skin, seedKey) {
    const tex = canvasTex(128, 128, (g) => {
      g.fillStyle = skin; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#2a1d14'; g.beginPath(); g.arc(42, 58, 7, 0, TAU); g.arc(86, 58, 7, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(44, 56, 2.2, 0, TAU); g.arc(88, 56, 2.2, 0, TAU); g.fill();
      g.strokeStyle = '#8a4a3a'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.arc(64, 78, 16, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
      g.fillStyle = 'rgba(240,120,110,.35)'; g.beginPath(); g.arc(30, 78, 8, 0, TAU); g.arc(98, 78, 8, 0, TAU); g.fill();
    });
    if (photo) {
      const img = new Image();
      img.onload = () => {
        const g = tex.userData.ctx, s = Math.min(img.width, img.height);
        g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2 * 0.6, s, s, 0, 0, 128, 128);
        tex.needsUpdate = true;
      };
      img.src = photo;
    }
    return tex;
  }

  const chars = {}; // key -> char
  const clickables = [];
  function makeChar(a, kind = 'agent') {
    const h = hash(a.key);
    const skin = SKIN[h % SKIN.length], hair = HAIR[(h >> 3) % HAIR.length];
    const shirt = a.color || '#8aa0b5';
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const pants = kind === 'boss' ? '#1f2937' : '#3b4252';
    const legs = [-0.15, 0.15].map((x) => {
      const pv = new THREE.Group(); pv.position.set(x, 0.72, 0); body.add(pv);
      box(pv, 0.24, 0.72, 0.28, pants, 0, -0.72, 0);
      box(pv, 0.26, 0.12, 0.36, '#2a241d', 0, -0.72, 0.04);
      return pv;
    });
    box(body, 0.66, 0.74, 0.38, shirt, 0, 0.72, 0);
    if (kind === 'boss') { box(body, 0.68, 0.76, 0.02, '#1f2937', 0, 0.71, 0.2); box(body, 0.12, 0.5, 0.03, '#c9a227', 0, 0.9, 0.215); }
    const arms = [-0.43, 0.43].map((x) => {
      const pv = new THREE.Group(); pv.position.set(x, 1.4, 0); body.add(pv);
      box(pv, 0.2, 0.62, 0.22, shirt, 0, -0.62, 0); box(pv, 0.18, 0.14, 0.2, skin, 0, -0.74, 0);
      return pv;
    });
    const head = new THREE.Group(); head.position.set(0, 1.5, 0); body.add(head);
    const ft = faceTexture(a.photo, skin, a.key);
    const skinM = mat(skin);
    const hm = new THREE.Mesh(BOX, [skinM, skinM, skinM, skinM, new THREE.MeshStandardMaterial({ map: ft, roughness: 0.8 }), skinM]);
    hm.scale.set(0.54, 0.54, 0.5); hm.position.y = 0.29; hm.castShadow = true; head.add(hm);
    box(head, 0.58, 0.16, 0.54, hair, 0, 0.5, -0.02);
    box(head, 0.58, 0.38, 0.12, hair, 0, 0.22, -0.24);
    if (kind === 'boss') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.2, 5, 1, true), mat('#f2c14e', { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
      crown.position.y = 0.76; head.add(crown);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 32), new THREE.MeshBasicMaterial({ color: '#e0743a', transparent: true, opacity: 0, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; root.add(ring);
    root.traverse((o) => { if (o.isMesh) o.userData.charKey = a.key; });
    clickables.push(root);
    scene.add(root);
    const tag = addLabel('', new THREE.Vector3(), 'tag');
    const bubble = addLabel('', new THREE.Vector3(), 'bubble');
    const c = { key: a.key, data: a, kind, root, body, legs, arms, head, ring, tag, bubble, path: [], pose: 'stand', seat: null, walkT: 0, wanderAt: performance.now() + 4000 + Math.random() * 8000, speed: 3.4 + Math.random() * 0.6, ft };
    tag.char = c; bubble.char = c;
    chars[a.key] = c;
    return c;
  }
  function chairFor(spot) {
    // kursi tambahan untuk rekrutan
    const g = scene;
    box(g, 0.7, 0.1, 0.65, '#3b3f4a', spot.x, spot.y + 0.42, spot.z - 0.05);
    box(g, 0.7, 0.75, 0.1, '#3b3f4a', spot.x, spot.y + 0.5, spot.z - 0.37);
  }

  const recruitDesks = new Map();
  function recruitSeat(slot) {
    const B = rooms.bullpen; const perRow = 10;
    const x = B.x - B.w / 2 + 5 + (slot % perRow) * 7.4, z = B.z - 1.6 + Math.floor(slot / perRow) * 3.4;
    if (!recruitDesks.has(slot)) {
      const g = new THREE.Group(); scene.add(g);
      const ds = deskSet(g, x, z, '#8aa0b5');
      // bilik terpisah: sekat kiri, kanan, dan belakang
      [-3.4, 3.4].forEach((dx) => box(g, 0.1, 1.4, 3.6, '#3a2a31', x + dx, 0, z - 0.4));
      box(g, 6.9, 1.4, 0.1, '#3a2a31', x, 0, z - 2.2);
      recruitDesks.set(slot, { g, seat: { x: ds.seat.x, y: 0, z: ds.seat.z, face: 0 }, ds });
    }
    return recruitDesks.get(slot).seat;
  }

  function placeAt(c, spot) {
    c.root.position.set(spot.x, spot.y, spot.z); c.root.rotation.y = spot.face || 0; c.path = []; c.seatSpot = spot; c.pose = spot.sit ? 'sit' : 'stand';
    c.root.visible = !spot.hide;
  }

  // ---------- Penentuan tujuan ----------
  const EXIT = { x: F.x0 + 0.6, y: 0, z: NZ, face: -Math.PI / 2, sit: false, hide: true };
  let mode = state.mode || 'kerja';
  let meeting = state.meeting;
  const agentList = () => Object.values(chars).filter((c) => c.kind === 'agent');
  function targetFor(c) {
    const a = c.data;
    if (c.kind === 'npc' || c.kind === 'guard' || c.kind === 'miner' || c.kind === 'player' || c.kind === 'visitor') return null;
    if (a.type === 'trader') return seats[a.key] ? { ...seats[a.key], sit: true } : null; // kerja 24 jam di tambang
    if (mode === 'pulang' && !a.busy) return EXIT;
    if (c.kind === 'boss') return mode === 'rapat' ? meetingHead : (c.patrol || { ...seats.kevin, sit: true });
    const list = agentList().filter((x) => x.data.type === 'builtin').sort((p, q) => (p.data.no || 99) - (q.data.no || 99));
    const recruits = agentList().filter((x) => x.data.type === 'recruit');
    if (mode === 'rapat') {
      const i = list.indexOf(c);
      if (i >= 0 && i < meetingSeats.length) return meetingSeats[i];
      const j = recruits.indexOf(c);
      return { x: MR.x - 6 + (j % 7) * 2, y: DH, z: MR.z - 3.1, face: 0, sit: false };
    }
    if (mode === 'istirahat') {
      const all = [...list, ...recruits]; const i = all.indexOf(c);
      return loungeSpots[i % loungeSpots.length];
    }
    if (a.type === 'recruit') return { ...recruitSeat(a.slot || 0), sit: true };
    const s = seats[a.key];
    if (!s) return null;
    if (a.busy) return { ...s, sit: true };
    if (c.wandering) return c.wandering;
    return { ...s, sit: true };
  }

  function goTo(c, spot) {
    if (!spot) return;
    const cur = { x: c.root.position.x, y: c.root.position.y, z: c.root.position.z };
    const last = c.path.length ? c.path[c.path.length - 1] : c.seatSpot;
    if (last && same(last, spot) && (last.face || 0) === (spot.face || 0)) return;
    c.root.visible = true;
    c.path = route(cur, spot);
    c.path[c.path.length - 1] = spot;
    c.seatSpot = null;
    c.pose = 'walk';
  }
  function retarget(c) { const t = targetFor(c); if (t) goTo(c, t); }
  const retargetAll = () => Object.values(chars).forEach(retarget);

  // ---------- Membuat semua karakter ----------
  function syncRoster(st) {
    const keys = new Set(st.agents.map((a) => a.key));
    Object.values(chars).forEach((c) => {
      if (c.kind === 'agent' && !keys.has(c.key)) { scene.remove(c.root); c.tag.el.remove(); c.bubble.el.remove(); clickables.splice(clickables.indexOf(c.root), 1); delete chars[c.key]; }
    });
    st.agents.forEach((a) => {
      if (chars[a.key]) { Object.assign(chars[a.key].data, a); return; }
      const c = makeChar(a, 'agent');
      const t = targetFor(c); if (t) placeAt(c, t);
    });
  }
  syncRoster(state);
  const boss = makeChar({ ...state.boss, key: 'kevin', color: '#2b2b2b' }, 'boss'); placeAt(boss, targetFor(boss));
  const npcs = (state.npcs || []).map((n) => { const c = makeChar({ ...n, color: n.color }, 'npc'); placeAt(c, { x: -35, y: 0, z: -0.3, face: 0 }); return c; });
  // 2 security bersenjata patroli keliling kantor + tambang, 1 penambang mendorong lori emas
  const PER = (L.perimeter || []).map(([x, z]) => ({ x, y: 0, z }));
  function perimeterLoop(dir) { const out = []; for (let i = 0; i < PER.length; i++) { const a = PER[i], b = PER[(i + 1) % PER.length]; for (let k = 0; k < 4; k++) out.push({ x: lerp(a.x, b.x, k / 4), y: 0, z: lerp(a.z, b.z, k / 4) }); } return dir > 0 ? out : out.reverse(); }
  const guards = PER.length ? [{ key: 'satpam1', name: 'Bima', role: 'Security' }, { key: 'satpam2', name: 'Joko', role: 'Security' }].map((g, i) => {
    const c = makeChar({ ...g, color: '#1e2a44' }, 'guard');
    const loop = perimeterLoop(i ? -1 : 1); c.loop = loop; c.li = i ? Math.floor(loop.length / 2) : 0; c.speed = 2.3;
    placeAt(c, loop[c.li]);
    box(c.head, 0.62, 0.12, 0.6, '#141b2d', 0, 0.6, 0.02); box(c.head, 0.62, 0.04, 0.3, '#141b2d', 0, 0.56, 0.38);
    box(c.body, 0.3, 0.12, 0.04, '#d6b26e', -0.15, 1.15, 0.2);
    const gun = new THREE.Group(); gun.position.set(0.05, 1.0, 0.3); gun.rotation.set(0.15, 0, -0.75); c.body.add(gun);
    box(gun, 0.1, 0.12, 1.15, '#1b1b1f', 0, 0, 0); box(gun, 0.13, 0.2, 0.35, '#3a2a20', 0, -0.05, -0.62); box(gun, 0.06, 0.2, 0.08, '#1b1b1f', 0, -0.2, 0.05); box(gun, 0.05, 0.05, 0.4, '#111', 0, 0.03, 0.75);
    c.gun = gun; c.wanderAt = performance.now() + 9000 + Math.random() * 12000;
    return c;
  }) : [];
  if (L.mine) {
    const m = makeChar({ key: 'penambang', name: 'Ujang', role: 'Penambang', color: '#c9772e' }, 'miner');
    box(m.head, 0.64, 0.2, 0.62, '#f2c14e', 0, 0.6, 0); const lampM = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff3b0', emissiveIntensity: 1.5 }); box(m.head, 0.14, 0.12, 0.06, lampM, 0, 0.62, 0.32);
    m.speed = 0; MINEX.miner = m; m.root.visible = false;
  }
  retargetAll();

  // ---------- Kamera: tampilan & kontrol ----------
  const views = [{ id: 'all', label: 'Seluruh kantor', target: new THREE.Vector3(0, 0, (F.z0 + F.z1) / 2 - 3.5), size: 100 },
    { id: 'atas', label: 'Lantai atas · Lounge, Rapat, Ruang Kevin', target: new THREE.Vector3(0, DH, -11.5), size: 84 }];
  L.rooms.filter((r) => r.agent).sort((a, b) => a.no - b.no).forEach((r) => views.push(r.outdoor
    ? { id: r.id, label: `#${r.no} ${r.label}`, agent: r.agent, target: new THREE.Vector3(L.mine.desk.x + 10, 0, L.mine.desk.z - 3.5), size: 50 }
    : { id: r.id, label: `#${r.no} ${r.label}`, agent: r.agent, target: new THREE.Vector3(r.x, 0, r.z - 0.5), size: 20 }));
  if (L.mine) views.splice(1, 0, { id: 'kompleks', label: 'Kantor + Tambang Emas', target: new THREE.Vector3(24, 0, 18), size: 150 });
  ['lounge', 'meeting', 'boss', 'bullpen'].forEach((id) => { const r = rooms[id]; views.push({ id, label: r.label, target: new THREE.Vector3(r.x, r.y0, r.z), size: id === 'bullpen' ? 84 : 28 }); });

  const DIR = new THREE.Vector3(0, Math.sin(0.92), Math.cos(0.92)); // pitch ~53°
  const cam = { target: views[0].target.clone(), dist: 100, yaw: 0, pitch: 0.92, from: null, to: null, t: 1 };
  function distFor(size) {
    const aspect = Math.max(0.5, container.clientWidth / Math.max(1, container.clientHeight));
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const byW = (size / 2) / (Math.tan(vfov / 2) * aspect);
    const byH = (size * 0.62 / 2) / Math.tan(vfov / 2);
    return Math.max(byW, byH) * 1.02;
  }
  let currentView = views[0];
  function flyTo(target, dist, yaw = 0, pitch = 0.92, instant = false, dur = 0.9) {
    cam.from = { target: cam.target.clone(), dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch };
    cam.to = { target: target.clone ? target.clone() : new THREE.Vector3(target.x, target.y, target.z), dist, yaw, pitch };
    cam.dur = dur; cam.t = instant ? 1 : 0;
    if (instant) { cam.target.copy(cam.to.target); cam.dist = dist; cam.yaw = yaw; cam.pitch = pitch; }
  }
  function focus(id, instant = false) {
    const v = views.find((x) => x.id === id) || views[0];
    currentView = v;
    flyTo(v.target, distFor(v.size), 0, 0.92, instant);
    labels.forEach((l) => l.room && l.el.classList.toggle('active', l.room === v.id));
    opts.onView && opts.onView(v);
    return v;
  }

  // Kontrol: geser (drag), zoom (scroll / pinch), klik agen
  const el = renderer.domElement;
  let drag = null, moved = 0;
  const pointers = new Map();
  el.addEventListener('contextmenu', (e) => { if (X.mode) e.preventDefault(); });
  el.addEventListener('pointerdown', (e) => {
    if (X.mode === 'drone') { if (!document.pointerLockElement) el.requestPointerLock && el.requestPointerLock(); return; }
    if (X.mode && e.button === 2) { el.setPointerCapture(e.pointerId); X.rdrag = { x: e.clientX, y: e.clientY, moved: 0 }; return; }
    if (X.mode === 'player' && e.button === 0) { el.setPointerCapture(e.pointerId); drag = null; X.ldown = { x: e.clientX, y: e.clientY }; return; }
    el.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = { x: e.clientX, y: e.clientY }; moved = 0; });
  el.addEventListener('pointermove', (e) => {
    if (X.rdrag) { const dx = e.clientX - X.rdrag.x, dy = e.clientY - X.rdrag.y; X.rdrag.moved += Math.abs(dx) + Math.abs(dy); X.rdrag.x = e.clientX; X.rdrag.y = e.clientY; cam.yaw -= dx * 0.006; cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * 0.004, 0.08, 1.45); cam.t = 1; return; }
    if (pointers.has(e.pointerId)) {
      const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const d1 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        if (d0 > 0 && opts.interactive !== false) { cam.dist = THREE.MathUtils.clamp(cam.dist * d0 / d1, 12, 260); cam.t = 1; }
        return;
      }
    }
    if (!drag) { hover(e); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
    drag = { x: e.clientX, y: e.clientY };
    if (opts.interactive === false) return;
    const k = cam.dist / container.clientHeight * 0.85;
    cam.target.x -= dx * k; cam.target.z -= dy * k * 1.25; cam.t = 1;
  });
  const up = (e) => {
    if (X.rdrag && e.button === 2) { const mv = X.rdrag.moved; X.rdrag = null; if (mv < 6 && X.mode === 'player') moveClick(e); return; }
    if (X.ldown) { const ld = X.ldown; X.ldown = null; if (Math.abs(e.clientX - ld.x) + Math.abs(e.clientY - ld.y) < 6) click(e); return; }
    pointers.delete(e.pointerId); if (drag && moved < 6) click(e); drag = null;
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { if (opts.interactive === false) return; e.preventDefault(); if (X.mode === 'drone') { X.drone.speed = THREE.MathUtils.clamp(X.drone.speed * Math.exp(-e.deltaY * 0.001), 3, 60); return; } cam.dist = THREE.MathUtils.clamp(cam.dist * Math.exp(e.deltaY * 0.0012), X.mode === 'player' ? 3.5 : 6, X.mode === 'player' ? 45 : 260); cam.t = 1; }, { passive: false });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(e) {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(clickables, true)[0];
    return hit ? chars[hit.object.userData.charKey] : null;
  }
  let hovered = null;
  function hover(e) {
    const c = pick(e);
    if (hovered && hovered !== c) hovered.hover = false;
    hovered = c; if (c) c.hover = true;
    el.style.cursor = c ? 'pointer' : 'grab';
  }
  function click(e) {
    const c = pick(e);
    if (c && opts.onAgentClick) opts.onAgentClick(c.key, c.data, c.kind);
    else if (!c && opts.onEmptyClick) opts.onEmptyClick();
  }
  let selected = null;
  function select(key) { Object.values(chars).forEach((c) => { c.selected = c.key === key; }); selected = key; }

  // Label ruangan bisa diklik untuk fokus
  overlay.addEventListener('click', (e) => { const l = e.target.closest('.o3d-label.room'); if (l) { const lab = labels.find((x) => x.el === l); if (lab) focus(lab.room); } });

  // ---------- Update dari server ----------
  function updateAgent(d) {
    const c = chars[d.key]; if (!c) return;
    const wasBusy = c.data.busy;
    Object.assign(c.data, d);
    if (d.busy && !wasBusy) c.wandering = null;
    retarget(c);
  }
  function setOffice(o) {
    const changed = o.mode !== mode;
    mode = o.mode; meeting = o.meeting;
    if (changed) { Object.values(chars).forEach((c) => { c.wandering = null; }); boss.patrol = null; boss.pendingSay = null; boss.wanderAt = performance.now() + 5000; retargetAll(); }
  }
  S.on('agent', updateAgent);
  S.on('office', setOffice);
  S.on('roster', async () => { const st = await S.api('/api/state'); syncRoster(st); retargetAll(); });

  // ---------- Bos keliling, security, penambang ----------
  function sayLocal(c, text, ms = 4500) { if (!c) return; c.data.say = text; const tx = text; setTimeout(() => { if (c.data.say === tx) c.data.say = null; }, ms); }
  const GUARD_LINES = ['Patroli area kantor, aman.', 'Tambang emas aman terkendali.', 'Gerbang timur sudah dicek.', 'Jangan ada yang dekati tumpukan emas!', 'Lapor, situasi kondusif.', 'Shift jaga 24 jam, siap!'];
  const REPLY = ['Siap Bos!', 'Lagi dikerjakan, Bos.', 'Aman Bos, beres kok.', 'Iya Bos, tancap gas!', 'Hehe, siap laksanakan.', 'Dikit lagi selesai, Bos.'];
  const TAUNT = {
    _idle: ['Kok bengong? Kerja, kerja!', 'Gaji jalan terus, kerjaan jalan nggak?', 'Mejanya rapi, kerjaannya mana?'],
    _gen: ['Kerja yang bener ya, saya pantau terus.', 'Bagus, lanjutkan. Jangan kendor!', 'Hari ini target harus tembus!', 'Jangan main HP di jam kerja ya.', 'Cepetan dikit, keong aja lebih gesit.'],
    aurel: ['Aurel, jangan sampai floating minus ya!', 'Buy limit-nya kejauhan tuh, emasnya keburu kabur.', 'SL dipasang kan? Jangan nekat!', 'Emasnya mana? Lori baru jalan segitu?'],
    dimas: ['Dimas, resi jangan telat! Pembeli nungguin.', 'Printer kok sepi? Jualan dong!'],
    sari: ['Sari, chat pembeli dibalas cepat ya, jangan dibaca doang.'],
    bayu: ['Bayu, stok habis kok baru tahu?'],
    mira: ['Mira, iklannya jangan bakar duit doang ya.'],
    tomi: ['Tomi, grafiknya kok turun? Naikin!'],
    wucing: ['Wucing, bug-nya ketemu belum? Jangan ngumpet di kode.'],
    chelsea: ['Chelsea, review yang tegas! Yang jelek balikin.'],
    raka: ['Raka, ada celah? Jangan sampai dibobol orang.'],
    robot: ['Robo, deploy jangan Jumat sore ya.'],
    kamala: ['Kamala, backlog-nya kepanjangan, pangkas!'],
    nola: ['Nola, datanya jangan dobel lagi ya.'],
    _pile: ['Emasnya kurang banyak! Tambang lagi!', 'Tumpukan emas ini harus dua kali lipat besok.'],
    _cave: ['Ujang, gerobaknya jangan lelet!', 'Goa ini harus produktif 24 jam!']
  };
  let bossStop = 0;
  function bossNext(c) {
    bossStop++;
    const builtins = agentList().filter((x) => x.data.type === 'builtin' && desks[x.key]);
    let spot = null, text = '', agent = null;
    if (bossStop % 6 === 0) { c.patrol = null; c.wanderAt = performance.now() + 15000; retarget(c); return; }
    const M = L.mine, r = Math.random();
    if (M && (bossStop % 3 === 0)) {
      if (r < 0.55) { spot = { x: M.desk.x + 0.9, y: 0, z: M.desk.z + 1.5, face: Math.PI }; agent = 'aurel'; }
      else if (r < 0.8) { spot = { x: M.pile.x - 2.2, y: 0, z: M.pile.z + 1.6, face: Math.PI / 2 + 0.5 }; text = TAUNT._pile[Math.floor(Math.random() * TAUNT._pile.length)]; }
      else { spot = { x: M.cave.x - 3.6, y: 0, z: M.cave.z + 4.5, face: Math.PI - 0.4 }; text = TAUNT._cave[Math.floor(Math.random() * TAUNT._cave.length)]; }
    } else if (builtins.length) {
      const a = builtins[Math.floor(Math.random() * builtins.length)], d = desks[a.key];
      spot = { x: d.world.x + 0.9, y: d.world.y, z: d.world.z + 1.45, face: Math.PI }; agent = a.key;
    }
    if (!spot) return;
    if (agent) {
      const a = chars[agent] && chars[agent].data;
      const idle = a && !a.busy && !a.step;
      const pool = idle && a.type !== 'trader' ? TAUNT._idle : (TAUNT[agent] && Math.random() < 0.7 ? TAUNT[agent] : TAUNT._gen);
      text = pool[Math.floor(Math.random() * pool.length)];
    }
    c.patrol = spot; c.pendingSay = { text, agent }; c.wanderAt = Infinity;
    goTo(c, spot);
  }
  // Lori emas: keluar goa → tuang emas ke tumpukan → kembali ke goa (penambang mendorong)
  let cartCycle = -1, pileShown = -1;
  function animateMine(t, dt) {
    const K = MINEX.cart; if (!K) return;
    const P = 38, k = t % P, cyc = Math.floor(t / P);
    let z = K.z0, full = true, tilt = 0, moving = false, dir = 1;
    if (k < 4) { z = K.z0; }
    else if (k < 14) { z = lerp(K.z0, K.z1, (k - 4) / 10); moving = true; }
    else if (k < 18.5) { z = K.z1; const q = (k - 14) / 4.5; tilt = Math.sin(Math.min(1, q * 1.6) * Math.PI / 2) * (q < 0.75 ? 1 : (1 - q) * 4); full = q < 0.35; }
    else if (k < 28.5) { z = lerp(K.z1, K.z0, (k - 18.5) / 10); full = false; moving = true; dir = -1; }
    else { z = K.z0; full = false; }
    const dz = z - K.g.position.z;
    K.g.position.z = z; K.body.rotation.z = -tilt * 0.9; K.load.visible = full;
    K.wheels.forEach((w) => { w.rotation.x += dz / 0.22; });
    K.g.visible = z > K.z0 + 0.4 || k < 2 || k > 36;
    if (cyc !== cartCycle && k > 16) { cartCycle = cyc; MINEX.pileN = MINEX.pileN >= 16 ? 6 : MINEX.pileN + 1; }
    const s = 0.9 + MINEX.pileN * 0.12; MINEX.pile.scale.set(s * 1.25, s * 0.85, s * 1.25); MINEX.pile.position.y = s * 0.85 / 2;
    if (pileShown !== MINEX.pileN) { pileShown = MINEX.pileN; MINEX.pileLbl.el.textContent = `EMAS DITAMBANG · ${MINEX.pileN} LORI`; MINEX.pileLbl.pos.y = s * 0.85 + 0.8; }
    const m = MINEX.miner; if (!m) return;
    const inCave = z < K.z0 + 1.2 && (k < 5 || k > 27.5);
    m.root.visible = !inCave;
    let mz = dir > 0 ? z - 1.7 : z + 1.7, mx = K.x;
    if (k >= 14 && k < 18.5) { const q = Math.min(1, Math.max(0, (k - 16.5) / 2)); mx = K.x - 1.3 * Math.sin(q * Math.PI); mz = z - 1.7 + 3.4 * q; moving = q > 0 && q < 1; }
    m.root.position.set(mx, 0, mz); m.root.rotation.y = dir > 0 && k < 16.5 ? 0 : Math.PI;
    m.moving = moving; m.path = [];
    if (k > 15 && k < 15.1 && !m.data.say) sayLocal(m, ['Emas masuk lagi!', 'Satu lori lagi, Bos!', 'Berat juga nih emasnya.'][cyc % 3], 3000);
  }
  // Bendera BUY LIMIT / SELL LIMIT di meja Aurel + papan akun
  let boardInfo = { nickname: '', login: '', server: '' }, boardAt = 0, boardKey = '';
  if (L.mine) S.api('/api/trading/board').then((b) => { boardInfo = b; boardKey = ''; }).catch(() => {});
  function animateFlag(t) {
    if (!MINEX.flag) return;
    const c = chars.aurel, tr = c && c.data.trade;
    const pend = tr && tr.pending ? tr.pending.filter((p) => p.own !== false) : [], pos = tr && tr.positions ? tr.positions.filter((p) => p.own !== false) : [];
    const show = pend.length > 0 || pos.length > 0;
    MINEX.flag.visible = show; MINEX.limitLbl.hidden = !show;
    if (show) {
      const p = pend[0], q = pos[0];
      const kind = q ? 'pos' : /BUY/.test(p.type) ? 'buy' : 'sell';
      MINEX.clothMat.color.set(kind === 'buy' ? '#1f9d5c' : kind === 'sell' ? '#d13a4f' : '#c9a227');
      const html = q ? `<b>${q.type} ${q.lot}</b><small>${q.profit >= 0 ? '+' : ''}${Number(q.profit).toFixed(2)} ${S.esc(tr.currency || '')}</small>` : `<b>${S.esc(p.type)}</b><small>${p.lot} @ ${Number(p.price).toFixed(2)}${pend.length > 1 ? ` · +${pend.length - 1}` : ''}</small>`;
      if (MINEX.limitLbl.html !== html + kind) { MINEX.limitLbl.el.innerHTML = html; MINEX.limitLbl.el.className = 'o3d-label limit ' + kind; MINEX.limitLbl.html = html + kind; }
      const a = MINEX.cloth.geometry.attributes.position, base = MINEX.clothBase;
      for (let i = 0; i < a.count; i++) { const x = base[i * 3]; a.array[i * 3 + 2] = Math.sin(x * 3.2 - t * 6) * 0.12 * x; }
      a.needsUpdate = true;
    }
    const key = JSON.stringify([boardInfo, tr && [tr.mode, tr.equity, tr.bid, tr.note, pend.length, pos.length, pos[0] && pos[0].profit]]);
    if (key !== boardKey && performance.now() - boardAt > 1500) { boardKey = key; boardAt = performance.now(); drawBoard(boardInfo, tr); }
  }

  // ---------- Loop animasi ----------
  const tmp = new THREE.Vector3();
  let last = performance.now(), screenAcc = 0, running = true;
  function stepChar(c, dt, t) {
    const p = c.root.position;
    if (c.path.length) {
      const wp = c.path[0];
      tmp.set(wp.x - p.x, wp.y - p.y, wp.z - p.z);
      const dist = tmp.length();
      const stepLen = c.speed * dt;
      if (dist <= stepLen) {
        p.set(wp.x, wp.y, wp.z); c.path.shift();
        if (!c.path.length) { c.seatSpot = wp; c.pose = wp.sit ? 'sit' : 'stand'; c.faceTo = wp.face || 0; if (wp.hide) c.root.visible = false; }
      } else {
        p.addScaledVector(tmp, stepLen / dist);
        const ang = Math.atan2(tmp.x, tmp.z);
        if (Math.abs(tmp.x) + Math.abs(tmp.z) > 0.01) c.root.rotation.y = lerpAngle(c.root.rotation.y, ang, Math.min(1, dt * 10));
      }
      c.walkT += dt * 9;
    } else if (c.faceTo !== undefined) {
      c.root.rotation.y = lerpAngle(c.root.rotation.y, c.faceTo, Math.min(1, dt * 8));
    }
    // Pose
    const walking = c.path.length > 0 || !!c.moving;
    if (c.moving) c.walkT += dt * 9;
    const sit = !walking && c.pose === 'sit';
    const TYPING = ['tugas', 'monitor', 'cek_toko', 'cek_promo', 'laporan', 'analisa', 'limit', 'posisi', 'belajar'];
    const busy = sit && c.kind !== 'boss' && (!!c.data.busy || TYPING.includes(c.data.step));
    const nowMs = performance.now();
    const running = walking && !sit && (c.run || c.speed > 5.5);
    const air = (c.jy || 0) > 0.03;
    if (running) c.walkT += dt * 5; // langkah lari lebih cepat
    const sw = walking ? Math.sin(c.walkT) * (running ? 1.05 : 0.65) : 0;
    // kaki: duduk / lari / jalan / lompat (lutut ditekuk saat di udara)
    let l0 = sit ? -Math.PI / 2 : sw, l1 = sit ? -Math.PI / 2 : -sw;
    if (air) { const up = (c.jvy || 0) > 0; l0 = up ? -1.1 : -0.55; l1 = up ? 0.35 : -0.2; }
    c.legs[0].rotation.x = lerp(c.legs[0].rotation.x, l0, air ? 0.35 : 0.3);
    c.legs[1].rotation.x = lerp(c.legs[1].rotation.x, l1, air ? 0.35 : 0.3);
    let a0 = walking ? -sw * (running ? 1.25 : 0.8) : 0, a1 = walking ? sw * (running ? 1.25 : 0.8) : 0;
    if (running) { a0 -= 0.25; a1 -= 0.25; } // siku ke depan saat lari
    if (busy) { a0 = -1.25 + Math.sin(t * 18) * 0.12; a1 = -1.25 + Math.sin(t * 18 + 1.6) * 0.12; }
    else if (sit) { a0 = a1 = -0.5; }
    if (c.kind === 'guard') { a0 = -0.55; a1 = -1.05; }
    if (c.kind === 'miner' && c.moving) { a0 = a1 = -1.2; }
    const speaking = mode === 'rapat' && meeting && meeting.speaker === c.key;
    if (speaking) { a1 = -1.6 + Math.sin(t * 4) * 0.4; }
    if (air) { const up = (c.jvy || 0) > 0; a0 = a1 = up ? -2.75 : -2.0; } // tangan terangkat saat lompat
    // pukulan: jab kiri/kanan bergantian, badan memutar & maju sedikit
    let twist = 0, lunge = 0;
    if (c.punchAt && nowMs - c.punchAt < 420) {
      const k = (nowMs - c.punchAt) / 420, pk = Math.sin(Math.min(1, k * 1.4) * Math.PI), side = c.punchSide || 1;
      if (side > 0) { a1 = -1.62 * pk - 0.1; a0 = -0.9; } else { a0 = -1.62 * pk - 0.1; a1 = -0.9; }
      twist = -side * 0.45 * pk; lunge = 0.14 * pk;
    }
    c.body.rotation.y = lerp(c.body.rotation.y, twist, 0.5);
    c.body.position.z = lerp(c.body.position.z, lunge, 0.5);
    // condong saat lari, terpental saat kena pukul
    let bx = running ? 0.2 : 0;
    if (c.hitAt && nowMs - c.hitAt < 600) bx = -0.45 * Math.sin((nowMs - c.hitAt) / 600 * Math.PI);
    c.body.rotation.x = lerp(c.body.rotation.x, bx, 0.3);
    // mendarat: badan sedikit tertekan
    const sq = c.landAt && nowMs - c.landAt < 180 ? 0.86 + 0.14 * ((nowMs - c.landAt) / 180) : 1;
    c.body.scale.set(2 - sq, sq, 2 - sq);
    if (c.wings) c.wings.forEach((w, i) => { w.rotation.y = (i ? 1 : -1) * (0.35 + Math.sin(t * (air ? 14 : running ? 12 : walking ? 9 : 2.4)) * (air ? 0.55 : walking ? 0.3 : 0.12)); });
    c.arms[0].rotation.x = lerp(c.arms[0].rotation.x, a0, air ? 0.35 : 0.3);
    c.arms[1].rotation.x = lerp(c.arms[1].rotation.x, a1, air ? 0.35 : 0.3);
    c.body.position.y = lerp(c.body.position.y, sit ? -0.28 : (walking ? Math.abs(Math.sin(c.walkT)) * (running ? 0.12 : 0.05) : Math.sin(t * 2 + c.walkT) * 0.012), 0.3);
    const printing = sit && c.data.printing;
    if (printing) { a1 = -0.9 + Math.sin(t * 6) * 0.1; }
    const waiting = sit && c.data.step === 'menunggu';
    c.head.rotation.y = speaking ? Math.sin(t * 2) * 0.25 : printing ? 0.7 : waiting ? Math.sin(t * 0.9) * 0.6 : busy ? Math.sin(t * 0.8) * 0.12 : 0;
    c.head.rotation.x = busy ? 0.12 : 0;
    const ringOn = c.selected || c.hover || speaking;
    c.ring.material.opacity = lerp(c.ring.material.opacity, ringOn ? 0.85 : 0, 0.2);
    c.ring.material.color.set(speaking ? '#3fb37f' : '#c9446a');

    // Security: patroli memutari kantor & tambang
    if (c.kind === 'guard' && !walking) {
      c.li = (c.li + 1) % c.loop.length; c.path = [c.loop[c.li]];
      if (performance.now() > c.wanderAt) { c.wanderAt = performance.now() + 14000 + Math.random() * 16000; sayLocal(c, GUARD_LINES[Math.floor(Math.random() * GUARD_LINES.length)], 3500); }
    }
    // Bos Kevin keliling kantor & tambang: memantau sambil mengejek
    if (c.kind === 'boss' && !walking && ['kerja', 'istirahat'].includes(mode)) {
      if (c.pendingSay) { const ps = c.pendingSay; c.pendingSay = null; sayLocal(c, ps.text, 5200); if (ps.agent && chars[ps.agent]) setTimeout(() => sayLocal(chars[ps.agent], REPLY[Math.floor(Math.random() * REPLY.length)], 3800), 2600); c.wanderAt = performance.now() + 6500 + Math.random() * 3500; }
      else if (performance.now() > c.wanderAt) bossNext(c);
    }
    // Jalan-jalan saat idle (hanya mode kerja, agen bawaan)
    if (c.kind === 'agent' && c.data.type === 'builtin' && mode === 'kerja' && !c.data.busy && !c.data.step && !walking && performance.now() > c.wanderAt) {
      c.wanderAt = performance.now() + 9000 + Math.random() * 14000;
      const r = rooms[roomByAgent[c.key]];
      if (c.wandering || Math.random() < 0.35) c.wandering = null;
      else if (r) c.wandering = { x: r.x + (Math.random() * 2 - 1) * (r.w / 2 - 2), y: 0, z: r.z + 1 + Math.random() * 3, face: Math.random() * TAU, sit: false };
      retarget(c);
    }
    if (c.kind === 'npc' && !walking && performance.now() > c.wanderAt) {
      c.wanderAt = performance.now() + 7000 + Math.random() * 9000;
      const xs = [-35, -20, -4, 12, -28];
      const spot = { x: xs[Math.floor(Math.random() * xs.length)], y: 0, z: NZ + (Math.random() - 0.5), face: 0, sit: false };
      c.path = [{ x: c.root.position.x, y: 0, z: NZ }, spot];
    }
  }
  function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; }

  // Label overlay (ruangan, nama, balon bicara)
  const v3 = new THREE.Vector3();
  function project(pos) {
    v3.copy(pos).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * container.clientWidth, y: (-v3.y * 0.5 + 0.5) * container.clientHeight, vis: v3.z < 1 && v3.z > -1 };
  }
  function updateLabels() {
    const close = cam.dist < 70;
    const W = container.clientWidth, H = container.clientHeight;
    for (const l of labels) {
      let pos = l.pos, show = !l.hidden;
      if (l.char && !l.char.root.visible) show = false;
      if (l.char) {
        const c = l.char;
        pos = tmp.set(c.root.position.x, c.root.position.y + (c.pose === 'sit' && !c.path.length ? 2.05 : 2.35), c.root.position.z);
        if (!show) { /* tersembunyi */ } else if (l.kind === 'tag') {
          show = close || c.hover || c.selected || c.kind === 'boss' || c.kind === 'player' || c.kind === 'visitor';
          const status = c.data.busy ? '<i class="b"></i>' : '<i></i>';
          const html = `${status}${S.esc(c.data.name)}${c.kind === 'boss' ? ' · Bos' : c.kind === 'player' ? ' · kamu' : ''}`;
          if (l.html !== html) { l.el.innerHTML = html; l.html = html; }
        } else {
          const say = c.data.say;
          const text = say || (c.data.busy && (close || c.hover || c.selected) ? `${c.data.current_task}` : '');
          show = !!text;
          if (show) {
            pos = tmp.set(c.root.position.x, c.root.position.y + (c.pose === 'sit' && !c.path.length ? 2.55 : 2.85), c.root.position.z);
            const cls = say ? 'say' : 'think';
            const html = S.esc(String(text).slice(0, say ? 150 : 46));
            if (l.html !== html + cls) { l.el.innerHTML = html; l.el.classList.toggle('say', !!say); l.html = html + cls; }
          }
        }
      }
      if (!show) { if (l.el.style.display !== 'none') l.el.style.display = 'none'; continue; }
      const p = project(pos);
      if (!p.vis || p.x < -150 || p.y < -60 || p.x > W + 150 || p.y > H + 60) { l.el.style.display = 'none'; continue; }
      l.el.style.display = '';
      l.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-100%)`;
      if (l.kind === 'room') l.el.style.opacity = cam.dist > 150 ? 0 : 1;
    }
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    if (cam.t >= 1 && currentView) cam.dist = Math.min(cam.dist, 260);
  }
  const ro = new ResizeObserver(() => { resize(); if (currentView && cam.t >= 1 && !drag) { cam.dist = distFor(currentView.size); } });
  ro.observe(container);
  resize();
  focus(opts.view || 'all', true);

  // =====================================================================
  // ---------- EXPLORE NOW: kamera bebas, POI, drone FPV, tour 3 menit, jalan-jalan karakter ----------
  // =====================================================================
  const X = { mode: null, poiI: 0, poiAuto: false, poiAt: 0, tour: null, drone: null, player: null, visitors: new Map(), rdrag: null, ldown: null, hires: false };
  const KEYS = new Set();
  const camDir = new THREE.Vector3();
  const v3a = new THREE.Vector3();
  const notifyX = (ev) => { try { opts.onExplore && opts.onExplore(ev); } catch (_) {} };
  addEventListener('keydown', (e) => {
    if (!X.mode || (e.target && e.target.closest && e.target.closest('input,textarea,select'))) return;
    KEYS.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyF' && X.mode === 'player' && !e.repeat) punch();
    if (e.code === 'Space' && X.mode === 'player' && !e.repeat) jump();
    if (e.code === 'KeyE' && X.mode === 'player' && !e.repeat) interact();
    if (e.code === 'Escape' && !document.pointerLockElement) exploreExit();
  });
  addEventListener('keyup', (e) => KEYS.delete(e.code));
  addEventListener('blur', () => KEYS.clear());
  document.addEventListener('mousemove', (e) => {
    if (X.mode !== 'drone' || document.pointerLockElement !== el) return;
    X.drone.yaw -= e.movementX * 0.0022; X.drone.pitch = THREE.MathUtils.clamp(X.drone.pitch - e.movementY * 0.0022, -1.45, 1.45);
  });
  document.addEventListener('pointerlockchange', () => notifyX({ type: 'lock', locked: document.pointerLockElement === el }));
  const key = (...c) => c.some((k) => KEYS.has(k));

  // ---- Suara pukulan (disintesis WebAudio, tanpa file eksternal) ----
  let actx = null;
  function sfxPunch(vol = 1) {
    try {
      if (S.store && S.store.get('sound', true) === false) return;
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = actx.currentTime;
      const len = Math.floor(actx.sampleRate * 0.16), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const n = actx.createBufferSource(); n.buffer = buf;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
      const g1 = actx.createGain(); g1.gain.value = 0.55 * vol; n.connect(bp).connect(g1).connect(actx.destination); n.start(t0);
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
      const g2 = actx.createGain(); g2.gain.setValueAtTime(0.9 * vol, t0); g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o.connect(g2).connect(actx.destination); o.start(t0); o.stop(t0 + 0.25);
    } catch (_) {}
  }

  // ---- Titik menarik (POI) & naskah tour ----
  const M = L.mine;
  const bossRoom = rooms.boss, meetRoom = rooms.meeting, loungeRoom = rooms.lounge;
  const poi = (label, x, y, z, dist, yaw, pitch, sub = '', follow = null) => ({ label, target: new THREE.Vector3(x, y, z), dist, yaw, pitch, sub, follow });
  const POIS = [
    poi('Kompleks SWEET dari udara', 24, 0, 18, 150, 0.25, 0.78, 'Kantor 16 agen AI dan tambang emas di sebelah timur'),
    poi('Resepsionis & lobi', -35, 0, 1, 14, -0.7, 0.32, 'Juan menyambut tamu di pintu masuk'),
    poi('Ruang Kevin (lantai atas)', bossRoom.x, DH, bossRoom.z, 17, 0.45, 0.42, 'Ruang kerja Bos Kevin'),
    poi('Ruang Rapat', meetRoom.x, DH, meetRoom.z, 21, 0.1, 0.5, 'Meja panjang untuk rapat seluruh agen'),
    poi('Lounge', loungeRoom.x, DH, loungeRoom.z, 17, -0.45, 0.45, 'Tempat istirahat jam 12:00'),
    poi('Tim Produk & Engineering', 0, 0, 14.5, 52, 0, 0.62, 'Agen #1–#10 membangun aplikasi dari satu ide'),
    ...L.rooms.filter((r) => r.agent && !r.outdoor).sort((a, b) => a.no - b.no).map((r) => { const d = desks[r.agent]; return poi(`#${r.no} ${rooms[r.id].agentName || ''} · ${r.label}`, d.world.x, 0.9, d.world.z - 0.5, 8.5, 0.38, 0.36, 'Meja gaming: PC, monitor lengkung, printer resi'); }),
    poi('Tim Toko Lazada', 0, 0, 35, 46, 0, 0.6, 'Agen #11–#15 mengurus toko, resi, stok, iklan, analisa'),
    ...(M ? [
      poi('Gerbang Tambang Emas', M.x0 + 3, 0, M.gate.z + 2, 16, -0.95, 0.34, 'Pintu samping kantor menuju tambang'),
      poi('Goa Emas', M.cave.x, 1.5, M.cave.z + 1, 17, -0.3, 0.3, 'Ujang mendorong lori keluar-masuk goa'),
      poi('Lori & tumpukan emas', M.pile.x - 2, 0.6, M.pile.z - 1, 14, 0.55, 0.34, 'Emas hasil tambang ditumpuk di luar goa'),
      poi('#16 Aurel · XAUUSD Trader', M.desk.x, 0.9, M.desk.z - 0.4, 9, 0.3, 0.36, 'Trading 24 jam · bendera BUY LIMIT / SELL LIMIT'),
      poi('Papan akun & grafik XAUUSD', M.board.x + 4, 2.6, M.board.z, 14, 0, 0.18, 'Cent Trading Account · MetaTrader 5 HFM')
    ] : []),
    poi('Ikuti Bos Kevin', 0, 0, 0, 13, 0.2, 0.5, 'Bos keliling memantau & mengejek karyawan', () => boss.root.position),
    ...(guards.length ? [poi('Ikuti Security Bima', 0, 0, 0, 13, -0.3, 0.45, 'Patroli memutari kantor & tambang', () => guards[0].root.position)] : [])
  ];
  const TOUR_SEC = 180;
  const TOUR = (() => { const pick = POIS.filter((p, i) => i < 7 || /Toko|Gerbang|Goa|Lori|Aurel|Papan|Bos/.test(p.label)); const per = TOUR_SEC / pick.length; return pick.map((p, i) => ({ ...p, t0: i * per, t1: (i + 1) * per })); })();

  // ---- Tabrakan & ketinggian (lantai bawah, tangga, mezzanine) ----
  const YB = L.yard || { x0: F.x0 - 5, x1: F.x1 + 5, z0: F.z0 - 5, z1: F.z1 + 5 };
  const R = 0.32;
  const inStairs = (x, z) => x >= 25 && x <= 36.9 && z >= -3.95 && z <= -1.85;
  const inLanding = (x, z) => x > 36.9 && x <= 39.4 && z >= -4.2 && z <= -1.85;
  const inDeck = (x, z) => x >= D.x0 + 0.3 && x <= D.x1 - 0.3 && z >= D.z0 + 0.3 && z <= D.z1 + 0.05;
  const hitCol = (x, z, lv) => colliders.some((c) => c.level === lv && x > c.x0 - R && x < c.x1 + R && z > c.z0 - R && z < c.z1 + R);
  function walk(x, z, level) {
    if (x < YB.x0 + 1 || x > YB.x1 - 1 || z < YB.z0 + 1 || z > YB.z1 - 1) return null;
    if (inStairs(x, z)) { const y = THREE.MathUtils.clamp((x - 25) / 11.9, 0, 1) * DH; return { y, level: y > DH * 0.5 ? 1 : 0 }; }
    if (inLanding(x, z)) return level === 1 ? { y: DH, level: 1 } : null;
    if (level === 1) return inDeck(x, z) && !hitCol(x, z, 1) ? { y: DH, level: 1 } : null;
    return hitCol(x, z, 0) ? null : { y: 0, level: 0 };
  }
  function moveBy(p, dx, dz) {
    let moved = false;
    let r = walk(p.x + dx, p.z, p.level); if (r) { p.x += dx; p.y = r.y; p.level = r.level; moved = true; }
    r = walk(p.x, p.z + dz, p.level); if (r) { p.z += dz; p.y = r.y; p.level = r.level; moved = true; }
    return moved;
  }

  // ---- Avatar pemain & pengunjung lain ----
  function makeAvatar(a, kind) {
    const m = buildModel(a.char);
    const root = m.root; scene.add(root);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 32), new THREE.MeshBasicMaterial({ color: kind === 'player' ? '#d6b26e' : '#7f9cff', transparent: true, opacity: kind === 'player' ? 0.75 : 0.45, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; root.add(ring);
    root.traverse((o) => { if (o.isMesh) o.userData.charKey = a.key; });
    const c = { key: a.key, data: { name: a.name, char: a.char, say: null }, kind, root, body: m.body, legs: m.legs, arms: m.arms, head: m.head, wings: m.wings, ring,
      tag: addLabel('', new THREE.Vector3(), 'tag'), bubble: addLabel('', new THREE.Vector3(), 'bubble'), path: [], pose: 'stand', walkT: 0, speed: 0, wanderAt: Infinity };
    c.tag.char = c; c.bubble.char = c; chars[a.key] = c;
    return c;
  }
  function removeAvatar(c) { if (!c) return; scene.remove(c.root); c.tag.el.remove(); c.bubble.el.remove(); labels.splice(labels.indexOf(c.tag), 1); labels.splice(labels.indexOf(c.bubble), 1); delete chars[c.key]; }

  const JUMP_V = 8.4, GRAV = 24;
  function jump() {
    const P = X.player; if (!P || P.jy > 0.01) return;
    P.vy = JUMP_V; P.jy = 0.001; P.jumpAt = Date.now(); P.c.jumpAt = performance.now();
  }
  function pow(o, text) {
    const l = addLabel(text, new THREE.Vector3(o.root.position.x, o.root.position.y + 2.6, o.root.position.z), 'pow');
    setTimeout(() => { l.el.remove(); const i = labels.indexOf(l); if (i >= 0) labels.splice(i, 1); }, 750);
  }
  function punch() {
    const P = X.player; if (!P) return;
    const c = P.c; c.punchSide = -(c.punchSide || -1); c.punchAt = performance.now(); P.punchAt = Date.now(); P.punchSide = c.punchSide; sfxPunch(0.8);
    const fx = Math.sin(c.root.rotation.y), fz = Math.cos(c.root.rotation.y);
    let best = null, bd = 1.9;
    Object.values(chars).forEach((o) => {
      if (o === c || !o.root.visible) return;
      const dx = o.root.position.x - c.root.position.x, dz = o.root.position.z - c.root.position.z, d = Math.hypot(dx, dz);
      if (d < bd && Math.abs(o.root.position.y - c.root.position.y) < 1 && (dx * fx + dz * fz) / (d || 1) > 0.3) { bd = d; best = o; }
    });
    if (best) {
      setTimeout(() => { best.hitAt = performance.now(); sfxPunch(1); pow(best, ['BUK!', 'POW!', 'DUG!'][Math.floor(Math.random() * 3)]); if (best.kind !== 'visitor') sayLocal(best, ['Aduh!', 'Eh, kok dipukul?', 'Sakit tau!', 'Ampun, lagi kerja nih!'][Math.floor(Math.random() * 4)], 2600); }, 140);
      notifyX({ type: 'hit', target: best.key, name: best.data.name });
    }
  }
  function interact() {
    const c = X.player && X.player.c; if (!c) return;
    let best = null, bd = 3;
    agentList().forEach((o) => { const d = o.root.position.distanceTo(c.root.position); if (d < bd) { bd = d; best = o; } });
    if (best && opts.onAgentClick) opts.onAgentClick(best.key, best.data, 'agent');
  }
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function moveClick(e) {
    const P = X.player; if (!P) return;
    const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); groundPlane.constant = -P.y;
    const hit = new THREE.Vector3(); if (ray.ray.intersectPlane(groundPlane, hit)) { P.goal = { x: hit.x, z: hit.z, stuck: 0 }; notifyX({ type: 'goal' }); }
  }

  // ---- Mulai / keluar mode ----
  function exploreStart(mode, o = {}) {
    if (X.mode === 'player' && mode !== 'player') despawn();
    if (X.mode === 'drone' && document.pointerLockElement) document.exitPointerLock();
    X.mode = mode; KEYS.clear();
    camera.fov = mode === 'drone' ? 72 : mode === 'player' ? 40 : 30; camera.updateProjectionMatrix();
    if (mode === 'free') flyTo(cam.target, Math.min(cam.dist, 90), cam.yaw, 0.7, false, 1.2);
    if (mode === 'poi') { X.poiI = 0; X.poiAuto = true; goPoi(0); }
    if (mode === 'tour') { X.tour = { start: performance.now(), i: -1 }; }
    if (mode === 'drone') {
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
      X.drone = { pos: camera.position.clone(), yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), roll: 0, vel: new THREE.Vector3(), speed: 14 };
      if (X.drone.pos.y > 60) { X.drone.pos.set(10, 22, F.z1 + 30); X.drone.yaw = 0; X.drone.pitch = -0.35; }
    }
    if (mode === 'player') spawn(o.char || 'kama', o.name || 'Pengunjung');
    notifyX({ type: 'mode', mode });
  }
  function exploreExit() {
    if (!X.mode) return;
    if (document.pointerLockElement) document.exitPointerLock();
    despawn(); X.mode = null; X.tour = null; KEYS.clear();
    camera.fov = 26; camera.updateProjectionMatrix();
    focus(currentView && currentView.id ? currentView.id : 'all');
    notifyX({ type: 'mode', mode: null });
  }
  function goPoi(i) {
    X.poiI = (i + POIS.length) % POIS.length; X.poiAt = performance.now();
    const p = POIS[X.poiI]; const tg = p.follow ? p.follow().clone().add(new THREE.Vector3(0, 1, 0)) : p.target;
    flyTo(tg, p.dist, p.yaw, p.pitch, false, 2.2);
    notifyX({ type: 'poi', i: X.poiI, n: POIS.length, label: p.label, sub: p.sub });
  }
  function spawn(char, name) {
    despawn();
    const c = makeAvatar({ key: '__me', char, name }, 'player');
    const sp = { x: 0, y: 0, z: F.z1 - 4.5 };
    c.root.position.set(sp.x, 0, sp.z); c.root.rotation.y = Math.PI;
    X.player = { c, char, name, x: sp.x, y: 0, z: sp.z, level: 0, ry: Math.PI, goal: null, punchAt: 0, punchSide: 1, jumpAt: 0, jy: 0, vy: 0, moving: false, running: false };
    flyTo(new THREE.Vector3(sp.x, 1.2, sp.z), 17, 0, 0.62, false, 1.4);
    sayLocal(c, `Halo, aku ${name}!`, 3500);
  }
  function despawn() { if (X.player) { removeAvatar(X.player.c); X.player = null; } }

  // ---- Update tiap frame ----
  function exploreUpdate(dt, t, raw) {
    const fwd = v3a.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    if (X.mode === 'free') {
      let mx = 0, mz = 0; if (key('KeyW', 'ArrowUp')) mz += 1; if (key('KeyS', 'ArrowDown')) mz -= 1; if (key('KeyD', 'ArrowRight')) mx += 1; if (key('KeyA', 'ArrowLeft')) mx -= 1;
      const sp = cam.dist * 0.7 * dt * (key('ShiftLeft', 'ShiftRight') ? 2.2 : 1);
      if (mx || mz) { cam.target.x += (fwd.x * mz + rx * mx) * sp; cam.target.z += (fwd.z * mz + rz * mx) * sp; cam.t = 1; }
      if (key('KeyQ')) { cam.yaw += dt * 1.1; cam.t = 1; } if (key('KeyE')) { cam.yaw -= dt * 1.1; cam.t = 1; }
      if (key('KeyR')) { cam.pitch = Math.min(1.45, cam.pitch + dt * 0.8); } if (key('KeyF')) { cam.pitch = Math.max(0.1, cam.pitch - dt * 0.8); }
    } else if (X.mode === 'poi') {
      const p = POIS[X.poiI];
      if (cam.t >= 1) { cam.yaw += dt * 0.025; if (p.follow) cam.target.lerp(v3a.copy(p.follow()).add(new THREE.Vector3(0, 1, 0)), Math.min(1, dt * 3)); }
      if (X.poiAuto && performance.now() - X.poiAt > 9000) goPoi(X.poiI + 1);
    } else if (X.mode === 'tour') {
      const el2 = (performance.now() - X.tour.start) / 1000;
      if (el2 >= TOUR_SEC) { notifyX({ type: 'tour-end' }); exploreStart('free'); return; }
      const i = TOUR.findIndex((k) => el2 >= k.t0 && el2 < k.t1);
      const k = TOUR[i];
      if (i !== X.tour.i) { X.tour.i = i; const tg = k.follow ? k.follow().clone().add(new THREE.Vector3(0, 1, 0)) : k.target; flyTo(tg, k.dist * 1.08, k.yaw - 0.12, k.pitch, false, 3.2); notifyX({ type: 'tour', i, n: TOUR.length, label: k.label, sub: k.sub }); }
      else if (cam.t >= 1) { cam.yaw += dt * 0.035; cam.dist = Math.max(k.dist * 0.88, cam.dist - dt * k.dist * 0.012); if (k.follow) cam.target.lerp(v3a.copy(k.follow()).add(new THREE.Vector3(0, 1, 0)), Math.min(1, dt * 3)); }
      X.tour.elapsed = el2;
    } else if (X.mode === 'drone') {
      const d = X.drone;
      const f = new THREE.Vector3(-Math.sin(d.yaw) * Math.cos(d.pitch), Math.sin(d.pitch), -Math.cos(d.yaw) * Math.cos(d.pitch));
      const r = new THREE.Vector3(Math.cos(d.yaw), 0, -Math.sin(d.yaw));
      const want = new THREE.Vector3();
      if (key('KeyW', 'ArrowUp')) want.add(f); if (key('KeyS', 'ArrowDown')) want.sub(f);
      if (key('KeyD', 'ArrowRight')) want.add(r); if (key('KeyA', 'ArrowLeft')) want.sub(r);
      if (key('Space', 'KeyE')) want.y += 1; if (key('KeyQ', 'KeyC', 'ControlLeft')) want.y -= 1;
      if (want.lengthSq()) want.normalize().multiplyScalar(d.speed * (key('ShiftLeft', 'ShiftRight') ? 2.5 : 1));
      d.vel.lerp(want, Math.min(1, dt * 3.5));
      d.pos.addScaledVector(d.vel, dt);
      d.pos.y = THREE.MathUtils.clamp(d.pos.y, 0.7, 140); d.pos.x = THREE.MathUtils.clamp(d.pos.x, -260, 300); d.pos.z = THREE.MathUtils.clamp(d.pos.z, -260, 300);
      const strafe = d.vel.dot(r) / Math.max(1, d.speed);
      d.roll = lerp(d.roll, -strafe * 0.35 + Math.sin(t * 1.7) * 0.01, Math.min(1, dt * 4));
    } else if (X.mode === 'player' && X.player) {
      const P = X.player, c = P.c;
      let mx = 0, mz = 0; if (key('KeyW', 'ArrowUp')) mz += 1; if (key('KeyS', 'ArrowDown')) mz -= 1; if (key('KeyD', 'ArrowRight')) mx += 1; if (key('KeyA', 'ArrowLeft')) mx -= 1;
      let vx = 0, vz = 0;
      if (mx || mz) { const l = Math.hypot(mx, mz); vx = (fwd.x * mz + rx * mx) / l; vz = (fwd.z * mz + rz * mx) / l; P.goal = null; }
      else if (P.goal) { const dx = P.goal.x - P.x, dz = P.goal.z - P.z, l = Math.hypot(dx, dz); if (l < 0.25) P.goal = null; else { vx = dx / l; vz = dz / l; } }
      const run = key('ShiftLeft', 'ShiftRight') ? 7.2 : 4.3, step = run * Math.min(dt, 0.05);
      P.moving = false;
      if (vx || vz) {
        const ok = moveBy(P, vx * step, vz * step);
        P.moving = ok; if (!ok && P.goal && (P.goal.stuck += dt) > 0.6) P.goal = null;
        P.ry = Math.atan2(vx, vz);
      }
      // lompat: gravitasi sederhana
      if (P.jy > 0 || P.vy > 0) { P.vy -= GRAV * Math.min(dt, 0.05); P.jy += P.vy * Math.min(dt, 0.05); if (P.jy <= 0) { P.jy = 0; P.vy = 0; c.landAt = performance.now(); } }
      c.root.position.set(P.x, P.y + P.jy, P.z); c.root.rotation.y = lerpAngle(c.root.rotation.y, P.ry, Math.min(1, dt * 12));
      P.running = P.moving && run > 5;
      c.moving = P.moving; c.speed = P.moving ? run : 0; c.run = P.running; c.jy = P.jy; c.jvy = P.vy;
      // kamera mengikuti dari belakang
      const tg = v3a.set(P.x, P.y + 1.2, P.z);
      if (cam.t >= 1) cam.target.lerp(tg, Math.min(1, dt * 8));
    }
    // pengunjung lain: interpolasi posisi
    X.visitors.forEach((v) => {
      const c = v.c, p = c.root.position, dx = v.x - p.x, dz = v.z - p.z, dist = Math.hypot(dx, dz);
      p.x += dx * Math.min(1, dt * 9); p.z += dz * Math.min(1, dt * 9); v.by = v.by === undefined ? v.y : v.by + (v.y - v.by) * Math.min(1, dt * 9);
      c.root.rotation.y = lerpAngle(c.root.rotation.y, v.ry, Math.min(1, dt * 9));
      c.moving = dist > 0.04 || v.anim === 'walk' || v.anim === 'run'; c.run = v.anim === 'run';
      if (v.jy > 0 || v.vy > 0) { v.vy -= GRAV * Math.min(dt, 0.05); v.jy += v.vy * Math.min(dt, 0.05); if (v.jy <= 0) { v.jy = 0; v.vy = 0; c.landAt = performance.now(); } }
      p.y = v.by + (v.jy || 0); c.jy = v.jy || 0; c.jvy = v.vy || 0;
    });
  }

  // ---- Multiplayer: data dari server ----
  function updateVisitors(list, myId) {
    const seen = new Set();
    (list || []).forEach((p) => {
      if (p.id === myId) return;
      seen.add(p.id);
      let v = X.visitors.get(p.id);
      if (!v || v.char !== p.char) { if (v) removeAvatar(v.c); const c = makeAvatar({ key: 'v_' + p.id, char: p.char, name: p.name }, 'visitor'); c.root.position.set(p.x, p.y, p.z); v = { c, char: p.char, lastPunch: p.punchAt || 0 }; X.visitors.set(p.id, v); }
      Object.assign(v, { x: p.x, y: p.y, z: p.z, ry: p.ry, anim: p.anim });
      v.c.data.name = p.name;
      if (p.say && p.say !== v.lastSay) { v.lastSay = p.say; sayLocal(v.c, p.say, 4000); }
      if (p.jumpAt && p.jumpAt > (v.lastJump || 0)) { if (v.lastJump) { v.vy = JUMP_V; v.jy = 0.001; } v.lastJump = p.jumpAt; }
      if (p.punchAt && p.punchAt > v.lastPunch) {
        v.lastPunch = p.punchAt; v.c.punchSide = p.punchSide || -(v.c.punchSide || -1); v.c.punchAt = performance.now(); sfxPunch(0.5);
        const me = X.player && X.player.c;
        if (me) { const dx = me.root.position.x - p.x, dz = me.root.position.z - p.z, d = Math.hypot(dx, dz); if (d < 1.9 && (dx * Math.sin(p.ry) + dz * Math.cos(p.ry)) / (d || 1) > 0.3) setTimeout(() => { me.hitAt = performance.now(); sfxPunch(1); pow(me, 'BUK!'); sayLocal(me, 'Aduh!', 2000); }, 140); }
      }
    });
    [...X.visitors.keys()].forEach((id) => { if (!seen.has(id)) { removeAvatar(X.visitors.get(id).c); X.visitors.delete(id); } });
    return X.visitors.size;
  }
  function playerState() {
    const P = X.player; if (!P) return null;
    return { char: P.char, name: P.name, x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), ry: +P.ry.toFixed(2), anim: P.moving ? (P.running ? 'run' : 'walk') : 'idle', punchAt: P.punchAt, punchSide: P.punchSide, jumpAt: P.jumpAt, say: P.c.data.say || '' };
  }
  function setHiRes(on) {
    X.hires = !!on;
    renderer.setPixelRatio(on ? Math.min(2.5, (window.devicePixelRatio || 1) * 1.5) : Math.min(window.devicePixelRatio || 1, 2));
    sun.shadow.mapSize.set(on ? 4096 : 2048, on ? 4096 : 2048);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.toneMappingExposure = renderer.toneMappingExposure;
    resize();
  }
  const explore = {
    start: exploreStart, exit: exploreExit, get mode() { return X.mode; },
    poiNext: () => goPoi(X.poiI + 1), poiPrev: () => goPoi(X.poiI - 1), poiAuto: (v) => { X.poiAuto = !!v; X.poiAt = performance.now(); }, get poiAutoOn() { return X.poiAuto; },
    pois: () => POIS.map((p) => p.label), goPoi,
    tourInfo: () => (X.tour ? { elapsed: X.tour.elapsed || 0, total: TOUR_SEC, i: X.tour.i, n: TOUR.length } : null),
    droneInfo: () => (X.drone ? { alt: X.drone.pos.y, speed: X.drone.vel.length(), max: X.drone.speed, x: X.drone.pos.x, z: X.drone.pos.z, locked: document.pointerLockElement === el } : null),
    playerState, updateVisitors, setHiRes, get hires() { return X.hires; },
    say: (text) => { if (X.player) sayLocal(X.player.c, String(text).slice(0, 120), 5000); },
    characters: CHARACTERS
  };

  // ---------- Jam dinding analog (jarum berputar mengikuti jam kantor) ----------
  const clockG = new THREE.Group(); clockG.position.set(-16, 3.6, F.z0 + 0.12); scene.add(clockG);
  const dialTex = canvasTex(256, 256, (g) => {
    g.fillStyle = '#f7f1ea'; g.beginPath(); g.arc(128, 128, 124, 0, TAU); g.fill();
    g.lineWidth = 10; g.strokeStyle = '#7d1d36'; g.stroke();
    g.fillStyle = '#2a1d22'; g.font = '700 30px "JetBrains Mono",monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) { const a = i / 12 * TAU; g.fillText(String(i), 128 + Math.sin(a) * 92, 128 - Math.cos(a) * 92); }
    for (let i = 0; i < 60; i++) { const a = i / 60 * TAU, r0 = i % 5 ? 112 : 104; g.fillRect(128 + Math.sin(a) * r0 - 1, 128 - Math.cos(a) * r0 - 1, 2, 2); }
  });
  const dial = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.5, emissive: '#ffffff', emissiveMap: dialTex, emissiveIntensity: 0.15 }));
  clockG.add(dial);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.08, 10, 48), mat('#2a1d22', { metalness: 0.6, roughness: 0.3 })); clockG.add(rim);
  const hand = (len, w, color, z) => { const h = new THREE.Group(); const m = new THREE.Mesh(BOX, mat(color)); m.scale.set(w, len, 0.03); m.position.y = len / 2 - 0.12; h.add(m); h.position.z = z; clockG.add(h); return h; };
  const hHour = hand(0.75, 0.09, '#2a1d22', 0.04), hMin = hand(1.1, 0.06, '#2a1d22', 0.06), hSec = hand(1.2, 0.025, '#c9446a', 0.08);
  const clockLbl = addLabel('', new THREE.Vector3(-16, 2.0, F.z0 + 0.3), 'small');
  function updateClock() {
    const ms = S.simNow ? S.simNow() : Date.now();
    const wib = new Date(ms + 7 * 3600e3);
    const sec = wib.getUTCSeconds() + wib.getUTCMilliseconds() / 1000, min = wib.getUTCMinutes() + sec / 60, hr = (wib.getUTCHours() % 12) + min / 60;
    hSec.rotation.z = -sec / 60 * TAU; hMin.rotation.z = -min / 60 * TAU; hHour.rotation.z = -hr / 12 * TAU;
    const txt = wib.toISOString().slice(11, 16);
    if (clockLbl.html !== txt) { clockLbl.el.textContent = `JAM KANTOR ${txt}`; clockLbl.html = txt; }
  }

  // ---------- Papan pendapatan (nominal uang tampil di kantor) ----------
  const revTex = canvasTex(512, 160, () => {});
  box(scene, 7.2, 2.25, 0.1, '#140c10', 16, 2.75, F.z0 + 0.06);
  box(scene, 7, 2.1, 0.06, new THREE.MeshStandardMaterial({ map: revTex, emissive: '#ffffff', emissiveMap: revTex, emissiveIntensity: 0.8 }), 16, 2.82, F.z0 + 0.12, { cast: false });
  function setRevenue(amount, orders, buyers) {
    const g = revTex.userData.ctx;
    const gr = g.createLinearGradient(0, 0, 512, 160); gr.addColorStop(0, '#2a0f19'); gr.addColorStop(1, '#5b1528');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 160);
    g.fillStyle = '#d6b26e'; g.font = '700 20px "JetBrains Mono",monospace'; g.fillText('PENDAPATAN HARI INI', 24, 40);
    g.fillStyle = '#ffffff'; g.font = '800 56px "JetBrains Mono",monospace'; g.fillText('Rp' + Math.round(amount || 0).toLocaleString('id-ID'), 24, 104);
    g.fillStyle = '#e8b9c6'; g.font = '600 20px "JetBrains Mono",monospace'; g.fillText(`${orders || 0} pesanan • ${buyers || 0} pembeli`, 24, 140);
    revTex.needsUpdate = true;
  }
  setRevenue(0, 0, 0);

  // ---------- Indikator di atas meja: langkah kerja, tanda $ / !, uang masuk ----------
  const deskLbl = {};
  Object.entries(desks).forEach(([key, d]) => {
    deskLbl[key] = {
      step: addLabel('', d.world.clone().add(new THREE.Vector3(0, 3.0, 0)), 'step'),
      flag: addLabel('', d.world.clone().add(new THREE.Vector3(1.5, 3.9, 0)), 'flag')
    };
  });
  function popMoney(text, key) {
    const d = desks[key] || desks.dimas || Object.values(desks)[0];
    const l = addLabel(S.esc(text), d.world.clone().add(new THREE.Vector3(0, 3.4, 0)), 'money');
    setTimeout(() => { l.el.remove(); labels.splice(labels.indexOf(l), 1); }, 3300);
  }
  const STEP_ICON = { belajar: 'book', analisa: 'trend', limit: 'flag', posisi: 'coin', tugas: 'clock', monitor: 'office', cek_toko: 'cart', print: 'printer', cek_promo: 'tag', menunggu: 'clock', laporan: 'file' };
  function updateDeskLabels() {
    const close = cam.dist < 70;
    Object.entries(deskLbl).forEach(([key, l]) => {
      const c = chars[key]; const a = c && c.data;
      if (!a) return;
      const showStep = !!a.step && !a.busy && (close || a.printing) && (mode !== 'pulang' || a.type === 'trader');
      const stepHtml = showStep ? `${S.icon ? S.icon(STEP_ICON[a.step] || 'office', 12) : ''}<span>${S.esc(String(a.step_label || '').slice(0, 44))}</span>` : '';
      if (l.step.html !== stepHtml) { l.step.el.innerHTML = stepHtml; l.step.html = stepHtml; }
      l.step.hidden = !showStep;
      const f = a.flag;
      const fh = f ? (f === '$' ? '$' : '!') : '';
      if (l.flag.html !== fh + (a.flag_note || '')) {
        l.flag.el.textContent = fh; l.flag.el.title = a.flag_note || '';
        l.flag.el.className = 'o3d-label flag ' + (f === '$' ? 'dollar' : f === '!' ? 'urgent' : '');
        l.flag.html = fh + (a.flag_note || '');
      }
      l.flag.hidden = !f;
    });
  }

  // ---------- Siang / malam ----------
  const DAY_BG = new THREE.Color('#2a1c22'), NIGHT_BG = new THREE.Color('#07050a'), tmpC = new THREE.Color();
  let lastLight = -1;
  // Terang 06:00-17:30, gelap 19:30-04:30 (kantor tutup 20:00-04:00 → gelap, lampu menyala)
  function daylight(h) {
    if (h < 4.5 || h >= 19.5) return 0;
    if (h < 6) return (h - 4.5) / 1.5;
    if (h < 17.5) return 1;
    return 1 - (h - 17.5) / 2;
  }
  function updateDaylight() {
    const h = S.simHour ? S.simHour() : new Date().getHours();
    const f = Math.round(daylight(h) * 100) / 100;
    if (f === lastLight) return;
    lastLight = f;
    hemi.intensity = 0.25 + 0.95 * f;
    hemi.color.set(f > 0.5 ? '#fff8ee' : '#9fb0ff');
    sun.intensity = 0.15 + 1.45 * f;
    sun.color.set(f > 0.7 ? '#fff3e0' : f > 0.2 ? '#ffb27a' : '#7d8dff');
    tmpC.copy(NIGHT_BG).lerp(DAY_BG, f); scene.background.copy(tmpC); scene.fog.color.copy(tmpC);
    windowMat.color.set(f > 0.3 ? '#cfe2ee' : '#1b2340'); windowMat.emissive.set(f > 0.3 ? '#bcd8ea' : '#2b3a6b');
    windowMat.emissiveIntensity = f > 0.3 ? 0.35 : 0.6;
    const lampOn = 1 - f;
    const on = lampOn > 0.25;
    lamps.forEach((l) => { l.group.visible = on; l.mat.emissiveIntensity = on ? 2.4 * lampOn : 0; });
    nightLights.forEach((pl) => { pl.intensity = on ? 70 * lampOn : 0; });
    renderer.toneMappingExposure = 0.85 + 0.2 * f;
    container.dataset.night = f < 0.3 ? '1' : '0';
  }

  function animateDesks(t) {
    const hue = (t * 0.08) % 1;
    rgbMats.forEach((m, i) => { if (!m.userData.fixed) m.emissive.setHSL((hue + i * 0.013) % 1, 0.85, 0.55); });
    Object.entries(desks).forEach(([key, d]) => {
      const a = chars[key] && chars[key].data;
      if (!a) return;
      // meja berkedip merah saat mendesak
      if (a.blink) { const on = Math.sin(t * 10) > 0; d.stripMat.emissive.set(on ? '#ff2240' : '#330008'); d.stripMat.emissiveIntensity = on ? 2.6 : 0.4; d.top.material.emissive && d.top.material.emissive.set(on ? '#3a0710' : '#000'); d.stripMat.userData.fixed = true; }
      else if (d.stripMat.userData.fixed) { d.stripMat.userData.fixed = false; d.stripMat.emissiveIntensity = 1.2; d.top.material.emissive && d.top.material.emissive.set('#000'); }
      // printer: kertas resi keluar
      d.paper.visible = !!a.printing;
      if (a.printing) { const k = (t * 0.7) % 1; d.paper.position.z = d.pos.z + 0.05 + 0.1 + k * 0.35; d.paper.position.y = 1.035 - k * 0.12; d.prLed.material.emissive.set(Math.sin(t * 12) > 0 ? '#22c55e' : '#064e1e'); }
      else d.prLed.material.emissive.set('#22c55e');
      // layar menyala lebih terang saat bekerja
      d.screenMat.emissiveIntensity = mode === 'pulang' && !a.busy && a.type !== 'trader' ? 0.05 : a.step || a.busy ? 0.9 : 0.4;
    });
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
    const t = now / 1000;
    if (X.mode) exploreUpdate(dt, t, raw);
    if (cam.t < 1 && cam.to) {
      cam.t = Math.min(1, cam.t + Math.min(0.25, raw) / (cam.dur || 0.9));
      const k = ease(cam.t);
      cam.target.lerpVectors(cam.from.target, cam.to.target, k);
      cam.dist = lerp(cam.from.dist, cam.to.dist, k);
      cam.yaw = lerpAngle(cam.from.yaw ?? 0, cam.to.yaw ?? 0, k) ; cam.pitch = lerp(cam.from.pitch ?? 0.92, cam.to.pitch ?? 0.92, k);
    }
    if (X.mode === 'drone') { const d = X.drone; camera.position.copy(d.pos); camera.rotation.set(d.pitch, d.yaw, d.roll, 'YXZ'); }
    else {
      camDir.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
      camera.position.copy(cam.target).addScaledVector(camDir, cam.dist);
      camera.lookAt(cam.target);
    }
    Object.values(chars).forEach((c) => stepChar(c, dt, t));
    animators.forEach((fn) => fn(t, dt, fn.busyOf || (() => false)));
    animateDesks(t); updateClock(); updateDaylight(); animateMine(t, dt); animateFlag(t);
    screenAcc += dt;
    if (screenAcc > 0.45) { screenAcc = 0; screens.forEach((sc) => drawScreen(sc, t, sc.agentKey ? !!(chars[sc.agentKey] && (chars[sc.agentKey].data.busy || chars[sc.agentKey].data.type === 'trader')) : mode === 'rapat')); }
    renderer.render(scene, camera);
    updateDeskLabels();
    updateLabels();
  }
  requestAnimationFrame(frame);

  return {
    views, focus, select, setRevenue, popMoney, explore,
    get view() { return currentView; },
    get mode() { return mode; },
    agent: (key) => chars[key] && chars[key].data,
    agents: () => Object.values(chars).filter((c) => c.kind === 'agent').map((c) => c.data),
    destroy() { running = false; ro.disconnect(); renderer.dispose(); container.innerHTML = ''; }
  };
}
