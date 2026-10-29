// Рисуване на карта от кутии: всяка кутия е цяла повърхност с текстура (без кубчета). Страните са разделени на малки клетки, за да има плавно нощно осветление
// от лампите (светлината се смята по върховете – без динамични светлини, затова е евтино). Покривите (gable) са само за гледане.
import { brushTextureDefs } from './btextures.js';

const TILE_CACHE = new Map();
function texFor(THREE, key, defs) {
  const k = key; let t = TILE_CACHE.get(k); if (t) return t;
  const d = defs[key]; const tex = new THREE.CanvasTexture(d.c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  t = { tex, scale: d.scale, alpha: !!d.alpha }; TILE_CACHE.set(k, t); return t;
}

export function buildBrushGroup(THREE, json) {
  const defs = brushTextureDefs(), env = json.env || {}, amb = env.ambient ?? 0.4, lamps = (json.lamps || []).map(([x, y, z, r, c]) => ({ x, y, z, r, c: new THREE.Color(c || '#ffd9a0') }));
  const group = new THREE.Group(), buckets = new Map();
  const base = new THREE.Color(env.night ? 0x7a86c8 : 0xffffff).multiplyScalar(env.night ? 1.0 + amb * 0.9 : 0.5 + amb);
  const bucket = key => { let b = buckets.get(key); if (!b) buckets.set(key, b = { pos: [], nrm: [], uv: [], col: [], idx: [] }); return b; };
  const hash = (a, b, c) => { let n = Math.imul(Math.floor(a * 7), 374761393) ^ Math.imul(Math.floor(b * 7), 668265263) ^ Math.imul(Math.floor(c * 7), 1274126177); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const light = (x, y, z, nx, ny, nz, shade, out) => {
    let r = base.r * shade, g = base.g * shade, b = base.b * shade;
    for (const L of lamps) { const dx = L.x - x, dy = L.y - y, dz = L.z - z, d = Math.hypot(dx, dy, dz); if (d >= L.r) continue; const t = 1 - d / L.r, f = Math.max(0.2, Math.min(1, (nx * dx + ny * dy + nz * dz) / (d || 1) * 0.7 + 0.35)); const k = t * t * 1.5 * f; r += L.c.r * k; g += L.c.g * k; b += L.c.b * k; }
    out.push(r, g, b);
  };
  // страна: начало O, оси U и V (единични), дължини lu, lv, нормала N, избор на текстурни координати по света
  const face = (key, O, U, V, lu, lv, N, shade, scale) => {
    const bk = bucket(key), nu = Math.max(1, Math.min(32, Math.ceil(lu / 1.0))), nv = Math.max(1, Math.min(32, Math.ceil(lv / 1.0))), b0 = bk.pos.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = lu * i / nu, c = lv * j / nv, x = O[0] + U[0] * a + V[0] * c, y = O[1] + U[1] * a + V[1] * c, z = O[2] + U[2] * a + V[2] * c;
      bk.pos.push(x, y, z); bk.nrm.push(...N);
      const uu = Math.abs(N[1]) > 0.5 ? x : Math.abs(N[0]) > 0.5 ? z : x, vv = Math.abs(N[1]) > 0.5 ? z : y; bk.uv.push(uu / scale, vv / scale);
      light(x, y, z, N[0], N[1], N[2], shade, bk.col);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const p = b0 + j * (nu + 1) + i, q = p + 1, r = p + nu + 1, s = r + 1; bk.idx.push(p, r, q, q, r, s); }
  };
  const box = (x1, y1, z1, x2, y2, z2, key, scale, skipBottom) => {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, tint = 0.9 + hash(x1, y1, z1) * 0.2;
    // +y (горе)
    face(key, [x1, y2, z1], [1, 0, 0], [0, 0, 1], dx, dz, [0, 1, 0], 1.0 * tint, scale);
    if (!skipBottom) face(key, [x1, y1, z2], [1, 0, 0], [0, 0, -1], dx, dz, [0, -1, 0], 0.5 * tint, scale);
    face(key, [x2, y1, z1], [0, 0, 1], [0, 1, 0], dz, dy, [1, 0, 0], 0.82 * tint, scale);            // +x
    face(key, [x1, y1, z2], [0, 0, -1], [0, 1, 0], dz, dy, [-1, 0, 0], 0.82 * tint, scale);           // -x
    face(key, [x2, y1, z2], [-1, 0, 0], [0, 1, 0], dx, dy, [0, 0, 1], 0.92 * tint, scale);            // +z
    face(key, [x1, y1, z1], [1, 0, 0], [0, 1, 0], dx, dy, [0, 0, -1], 0.92 * tint, scale);           // -z
  };
  for (const b of json.brushes) {
    const [x1, y1, z1, x2, y2, z2, tex = 'concrete', fl = ''] = b;
    let key = tex; if (tex === 'glass') key = hash(x1, z1, 3) < 0.45 ? 'glassLit' : 'glassDark';
    if (!defs[key]) key = 'concrete';
    const t = texFor(THREE, key, defs);
    box(Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2), Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2), key, t.scale, Math.min(y1, y2) <= 1.001 && tex !== 'step' && tex !== 'crate' && tex !== 'barrel' && tex !== 'fence');
    void fl;
  }
  // покриви (само за гледане)
  for (const d of json.decor || []) {
    if (d.type !== 'gable') continue;
    const rk = d.tex || 'roof', gk = d.gtex || 'brick', rs = texFor(THREE, rk, defs).scale, gs = texFor(THREE, gk, defs).scale, ov = 0.5, x1 = d.x1 - ov, x2 = d.x2 + ov, z1 = d.z1 - ov, z2 = d.z2 + ov, y = d.y, h = d.h;
    const quad = (key, scale, p, shade, n) => { const bk = bucket(key), b0 = bk.pos.length / 3; for (const q of p) { bk.pos.push(...q); bk.nrm.push(...n); bk.uv.push((q[0] + q[2]) / scale, q[1] * 1.4 / scale + q[2] * 0.2 / scale); light(q[0], q[1], q[2], n[0], n[1], n[2], shade, bk.col); } bk.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3); };
    if (d.axis === 'z') {
      const xm = (x1 + x2) / 2, sl = Math.hypot(xm - x1, h), n1 = [-h / sl, (xm - x1) / sl, 0], n2 = [h / sl, (xm - x1) / sl, 0];
      quad(rk, rs, [[x1, y, z1], [x1, y, z2], [xm, y + h, z2], [xm, y + h, z1]], 0.78, n1); quad(rk, rs, [[x2, y, z2], [x2, y, z1], [xm, y + h, z1], [xm, y + h, z2]], 0.95, n2);
      for (const [zz, nz] of [[d.z1, -1], [d.z2, 1]]) { const bk = bucket(gk), b0 = bk.pos.length / 3, xa = d.x1, xb = d.x2, xmid = (xa + xb) / 2; for (const q of [[xa, y, zz], [xb, y, zz], [xmid, y + h * 0.86, zz]]) { bk.pos.push(...q); bk.nrm.push(0, 0, nz); bk.uv.push(q[0] / gs, q[1] / gs); light(q[0], q[1], q[2], 0, 0, nz, 0.9, bk.col); } bk.idx.push(...(nz > 0 ? [b0, b0 + 1, b0 + 2] : [b0, b0 + 2, b0 + 1])); }
    }
  }
  for (const [key, bk] of buckets) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3)); g.setIndex(bk.idx); g.computeBoundingSphere();
    const t = texFor(THREE, key, defs), glass = key.startsWith('glass');
    const mat = new THREE.MeshBasicMaterial({ map: t.tex, vertexColors: true, transparent: glass, opacity: glass ? 0.9 : 1, alphaTest: t.alpha ? 0.5 : 0, side: t.alpha ? THREE.DoubleSide : THREE.FrontSide });
    group.add(new THREE.Mesh(g, mat));
  }
  return group;
}

