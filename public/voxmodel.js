// Воксел модели на оръжия, ножове и ръце. Всеки модел е от много малки кубчета (1 воксел = 1 см).
// Оси: +x надясно, +y нагоре, -z напред (цевта сочи към -z). Координатите на боксовете са [x0,y0,z0,x1,y1,z1,ключ] (край изключен).
import * as THREE from 'three';
import { SKINS } from './skindata.js';

export const VS = 0.01;

// палитра (sRGB 0-255)
const PAL = {
  m: [58, 62, 68], M: [158, 164, 172], b: [28, 28, 32], w: [124, 84, 46], g: [66, 68, 74], r: [168, 40, 36], y: [214, 176, 62],
  G: [64, 150, 72], s: [232, 188, 148], e: [92, 164, 214], B: [92, 62, 42], k: [40, 40, 44], a: [90, 94, 104],
};

// ---------- производни чертежи (варианти на базов модел) ----------
// opts: a – основен цвят; swap – смяна на цветови ключове; add – допълнителни кутии по части; muzzle/eject – нови позиции
function derive(base, opts) {
  const b = JSON.parse(JSON.stringify(BP[base])); b.like = BP[base].like || base;
  if (opts.a) b.a = opts.a;
  for (const part of Object.values(b.parts)) for (const box of part) if (opts.swap?.[box[6]]) box[6] = opts.swap[box[6]];
  for (const [n, boxes] of Object.entries(opts.add || {})) (b.parts[n] || (b.parts[n] = [])).push(...boxes);
  if (opts.muzzle) b.muzzle = opts.muzzle;
  return b;
}
// ---------- чертежи ----------
const rect = (list, x0, y0, z0, x1, y1, z1, c) => list.push([x0, y0, z0, x1, y1, z1, c]);
export const BP = {
  pistol: {
    a: [52, 58, 70],
    parts: {
      slide: [[-1, 4, -14, 1, 8, 6, 'a'], [-1, 8, -14, 1, 9, -13, 'm'], [-1, 8, 4, 1, 9, 5, 'm'], [-1, 5, -16, 1, 7, -14, 'M']],
      frame: [[-1, 2, -12, 1, 4, 5, 'g'], [-1, -4, 0, 1, 2, 5, 'g'], [-1, -9, 1, 1, -4, 6, 'g'], [-1, 0, -7, 1, 2, -6, 'g'], [-1, 0, -7, 1, 1, 0, 'g']],
      mag: [[-1, -12, 1, 1, -9, 6, 'M']],
    },
    pivots: { slide: [0, 6, 0], mag: [0, -10, 3] },
    muzzle: [0, 6, -17], eject: [1, 7, -3], rh: [0, -3, 3], lh: [0, -6, -1],
  },
  deagle: {
    a: [176, 180, 188],
    parts: {
      slide: [[-2, 4, -18, 2, 10, 8, 'a'], [-1, 10, -18, 1, 11, 8, 'm'], [-1, 6, -23, 1, 9, -18, 'M'], [-1, 11, -17, 1, 12, -16, 'm'], [-1, 11, 6, 1, 12, 7, 'm']],
      frame: [[-2, 1, -16, 2, 4, 6, 'g'], [-2, -6, 0, 2, 1, 6, 'g'], [-2, -12, 1, 2, -6, 7, 'g'], [-1, -1, -9, 1, 1, -8, 'g'], [-1, -1, -9, 1, 0, 0, 'g']],
      mag: [[-1, -15, 1, 1, -12, 6, 'M']],
    },
    pivots: { slide: [0, 7, 0], mag: [0, -13, 3] },
    muzzle: [0, 7, -24], eject: [2, 8, -4], rh: [0, -5, 3], lh: [0, -8, -1],
  },
  smg: {
    a: [64, 70, 80],
    parts: {
      body: [[-2, 0, -24, 2, 8, 10, 'a'], [-1, 8, -20, 1, 10, 4, 'm'], [-1, 3, -34, 1, 6, -24, 'm'], [-2, 2, -37, 2, 7, -34, 'M'], [-1, -10, 2, 1, 0, 8, 'g'], [-1, 3, 10, 1, 7, 24, 'm'], [-1, 10, -3, 1, 11, 0, 'm']],
      mag: [[-1, -16, -9, 1, 0, -3, 'M']],
      bolt: [[2, 4, -12, 3, 6, -8, 'M']],
    },
    pivots: { mag: [0, -8, -6], bolt: [2, 5, -10] },
    muzzle: [0, 4, -38], eject: [2, 5, -10], rh: [0, -5, 5], lh: [0, -2, -17],
  },
  rifle: {
    a: [92, 70, 48],
    parts: {
      body: [[-2, 0, -20, 2, 9, 10, 'a'], [-2, 9, -20, 2, 10, -8, 'm'], [-2, 1, -44, 2, 8, -20, 'w'], [-1, 8, -40, 1, 10, -24, 'w'], [-1, 10, -40, 1, 12, -24, 'm'],
        [-1, 3, -66, 1, 6, -44, 'm'], [-1, 6, -64, 1, 11, -62, 'm'], [-2, 2, -70, 2, 7, -66, 'M'], [-2, -2, 10, 2, 8, 22, 'w'], [-2, -6, 22, 2, 6, 38, 'w'], [-2, -7, 38, 2, 7, 39, 'b'],
        [-1, -10, 1, 1, 0, 7, 'g'], [-1, 10, -12, 1, 12, -8, 'm']],
      mag: [[-1, -12, -14, 1, 0, -6, 'M'], [-1, -18, -18, 1, -12, -9, 'M']],
      bolt: [[2, 5, -8, 4, 7, -3, 'M']],
    },
    pivots: { mag: [0, -9, -10], bolt: [3, 6, -5] },
    muzzle: [0, 4, -71], eject: [2, 6, -6], rh: [0, -5, 4], lh: [0, -2, -31],
  },
  shotgun: {
    a: [62, 70, 82],
    parts: {
      body: [[-2, 0, -8, 2, 8, 14, 'a'], [-1, 4, -72, 1, 7, -8, 'm'], [-1, 0, -62, 1, 3, -8, 'm'], [-1, 7, -72, 1, 9, -70, 'M'], [-2, -4, 14, 2, 6, 34, 'w'], [-2, -8, 34, 2, 5, 46, 'w'], [-1, -9, 2, 1, 0, 8, 'g']],
      pump: [[-2, -2, -46, 2, 4, -30, 'w'], [-2, -3, -44, 2, -2, -32, 'g']],
      bolt: [[2, 4, -2, 4, 6, 3, 'M']],
    },
    pivots: { pump: [0, 1, -38], bolt: [2, 5, 0] },
    muzzle: [0, 5, -73], eject: [2, 5, 0], rh: [0, -5, 6], lh: [0, 1, -38],
  },
  sniper: {
    a: [58, 84, 62],
    parts: {
      body: [[-2, 0, -14, 2, 8, 12, 'a'], [-1, 2, -82, 1, 5, -14, 'm'], [-2, 1, -92, 2, 6, -82, 'M'], [-2, 10, -26, 2, 14, 2, 'b'], [-3, 9, -29, 3, 15, -26, 'b'], [-3, 9, 2, 3, 15, 4, 'b'],
        [-1, 8, -20, 1, 10, -8, 'm'], [-1, 10, -29, 1, 14, -28, 'e'], [-2, -6, 12, 2, 6, 50, 'a'], [-2, 6, 24, 2, 8, 40, 'a'], [-1, -10, 2, 1, 0, 8, 'g']],
      mag: [[-1, -8, -8, 1, 0, -2, 'M']],
      bolt: [[2, 4, 2, 4, 6, 6, 'M'], [4, 4, 5, 7, 6, 6, 'M'], [7, 3, 4, 9, 7, 7, 'M']],
    },
    pivots: { mag: [0, -4, -5], bolt: [2, 5, 4] },
    muzzle: [0, 3, -93], eject: [2, 5, 4], rh: [0, -5, 5], lh: [0, -2, -16],
  },
  grenade: {
    a: [64, 150, 72],
    parts: { body: [], lever: [[1, 5, -1, 6, 6, 1, 'M']], pin: [[-1, 8, -1, 1, 11, 1, 'M']] },
    sphere: { r: 5.4, key: 'a' },
    extra: { body: [[-1, 5, -1, 1, 8, 1, 'M'], [-2, 4, -2, 2, 5, 2, 'm']] },
    pivots: { lever: [1, 5, 0], pin: [0, 9, 0] },
    muzzle: [0, 0, 0], rh: [0, -2, 0], lh: null,
  },
  flash: {
    a: [176, 180, 188],
    parts: { body: [[-2, 0, -3, 2, 12, 3, 'a'], [-3, 0, -2, 3, 12, 2, 'a'], [-3, 4, -2, 3, 6, 2, 'm'], [-1, 12, -1, 1, 13, 1, 'M']], lever: [[2, 3, -1, 4, 12, 1, 'M']], pin: [[-1, 13, -1, 1, 15, 1, 'M']] },
    pivots: { lever: [3, 12, 0], pin: [0, 14, 0] },
    muzzle: [0, 0, 0], rh: [0, -1, 0], lh: null,
  },
  smoke: {
    a: [92, 118, 98],
    parts: { body: [[-2, 0, -3, 2, 13, 3, 'a'], [-3, 0, -2, 3, 13, 2, 'a'], [-3, 8, -2, 3, 10, 2, 'y'], [-1, 13, -1, 1, 14, 1, 'M']], lever: [[2, 3, -1, 4, 13, 1, 'M']], pin: [[-1, 14, -1, 1, 16, 1, 'M']] },
    pivots: { lever: [3, 13, 0], pin: [0, 15, 0] },
    muzzle: [0, 0, 0], rh: [0, -1, 0], lh: null,
  },
  molotov: {
    a: [96, 62, 30],
    parts: { body: [[-3, 0, -2, 3, 9, 2, 'a'], [-2, 0, -3, 2, 9, 3, 'a'], [-2, 9, -1, 2, 12, 1, 'a'], [-1, 12, -1, 1, 17, 1, 'a'], [-2, 3, -3, 2, 6, -2, 'y'], [-1, 17, -1, 1, 20, 1, 'B'], [0, 19, 0, 1, 22, 1, 'r']], lever: [], pin: [] },
    pivots: {},
    muzzle: [0, 0, 0], rh: [0, -1, 0], lh: null,
  },
  // ---- ножове ----
  bayonet: {
    a: [200, 206, 214], knife: true,
    parts: {
      blade: [[-1, 0, -30, 1, 5, -6, 'a'], [-1, 1, -34, 1, 4, -30, 'a'], [-1, 2, -36, 1, 3, -34, 'a'], [-1, 5, -26, 1, 6, -8, 'm'], [-1, 2, -26, 1, 3, -8, 'm']],
      handle: [[-3, -1, -8, 3, 6, -6, 'm'], [-2, 0, -6, 2, 5, 10, 'b'], [-2, 1, -3, 2, 4, -1, 'g'], [-2, 1, 2, 2, 4, 4, 'g'], [-2, 1, 6, 2, 4, 8, 'g'], [-2, -1, 10, 2, 6, 12, 'm']],
    },
    pivots: { blade: [0, 2, -6], handle: [0, 2, 2] },
    muzzle: [0, 2, -36], rh: [0, 2, 3], lh: null,
  },
  karambit: {
    a: [196, 202, 210], knife: true,
    parts: {
      blade: [[-1, 1, -8, 1, 5, -2, 'a'], [-1, 0, -14, 1, 5, -8, 'a'], [-1, -3, -18, 1, 4, -14, 'a'], [-1, -8, -20, 1, 2, -18, 'a'], [-1, -12, -21, 1, -4, -20, 'a'], [-1, 5, -8, 1, 6, -2, 'm'], [-1, 4, -14, 1, 5, -8, 'm']],
      handle: [[-2, 0, -2, 2, 4, 12, 'g'], [-2, 1, 0, 2, 3, 1, 'b'], [-2, 1, 4, 2, 3, 5, 'b'], [-2, 1, 8, 2, 3, 9, 'b']],
      ring: [[-1, -6, 10, 1, -5, 17, 'm'], [-1, -6, 10, 1, 1, 11, 'm'], [-1, 0, 10, 1, 1, 17, 'm'], [-1, -6, 16, 1, 1, 17, 'm']],
    },
    pivots: { blade: [0, 2, -2], handle: [0, 2, 5], ring: [0, -2, 13] },
    muzzle: [0, -10, -21], rh: [0, 2, 3], lh: null, ringPivot: [0, -2, 13],
  },
  butterfly: {
    a: [206, 210, 216], knife: true,
    parts: {
      blade: [[-1, 1, -30, 1, 6, -4, 'a'], [-1, 2, -34, 1, 5, -30, 'a'], [-1, 3, -36, 1, 4, -34, 'a'], [-1, 6, -26, 1, 7, -6, 'm'], [-1, 3, -22, 1, 4, -8, 'm']],
      hA: [[-4, 0, -4, -1, 4, 18, 'g'], [-4, 1, 0, -1, 3, 2, 'M'], [-4, 1, 12, -1, 3, 14, 'M'], [-4, 0, 17, -1, 4, 18, 'm']],
      hB: [[1, 0, -4, 4, 4, 18, 'g'], [1, 1, 0, 4, 3, 2, 'M'], [1, 1, 12, 4, 3, 14, 'M'], [1, 0, 17, 4, 4, 18, 'm']],
    },
    pivots: { hA: [-2, 2, -3], hB: [2, 2, -3], blade: [0, 3, -4] },
    muzzle: [0, 3, -36], rh: [0, 2, 6], lh: null,
  },
  hunting: {
    a: [190, 196, 204], knife: true,
    parts: {
      blade: [[-1, 0, -36, 1, 7, -8, 'a'], [-1, 0, -42, 1, 4, -36, 'a'], [-1, 0, -46, 1, 2, -42, 'a'], [-1, 7, -30, 1, 8, -8, 'm'], [-1, 4, -34, 1, 5, -10, 'm']],
      handle: [[-3, -1, -10, 3, 8, -8, 'm'], [-2, 0, -8, 2, 6, 10, 'w'], [-2, 0, -4, 2, 6, -3, 'M'], [-2, 0, 4, 2, 6, 5, 'M'], [-2, 0, 10, 2, 6, 12, 'M']],
    },
    pivots: { blade: [0, 3, -8], handle: [0, 3, 2] },
    muzzle: [0, 1, -46], rh: [0, 3, 2], lh: null,
  },
  falchion: {
    a: [184, 190, 198], knife: true,
    parts: {
      blade: [[-1, 0, -16, 1, 8, -6, 'a'], [-1, 1, -26, 1, 10, -16, 'a'], [-1, 3, -36, 1, 12, -26, 'a'], [-1, 6, -44, 1, 13, -36, 'a'], [-1, 9, -48, 1, 13, -44, 'a'],
        [-1, 8, -16, 1, 9, -6, 'm'], [-1, 10, -26, 1, 11, -16, 'm'], [-1, 12, -36, 1, 13, -26, 'm']],
      handle: [[-3, -1, -8, 3, 7, -6, 'm'], [-2, 0, -6, 2, 5, 12, 'b'], [-2, 1, -2, 2, 4, -1, 'g'], [-2, 1, 3, 2, 4, 4, 'g'], [-2, -1, 12, 2, 6, 14, 'm']],
    },
    pivots: { blade: [0, 4, -8], handle: [0, 2, 3] },
    muzzle: [0, 8, -48], rh: [0, 2, 3], lh: null,
  },
};
// ръце: дланта е в началото, предмишницата се простира към +z
BP.arm = {
  parts: { arm: [[-3, -3, -4, 3, 3, 3, 's'], [3, -1, -3, 5, 2, 1, 's'], [-3, -3, 3, 3, 3, 8, 'k'], [-3, -3, 8, 3, 3, 40, 't']] },
  pivots: { arm: [0, 0, 0] },
};
BP.flash = { parts: { f: [[-2, -2, -2, 2, 2, 2, 'y'], [-6, -1, -1, 6, 1, 1, 'y'], [-1, -6, -1, 1, 6, 1, 'y'], [-1, -1, -8, 1, 1, 3, 'y']] }, pivots: { f: [0, 0, 0] } };
BP.casing = { parts: { c: [[0, 0, 0, 3, 1, 1, 'y']] }, pivots: { c: [0, 0, 0] } };

