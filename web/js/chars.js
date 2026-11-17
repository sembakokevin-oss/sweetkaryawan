// Karakter yang bisa dipilih pengunjung di mode EXPLORE (model voxel buatan sendiri).
//  - kama   : Kama Pinkypie — gadis serba pink, rambut kuncir dua & pita besar
//  - garuda : Satria Garuda Hitam — ksatria berbaju zirah hitam, aksen emas, visor merah, sayap emas di punggung
import * as THREE from 'three';

export const CHARACTERS = {
  kama: { key: 'kama', name: 'Kama Pinkypie', color: '#ff6fae', desc: 'Sosok fiksi yang merupakan hasil gambar dari Kamala Veddira Soekarnoputri Salawati.' },
  garuda: { key: 'garuda', name: 'Satria Garuda Hitam', color: '#d6b26e', desc: 'Sosok fiksi ciptaan Bang Jilly, yang pernah dibuat filmnya dan menggambarkan semangat juang Indonesia.' }
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPH = new THREE.SphereGeometry(1, 16, 12);
const M = new Map();
const mat = (c, o = {}) => { const k = c + JSON.stringify(o); if (!M.has(k)) M.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, ...o })); return M.get(k); };
function box(p, w, h, d, m, x, y, z) { const b = new THREE.Mesh(BOX, typeof m === 'string' ? mat(m) : m); b.scale.set(w, h, d); b.position.set(x, y + h / 2, z); b.castShadow = true; p.add(b); return b; }
function sph(p, r, m, x, y, z, sy = 1) { const s = new THREE.Mesh(SPH, typeof m === 'string' ? mat(m) : m); s.scale.set(r, r * sy, r); s.position.set(x, y, z); s.castShadow = true; p.add(s); return s; }
function tex(draw) { const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }

