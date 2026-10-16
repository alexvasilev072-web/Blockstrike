// Ботове: сървърни играчи с изкуствен интелект. Движат се с същата физика (shared/physics.js) като хората, виждат само през линия на видимост,
// чуват стъпки и изстрели и стрелят през същия server-side код (room.shoot), със същия откат и неточност. Няма „читове“ – трудността е в
// реакцията, точността, контрола на откат (counter-strafe, къси серии), тактиката и използването на гранати.
import { BLOCK, SOLID, traverse } from '../shared/world.js';
import { stepBody, makeBody } from '../shared/physics.js';
import { WEAPONS, MOVE, CFG, recoilAt, NADE, NADE_IDS } from '../shared/weapons.js';

const STEP = MOVE.STEP;
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += Math.random(); return (u - 2) / 0.58; };   // ~N(0,1)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angNorm = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

// ---------- Нива на трудност ----------
// react: време за реакция (сек); aimGain/aimRate: колко бързо се мести мерникът (1/сек, рад/сек); aimErr: шум на мерника (рад);
// head: шанс да цели главата; recoil: контрол на отката (0..1); fov: зрително поле (рад); hear: радиус на чуване (м); hearErr: грешка при чуване (м)
export const DIFFS = {
  easy:   { name: 'Лесен',   react: 0.62, aimGain: 5,  aimRate: 3.0, aimErr: 0.085, head: 0.04, recoil: 0.0,  fov: 1.5,  hear: 6,  hearErr: 6,  fireTol: 3.0, moveFire: 1.0, counter: false, crouchFar: false, burst: [1, 3], pause: [0.35, 0.8], strafe: 0.0, nades: false, awp: false, anticipate: 1.0, aggro: 0.9, spray: 0.6 },
  medium: { name: 'Среден',  react: 0.40, aimGain: 9,  aimRate: 5.0, aimErr: 0.04,  head: 0.18, recoil: 0.35, fov: 1.75, hear: 11, hearErr: 3.5, fireTol: 1.7, moveFire: 0.8, counter: false, crouchFar: false, burst: [2, 5], pause: [0.2, 0.5], strafe: 0.35, nades: false, awp: false, anticipate: 0.9, aggro: 0.7, spray: 0.8 },
  hard:   { name: 'Труден',  react: 0.25, aimGain: 17, aimRate: 8.5, aimErr: 0.014, head: 0.5,  recoil: 0.75, fov: 1.85, hear: 18, hearErr: 2,   fireTol: 1.15, moveFire: 0.5, counter: true,  crouchFar: false, burst: [3, 6], pause: [0.12, 0.3], strafe: 0.7, nades: true,  awp: true,  anticipate: 0.7, aggro: 0.5, spray: 1 },
  expert: { name: 'Експерт', react: 0.185, aimGain: 28, aimRate: 14,  aimErr: 0.0075, head: 0.62,  recoil: 0.96, fov: 1.95, hear: 26, hearErr: 1.2, fireTol: 0.95, moveFire: 0.34, counter: true,  crouchFar: true,  burst: [3, 8], pause: [0.06, 0.22], strafe: 0.9, nades: true,  awp: true,  anticipate: 0.5, aggro: 0.35, spray: 1 },
};
export const BOT_NAMES = ['Сашо', 'Гого', 'Митко', 'Жоро', 'Пешо', 'Данчо', 'Кико', 'Роро', 'Наско', 'Вальо', 'Тони', 'Ицо', 'Боби', 'Марто', 'Деси', 'Краси'];

// ---------- Навигация (A* по воксели) ----------
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export class Nav {
  constructor(room) { this.room = room; this.size = 0; }
  get w() { return this.room.world; }
  alloc() {
    const w = this.w, n = w.sx * w.sy * w.sz;
    if (this.size === n) return; this.size = n;
    this.g = new Float32Array(n); this.par = new Int32Array(n); this.stamp = new Uint32Array(n); this.cur = 0;
  }
  free(x, y, z) { const w = this.w, b = w.get(x, y, z); return !SOLID[b] && b !== BLOCK.water && !SOLID[w.get(x, y + 1, z)]; }
  ok(x, y, z) { return y >= 1 && this.free(x, y, z) && SOLID[this.w.get(x, y - 1, z)]; }
  // най-близкият проходим възел до точка
  snap(x, y, z, r = 3) {
    const cx = Math.floor(x), cz = Math.floor(z), cy = Math.round(y);
    for (let d = 0; d <= r; d++) for (let dy = 0; dy <= 3; dy++) for (const sy of dy ? [1, -1] : [1]) for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue;
      if (this.ok(cx + dx, cy + dy * sy, cz + dz)) return [cx + dx, cy + dy * sy, cz + dz];
    }
    return null;
  }
  // проходимо ниво в колоната (x,z): първо маркировката на обекта (блок site), иначе най-близкото до височината-намек
  groundAt(x, z, hint = 1) {
    const w = this.w, cx = Math.floor(x), cz = Math.floor(z);
    for (let y = w.sy - 2; y >= 1; y--) if (w.get(cx, y - 1, cz) === BLOCK.site && this.ok(cx, y, cz)) return y;
    let best = null;
    for (let y = 1; y < w.sy - 2; y++) if (this.ok(cx, y, cz) && (best === null || Math.abs(y - hint) < Math.abs(best - hint))) best = y;
    return best;
  }
  neighbors(x, y, z, fn) {
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz, diag = dx !== 0 && dz !== 0;
      for (const dy of [0, 1, -1, -2, -3]) {
        const ny = y + dy;
        if (!this.ok(nx, ny, nz)) continue;
        if (dy === 1 && !this.free(x, y + 1, z)) continue;                 // няма място за скок
        if (dy === 1 && !this.free(nx, y + 1, nz)) continue;
        if (dy <= 0 && dy < 0 && (!this.free(nx, y, nz) || !this.free(nx, y + 1, nz))) continue;   // слизане: ръбът трябва да е свободен
        if (diag) { const lv = Math.max(y, ny); if (!this.free(x + dx, lv, z) || !this.free(x, lv, z + dz)) continue; }
        fn(nx, ny, nz, (diag ? 1.414 : 1) + (dy > 0 ? 0.6 : dy < 0 ? 0.15 * -dy : 0));
        break;
      }
    }
  }
  find(from, to, maxExp = 40000) {
    this.alloc(); const w = this.w, sx = w.sx, sz = w.sz;
    const s = this.snap(from[0], from[1], from[2]), g = this.snap(to[0], to[1], to[2], 4);
    if (!s || !g) return null;
    const id = (x, y, z) => (y * sz + z) * sx + x, gid = id(...g), cur = ++this.cur;
    const heap = [[0, id(...s)]], push = n => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const sid = id(...s); this.g[sid] = 0; this.par[sid] = -1; this.stamp[sid] = cur;
    const dec = n => { const x = n % sx, z = Math.floor(n / sx) % sz, y = Math.floor(n / (sx * sz)); return [x, y, z]; };
    let exp = 0, found = false; const closed = new Set();
    while (heap.length && exp++ < maxExp) {
      const [, n] = pop(); if (closed.has(n)) continue; closed.add(n);
      if (n === gid) { found = true; break; }
      const [x, y, z] = dec(n);
      this.neighbors(x, y, z, (nx, ny, nz, c) => {
        const m = id(nx, ny, nz), ng = this.g[n] + c;
        if (this.stamp[m] === cur && this.g[m] <= ng) return;
        this.stamp[m] = cur; this.g[m] = ng; this.par[m] = n;
        push([ng + Math.hypot(nx - g[0], nz - g[2]) + Math.abs(ny - g[1]) * 0.8, m]);
      });
    }
    if (!found) return null;
    const path = []; for (let n = gid; n !== -1; n = this.par[n]) { const [x, y, z] = dec(n); path.push({ x: x + 0.5, y, z: z + 0.5 }); }
    return path.reverse();
  }
}