// ---------- построител ----------
const key3 = (x, y, z) => ((x + 512) << 20) | ((y + 512) << 10) | (z + 512);
const unkey = k => [((k >> 20) & 1023) - 512, ((k >> 10) & 1023) - 512, (k & 1023) - 512];
const hash3 = (x, y, z) => { let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], l: 0.82 }, { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], l: 0.82 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], l: 1.0 }, { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], l: 0.5 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], l: 0.72 }, { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], l: 0.72 },
];
const lin = v => Math.pow(Math.max(0, Math.min(255, v)) / 255, 2.2);

function fillPart(boxes, sphere) {
  const m = new Map();
  for (const [x0, y0, z0, x1, y1, z1, c] of boxes) for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) m.set(key3(x, y, z), c);
  if (sphere) { const r = sphere.r, R = Math.ceil(r); for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) if (x * x + y * y + z * z <= r * r) m.set(key3(x, y, z), sphere.key); }
  return m;
}
// под-воксели: всеки воксел се разделя на sub^3 по-малки (за 5 мм детайл на моделите в ръка)
function subdivide(m, sub) {
  const out = new Map();
  for (const [k, c] of m) { const [x, y, z] = unkey(k); for (let i = 0; i < sub; i++) for (let j = 0; j < sub; j++) for (let l = 0; l < sub; l++) out.set(key3(x * sub + i, y * sub + j, z * sub + l), c); }
  return out;
}
function coarsen(m, step) {
  if (step === 1) return m;
  const cnt = new Map();
  for (const [k, c] of m) { const [x, y, z] = unkey(k); const ck = key3(Math.floor(x / step), Math.floor(y / step), Math.floor(z / step)); const e = cnt.get(ck) || { n: 0, c }; e.n++; cnt.set(ck, e); }
  const out = new Map(); for (const [k, e] of cnt) if (e.n >= (step * step * step) / 3) out.set(k, e.c);
  return out;
}