// нощно небе: звезди, луна и градски силует с осветени прозорци по хоризонта
export function buildNightSky(THREE, env) {
  const grp = new THREE.Group(), top = new THREE.Color(env.sky || '#0d0a1f'), hor = new THREE.Color(env.fogColor || '#241a44');
  const geo = new THREE.SphereGeometry(235, 24, 14), col = [], p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const h = Math.max(0, p.getY(i) / 235), t = Math.pow(h, 0.55), c = hor.clone().lerp(top, t); col.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  grp.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  const sp = []; for (let i = 0; i < 380; i++) { const a = Math.random() * Math.PI * 2, el = 0.12 + Math.random() * 1.3, r = 225; sp.push(Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  grp.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false })));
  const mc = document.createElement('canvas'); mc.width = mc.height = 128; const mg = mc.getContext('2d'); const gr = mg.createRadialGradient(64, 64, 4, 64, 64, 60); gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.3, 'rgba(235,235,255,0.95)'); gr.addColorStop(0.36, 'rgba(160,170,230,0.25)'); gr.addColorStop(1, 'rgba(160,170,230,0)'); mg.fillStyle = gr; mg.fillRect(0, 0, 128, 128);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mc), fog: false, depthWrite: false, transparent: true })); moon.scale.set(46, 46, 1); moon.position.set(-120, 150, -140); grp.add(moon);
  // силует на града
  const cc = document.createElement('canvas'); cc.width = 2048; cc.height = 256; const g = cc.getContext('2d'); g.clearRect(0, 0, 2048, 256);
  let x = 0; while (x < 2048) { const w = 40 + Math.random() * 90, h = 50 + Math.random() * 170; g.fillStyle = `rgb(${14 + Math.random() * 10 | 0},${12 + Math.random() * 10 | 0},${28 + Math.random() * 14 | 0})`; g.fillRect(x, 256 - h, w, h);
    for (let wy = 256 - h + 8; wy < 248; wy += 12) for (let wx = x + 5; wx < x + w - 6; wx += 10) if (Math.random() < 0.3) { g.fillStyle = Math.random() < 0.7 ? 'rgba(255,214,130,0.95)' : 'rgba(170,200,255,0.9)'; g.fillRect(wx, wy, 5, 6); }
    x += w + Math.random() * 14; }
  const ct = new THREE.CanvasTexture(cc); ct.wrapS = THREE.RepeatWrapping; ct.repeat.set(2, 1); ct.magFilter = THREE.NearestFilter; ct.colorSpace = THREE.SRGBColorSpace;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(215, 215, 70, 48, 1, true), new THREE.MeshBasicMaterial({ map: ct, side: THREE.BackSide, transparent: true, fog: false, depthWrite: false }));
  ring.position.y = 30; grp.add(ring);
  return grp;
}
