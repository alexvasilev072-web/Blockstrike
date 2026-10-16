// Герои (модели на играчите): реалистични войници, генерирани процедурно (сфери, цилиндри, конуси, ротационни тела) – без външни файлове.
// Реални пропорции (1.8 м), глава с лице, шия, торс с жилетка и торбички, ръце с лакти (двусегментни), крака с колена, ботуши.
// Всички са вписани в хитбокса на играча (0.6 x 1.8 м). Три героя за нападателите (терористи) и три за защитниците (спецчасти).
import * as THREE from 'three';
import { CHARACTERS } from '/shared/weapons.js';

export const CHAR_LIST = Object.entries(CHARACTERS).map(([id, c]) => ({ id, ...c }));
const TEAM = { att: { main: 0xe07b1a, dark: 0x7a3d0c, glow: 0xffb347 }, def: { main: 0x2f6fdc, dark: 0x1a3b78, glow: 0x6fb8ff } };

const mats = new Map();
// Прости „осветени“ материали: цвят на връх по нормалата (по-светло отгоре, по-тъмно отдолу), за да изглеждат заоблените форми обемни.
function paint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.normal, col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i), nz = n.getZ(i), s = 0.58 + 0.34 * (ny * 0.5 + 0.5) + 0.1 * Math.max(0, -nz);
    col[i * 3] = c.r * s; col[i * 3 + 1] = c.g * s; col[i * 3 + 2] = c.b * s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
const VC = () => { let m = mats.get('vc'); if (!m) mats.set('vc', m = new THREE.MeshBasicMaterial({ vertexColors: true })); return m; };
const VC2 = () => { let m = mats.get('vc2'); if (!m) mats.set('vc2', m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })); return m; };
const GL = hex => { const k = 'g' + hex; let m = mats.get(k); if (!m) mats.set(k, m = new THREE.MeshBasicMaterial({ color: hex, fog: false })); return m; };   // светещи/гладки части
const mesh = (geo, hex, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(paint(geo, hex), VC()); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };
const glow = (geo, hex, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, VC()); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m;
};
const sphere = (r, hex, x, y, z, sx = 1, sy = 1, sz = 1) => mesh(new THREE.SphereGeometry(r, 14, 10), hex, x, y, z, sx, sy, sz);
const cyl = (rt, rb, h, hex, x, y, z, seg = 12) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), hex, x, y, z);
const box = (w, h, d, hex, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), hex, x, y, z);
const cone = (r, h, hex, x, y, z, rx = 0, rz = 0) => { const m = mesh(new THREE.ConeGeometry(r, h, 10), hex, x, y, z); m.rotation.set(rx, 0, rz); return m; };
const lathe = (pts, hex, zs, double) => { const m = mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 18), hex); m.scale.z = zs; if (double) m.material = VC2(); return m; };
const shade = (hex, k) => { const c = new THREE.Color(hex); return c.multiplyScalar(k).getHex(); };