const geoCache = new Map();
// Връща {geo} за част; teamColor се ползва само за ръкава на ръката ('t').
function partGeometry(bpId, partName, skinId, step, team) {
  const ck = `${bpId}/${partName}/${skinId}/${step}/${team}`;
  let g = geoCache.get(ck); if (g) return g;
  const bp = BP[bpId], boxes = bp.parts[partName].concat(bp.extra?.[partName] || []);
  const raw = fillPart(boxes, partName === 'body' ? bp.sphere : null), vox = step < 1 ? subdivide(raw, Math.round(1 / step)) : coarsen(raw, step);
  const pivot = bp.pivots?.[partName] || [0, 0, 0], skin = SKINS[skinId] || SKINS.default;
  const base = bp.a || [120, 120, 130];
  const pos = [], col = [], idx = [];
  const sleeve = team === 'def' ? [48, 92, 190] : [214, 118, 34];
  for (const [k, c] of vox) {
    const [x, y, z] = unkey(k);
    const wx = x * step, wy = y * step, wz = z * step;       // воксел в блупринт координати
    let rgb;
    if (c === 'a') rgb = skinId === 'default' || !skin ? base : skin.fn(wx, wy, wz, base);
    else if (c === 'w' && skinId !== 'default' && !bp.knife) rgb = skin.fn(wx, wy, wz, PAL.w);
    else if (c === 't') rgb = sleeve;
    else rgb = PAL[c] || [128, 128, 128];
    const nz = 0.93 + hash3(x, y, z) * 0.14;
    for (const f of FACES) {
      const nk = key3(x + f.n[0], y + f.n[1], z + f.n[2]);
      if (vox.has(nk)) continue;
      const b = pos.length / 3, sh = f.l * nz;
      for (const cc of f.c) {
        pos.push(((x + cc[0]) * step - pivot[0]) * VS, ((y + cc[1]) * step - pivot[1]) * VS, ((z + cc[2]) * step - pivot[2]) * VS);
        col.push(lin(rgb[0] * sh), lin(rgb[1] * sh), lin(rgb[2] * sh));
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeBoundingSphere();
  g = { geo, pivot }; geoCache.set(ck, g); return g;
}

const MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
const MAT_FLASH = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

// Създава групата на модела. Всяка част е Object3D на позицията на пивота си: animations -> parts[name].position/rotation.
export function buildModel(bpId, { skin = 'default', step = 1, team = 'att' } = {}) {
  const bp = BP[bpId];
  const root = new THREE.Group(); const parts = {};
  for (const name of Object.keys(bp.parts)) {
    if (!bp.parts[name].length && !(name === 'body' && bp.sphere)) continue;
    const { geo, pivot } = partGeometry(bpId, name, skin, step, team);
    const holder = new THREE.Group(); holder.position.set(pivot[0] * VS, pivot[1] * VS, pivot[2] * VS);
    const mesh = new THREE.Mesh(geo, bpId === 'flash' ? MAT_FLASH : MAT); holder.add(mesh); root.add(holder);
    holder.userData.rest = holder.position.clone();
    parts[name] = holder;
  }
  root.userData = { bpId, parts, bp, p: v => new THREE.Vector3(v[0] * VS, v[1] * VS, v[2] * VS) };
  return root;
}
// варианти (силует/цвят/обков се различават); анимациите и звукът идват от базовия модел (like)
const sil = (z0, z1, y = 3) => [-1, y, z0, 1, y + 3, z1, 'b'];         // заглушител (кутия пред цевта)
BP.glock = derive('pistol', { a: [38, 40, 44], swap: { M: 'g' } });
BP.usp = derive('pistol', { a: [74, 78, 86], add: { slide: [[-1, 5, -26, 1, 8, -16, 'b']] }, muzzle: [0, 6, -27] });
BP.p250 = derive('pistol', { a: [90, 94, 102], swap: { M: 'm' } });
BP.fiveseven = derive('pistol', { a: [72, 60, 48], add: { mag: [[-1, -16, 1, 1, -12, 6, 'M']] } });
BP.tec9 = derive('pistol', { a: [48, 52, 48], add: { mag: [[-1, -20, 7, 1, -12, 12, 'M']] } });
BP.p2000 = derive('pistol', { a: [96, 100, 108], swap: { M: 'm' } });
BP.galil = derive('rifle', { a: [96, 104, 92], swap: { w: 'g' } });
BP.xm1014 = derive('shotgun', { a: [40, 44, 50], swap: { w: 'b' } });
BP.mag7 = derive('shotgun', { a: [60, 68, 82], swap: { w: 'g' } });
BP.sawedoff = derive('shotgun', { a: [100, 72, 50] });
BP.ssg08 = derive('sniper', { a: [92, 98, 64] });
BP.scar20 = derive('sniper', { a: [34, 36, 40] });
BP.g3sg1 = derive('sniper', { a: [82, 84, 62], swap: { a: 'g' } });
// ---- по-близки до оригиналите форми (воксел силуети) ----
const mk = (a, like, parts, pivots, muzzle, eject, rh, lh) => ({ a, like, parts, pivots, muzzle, eject, rh, lh });
// М4: права кутия-пълнител, прицелна дръжка, телескопичен приклад
BP.m4 = mk([50, 52, 58], 'rifle', {
  body: [[-2, 0, -20, 2, 9, 10, 'a'], [-1, 9, -20, 1, 10, -6, 'm'], [-1, 10, -16, 1, 13, -8, 'm'], [-1, 13, -15, 1, 14, -9, 'm'], [-2, 1, -42, 2, 8, -20, 'm'], [-2, -3, -42, 2, 0, -30, 'g'],
    [-1, 3, -62, 1, 6, -42, 'm'], [-2, 2, -66, 2, 7, -62, 'M'], [-1, 6, -60, 1, 10, -58, 'm'], [-2, -2, 10, 2, 8, 16, 'a'], [-1, 1, 16, 1, 6, 32, 'm'], [-2, -3, 32, 2, 7, 33, 'b'], [-1, -10, 1, 1, 0, 7, 'g']],
  mag: [[-1, -16, -13, 1, 0, -5, 'M']],
  bolt: [[2, 5, -8, 3, 7, -3, 'M']],
}, { mag: [0, -8, -9], bolt: [2, 6, -5] }, [0, 4, -67], [2, 6, -6], [0, -5, 4], [0, -2, -31]);
BP.m4a4 = derive('m4', { a: [46, 48, 54] });
BP.m4a1s = derive('m4', { a: [66, 68, 74], add: { body: [[-2, 2, -92, 2, 7, -66, 'b']] }, muzzle: [0, 4, -93] });
BP.sg553 = derive('m4', { a: [84, 82, 86], add: { body: [[-1, 14, -24, 1, 18, -10, 'b'], [-1, 15, -26, 1, 17, -24, 'e']] } });
// АУГ / ФАМАС: булпъп (пълнителят зад дръжката, цевта отпред)
BP.aug = mk([74, 90, 74], 'rifle', {
  body: [[-2, -2, -14, 2, 9, 34, 'a'], [-2, 9, -14, 2, 11, 6, 'm'], [-1, 11, -16, 1, 15, 4, 'b'], [-1, 14, -17, 1, 15, 5, 'e'], [-1, 3, -52, 1, 6, -14, 'm'], [-2, 2, -56, 2, 7, -52, 'M'], [-1, -8, -16, 1, 0, -10, 'g'], [-1, -10, -4, 1, -2, 2, 'g'], [-2, -3, 34, 2, 8, 35, 'b']],
  mag: [[-1, -14, 8, 1, 0, 15, 'M']],
  bolt: [[2, 5, -4, 3, 7, 0, 'M']],
}, { mag: [0, -7, 11], bolt: [2, 6, -2] }, [0, 4, -57], [2, 6, -2], [0, -5, -1], [0, -3, -26]);
BP.famas = mk([64, 76, 58], 'rifle', {
  body: [[-2, -2, -10, 2, 9, 32, 'a'], [-1, 9, -12, 1, 12, -6, 'm'], [-1, 9, 4, 1, 12, 14, 'm'], [-1, 12, -12, 1, 13, 14, 'm'], [-1, 3, -50, 1, 6, -10, 'm'], [-2, 2, -54, 2, 7, -50, 'M'], [-1, -9, -16, 1, 0, -10, 'g'], [-1, -10, -3, 1, -2, 3, 'g'], [-2, -3, 32, 2, 8, 33, 'b']],
  mag: [[-1, -14, 8, 1, 0, 14, 'M']],
  bolt: [[2, 5, -4, 3, 7, 0, 'M']],
}, { mag: [0, -7, 11], bolt: [2, 6, -2] }, [0, 4, -55], [2, 6, -2], [0, -5, -1], [0, -3, -26]);
// П90: булпъп с хоризонтален пълнител отгоре и дупка за палеца
BP.p90 = mk([186, 190, 196], 'smg', {
  body: [[-3, -2, -14, 3, 8, 22, 'a'], [-1, 8, -16, 1, 9, 14, 'm'], [-1, 9, -8, 1, 12, -4, 'b'], [-1, -9, 1, 1, -2, 8, 'g'], [-1, 3, -26, 1, 6, -14, 'm'], [-1, 2, -30, 1, 7, -26, 'M'], [-2, -3, 22, 2, 7, 23, 'b']],
  mag: [[-2, 9, -16, 2, 12, 14, 'M']],
  bolt: [[3, 4, -6, 4, 6, -2, 'M']],
}, { mag: [0, 10, -1], bolt: [3, 5, -4] }, [0, 4, -31], [3, 5, -4], [0, -5, 3], [0, -3, -14]);
// Бизон: дълъг цилиндричен пълнител под цевта
BP.bizon = mk([150, 120, 80], 'smg', {
  body: [[-2, 0, -20, 2, 8, 10, 'a'], [-1, 8, -16, 1, 10, 4, 'm'], [-1, 4, -40, 1, 7, -20, 'm'], [-1, 3, -44, 1, 8, -40, 'M'], [-1, 3, 10, 1, 5, 28, 'm'], [-1, -9, 1, 1, 0, 7, 'g']],
  mag: [[-2, -1, -36, 2, 5, -16, 'M'], [-1, 5, -36, 1, 6, -16, 'M']],
  bolt: [[2, 4, -8, 3, 6, -3, 'M']],
}, { mag: [0, 2, -26], bolt: [2, 5, -5] }, [0, 5, -45], [2, 5, -5], [0, -5, 4], [0, -1, -24]);
// Мак-10: малка кутия с къс заглушител
BP.mac10 = mk([38, 40, 44], 'smg', {
  body: [[-2, 0, -14, 2, 9, 6, 'a'], [-1, 9, -12, 1, 10, 2, 'm'], [-1, 3, -28, 1, 7, -14, 'b'], [-2, 2, -30, 2, 8, -28, 'M'], [-1, 5, 6, 1, 7, 18, 'm'], [-1, -9, 0, 1, 0, 6, 'g']],
  mag: [[-1, -16, 0, 1, -9, 6, 'M']],
  bolt: [[2, 4, -6, 3, 6, -2, 'M']],
}, { mag: [0, -10, 3], bolt: [2, 5, -4] }, [0, 5, -31], [2, 5, -4], [0, -5, 3], [0, -2, -10]);
// МП7: компактна, с предна дръжка и подвижен приклад
BP.mp7 = mk([76, 80, 74], 'smg', {
  body: [[-2, 0, -16, 2, 8, 8, 'a'], [-1, 8, -16, 1, 10, 4, 'm'], [-1, -6, -14, 1, 0, -8, 'g'], [-1, 3, -32, 1, 6, -16, 'm'], [-2, 2, -35, 2, 7, -32, 'M'], [-1, 2, 8, 1, 6, 24, 'm'], [-2, -2, 24, 2, 7, 25, 'b'], [-1, -9, 1, 1, 0, 7, 'g']],
  mag: [[-1, -16, -6, 1, 0, 0, 'M']],
  bolt: [[2, 4, -8, 3, 6, -3, 'M']],
}, { mag: [0, -8, -3], bolt: [2, 5, -5] }, [0, 4, -36], [2, 5, -5], [0, -5, 4], [0, -2, -11]);
// УМП-45: по-широка, с дълъг предпазител и клапа
BP.ump = mk([96, 102, 110], 'smg', {
  body: [[-2, 0, -24, 2, 8, 10, 'a'], [-2, 1, -36, 2, 6, -24, 'g'], [-1, 8, -22, 1, 10, 6, 'm'], [-1, 3, -44, 1, 6, -36, 'm'], [-2, 2, -46, 2, 7, -44, 'M'], [-1, 2, 10, 1, 6, 28, 'm'], [-2, -2, 28, 2, 7, 29, 'b'], [-1, -9, 1, 1, 0, 7, 'g']],
  mag: [[-1, -16, -12, 1, 0, -5, 'M']],
  bolt: [[2, 4, -10, 3, 6, -5, 'M']],
}, { mag: [0, -8, -8], bolt: [2, 5, -7] }, [0, 4, -47], [2, 5, -7], [0, -5, 4], [0, -2, -22]);
export const modelIdFor = (weapon, cos) => (weapon === 'knife' ? (cos?.knife || 'bayonet') : weapon);
export const skinFor = (weapon, cos) => (weapon === 'knife' ? (cos?.skins?.['knife_' + (cos?.knife || 'bayonet')] || 'default') : (cos?.skins?.[weapon] || 'default'));