// ---------- Симулация на хвърлена граната (както в server updateNades) ----------
function simNade(world, o, yw, pt, kind = 'he') {
  const cp = Math.cos(pt), f = [-Math.sin(yw) * cp, Math.sin(pt), -Math.cos(yw) * cp];
  const g = { x: o[0] + f[0] * 0.5, y: o[1] + f[1] * 0.5 - 0.1, z: o[2] + f[2] * 0.5, vx: f[0] * 16, vy: f[1] * 16 + 3, vz: f[2] * 16 };
  if (world.solid(Math.floor(g.x), Math.floor(g.y), Math.floor(g.z))) return null;
  let fuse = kind === 'flash' ? CFG.FLASH_FUSE : kind === 'molo' ? CFG.MOLO_FUSE : CFG.NADE_FUSE; const dt = 0.033;
  while (fuse > 0) {
    fuse -= dt; if (kind === 'molo' && g.hit) break;
    for (let s = 0; s < 3; s++) {
      const sdt = dt / 3; g.vy -= 20 * sdt;
      for (const ax of ['x', 'y', 'z']) {
        const n = g[ax] + g['v' + ax] * sdt, t = { x: g.x, y: g.y, z: g.z }; t[ax] = n;
        if (world.solid(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))) { if (ax === 'y' && g.vy < -0.6) g.hit = true; g['v' + ax] *= -0.42; if (ax === 'y') { g.vx *= 0.75; g.vz *= 0.75; if (Math.abs(g.vy) < 1) g.vy = 0; } } else g[ax] = n;
      }
    }
  }
  return g;
}

// ---------- Бот ----------
export class Bot {
  constructor(room, p, diffId) {
    this.room = room; this.p = p; this.diffId = diffId in DIFFS ? diffId : 'medium';
    const d = DIFFS[this.diffId], j = rnd(0.9, 1.1);                                      // лека индивидуална разлика
    this.d = { ...d, react: d.react * j, aimGain: d.aimGain * (2 - j), aimErr: d.aimErr * rnd(0.85, 1.2) };
    this.B = makeBody(); this.acc = 0;
    this.nav = new Nav(room);
    this.reset();
  }
  reset() {
    const p = this.p;
    this.B.pos = { x: p.x, y: p.y, z: p.z }; this.B.vel = { x: 0, y: 0, z: 0 }; this.B.onGround = true; this.B.crouching = false; this.B.crouchAmt = 0; this.B.yaw = p.yw; this.B.pitch = 0;
    this.mem = new Map(); this.target = null; this.path = null; this.pi = 0; this.goal = null; this.repathAt = 0; this.bought = false; this.buyAt = 0;
    this.noise = [0, 0]; this.noiseT = [0, 0]; this.noiseAt = 0; this.settle = 0; this.cs = { mode: 'shoot', until: 0, dir: 1 }; this.burstLeft = 0; this.pauseUntil = 0; this.stuck = { t: 0, x: p.x, z: p.z, n: 0 };
    this.spot = null; this.look = null; this.nade = null; this.lastThrow = 0; this.holdAt = 0; this.siteChoice = null; this.input = { mx: 0, mz: 0, crouch: false, walk: false, jump: false }; this.scoped = false; this.wasUsing = false;
    this.rolePhase = Math.random(); this._view = { yaw: p.yw, pitch: p.pt };
  }
  get eye() { const p = this.p; return [p.x, p.y + (p.cr ? MOVE.EYE_CROUCH : MOVE.EYE_STAND), p.z]; }
  enemies() { const out = []; for (const e of this.room.players.values()) if (e.alive && e.team !== this.p.team) out.push(e); return out; }