// ---------- надписи върху плоскост (ГДБОП, ПОЛИЦИЯ …) ----------
const decalMats = new Map();
function decal(text, w, h, { color = '#f4f4f4', bg = null, front = true } = {}) {
  const key = text + color + bg; let mat = decalMats.get(key);
  if (!mat) {
    const c = document.createElement('canvas'); c.width = 256; c.height = Math.max(32, Math.round(256 * h / w)); const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
    let fs = c.height * 0.78; g.font = 'bold ' + fs + 'px Arial, sans-serif';
    while (g.measureText(text).width > c.width * 0.94 && fs > 8) { fs -= 2; g.font = 'bold ' + fs + 'px Arial, sans-serif'; }
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshBasicMaterial({ map: tex, transparent: !bg, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); decalMats.set(key, mat);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.userData.keep = true; if (front) m.rotation.y = Math.PI; return m;
}

// ---------- един параметричен човек; героите са различни комбинации от облекло, екипировка и лице ----------
function soldier(T, o) {
  const { skin, jacket, pants, vest, boot = 0x1a1816, build = 1 } = o, top = o.top || 'jacket';
  const glove = o.glove ?? 0x1c1c1c, pouch = o.pouch ?? (vest ? shade(vest, 1.35) : 0), pantsD = shade(pants, 0.78), dark = 0x151515;
  const torsoHex = top === 'tank' ? o.tank : jacket;
  // ---- глава ----
  const head = new THREE.Group(); head.position.set(0, 1.665, 0);
  const hs = (r, hex, x, y, z, sx = 1, sy = 1.3, sz = 1.12) => sphere(r, hex, x, y, z, sx, sy, sz);
  head.add(hs(0.1, skin, 0, 0, 0), hs(0.072, skin, 0, -0.092, -0.022, 1.1, 0.8, 1.1), cone(0.018, 0.05, skin, 0, -0.012, -0.123, -Math.PI / 2),
    hs(0.022, skin, -0.1, -0.005, 0, 0.6, 1, 0.9), hs(0.022, skin, 0.1, -0.005, 0, 0.6, 1, 0.9), cyl(0.05, 0.058, 0.1, skin, 0, -0.15, 0.005, 10));
  const eyes = () => {
    head.add(glow(new THREE.SphereGeometry(0.014, 8, 6), 0xe8e4dc, -0.04, 0.025, -0.106, 1.5, 0.8, 0.5), glow(new THREE.SphereGeometry(0.014, 8, 6), 0xe8e4dc, 0.04, 0.025, -0.106, 1.5, 0.8, 0.5),
      glow(new THREE.SphereGeometry(0.0085, 8, 6), 0x21170f, -0.04, 0.025, -0.112), glow(new THREE.SphereGeometry(0.0085, 8, 6), 0x21170f, 0.04, 0.025, -0.112),
      hs(0.02, shade(skin, 0.4), -0.04, 0.052, -0.108, 1.8, 0.32, 0.5), hs(0.02, shade(skin, 0.4), 0.04, 0.052, -0.108, 1.8, 0.32, 0.5));
  };
  if (o.head === 'balaclava') {                 // цялото лице е покрито, само процеп за очите
    head.add(hs(0.109, o.mask ?? 0x17181a, 0, 0.002, 0.004), box(0.15, 0.036, 0.012, skin, 0, 0.026, -0.112));
    eyes();
  } else {
    eyes();
    if (o.beard) head.add(mesh(new THREE.SphereGeometry(0.104, 14, 8, 0, Math.PI * 2, 1.95, 1.0), o.beard, 0, 0, 0.001, 1, 1.3, 1.13));
    if (o.mask) head.add(mesh(new THREE.SphereGeometry(0.107, 14, 8, 0, Math.PI * 2, 1.9, 1.2), o.mask, 0, 0, 0, 1, 1.3, 1.13));       // шал/бъф върху лицето
  }
  const dome = (r, hex, a, y = 0.012) => mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, a), hex, 0, y, 0.002, 1, 1.3, 1.13);
  switch (o.head) {
    case 'beanie': { head.add(dome(0.109, o.hat, 1.28)); const c = mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 16), o.hat, 0, 0.044, -0.004, 1, 1.12, 1.0); c.rotation.x = Math.PI / 2; head.add(c); break; }
    case 'boonie': { head.add(dome(0.108, o.hat, 1.35, 0.02)); const b = cyl(0.17, 0.17, 0.008, o.hat, 0, 0.056, 0, 18); b.scale.z = 1.05; head.add(b, cyl(0.112, 0.114, 0.022, shade(o.hat, 0.7), 0, 0.058, 0, 16)); break; }
    case 'cap': { head.add(dome(0.11, o.hat, 1.35, 0.016)); const v = box(0.17, 0.008, 0.1, o.hat, 0, 0.05, -0.17); v.rotation.x = 0.18; head.add(v); if (o.capBadge) head.add(sphere(0.016, 0xe3b53b, 0, 0.082, -0.112, 1, 1, 0.4)); break; }
    case 'beret': { const b = sphere(0.125, o.hat, 0.012, 0.07, 0.005, 1, 0.38, 1); b.rotation.z = -0.12; head.add(b, cyl(0.104, 0.106, 0.03, shade(o.hat, 0.7), 0, 0.048, 0.002, 16)); break; }
    case 'helmet': case 'helmetNVG': {
      head.add(dome(0.119, o.hat, 1.62, 0.018), cyl(0.121, 0.123, 0.014, shade(o.hat, 0.75), 0, 0.058, 0, 18), box(0.012, 0.03, 0.2, dark, -0.12, 0.05, 0), box(0.012, 0.03, 0.2, dark, 0.12, 0.05, 0));
      for (const s of [-1, 1]) { const st = cyl(0.004, 0.004, 0.17, 0x222222, s * 0.095, -0.05, -0.02, 4); st.rotation.z = s * 0.1; head.add(st); }
      if (o.head === 'helmetNVG') head.add(box(0.07, 0.04, 0.03, dark, 0, 0.1, -0.12), cyl(0.026, 0.03, 0.06, 0x2a2a2e, 0, 0.118, -0.16, 10), glow(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 10), 0x7dff8a, 0, 0.118, -0.192));
      break; }
  }
  if (o.hood) { const hd = mesh(new THREE.SphereGeometry(0.128, 14, 10, 0, Math.PI), jacket, 0, 0.0, 0.02, 1.04, 1.3, 1.18); hd.material = VC2(); head.add(hd, cyl(0.1, 0.13, 0.07, jacket, 0, -0.13, 0.04, 12)); }
  if (o.eyewear === 'shades') head.add(hs(0.03, 0x0e0e10, -0.043, 0.026, -0.108, 1.1, 0.75, 0.35), hs(0.03, 0x0e0e10, 0.043, 0.026, -0.108, 1.1, 0.75, 0.35), box(0.04, 0.008, 0.012, 0x0e0e10, 0, 0.032, -0.114));
  if (o.eyewear === 'goggles') { const band = mesh(new THREE.TorusGeometry(0.104, 0.012, 6, 18), 0x1d2a1d, 0, 0.082, 0, 1, 1.25, 1.1); band.rotation.x = Math.PI / 2; head.add(band, box(0.15, 0.045, 0.02, 0x1d2a1d, 0, 0.082, -0.125), glow(new THREE.BoxGeometry(0.06, 0.032, 0.006), 0x9fd2ff, -0.036, 0.082, -0.137), glow(new THREE.BoxGeometry(0.06, 0.032, 0.006), 0x9fd2ff, 0.036, 0.082, -0.137)); }
  if (o.headset) { for (const s of [-1, 1]) head.add(cyl(0.032, 0.032, 0.03, 0x1b1b1d, s * 0.115, 0.0, 0.0, 10)); const mic = cyl(0.003, 0.003, 0.1, 0x111111, -0.1, -0.05, -0.07, 4); mic.rotation.z = 1.2; mic.rotation.x = 0.7; head.add(mic, sphere(0.01, 0x111111, -0.05, -0.06, -0.11)); }
  // ---- торс ----
  const body = new THREE.Group(); body.position.set(0, 1.15, 0); body.scale.x = build;
  body.add(lathe([[0.12, -0.31], [0.168, -0.28], [0.172, -0.2], [0.158, -0.08], [0.172, 0.04], [0.2, 0.18], [0.215, 0.27], [0.12, 0.34], [0.06, 0.37]], torsoHex, 0.62),
    cyl(0.176, 0.18, 0.05, top === 'tank' ? pants : 0x181716, 0, -0.2, 0, 16), sphere(0.078, top === 'tank' ? skin : jacket, -0.205, 0.265, 0), sphere(0.078, top === 'tank' ? skin : jacket, 0.205, 0.265, 0));
  if (top === 'tank') {                             // потник: голи рамене и ръце
    for (const s of [-1, 1]) body.add(sphere(0.07, skin, s * 0.2, 0.22, 0, 1, 1.2, 1), box(0.045, 0.2, 0.02, torsoHex, s * 0.095, 0.3, -0.12));
    body.add(cyl(0.07, 0.085, 0.07, skin, 0, 0.37, 0, 12));
  }
  if (top === 'puffer') for (const y of [-0.13, -0.02, 0.1, 0.2]) { const t = mesh(new THREE.TorusGeometry(0.188 + (y > 0.05 ? 0.02 : 0), 0.012, 6, 20), shade(jacket, 0.85), 0, y, 0, 1, 1, 0.64); t.rotation.x = Math.PI / 2; body.add(t); }
  if (top === 'hoodie') body.add(box(0.2, 0.09, 0.03, shade(jacket, 0.85), 0, -0.1, -0.12), cyl(0.004, 0.004, 0.12, 0xdddddd, -0.04, 0.2, -0.12, 4), cyl(0.004, 0.004, 0.12, 0xdddddd, 0.04, 0.2, -0.12, 4));
  if (top === 'police') body.add(cyl(0.07, 0.085, 0.05, shade(jacket, 1.2), 0, 0.385, 0, 12), box(0.07, 0.05, 0.02, shade(jacket, 0.8), -0.12, 0.1, -0.13), box(0.07, 0.05, 0.02, shade(jacket, 0.8), 0.12, 0.1, -0.13), box(0.1, 0.02, 0.06, 0x0e1730, -0.2, 0.33, 0), box(0.1, 0.02, 0.06, 0x0e1730, 0.2, 0.33, 0));
  if (o.collar) body.add(cyl(0.062, 0.075, 0.05, jacket, 0, 0.38, 0, 12));
  if (vest) {
    body.add(lathe([[0.176, -0.12], [0.188, 0.0], [0.212, 0.17], [0.226, 0.27], [0.205, 0.31]], vest, 0.66, true), box(0.052, 0.16, 0.03, vest, -0.1, 0.22, -0.13), box(0.052, 0.16, 0.03, vest, 0.1, 0.22, -0.13));
    for (const x of [-0.09, 0, 0.09]) body.add(box(0.075, 0.1, 0.045, pouch, x, -0.02, x === 0 ? -0.162 : -0.158));
    body.add(box(0.19, 0.05, 0.04, pouch, 0, 0.1, -0.158), box(0.26, 0.3, 0.1, o.packColor ?? vest, 0, 0.08, 0.14), box(0.2, 0.12, 0.07, pouch, 0, -0.06, 0.2));
  }
  body.add(box(0.07, 0.04, 0.02, T.main, 0.12, 0.2, -0.16));      // нашивка в цвета на отбора
  if (o.badge) { const d = cyl(0.03, 0.03, 0.008, 0x2b4a2b, -0.16, 0.24, -0.14, 14); d.rotation.x = Math.PI / 2; const r = mesh(new THREE.TorusGeometry(0.03, 0.005, 5, 14), 0xd8d8d8, -0.16, 0.24, -0.146); body.add(d, r); }
  if (o.chain) { const t = mesh(new THREE.TorusGeometry(0.075, 0.006, 5, 16), 0xe3b53b, 0, 0.3, -0.07, 1, 1, 1); t.rotation.x = Math.PI / 2 - 0.5; body.add(t, sphere(0.014, 0xe3b53b, 0, 0.2, -0.148)); }
  if (o.bag === 'fanny') { const strap = mesh(new THREE.TorusGeometry(0.19, 0.012, 5, 18), 0x15151a, 0, -0.17, 0, 1, 1, 0.66); strap.rotation.x = Math.PI / 2; body.add(strap, box(0.17, 0.1, 0.07, 0x16171c, 0.04, -0.15, -0.14), box(0.12, 0.012, 0.075, T.main, 0.04, -0.115, -0.14)); }
  if (o.bag === 'cross') { const st = box(0.045, 0.62, 0.012, 0x18181c, 0.02, 0.0, -0.138); st.rotation.z = -0.55; body.add(st, box(0.14, 0.18, 0.07, 0x18181c, 0.2, -0.15, -0.02)); }
  if (o.radio) body.add(box(0.045, 0.1, 0.035, 0x1a1a1a, -0.215, 0.33, 0.0), cyl(0.004, 0.004, 0.2, 0x111111, -0.215, 0.47, 0.0, 4));
  if (o.holster) body.add(box(0.05, 0.14, 0.08, 0x201c18, 0.2, -0.22, 0.0));
  for (const d of o.decals || []) { const m = decal(d.text, d.w, d.h, { color: d.color, bg: d.bg, front: d.front !== false }); m.position.set(...d.pos); body.add(m); }
  // ---- крака ----
  const sn = o.sneaker, stripe = o.stripes, shorts = o.shorts;
  const mkLeg = x => {
    const side = x < 0 ? -1 : 1, l = new THREE.Group(); l.position.set(x * build, 0.88, 0);
    const th = shorts ? 0.3 : 0.44;
    l.add(cyl(0.088, shorts ? 0.082 : 0.066, th, pants, 0, -th / 2, 0, 10));
    if (shorts) l.add(cyl(0.082, 0.068, 0.14, skin, 0, -0.37, 0, 10), sphere(0.066, skin, 0, -0.44, 0), cyl(0.086, 0.086, 0.02, shade(pants, 0.7), 0, -0.3, 0, 10));
    else l.add(sphere(0.068, pantsD, 0, -0.44, 0), box(0.05, 0.13, 0.11, pantsD, side * 0.078, -0.2, -0.01));
    if (stripe) l.add(box(0.008, th, 0.034, stripe, side * 0.0905, -th / 2, 0));
    const shin = new THREE.Group(); shin.position.set(0, -0.44, 0); shin.name = 'shin'; shin.userData.stop = true;
    if (sn || shorts) {                                           // маратонки (без ботуши): чорап + обувка със страничен акцент
      shin.add(cyl(0.062, 0.046, 0.4, shorts ? skin : pants, 0, -0.2, 0, 10), cyl(0.05, 0.05, 0.14, 0xf2f2f2, 0, -0.33, 0, 10));
      const c = sn?.c ?? 0xe8e8e8, a = sn?.a ?? 0x888888;
      shin.add(box(0.098, 0.075, 0.26, c, 0, -0.415, -0.05), sphere(0.052, c, 0, -0.41, -0.15, 1, 0.75, 0.9), box(0.102, 0.03, 0.27, 0xf4f4f4, 0, -0.45, -0.05), box(0.006, 0.05, 0.12, a, side * 0.05, -0.41, -0.04), box(0.006, 0.03, 0.05, a, side * 0.05, -0.42, 0.06));
    } else {
      shin.add(cyl(0.064, 0.046, 0.4, pants, 0, -0.2, 0, 10), cyl(0.06, 0.06, 0.1, boot, 0, -0.37, 0, 10), box(0.1, 0.07, 0.24, boot, 0, -0.425, -0.05), box(0.102, 0.022, 0.25, 0x0d0c0b, 0, -0.455, -0.05));
    }
    if (stripe && !shorts) shin.add(box(0.008, 0.38, 0.03, stripe, side * 0.06, -0.19, 0));
    if (o.kneepads) l.add(sphere(0.075, 0x1d1d1f, 0, -0.44, -0.03, 1, 0.95, 0.9));
    l.add(shin); l.userData.shin = shin; return l;
  };
  return { head, body, legL: mkLeg(-0.095), legR: mkLeg(0.095), armHex: top === 'tank' ? skin : (o.sleeve ?? jacket), handHex: top === 'tank' ? skin : glove, armR: [0.062, 0.046], sh: { y: 1.455, x: 0.215 * build }, arm2: true, skin };
}

