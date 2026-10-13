// Воксел свят: еднакъв код на сървъра и в браузъра.

// ---- Блокове ----
// solid: колизии/куршуми; opaque: спира светлината; destr: руши се от гранати; emit: светлина (0-15);
// surface: звук на стъпките; shape: 'cube' | 'torch' | 'rail' | 'wedge' (не-кубични, не-твърди за куршуми)
const D = (name, o = {}) => ({ name, solid: true, opaque: true, destr: false, emit: 0, surface: 'stone', shape: 'cube', ...o });
export const DEFS = [];
const def = (id, d) => { DEFS[id] = d; };
for (let i = 0; i < 64; i++) DEFS[i] = D('unused' + i, { solid: false, opaque: false });
def(0, D('air', { solid: false, opaque: false }));
def(1, D('sand', { surface: 'sand' }));
def(2, D('sandstone'));
def(3, D('wood', { destr: true, surface: 'wood' }));          // дънер
def(4, D('glass', { opaque: false, destr: true }));
def(5, D('concrete'));
def(6, D('site'));                                            // маркировка на бомбена точка
def(7, D('brick'));
def(8, D('metal', { surface: 'metal' }));
def(9, D('road', { surface: 'sand' }));
def(10, D('stone'));
def(11, D('planks', { destr: true, surface: 'wood' }));
def(12, D('rust', { surface: 'metal' }));
def(13, D('grass', { surface: 'grass' }));
def(14, D('dirt', { surface: 'grass' }));
def(15, D('snow', { surface: 'snow' }));
def(16, D('ice', { surface: 'ice' }));
def(17, D('tiles'));
def(18, D('cont_red', { surface: 'metal' }));
def(19, D('cont_blue', { surface: 'metal' }));
def(20, D('cont_green', { surface: 'metal' }));
def(21, D('cont_yellow', { surface: 'metal' }));
def(22, D('water', { solid: false, opaque: false, surface: 'water' }));
def(23, D('torch', { solid: false, opaque: false, emit: 14, shape: 'torch', surface: 'wood' }));
def(24, D('rail', { solid: false, opaque: false, shape: 'rail', surface: 'metal' }));
def(25, D('lamp', { emit: 15, surface: 'metal' }));
def(26, D('cobble'));
def(27, D('crate', { destr: true, surface: 'wood' }));
def(28, D('gravel'));
// ---- специални блокове за parkour / surf ----
def(29, D('checkpoint', { surface: 'metal' }));               // докосването го записва като последен checkpoint
def(30, D('finish', { surface: 'metal' }));                   // докосването спира таймера
def(31, D('lava', { emit: 12, surface: 'stone' }));           // смърт: връщане на последния checkpoint
def(32, D('slime', { surface: 'grass' }));                    // слуз: отскачане високо
def(33, D('slick', { surface: 'ice' }));                      // лед: плъзгане (малко триене)
def(34, D('startpad', { surface: 'metal' }));                 // стартова площадка
// ---- наклонени рампи (wedge): името е посоката, към която НАРАСТВА височината ----
// ramp_*: наклон 1:1 (45°, може да се стои); surf_lo/surf_hi: наклон 2:1 (63°, плъзгане) – двойка клетки една върху друга
export const WEDGE = {};
const DIRS = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] };
let wid = 40;
for (const kind of ['w45', 'lo', 'hi']) {
  for (const d of ['e', 'w', 's', 'n']) {
    const name = (kind === 'w45' ? 'ramp_' : 'surf_' + kind + '_') + d;
    def(wid, D(name, { solid: false, opaque: false, shape: 'wedge', surface: kind === 'w45' ? 'stone' : 'ice' }));
    WEDGE[wid] = { dx: DIRS[d][0], dz: DIRS[d][1], kind, dir: d };
    wid++;
  }
}
export const BLOCK = Object.fromEntries(DEFS.map((d, i) => [d.name, i]));
export const SOLID = DEFS.map(d => d.solid);
export const OPAQUE = DEFS.map(d => d.opaque);
export const DESTRUCTIBLE = new Set(DEFS.map((d, i) => (d.destr ? i : -1)).filter(i => i >= 0));
export const IS_WEDGE = DEFS.map((d, i) => !!WEDGE[i]);

