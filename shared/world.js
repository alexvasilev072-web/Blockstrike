// Воксел свят: еднакъв код на сървъра и в браузъра.

// ---- Блокове ----
// solid: колизии/куршуми; opaque: спира светлината; destr: руши се от гранати; emit: светлина (0-15);
// surface: звук на стъпките; shape: 'cube' | 'torch' | 'rail' (не-кубични, не-твърди)
const D = (name, o = {}) => ({ name, solid: true, opaque: true, destr: false, emit: 0, surface: 'stone', shape: 'cube', ...o });
export const DEFS = [
  D('air', { solid: false, opaque: false }),                                   // 0
  D('sand', { surface: 'sand' }),                                              // 1
  D('sandstone', { surface: 'stone' }),                                        // 2
  D('wood', { destr: true, surface: 'wood' }),                                 // 3  дънер
  D('glass', { opaque: false, destr: true, surface: 'stone' }),                // 4
  D('concrete', { surface: 'stone' }),                                         // 5
  D('site', { surface: 'stone' }),                                             // 6  маркировка на бомбена точка
  D('brick', { surface: 'stone' }),                                            // 7
  D('metal', { surface: 'metal' }),                                            // 8
  D('road', { surface: 'sand' }),                                              // 9
  D('stone', { surface: 'stone' }),                                            // 10
  D('planks', { destr: true, surface: 'wood' }),                               // 11
  D('rust', { surface: 'metal' }),                                             // 12
  D('grass', { surface: 'grass' }),                                            // 13
  D('dirt', { surface: 'grass' }),                                             // 14
  D('snow', { surface: 'snow' }),                                              // 15
  D('ice', { surface: 'ice' }),                                                // 16
  D('tiles', { surface: 'stone' }),                                            // 17
  D('cont_red', { surface: 'metal' }),                                         // 18
  D('cont_blue', { surface: 'metal' }),                                        // 19
  D('cont_green', { surface: 'metal' }),                                       // 20
  D('cont_yellow', { surface: 'metal' }),                                      // 21
  D('water', { solid: false, opaque: false, surface: 'water' }),               // 22
  D('torch', { solid: false, opaque: false, emit: 14, shape: 'torch', surface: 'wood' }), // 23
  D('rail', { solid: false, opaque: false, shape: 'rail', surface: 'metal' }), // 24
  D('lamp', { emit: 15, surface: 'metal' }),                                   // 25
  D('cobble', { surface: 'stone' }),                                           // 26
  D('crate', { destr: true, surface: 'wood' }),                                // 27
  D('gravel', { surface: 'stone' }),                                           // 28
];
export const BLOCK = Object.fromEntries(DEFS.map((d, i) => [d.name, i]));
export const SOLID = DEFS.map(d => d.solid);
export const OPAQUE = DEFS.map(d => d.opaque);
export const DESTRUCTIBLE = new Set(DEFS.map((d, i) => (d.destr ? i : -1)).filter(i => i >= 0));

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

// Дали кутията на играча (долен център x,y,z) пресича твърд блок.
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
