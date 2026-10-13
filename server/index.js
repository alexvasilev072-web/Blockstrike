// BlockStrike - авторитетен сървър (Express + Socket.io).
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { World, BLOCK, DESTRUCTIBLE, boxCollides, traverse } from '../shared/world.js';
import { WEAPONS, CFG } from '../shared/weapons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const TEST = process.env.BS_TEST === '1'; // само за автоматичния тест: ускорени таймери + телепорт
const TS = TEST ? 0.25 : 1;

// ---------- Карти ----------
const MAPS = {};
for (const f of fs.readdirSync(path.join(ROOT, 'server/maps'))) {
  if (!f.endsWith('.json')) continue;
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/maps', f), 'utf8'));
  const world = World.fromMap(json);
  for (const side of ['att', 'def']) {
    for (const [x, z] of json.spawns[side]) {
      if (boxCollides(world, x + 0.5, 1, z + 0.5, CFG.HW, CFG.H) || !world.solid(x, 0, z))
        console.warn(`[map ${json.id}] лош spawn ${side} ${x},${z}`);
    }
  }
  MAPS[json.id] = { json, world };
}

// ---------- HTTP ----------
const app = express();
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/maps', express.static(path.join(ROOT, 'server/maps')));
app.use(express.static(path.join(ROOT, 'public')));
app.get('/healthz', (_, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

// ---------- Помощни ----------
const rooms = new Map();
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const other = t => (t === 'att' ? 'def' : 'att');

function dirFrom(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

function rayAABB(o, d, min, max) {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < min[i] || o[i] > max[i]) return null; continue; }
    let a = (min[i] - o[i]) / d[i], b = (max[i] - o[i]) / d[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

// ---------- Стая ----------
class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.mapId = 'desert';
    this.phase = 'lobby'; // lobby | freeze | live | end | matchover
    this.phaseEnd = 0;
    this.round = 0;
    this.sc = { att: 0, def: 0 };
    this.streak = { att: 0, def: 0 };
    this.world = null;
    this.changes = [];
    this.bomb = null;
    this.nades = [];
    this.nid = 1;
    this.started = { att: 0, def: 0 };
    this.lastTick = Date.now();
    this.lastWin = null;
  }

  get map() { return MAPS[this.mapId]; }
  emit(ev, data) { io.to(this.code).emit(ev, data); }

  // ----- лоби -----
  lobbyInfo() {
    return {
      code: this.code, hostId: this.hostId, mapId: this.mapId, phase: this.phase,
      maps: Object.values(MAPS).map(m => ({ id: m.json.id, name: m.json.name, desc: m.json.description })),
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team })),
      sc: this.sc, round: this.round,
    };
  }
  emitLobby() { this.emit('lobby', this.lobbyInfo()); }

  addPlayer(socket, name) {
    const p = {
      id: socket.id, socket, name, team: 'att', x: 0, y: 1, z: 0, yw: 0, pt: 0, hp: 0, armor: 0, alive: false,
      money: CFG.START_MONEY, kills: 0, deaths: 0, inv: null, ammo: {}, weapon: 'pistol',
      nextShot: 0, reloadEnd: 0, using: false, useP: 0, useStart: null, hist: [], lastState: 0, spd: 0,
    };
    const cnt = { att: 0, def: 0 };
    for (const q of this.players.values()) cnt[q.team]++;
    p.team = cnt.att <= cnt.def ? 'att' : 'def';
    this.resetLoadout(p);
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    socket.join(this.code);
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.hostId === id) this.hostId = this.players.keys().next().value || null;
    if (this.players.size === 0) { rooms.delete(this.code); return; }
    this.emitLobby();
  }

  // ----- екипировка -----
  resetLoadout(p) {
    p.inv = { pr: null, se: 'pistol', n: 0 };
    p.ammo = { pistol: { mag: WEAPONS.pistol.mag, res: WEAPONS.pistol.reserve } };
    p.weapon = 'pistol';
    p.armor = 0;
    p.reloadEnd = 0;
  }
  giveWeapon(p, id) {
    const w = WEAPONS[id];
    p.ammo[id] = { mag: w.mag, res: w.reserve };
    p.inv[w.slot] = id;
    p.weapon = id;
    p.reloadEnd = 0;
    p.nextShot = Date.now() + 400;
  }

  // ----- мач / рунд -----
  startMatch() {
    this.round = 0;
    this.sc = { att: 0, def: 0 };
    this.streak = { att: 0, def: 0 };
    for (const p of this.players.values()) { p.money = CFG.START_MONEY; p.kills = 0; p.deaths = 0; this.resetLoadout(p); p.alive = false; }
    this.emit('gameStart', { mapId: this.mapId, changes: [] });
    this.nextRound();
  }

  nextRound() {
    const now = Date.now();
    this.round++;
    let swapped = false;
    if (this.round === CFG.HALF + 1) {
      swapped = true;
      for (const p of this.players.values()) p.team = other(p.team);
      this.sc = { att: this.sc.def, def: this.sc.att };
      this.streak = { att: this.streak.def, def: this.streak.att };
      for (const p of this.players.values()) { p.money = CFG.START_MONEY; this.resetLoadout(p); p.alive = false; }
    }
    this.world = this.map.world.clone();
    this.changes = [];
    this.bomb = null;
    this.nades = [];
    const idx = { att: 0, def: 0 };
    this.started = { att: 0, def: 0 };
    for (const p of this.players.values()) {
      if (!p.alive) { const m = p.money; this.resetLoadout(p); p.money = m; }
      p.alive = true; p.hp = 100;
      p.weapon = p.inv.pr || p.inv.se;
      p.reloadEnd = 0; p.using = false; p.useP = 0;
      const sp = this.map.json.spawns[p.team];
      const [sx, sz] = sp[idx[p.team]++ % sp.length];
      p.x = sx + 0.5; p.y = 1; p.z = sz + 0.5;
      p.yw = p.team === 'att' ? 0 : Math.PI; p.pt = 0;
      p.hist = [{ t: now, x: p.x, y: p.y, z: p.z }];
      p.lastState = now; p.spd = 0;
      this.started[p.team]++;
    }
    this.phase = 'freeze';
    this.phaseEnd = now + CFG.FREEZE * 1000 * TS;
    this.emit('round', { n: this.round, sc: this.sc, swapped, mapId: this.mapId });
    for (const p of this.players.values()) p.socket.emit('spawn', { x: p.x, y: p.y, z: p.z, yw: p.yw });
    this.emitLobby();
  }

  endRound(win, why) {
    if (this.phase !== 'live') return;
    this.phase = 'end';
    this.phaseEnd = Date.now() + CFG.END * 1000 * TS;
    this.sc[win]++;
    const lose = other(win);
    const bonus = CFG.LOSE_REWARD + CFG.STREAK_BONUS * this.streak[lose];
    this.streak[lose] = Math.min(this.streak[lose] + 1, 4);
    this.streak[win] = 0;
    for (const p of this.players.values()) {
      const add = p.team === win ? CFG.WIN_REWARD : bonus;
      p.money = Math.min(CFG.MAX_MONEY, p.money + add);
      p.using = false; p.useP = 0;
    }
    this.emit('roundEnd', { win, why, sc: this.sc });
    if (this.sc[win] >= CFG.WIN_ROUNDS || this.round >= CFG.MAX_ROUNDS) {
      this.matchWinner = this.sc.att === this.sc.def ? null : (this.sc.att > this.sc.def ? 'att' : 'def');
      this.phase = 'matchover';
      this.phaseEnd = Date.now() + (CFG.END + CFG.MATCHEND) * 1000 * TS;
      this.emit('matchEnd', { win: this.matchWinner, sc: this.sc });
    }
  }

  checkEnd(now) {
    const alive = { att: 0, def: 0 };
    for (const p of this.players.values()) if (p.alive) alive[p.team]++;
    if (this.bomb) {
      if (now >= this.bomb.explodeAt) { this.explodeBomb(); return this.endRound('att', 'Бомбата избухна!'); }
      if (alive.def === 0 && this.started.def > 0) return this.endRound('att', 'Всички защитници са елиминирани');
      return;
    }
    if (alive.att === 0 && this.started.att > 0) return this.endRound('def', 'Всички нападатели са елиминирани');
    if (alive.def === 0 && this.started.def > 0) return this.endRound('att', 'Всички защитници са елиминирани');
    if (now >= this.phaseEnd) return this.endRound('def', 'Времето изтече');
  }

  explodeBomb() {
    const b = this.bomb;
    this.emit('boom', { x: b.x, y: b.y + 0.5, z: b.z, r: 12, big: true });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z);
      if (d < 16) this.hurt(p, null, 400 * (1 - d / 16), 'bomb', false, true);
    }
    this.breakRadius(b.x, b.y + 0.5, b.z, 6);
  }

  // ----- щети -----
  hurt(victim, attacker, dmg, weapon, head, ignoreTeam = false) {
    if (!victim.alive) return;
    if (attacker && attacker !== victim && attacker.team === victim.team && !ignoreTeam) return;
    if (victim.armor > 0) {
      const ab = Math.min(victim.armor, dmg * 0.5);
      victim.armor -= ab; dmg -= ab;
    }
    dmg = Math.round(dmg);
    victim.hp -= dmg;
    victim.socket.emit('hurt', { dmg, from: attacker ? [attacker.x, attacker.z] : null });
    if (victim.hp <= 0) {
      victim.hp = 0; victim.alive = false; victim.deaths++; victim.using = false; victim.useP = 0;
      if (attacker && attacker !== victim && attacker.team !== victim.team) {
        attacker.kills++;
        attacker.money = Math.min(CFG.MAX_MONEY, attacker.money + (WEAPONS[weapon]?.reward ?? 300));
      }
      this.emit('feed', {
        k: attacker ? attacker.name : null, v: victim.name, w: weapon, hd: head,
        kt: attacker ? attacker.team : null, vt: victim.team,
      });
    }
    return dmg;
  }

  breakRadius(cx, cy, cz, R) {
    const broken = [];
    const r = Math.ceil(R);
    for (let y = Math.floor(cy) - r; y <= Math.floor(cy) + r; y++)
      for (let z = Math.floor(cz) - r; z <= Math.floor(cz) + r; z++)
        for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
          const b = this.world.get(x, y, z);
          if (!DESTRUCTIBLE.has(b)) continue;
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz) > R) continue;
          this.world.set(x, y, z, 0);
          broken.push([x, y, z, b]);
        }
    this.pushBroken(broken);
  }
  pushBroken(broken) {
    if (!broken.length) return;
    for (const c of broken) this.changes.push([c[0], c[1], c[2]]);
    this.emit('blocks', broken);
  }

  // ----- позиция в миналото (lag compensation) -----
  posAt(p, t) {
    const h = p.hist;
    if (!h.length) return { x: p.x, y: p.y, z: p.z };
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].t <= t) {
        if (i === h.length - 1) return h[i];
        const a = h[i], b = h[i + 1], k = (t - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
      }
    }
    return h[0];
  }

  // ----- стрелба -----
  shoot(p, d) {
    const now = Date.now();
    if (this.phase !== 'live' || !p.alive) return;
    const w = WEAPONS[p.weapon];
    if (!w || p.weapon === 'grenade') return;
    if (now < p.nextShot || p.reloadEnd > now) return;
    const am = p.ammo[p.weapon];
    if (!am || am.mag <= 0) { this.reload(p); return; }
    am.mag--;
    p.nextShot = now + w.rate * 1000 - 15;

    let spread = w.spread + p.spd * (p.weapon === 'sniper' ? 0.012 : 0.0022);
    if (p.weapon === 'sniper' && !d.sc) spread = w.unscoped + p.spd * 0.01;
    const yw = Number(d.yw) || 0, pt = clamp(Number(d.pt) || 0, -1.55, 1.55);
    const f = dirFrom(yw, pt);
    const rt = [Math.cos(yw), 0, -Math.sin(yw)];
    const up = [Math.sin(yw) * Math.sin(pt), Math.cos(pt), Math.cos(yw) * Math.sin(pt)];
    const a = (Math.random() * 2 - 1) * spread, b = (Math.random() * 2 - 1) * spread;
    let dir = [f[0] + rt[0] * a + up[0] * b, f[1] + rt[1] * a + up[1] * b, f[2] + rt[2] * a + up[2] * b];
    const L = Math.hypot(...dir); dir = dir.map(v => v / L);
    const o = [p.x, p.y + CFG.EYE, p.z];
    const lag = clamp(Number(d.d) || 0, 0, 400);
    const rewind = now - lag;
    const MAX = 150;

    let best = null;
    for (const e of this.players.values()) {
      if (!e.alive || e.team === p.team) continue;
      const pos = this.posAt(e, rewind);
      const t = rayAABB(o, dir, [pos.x - CFG.HW, pos.y, pos.z - CFG.HW], [pos.x + CFG.HW, pos.y + CFG.H, pos.z + CFG.HW]);
      if (t !== null && t <= MAX && (!best || t < best.t)) best = { e, t, hy: o[1] + dir[1] * t - pos.y };
    }
    let tWall = MAX;
    const glass = [];
    traverse(this.world, o[0], o[1], o[2], dir[0], dir[1], dir[2], MAX, (x, y, z, t) => {
      const bl = this.world.get(x, y, z);
      if (bl === 0) return false;
      if (bl === BLOCK.glass) { glass.push([x, y, z, t]); return false; }
      tWall = t; return true;
    });
    const hitP = best && best.t < tWall ? best : null;
    const tEnd = hitP ? hitP.t : tWall;
    const broken = [];
    for (const g of glass) if (g[3] < tEnd) { this.world.set(g[0], g[1], g[2], 0); broken.push([g[0], g[1], g[2], BLOCK.glass]); }
    this.pushBroken(broken);

    const end = [o[0] + dir[0] * tEnd, o[1] + dir[1] * tEnd, o[2] + dir[2] * tEnd];
    this.emit('shot', { i: p.id, o: o.map(r2), e: end.map(r2), w: p.weapon, hit: hitP ? 1 : 0 });
    if (hitP) {
      const head = hitP.hy >= CFG.HEAD_Y;
      const dmg = w.dmg * (head ? CFG.HEAD_MULT : 1);
      const was = hitP.e.alive;
      const dealt = this.hurt(hitP.e, p, dmg, p.weapon, head);
      p.socket.emit('hit', { dmg: dealt, hd: head, kill: was && !hitP.e.alive });
    }
    if (am.mag === 0 && am.res > 0) this.reload(p);
  }

  reload(p) {
    const now = Date.now();
    const w = WEAPONS[p.weapon];
    if (!w || p.weapon === 'grenade' || p.reloadEnd > now) return;
    const am = p.ammo[p.weapon];
    if (!am || am.mag >= w.mag || am.res <= 0) return;
    p.reloadEnd = now + w.reload * 1000;
    p.socket.emit('reloading', { w: p.weapon, t: w.reload });
  }

  switchTo(p, slot) {
    if (!p.alive) return;
    const id = p.inv[slot];
    let wid = null;
    if (slot === 'n') wid = p.inv.n > 0 ? 'grenade' : null; else wid = id;
    if (!wid || wid === p.weapon) return;
    p.weapon = wid; p.reloadEnd = 0; p.nextShot = Date.now() + 350;
  }

  buy(p, item) {
    if (this.phase !== 'freeze' || !p.alive) return p.socket.emit('err', 'Времето за купуване изтече');
    const price = item === 'armor' ? 650 : WEAPONS[item]?.price;
    if (price === undefined || item === 'pistol') return;
    if (p.money < price) return p.socket.emit('err', 'Нямаш достатъчно пари');
    if (item === 'grenade') {
      if (p.inv.n >= 1) return p.socket.emit('err', 'Вече имаш граната');
      p.inv.n = 1;
    } else if (item === 'armor') {
      if (p.armor >= CFG.ARMOR) return p.socket.emit('err', 'Вече имаш броня');
      p.armor = CFG.ARMOR;
    } else {
      if (p.inv[WEAPONS[item].slot] === item) return p.socket.emit('err', 'Вече го имаш');
      this.giveWeapon(p, item);
    }
    p.money -= price;
    p.socket.emit('bought', item);
  }

  throwNade(p, d) {
    if (this.phase !== 'live' || !p.alive || p.weapon !== 'grenade' || p.inv.n <= 0) return;
    if (Date.now() < p.nextShot) return;
    const f = dirFrom(Number(d.yw) || 0, clamp(Number(d.pt) || 0, -1.5, 1.5));
    p.inv.n--;
    this.nades.push({
      id: this.nid++, owner: p.id, ownerTeam: p.team,
      x: p.x + f[0] * 0.5, y: p.y + CFG.EYE + f[1] * 0.5 - 0.1, z: p.z + f[2] * 0.5,
      vx: f[0] * 16, vy: f[1] * 16 + 3, vz: f[2] * 16, fuse: CFG.NADE_FUSE,
    });
    p.weapon = p.inv.pr || p.inv.se;
    p.nextShot = Date.now() + 400;
  }

  updateNades(dt) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const g = this.nades[i];
      g.fuse -= dt;
      const steps = 3, sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        g.vy -= 20 * sdt;
        for (const ax of ['x', 'y', 'z']) {
          const n = g[ax] + g['v' + ax] * sdt;
          const t = { x: g.x, y: g.y, z: g.z }; t[ax] = n;
          if (this.world.solid(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))) {
            g['v' + ax] *= -0.42;
            if (ax === 'y') { g.vx *= 0.75; g.vz *= 0.75; if (Math.abs(g.vy) < 1) g.vy = 0; }
          } else g[ax] = n;
        }
      }
      if (g.fuse <= 0) { this.nades.splice(i, 1); this.explodeNade(g); }
    }
  }

  explodeNade(g) {
    this.emit('boom', { x: g.x, y: g.y, z: g.z, r: CFG.NADE_RADIUS });
    const owner = this.players.get(g.owner);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.id !== g.owner && p.team === g.ownerTeam) continue;
      const cy = p.y + 0.9;
      const dx = p.x - g.x, dy = cy - g.y, dz = p.z - g.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > CFG.NADE_RADIUS) continue;
      let blocked = false;
      if (dist > 0.01) {
        traverse(this.world, g.x, g.y, g.z, dx / dist, dy / dist, dz / dist, dist, (x, y, z, t) => {
          const b = this.world.get(x, y, z);
          if (b !== 0 && b !== BLOCK.glass && t > 0.3 && t < dist - 0.3) { blocked = true; return true; }
          return false;
        });
      }
      if (blocked) continue;
      const dmg = CFG.NADE_DMG * (1 - dist / CFG.NADE_RADIUS);
      if (dmg >= 1) this.hurt(p, owner || null, dmg, 'grenade', false, p.id === g.owner);
    }
    this.breakRadius(g.x, g.y, g.z, CFG.NADE_BREAK);
  }

  // ----- залагане / обезвреждане -----
  siteAt(p) {
    for (const [name, [x1, z1, x2, z2]] of Object.entries(this.map.json.sites))
      if (p.x >= x1 && p.x <= x2 + 1 && p.z >= z1 && p.z <= z2 + 1 && p.y < 3) return name;
    return null;
  }

  updateUse(dt, now) {
    for (const p of this.players.values()) {
      let kind = null;
      if (p.using && p.alive && this.phase === 'live') {
        if (p.team === 'att' && !this.bomb && this.siteAt(p)) kind = 'plant';
        else if (p.team === 'def' && this.bomb && Math.hypot(p.x - this.bomb.x, p.z - this.bomb.z) < 2.4 && Math.abs(p.y - this.bomb.y) < 2) kind = 'defuse';
      }
      if (!kind) { p.useP = 0; p.useKind = null; p.useStart = null; continue; }
      if (p.useKind !== kind || !p.useStart) { p.useKind = kind; p.useP = 0; p.useStart = { x: p.x, z: p.z }; }
      if (Math.hypot(p.x - p.useStart.x, p.z - p.useStart.z) > 0.7) { p.useP = 0; p.useStart = { x: p.x, z: p.z }; continue; }
      p.useP += dt;
      if (kind === 'plant' && p.useP >= CFG.PLANT) {
        const site = this.siteAt(p);
        this.bomb = { site, x: p.x, y: 1, z: p.z, explodeAt: now + CFG.BOMB * 1000 * TS, defused: false };
        p.money = Math.min(CFG.MAX_MONEY, p.money + CFG.PLANT_BONUS);
        p.useP = 0; p.using = false;
        this.emit('msg', { t: 'plant', site, by: p.name });
      } else if (kind === 'defuse' && p.useP >= CFG.DEFUSE) {
        this.bomb.defused = true;
        p.money = Math.min(CFG.MAX_MONEY, p.money + CFG.DEFUSE_BONUS);
        this.emit('msg', { t: 'defuse', by: p.name });
        this.endRound('def', 'Бомбата е обезвредена!');
        p.useP = 0; p.using = false;
      }
    }
  }

  // ----- вход от играч -----
  onState(p, s) {
    if (!p.alive || this.phase === 'lobby') return;
    const now = Date.now();
    const dt = clamp((now - p.lastState) / 1000, 0.005, 0.5);
    p.lastState = now;
    const x = Number(s.x), y = Number(s.y), z = Number(s.z);
    if (![x, y, z].every(Number.isFinite)) return;
    const hd = Math.hypot(x - p.x, z - p.z);
    const bad = hd > 9 * dt + 0.35 || y - p.y > 14 * dt + 0.5 || y < -1 ||
      boxCollides(this.world, x, y, z, CFG.HW, CFG.H, 0.03);
    if (bad) { p.socket.emit('correct', { x: p.x, y: p.y, z: p.z }); return; }
    p.spd = p.spd * 0.6 + (hd / dt) * 0.4;
    p.x = x; p.y = y; p.z = z;
    p.yw = Number(s.yw) || 0; p.pt = clamp(Number(s.pt) || 0, -1.56, 1.56);
    p.hist.push({ t: now, x, y, z });
    while (p.hist.length && now - p.hist[0].t > 1200) p.hist.shift();
  }

  // ----- тик -----
  tick(now) {
    const dt = clamp((now - this.lastTick) / 1000, 0.001, 0.1);
    this.lastTick = now;
    if (this.phase === 'lobby') return;

    for (const p of this.players.values()) {
      if (p.reloadEnd && now >= p.reloadEnd) {
        p.reloadEnd = 0;
        const am = p.ammo[p.weapon], w = WEAPONS[p.weapon];
        if (am && w) { const take = Math.min(w.mag - am.mag, am.res); am.mag += take; am.res -= take; }
      }
    }
    if (this.phase === 'freeze' && now >= this.phaseEnd) {
      this.phase = 'live'; this.phaseEnd = now + CFG.LIVE * 1000 * TS;
    }
    if (this.phase === 'live') {
      this.updateUse(dt, now);
      this.updateNades(dt);
      this.checkEnd(now);
    } else if (this.phase === 'end') {
      this.updateNades(dt);
      if (now >= this.phaseEnd) this.nextRound();
    } else if (this.phase === 'matchover') {
      if (now >= this.phaseEnd) { this.phase = 'lobby'; this.nades = []; this.bomb = null; this.emitLobby(); return; }
    }
    this.broadcast(now);
  }

  broadcast(now) {
    const pl = [];
    for (const p of this.players.values())
      pl.push({ i: p.id, n: p.name, tm: p.team, x: r2(p.x), y: r2(p.y), z: r2(p.z), yw: r2(p.yw), pt: r2(p.pt), hp: p.hp, al: p.alive ? 1 : 0, w: p.weapon, k: p.kills, d: p.deaths });
    const snap = {
      t: now, ph: this.phase, tl: Math.max(0, (this.phaseEnd - now) / 1000), rd: this.round, sc: this.sc, pl,
      bomb: this.bomb ? { s: this.bomb.site, x: this.bomb.x, y: this.bomb.y, z: this.bomb.z, tl: Math.max(0, (this.bomb.explodeAt - now) / 1000) } : null,
      gr: this.nades.map(g => ({ i: g.id, x: r2(g.x), y: r2(g.y), z: r2(g.z) })),
    };
    this.emit('snap', snap);
    for (const p of this.players.values()) {
      const am = p.ammo[p.weapon];
      p.socket.emit('me', {
        hp: p.hp, ar: Math.round(p.armor), mo: p.money, w: p.weapon, inv: p.inv,
        mag: p.weapon === 'grenade' ? p.inv.n : am ? am.mag : 0, res: am && p.weapon !== 'grenade' ? am.res : 0,
        rl: p.reloadEnd > now ? 1 : 0, tm: p.team,
        us: p.useP > 0 ? { k: p.useKind, p: p.useP / (p.useKind === 'plant' ? CFG.PLANT : CFG.DEFUSE) } : null,
      });
    }
  }
}