const HEROES = {
  // ---- нападатели: улични босове и футболни хулигани (маски, анцузи, маратонки, потници) ----
  t_ultra: T => soldier(T, { skin: 0xc9a07c, head: 'beanie', hat: 0x1a1a1c, mask: 0xb21f24, top: 'puffer', jacket: 0x1f2a44, pants: 0x16171a, stripes: 0xf0f0f0, sneaker: { c: 0xe6e6e6, a: 0x8a8f96 }, badge: true, glove: 0x15151a, build: 1.04 }),
  t_dealer: T => soldier(T, { skin: 0xb98863, head: 'cap', hat: 0xb22222, mask: 0x141414, top: 'tank', tank: 0xf2f2f2, jacket: 0xf2f2f2, pants: 0x1a2236, stripes: 0xffffff, sneaker: { c: 0xf5f5f5, a: 0xff7a1a }, chain: true, bag: 'cross', build: 1.0 }),
  t_enforcer: T => soldier(T, { skin: 0xd8b08c, head: 'balaclava', mask: 0x131313, hood: true, top: 'hoodie', jacket: 0x3b3f46, pants: 0x24262b, stripes: 0xcfd2d6, shorts: true, sneaker: { c: 0xdcdcdc, a: 0x2c5fd6 }, bag: 'fanny', glove: 0x1a1a1a, build: 1.08 }),
  // ---- защитници: ГДБОП, полиция и специални части ----
  ct_gdbop: T => soldier(T, { skin: 0xd4a681, head: 'helmet', hat: 0x15181d, mask: 0x101214, eyewear: 'goggles', headset: true, jacket: 0x181b21, pants: 0x1b1e25, vest: 0x101216, pouch: 0x20242c, kneepads: true, holster: true, radio: true, build: 1.07,
    decals: [{ text: 'ГДБОП', w: 0.15, h: 0.05, pos: [0, 0.205, -0.151] }, { text: 'ГДБОП', w: 0.25, h: 0.09, pos: [0, 0.1, 0.194], front: false }] }),
  ct_police: T => soldier(T, { skin: 0xe0b896, head: 'cap', hat: 0x16223d, capBadge: true, top: 'police', jacket: 0x1c2b4d, pants: 0x182440, vest: 0x0f1a33, pouch: 0x1f2f55, boot: 0x111111, holster: true, radio: true, build: 1.0,
    decals: [{ text: 'ПОЛИЦИЯ', w: 0.17, h: 0.05, pos: [0, 0.205, -0.151] }, { text: 'ПОЛИЦИЯ', w: 0.25, h: 0.075, pos: [0, 0.1, 0.194], front: false }] }),
  ct_special: T => soldier(T, { skin: 0xa77a59, head: 'helmetNVG', hat: 0x23272d, mask: 0x131518, headset: true, jacket: 0x15171b, pants: 0x16181c, vest: 0x0e0f12, pouch: 0x1d2025, kneepads: true, radio: true, collar: true, build: 1.03,
    decals: [{ text: 'СПЕЦ ЧАСТИ', w: 0.2, h: 0.05, pos: [0, 0.205, -0.151] }, { text: 'СПЕЦ ЧАСТИ', w: 0.25, h: 0.06, pos: [0, 0.1, 0.194], front: false }] }),
};
export const CHAR_IDS = Object.keys(HEROES);
export const heroesFor = team => CHAR_LIST.filter(c => c.team === team);
export const defaultChar = team => (team === 'def' ? 'ct_gdbop' : 't_ultra');
// слепва всички обикновени мешове в групата в по един меш на материал (рязко по-малко draw calls); декали и „stop“ подгрупи остават
function bake(root) {
  root.updateMatrix();
  const buckets = new Map(), kill = [];
  for (const c of root.children) {
    if (!c.isMesh || c.userData.keep) continue;
    c.updateMatrix(); const g = c.geometry.clone().applyMatrix4(c.matrix); let b = buckets.get(c.material);
    if (!b) buckets.set(c.material, b = { pos: [], col: [], idx: [] });
    const base = b.pos.length / 3; b.pos.push(...g.attributes.position.array); b.col.push(...g.attributes.color.array);
    const ix = g.index ? g.index.array : null; if (ix) for (const i of ix) b.idx.push(base + i); else for (let i = 0; i < g.attributes.position.count; i++) b.idx.push(base + i);
    kill.push(c);
  }
  for (const c of kill) { root.remove(c); c.geometry.dispose(); }
  for (const [mat, b] of buckets) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3)); g.setIndex(b.idx); g.computeBoundingSphere();
    root.add(new THREE.Mesh(g, mat));
  }
  const shin = root.getObjectByName('shin'); if (shin && shin !== root) bake(shin);
}
const TPL = new Map();
export function buildCharacter(id, team = 'att') {
  const hid = HEROES[id] ? id : defaultChar(team), key = hid + '|' + team;
  let t = TPL.get(key);
  if (!t) { t = HEROES[hid](TEAM[team] || TEAM.att); for (const k of ['head', 'body', 'legL', 'legR']) bake(t[k]); TPL.set(key, t); }
  // нов екземпляр: същите геометрии и материали (без ново качване в GPU)
  const o = { ...t, head: t.head.clone(), body: t.body.clone(), legL: t.legL.clone(), legR: t.legR.clone() };
  o.legL.userData.shin = o.legL.getObjectByName('shin'); o.legR.userData.shin = o.legR.getObjectByName('shin');
  return o;
}