// Профил на клина: височина (0..1) на разстояние u (0..1) по посоката на нарастване
export function wedgeH(kind, u) { return kind === 'w45' ? u : kind === 'lo' ? Math.min(1, 2 * u) : Math.max(0, 2 * u - 1); }
export function wedgeSlope(kind, u) { return kind === 'w45' ? 1 : kind === 'lo' ? (u < 0.5 ? 2 : 0) : (u >= 0.5 ? 2 : 0); }
// Профилът (u,h) за мешовете: полигон от точки
export const WEDGE_PROFILE = { w45: [[0, 0], [1, 0], [1, 1]], lo: [[0, 0], [1, 0], [1, 1], [0.5, 1]], hi: [[0.5, 0], [1, 0], [1, 1]] };

export class World {
  constructor(sx, sy, sz, data) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    this.data = data || new Uint8Array(sx * sy * sz);
  }
  get(x, y, z) {
    if (y < 0) return BLOCK.concrete;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return BLOCK.concrete;
    if (y >= this.sy) return 0;
    return this.data[(y * this.sz + z) * this.sx + x];
  }
  set(x, y, z, b) {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
    this.data[(y * this.sz + z) * this.sx + x] = b;
  }
  solid(x, y, z) { return SOLID[this.get(x, y, z)]; }
  clone() { return new World(this.sx, this.sy, this.sz, this.data.slice()); }

  // ops: ["блок", x1,y1,z1, x2,y2,z2] - запълване на кутия (включително), прилагат се по ред.
  static fromMap(map) {
    const [sx, sy, sz] = map.size;
    const w = new World(sx, sy, sz);
    for (const op of map.ops) {
      const b = BLOCK[op[0]];
      if (b === undefined) throw new Error('Непознат блок: ' + op[0]);
      const [x1, y1, z1, x2, y2, z2] = op.slice(1);
      for (let y = Math.max(0, Math.min(y1, y2)); y <= Math.min(sy - 1, Math.max(y1, y2)); y++)
        for (let z = Math.max(0, Math.min(z1, z2)); z <= Math.min(sz - 1, Math.max(z1, z2)); z++)
          for (let x = Math.max(0, Math.min(x1, x2)); x <= Math.min(sx - 1, Math.max(x1, x2)); x++)
            w.set(x, y, z, b);
    }
    return w;
  }

  // Y на крака за стоене в колона (x,z), като се търси от fromY надолу.
  floorY(x, z, fromY = this.sy - 1) {
    for (let y = Math.min(fromY, this.sy - 1); y >= 0; y--) if (SOLID[this.get(x, y, z)]) return y + 1;
    return 0;
  }
}

// Дали кутията на играча (долен център x,y,z) пресича твърд КУБ. Клиновете се обработват отделно (wedgePush).
export function boxCollides(world, x, y, z, hw = 0.3, h = 1.8, eps = 0) {
  const x0 = Math.floor(x - hw + eps), x1 = Math.floor(x + hw - eps);
  const y0 = Math.floor(y + eps), y1 = Math.floor(y + h - eps);
  const z0 = Math.floor(z - hw + eps), z1 = Math.floor(z + hw - eps);
  for (let yy = y0; yy <= y1; yy++)
    for (let zz = z0; zz <= z1; zz++)
      for (let xx = x0; xx <= x1; xx++)
        if (SOLID[world.get(xx, yy, zz)]) return true;
  return false;
}

