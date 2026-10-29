// Карти от „обеми“ (brush карти): стени, подове, щайги и стъпала са кутии с произволни размери (в метри), а не кубчета.
// Играчът се сблъсква с истинските кутии (shared/physics.js ползва bw.* през world.js), лъчите (куршуми, гранати, зрение на ботове) удрят истинските кутии.
// Освен това се пази груба воксел „сянка“ (proxy): клетка е твърда, ако някоя кутия я припокрива. Нея ползват ботовете (A*), гранатите, радарът и предметите –
// така останалият код на играта (сървър, ботове, ragdoll) работи без промяна.
//
// Формат на картата (type: 'brush'):
//   size [sx, sy, sz]            – размер в метри (цели числа)
//   brushes [[x1,y1,z1,x2,y2,z2, текстура, флагове?], ...]   флагове: 'g' стъкло (спира играча, но не куршумите), 'v' само за гледане (без сблъсък)
//   decor [{ type:'gable', x1,z1,x2,z2, y, h, axis:'x'|'z', tex }, ...]   само за гледане (покриви)
//   lamps [[x,y,z, радиус, цвят]]  – светлинни петна във върховете (нощно осветление)
import { World, BLOCK, registerWorldType } from './world.js';

const TEX_BLOCK = { brick: 'brick', brick2: 'brick', wood: 'planks', crate: 'crate', concrete: 'concrete', metal: 'metal', ground: 'gravel', asphalt: 'gravel', plaster: 'sandstone', roof: 'brick', glass: 'glass', fence: 'wood', barrel: 'metal', step: 'concrete', tile: 'tiles' };
const CELL = 4, EPS = 1e-4;

export class BrushWorld extends World {
  constructor(sx, sy, sz, brushes, data) {
    super(sx, sy, sz, data);
    this.bw = new BrushIndex(brushes, sx, sz);
    if (!data) this.rasterize();
  }
  clone() { const w = new BrushWorld(this.sx, this.sy, this.sz, this.bw.list, this.data.slice()); w.bw = this.bw; return w; }
  static fromMap(map) { const [sx, sy, sz] = map.size; return new BrushWorld(sx, sy, sz, map.brushes.map(normalize)); }
  // груба сянка: клетка е твърда, ако е припокрита от кутия повече от 2 см по всяка ос
  rasterize() {
    const e = 0.02;
    for (const b of this.bw.list) {
      if (b.vis) continue; const id = BLOCK[b.block];
      for (let y = Math.max(0, Math.floor(b.y1 + e)); y <= Math.min(this.sy - 1, Math.ceil(b.y2 - e) - 1); y++)
        for (let z = Math.max(0, Math.floor(b.z1 + e)); z <= Math.min(this.sz - 1, Math.ceil(b.z2 - e) - 1); z++)
          for (let x = Math.max(0, Math.floor(b.x1 + e)); x <= Math.min(this.sx - 1, Math.ceil(b.x2 - e) - 1); x++) this.set(x, y, z, id);
    }
  }
}
registerWorldType('brush', BrushWorld);

function normalize(a) {
  const [x1, y1, z1, x2, y2, z2, tex = 'concrete', fl = ''] = a;
  return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), z2: Math.max(z1, z2), tex, block: TEX_BLOCK[tex] || 'concrete', glass: fl.includes('g'), vis: fl.includes('v') };
}

