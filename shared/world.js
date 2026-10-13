// Воксел свят: еднакъв код на сървъра и в браузъра.
export const BLOCK = { air: 0, sand: 1, sandstone: 2, wood: 3, glass: 4, concrete: 5, site: 6, brick: 7, metal: 8, road: 9 };
export const DESTRUCTIBLE = new Set([BLOCK.wood, BLOCK.glass]);

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
  solid(x, y, z) { return this.get(x, y, z) !== 0; }
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
}

// Дали кутията на играча (долен център x,y,z) пресича твърд блок.
export function boxCollides(world, x, y, z, hw = 0.3, h = 1.8, eps = 0) {
  const x0 = Math.floor(x - hw + eps), x1 = Math.floor(x + hw - eps);
  const y0 = Math.floor(y + eps), y1 = Math.floor(y + h - eps);
  const z0 = Math.floor(z - hw + eps), z1 = Math.floor(z + hw - eps);
  for (let yy = y0; yy <= y1; yy++)
    for (let zz = z0; zz <= z1; zz++)
      for (let xx = x0; xx <= x1; xx++)
        if (world.solid(xx, yy, zz)) return true;
  return false;
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