// ---------- ръка с лакът (2-костно IK): от рамото до целта (всичко в пространството на aim-групата) ----------
const L1 = 0.29, L2 = 0.27;
const _f = new THREE.Vector3(0, 0, -1), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _p = new THREE.Vector3(), _o = new THREE.Vector3(), _h = new THREE.Vector3();
const ARMG = new Map(), ARMM = new Map();
const cylUnit = (r0, r1) => { const k = r0.toFixed(4) + '|' + r1.toFixed(4); let g = ARMG.get(k); if (!g) ARMG.set(k, g = paint(new THREE.CylinderGeometry(r0, r1, 1, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.5), 0xffffff)); return g; };
const armMat = hex => { let m = ARMM.get(hex); if (!m) ARMM.set(hex, m = new THREE.MeshBasicMaterial({ color: hex, vertexColors: true })); return m; };
const ELBG = new THREE.SphereGeometry(0.052, 8, 6);
export function makeArm(c) {
  const mat = armMat(c.armHex), r = c.armR || [0.062, 0.046];
  const g = new THREE.Group(), upper = new THREE.Mesh(cylUnit(r[0], r[1] + 0.004), mat), fore = new THREE.Mesh(cylUnit(r[1] + 0.004, r[1] - 0.006), mat);
  const elbow = new THREE.Mesh(ELBG, mat); elbow.scale.setScalar((r[1] + 0.006) / 0.052);
  g.add(upper, fore, elbow);
  return {
    g,
    // from/to: Vector3; side: -1 лява, 1 дясна
    set(from, to, side) {
      _d.copy(to).sub(from); const dist = Math.max(0.05, _d.length()), dir = _h.copy(_d).divideScalar(dist), reach = Math.min(dist, L1 + L2 - 0.004);
      const a = (L1 * L1 - L2 * L2 + reach * reach) / (2 * reach), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      _o.set(side * 0.55, -0.85, 0.45); _p.copy(_o).addScaledVector(dir, -_o.dot(dir)).normalize();     // лакътят сочи навън и надолу
      _e.copy(from).addScaledVector(dir, a).addScaledVector(_p, h);
      upper.position.copy(from); upper.quaternion.setFromUnitVectors(_f, _d.copy(_e).sub(from).normalize()); upper.scale.z = L1;
      fore.position.copy(_e); const hd = _d.copy(to).sub(_e), fl = Math.max(0.05, hd.length()); fore.quaternion.setFromUnitVectors(_f, hd.normalize()); fore.scale.z = Math.min(fl, L2 * 1.15);
      elbow.position.copy(_e);
    },
  };
}
export const handGeo = new THREE.SphereGeometry(0.052, 10, 8);
export { VC as charMaterial, paint as paintGeo };
