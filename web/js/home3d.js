// SWEET Stay Home — rumah agen 3D (three.js).
// 8 kamar (1 kamar = 1 kasur = 2 agen), ruang TV, dapur & kopi, ruang belajar, taman dengan jalan setapak.
// Agen tidur, santai, ngopi, belajar, baca, nonton, main game, ngobrol berdua, jalan-jalan — sesuai data server (/api/home).
import * as THREE from 'three';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const HAIR = ['#2b2018', '#3d2b1f', '#141414', '#6b4a2f', '#8a4b2a', '#242a35'];
const SKIN = ['#f1c9a5', '#e8b88f', '#d9a27a', '#f3d2b5', '#c98d63'];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const lerpAngle = (a, b, t) => { const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; };

export async function createHome(container, opts = {}) {
  const S = window.SWEET;
  const data = await S.api('/api/home');
  const st = await S.api('/api/state');

  // ---------- Renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  container.appendChild(overlay);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1216');
  scene.fog = new THREE.Fog('#1a1216', 230, 520);
  const camera = new THREE.PerspectiveCamera(26, 1, 1, 800);
  const hemi = new THREE.HemisphereLight('#fff8ee', '#8aa07a', 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3e0', 1.5);
  sun.position.set(-30, 70, 50); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 200 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.target.position.set(0, 0, 4);
  scene.add(sun, sun.target);

  // ---------- Helpers ----------
  const matCache = new Map();
  const mat = (color, o = {}) => { const k = color + JSON.stringify(o); if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...o })); return matCache.get(k); };
  const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 18), SPH = new THREE.SphereGeometry(1, 18, 14);
  function box(p, w, h, d, color, x, y, z, o = {}) {
    const m = new THREE.Mesh(BOX, typeof color === 'string' ? mat(color, o.m) : color);
    m.scale.set(w, h, d); m.position.set(x, y + h / 2, z); m.castShadow = o.cast !== false; m.receiveShadow = true;
    if (o.ry) m.rotation.y = o.ry; p.add(m); return m;
  }
  function cyl(p, r, h, color, x, y, z) { const m = new THREE.Mesh(CYL, typeof color === 'string' ? mat(color) : color); m.scale.set(r, h, r); m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; p.add(m); return m; }
  function sph(p, r, color, x, y, z, sy = 1) { const m = new THREE.Mesh(SPH, typeof color === 'string' ? mat(color) : color); m.scale.set(r, r * sy, r); m.position.set(x, y, z); m.castShadow = true; p.add(m); return m; }
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData = { g }; return t; }
  const tree = (x, z, s = 1) => { cyl(scene, 0.25 * s, 1.6 * s, '#6b4a2f', x, 0, z); sph(scene, 1.5 * s, '#4f9a4f', x, 2.4 * s, z); sph(scene, 1.1 * s, '#62b061', x + 0.6 * s, 3.1 * s, z - 0.3 * s); };
  const plant = (p, x, y, z, s = 1) => { cyl(p, 0.3 * s, 0.42 * s, '#d9cbb5', x, y, z); sph(p, 0.48 * s, '#5aa457', x, y + 0.82 * s, z); };
  const labels = [];
  function addLabel(html, pos, cls) { const el = document.createElement('div'); el.className = `o3d-label ${cls || ''}`; el.innerHTML = html; overlay.appendChild(el); const l = { el, pos, kind: cls }; labels.push(l); return l; }
  const animators = [];

  // ---------- Tanah, taman, pagar ----------
  const grassTex = canvasTex(256, 256, (g) => { g.fillStyle = '#5f8f4e'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 1400; i++) { g.fillStyle = Math.random() > 0.5 ? '#6a9b57' : '#557f45'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 3); } });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(14, 14);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(130, 110), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, 6); ground.receiveShadow = true; scene.add(ground);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), mat('#22181c')); far.rotation.x = -Math.PI / 2; far.position.y = -0.05; scene.add(far);
  // jalan setapak melingkar di taman
  const LOOP = [];
  for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; LOOP.push({ x: Math.cos(a) * 25, y: 0, z: 21 + Math.sin(a) * 8.5 }); }
  LOOP.forEach((p, i) => { const q = LOOP[(i + 1) % LOOP.length]; const len = Math.hypot(q.x - p.x, q.z - p.z); const s = box(scene, 2.2, 0.04, len + 0.3, '#c9b58e', (p.x + q.x) / 2, 0, (p.z + q.z) / 2, { cast: false }); s.rotation.y = Math.atan2(q.x - p.x, q.z - p.z); });
  box(scene, 2.4, 0.04, 26, '#c9b58e', 0, 0, 21, { cast: false }); // jalan lurus pagar -> pintu
  // kolam, bangku, lampu taman, pohon, bunga
  const pond = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshStandardMaterial({ color: '#3d7fa6', roughness: 0.15, metalness: 0.3, emissive: '#0b2333', emissiveIntensity: 0.3 }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(-12, 0.03, 21); scene.add(pond);
  for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; sph(scene, 0.35, '#8c8c8c', -12 + Math.cos(a) * 4.2, 0.12, 21 + Math.sin(a) * 4.2, 0.5); }
  [[13, 21], [-30, 13]].forEach(([x, z]) => { box(scene, 2.6, 0.12, 0.8, '#7a5634', x, 0.45, z); box(scene, 2.6, 0.7, 0.12, '#7a5634', x, 0.5, z - 0.4); [-1.1, 1.1].forEach((dx) => box(scene, 0.12, 0.45, 0.7, '#3a2a20', x + dx, 0, z)); });
  const lampPostMats = [];
  [[-25, 12], [25, 12], [-25, 30], [25, 30], [0, 31], [-8, 9], [8, 9]].forEach(([x, z]) => {
    cyl(scene, 0.08, 3, '#2a2a30', x, 0, z);
    const m = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffd59a', emissiveIntensity: 0 });
    sph(scene, 0.3, m, x, 3.1, z); lampPostMats.push(m);
  });
  [[-34, 10], [-38, 24], [-33, 33], [34, 10], [38, 22], [32, 33], [-18, 33], [18, 34], [6, 14], [-5, 27], [20, 25]].forEach(([x, z], i) => tree(x, z, 0.8 + (i % 3) * 0.15));
  for (let i = 0; i < 40; i++) { const a = Math.random() * TAU, r = 5 + Math.random() * 2.5; sph(scene, 0.22, ['#e85d75', '#f2c14e', '#b48cff', '#ffffff'][i % 4], 4 + Math.cos(a) * r * 1.7, 0.25, 21 + Math.sin(a) * r * 0.5); }
  // pagar
  const fence = (x0, z0, x1, z1) => { const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2.2); for (let i = 0; i <= n; i++) box(scene, 0.15, 1, 0.15, '#e8dcc6', lerp(x0, x1, i / n), 0, lerp(z0, z1, i / n)); const r = box(scene, Math.hypot(x1 - x0, z1 - z0), 0.1, 0.08, '#e8dcc6', (x0 + x1) / 2, 0.75, (z0 + z1) / 2); r.rotation.y = -Math.atan2(z1 - z0, x1 - x0); };
  fence(-42, 35, -2, 35); fence(2, 35, 42, 35); fence(-42, -24, -42, 35); fence(42, -24, 42, 35);
  box(scene, 0.4, 1.8, 0.4, '#a52a4a', -2.2, 0, 35); box(scene, 0.4, 1.8, 0.4, '#a52a4a', 2.2, 0, 35);
  const signTex = canvasTex(512, 96, (g) => { g.fillStyle = '#2a0f19'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#ffd9b8'; g.font = '700 46px "JetBrains Mono",monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STAY HOME · SWEET', 256, 50); });
  box(scene, 6, 1.1, 0.12, new THREE.MeshStandardMaterial({ map: signTex, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0.4 }), 0, 1.9, 35.1);
  const GATE = { x: 0, y: 0, z: 34, face: Math.PI, hide: true };

  // ---------- Rumah ----------
  const woodTex = canvasTex(256, 256, (g) => { g.fillStyle = '#d7bf98'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#d1b78e' : '#dcc6a2'; g.fillRect(0, i * 32, 256, 31); g.fillStyle = 'rgba(100,70,40,.15)'; g.fillRect(0, i * 32 + 31, 256, 1); } });
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping; woodTex.repeat.set(10, 4);
  const H = { x0: -36.5, x1: 36.5, z0: -21.5, z1: 7 };
  box(scene, H.x1 - H.x0, 0.3, H.z1 - H.z0, new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 }), 0, -0.25, (H.z0 + H.z1) / 2, { cast: false });
  const wall = '#f3ebdf', trim = '#7d1d36';
  box(scene, H.x1 - H.x0, 2.8, 0.3, wall, 0, 0, H.z0); box(scene, H.x1 - H.x0, 0.12, 0.34, trim, 0, 2.8, H.z0);
  [H.x0, H.x1].forEach((x) => { box(scene, 0.3, 1.6, H.z1 - H.z0, wall, x, 0, (H.z0 + H.z1) / 2); box(scene, 0.34, 0.1, H.z1 - H.z0, trim, x, 1.6, (H.z0 + H.z1) / 2); });
  [[-19.5, 34], [19.5, 34]].forEach(([cx, w]) => { box(scene, w, 0.9, 0.25, wall, cx, 0, H.z1); box(scene, w, 0.08, 0.28, trim, cx, 0.9, H.z1); }); // dinding depan, pintu di x=0
  // jendela belakang (gelap biru saat malam)
  const winMat = new THREE.MeshStandardMaterial({ color: '#cfe2ee', emissive: '#bcd8ea', emissiveIntensity: 0.3, roughness: 0.2 });

  // Kamar tidur (8) di belakang
  const ROOM_W = 9, RZ = -16.2, RD = 10;
  const rooms = [];
  const roomColors = ['#e9c7d1', '#c8dceb', '#d8e8c8', '#efdcc0', '#d9cdef', '#c7e6e2', '#f1d0c0', '#e2d9c9'];
  const duvet = ['#a52a4a', '#3b6ea8', '#4c8c5a', '#c08a2e', '#6c4fb0', '#2d8c86', '#c25a3a', '#7a6a55'];
  const roomLamps = [];
  for (let i = 0; i < 8; i++) {
    const cx = H.x0 + 0.25 + ROOM_W / 2 + i * ROOM_W;
    const g = new THREE.Group(); g.position.set(cx, 0, RZ); scene.add(g);
    box(g, ROOM_W - 0.3, 0.04, RD - 0.3, roomColors[i], 0, 0.005, 0, { cast: false });
    if (i < 7) box(g, 0.2, 2.2, RD, wall, ROOM_W / 2, 0, 0);
    // dinding depan kamar dengan pintu di sisi kanan
    box(g, ROOM_W - 2.2, 1.2, 0.2, wall, -1.1, 0, RD / 2); box(g, ROOM_W - 2.2, 0.06, 0.24, trim, -1.1, 1.2, RD / 2);
    box(g, 2.2, 0.06, 0.12, wall, 0, 0, 0, { cast: false }).visible = false;
    box(g, 2.6, 1.2, 0.08, winMat, 0, 1.2, -RD / 2 + 0.2, { cast: false });
    // kasur double (1 kasur untuk 2 agen)
    box(g, 3.2, 0.42, 3.9, '#5a3d22', 0, 0, -2.5);
    box(g, 3.0, 0.14, 3.7, '#f6f1ea', 0, 0.42, -2.5);
    box(g, 3.3, 1.1, 0.2, '#5a3d22', 0, 0.2, -4.5);
    [-0.75, 0.75].forEach((dx) => box(g, 1.1, 0.18, 0.55, '#ffffff', dx, 0.56, -4.0));
    box(g, 3.05, 0.2, 2.2, duvet[i], 0, 0.56, -1.75);
    // meja kecil + lampu, lemari, karpet, tanaman
    box(g, 1.4, 0.72, 0.8, '#8b6b4a', 3.1, 0, 1.2); box(g, 0.5, 0.05, 0.4, '#ffffff', 3.0, 0.72, 1.2);
    const lm = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffd59a', emissiveIntensity: 0 });
    cyl(g, 0.05, 0.4, '#333', 3.5, 0.72, 1.1); sph(g, 0.16, lm, 3.5, 1.2, 1.1); roomLamps.push(lm);
    box(g, 1.2, 2.1, 0.8, '#6b4a2b', -3.4, 0, -3.9);
    box(g, 2.8, 0.02, 1.8, duvet[i], 0, 0.02, 1.4, { cast: false }).material = mat(duvet[i], { roughness: 1 });
    plant(g, -3.6, 0, 3.8, 0.8);
    rooms.push({ i, cx, cz: RZ, x0: cx - ROOM_W / 2, x1: cx + ROOM_W / 2, door: { x: cx + 3.3 } });
    rooms[i].lbl = addLabel(`<em>${i + 1}</em>KAMAR ${i + 1}`, new THREE.Vector3(cx, 0.4, RZ + RD / 2 + 0.3), 'room');
  }
  const roomOfPoint = (p) => (p.z < -11.1 && p.z > H.z0 ? rooms.find((r) => p.x >= r.x0 && p.x <= r.x1) : null);

  // Ruang TV (kiri depan)
  const tvMat = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#4a7bd8', emissiveIntensity: 0.4 });
  box(scene, 6, 0.6, 0.8, '#3a2a20', -23, 0, -8); box(scene, 5.2, 2.8, 0.15, '#0e0e12', -23, 0.9, -8.3); box(scene, 5, 2.6, 0.04, tvMat, -23, 1.0, -8.2, { cast: false });
  animators.push((t) => { tvMat.emissive.setHSL((t * 0.07) % 1, 0.6, 0.45 + 0.1 * Math.sin(t * 3)); });
  box(scene, 7, 0.03, 5.5, '#b7425d', -23, 0, -3.8, { cast: false });
  box(scene, 6.2, 0.5, 1.1, '#7d1d36', -23, 0, -1.7); box(scene, 6.2, 0.75, 0.3, '#5e1528', -23, 0.45, -1.2);
  [[-27, -4.6], [-19, -4.6]].forEach(([x, z]) => sph(scene, 0.75, '#d6b26e', x, 0.4, z, 0.55));
  box(scene, 2, 0.4, 1, '#5a3d22', -23, 0, -4.6);
  addLabel('RUANG TV', new THREE.Vector3(-23, 0.3, 4.8), 'room');
  // Dapur & kopi (tengah)
  box(scene, 14, 1, 1, '#efe6dc', 0, 0, -8); box(scene, 14, 0.08, 1.1, '#2a2024', 0, 1, -8);
  box(scene, 0.8, 0.9, 0.6, '#30303a', -3, 1.05, -8.1);
  const steam = sph(scene, 0.12, new THREE.MeshStandardMaterial({ color: '#fff', transparent: true, opacity: 0.5 }), -3, 2.1, -8);
  animators.push((t) => { const p = (t * 0.6) % 1; steam.position.y = 2.0 + p * 0.9; steam.material.opacity = 0.5 * (1 - p); });
  box(scene, 8.5, 1.05, 1.3, '#5a3d22', 0, 0, -4); box(scene, 8.7, 0.08, 1.5, '#2a2024', 0, 1.05, -4);
  [-3, -1, 1, 3].forEach((x) => { cyl(scene, 0.3, 0.08, '#a52a4a', x, 0.75, -2.8); cyl(scene, 0.05, 0.75, '#333', x, 0, -2.8); });
  box(scene, 4.2, 0.08, 1.8, '#7a5634', 0, 0.74, 2.5); [-1.8, 1.8].forEach((dx) => box(scene, 0.12, 0.74, 1.4, '#5a3d22', dx, 0, 2.5));
  [[-1.2, 1.2], [1.2, 1.2], [-1.2, 3.8], [1.2, 3.8]].forEach(([x, z]) => box(scene, 0.6, 0.08, 0.6, '#3b3f4a', x, 0.44, z));
  for (let i = 0; i < 4; i++) cyl(scene, 0.08, 0.14, '#fff', -1.2 + (i % 2) * 2.4, 0.82, 2.1 + Math.floor(i / 2) * 0.8);
  addLabel('DAPUR & KOPI', new THREE.Vector3(0, 0.3, 5.6), 'room');
  // Ruang belajar & baca (kanan depan)
  for (let i = 0; i < 4; i++) {
    const x = 16 + i * 5;
    box(scene, 2.2, 0.06, 1, '#8b6b4a', x, 0.74, -3.4); [-1, 1].forEach((dx) => box(scene, 0.08, 0.74, 0.8, '#6b4a2b', x + dx, 0, -3.4));
    box(scene, 0.7, 0.08, 0.6, '#3b3f4a', x, 0.44, -4.3); box(scene, 0.7, 0.7, 0.08, '#3b3f4a', x, 0.5, -4.6);
    const lm = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffd59a', emissiveIntensity: 0 });
    cyl(scene, 0.04, 0.45, '#333', x + 0.8, 0.8, -3.6); sph(scene, 0.14, lm, x + 0.8, 1.3, -3.6); roomLamps.push(lm);
    box(scene, 0.5, 0.06, 0.35, ['#c9446a', '#3b6ea8', '#d6b26e', '#4c8c5a'][i], x - 0.3, 0.8, -3.3);
  }
  for (let i = 0; i < 4; i++) { box(scene, 4, 2.4, 0.6, '#6b4a2b', 15 + i * 5, 0, -8); for (let j = 0; j < 12; j++) box(scene, 0.25, 0.5, 0.35, ['#c9446a', '#3b6ea8', '#d6b26e', '#4c8c5a', '#9b7bdb'][(i + j) % 5], 13.4 + i * 5 + (j % 6) * 0.6, 0.3 + Math.floor(j / 6) * 0.9, -7.8); }
  [16, 21, 26, 31].forEach((x) => { box(scene, 1.1, 0.45, 1, '#c08a2e', x, 0, 2.6); box(scene, 1.1, 0.7, 0.25, '#8f6420', x, 0.4, 2.15); });
  addLabel('RUANG BELAJAR', new THREE.Vector3(23.5, 0.3, 5.6), 'room');
  addLabel('TAMAN', new THREE.Vector3(0, 0.3, 30), 'room');
  plant(scene, -35, 0, 5.5, 1.1); plant(scene, -11, 0, 5.5); plant(scene, 11, 0, 5.5); plant(scene, 35, 0, 5.5, 1.1);
  // lampu malam ruang bersama
  const nightLights = [[-23, 4, -3], [0, 4, -1], [23, 4, -2], [0, 5, 21]].map(([x, y, z]) => { const pl = new THREE.PointLight('#ffcf8a', 0, 20, 1.5); pl.position.set(x, y, z); scene.add(pl); return pl; });

  // ---------- Titik aktivitas ----------
  const SPOT = {
    ngopi: [...[-3, -1, 1, 3].map((x) => ({ x, y: 0, z: -2.75, face: Math.PI, sit: true })),
      { x: -1.2, y: 0, z: 1.25, face: 0, sit: true }, { x: 1.2, y: 0, z: 1.25, face: 0, sit: true }, { x: -1.2, y: 0, z: 3.75, face: Math.PI, sit: true }, { x: 1.2, y: 0, z: 3.75, face: Math.PI, sit: true }],
    belajar: [16, 21, 26, 31].map((x) => ({ x, y: 0, z: -4.25, face: 0, sit: true })),
    baca: [16, 21, 26, 31].map((x) => ({ x, y: 0, z: 2.55, face: 0, sit: true })),
    nonton: [-24.8, -23, -21.2].map((x) => ({ x, y: 0, z: -1.75, face: Math.PI, sit: true })),
    main: [{ x: -27, y: 0, z: -4.4, face: Math.PI, sit: true, low: true }, { x: -19, y: 0, z: -4.4, face: Math.PI, sit: true, low: true }],
    ngobrol: [[-32.5, -5], [-32.5, 1.5], [-12.5, 2.5], [13, 18.5]].map(([x, z]) => [{ x: x - 0.75, y: 0, z, face: Math.PI / 2 }, { x: x + 0.75, y: 0, z, face: -Math.PI / 2 }])
  };
  const roomSpot = (room, side, kind) => {
    const r = rooms[room] || rooms[0], dx = side ? 0.75 : -0.75;
    if (kind === 'tidur') return { x: r.cx + dx, y: 0.56, z: r.cz - 1.85, face: 0, lie: true };
    return { x: r.cx + dx, y: 0, z: r.cz - 0.35, face: 0, sit: true, phone: true };
  };

  // ---------- Rute ----------
  const areaOf = (p) => { const r = roomOfPoint(p); if (r) return 'room' + r.i; if (p.z > 7.2) return 'garden'; return 'open'; };
  function chain(p) {
    const r = roomOfPoint(p);
    if (r) return [{ x: r.door.x, y: 0, z: -12.3 }, { x: r.door.x, y: 0, z: -9.8 }];
    if (p.z > 7.2) return [{ x: 0, y: 0, z: 8.6 }, { x: 0, y: 0, z: 5.4 }];
    return [];
  }
  function route(from, to) {
    const a = areaOf(from), b = areaOf(to);
    if (a === b) return [{ ...to }];
    const p0 = { ...from, y: 0 };
    return [...chain(p0), ...chain(to).reverse(), { ...to }];
  }

  // ---------- Karakter ----------
  function faceTexture(photo, skin) {
    const tex = canvasTex(128, 128, (g) => {
      g.fillStyle = skin; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#2a1d14'; g.beginPath(); g.arc(42, 58, 7, 0, TAU); g.arc(86, 58, 7, 0, TAU); g.fill();
      g.strokeStyle = '#8a4a3a'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.arc(64, 78, 16, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
      g.fillStyle = 'rgba(240,120,110,.35)'; g.beginPath(); g.arc(30, 78, 8, 0, TAU); g.arc(98, 78, 8, 0, TAU); g.fill();
    });
    if (photo) { const img = new Image(); img.onload = () => { const g = tex.userData.g, s = Math.min(img.width, img.height); g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2 * 0.6, s, s, 0, 0, 128, 128); tex.needsUpdate = true; }; img.src = photo; }
    return tex;
  }
  const chars = {}, clickables = [];
  function makeChar(a) {
    const h = hash(a.key), skin = SKIN[h % SKIN.length], hair = HAIR[(h >> 3) % HAIR.length], shirt = a.color || '#8aa0b5';
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const legs = [-0.15, 0.15].map((x) => { const pv = new THREE.Group(); pv.position.set(x, 0.72, 0); body.add(pv); box(pv, 0.24, 0.72, 0.28, '#4a5568', 0, -0.72, 0); box(pv, 0.26, 0.12, 0.36, '#2a241d', 0, -0.72, 0.04); return pv; });
    box(body, 0.66, 0.74, 0.38, shirt, 0, 0.72, 0);
    const arms = [-0.43, 0.43].map((x) => { const pv = new THREE.Group(); pv.position.set(x, 1.4, 0); body.add(pv); box(pv, 0.2, 0.62, 0.22, shirt, 0, -0.62, 0); box(pv, 0.18, 0.14, 0.2, skin, 0, -0.74, 0); return pv; });
    const head = new THREE.Group(); head.position.set(0, 1.5, 0); body.add(head);
    const skinM = mat(skin);
    const hm = new THREE.Mesh(BOX, [skinM, skinM, skinM, skinM, new THREE.MeshStandardMaterial({ map: faceTexture(a.photo, skin) }), skinM]);
    hm.scale.set(0.54, 0.54, 0.5); hm.position.y = 0.29; hm.castShadow = true; head.add(hm);
    box(head, 0.58, 0.16, 0.54, hair, 0, 0.5, -0.02); box(head, 0.58, 0.38, 0.12, hair, 0, 0.22, -0.24);
    // properti di tangan kanan
    const hand = new THREE.Group(); hand.position.set(0, -0.8, 0.08); arms[1].add(hand);
    const props = {
      mug: cyl(hand, 0.09, 0.18, '#ffffff', 0, -0.05, 0.05),
      book: box(hand, 0.42, 0.06, 0.3, ['#c9446a', '#3b6ea8', '#d6b26e'][h % 3], -0.2, 0, 0.12),
      phone: box(hand, 0.12, 0.02, 0.22, '#111', 0, 0, 0.08),
      pad: box(hand, 0.34, 0.06, 0.16, '#222', -0.2, 0, 0.1)
    };
    Object.values(props).forEach((p) => { p.visible = false; });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 32), new THREE.MeshBasicMaterial({ color: '#c9446a', transparent: true, opacity: 0, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; root.add(ring);
    const blanket = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: '#a52a4a', roughness: 1 }));
    blanket.scale.set(1.0, 0.42, 1.55); blanket.position.set(0, 0.2, -0.62); blanket.castShadow = true; blanket.visible = false; root.add(blanket);
    root.traverse((o) => { if (o.isMesh) o.userData.key = a.key; });
    root.visible = false; scene.add(root); clickables.push(root);
    const c = { key: a.key, data: a, root, body, legs, arms, head, props, ring, blanket, path: [], seat: null, walkT: Math.random() * 10, speed: 2.6 + Math.random() * 0.5,
      tag: addLabel('', new THREE.Vector3(), 'tag'), act: addLabel('', new THREE.Vector3(), 'step'), bubble: addLabel('', new THREE.Vector3(), 'bubble') };
    c.tag.char = c; c.act.char = c; c.bubble.char = c;
    chars[a.key] = c; return c;
  }

  // ---------- Tujuan per agen ----------
  let active = data.active;
  function targetFor(c) {
    const h = c.data.home;
    if (!active || !h || h.act === 'lembur') return GATE;
    if (h.act === 'tidur' || h.act === 'santai') return roomSpot(h.room, h.side, h.act);
    if (h.act === 'jalan') return { ...LOOP[(hash(c.key) + Math.floor(Date.now() / 1000)) % LOOP.length], walkLoop: true };
    if (h.act === 'ngobrol') { const pair = SPOT.ngobrol[h.spot] || SPOT.ngobrol[0]; const mine = c.key < (h.partner || '') ? 0 : 1; return pair[mine]; }
    const list = SPOT[h.act];
    return list ? list[h.spot % list.length] : roomSpot(h.room, h.side, 'santai');
  }
  const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.z - b.z) < 0.01 && Math.abs((a.y || 0) - (b.y || 0)) < 0.01;
  function goTo(c, spot) {
    const last = c.path.length ? c.path[c.path.length - 1] : c.seat;
    if (last && same(last, spot) && !spot.walkLoop) return;
    if (!c.root.visible) {
      if (spot.hide) return;
      c.root.position.set(GATE.x, 0, GATE.z); c.root.visible = true; // datang dari pagar depan
    }
    const from = { x: c.root.position.x, y: 0, z: c.root.position.z };
    const fromRoom = c.seat && (c.seat.lie || c.seat.sit) ? { ...c.seat, y: 0 } : from;
    c.path = route(fromRoom, { ...spot, y: spot.lie ? 0 : spot.y || 0 });
    c.final = spot; c.seat = null; c.pose = 'walk';
    if (spot.hide) c.path = [...route(from, { x: 0, y: 0, z: 8.6 }), { x: 0, y: 0, z: 30 }, GATE];
  }
  const retarget = (c) => goTo(c, targetFor(c));

  (st.agents || []).forEach((a) => { const c = makeChar({ ...a, home: (data.agents.find((x) => x.key === a.key) || {}).home }); const t = targetFor(c); if (!t.hide) { c.root.position.set(t.x, t.y || 0, t.z); c.root.visible = true; c.seat = t; c.final = t; c.pose = t.lie ? 'lie' : t.sit ? 'sit' : 'stand'; c.root.rotation.y = t.face || 0; } });

  S.on('agent', (d) => { const c = chars[d.key]; if (!c) return; const before = JSON.stringify(c.data.home); Object.assign(c.data, d); if (JSON.stringify(c.data.home) !== before) retarget(c); });
  S.on('office', (o) => { const was = active; active = o.mode === 'pulang'; if (was !== active) setTimeout(() => Object.values(chars).forEach(retarget), 300); });
  S.on('roster', async () => { const s2 = await S.api('/api/state'); s2.agents.forEach((a) => { if (!chars[a.key]) makeChar(a); }); });

  // ---------- Kamera ----------
  const views = [{ id: 'all', label: 'Seluruh rumah', target: new THREE.Vector3(0, 0, 5), size: 96 },
    ...rooms.map((r) => ({ id: 'kamar' + (r.i + 1), label: `Kamar ${r.i + 1}`, room: r.i, target: new THREE.Vector3(r.cx, 0, r.cz - 1.2), size: 25 })),
    { id: 'tv', label: 'Ruang TV', target: new THREE.Vector3(-23, 0, -3), size: 24 },
    { id: 'dapur', label: 'Dapur & Kopi', target: new THREE.Vector3(0, 0, -1.5), size: 22 },
    { id: 'belajar', label: 'Ruang Belajar', target: new THREE.Vector3(23.5, 0, -1.5), size: 26 },
    { id: 'taman', label: 'Taman', target: new THREE.Vector3(0, 0, 20), size: 56 }];
  const DIR = new THREE.Vector3(0, Math.sin(0.95), Math.cos(0.95));
  const cam = { target: views[0].target.clone(), dist: 100, from: null, to: null, t: 1 };
  const distFor = (size) => { const aspect = Math.max(0.5, container.clientWidth / Math.max(1, container.clientHeight)); const v = THREE.MathUtils.degToRad(camera.fov); return Math.max((size / 2) / (Math.tan(v / 2) * aspect), (size * 0.62 / 2) / Math.tan(v / 2)) * 1.02; };
  let current = views[0];
  function focus(id, instant) {
    const v = views.find((x) => x.id === id) || views[0]; current = v;
    cam.from = { target: cam.target.clone(), dist: cam.dist }; cam.to = { target: v.target.clone(), dist: distFor(v.size) }; cam.t = instant ? 1 : 0;
    if (instant) { cam.target.copy(cam.to.target); cam.dist = cam.to.dist; }
    rooms.forEach((r) => r.lbl.el.classList.toggle('active', v.room === r.i));
    opts.onView && opts.onView(v); return v;
  }
  const el = renderer.domElement; let drag = null, moved = 0;
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; moved = 0; });
  el.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy); drag = { x: e.clientX, y: e.clientY }; const k = cam.dist / container.clientHeight * 0.85; cam.target.x -= dx * k; cam.target.z -= dy * k * 1.25; cam.t = 1; });
  el.addEventListener('pointerup', (e) => { if (drag && moved < 6) click(e); drag = null; });
  el.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = THREE.MathUtils.clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 10, 240); cam.t = 1; }, { passive: false });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function click(e) {
    const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(clickables.filter((o) => o.visible), true)[0];
    if (hit && opts.onAgentClick) opts.onAgentClick(hit.object.userData.key);
  }
  overlay.addEventListener('click', (e) => { const l = e.target.closest('.o3d-label.room'); if (!l) return; const r = rooms.find((x) => x.lbl.el === l); if (r) focus('kamar' + (r.i + 1)); });
  function select(key) { Object.values(chars).forEach((c) => { c.selected = c.key === key; }); }

  // ---------- Animasi ----------
  const tmp = new THREE.Vector3();
  const ACT_TXT = { tidur: 'Zzz', santai: 'Santai', ngopi: 'Ngopi', belajar: 'Belajar', baca: 'Baca', nonton: 'Nonton TV', main: 'Main game', ngobrol: 'Ngobrol', jalan: 'Jalan-jalan' };
  // jalan-jalan: keliling jalan setapak taman (lanjut ke titik berikutnya terus-menerus)
  function loopWalk(c) {
    const p = c.root.position; let start = 0, best = 1e9;
    LOOP.forEach((q, i) => { const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d < best) { best = d; start = i; } });
    const dir = hash(c.key) % 2 ? 1 : -1;
    c.path = Array.from({ length: 6 }, (_, k) => ({ ...LOOP[((start + dir * (1 + k)) % LOOP.length + LOOP.length) % LOOP.length] }));
    c.seat = null; c.pose = 'walk';
  }
  function stepChar(c, dt, t) {
    const p = c.root.position;
    if (c.path.length) {
      const wp = c.path[0];
      tmp.set(wp.x - p.x, (wp.y || 0) - p.y, wp.z - p.z);
      const dist = tmp.length(), step = c.speed * dt;
      if (dist <= step) {
        p.set(wp.x, wp.y || 0, wp.z); c.path.shift();
        if (!c.path.length) {
          if (wp.hide) { c.root.visible = false; c.seat = null; }
          else if (c.final && c.final.walkLoop && c.data.home && c.data.home.act === 'jalan') loopWalk(c);
          else { c.seat = c.final; c.pose = c.final.lie ? 'lie' : c.final.sit ? 'sit' : 'stand'; if (c.final.lie) p.y = c.final.y; }
        }
      } else { p.addScaledVector(tmp, step / dist); if (Math.abs(tmp.x) + Math.abs(tmp.z) > 0.01) c.root.rotation.y = lerpAngle(c.root.rotation.y, Math.atan2(tmp.x, tmp.z), Math.min(1, dt * 10)); }
      c.walkT += dt * 8;
    } else if (c.root.visible && c.final && c.final.walkLoop && c.data.home && c.data.home.act === 'jalan') loopWalk(c);
    else if (c.seat) c.root.rotation.y = lerpAngle(c.root.rotation.y, c.seat.face || 0, Math.min(1, dt * 6));
    const walking = c.path.length > 0, act = c.data.home && c.data.home.act;
    const lie = !walking && c.pose === 'lie', sit = !walking && c.pose === 'sit';
    const sw = walking ? Math.sin(c.walkT) * 0.6 : 0;
    // berbaring: putar badan horizontal di atas kasur
    c.body.rotation.x = lerp(c.body.rotation.x, lie ? -Math.PI / 2 : 0, 0.15);
    c.body.position.y = lerp(c.body.position.y, lie ? 0.25 + Math.sin(t * 1.2 + c.walkT) * 0.01 : sit ? (c.seat && c.seat.low ? -0.45 : -0.28) : walking ? Math.abs(Math.sin(c.walkT)) * 0.05 : Math.sin(t * 2 + c.walkT) * 0.012, 0.2);
    c.legs[0].rotation.x = lerp(c.legs[0].rotation.x, sit ? -Math.PI / 2 : sw, 0.3);
    c.legs[1].rotation.x = lerp(c.legs[1].rotation.x, sit ? -Math.PI / 2 : -sw, 0.3);
    let a0 = walking ? -sw * 0.8 : 0, a1 = walking ? sw * 0.8 : 0, hy = 0, hx = 0;
    const speaking = !!c.data.say;
    if (!walking) {
      if (act === 'ngopi' && sit) { a1 = (t + c.walkT) % 5 < 1.2 ? -2.3 : -1.0; a0 = -0.5; hx = (t + c.walkT) % 5 < 1.2 ? -0.2 : 0; }
      else if (act === 'belajar' && sit) { a1 = -1.2 + Math.sin(t * 9) * 0.08; a0 = -1.0; hx = 0.35; }
      else if (act === 'baca' && sit) { a0 = a1 = -1.15; hx = 0.3; }
      else if (act === 'main' && sit) { a0 = -1.1 + Math.sin(t * 14) * 0.06; a1 = -1.1 + Math.sin(t * 14 + 1) * 0.06; }
      else if (act === 'santai' && sit) { a1 = -1.3; a0 = -0.4; hx = 0.3; }
      else if (act === 'nonton' && sit) { a0 = a1 = -0.45; hy = Math.sin(t * 0.3) * 0.1; }
      else if (act === 'ngobrol') { a1 = speaking ? -1.0 + Math.sin(t * 5) * 0.5 : -0.1; a0 = speaking ? -0.4 + Math.sin(t * 4) * 0.2 : 0; hy = Math.sin(t * 1.5) * 0.15; }
      else if (lie) { a0 = a1 = 0; }
      else if (sit) { a0 = a1 = -0.5; }
    }
    c.arms[0].rotation.x = lerp(c.arms[0].rotation.x, a0, 0.25); c.arms[1].rotation.x = lerp(c.arms[1].rotation.x, a1, 0.25);
    c.head.rotation.x = lerp(c.head.rotation.x, hx, 0.2); c.head.rotation.y = lerp(c.head.rotation.y, hy, 0.2);
    c.props.mug.visible = act === 'ngopi' && sit; c.props.book.visible = (act === 'baca' || act === 'belajar') && sit;
    c.props.phone.visible = act === 'santai' && sit; c.props.pad.visible = act === 'main' && sit;
    c.blanket.visible = lie && Math.abs(c.body.rotation.x) > 1.3;
    if (c.blanket.visible && c.data.home) c.blanket.material.color.set(duvet[c.data.home.room % duvet.length]);
    c.ring.material.opacity = lerp(c.ring.material.opacity, c.selected ? 0.85 : 0, 0.2);
  }

  // Siang / malam
  let lastF = -1;
  const daylight = (h) => (h < 4.5 || h >= 19.5 ? 0 : h < 6 ? (h - 4.5) / 1.5 : h < 17.5 ? 1 : 1 - (h - 17.5) / 2);
  const DAY = new THREE.Color('#2a1c22'), NIGHT = new THREE.Color('#06050a'), tc = new THREE.Color();
  function updateDaylight() {
    const f = Math.round(daylight(S.simHour()) * 100) / 100;
    if (f !== lastF) {
      lastF = f;
      hemi.intensity = 0.2 + 0.95 * f; hemi.color.set(f > 0.5 ? '#fff8ee' : '#9fb0ff');
      sun.intensity = 0.12 + 1.4 * f; sun.color.set(f > 0.7 ? '#fff3e0' : f > 0.2 ? '#ffb27a' : '#7d8dff');
      tc.copy(NIGHT).lerp(DAY, f); scene.background.copy(tc); scene.fog.color.copy(tc);
      winMat.color.set(f > 0.3 ? '#cfe2ee' : '#1b2340'); winMat.emissive.set(f > 0.3 ? '#bcd8ea' : '#26335f');
      renderer.toneMappingExposure = 0.85 + 0.2 * f;
    }
    const on = f < 0.75;
    nightLights.forEach((pl) => { pl.intensity = on ? 28 * (1 - f) : 0; });
    lampPostMats.forEach((m) => { m.emissiveIntensity = on ? 2 : 0; });
    // lampu kamar menyala bila ada penghuni yang masih bangun
    rooms.forEach((r, i) => {
      const occ = Object.values(chars).filter((c) => c.root.visible && c.data.home && c.data.home.room === i && ['santai', 'tidur'].includes(c.data.home.act));
      const awake = occ.some((c) => c.data.home.act !== 'tidur');
      roomLamps[i].emissiveIntensity = on ? (awake ? 2.2 : occ.length ? 0.35 : 0) : 0;
    });
    for (let i = 8; i < roomLamps.length; i++) roomLamps[i].emissiveIntensity = on ? 1.8 : 0;
  }

  // Label overlay
  const v3 = new THREE.Vector3();
  function updateLabels() {
    const close = cam.dist < 80, W = container.clientWidth, Hh = container.clientHeight;
    for (const l of labels) {
      let pos = l.pos, show = true;
      if (l.char) {
        const c = l.char; show = c.root.visible;
        const lying = c.pose === 'lie' && !c.path.length;
        const top = lying ? 1.2 : c.pose === 'sit' && !c.path.length ? 2.05 : 2.35;
        pos = tmp.set(c.root.position.x, c.root.position.y + top + (l.kind === 'bubble' ? 0.55 : l.kind === 'step' ? 0.32 : 0), c.root.position.z + (lying ? -1.8 : 0));
        if (show && l.kind === 'tag') { show = close || c.selected; const h = S.esc(c.data.name); if (l.html !== h) { l.el.innerHTML = h; l.html = h; } }
        else if (show && l.kind === 'step') {
          const act = c.data.home && c.data.home.act; show = !!act && act !== 'lembur' && (act === 'tidur' || close);
          const h = act ? (act === 'tidur' ? '<b>Zzz</b>' : S.esc(ACT_TXT[act] || act)) : '';
          if (l.html !== h) { l.el.innerHTML = h; l.html = h; l.el.classList.toggle('zzz', act === 'tidur'); }
        } else if (show && l.kind === 'bubble') { show = !!c.data.say; const h = S.esc(String(c.data.say || '').slice(0, 120)); if (show && l.html !== h) { l.el.innerHTML = h; l.el.classList.add('say'); l.html = h; } }
      }
      if (!show) { l.el.style.display = 'none'; continue; }
      v3.copy(pos).project(camera);
      const x = (v3.x * 0.5 + 0.5) * W, y = (-v3.y * 0.5 + 0.5) * Hh;
      if (v3.z > 1 || x < -150 || y < -60 || x > W + 150 || y > Hh + 60) { l.el.style.display = 'none'; continue; }
      l.el.style.display = ''; l.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
    }
  }

  function resize() { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(() => { resize(); if (cam.t >= 1 && current) cam.dist = distFor(current.size); }); ro.observe(container);
  resize(); focus(opts.view || 'all', true);

  let last = performance.now(), running = true;
  function frame(now) {
    if (!running) return; requestAnimationFrame(frame);
    const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now; const t = now / 1000;
    if (cam.t < 1 && cam.to) { cam.t = Math.min(1, cam.t + Math.min(0.25, raw) / 0.9); const k = ease(cam.t); cam.target.lerpVectors(cam.from.target, cam.to.target, k); cam.dist = lerp(cam.from.dist, cam.to.dist, k); }
    camera.position.copy(cam.target).addScaledVector(DIR, cam.dist); camera.lookAt(cam.target);
    Object.values(chars).forEach((c) => stepChar(c, dt, t));
    animators.forEach((fn) => fn(t));
    updateDaylight();
    renderer.render(scene, camera); updateLabels();
  }
  requestAnimationFrame(frame);

  return { views, focus, select, get active() { return active; }, agent: (k) => chars[k] && chars[k].data, agents: () => Object.values(chars).map((c) => c.data), destroy() { running = false; ro.disconnect(); renderer.dispose(); } };
}
