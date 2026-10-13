// Процедурни пикселни текстури 64x64 (canvas), без външни файлове.
// Атласът е с 8px "extrude" около всяка плочка, за да няма процепи при mip-ниваите.
import { BLOCK } from '/shared/world.js';

const S = 64, PAD = 8, CELL = S + PAD * 2, COLS = 8;

// ---------- шум (всичко е периодично, за да се лепи безпроблемно) ----------
const hash = (x, y, seed) => {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
};
const sm = t => t * t * (3 - 2 * t);
function vn(x, y, px, py, seed) {                       // value noise с период px×py клетки
  const u = x * px / S, v = y * py / S, ix = Math.floor(u), iy = Math.floor(v), fx = sm(u - ix), fy = sm(v - iy);
  const L = (a, b) => hash(((a % px) + px) % px, ((b % py) + py) % py, seed);
  const a = L(ix, iy), b = L(ix + 1, iy), c = L(ix, iy + 1), d = L(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function fbm(x, y, seed, base = 4, oct = 4) {
  let a = 0.5, s = 0, t = 0, p = base;
  for (let o = 0; o < oct; o++) { s += a * vn(x, y, p, p, seed + o * 31); t += a; a *= 0.5; p *= 2; }
  return s / t;
}
function worley(x, y, n, seed) {                        // {d1,d2,id}
  const cs = S / n, cx = Math.floor(x / cs), cy = Math.floor(y / cs);
  let d1 = 1e9, d2 = 1e9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = cx + i, gy = cy + j, wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
    const px = (gx + hash(wx, wy, seed)) * cs, py = (gy + hash(wx, wy, seed + 77)) * cs;
    const d = Math.hypot(x - px, y - py);
    if (d < d1) { d2 = d1; d1 = d; id = wy * n + wx; } else if (d < d2) d2 = d;
  }
  return { d1, d2, id };
}
const clamp = (v, a = 0, b = 255) => (v < a ? a : v > b ? b : v);
const mul = (c, k) => [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const jit = (c, n, amt) => mul(c, 1 + (n - 0.5) * amt);

// ---------- плочки ----------
const TILES = {};
const def = (name, fn) => { TILES[name] = fn; };

def('stone', (x, y) => {
  const n = fbm(x, y, 1, 4, 4), r = Math.abs(fbm(x, y, 9, 3, 3) - 0.5) * 2;
  let c = jit([128, 128, 132], n, 0.5);
  if (r < 0.022) c = mul(c, 0.72);
  if (hash(x, y, 5) < 0.04) c = mul(c, hash(x, y, 6) < 0.5 ? 0.8 : 1.15);
  return c;
});
def('cobble', (x, y) => {
  const w = worley(x, y, 5, 3), edge = w.d2 - w.d1, g = 105 + hash(w.id, 1, 4) * 55;
  let c = jit([g, g, g + 4], fbm(x, y, 2, 8, 2), 0.35);
  if (edge < 2.2) c = mul(c, 0.45 + edge * 0.2);
  else if (edge < 4) c = mul(c, 0.9 + (edge - 2.2) * 0.05);
  return c;
});
def('gravel', (x, y) => {
  const w = worley(x, y, 9, 11), g = 90 + hash(w.id, 2, 12) * 80;
  let c = [g, g * 0.97, g * 0.92];
  if (w.d2 - w.d1 < 1.6) c = mul(c, 0.55);
  return jit(c, fbm(x, y, 3, 16, 1), 0.25);
});
def('brick', (x, y) => {
  const r = Math.floor(y / 8), ox = (r % 2) * 8, lx = (x + ox) % 16, ly = y % 8, bi = Math.floor((x + ox) / 16);
  if (lx < 2 || ly < 2) return jit([196, 188, 176], fbm(x, y, 4, 8, 2), 0.25);
  const k = hash(bi, r, 21);
  let c = mix([150, 66, 50], [178, 88, 60], k);
  c = jit(c, fbm(x, y, 5, 8, 3), 0.35);
  if (ly === 2 || lx === 2) c = mul(c, 1.12);
  if (ly === 7 || lx === 15) c = mul(c, 0.85);
  if (hash(x, y, 8) < 0.03) c = mul(c, 0.7);
  return c;
});
def('sand', (x, y) => {
  const rip = Math.sin((y + fbm(x, y, 6, 3, 2) * 14) * 0.45) * 0.04;
  let c = jit([222, 200, 140], fbm(x, y, 7, 8, 3), 0.28);
  c = mul(c, 1 + rip);
  if (hash(x, y, 9) < 0.06) c = mul(c, 0.88);
  if (hash(x, y, 10) < 0.02) c = mul(c, 1.12);
  return c;
});
def('sandstone', (x, y) => {
  const band = Math.sin((y + fbm(x, y, 12, 2, 2) * 10) * 0.5) * 0.035 + (vn(x, y, 1, 16, 14) - 0.5) * 0.12;
  let c = jit([204, 172, 112], fbm(x, y, 13, 8, 3), 0.3);
  c = mul(c, 1 + band);
  const r = Math.abs(fbm(x, y, 15, 3, 3) - 0.5) * 2; if (r < 0.022) c = mul(c, 0.78);
  if (x < 1 || y < 1) c = mul(c, 0.86);
  return c;
});
def('log_side', (x, y) => {
  const n = vn(x, y, 16, 3, 20), n2 = vn(x, y, 32, 6, 21);
  let c = mix([92, 62, 34], [128, 88, 48], n);
  c = mul(c, 0.8 + n2 * 0.4);
  if (vn(x, y, 8, 2, 22) > 0.78) c = mul(c, 0.6);
  return c;
});
def('log_top', (x, y) => {
  const d = Math.hypot(x - 31.5, y - 31.5), edge = Math.max(Math.abs(x - 31.5), Math.abs(y - 31.5));
  if (edge > 28) return jit([92, 62, 34], vn(x, y, 16, 3, 20), 0.5);
  const ring = Math.sin((d + fbm(x, y, 24, 3, 2) * 4) * 1.1) * 0.5 + 0.5;
  return mix([196, 150, 90], [150, 104, 58], ring);
});
def('planks', (x, y) => {
  const p = Math.floor(y / 16), ly = y % 16, k = hash(p, 0, 31);
  if (ly === 0) return [50, 33, 18];
  const grain = vn(x + hash(p, 1, 32) * 64, y, 6, 40, 33);
  let c = mix([150, 104, 60], [178, 130, 78], k);
  c = mul(c, 0.82 + grain * 0.3);
  if (ly === 1) c = mul(c, 1.15);
  if (ly === 15) c = mul(c, 0.8);
  const nx = (p % 2) * 32 + 4;
  if (ly >= 7 && ly <= 8 && (x - nx) % 56 >= 0 && Math.abs(x - nx) < 2) c = [64, 52, 44];
  if (hash(x, y, 34) < 0.02) c = mul(c, 0.7);
  return c;
});
def('crate', (x, y) => {
  const b = Math.min(x, y, 63 - x, 63 - y);
  const diag = Math.abs(x - y) < 4 || Math.abs(x + y - 63) < 4;
  if (b < 7) { let c = jit([118, 80, 44], vn(x, y, 3, 20, 41), 0.5); if (b === 6) c = mul(c, 0.6); if (b === 0) c = mul(c, 0.7); return c; }
  if (diag) return mul(jit([138, 96, 54], vn(x, y, 20, 3, 42), 0.4), b === 7 ? 0.7 : 1);
  const p = Math.floor(x / 8);
  let c = jit(mix([164, 118, 70], [186, 140, 86], hash(p, 2, 43)), vn(x, y, 4, 30, 44), 0.35);
  if (x % 8 === 0) c = mul(c, 0.65);
  return c;
});
def('glass', (x, y) => {
  const b = Math.min(x, y, 63 - x, 63 - y);
  if (b < 3) return [214, 238, 250, 235];
  if (b === 3) return [150, 190, 215, 180];
  const d = (x + y) % 32;
  if (d < 3 && x + y < 70) return [255, 255, 255, 120];
  if (d > 4 && d < 6 && x + y < 70) return [255, 255, 255, 70];
  return [170, 215, 240, 52 + Math.floor(fbm(x, y, 45, 4, 2) * 18)];
});
def('concrete', (x, y) => {
  let c = jit([132, 134, 138], fbm(x, y, 51, 8, 4), 0.38);
  if (hash(x, y, 52) < 0.025) c = mul(c, 0.7);
  if (fbm(x, y, 53, 3, 3) > 0.66) c = mul(c, 0.85);
  if (x < 1 || y < 1) c = mul(c, 0.82); if (x === 63 || y === 63) c = mul(c, 1.1);
  return c;
});
def('metal', (x, y) => {
  let c = jit([140, 150, 160], vn(x, y, 2, 48, 61), 0.28);
  c = mul(c, 0.95 + hash(x, y, 62) * 0.1);
  const b = Math.min(x, y, 63 - x, 63 - y);
  if (b < 2) c = mul(c, 0.6); else if (b === 2) c = mul(c, 1.2);
  for (const [rx, ry] of [[6, 6], [57, 6], [6, 57], [57, 57]]) if (Math.hypot(x - rx, y - ry) < 3) c = Math.hypot(x - rx + 1, y - ry + 1) < 1.6 ? [210, 218, 226] : [90, 98, 108];
  if (Math.abs(y - 32) < 1) c = mul(c, 0.7);
  return c;
});
def('rust', (x, y) => {
  const r = fbm(x, y, 71, 4, 4);
  let c = r > 0.5 ? mix([150, 78, 38], [112, 52, 28], (r - 0.5) * 2.4) : mix([128, 112, 98], [150, 80, 40], r * 2);
  c = jit(c, hash(x, y, 72), 0.18);
  const b = Math.min(x, y, 63 - x, 63 - y); if (b < 2) c = mul(c, 0.6);
  for (const [rx, ry] of [[6, 6], [57, 6], [6, 57], [57, 57]]) if (Math.hypot(x - rx, y - ry) < 3) c = [74, 40, 24];
  return c;
});
def('road', (x, y) => {
  let c = jit([108, 100, 88], fbm(x, y, 81, 8, 4), 0.42);
  const w = worley(x, y, 12, 82); if (w.d2 - w.d1 < 1.1) c = mul(c, 0.75);
  if (hash(x, y, 83) < 0.04) c = mul(c, 1.2);
  return c;
});
def('site', (x, y) => {
  const b = Math.min(x, y, 63 - x, 63 - y);
  if (b < 3) return [28, 26, 24];
  const st = ((x + y) >> 3) & 1;
  let c = st ? [244, 196, 40] : [46, 42, 38];
  c = jit(c, fbm(x, y, 91, 8, 3), 0.25);
  if (hash(x, y, 92) < 0.03) c = mul(c, 0.7);
  return c;
});
def('grass_top', (x, y) => {
  const n = fbm(x, y, 101, 6, 4), blade = vn(x, y, 40, 6, 102);
  let c = mix([62, 120, 40], [96, 160, 56], n);
  c = mul(c, 0.85 + blade * 0.3);
  if (hash(x, y, 103) < 0.05) c = mul(c, 0.75);
  return c;
});
def('dirt', (x, y) => {
  let c = jit([124, 88, 58], fbm(x, y, 111, 8, 4), 0.45);
  if (hash(x, y, 112) < 0.05) c = [92, 64, 40]; if (hash(x, y, 113) < 0.03) c = [150, 120, 90];
  return c;
});
def('grass_side', (x, y) => {
  const edge = 10 + vn(x, y, 16, 1, 121) * 12;
  if (y < edge) return TILES.grass_top(x, y);
  if (y < edge + 3) return mul(TILES.dirt(x, y), 0.8);
  return TILES.dirt(x, y);
});
def('snow', (x, y) => {
  let c = mix([232, 240, 250], [205, 220, 240], fbm(x, y, 131, 6, 3));
  if (hash(x, y, 132) < 0.015) c = [255, 255, 255];
  if (hash(x, y, 133) < 0.02) c = [190, 208, 232];
  return c;
});
def('ice', (x, y) => {
  let c = mix([150, 200, 235], [196, 228, 248], fbm(x, y, 141, 4, 3));
  const r = Math.abs(fbm(x, y, 142, 3, 4) - 0.5) * 2, r2 = Math.abs(fbm(x, y, 143, 5, 3) - 0.5) * 2;
  if (r < 0.05) c = [236, 247, 255]; else if (r2 < 0.035) c = [120, 170, 214];
  if ((x + y) % 40 < 2) c = mul(c, 1.08);
  return c;
});
def('tiles', (x, y) => {
  const lx = x % 16, ly = y % 16, id = Math.floor(x / 16) + Math.floor(y / 16) * 4;
  if (lx < 1 || ly < 1) return [150, 150, 146];
  let c = mix([218, 224, 226], [196, 206, 212], hash(id, 0, 151));
  c = jit(c, fbm(x, y, 152, 8, 3), 0.12);
  if (lx === 1 || ly === 1) c = mul(c, 1.08); if (lx === 15 || ly === 15) c = mul(c, 0.9);
  if (hash(x, y, 153) < 0.02) c = mul(c, 0.85);
  return c;
});
const CONT = { red: [168, 48, 40], blue: [40, 84, 160], green: [44, 120, 72], yellow: [214, 164, 36] };
for (const [nm, col] of Object.entries(CONT)) {
  def('cont_' + nm, (x, y) => {
    let k = 0.84 + 0.16 * Math.cos(x / 8 * Math.PI * 2);
    let c = mul(jit(col, fbm(x, y, 161 + nm.length, 6, 3), 0.28), k);
    const wear = fbm(x, y, 165, 3, 4); if (wear > 0.62) c = mix(c, [118, 70, 44], (wear - 0.62) * 2.2);
    if (y < 6 || y > 57) { c = mul(col, 0.66); c = jit(c, hash(x, y, 162), 0.1); if (y === 5 || y === 58) c = mul(c, 1.2); }
    if (y > 24 && y < 36 && x > 12 && x < 50 && ((x + y) & 7) < 3) c = mix(c, [235, 235, 230], 0.55);
    if (x === 0 || x === 63) c = mul(c, 0.65);
    return c;
  });
  def('conttop_' + nm, (x, y) => {
    let c = jit(mul(col, 0.9), fbm(x, y, 171, 6, 3), 0.3);
    if (x % 16 < 2) c = mul(c, 0.7); if (Math.min(x, y, 63 - x, 63 - y) < 3) c = mul(col, 0.6);
    return c;
  });
}
def('water', (x, y) => {
  const n = fbm(x, y, 181, 4, 4), w = Math.sin((x + n * 20) * 0.35) * Math.sin((y + n * 20) * 0.3);
  let c = mix([30, 90, 160], [60, 140, 200], n);
  c = mul(c, 0.9 + w * 0.12);
  if (n > 0.66) c = mix(c, [210, 235, 250], (n - 0.66) * 3);
  return [c[0], c[1], c[2], 170];
});
def('torch', (x, y) => {
  if (x < 24 || x > 39) return [0, 0, 0, 0];
  if (y < 22) { const t = y / 22, cx = Math.abs(x - 31.5) / 8; const c = mix([255, 244, 150], [255, 120, 20], Math.min(1, t * 0.8 + cx * 0.6)); return [c[0], c[1], c[2], 255]; }
  return [...jit([120, 82, 44], vn(x, y, 6, 30, 191), 0.5), 255];
});
def('rail', (x, y) => {
  let c = jit([62, 56, 50], fbm(x, y, 201, 8, 3), 0.5);
  if ((y % 20) < 8 && x > 4 && x < 59) c = jit([108, 74, 40], vn(x, y, 3, 20, 202), 0.45);
  if ((x > 13 && x < 20) || (x > 43 && x < 50)) c = (x === 14 || x === 44) ? [220, 224, 230] : mul(jit([150, 156, 164], vn(x, y, 2, 30, 203), 0.2), x === 19 || x === 49 ? 0.6 : 1);
  return c;
});
def('lamp', (x, y) => {
  const b = Math.min(x, y, 63 - x, 63 - y);
  if (b < 5) return jit([96, 78, 50], hash(x, y, 211), 0.3);
  const g = Math.hypot(x - 31.5, y - 31.5) / 32;
  const c = mix([255, 244, 190], [255, 200, 90], g);
  return jit(c, fbm(x, y, 212, 6, 2), 0.12);
});

export const TILE_NAMES = Object.keys(TILES);

// ---------- блок -> плочки ----------
const T = (top, side = top, bottom = side) => ({ top, side, bottom });
export const BLOCK_TILES = {
  sand: T('sand'), sandstone: T('sandstone'), wood: T('log_top', 'log_side'), glass: T('glass'), concrete: T('concrete'),
  site: T('site'), brick: T('brick'), metal: T('metal'), road: T('road'), stone: T('stone'), planks: T('planks'), rust: T('rust'),
  grass: T('grass_top', 'grass_side', 'dirt'), dirt: T('dirt'), snow: T('snow'), ice: T('ice'), tiles: T('tiles'),
  cont_red: T('conttop_red', 'cont_red'), cont_blue: T('conttop_blue', 'cont_blue'), cont_green: T('conttop_green', 'cont_green'),
  cont_yellow: T('conttop_yellow', 'cont_yellow'), water: T('water'), torch: T('torch'), rail: T('rail'), lamp: T('lamp'),
  cobble: T('cobble'), crate: T('crate'), gravel: T('gravel'),
};

// ---------- атлас ----------
let cache = null;
export function buildAtlas(THREE) {
  if (cache) return cache;
  const names = TILE_NAMES, rows = Math.ceil(names.length / COLS);
  const W = COLS * CELL, H = rows * CELL;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const rect = {}, avg = {};
  names.forEach((nm, i) => {
    const cx = (i % COLS) * CELL + PAD, cy = Math.floor(i / COLS) * CELL + PAD;
    const img = g.createImageData(S, S), d = img.data;
    let sr = 0, sg = 0, sb = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const c = TILES[nm](x, y), o = (y * S + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3] === undefined ? 255 : c[3];
      sr += c[0]; sg += c[1]; sb += c[2];
    }
    avg[nm] = [sr / (S * S) | 0, sg / (S * S) | 0, sb / (S * S) | 0];
    g.putImageData(img, cx, cy);
    // extrude: повтаря крайните пиксели в рамката от PAD пиксела
    g.drawImage(cv, cx, cy, S, 1, cx, cy - PAD, S, PAD); g.drawImage(cv, cx, cy + S - 1, S, 1, cx, cy + S, S, PAD);
    g.drawImage(cv, cx, cy - PAD, 1, S + PAD * 2, cx - PAD, cy - PAD, PAD, S + PAD * 2);
    g.drawImage(cv, cx + S - 1, cy - PAD, 1, S + PAD * 2, cx + S, cy - PAD, PAD, S + PAD * 2);
    rect[nm] = { u0: cx / W, u1: (cx + S) / W, v0: 1 - (cy + S) / H, v1: 1 - cy / H };
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  const blockAvg = (id, name) => avg[BLOCK_TILES[name]?.side] || [128, 128, 128];
  cache = { texture: tex, rect, avg, canvas: cv, blockAvg };
  return cache;
}