function kamaFace() {
  return tex((g) => {
    g.fillStyle = '#ffe1cf'; g.fillRect(0, 0, 128, 128);
    [[42, 62], [86, 62]].forEach(([x, y]) => {
      g.fillStyle = '#2a1430'; g.beginPath(); g.ellipse(x, y, 10, 13, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff5fa8'; g.beginPath(); g.ellipse(x, y + 3, 6.5, 8, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 3, y - 5, 3.6, 0, Math.PI * 2); g.arc(x + 3, y + 4, 1.6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2a1430'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 12, y - 14); g.lineTo(x - 4, y - 17); g.stroke();
    });
    g.fillStyle = 'rgba(255,110,170,.45)'; g.beginPath(); g.ellipse(28, 84, 10, 6, 0, 0, Math.PI * 2); g.ellipse(100, 84, 10, 6, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c2406f'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.arc(64, 84, 9, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  });
}
function visorTex() {
  return tex((g) => {
    g.fillStyle = '#121218'; g.fillRect(0, 0, 128, 128);
    const gr = g.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, '#5b0a0a'); gr.addColorStop(0.5, '#ff2a2a'); gr.addColorStop(1, '#5b0a0a');
    g.fillStyle = gr; g.beginPath(); g.moveTo(10, 52); g.lineTo(64, 70); g.lineTo(118, 52); g.lineTo(118, 66); g.lineTo(64, 86); g.lineTo(10, 66); g.closePath(); g.fill();
    g.fillStyle = '#d6b26e'; g.fillRect(58, 14, 12, 36); g.beginPath(); g.moveTo(64, 92); g.lineTo(52, 118); g.lineTo(76, 118); g.closePath(); g.fill();
  });
}

// Mengembalikan struktur yang sama dengan karakter kantor: { root, body, legs, arms, head, wings }
export function buildModel(kind) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const k = CHARACTERS[kind] ? kind : 'kama';
  let legs, arms, head, wings = null;
  if (k === 'kama') {
    const skin = '#ffe1cf', pink = '#ff6fae', pink2 = '#ff9ccf', hair = '#ff4f9a';
    legs = [-0.14, 0.14].map((x) => { const pv = new THREE.Group(); pv.position.set(x, 0.72, 0); body.add(pv); box(pv, 0.2, 0.62, 0.24, skin, 0, -0.62, 0); box(pv, 0.24, 0.16, 0.34, '#ffffff', 0, -0.74, 0.04); return pv; });
    box(body, 0.62, 0.42, 0.36, pink, 0, 1.0, 0);                    // badan
    box(body, 0.86, 0.36, 0.56, pink2, 0, 0.66, 0);                  // rok mengembang
    box(body, 0.9, 0.06, 0.6, '#ffffff', 0, 0.66, 0);                // renda rok
    box(body, 0.5, 0.08, 0.38, '#ffffff', 0, 1.36, 0.01);            // kerah
    box(body, 0.14, 0.14, 0.04, '#ff2f86', 0, 1.22, 0.2);            // pita dada
    arms = [-0.42, 0.42].map((x) => { const pv = new THREE.Group(); pv.position.set(x, 1.38, 0); body.add(pv); box(pv, 0.2, 0.26, 0.22, pink2, 0, -0.26, 0); box(pv, 0.16, 0.36, 0.18, skin, 0, -0.62, 0); return pv; });
    head = new THREE.Group(); head.position.set(0, 1.46, 0); body.add(head);
    const skinM = mat(skin);
    const hm = new THREE.Mesh(BOX, [skinM, skinM, skinM, skinM, new THREE.MeshStandardMaterial({ map: kamaFace(), roughness: 0.8 }), skinM]);
    hm.scale.set(0.58, 0.56, 0.52); hm.position.y = 0.3; hm.castShadow = true; head.add(hm);
    box(head, 0.64, 0.2, 0.58, hair, 0, 0.52, -0.02); box(head, 0.64, 0.5, 0.14, hair, 0, 0.1, -0.24);
    box(head, 0.12, 0.42, 0.5, hair, -0.31, 0.12, -0.02); box(head, 0.12, 0.42, 0.5, hair, 0.31, 0.12, -0.02);
    box(head, 0.5, 0.1, 0.06, hair, 0, 0.5, 0.25);                   // poni
    [-1, 1].forEach((s) => { sph(head, 0.2, hair, s * 0.44, 0.34, -0.12, 1.4); sph(head, 0.15, hair, s * 0.5, 0.06, -0.14, 1.5); }); // kuncir dua
    [-1, 1].forEach((s) => { const b = box(head, 0.24, 0.18, 0.08, '#ff2f86', s * 0.16, 0.66, 0.02); b.rotation.z = s * 0.35; }); sph(head, 0.07, '#ff2f86', 0, 0.75, 0.04); // pita besar
  } else {
    const blk = mat('#16161c', { metalness: 0.6, roughness: 0.35 }), gold = mat('#d6b26e', { metalness: 0.85, roughness: 0.25, emissive: '#5a4210', emissiveIntensity: 0.25 });
    legs = [-0.16, 0.16].map((x) => { const pv = new THREE.Group(); pv.position.set(x, 0.72, 0); body.add(pv); box(pv, 0.26, 0.72, 0.3, blk, 0, -0.72, 0); box(pv, 0.28, 0.08, 0.32, gold, 0, -0.36, 0.01); box(pv, 0.3, 0.14, 0.4, '#0b0b0e', 0, -0.74, 0.04); return pv; });
    box(body, 0.72, 0.78, 0.42, blk, 0, 0.7, 0);
    const v1 = box(body, 0.1, 0.42, 0.04, gold, -0.12, 1.02, 0.22); v1.rotation.z = 0.6;   // lambang garuda (V emas)
    const v2 = box(body, 0.1, 0.42, 0.04, gold, 0.12, 1.02, 0.22); v2.rotation.z = -0.6;
    box(body, 0.16, 0.12, 0.05, gold, 0, 0.88, 0.22);
    box(body, 0.74, 0.08, 0.44, gold, 0, 0.74, 0);                   // sabuk
    const core = box(body, 0.1, 0.1, 0.03, new THREE.MeshStandardMaterial({ color: '#ff3030', emissive: '#ff2020', emissiveIntensity: 1.6 }), 0, 1.24, 0.225);
    core.castShadow = false;
    arms = [-0.47, 0.47].map((x) => { const pv = new THREE.Group(); pv.position.set(x, 1.42, 0); body.add(pv); box(pv, 0.3, 0.2, 0.32, gold, 0, -0.1, 0); box(pv, 0.22, 0.6, 0.24, blk, 0, -0.66, 0); box(pv, 0.24, 0.14, 0.26, gold, 0, -0.62, 0); return pv; });
    head = new THREE.Group(); head.position.set(0, 1.5, 0); body.add(head);
    const hm = new THREE.Mesh(BOX, [blk, blk, blk, blk, new THREE.MeshStandardMaterial({ map: visorTex(), roughness: 0.4, metalness: 0.5, emissive: '#ff2020', emissiveMap: visorTex(), emissiveIntensity: 0.6 }), blk]);
    hm.scale.set(0.56, 0.58, 0.54); hm.position.y = 0.3; hm.castShadow = true; head.add(hm);
    box(head, 0.08, 0.26, 0.4, gold, 0, 0.58, -0.04);               // jambul helm
    [-1, 1].forEach((s) => { const w = box(head, 0.06, 0.12, 0.34, gold, s * 0.3, 0.42, -0.06); w.rotation.x = -0.5; w.rotation.z = s * -0.3; });
    // sayap emas di punggung
    wings = [-1, 1].map((s) => {
      const pv = new THREE.Group(); pv.position.set(s * 0.18, 1.16, -0.24); body.add(pv);
      const main = box(pv, 0.82, 0.3, 0.05, gold, s * 0.38, 0.05, 0); main.rotation.z = s * 0.5;
      [[0.7, 0.16, -0.12, 0.28, blk], [0.6, 0.14, -0.3, 0.1, gold], [0.48, 0.12, -0.45, -0.05, blk]].forEach(([w, h, y, rz, m2], i) => { const f = box(pv, w, h, 0.04, m2, s * (0.3 - i * 0.03), y, -0.02); f.rotation.z = s * rz; });
      pv.rotation.y = s * -0.35; return pv;
    });
  }
  root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return { root, body, legs, arms, head, wings };
}

// Pratinjau berputar untuk kartu pilih karakter
export function preview(canvas, kind) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0, 1.5, 5.4); cam.lookAt(0, 1.15, 0);
  sc.add(new THREE.HemisphereLight('#fff6ee', '#40202a', 1.4)); const d = new THREE.DirectionalLight('#ffffff', 1.6); d.position.set(2, 4, 3); sc.add(d);
  const m = buildModel(kind); sc.add(m.root);
  let on = true;
  const resize = () => { const w = canvas.clientWidth || 200, h = canvas.clientHeight || 200; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  resize();
  const loop = (t) => { if (!on) return; requestAnimationFrame(loop); m.root.rotation.y = Math.sin(t / 1400) * 0.7; m.body.position.y = Math.sin(t / 300) * 0.02; if (m.wings) m.wings.forEach((w, i) => { w.rotation.y = (i ? 1 : -1) * (0.35 + Math.sin(t / 260) * 0.15); }); r.render(sc, cam); };
  requestAnimationFrame(loop);
  return { stop() { on = false; r.dispose(); } };
}