setInterval(() => { const now = Date.now(); for (const r of rooms.values()) r.tick(now); }, 33);

// ---------- Socket.io ----------
io.on('connection', socket => {
  let room = null, p = null;

  socket.on('ping', cb => typeof cb === 'function' && cb());

  socket.on('join', (data, cb) => {
    if (typeof cb !== 'function' || room) return;
    const name = String(data?.name || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16) || 'Играч' + Math.floor(Math.random() * 900 + 100);
    let code = String(data?.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!code) code = makeCode();
    let r = rooms.get(code);
    if (!r) { r = new Room(code); rooms.set(code, r); }
    if (r.players.size >= CFG.MAX_PLAYERS) return cb({ ok: false, error: 'Стаята е пълна' });
    room = r;
    p = r.addPlayer(socket, name);
    cb({ ok: true, id: p.id, code });
    r.emitLobby();
    if (r.phase !== 'lobby') {
      socket.emit('gameStart', { mapId: r.mapId, changes: r.changes });
      socket.emit('round', { n: r.round, sc: r.sc, late: true, mapId: r.mapId });
    }
  });

  socket.on('team', t => {
    if (!room || room.phase !== 'lobby' || (t !== 'att' && t !== 'def')) return;
    p.team = t; room.emitLobby();
  });
  socket.on('setMap', id => {
    if (!room || room.hostId !== p.id || room.phase !== 'lobby' || !MAPS[id]) return;
    room.mapId = id; room.emitLobby();
  });
  socket.on('start', () => {
    if (!room || room.hostId !== p.id || room.phase !== 'lobby') return;
    room.startMatch();
  });
  socket.on('state', s => room && p && room.onState(p, s || {}));
  socket.on('shoot', d => room && p && room.shoot(p, d || {}));
  socket.on('throw', d => room && p && room.throwNade(p, d || {}));
  socket.on('reload', () => room && p && p.alive && room.reload(p));
  socket.on('switch', s => room && p && ['pr', 'se', 'n'].includes(s) && room.switchTo(p, s));
  socket.on('buy', item => room && p && typeof item === 'string' && room.buy(p, item));
  socket.on('use', down => { if (p) { p.using = !!down; if (!down) { p.useP = 0; } } });
  if (TEST) socket.on('dbgTp', t => { if (p) { p.x = t.x; p.y = t.y; p.z = t.z; p.hist.push({ t: Date.now(), x: t.x, y: t.y, z: t.z }); } });
  socket.on('disconnect', () => { if (room && p) room.removePlayer(p.id); });
});

server.listen(PORT, () => console.log(`BlockStrike слуша на http://localhost:${PORT}  (карти: ${Object.keys(MAPS).join(', ')})`));
