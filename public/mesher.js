// Мрежи на света: чънкове 16x16, осветление (небе + факли), ambient occlusion във върховете.
import * as THREE from 'three';
import { BLOCK, DEFS, OPAQUE, SOLID, WEDGE, WEDGE_PROFILE } from '/shared/world.js';
import { BLOCK_TILES } from './textures.js';

const CH = 16;
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], l: 0.84, t: 'side' },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], l: 0.84, t: 'side' },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], l: 1.0, t: 'top' },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], l: 0.5, t: 'bottom' },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], l: 0.72, t: 'side' },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], l: 0.72, t: 'side' },
];
FACES.forEach((f, i) => { const na = f.n.findIndex(v => v !== 0); f.u = (na + 1) % 3; f.v = (na + 2) % 3; f.id = i; });
const UVC = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO = [0.5, 0.68, 0.84, 1.0];

export class WorldRenderer {
  constructor(scene, atlas) {
    this.scene = scene; this.atlas = atlas;
    this.matOpaque = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 });
    this.matTrans = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, transparent: true, depthWrite: false });
    this.group = new THREE.Group(); scene.add(this.group);
    this.chunks = new Map();
    this.tiles = {};
    for (const [b, t] of Object.entries(BLOCK_TILES)) this.tiles[BLOCK[b]] = { top: atlas.rect[t.top], side: atlas.rect[t.side], bottom: atlas.rect[t.bottom] };
  }

  load(world, env) {
    this.world = world; this.env = { ambient: 0.22, sun: 1, ...env };
    const sd = this.env.sunDir || [-0.55, 0.75, -0.38], sl = Math.hypot(...sd); this.sunDir = sd.map(v => v / sl);
    this.shadows = (this.env.shadows ?? this.env.realistic !== false) && this.env.sun > 0.2; this.shCache = new Map();
    this.clear();
    this.relight();
    for (let cz = 0; cz < Math.ceil(world.sz / CH); cz++) for (let cx = 0; cx < Math.ceil(world.sx / CH); cx++) this.buildChunk(cx, cz);
  }

  clear() {
    for (const c of this.chunks.values()) for (const m of [c.o, c.t]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    this.chunks.clear();
  }

  // Промяна на блокове -> преизчисляване на светлината и на чънковете наблизо.
  refresh(cells) {
    if (!cells.length) return;
    this.shCache = new Map(); this.relight();
    const set = new Set();
    for (const [x, , z] of cells) {
      for (let cz = Math.floor((z - 9) / CH); cz <= Math.floor((z + 9) / CH); cz++)
        for (let cx = Math.floor((x - 9) / CH); cx <= Math.floor((x + 9) / CH); cx++)
          if (cx >= 0 && cz >= 0 && cx * CH < this.world.sx && cz * CH < this.world.sz) set.add(cx + ',' + cz);
    }
    for (const k of set) { const [cx, cz] = k.split(',').map(Number); this.buildChunk(cx, cz); }
  }

  // ---- осветление ----
  relight() {
    const w = this.world, { sx, sy, sz } = w, N = sx * sy * sz;
    const sky = this.sky = new Uint8Array(N), blk = this.blk = new Uint8Array(N);
    const q = new Int32Array(N * 2 + 16);
    let head = 0, tail = 0;
    const I = (x, y, z) => (y * sz + z) * sx + x;
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++)
      for (let y = sy - 1; y >= 0; y--) { if (OPAQUE[w.data[I(x, y, z)]]) break; sky[I(x, y, z)] = 15; q[tail++] = I(x, y, z); }
    const flood = (arr, isSky) => {
      while (head < tail) {
        const i = q[head++], L = arr[i];
        if (L <= 1 && !(isSky && L === 15)) continue;
        const x = i % sx, z = ((i / sx) | 0) % sz, y = (i / (sx * sz)) | 0;
        for (let d = 0; d < 6; d++) {
          const nx = x + (d === 0) - (d === 1), ny = y + (d === 2) - (d === 3), nz = z + (d === 4) - (d === 5);
          if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
          const ni = I(nx, ny, nz);
          if (OPAQUE[w.data[ni]]) continue;
          const nl = (isSky && d === 3 && L === 15) ? 15 : L - 1;
          if (nl > arr[ni]) { arr[ni] = nl; q[tail++] = ni; }
        }
      }
    };
    flood(sky, true);
    head = tail = 0;
    this.torches = [];
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const e = DEFS[w.data[I(x, y, z)]].emit;
      if (e > 0) { blk[I(x, y, z)] = e; q[tail++] = I(x, y, z); if (w.data[I(x, y, z)] === BLOCK.torch) this.torches.push([x + 0.5, y + 0.8, z + 0.5]); }
    }
    flood(blk, false);
  }

  lightOf(x, y, z, out) {
    const w = this.world;
    if (y >= w.sy) { out[0] = 15; out[1] = 0; return; }
    if (x < 0 || z < 0 || x >= w.sx || z >= w.sz || y < 0) { out[0] = 0; out[1] = 0; return; }
    const i = (y * w.sz + z) * w.sx + x; out[0] = this.sky[i]; out[1] = this.blk[i];
  }

  // дали върхът (x,y,z) с нормала n вижда слънцето (0..1, меки краища от 3 лъча)
  sunVis(x, y, z, n, f) {
    const L = this.sunDir, nl = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
    if (nl <= 0.02) return 0;
    const key = ((x * 4096 + y) * 4096 + z) * 8 + f.id; let r = this.shCache.get(key); if (r !== undefined) return r;
    const w = this.world; let vis = 0;
    for (let k = -1; k <= 1; k++) {
      const ox = x + n[0] * 0.04 + (f.u === 0 ? k * 0.28 : 0), oy = y + n[1] * 0.04 + (f.u === 1 ? k * 0.28 : 0), oz = z + n[2] * 0.04 + (f.u === 2 ? k * 0.28 : 0);
      let hit = false;
      for (let t = 0.3; t < 16; t += 0.7) { const px = ox + L[0] * t, py = oy + L[1] * t, pz = oz + L[2] * t; if (py >= w.sy) break; if (OPAQUE[w.get(Math.floor(px), Math.floor(py), Math.floor(pz))]) { hit = true; break; } }
      if (!hit) vis += 1 / 3;
    }
    r = vis * Math.min(1, 0.45 + nl * 0.8); this.shCache.set(key, r); return r;
  }
  shade(s, b, out, sv = 1) {
    const e = this.env, fsBase = Math.pow(s / 15, 1.45) * e.sun, fs = this.shadows ? fsBase * (0.58 + 0.42 * sv) : fsBase, fb = Math.pow(b / 15, 1.45);
    const v = e.ambient + (1 - e.ambient) * Math.max(fs, fb), warm = Math.max(0, Math.min(1, fb - fs));
    out[0] = v; out[1] = v * (1 - 0.2 * warm); out[2] = v * (1 - 0.5 * warm);
    if (this.shadows) { const sunny = sv * Math.min(1, fsBase * 1.2); out[0] *= 1 + 0.07 * sunny; out[2] *= 1 - 0.09 * sunny + 0.05 * (1 - sv) * fsBase; }   // топла светлина на слънце, по-хладна сянка
  }

  // ---- мрежа на чънк ----
  buildChunk(cx, cz) {
    const w = this.world, B = () => ({ pos: [], uv: [], col: [], idx: [] });
    const O = B(), T = B();
    const lt = [0, 0], col = [0, 0, 0];
    const x0 = cx * CH, z0 = cz * CH, x1 = Math.min(w.sx, x0 + CH), z1 = Math.min(w.sz, z0 + CH);
    const rgb = [0, 0, 0];
    const lights = [[0, 0], [0, 0], [0, 0], [0, 0]];

    for (let y = 0; y < w.sy; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const b = w.data[(y * w.sz + z) * w.sx + x]; if (!b) continue;
      const def = DEFS[b], tl = this.tiles[b];
      if (def.shape === 'torch') { this.addTorch(O, x, y, z); continue; }
      if (def.shape === 'wedge') { this.addWedge(O, x, y, z, WEDGE[b], tl.top); continue; }
      if (def.shape === 'rail') { this.addRail(O, x, y, z, tl.top); continue; }
      const isTrans = !def.opaque, bucket = isTrans ? T : O;
      const waterTop = b === BLOCK.water && w.get(x, y + 1, z) !== BLOCK.water;
      const h = waterTop ? 0.88 : 1;
      for (const f of FACES) {
        const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2], nb = w.get(nx, ny, nz);
        if (isTrans) { if (nb === b || OPAQUE[nb]) continue; if (b === BLOCK.water && f.n[1] === 1 && !waterTop) continue; }
        else if (OPAQUE[nb]) continue;
        const rect = tl[f.t], base = bucket.pos.length / 3;
        // светлина + AO за четирите върха
        for (let vi = 0; vi < 4; vi++) {
          const c = f.c[vi], su = c[f.u] * 2 - 1, sv = c[f.v] * 2 - 1;
          const eu = [0, 0, 0], ev = [0, 0, 0]; eu[f.u] = su; ev[f.v] = sv;
          const cells = [[nx, ny, nz], [nx + eu[0], ny + eu[1], nz + eu[2]], [nx + ev[0], ny + ev[1], nz + ev[2]], [nx + eu[0] + ev[0], ny + eu[1] + ev[1], nz + eu[2] + ev[2]]];
          const o1 = OPAQUE[w.get(cells[1][0], cells[1][1], cells[1][2])] ? 1 : 0, o2 = OPAQUE[w.get(cells[2][0], cells[2][1], cells[2][2])] ? 1 : 0;
          const o3 = OPAQUE[w.get(cells[3][0], cells[3][1], cells[3][2])] ? 1 : 0;
          const ao = (o1 && o2) ? 0 : 3 - (o1 + o2 + o3);
          let ss = 0, bb = 0, n = 0;
          for (let k = 0; k < 4; k++) {
            const cc = cells[k]; if (k > 0 && OPAQUE[w.get(cc[0], cc[1], cc[2])]) continue;
            this.lightOf(cc[0], cc[1], cc[2], lt); ss += lt[0]; bb += lt[1]; n++;
          }
          if (n) { ss /= n; bb /= n; }
          const sunv = this.shadows && !def.emit && ss > 8 ? this.sunVis(x + c[0], y + c[1] * h, z + c[2], f.n, f) : 1;
          this.shade(ss, bb, rgb, sunv);
          const k = f.l * AO[ao];
          bucket.col.push(def.emit ? 1 : rgb[0] * k, def.emit ? 1 : rgb[1] * k, def.emit ? 0.95 : rgb[2] * k);
          bucket.pos.push(x + c[0], y + c[1] * h, z + c[2]);
          bucket.uv.push(rect.u0 + UVC[vi][0] * (rect.u1 - rect.u0), rect.v0 + UVC[vi][1] * (rect.v1 - rect.v0));
        }
        // по-хубава диагонал при AO
        const a0 = bucket.col[(base) * 3], a1 = bucket.col[(base + 1) * 3], a2 = bucket.col[(base + 2) * 3], a3 = bucket.col[(base + 3) * 3];
        if (a0 + a2 > a1 + a3) bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else bucket.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      }
    }
    const key = cx + ',' + cz, old = this.chunks.get(key);
    if (old) for (const m of [old.o, old.t]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    const mk = (d, mat, order) => {
      if (!d.idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
      g.setIndex(d.idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.renderOrder = order; m.matrixAutoUpdate = false; this.group.add(m); return m;
    };
    this.chunks.set(key, { o: mk(O, this.matOpaque, 0), t: mk(T, this.matTrans, 2) });
  }

  addBox(D, x0, y0, z0, x1, y1, z1, rect, uRange, shade, color) {
    const base = D.pos.length / 3;
    for (const f of FACES) {
      const b = D.pos.length / 3;
      for (let vi = 0; vi < 4; vi++) {
        const c = f.c[vi];
        D.pos.push(c[0] ? x1 : x0, c[1] ? y1 : y0, c[2] ? z1 : z0);
        const [ua, ub] = uRange;
        D.uv.push(rect.u0 + (ua + UVC[vi][0] * (ub - ua)) * (rect.u1 - rect.u0), rect.v0 + UVC[vi][1] * (rect.v1 - rect.v0));
        const k = f.l * shade; D.col.push(color[0] * k, color[1] * k, color[2] * k);
      }
      D.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return base;
  }

  addTorch(D, x, y, z) {
    const w = this.world, rect = this.atlas.rect.torch;
    let ox = 0, oz = 0, wall = false;
    if (SOLID[w.get(x + 1, y, z)]) { ox = 0.3; wall = true; } else if (SOLID[w.get(x - 1, y, z)]) { ox = -0.3; wall = true; }
    else if (SOLID[w.get(x, y, z + 1)]) { oz = 0.3; wall = true; } else if (SOLID[w.get(x, y, z - 1)]) { oz = -0.3; wall = true; }
    const cx = x + 0.5 + ox, cz = z + 0.5 + oz, y0 = y + (wall ? 0.22 : 0), y1 = y0 + 0.62, hw = 0.075;
    this.addBox(D, cx - hw, y0, cz - hw, cx + hw, y1, cz + hw, rect, [0.375, 0.625], 1, [1, 0.96, 0.85]);
  }

  // наклонена рампа: призма с профил (u,h) по посоката на нарастване; осветление от клетката, нормали за сянка
  addWedge(D, x, y, z, wd, rect) {
    const prof = WEDGE_PROFILE[wd.kind], n = prof.length, lt = [0, 0], rgb = [0, 0, 0];
    this.lightOf(x, y, z, lt); this.shade(lt[0], lt[1], rgb);
    const along = wd.dx !== 0;
    const P = (u, h, v) => (along ? [x + (wd.dx > 0 ? u : 1 - u), y + h, z + v] : [x + v, y + h, z + (wd.dz > 0 ? u : 1 - u)]);
    let cu = 0, ch = 0; for (const [u, h] of prof) { cu += u; ch += h; } cu /= n; ch /= n;
    const quad = (pts, out) => {
      const [a, b, c] = pts, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1, sh = (ny / l > 0 ? 0.82 + 0.18 * (ny / l) : 0.62) * (1 + 0.04 * (nx / l));
      const base = D.pos.length / 3;
      pts.forEach((q, i) => {
        D.pos.push(q[0], q[1], q[2]); D.col.push(rgb[0] * sh, rgb[1] * sh, rgb[2] * sh);
        const uv = [[0, 0], [1, 0], [1, 1], [0, 1]][i % 4]; D.uv.push(rect.u0 + uv[0] * (rect.u1 - rect.u0), rect.v0 + uv[1] * (rect.v1 - rect.v0));
      });
      for (let i = 1; i < pts.length - 1; i++) D.idx.push(base, base + i, base + i + 1);
    };
    for (let i = 0; i < n; i++) {
      const [u0, h0] = prof[i], [u1, h1] = prof[(i + 1) % n];
      let nu = h1 - h0, nh = -(u1 - u0); const mu = (u0 + u1) / 2 - cu, mh = (h0 + h1) / 2 - ch; if (nu * mu + nh * mh < 0) { nu = -nu; nh = -nh; }
      const out = [wd.dx * nu, nh, wd.dz * nu];
      quad([P(u0, h0, 0), P(u1, h1, 0), P(u1, h1, 1), P(u0, h0, 1)], out);
    }
    const va = along ? [0, 0, 1] : [1, 0, 0];
    for (const cap of [0, 1]) { const sg = cap ? 1 : -1; quad(prof.map(([u, h]) => P(u, h, cap)), [va[0] * sg, 0, va[2] * sg]); }
  }

  addRail(D, x, y, z, rect) {
    const w = this.world, alongX = w.get(x + 1, y, z) === BLOCK.rail || w.get(x - 1, y, z) === BLOCK.rail;
    this.lightOf(x, y, z, [0, 0]);
    const lt = [0, 0]; this.lightOf(x, y, z, lt); const rgb = [0, 0, 0]; this.shade(lt[0], lt[1], rgb);
    const base = D.pos.length / 3, hy = y + 0.12;
    const P = [[x, z + 1], [x + 1, z + 1], [x + 1, z], [x, z]];
    const UVs = alongX ? [[0, 0], [0, 1], [1, 1], [1, 0]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      D.pos.push(P[i][0], hy, P[i][1]); D.col.push(rgb[0], rgb[1], rgb[2]);
      D.uv.push(rect.u0 + UVs[i][0] * (rect.u1 - rect.u0), rect.v0 + UVs[i][1] * (rect.v1 - rect.v0));
    }
    D.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