// Най-плитката изтласкваща равнина между кутията и клиновете: {nx,ny,nz,pen,slope} или null.
// За всяка клетка избираме най-малкото проникване между: наклонената повърхност (предпочита се) и хоризонтален изход
// (така задната и страничните стени на клина блокират, вместо да „качват“ играча).
export function wedgePush(world, x, y, z, hw, h, eps = 0) {
  const x0 = Math.floor(x - hw + eps), x1 = Math.floor(x + hw - eps);
  const y0 = Math.floor(y + eps), y1 = Math.floor(y + h - eps);
  const z0 = Math.floor(z - hw + eps), z1 = Math.floor(z + hw - eps);
  let best = null;
  for (let cy = y0; cy <= y1; cy++) for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    const id = world.get(cx, cy, cz), wd = WEDGE[id];
    if (!wd) continue;
    // припокриване на кутията с клетката по двете оси
    const xa = Math.max(x - hw + eps, cx), xb = Math.min(x + hw - eps, cx + 1), za = Math.max(z - hw + eps, cz), zb = Math.min(z + hw - eps, cz + 1);
    if (xa >= xb || za >= zb) continue;
    const alongX = wd.dx !== 0, a = alongX ? xa : za, b = alongX ? xb : zb, c0 = alongX ? cx : cz;
    const sgn = alongX ? wd.dx : wd.dz;
    const uMax = sgn > 0 ? b - c0 : c0 + 1 - a;         // най-високата точка на кутията в клетката
    const Hh = wedgeH(wd.kind, uMax);
    if (Hh <= 1e-6) continue;
    const surfY = cy + Hh;
    if (y + eps >= surfY || y + h <= cy) continue;
    const s = wedgeSlope(wd.kind, uMax);
    let nx = -s * wd.dx, ny = 1, nz = -s * wd.dz; const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    let pen = (surfY - y) * ny;
    let cand = { nx, ny, nz, pen, slope: s };
    // хоризонтални изходи
    const lowExit = sgn > 0 ? b - c0 : c0 + 1 - a;                     // назад към ниския ръб
    const highExit = sgn > 0 ? c0 + 1 - a : b - c0;                    // напред през задния ръб
    const latA = alongX ? zb - cz : xb - cx, latB = alongX ? cz + 1 - za : cx + 1 - xa;
    const ex = [[highExit, sgn * (alongX ? 1 : 0), sgn * (alongX ? 0 : 1)], [lowExit, -sgn * (alongX ? 1 : 0), -sgn * (alongX ? 0 : 1)],
      [latA, alongX ? 0 : -1, alongX ? -1 : 0], [latB, alongX ? 0 : 1, alongX ? 1 : 0]];
    let hex = null;
    for (const [d, ex_, ez_] of ex) if (d > 0 && (!hex || d < hex.pen)) hex = { nx: ex_, ny: 0, nz: ez_, pen: d, slope: 99 };
    if (y < cy - 0.05) cand = { nx: 0, ny: -1, nz: 0, pen: y + h - cy, slope: 99 };   // удар отдолу
    else if (hex && hex.pen < pen * 0.45) cand = hex;                                  // стената/страната блокира вместо да „качва“
    if (!best || cand.pen > best.pen) best = cand;
  }
  return best;
}

// Кутията е блокирана (куб или клин) – за сървърната проверка на позиции.
export function boxBlocked(world, x, y, z, hw = 0.3, h = 1.8, eps = 0) {
  if (boxCollides(world, x, y, z, hw, h, eps)) return true;
  const w = wedgePush(world, x, y, z, hw, h, eps);
  return !!w && w.pen > 1e-3;
}

// Колко от тялото е във вода (0..1) – за плуване.
export function waterDepth(world, x, y, z, h = 1.8) {
  let n = 0, tot = 0;
  for (let yy = y + 0.1; yy < y + h; yy += 0.45) { tot++; if (world.get(Math.floor(x), Math.floor(yy), Math.floor(z)) === BLOCK.water) n++; }
  return n / tot;
}

// Amanatides-Woo обхождане на лъч през клетките. cb(x,y,z,t) -> true за стоп.
export function traverse(world, ox, oy, oz, dx, dy, dz, maxT, cb) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (ox - x) / -dx : Infinity;
  let tmy = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (oy - y) / -dy : Infinity;
  let tmz = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (oz - z) / -dz : Infinity;
  let t = 0;
  for (let i = 0; i < 2000; i++) {
    if (cb(x, y, z, t)) return;
    if (tmx < tmy && tmx < tmz) { t = tmx; if (t > maxT) return; x += sx; tmx += tdx; }
    else if (tmy < tmz) { t = tmy; if (t > maxT) return; y += sy; tmy += tdy; }
    else { t = tmz; if (t > maxT) return; z += sz; tmz += tdz; }
  }
}