class BrushIndex {
  constructor(list, sx, sz) {
    this.list = list; this.nx = Math.ceil(sx / CELL) + 1; this.nz = Math.ceil(sz / CELL) + 1; this.cells = Array.from({ length: this.nx * this.nz }, () => []);
    list.forEach((b, i) => {
      if (b.vis) return;
      for (let cz = Math.floor(b.z1 / CELL); cz <= Math.floor(b.z2 / CELL); cz++) for (let cx = Math.floor(b.x1 / CELL); cx <= Math.floor(b.x2 / CELL); cx++) if (cx >= 0 && cz >= 0 && cx < this.nx && cz < this.nz) this.cells[cz * this.nx + cx].push(b);
    });
    this.stamp = 0; for (const b of list) b._s = 0;
  }
  // кутиите, чиято (x,z) клетка се пресича с правоъгълника; без повторения
  *near(x1, z1, x2, z2) {
    const st = ++this.stamp;
    for (let cz = Math.max(0, Math.floor(z1 / CELL)); cz <= Math.min(this.nz - 1, Math.floor(z2 / CELL)); cz++)
      for (let cx = Math.max(0, Math.floor(x1 / CELL)); cx <= Math.min(this.nx - 1, Math.floor(x2 / CELL)); cx++)
        for (const b of this.cells[cz * this.nx + cx]) if (b._s !== st) { b._s = st; yield b; }
  }
  // кутията на играча (долен център x,y,z, полуширина hw, височина h) пресича ли кутия
  collides(x, y, z, hw, h, eps = 0) {
    const ax1 = x - hw + eps, ax2 = x + hw - eps, ay1 = y + eps, ay2 = y + h - eps, az1 = z - hw + eps, az2 = z + hw - eps;
    for (const b of this.near(ax1, az1, ax2, az2)) if (ax1 < b.x2 && ax2 > b.x1 && ay1 < b.y2 && ay2 > b.y1 && az1 < b.z2 && az2 > b.z1) return true;
    return false;
  }
  overlaps(x, y, z, hw, h) {
    const out = [], ax1 = x - hw, ax2 = x + hw, ay1 = y, ay2 = y + h, az1 = z - hw, az2 = z + hw;
    for (const b of this.near(ax1, az1, ax2, az2)) if (ax1 < b.x2 && ax2 > b.x1 && ay1 < b.y2 && ay2 > b.y1 && az1 < b.z2 && az2 > b.z1) out.push(b);
    return out;
  }
  // коригира координата по ос след движение d (знакът е посоката): допира най-близката предна страна
  fix(axis, x, y, z, hw, h, d) {
    const L = this.overlaps(x, y, z, hw, h); if (!L.length) return axis === 'x' ? x : axis === 'y' ? y : z;
    if (axis === 'x') return d > 0 ? Math.min(...L.map(b => b.x1)) - hw - EPS : Math.max(...L.map(b => b.x2)) + hw + EPS;
    if (axis === 'z') return d > 0 ? Math.min(...L.map(b => b.z1)) - hw - EPS : Math.max(...L.map(b => b.z2)) + hw + EPS;
    if (d > 0) return Math.min(...L.map(b => b.y1)) - h - EPS;
    const feet = L.filter(b => b.y2 <= y + h * 0.5);                     // при падане се стъпва върху повърхност в долната половина на тялото
    return Math.max(...(feet.length ? feet : L).map(b => b.y2));
  }
  // стъпало: най-високата повърхност под/в кутията (за качване по стълби и бордюри до maxStep)
  stepTop(x, y, z, hw, h, maxStep) {
    let top = -Infinity; for (const b of this.overlaps(x, y, z, hw, h)) if (b.y2 > top) top = b.y2;
    if (top === -Infinity || top - y > maxStep || top - y <= 1e-3) return null; return top;
  }
  // лъч срещу кутиите (без стъкло): най-близкото t в [0,maxT] или null
  ray(ox, oy, oz, dx, dy, dz, maxT) {
    const ex = ox + dx * maxT, ez = oz + dz * maxT, x1 = Math.min(ox, ex), x2 = Math.max(ox, ex), z1 = Math.min(oz, ez), z2 = Math.max(oz, ez);
    let best = null;
    for (const b of this.near(x1, z1, x2, z2)) {
      if (b.glass) continue;
      let t0 = 0, t1 = maxT;
      const o = [ox, oy, oz], d = [dx, dy, dz], lo = [b.x1, b.y1, b.z1], hi = [b.x2, b.y2, b.z2]; let ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) { ok = false; break; } }
        else { let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a]; if (ta > tb) [ta, tb] = [tb, ta]; if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) { ok = false; break; } }
      }
      if (ok && (best === null || t0 < best)) best = t0;
    }
    return best;
  }
}