  // ----- покупки (във freeze) -----
  buy() {
    const r = this.room, p = this.p, d = this.d; this.bought = true;
    const rich = p.money, pistolRound = r.round === 1 || r.round === CFG.HALF + 1, tryBuy = it => r.buy(p, it);
    let awps = 0; for (const q of r.players.values()) if (q.team === p.team && q.alive && q.inv.pr === 'sniper') awps++;
    if (pistolRound) { if (p.money >= 650 && (this.diffId === 'hard' || this.diffId === 'expert' || p.team === 'def')) tryBuy('armor'); else if (p.money >= 700) tryBuy('deagle'); if (p.team === 'def' && p.money >= 400) tryBuy('kit'); return; }
    if (p.inv.pr) { if (rich >= 650) tryBuy('armor'); if (d.nades && p.money >= 300) tryBuy('grenade'); if (d.nades && p.money >= 200) tryBuy('flash'); if (p.team === 'def' && p.money >= 400) tryBuy('kit'); return; }   // основното оръжие е запазено от миналия рунд
    if (rich >= 4750 + 650 && d.awp && awps < 1 && Math.random() < (this.diffId === 'expert' ? 0.5 : 0.25)) tryBuy('sniper');
    else if (rich >= 2700 + 650) tryBuy('rifle');
    else if (rich >= 2700 && Math.random() < 0.5) tryBuy('rifle');
    else if (rich >= 1250 + 650) tryBuy('smg');
    else if (rich >= 1050 + 650 && Math.random() < 0.3) tryBuy('shotgun');
    else if (rich >= 1250) tryBuy('smg');
    else if (rich >= 700 + 650 && !p.inv.pr) tryBuy('deagle');
    if (p.money >= 650) tryBuy('armor');
    if (p.money >= 300 && d.nades) tryBuy('grenade');
    if (d.nades && p.money >= 200 && Math.random() < 0.7) tryBuy('flash');
    if (d.nades && p.money >= (p.team === 'def' ? 600 : 400) && Math.random() < 0.45) tryBuy('molotov');
    if (p.team === 'def' && p.money >= 400) tryBuy('kit');
    if (!p.inv.pr && p.money >= 700 && Math.random() < 0.5) tryBuy('deagle');
  }

