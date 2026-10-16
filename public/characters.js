// Герои (модели на играчите): процедурни, заоблени фигури (сфери, капсули, конуси), не кутийки.
// Всеки герой се събира от същите части като основния модел – глава, тяло, крака, ръка с оръжие – и така анимациите работят без промяна.
// Всички са вписани в хитбокса на играча (0.6 x 1.8 м); отборът се познава по цвета на акцентите.
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
const GL = hex => { const k = 'g' + hex; let m = mats.get(k); if (!m) mats.set(k, m = new THREE.MeshBasicMaterial({ color: hex, fog: false })); return m; };   // светещи части (без осветление)
const mesh = (geo, hex, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(paint(geo, hex), VC()); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };
const glow = (geo, hex, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, GL(hex)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };
const sphere = (r, hex, x, y, z, sx = 1, sy = 1, sz = 1) => mesh(new THREE.SphereGeometry(r, 14, 10), hex, x, y, z, sx, sy, sz);
const capsule = (r, len, hex, x, y, z) => mesh(new THREE.CapsuleGeometry(r, len, 5, 12), hex, x, y, z);
const cyl = (rt, rb, h, hex, x, y, z, seg = 12) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), hex, x, y, z);
const cone = (r, h, hex, x, y, z, rx = 0, rz = 0) => { const m = mesh(new THREE.ConeGeometry(r, h, 10), hex, x, y, z); m.rotation.set(rx, 0, rz); return m; };

function leg(x, hex, bootHex, len = 0.66, r = 0.115) {
  const l = new THREE.Group(); l.position.set(x, len, 0);
  l.add(cyl(r, r * 0.88, len * 0.88, hex, 0, -len * 0.46, 0), sphere(r * 1.12, bootHex, 0, -len + 0.08, -0.03, 1, 0.8, 1.45));
  return l;
}