  // ----- възприятие -----
  los(a, b) {
    if (this.room.smokeBlocks(a, b)) return false;                  // димът спира погледа
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); if (L < 0.01) return true;
    let blocked = false; const w = this.room.world;
    traverse(w, a[0], a[1], a[2], dx / L, dy / L, dz / L, L, (x, y, z, t) => {
      if (t >= L) return true;
      const bl = w.get(x, y, z); if (SOLID[bl] && bl !== BLOCK.glass) { blocked = true; return true; }
      return false;
    });
    return !blocked;
  }
  angTo(pt) { const e = this.eye, dx = pt[0] - e[0], dz = pt[2] - e[2]; return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(pt[1] - e[1], Math.hypot(dx, dz)), dist: Math.hypot(dx, pt[1] - e[1], dz) }; }
  inFov(pt) { const a = this.angTo(pt), dy = Math.abs(angNorm(a.yaw - this.p.yw)), dp = Math.abs(a.pitch - this.p.pt); return a.dist < 2.5 || (dy < this.d.fov / 2 && dp < this.d.fov / 2.4); }
  perceive(now) {
    const p = this.p, d = this.d, e0 = this.eye;
    if (now < p.blindUntil) { for (const m of this.mem.values()) m.visible = m.wasVisible = false; this.target = null; return; }       // заслепен (flashbang)
    for (const [id, m] of this.mem) { const q = this.room.players.get(id); if (!q || !q.alive) { this.mem.delete(id); continue; } m.visible = false; }
    let best = null;
    for (const e of this.enemies()) {
      const H = e.cr ? MOVE.CROUCH_H : MOVE.STAND_H, head = [e.x, e.y + H * 0.9, e.z], chest = [e.x, e.y + H * 0.62, e.z], leg = [e.x, e.y + H * 0.25, e.z];
      let part = null;
      if (this.inFov(chest)) { if (this.los(e0, head)) part = 'head'; else if (this.los(e0, chest)) part = 'chest'; else if (this.los(e0, leg)) part = 'leg'; }
      let m = this.mem.get(e.id);
      if (part) {
        if (!m) { m = { first: now, seen: now, pos: null, vx: 0, vz: 0, engageAt: 0, part: 'chest', visible: false, heard: false }; this.mem.set(e.id, m); }
        if (!m.wasVisible || now - m.seen > 400) {          // нова поява: започва реакцията
          const dist = Math.hypot(e.x - p.x, e.z - p.z), a = this.angTo(chest), off = Math.abs(angNorm(a.yaw - p.yw)) + Math.abs(a.pitch - p.pt);
          let react = d.react * (1 + dist / 70) * (0.85 + Math.random() * 0.3) + off * 0.045;
          if (off < 0.18 && (m.pos || this.look)) react *= d.anticipate;                    // мерникът вече е насочен натам (pre-aim)
          m.engageAt = now + react * 1000;
          m.part = Math.random() < d.head && dist < 40 ? 'head' : 'chest';
        }
        if (m.pos) { const dt = Math.max(0.03, (now - m.seen) / 1000); m.vx = (e.x - m.pos[0]) / dt * 0.5 + m.vx * 0.5; m.vz = (e.z - m.pos[2]) / dt * 0.5 + m.vz * 0.5; }
        m.pos = [e.x, e.y, e.z]; m.seen = now; m.visible = true; m.wasVisible = true; m.heard = false; m.vis = part;
      } else if (m) m.wasVisible = m.visible = false;
      // чуване: бегъщи/скачащи врагове (не клякащи и не вървящи тихо)
      if (!part && !(e.cr || e.wk) && e.spd > 2.6 && d.hear > 0) {
        const dist = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
        if (dist < d.hear) {
          if (!m) { m = { first: now, seen: 0, pos: null, vx: 0, vz: 0, engageAt: 0, part: 'chest', visible: false, heard: true }; this.mem.set(e.id, m); }
          if (now - (m.seen || 0) > 300) { const er = d.hearErr * (0.4 + dist / d.hear); m.pos = [e.x + gauss() * er * 0.6, e.y, e.z + gauss() * er * 0.6]; m.seen = now; m.heard = true; m.wasVisible = false; }
        }
      }
    }
    // най-опасна видима цел: най-близката, с предпочитание към предишната
    for (const [id, m] of this.mem) if (m.visible) {
      const e = this.room.players.get(id), dist = Math.hypot(e.x - p.x, e.z - p.z) * (this.target && this.target.id === id ? 0.8 : 1);
      if (!best || dist < best.dist) best = { e, m, dist };
    }
    const prev = this.target; this.target = best ? best.e : null;
    if (this.target && (!prev || prev.id !== this.target.id)) this.settle = 0.22;
  }
  onHurt(att, dmg) {
    const now = Date.now(), d = this.d; if (!att || !att.alive || att.team === this.p.team) return;
    let m = this.mem.get(att.id);
    if (!m) { m = { first: now, seen: now, pos: null, vx: 0, vz: 0, engageAt: 0, part: 'chest', visible: false, heard: false }; this.mem.set(att.id, m); }
    const er = d.hearErr * 0.35; m.pos = [att.x + gauss() * er, att.y, att.z + gauss() * er]; m.seen = now; m.heard = true;
    this.hurtAt = now; this.look = [m.pos[0], m.pos[1] + 1.5, m.pos[2]]; this.lookUntil = now + 1500;
  }
  onShotHeard(shooter, dist) {
    const d = this.d, now = Date.now(); if (shooter.team === this.p.team || dist > 45 || this.target) return;
    let m = this.mem.get(shooter.id);
    if (!m) { m = { first: now, seen: 0, pos: null, vx: 0, vz: 0, engageAt: 0, part: 'chest', visible: false, heard: true }; this.mem.set(shooter.id, m); }
    if (m.visible) return;
    const er = d.hearErr * (0.6 + dist / 25); m.pos = [shooter.x + gauss() * er, shooter.y, shooter.z + gauss() * er]; m.seen = now; m.heard = true;
    if (dist < d.hear * 1.4) { this.look = [m.pos[0], m.pos[1] + 1.55, m.pos[2]]; this.lookUntil = now + 1200; }
  }

  // ----- цели и план на отбора -----
  sitePoint(name) {
    const j = this.room.map.json, s = j.sites[name]; if (!s) return null;
    const [x1, z1, x2, z2] = s; return { x: (x1 + x2 + 1) / 2, z: (z1 + z2 + 1) / 2, rect: s };
  }
  // позиция до обекта, до която има път от текущото място (иначе null)
  pickSpot(name, pad) {
    const sp = this.sitePoint(name); if (!sp) return null;
    const p = this.p, from = [p.x, p.y, p.z], cands = [];
    const w = this.room.world;
    for (let i = 0; i < 14; i++) {
      const x = rnd(sp.rect[0] - pad, sp.rect[2] + 1 + pad), z = rnd(sp.rect[1] - pad, sp.rect[3] + 1 + pad), cx = Math.floor(x), cz = Math.floor(z);
      for (let y = 1; y < w.sy - 2; y++) if (this.nav.ok(cx, y, cz)) { cands.push([x, y, z]); break; }       // най-ниското ниво (подът, а не върхът на щайгите)
    }
    cands.push([sp.x, this.nav.groundAt(sp.x, sp.z, 1) ?? 1, sp.z]);
    for (const c of cands) {
      const path = this.nav.find(from, c); if (!path) continue;
      const e = path[path.length - 1]; return { x: e.x, y: e.y, z: e.z, site: name };
    }
    return null;
  }
  lookHold(site, fromTeam) {
    const s = this.spot || (this.spot = { site }), k = 'h' + fromTeam;
    if (s[k] === undefined) s[k] = this.holdLook(site, fromTeam);
    this.pointToward(s[k]);
  }
  // накъде да гледа държащият позиция: вход от пътя на противниковия отбор към обекта
  holdLook(site, fromTeam) {
    const r = this.room, key = `${r.mapId}|${site}|${fromTeam}`; r.navCache = r.navCache || new Map();
    let ent = r.navCache.get(key);
    if (ent === undefined) {
      const sp = this.sitePoint(site), spawns = r.map.json.spawns[fromTeam], sp0 = spawns[Math.floor(spawns.length / 2)];
      const y0 = this.nav.groundAt(sp0[0] + 0.5, sp0[1] + 0.5, sp0[2] ?? 1) ?? 1, ty = this.nav.groundAt(sp.x, sp.z, y0) ?? y0;
      const path = this.nav.find([sp0[0] + 0.5, y0, sp0[1] + 0.5], [sp.x, ty, sp.z]);
      ent = path ? path : null; r.navCache.set(key, ent);
    }
    if (!ent || !ent.length) return null;
    const c = this.sitePoint(site); const want = rnd(7, 15);
    for (let i = ent.length - 1; i >= 0; i--) if (Math.hypot(ent[i].x - c.x, ent[i].z - c.z) >= want) return [ent[i].x, ent[i].y + 1.55, ent[i].z];
    return [ent[0].x, ent[0].y + 1.55, ent[0].z];
  }

  // ----- навигация -----
  goTo(x, y, z, now, thr = 0.8) {
    const g = this.goal;
    if (!g || Math.hypot(g.x - x, g.z - z) > thr || Math.abs(g.y - y) > 1.5 || !this.path) {
      if (this.path && now < this.repathAt && g && Math.hypot(g.x - x, g.z - z) <= 3) return;
      this.goal = { x, y, z }; this.repathAt = now + 700;
      this.path = this.nav.find([this.p.x, this.p.y, this.p.z], [x, y, z]); this.pi = 0;
      if (!this.path) this.path = [{ x, y, z }];
    }
  }
  // желана посока на движение към следващата точка от пътя (null = стои)
  steer() {
    const p = this.p, path = this.path; if (!path) return null;
    while (this.pi < path.length) {
      const w = path[this.pi], dx = w.x - p.x, dz = w.z - p.z, dist = Math.hypot(dx, dz);
      if (dist < 0.42 && Math.abs(w.y - p.y) < 1.3) { this.pi++; continue; }
      const next = path[this.pi + 1];
      if (next && dist < 0.9 && Math.abs(next.y - p.y) < 0.6 && Math.abs(w.y - p.y) < 0.6) { this.pi++; continue; }   // изрязване на ъгли
      this.input.jump = w.y - p.y > 0.4 && this.B.onGround && dist < 1.35;
      return [dx / (dist || 1), dz / (dist || 1), dist];
    }
    return null;
  }
  atGoal() { return !this.path || this.pi >= this.path.length; }

  // ----- главно мислене (на всеки сървърен тик) -----
  update(dt, now) {
    const r = this.room, p = this.p;
    if (!p.alive || r.phase === 'lobby' || r.run) return;
    const inp = this.input; inp.mx = 0; inp.mz = 0; inp.crouch = false; inp.walk = false; inp.jump = false;
    this.fire = false; this.wantUse = false;
    if (r.phase === 'freeze') {
      if (!this.bought) { if (!this.buyAt) this.buyAt = now + rnd(300, 4500); else if (now >= this.buyAt) this.buy(); }
      this.idleAim(dt, now); this.applyAim(dt); p.yw = this.view.yaw; p.pt = this.view.pitch;
      this.pushHist(now); return;
    }
    if (r.phase !== 'live') { this.idleAim(dt, now); this.applyAim(dt); this.physics(dt, now); return; }
    if (now - this.thinkAt < 28) { this.physics(dt, now); return; }
    this.thinkAt = now;
    this.perceive(now);
    this.decide(now);
    this.applyAim(dt);
    this.doFire(now);
    p.using = !!this.wantUse && p.alive;
    this.physics(dt, now);
  }
  get view() { return this._view || (this._view = { yaw: this.p.yw, pitch: this.p.pt }); }

  decide(now) {
    const r = this.room, p = this.p, d = this.d, inp = this.input, T = this.target, m = T ? this.mem.get(T.id) : null;
    this.lookAt = null; this.aimPart = null;
    for (const f of r.fires) {                                        // стои в пожар -> излиза от него
      const dx = p.x - f.x, dz = p.z - f.z, dd = Math.hypot(dx, dz);
      if (dd < f.r + 0.6 && Math.abs(p.y - f.y) < 1.6) { const l = dd || 1; inp.mx = dx / l; inp.mz = dz / l; inp.walk = false; this.look = null; if (!this.target) { this.pointAlong(); } break; }
    }
    if (inp.mx || inp.mz) { if (!this.target) return; }
    const w = WEAPONS[p.weapon] || WEAPONS.pistol;
    // презареждане / смяна на оръжие
    const am = p.ammo[p.weapon];
    if (w.mag && am) {
      if (am.mag <= 0 && am.res <= 0 && p.weapon !== 'pistol' && p.weapon !== 'knife') r.switchTo(p, 'se');
      else if (am.mag === 0 && T && p.inv.se && p.weapon !== p.inv.se && p.ammo[p.inv.se]?.mag > 0 && this.dist(T) < 12) r.switchTo(p, 'se');
      else if (am.mag <= w.mag * 0.3 && !T && now - (this.lastSeen || 0) > 1500) r.reload(p);
      else if (am.mag === 0) r.reload(p);
    } else if (p.weapon === 'knife' || NADE_IDS.includes(p.weapon)) { if (!this.nade) r.switchTo(p, p.inv.pr ? 'pr' : 'se'); }
    if (T) this.lastSeen = now;
    // 1) бой
    if (T && m) return this.combat(now, T, m, w);
    this.scoped = false;
    // граната
    if (this.nade || this.tryNade(now)) return this.doNade(now);
    // 2) отпечатък от враг (чут / скоро видян)
    const threat = this.freshestMem(now);
    // 3) цели на рунда
    this.objective(now, threat);
  }
  dist(e) { return Math.hypot(e.x - this.p.x, e.z - this.p.z); }
  freshestMem(now) {
    let best = null;
    for (const m of this.mem.values()) if (m.pos && !m.visible && (now - m.seen) < 9000 && (!best || m.seen > best.seen)) best = m;
    return best;
  }

  combat(now, T, m, w) {
    const p = this.p, d = this.d, inp = this.input, r = this.room, dist = this.dist(T), H = T.cr ? MOVE.CROUCH_H : MOVE.STAND_H;
    const head = m.part === 'head' && m.vis === 'head';
    this.aimPt = [T.x, T.y + H * (head ? 0.9 : m.vis === 'leg' ? 0.3 : 0.62), T.z];
    // екстра: лекото движение на целта между тиковете се компенсира от самото следене (hitscan)
    const engaged = now >= m.engageAt;
    this.lookAt = this.aimPt; this.engaged = engaged; p.using = false;
    const awp = p.weapon === 'sniper', shotgun = p.weapon === 'shotgun', spray = !!w.auto;
    // оптика
    this.scoped = awp;
    // движение в бой
    const vmax = w.speed || 5.5, hs = this.B.speed;
    const toE = [T.x - p.x, T.z - p.z], L = Math.hypot(...toE) || 1, ux = toE[0] / L, uz = toE[1] / L, latx = -uz, latz = ux;
    const cs = this.cs;
    if (now >= cs.until) {
      // нова фаза: стреляй на място / мръдни встрани (ADAD)
      if (cs.mode === 'move' || !d.counter) {
        cs.mode = 'shoot'; cs.until = now + rnd(260, 520) * (d.counter ? 1 : 0.6);
      } else {
        cs.mode = Math.random() < d.strafe && !awp ? 'move' : 'shoot';
        cs.until = now + (cs.mode === 'move' ? rnd(110, 240) : rnd(260, 560));
        cs.dir = Math.random() < 0.5 ? 1 : -1;
      }
    }
    let wantMove = false, mx = 0, mz = 0;
    if (!d.counter) {                      // лесни/средни: бягат и стрелят, понякога се приближават
      if (dist > 14 && Math.random() < 0.9) { mx = ux; mz = uz; wantMove = true; }
      if (Math.random() < d.strafe * 0.05) cs.dir *= -1;
      if (Math.random() < d.strafe) { mx += latx * cs.dir * 0.8; mz += latz * cs.dir * 0.8; wantMove = true; }
      if (this.diffId === 'easy') { wantMove = dist > 6; mx = ux; mz = uz; }
    } else if (cs.mode === 'move' && !shotgun) {
      mx = latx * cs.dir; mz = latz * cs.dir; wantMove = true;
      if (dist > 22 && spray) { mx += ux * 0.4; mz += uz * 0.4; }
    } else {
      // counter-strafe: спри чрез натискане в обратната посока
      const sp = Math.hypot(this.B.vel.x, this.B.vel.z);
      if (sp > 0.34 * vmax * 0.9) { mx = -this.B.vel.x / sp; mz = -this.B.vel.z / sp; wantMove = true; this.stopping = true; } else this.stopping = false;
      if ((shotgun || dist < 5) && Math.random() < 0.02) { cs.mode = 'move'; cs.until = now + 150; }
    }
    // проверка за пропаст/стена пред посоката на движение
    if (wantMove && !this.stopping) { const q = this.probe(mx, mz); if (!q) { cs.dir *= -1; mx = -mx; mz = -mz; if (!this.probe(mx, mz)) { mx = 0; mz = 0; wantMove = false; } } }
    inp.mx = mx; inp.mz = mz;
    inp.crouch = d.crouchFar && cs.mode === 'shoot' && dist > 13 && spray && !this.stopping && hs < 0.8;
    // стрелба
    const a = this.angTo(this.aimPt), v = this.view, errY = Math.abs(angNorm(a.yaw - v.yaw)), errP = Math.abs(a.pitch - v.pitch);
    const err = Math.hypot(errY * Math.cos(a.pitch), errP), allow = Math.atan2(head ? 0.14 : 0.24, Math.max(1, a.dist)) * d.fireTol;
    const accurate = hs <= 0.4 * vmax * (1 + d.moveFire);          // достатъчно бавен, за да е точен
    const reload = p.reloadEnd > now;
    let can = engaged && !reload && err < allow && (accurate || !d.counter || shotgun) && now >= this.pauseUntil;
    if (awp) can = can && hs < 0.8 && p.sc;
    if (can) {
      if (this.burstLeft <= 0) this.burstLeft = awp || !w.auto ? 1 : Math.round(rnd(d.burst[0], d.burst[1]) * (dist < 9 ? 3 : dist < 20 ? 1.2 : 0.6));
      this.fire = true;
    }
  }
  probe(mx, mz) {
    const p = this.p, L = Math.hypot(mx, mz) || 1, nx = p.x + mx / L * 0.8, nz = p.z + mz / L * 0.8, w = this.room.world, y = Math.round(p.y);
    const cx = Math.floor(nx), cz = Math.floor(nz);
    if (SOLID[w.get(cx, y, cz)] || SOLID[w.get(cx, y + 1, cz)] || w.get(cx, y, cz) === BLOCK.water) return false;
    return SOLID[w.get(cx, y - 1, cz)];
  }

  doFire(now) {
    const p = this.p, r = this.room, w = WEAPONS[p.weapon];
    if (!this.fire || !w || !w.mag || !p.alive) { if (!this.fire && this.burstLeft > 0 && now - (p.lastShot || 0) > 400) this.burstLeft = 0; return; }
    if (now < p.nextShot || p.reloadEnd > now) return;
    const idx = now - p.lastShot > w.rreset * 1000 ? 0 : p.shotIdx, [ry, rp] = recoilAt(p.weapon, idx), v = this.view, c = this.d.recoil;
    const before = p.ammo[p.weapon]?.mag;
    r.shoot(p, { yw: v.yaw - ry * c, pt: v.pitch - rp * c, sc: this.scoped && p.weapon === 'sniper', d: 0 });
    if (p.ammo[p.weapon] && p.ammo[p.weapon].mag < before) {
      this.burstLeft--;
      if (this.burstLeft <= 0) this.pauseUntil = now + rnd(this.d.pause[0], this.d.pause[1]) * 1000 * (w.auto ? 1 : 0.6) + (p.weapon === 'sniper' ? 300 : 0);
    }
  }

  // ----- гранати -----
  tryNade(now) {
    const p = this.p, d = this.d;
    if (!d.nades || p.inv.n <= 0 || now - this.lastThrow < 6000) return false;
    const kinds = Object.keys(p.inv.g).filter(k => p.inv.g[k] > 0 && k !== 'smoke'); if (!kinds.length) return false;
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const m = this.freshestMem(now); if (!m || now - m.seen > 3000) return false;
    const dist = Math.hypot(m.pos[0] - p.x, m.pos[2] - p.z); if (dist < 9 || dist > 24) return false;
    const e = this.eye; if (this.los(e, [m.pos[0], m.pos[1] + 1.2, m.pos[2]]) && dist < 14) return false;
    const a = this.angTo([m.pos[0], m.pos[1] + 1, m.pos[2]]); let best = null;
    for (let pt = -0.1; pt <= 1.1; pt += 0.04) {
      const g = simNade(this.room.world, e, a.yaw, pt, kind); if (!g) continue;
      const dd = Math.hypot(g.x - m.pos[0], g.z - m.pos[2]) + Math.abs(g.y - m.pos[1]) * 0.3;
      if (!best || dd < best.dd) best = { dd, pt };
    }
    if (!best || best.dd > 2.4) return false;
    this.nade = { yaw: a.yaw, pt: best.pt, t0: now, thrown: false, kind }; return true;
  }
  doNade(now) {
    const p = this.p, r = this.room, n = this.nade; if (!n) return;
    const want = { he: 'grenade', flash: 'flash', molo: 'molotov', smoke: 'smoke' }[n.kind];
    if (p.inv.g[n.kind] <= 0 || now - n.t0 > 4000) { this.nade = null; return; }
    if (p.weapon !== want) { if (now - (this.lastSw || 0) > 350) { this.lastSw = now; r.switchTo(p, 'n'); } }
    this.lookAt = null; this.aimDir = { yaw: n.yaw, pitch: n.pt };
    const v = this.view, ok = Math.abs(angNorm(n.yaw - v.yaw)) < 0.05 && Math.abs(n.pt - v.pitch) < 0.05;
    if (p.weapon === want && now >= p.nextShot && ok) { r.throwNade(p, { yw: v.yaw, pt: v.pitch }); this.lastThrow = now; this.nade = null; }
  }

  // ----- цели на рунда -----
  objective(now, threat) {
    const r = this.room, p = this.p, d = this.d, inp = this.input, j = r.map.json, names = Object.keys(j.sites);
    if (!names.length) return;
    const timeLeft = (r.phaseEnd - now) / 1000;
    if (p.team === 'att') {
      if (r.bomb && !r.bomb.exploded && !r.bomb.defused) return this.guardBomb(now, threat);
      if (r.drop && this.nearestAttBotTo(r.drop) === this) { this.moveTo(r.drop.x, r.drop.y, r.drop.z, now, 0.6); return; }
      const name = r.botPlan?.att || names[0];
      if (p.inv.bomb) {
        if (r.siteAt(p)) { this.wantUse = true; this.lookAt = null; this.holdStill(); this.lookHold(name, 'def'); return; }
        const sp = this.spot?.site === name ? this.spot : (this.spot = this.pickSpot(name, 0));
        if (!sp) return;
        this.moveTo(sp.x, sp.y, sp.z, now, 0.7, threat && d.aggro < 0.6 ? 'walk' : null); return;
      }
      // останалите нападатели заемат позиции около обекта; в края на рунда бързат
      const sp = this.spot?.site === name ? this.spot : (this.spot = this.pickSpot(name, 3));
      if (!sp) return;
      const near = Math.hypot(sp.x - p.x, sp.z - p.z) < 1.2;
      if (near) { this.holdStill(); this.lookHold(name, 'def'); if (threat && d.aggro > 0.6) this.moveTo(threat.pos[0], threat.pos[1], threat.pos[2], now, 1.2); return; }
      this.moveTo(sp.x, sp.y, sp.z, now, 0.8, threat && d.aggro < 0.6 ? 'walk' : null);
    } else {
      if (r.bomb && !r.bomb.exploded && !r.bomb.defused) return this.defuse(now, threat);
      const name = r.botPlan?.def?.[p.id] || names[0];
      const sp = this.spot?.site === name ? this.spot : (this.spot = this.pickSpot(name, 4));
      if (!sp) return;
      const near = Math.hypot(sp.x - p.x, sp.z - p.z) < 1.0;
      if (near) {
        this.holdStill();
        if (threat && d.aggro > 0.55 && now - threat.seen < 5000) { this.moveTo(threat.pos[0], threat.pos[1], threat.pos[2], now, 1.2); return; }
        if (!this.look || now > (this.lookUntil || 0)) this.lookHold(name, 'att');
        if (this.diffId === 'expert' && !threat) inp.crouch = (this.rolePhase > 0.5);
      } else this.moveTo(sp.x, sp.y, sp.z, now, 0.8, threat && d.aggro < 0.6 ? 'walk' : null);
    }
  }
  nearestAttBotTo(pt) {
    let best = null, bd = 1e9;
    for (const q of this.room.players.values()) if (q.bot && q.alive && q.team === 'att' && !q.inv.bomb) { const dd = Math.hypot(q.x - pt.x, q.z - pt.z); if (dd < bd) { bd = dd; best = q.bot; } }
    return best;
  }
  guardBomb(now, threat) {
    const r = this.room, p = this.p, b = r.bomb;
    if (!this.spot || this.spot.bomb !== b) {
      for (let i = 0; i < 30; i++) {
        const a = rnd(0, Math.PI * 2), rad = rnd(3, 9), x = b.x + Math.cos(a) * rad, z = b.z + Math.sin(a) * rad, y = this.nav.groundAt(x, z, b.y);
        if (y === null || Math.abs(y - b.y) > 3) continue;
        const s = this.nav.snap(x, y, z, 1); if (!s) continue;
        if (this.los([x, y + 1.6, z], [b.x, b.y + 0.3, b.z])) { this.spot = { x: s[0] + 0.5, y: s[1], z: s[2] + 0.5, bomb: b, site: b.site }; break; }
      }
      if (!this.spot || this.spot.bomb !== b) this.spot = { x: b.x, y: b.y, z: b.z, bomb: b, site: b.site };
    }
    const sp = this.spot;
    if (Math.hypot(sp.x - p.x, sp.z - p.z) < 1.1) { this.holdStill(); this.lookHold(b.site, 'def'); if (threat && this.d.aggro > 0.6) this.moveTo(threat.pos[0], threat.pos[1], threat.pos[2], now, 1.2); }
    else this.moveTo(sp.x, sp.y, sp.z, now, 0.8);
  }
  defuse(now, threat) {
    const r = this.room, p = this.p, b = r.bomb, need = (p.kit ? CFG.DEFUSE_KIT : CFG.DEFUSE) * 1000, left = b.explodeAt - now;
    const dist = Math.hypot(p.x - b.x, p.z - b.z);
    if (dist < 1.8 && Math.abs(p.y - b.y) < 2) {
      if (left > need - p.useP * 1000 + 400 || p.useP > 0) { this.wantUse = true; this.holdStill(); this.lookAt = null; this.pointToward([b.x, b.y + 0.2, b.z]); return; }
      this.holdStill(); return;                       // няма време – не започва
    }
    if (left < need * 0.45 && this.diffId !== 'easy') { this.holdStill(); return; }     // няма как да стигне – пази се
    this.moveTo(b.x, b.y, b.z, now, 0.5, threat && this.d.aggro < 0.5 && dist > 12 ? 'walk' : null);
  }

  // ----- движение / поглед -----
  holdStill() { this.input.mx = 0; this.input.mz = 0; }
  moveTo(x, y, z, now, thr, mode) {
    this.goTo(x, this.nav.groundAt(x, z, y) ?? y, z, now, thr);
    const s = this.steer(); const inp = this.input;
    if (s) { inp.mx = s[0]; inp.mz = s[1]; inp.walk = mode === 'walk'; this.pointAlong(); } else { this.holdStill(); }
    // заседане
    const st = this.stuck, p = this.p;
    if (now - st.t > 600) {
      if (s && Math.hypot(p.x - st.x, p.z - st.z) < 0.18) { st.n++; inp.jump = true; if (st.n >= 3) { this.path = null; this.goal = null; st.n = 0; this.sidestep = now + 450; this.sdir = Math.random() < 0.5 ? 1 : -1; } } else st.n = 0;
      st.t = now; st.x = p.x; st.z = p.z;
    }
    if (this.sidestep && now < this.sidestep && s) { inp.mx += -s[1] * this.sdir; inp.mz += s[0] * this.sdir; }
  }
  pointAlong() {          // докато върви, гледа напред по пътя (на височина на главата), за да е готов за среща
    const path = this.path; if (!path) return;
    const i = Math.min(path.length - 1, this.pi + 3), w = path[i], p = this.p;
    this.look = [w.x, w.y + 1.55, w.z]; this.lookUntil = Date.now() + 200;
  }
  pointToward(pt) { if (pt) { this.look = pt; this.lookUntil = Date.now() + 400; } }
  idleAim(dt, now) {
    const p = this.p;
    if (this.look && now < (this.lookUntil || 0)) return;
    this.look = null;
  }
  applyAim(dt) {
    const p = this.p, d = this.d, v = this.view, now = Date.now();
    let ty = v.yaw, tp = v.pitch;
    if (this.lookAt) { const a = this.angTo(this.lookAt); ty = a.yaw; tp = a.pitch; }
    else if (this.aimDir) { ty = this.aimDir.yaw; tp = this.aimDir.pitch; this.aimDir = null; }
    else if (this.look && now < (this.lookUntil || 0)) { const a = this.angTo(this.look); ty = a.yaw; tp = a.pitch; }
    else if (this.B.speed > 0.5) { ty = Math.atan2(-this.B.vel.x, -this.B.vel.z); tp = 0; }
    // шум на мерника
    if (now > this.noiseAt) { this.noiseAt = now + rnd(90, 220); const amp = d.aimErr * (1 + this.settle * 6) * (this.B.speed > 1 ? 1 + this.B.speed * 0.12 : 1); this.noiseT = [gauss() * amp, gauss() * amp * 0.7]; }
    this.noise[0] += (this.noiseT[0] - this.noise[0]) * Math.min(1, dt * 10); this.noise[1] += (this.noiseT[1] - this.noise[1]) * Math.min(1, dt * 10);
    this.settle = Math.max(0, this.settle - dt);
    const dy = angNorm(ty + this.noise[0] - v.yaw), dp = tp + this.noise[1] - v.pitch;
    const k = 1 - Math.exp(-d.aimGain * dt), maxStep = d.aimRate * dt;
    v.yaw = angNorm(v.yaw + clamp(dy * k, -maxStep, maxStep)); v.pitch = clamp(v.pitch + clamp(dp * k, -maxStep, maxStep), -1.5, 1.5);
    p.yw = v.yaw; p.pt = v.pitch;
  }

  // ----- физика -----
  physics(dt, now) {
    const p = this.p, B = this.B, inp = this.input, r = this.room;
    this.acc += dt;
    const w = WEAPONS[p.weapon], vmax = w?.speed ?? 6.25, ctx = { world: r.world, vmax: p.sc ? (w.scoped || vmax) : vmax, mode: 'comp', platforms: [], emit: () => { } };
    let n = 0;
    while (this.acc >= STEP && n++ < 8) {
      this.acc -= STEP;
      // входът е в световни координати (mx,mz); превеждаме го спрямо погледа
      B.yaw = this.view.yaw; B.pitch = this.view.pitch;
      const sn = Math.sin(B.yaw), cs = Math.cos(B.yaw);
      let fx = inp.mx * cs - inp.mz * sn, fz = inp.mx * sn + inp.mz * cs; const l = Math.hypot(fx, fz); if (l > 1) { fx /= l; fz /= l; }
      stepBody(B, { can: true, fx, fz, crouch: inp.crouch, walk: inp.walk, jumpNow: inp.jump, jumpHeld: false }, ctx, STEP);
      inp.jump = false;
    }
    p.x = B.pos.x; p.y = B.pos.y; p.z = B.pos.z; p.g = B.onGround; p.cr = B.crouching; p.spd = B.speed; p.wk = !!inp.walk && B.speed > 0.5; p.sc = this.scoped && p.weapon === 'sniper';
    if (p.g) p.lastGround = { x: p.x, y: p.y, z: p.z };
    this.pushHist(now);
  }
  pushHist(now) { const p = this.p; p.hist.push({ t: now, x: p.x, y: p.y, z: p.z, cr: p.cr }); while (p.hist.length && now - p.hist[0].t > 1200) p.hist.shift(); }
}
Bot.prototype.thinkAt = 0;