// build(team) -> { head, body, legL, legR, armHex, handHex, armR, tick(t, speed) }
const BUILDERS = {
  // Космонавт: бял скафандър, златен визьор, ранец
  astro(T) {
    const head = new THREE.Group(); head.position.set(0, 1.55, 0);
    head.add(sphere(0.31, 0xeeeeee, 0, 0, 0), sphere(0.25, 0x23232f, 0, 0.0, -0.14, 1.05, 0.88, 0.95), sphere(0.17, 0xd6a94a, 0.0, -0.02, -0.25, 1.0, 0.55, 0.35), cyl(0.012, 0.012, 0.22, 0xcccccc, 0.18, 0.34, 0.02, 6), sphere(0.04, T.glow, 0.18, 0.46, 0.02));
    const body = new THREE.Group(); body.position.set(0, 1.0, 0);
    body.add(capsule(0.25, 0.3, 0xf2f2f2, 0, 0, 0), cyl(0.2, 0.2, 0.08, T.main, 0, 0.12, 0, 14), sphere(0.07, T.glow, 0, 0.0, -0.24), cyl(0.18, 0.2, 0.5, 0xd5d5d5, 0, 0.02, 0.28, 12));
    return { head, body, legL: leg(-0.14, 0xf0f0f0, T.dark), legR: leg(0.14, 0xf0f0f0, T.dark), armHex: 0xf2f2f2, handHex: T.main };
  },
  // Лисан: оранжева лисица с остри уши и пухкава опашка
  fox(T) {
    const fur = 0xe9822b, light = 0xf6ead8, dk = 0x4a2a14;
    const head = new THREE.Group(); head.position.set(0, 1.55, 0);
    head.add(sphere(0.25, fur, 0, 0, 0, 1.1, 0.95, 1), cone(0.11, 0.3, fur, 0, -0.05, -0.31, -Math.PI / 2), sphere(0.045, 0x111111, 0, -0.01, -0.46),
      cone(0.1, 0.3, fur, -0.16, 0.3, 0.02, 0, 0.18), cone(0.1, 0.3, fur, 0.16, 0.3, 0.02, 0, -0.18), cone(0.05, 0.12, dk, -0.18, 0.43, 0.02, 0, 0.18), cone(0.05, 0.12, dk, 0.18, 0.43, 0.02, 0, -0.18),
      sphere(0.12, light, -0.1, -0.1, -0.14, 1, 0.7, 1), sphere(0.12, light, 0.1, -0.1, -0.14, 1, 0.7, 1), glow(new THREE.SphereGeometry(0.035, 8, 6), 0x111111, -0.1, 0.05, -0.23), glow(new THREE.SphereGeometry(0.035, 8, 6), 0x111111, 0.1, 0.05, -0.23));
    const body = new THREE.Group(); body.position.set(0, 1.0, 0);
    const tail = new THREE.Group(); tail.position.set(0, -0.2, 0.2);
    tail.add(sphere(0.13, fur, 0, 0.05, 0.22, 1, 1, 1.9), sphere(0.08, light, 0, 0.1, 0.5, 1, 1, 1.3)); tail.rotation.x = -0.5;
    body.add(capsule(0.22, 0.3, fur, 0, 0, 0), sphere(0.2, light, 0, 0.05, -0.1, 1, 1.4, 0.7), cyl(0.235, 0.235, 0.3, T.dark, 0, 0.0, 0, 14), cyl(0.2, 0.2, 0.06, T.main, 0, 0.17, 0, 14), tail);
    return { head, body, legL: leg(-0.12, dk, 0x2a170a, 0.66, 0.1), legR: leg(0.12, dk, 0x2a170a, 0.66, 0.1), armHex: T.dark, handHex: dk, tick: (t, sp) => { tail.rotation.y = Math.sin(t * 3) * 0.35 * (0.4 + Math.min(1, sp / 4)); } };
  },
  // Андроид: сферична глава с визьор, пръстени и светеща сърцевина
  robot(T) {
    const steel = 0x9aa5b4, dark = 0x3a414d;
    const head = new THREE.Group(); head.position.set(0, 1.55, 0);
    head.add(sphere(0.27, steel, 0, 0, 0), glow(new THREE.SphereGeometry(0.272, 16, 8, -Math.PI / 2 - 0.95, 1.9, 1.15, 0.6), T.glow, 0, 0, 0), cyl(0.012, 0.012, 0.2, dark, 0, 0.36, 0, 6), sphere(0.05, T.glow, 0, 0.5, 0), cyl(0.07, 0.07, 0.3, dark, -0.27, 0, 0, 10), cyl(0.07, 0.07, 0.3, dark, 0.27, 0, 0, 10));
    head.children[4].rotation.z = Math.PI / 2; head.children[5].rotation.z = Math.PI / 2;      // слушалки отстрани
    head.children[4].scale.set(0.5, 0.35, 0.5); head.children[5].scale.set(0.5, 0.35, 0.5);
    const body = new THREE.Group(); body.position.set(0, 1.0, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 20), GL(T.glow)); ring.position.set(0, 0.02, -0.17); ring.scale.set(0.6, 0.6, 1);
    body.add(cyl(0.27, 0.22, 0.62, steel, 0, 0, 0, 14), cyl(0.28, 0.28, 0.07, dark, 0, 0.2, 0, 14), cyl(0.24, 0.24, 0.07, dark, 0, -0.22, 0, 14), ring, sphere(0.1, T.glow, 0, 0.02, -0.2, 1, 1, 0.5), sphere(0.12, dark, -0.34, 0.24, 0), sphere(0.12, dark, 0.34, 0.24, 0));
    return { head, body, legL: leg(-0.14, dark, steel, 0.66, 0.1), legR: leg(0.14, dark, steel, 0.66, 0.1), armHex: steel, handHex: dark };
  },
  // Пришълец: голяма издължена глава, големи черни очи, тънки крайници
  alien(T) {
    const skin = 0x7bc96a, dk = 0x2e5a2a;
    const head = new THREE.Group(); head.position.set(0, 1.58, 0);
    const eL = glow(new THREE.SphereGeometry(0.1, 12, 8), 0x07120a, -0.12, -0.02, -0.2, 0.8, 1.5, 0.45), eR = glow(new THREE.SphereGeometry(0.1, 12, 8), 0x07120a, 0.12, -0.02, -0.2, 0.8, 1.5, 0.45);
    eL.rotation.z = -0.5; eR.rotation.z = 0.5;
    head.add(sphere(0.25, skin, 0, 0.06, 0, 1.0, 1.35, 1.0), eL, eR, glow(new THREE.SphereGeometry(0.02, 6, 4), 0xffffff, -0.1, 0.06, -0.255, 0.7, 1.2, 0.3), glow(new THREE.SphereGeometry(0.02, 6, 4), 0xffffff, 0.1, 0.06, -0.255, 0.7, 1.2, 0.3), cyl(0.012, 0.012, 0.18, skin, 0, 0.52, 0, 6), sphere(0.045, T.glow, 0, 0.64, 0));
    const body = new THREE.Group(); body.position.set(0, 1.0, 0);
    body.add(capsule(0.19, 0.38, 0x303a46, 0, 0, 0), cyl(0.2, 0.2, 0.08, T.main, 0, 0.0, 0, 14), cyl(0.12, 0.13, 0.12, skin, 0, 0.34, 0, 10), sphere(0.06, T.glow, 0, 0.1, -0.19));
    return { head, body, legL: leg(-0.1, dk, 0x1b3818, 0.66, 0.085), legR: leg(0.1, dk, 0x1b3818, 0.66, 0.085), armHex: 0x303a46, handHex: skin, thin: true };
  },
  // Рицар: стоманен шлем с перо, наплечници и табард
  knight(T) {
    const steel = 0xb4bcc6, dark = 0x59616d;
    const head = new THREE.Group(); head.position.set(0, 1.55, 0);
    head.add(sphere(0.28, steel, 0, 0, 0, 1, 1.08, 1), glow(new THREE.BoxGeometry(0.34, 0.035, 0.05), 0x050505, 0, 0.02, -0.265), glow(new THREE.BoxGeometry(0.035, 0.2, 0.05), 0x050505, 0, -0.07, -0.265), cone(0.05, 0.3, T.main, 0, 0.37, 0.06, -0.25), sphere(0.06, T.main, 0, 0.3, 0.1, 1, 1.4, 2), cyl(0.3, 0.3, 0.04, dark, 0, 0.0, 0, 16));
    const body = new THREE.Group(); body.position.set(0, 1.0, 0);
    const sk = mesh(new THREE.ConeGeometry(0.34, 0.5, 14, 1, true), T.main, 0, -0.34, 0); sk.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    body.add(cyl(0.27, 0.22, 0.64, steel, 0, 0.02, 0, 14), sphere(0.17, steel, -0.34, 0.24, 0, 1, 0.8, 1), sphere(0.17, steel, 0.34, 0.24, 0, 1, 0.8, 1), cyl(0.14, 0.14, 0.4, T.main, 0, 0.0, -0.2, 3), sk, cyl(0.25, 0.25, 0.07, dark, 0, -0.18, 0, 14));
    return { head, body, legL: leg(-0.14, dark, steel), legR: leg(0.14, dark, steel), armHex: steel, handHex: dark };
  },
  // Нинджа-котка: черен костюм, котешки уши, светещи очи, шал и опашка
  ninja(T) {
    const blk = 0x23262e;
    const head = new THREE.Group(); head.position.set(0, 1.55, 0);
    head.add(sphere(0.25, blk, 0, 0, 0), cone(0.1, 0.26, blk, -0.15, 0.3, 0, 0, 0.35), cone(0.1, 0.26, blk, 0.15, 0.3, 0, 0, -0.35), cone(0.05, 0.14, T.main, -0.15, 0.3, -0.04, 0, 0.35), cone(0.05, 0.14, T.main, 0.15, 0.3, -0.04, 0, -0.35),
      glow(new THREE.SphereGeometry(0.06, 10, 6), T.glow, -0.1, 0.03, -0.2, 1.4, 0.55, 0.5), glow(new THREE.SphereGeometry(0.06, 10, 6), T.glow, 0.1, 0.03, -0.2, 1.4, 0.55, 0.5), cyl(0.2, 0.2, 0.08, T.main, 0, -0.17, 0, 14));
    head.children[5].rotation.z = 0.35; head.children[6].rotation.z = -0.35;
    for (const s of [-1, 1]) for (const k of [-0.03, 0.03]) { const w = cyl(0.004, 0.004, 0.2, 0xdddddd, s * 0.2, -0.06 + k, -0.2, 4); w.rotation.z = Math.PI / 2; head.add(w); }
    const body = new THREE.Group(); body.position.set(0, 1.0, 0);
    const scarf = new THREE.Group(); scarf.position.set(0, 0.3, 0.12);
    scarf.add(mesh(new THREE.BoxGeometry(0.16, 0.05, 0.62), T.main, 0, -0.05, 0.3), mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 14), T.main, 0, 0.05, -0.12));
    scarf.children[1].rotation.x = Math.PI / 2;
    const tail = new THREE.Group(); tail.position.set(0, -0.22, 0.2);
    tail.add(sphere(0.06, blk, 0, 0.0, 0.1), sphere(0.055, blk, 0, 0.1, 0.24), sphere(0.05, blk, 0, 0.22, 0.32), sphere(0.045, T.main, 0, 0.34, 0.33));
    body.add(capsule(0.2, 0.34, blk, 0, 0, 0), cyl(0.21, 0.21, 0.07, T.dark, 0, -0.05, 0, 14), scarf, tail);
    return { head, body, legL: leg(-0.12, blk, 0x111318, 0.66, 0.095), legR: leg(0.12, blk, 0x111318, 0.66, 0.095), armHex: blk, handHex: 0x111318, tick: (t, sp) => { const a = Math.min(1, sp / 5); scarf.rotation.x = -0.1 - a * 0.5 + Math.sin(t * 6) * 0.07 * (0.3 + a); tail.rotation.x = Math.sin(t * 2.2) * 0.2; } };
  },
};

export const CHAR_IDS = Object.keys(BUILDERS);
export function buildCharacter(id, team = 'att') {
  const b = BUILDERS[id] || BUILDERS.astro;
  return b(TEAM[team] || TEAM.att);
}
export const armGeoFor = thin => paint(new THREE.CylinderGeometry(thin ? 0.05 : 0.075, thin ? 0.04 : 0.065, 1, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.5), 0xffffff);
export const handGeoFor = thin => new THREE.SphereGeometry(thin ? 0.06 : 0.085, 10, 8);
export { VC as charMaterial, paint as paintGeo };
