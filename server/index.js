// BlockStrike - авторитетен сървър (Express + Socket.io). Механиките следват CS2.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Bot, DIFFS, BOT_NAMES } from './bots.js';
import { Bsp, boxBlockedBsp, toCs, fromCs, U as BU } from '../shared/bsp.js';
import { World, BLOCK, SOLID, DESTRUCTIBLE, boxCollides, boxBlocked, traverse } from '../shared/world.js';
import '../shared/brushes.js';
import { GAME_MODES, modeOf } from '../shared/modes.js';       // режимите като таблица (флагове)                    // карти от кутии (type: 'brush')
import { canUse, NADE, NADE_W, NADE_ORDER, nadePrice, CHARACTERS, cleanChars, WEAPONS, KNIFE, KNIFE_TYPES, MOVE, CFG, recoilAt, spreadFor, inBuyZone } from '../shared/weapons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const TEST = process.env.BS_TEST === '1'; // само за автоматичния тест: ускорени таймери + телепорт
const TS = process.env.BS_TS ? Number(process.env.BS_TS) : TEST ? 0.25 : 1;

// ---------- Карти ----------
const MAPS = {};
// в тестов режим се зарежда и малката тестова арена от test/maps (за автоматичните проверки със зададени координати)
const MAP_FILES = fs.readdirSync(path.join(ROOT, 'server/maps')).sort().map(f => path.join(ROOT, 'server/maps', f));
if (TEST) for (const f of fs.readdirSync(path.join(ROOT, 'test/maps')).sort()) MAP_FILES.push(path.join(ROOT, 'test/maps', f));
for (const file of MAP_FILES) {
  if (!file.endsWith('.json')) continue;
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const world = World.fromMap(json);
  const bsp = json.type === 'bsp' ? new Bsp(json) : null;     // GoldSrc карта: колизията е по clipnode hull-овете
  for (const side of ['att', 'def']) {
    if (bsp) continue;
    for (const [x, z, y = 1] of json.spawns[side]) {
      if (boxCollides(world, x + 0.5, y, z + 0.5, CFG.HW, CFG.H) || !world.solid(x, y - 1, z))
        console.warn(`[map ${json.id}] лош spawn ${side} ${x},${z}`);
    }
  }
  // режим на картата и checkpoint клъстери (свързани checkpoint блокове = един checkpoint)
  const mode = json.mode || 'comp';
  const cpOf = new Map(); let cpCount = 0;
  for (let y = 0; y < world.sy; y++) for (let z = 0; z < world.sz; z++) for (let x = 0; x < world.sx; x++) {
    if (world.get(x, y, z) !== BLOCK.checkpoint || cpOf.has(x + ',' + y + ',' + z)) continue;
    const id = ++cpCount, q = [[x, y, z]]; cpOf.set(x + ',' + y + ',' + z, id);
    for (let h = 0; h < q.length; h++) for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = q[h][0] + dx, ny = q[h][1] + dy, nz = q[h][2] + dz, k = nx + ',' + ny + ',' + nz;
      if (!cpOf.has(k) && world.get(nx, ny, nz) === BLOCK.checkpoint) { cpOf.set(k, id); q.push([nx, ny, nz]); }
    }
  }
  MAPS[json.id] = { json, world, mode, cpOf, cpCount, bsp, max: Math.max(2, Math.min(CFG.MAX_PLAYERS, json.maxPlayers || CFG.MAX_PLAYERS)) };
}

// ---------- HTTP ----------
const app = express();
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/maps', express.static(path.join(ROOT, 'server/maps')));
app.use(express.static(path.join(ROOT, 'public')));
app.get('/healthz', (_, res) => res.send('ok'));
// звукови файлове по избор (public/sounds): ако има файл с подходящо име, клиентът го ползва вместо синтезирания звук
app.get('/api/sounds', (_, res) => { try { res.json(fs.readdirSync(path.join(ROOT, 'public/sounds')).filter(f => /\.(wav|ogg|mp3)$/i.test(f))); } catch { res.json([]); } });
// ICE сървъри за гласовия чат: публичен STUN + по желание TURN (променливи на средата TURN_URLS="turn:хост:3478,turns:хост:5349", TURN_USERNAME, TURN_CREDENTIAL)
app.get('/api/ice', (_, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }], urls = String(process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (urls.length) iceServers.push({ urls, username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
  res.json({ iceServers });
});
app.get('/api/maps', (_, res) => res.json(Object.values(MAPS).map(m => ({ id: m.json.id, name: m.json.name, desc: m.json.description, bsp: !!m.bsp }))));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

// ---------- Помощни ----------
const rooms = new Map();
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const other = t => (t === 'att' ? 'def' : 'att');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const hullH = p => (p.cr ? MOVE.CROUCH_H : MOVE.STAND_H);

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
// клавиш 4: превключва между наличните видове гранати (HE, flash, димна, молотов)
function nextNade(p) {
  const have = NADE_ORDER.filter(k => p.inv.g[k] > 0).map(k => NADE_W[k]); if (!have.length) return null;
  const i = have.indexOf(p.weapon); return have[(i + 1) % have.length];
}
const syncNades = p => { p.inv.n = NADE_ORDER.reduce((s, k) => s + p.inv.g[k], 0); };
const SLOT_WEAPON = (p, slot) => (slot === 'pr' ? p.inv.pr : slot === 'se' ? p.inv.se : slot === 'kn' ? 'knife' : slot === 'n' ? nextNade(p) : null);

// ---------- Стая ----------
const DEATH_FORCE = { pistol: 3, deagle: 5.5, smg: 3.2, rifle: 4.6, shotgun: 7, sniper: 8, knife: 1.2, grenade: 9, bomb: 11, molotov: 0, fall: 0 };
class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.mapId = 'canyon';
    this.mode = 'comp';          // comp | parkour | surf
    this.best = new Map();       // класация на стаята (parkour/surf): id -> {name,time}
    this.phase = 'lobby'; // lobby | freeze | live | end | matchover
    this.phaseEnd = 0;
    this.round = 0;
    this.sc = { att: 0, def: 0 };
    this.streak = { att: 0, def: 0 };
    this.world = null;
    this.changes = [];
    this.bomb = null;      // заложена бомба
    this.drop = null;      // паднала бомба {x,y,z}
    this.nades = []; this.smokes = []; this.fires = [];
    this.items = []; this.iid = 1;     // оръжия на земята {id,w,mag,res,x,y,z,v*,rest,owner,free}
    this.nid = 1;
    this.started = { att: 0, def: 0 };
    this.lastTick = Date.now();
    this.botSeq = 0; this.botPlan = null;
  }

  get map() { return MAPS[this.mapId]; }
  emit(ev, data) { io.to(this.code).emit(ev, data); }

  // ----- лоби -----
  lobbyInfo() {
    return {
      code: this.code, hostId: this.hostId, mapId: this.mapId, phase: this.phase,
      mode: this.mode, maps: Object.values(MAPS).sort((a, b) => (a.json.order ?? 0) - (b.json.order ?? 0)).map(m => ({ id: m.json.id, name: m.json.name, desc: m.json.description, mode: m.mode, level: m.json.level || '', max: m.max, big: !!m.json.big })),
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, bot: !!p.bot, diff: p.bot ? p.diff : undefined })),
      sc: this.sc, round: this.round,
    };
  }
  emitLobby() { this.emit('lobby', this.lobbyInfo()); }

  addPlayer(socket, name) {
    const p = {
      id: socket.id, socket, name, team: 'att', x: 0, y: 1, z: 0, yw: 0, pt: 0, cr: false, g: true, wk: false, sc: false,
      hp: 0, armor: 0, kit: false, alive: false, money: CFG.START_MONEY, kills: 0, deaths: 0, inv: null, ammo: {}, weapon: 'pistol',
      nextShot: 0, reloadEnd: 0, shotIdx: 0, lastShot: 0, using: false, useP: 0, useStart: null, useKind: null,
      hist: [], ready: false, readyAt: 0, blindUntil: 0, lastState: 0, spd: 0, peak: 0, wasAir: false, lastTk: null, lastGround: null, deniedAt: 0,
      cos: { knife: 'bayonet', skins: {}, char: cleanChars() },
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
    const p = this.players.get(id);
    if (p && p.alive && p.inv.bomb) this.dropBomb(p);
    this.players.delete(id); this.best.delete(id);
    if (this.hostId === id) this.hostId = [...this.players.values()].find(q => !q.bot)?.id || null;
    if (!this.hostId) { rooms.delete(this.code); return; }          // няма повече хора – ботовете не държат стаята
    this.emit('cosLeave', id); this.emit('vc:talk', { id, on: false });
    this.emitLobby();
  }

  // ----- ботове (само в състезателния режим, само в лобито) -----
  addBot(team, diff) {
    if (this.phase !== 'lobby' || !this.cfg.bots || this.players.size >= this.map.max || !DIFFS[diff]) return null;
    const used = new Set([...this.players.values()].map(q => q.name));
    const base = BOT_NAMES.filter(n => !used.has(n + ' (бот)')); const nm = (base.length ? base[Math.floor(Math.random() * base.length)] : 'Бот' + (this.botSeq + 1)) + ' (бот)';
    const id = 'bot' + (++this.botSeq) + '_' + Math.random().toString(36).slice(2, 6);
    const sock = { id, emit() { }, join() { }, leave() { } };
    const p = this.addPlayer(sock, nm);
    p.team = team; p.diff = diff; p.bot = new Bot(this, p, diff);
    const pick = t => { const l = Object.keys(CHARACTERS).filter(i => CHARACTERS[i].team === t); return l[Math.floor(Math.random() * l.length)]; }, kn = Object.keys(KNIFE_TYPES);
    p.cos = { knife: kn[Math.floor(Math.random() * kn.length)], skins: {}, char: { att: pick('att'), def: pick('def') } };
    this.emit('cos', { i: p.id, cos: p.cos });
    this.emitLobby();
    return p;
  }
  removeBot(id) {
    const q = this.players.get(id);
    if (this.phase !== 'lobby' || !q || !q.bot) return;
    this.removePlayer(id);
  }
  planBots() {
    const names = Object.keys(this.map.json.sites || {}); if (!names.length) { this.botPlan = null; return; }
    this.botPlan = { att: names[Math.floor(Math.random() * names.length)], def: {} };
    let i = Math.floor(Math.random() * names.length);
    for (const p of this.players.values()) if (p.team === 'def') this.botPlan.def[p.id] = names[i++ % names.length];
  }

  // ----- екипировка -----
  resetLoadout(p) {
    p.inv = { pr: null, se: 'pistol', n: 0, g: { he: 0, flash: 0, smoke: 0, molo: 0 }, bomb: false }; p.blindUntil = 0;
    p.ammo = { pistol: { mag: WEAPONS.pistol.mag, res: WEAPONS.pistol.reserve } };
    p.weapon = 'pistol';
    p.armor = 0; p.kit = false;
    p.reloadEnd = 0;
  }
  giveWeapon(p, id) {
    const w = WEAPONS[id];
    p.ammo[id] = { mag: w.mag, res: w.reserve };
    p.inv[w.slot] = id;
    p.weapon = id;
    p.reloadEnd = 0; p.shotIdx = 0;
    p.nextShot = Date.now() + CFG.BUY_DELAY;
  }

  // ----- мач / рунд -----
  // ----- parkour / surf: без отбори и оръжия; таймер, checkpoint-и, класация -----
  get cfg() { return modeOf(this.mode); }            // флаговете на текущия режим (shared/modes.js)
  get run() { return this.cfg.race; }                // състезателен режим (parkour/surf): таймер, checkpoint-и
  startRun() {
    const now = Date.now();
    this.round = 1; this.sc = { att: 0, def: 0 }; this.phase = 'live'; this.phaseEnd = now + 1e11; this.roundStart = now; this.liveStart = now;
    this.world = this.map.world.clone(); this.changes = []; this.bomb = null; this.drop = null; this.items = []; this.nades = []; this.best = new Map();
    let i = 0;
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; this.spawnRun(p, i++); }
    this.emit('gameStart', { mapId: this.mapId, mode: this.mode, changes: [] });
    this.emit('round', { n: 1, sc: this.sc, mapId: this.mapId, mode: this.mode });
    for (const p of this.players.values()) this.sendSpawn(p, false);
    this.emitLobby();
  }
  // начална позиция по индекс: в блоковите карти центърът на блока, в BSP картите – точните координати
  spawnPt(idx = 0) {
    const sp = this.map.json.spawns.att, [sx, sz, sy = 1] = sp[idx % sp.length], o = this.map.bsp ? 0 : 0.5;
    return { x: sx + o, y: sy, z: sz + o };
  }
  spawnRun(p, idx = 0) {
    this.resetLoadout(p); p.inv.se = null; p.inv.pr = null; p.ammo = {}; p.weapon = 'knife'; p.team = 'att';
    const sq = this.spawnPt(idx);
    p.alive = true; p.hp = 100; p.x = sq.x; p.y = sq.y; p.z = sq.z; p.yw = this.map.json.startYaw ?? 0; p.pt = 0;
    p.cr = false; p.g = true; p.spd = 0; p.lastTk = null; p.cp = null; p.cpSet = new Set(); p.run = { st: 0, t0: 0, tm: 0 };
    p.hist = [{ t: Date.now(), x: p.x, y: p.y, z: p.z, cr: false }]; p.lastGround = { x: p.x, y: p.y, z: p.z }; p.lastState = Date.now(); p.respawnAt = Date.now();
  }
  sendSpawn(p, quiet = true, why = null) { p.socket.emit('spawn', { x: p.x, y: p.y, z: p.z, yw: p.yw, quiet, why }); }
  respawnRun(p, why) {
    const to = p.cp || { ...this.spawnPt(0), yw: this.map.json.startYaw ?? 0 };
    p.x = to.x; p.y = to.y; p.z = to.z; if (to.yw !== undefined) p.yw = to.yw; p.spd = 0; p.respawnAt = Date.now(); p.lastTk = null; p.lastGround = { x: p.x, y: p.y, z: p.z };
    p.hist = [{ t: Date.now(), x: p.x, y: p.y, z: p.z, cr: false }];
    p.deaths += why && why !== 'cp' ? 1 : 0;
    this.sendSpawn(p, true, why);
  }
  restartRun(p) {
    p.cp = null; p.cpSet = new Set(); p.run = { st: 0, t0: 0, tm: 0 };
    const sq = this.spawnPt(0);
    p.x = sq.x; p.y = sq.y; p.z = sq.z; p.yw = this.map.json.startYaw ?? 0; p.spd = 0; p.respawnAt = Date.now(); p.lastTk = null;
    p.hist = [{ t: Date.now(), x: p.x, y: p.y, z: p.z, cr: false }]; p.lastGround = { x: p.x, y: p.y, z: p.z };
    this.sendSpawn(p, true, 'restart');
  }
  // логика на състезанието при всяка приета позиция
  runState(p, now) {
    if (this.map.bsp) return this.runStateBsp(p, now);
    const W = this.world, j = this.map.json, cx = Math.floor(p.x), cz = Math.floor(p.z), by = Math.floor(p.y - 0.06), fy = Math.floor(p.y + 0.1);
    const below = W.get(cx, by, cz), feet = W.get(cx, fy, cz), head = W.get(cx, Math.floor(p.y + 1.0), cz);
    if (below === BLOCK.lava || feet === BLOCK.lava || feet === BLOCK.water || head === BLOCK.water || p.y < (j.killY ?? 0.4)) {
      return this.respawnRun(p, below === BLOCK.lava || feet === BLOCK.lava ? 'lava' : (feet === BLOCK.water || head === BLOCK.water) ? 'water' : 'void');
    }
    if (p.g && below === BLOCK.checkpoint) {
      const id = this.map.cpOf.get(cx + ',' + by + ',' + cz) || 0;
      if (!p.cp || Math.abs(p.cp.x - (cx + 0.5)) > 0.01 || Math.abs(p.cp.z - (cz + 0.5)) > 0.01 || p.cp.y !== by + 1) {
        const first = !p.cpSet.has(id); p.cpSet.add(id);
        p.cp = { x: cx + 0.5, y: by + 1, z: cz + 0.5, yw: p.yw };
        p.socket.emit('cp', { n: p.cpSet.size, total: this.map.cpCount, first });
      }
    }
    const [x1, z1, x2, z2] = j.start || [0, 0, 0, 0];
    const inStart = p.x >= x1 && p.x <= x2 + 1 && p.z >= z1 && p.z <= z2 + 1 && p.y < (j.startY ?? 6);
    if (inStart) { if (p.run.st !== 0) { p.run = { st: 0, t0: 0, tm: 0 }; p.cp = null; p.cpSet = new Set(); } }
    else if (p.run.st === 0) { p.run = { st: 1, t0: now, tm: 0 }; p.socket.emit('runstart', { t0: now }); }
    if (p.run.st === 1 && (below === BLOCK.finish || feet === BLOCK.finish)) this.finishRun(p, now);
  }
  // GoldSrc карта: свободна езда; trigger_teleport-ите се изпълняват от сървъра (позицията е авторитетна)
  runStateBsp(p, now) {
    const bsp = this.map.bsp, c = toCs(p, p.cr ? 18 : 36);
    for (const t of bsp.teleports) {
      if (c[0] + 16 < t.min[0] || c[0] - 16 > t.max[0] || c[1] + 16 < t.min[1] || c[1] - 16 > t.max[1] || c[2] + 36 < t.min[2] || c[2] - 36 > t.max[2]) continue;
      const to = fromCs(t.to[0], t.to[1], t.to[2], 36);
      p.x = to.x; p.y = to.y; p.z = to.z; p.yw = ((t.yaw || 0) - 90) * Math.PI / 180; p.spd = 0; p.respawnAt = Date.now(); p.lastTk = null; p.lastGround = { x: p.x, y: p.y, z: p.z };
      p.hist = [{ t: Date.now(), x: p.x, y: p.y, z: p.z, cr: false }];
      this.sendSpawn(p, true, null);
      return;
    }
  }
  finishRun(p, now) {
    const time = now - p.run.t0; p.run = { st: 2, t0: p.run.t0, tm: time };
    const prev = this.best.get(p.id), isBest = !prev || time < prev.time;
    if (isBest) this.best.set(p.id, { name: p.name, time });
    this.emit('finish', { id: p.id, name: p.name, time, best: isBest });
  }

  startMatch() {
    if (this.cfg.kind === 'race') return this.startRun();
    this.round = 0;
    this.sc = { att: 0, def: 0 };
    this.streak = { att: 0, def: 0 };
    for (const p of this.players.values()) { p.money = CFG.START_MONEY; p.kills = 0; p.deaths = 0; this.resetLoadout(p); p.alive = false; p.ready = !!p.bot; p.readyAt = 0; }
    this.emit('gameStart', { mapId: this.mapId, mode: 'comp', changes: [] });
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
    this.bomb = null; this.drop = null; this.items = [];
    this.nades = []; this.smokes = []; this.fires = [];
    const idx = { att: 0, def: 0 };
    this.started = { att: 0, def: 0 };
    for (const p of this.players.values()) {
      if (!p.alive) { const m = p.money; this.resetLoadout(p); p.money = m; }
      p.inv.bomb = false;
      p.alive = true; p.hp = 100;
      p.weapon = p.inv.pr || p.inv.se || 'knife';
      p.reloadEnd = 0; p.using = false; p.useP = 0; p.shotIdx = 0; p.cr = false; p.g = true; p.wk = false; p.sc = false;
      const sp = this.map.json.spawns[p.team];
      const [sx, sz, sy = 1] = sp[idx[p.team]++ % sp.length];
      p.x = sx + 0.5; p.y = sy; p.z = sz + 0.5; p.peak = p.y; p.wasAir = false;
      p.yw = p.team === 'att' ? 0 : Math.PI; p.pt = 0;
      p.hist = [{ t: now, x: p.x, y: p.y, z: p.z, cr: false }];
      p.lastState = now; p.spd = 0; p.lastTk = null; p.lastGround = { x: p.x, y: p.y, z: p.z };
      this.started[p.team]++;
    }
    this.planBots(); this.botIntel = null; for (const q of this.players.values()) q.possessedBy = null;
    for (const p of this.players.values()) if (p.bot) { p.using = false; p.bot.reset(); }
    // бомбата получава случаен нападател
    const atts = [...this.players.values()].filter(p => p.team === 'att');
    if (atts.length) atts[Math.floor(Math.random() * atts.length)].inv.bomb = true;
    this.phase = 'freeze';
    this.roundStart = now;
    this.phaseEnd = now + CFG.FREEZE * 1000 * TS;
    this.emit('round', { n: this.round, sc: this.sc, swapped, mapId: this.mapId, mode: 'comp' });
    for (const p of this.players.values()) p.socket.emit('spawn', { x: p.x, y: p.y, z: p.z, yw: p.yw });
    this.emitLobby();
  }

  endRound(win, why) {
    if (this.phase !== 'live') return;
    this.phase = 'end';
    this.phaseEnd = Date.now() + CFG.END * 1000 * TS;
    this.sc[win]++;
    const lose = other(win);
    const bonus = CFG.LOSE_REWARD + CFG.STREAK_BONUS * this.streak[lose] + (lose === 'att' && this.bomb ? CFG.PLANTED_LOSS_BONUS : 0);
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
      if (this.bomb.exploded || this.bomb.defused) return;
      if (now >= this.bomb.explodeAt) { this.explodeBomb(); return this.endRound('att', 'Бомбата избухна!'); }
      if (alive.def === 0 && this.started.def > 0) return this.endRound('att', 'Всички защитници са елиминирани');
      return;
    }
    if (alive.att === 0 && this.started.att > 0) return this.endRound('def', 'Всички нападатели са елиминирани');
    if (alive.def === 0 && this.started.def > 0) return this.endRound('att', 'Всички защитници са елиминирани');
    if (now >= this.phaseEnd) return this.endRound('def', 'Времето изтече');
  }

  // „Поеми бота“ (като в CS): мъртъв играч получава тялото, оръжията, здравето и позицията на жив бот от своя отбор; ботът остава мъртъв за този рунд
  takeOver(p, id) {
    const b = this.players.get(id), now = Date.now();
    if (!b || !b.bot || b.team !== p.team || p.alive || !b.alive || this.phase !== 'live' || !this.cfg.bots || p.bot) return false;
    p.alive = true; p.hp = b.hp; p.armor = b.armor; p.kit = b.kit; p.inv = JSON.parse(JSON.stringify(b.inv)); p.ammo = JSON.parse(JSON.stringify(b.ammo)); p.weapon = b.weapon;
    p.reloadEnd = b.reloadEnd > now ? b.reloadEnd : 0; p.nextShot = now + 300; p.shotIdx = 0; p.lastShot = 0; p.using = false; p.useP = 0; p.useKind = null; p.useStart = null;
    p.x = b.x; p.y = b.y; p.z = b.z; p.yw = b.yw; p.pt = b.pt; p.cr = false; p.g = true; p.wk = false; p.sc = false; p.spd = 0; p.peak = p.y; p.wasAir = false; p.lastTk = null;
    p.hist = [{ t: now, x: p.x, y: p.y, z: p.z, cr: false }]; p.lastGround = { x: p.x, y: p.y, z: p.z }; p.lastState = now; p.respawnAt = now; p.specId = null;
    b.alive = false; b.hp = 0; b.armor = 0; b.inv.bomb = false; b.using = false; b.useP = 0; b.possessedBy = p.id;
    p.socket.emit('spawn', { x: p.x, y: p.y, z: p.z, yw: p.yw, quiet: true, takeover: b.name });
    this.emit('msg', { t: 'takeover', by: p.name, bot: b.name });
    return true;
  }
  explodeBomb() {
    const b = this.bomb; b.exploded = true;
    this.emit('boom', { x: b.x, y: b.y + 0.5, z: b.z, r: CFG.BOMB_RADIUS, big: true });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) < CFG.BOMB_RADIUS) this.hurt(p, null, 1000, 'bomb', false, { ignoreTeam: true, noArmor: true, from: [b.x, b.y + 0.3, b.z] });
    }
    this.breakRadius(b.x, b.y + 0.5, b.z, 7);
  }

  // ----- щети -----
  // CS бронирането: част от щетите се поема от бронята според armor ratio на оръжието.
  hurt(victim, attacker, dmg, weapon, head = false, opts = {}) {
    if (!victim.alive) return 0;
    if (attacker && attacker !== victim && attacker.team === victim.team && !opts.ignoreTeam) return 0;
    let d = dmg;
    if (victim.armor > 0 && !opts.noArmor) {
      const ratio = (opts.ratio ?? 1) * 0.5, bonus = 0.5;
      let nd = d * ratio, ad = (d - nd) * bonus;
      if (ad > victim.armor) { ad = victim.armor * (1 / bonus); nd = d - ad; victim.armor = 0; } else victim.armor -= ad;
      d = nd;
    }
    d = Math.max(1, Math.round(d));
    victim.hp -= d;
    victim.socket.emit('hurt', { dmg: d, from: attacker && attacker !== victim ? [attacker.x, attacker.z] : null });
    if (victim.bot && attacker && attacker !== victim) victim.bot.onHurt(attacker, d);
    if (victim.hp <= 0) this.kill(victim, attacker, weapon, head, opts);
    return d;
  }

  kill(victim, attacker, weapon, head, opts = {}) {
    victim.hp = 0; victim.alive = false; victim.deaths++; victim.using = false; victim.useP = 0;
    if (victim.inv.bomb) this.dropBomb(victim);
    if (this.cfg.combat) for (const slot of ['pr', 'se']) this.dropSlot(victim, slot, false);       // оръжията падат до тялото (с малко разпръскване)
    if (attacker && attacker !== victim && attacker.team !== victim.team) {
      attacker.kills++;
      attacker.money = Math.min(CFG.MAX_MONEY, attacker.money + (WEAPONS[weapon]?.reward ?? 300));
    }
    // клиентски ragdoll: накъде и колко силно да падне тялото (оръжията удрят силно, ножът и огънят – слабо; изстрел в главата – по-силно)
    const org = opts.from || (attacker && attacker !== victim ? [attacker.x, attacker.y + 1.5, attacker.z] : null);
    if (this.cfg.combat) {
      let dx = 0, dy = 0.25, dz = 0, f = 0;
      if (org) { dx = victim.x - org[0]; dy = victim.y + 1.1 - org[1]; dz = victim.z - org[2]; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy = dy / l * 0.5 + 0.3; dz /= l; f = DEATH_FORCE[weapon] ?? 4; if (head) f *= 1.6; }
      this.emit('died', { i: victim.id, x: victim.x, y: victim.y, z: victim.z, dx: +dx.toFixed(3), dy: +dy.toFixed(3), dz: +dz.toFixed(3), f: +f.toFixed(2), hd: head ? 1 : 0 });
    }
    this.emit('feed', { k: attacker ? attacker.name : null, v: victim.name, w: weapon, hd: head, kt: attacker ? attacker.team : null, vt: victim.team });
  }

  // Пуска бомбата надолу до първия твърд блок; във вода или извън картата се връща на последната валидна позиция.
  settleDrop(x, y, z, p) {
    const w = this.world, bx = Math.floor(x), bz = Math.floor(z);
    const fallback = p?.lastGround ? { ...p.lastGround } : { x, y: Math.max(1, y), z };
    if (bx < 0 || bz < 0 || bx >= w.sx || bz >= w.sz) return fallback;
    let cy = Math.min(w.sy - 1, Math.floor(y + 0.01));
    while (cy >= 0) {
      const b = w.get(bx, cy, bz);
      if (b === BLOCK.water) return fallback;
      if (SOLID[b]) break;
      if (w.get(bx, cy - 1, bz) === BLOCK.water) return fallback;
      cy--;
    }
    if (cy < 0) return fallback;
    let fy = cy;                          // cy е твърд блок под или в позицията; бомбата е на върха му
    if (SOLID[w.get(bx, cy, bz)]) fy = cy + 1;
    return { x, y: fy, z };
  }
  dropBomb(p, at = null) {
    p.inv.bomb = false;
    if (this.phase !== 'live' && this.phase !== 'freeze') return;
    const t = at || { x: p.x, y: p.y, z: p.z };
    this.drop = this.settleDrop(t.x, t.y, t.z, p);
    this.dropOwner = at ? p.id : null; this.dropFree = Date.now() + (at ? 1500 : 0);
    this.emit('msg', { t: 'drop' });
  }
  // ----- оръжия на земята -----
  spawnItem(w, am, x, y, z, vx, vy, vz, owner) {
    this.items.push({ id: this.iid++, w, mag: am ? am.mag : WEAPONS[w].mag, res: am ? am.res : WEAPONS[w].reserve, x, y, z, vx, vy, vz, rest: false, owner: owner || null, free: Date.now() + (owner ? 1000 : 0), t0: Date.now() });
    while (this.items.length > CFG.MAX_ITEMS) this.items.shift();            // най-старите изчезват първи
    return this.items[this.items.length - 1];
  }
  // пуска оръжието от слота (pr/se); thrown = хвърляне напред по погледа, иначе пада до играча
  dropSlot(p, slot, thrown) {
    const id = p.inv[slot]; if (!id || !WEAPONS[id] || WEAPONS[id].slot !== slot) return false;
    const am = p.ammo[id]; delete p.ammo[id]; p.inv[slot] = null;
    if (p.weapon === id) { p.weapon = p.inv.pr || p.inv.se || 'knife'; p.reloadEnd = 0; p.shotIdx = 0; p.sc = false; p.nextShot = Date.now() + CFG.SWITCH_DELAY; p.useP = 0; if (p.alive) this.emit('equip', { i: p.id, w: p.weapon }); }
    if (thrown) {
      const f = dirFrom(p.yw, clamp(p.pt, -1.2, 1.2)), eye = p.y + (p.cr ? MOVE.EYE_CROUCH : MOVE.EYE_STAND) - 0.2;
      let x = p.x + f[0] * 0.45, z = p.z + f[2] * 0.45; const y = eye + f[1] * 0.45;
      if (this.world.solid(Math.floor(x), Math.floor(y), Math.floor(z))) { x = p.x; z = p.z; }
      this.spawnItem(id, am, x, y, z, f[0] * 6, f[1] * 6 + 2.2, f[2] * 6, p.id);
    } else {
      const a = Math.random() * Math.PI * 2, k = slot === 'pr' ? 0.55 : -0.55;           // основното и пистолетът падат встрани един от друг
      this.spawnItem(id, am, p.x + Math.cos(a) * 0.15 * k, p.y + 0.5, p.z + Math.sin(a) * 0.15 * k, Math.cos(a) * 1.4 + k * 1.6, 2.6 + Math.random(), Math.sin(a) * 1.4, null);
    }
    return true;
  }
  // клавиш G: хвърля оръжието в ръката (основно/пистолет); ако в ръката няма оръжие (нож/граната) – бомбата, ако я носиш
  dropHeld(p) {
    if (!this.cfg.combat || !p.alive || (this.phase !== 'live' && this.phase !== 'freeze')) return;
    const w = WEAPONS[p.weapon];
    if (w && (w.slot === 'pr' || w.slot === 'se')) { this.dropSlot(p, w.slot, true); return; }
    if (p.inv.bomb) this.throwBomb(p);
  }
  // размяна (E): оръжието от земята заменя това в същия слот; старото пада на мястото на играча
  swapItem(p, itemId) {
    if (!this.cfg.combat || !p.alive || (this.phase !== 'live' && this.phase !== 'freeze')) return false;
    const i = this.items.findIndex(q => q.id === itemId); if (i < 0) return false;
    const it = this.items[i], slot = WEAPONS[it.w].slot;
    if (Math.hypot(p.x - it.x, p.z - it.z) > 2.4 || Math.abs(p.y - it.y) > 1.8) return false;
    this.items.splice(i, 1);
    const old = p.inv[slot];
    if (old) { const am = p.ammo[old]; delete p.ammo[old]; this.spawnItem(old, am, p.x, p.y + 0.4, p.z, 0.3 * Math.sin(p.yw), 1.6, 0.3 * Math.cos(p.yw), p.id); }
    p.inv[slot] = it.w; p.ammo[it.w] = { mag: it.mag, res: it.res };
    if (!old || p.weapon === old || slot === 'pr') { p.weapon = it.w; p.reloadEnd = 0; p.shotIdx = 0; p.sc = false; p.nextShot = Date.now() + CFG.SWITCH_DELAY; this.emit('equip', { i: p.id, w: p.weapon }); }
    p.socket.emit('got', { w: it.w });
    return true;
  }
  updateItems(dt) {
    for (let k = this.items.length - 1; k >= 0; k--) {
      const g = this.items[k]; if (g.rest) { if (!this.world.solid(Math.floor(g.x), Math.floor(g.y - 0.05), Math.floor(g.z))) g.rest = false; else continue; }
      const steps = 3, sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        g.vy -= 20 * sdt;
        for (const ax of ['x', 'y', 'z']) {
          const n = g[ax] + g['v' + ax] * sdt, t = { x: g.x, y: g.y, z: g.z }; t[ax] = n;
          const hy = ax === 'y' ? t.y : t.y + 0.2;
          if (this.world.solid(Math.floor(t.x), Math.floor(hy), Math.floor(t.z))) {
            g['v' + ax] *= ax === 'y' ? -0.25 : -0.3;
            if (ax === 'y') { g.vx *= 0.6; g.vz *= 0.6; if (Math.abs(g.vy) < 0.8) g.vy = 0; }
          } else g[ax] = n;
        }
      }
      if (Math.hypot(g.vx, g.vy, g.vz) < 0.25 && this.world.solid(Math.floor(g.x), Math.floor(g.y - 0.05), Math.floor(g.z))) { g.rest = true; g.vx = g.vy = g.vz = 0; const ry = Math.round(g.y); if (Math.abs(ry - g.y) < 0.2) g.y = ry; }
      if (g.y < -8) this.items.splice(k, 1);
    }
  }
  // автоматично вдигане: празен слот; ботовете сменят и с по-добро оръжие
  pickItems(now) {
    if (!this.items.length) return;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (let k = 0; k < this.items.length; k++) {
        const it = this.items[k];
        if (it.owner === p.id && now < it.free) continue;
        if (Math.hypot(p.x - it.x, p.z - it.z) > 1.0 || Math.abs(p.y - it.y) > 1.6) continue;
        const slot = WEAPONS[it.w].slot, cur = p.inv[slot];
        if (cur) { if (p.bot && (WEAPONS[it.w].price || 0) > (WEAPONS[cur].price || 0) + 250 && now > (p.pickAt || 0)) { p.pickAt = now + 3000; this.swapItem(p, it.id); break; } continue; }
        this.items.splice(k, 1);
        p.inv[slot] = it.w; p.ammo[it.w] = { mag: it.mag, res: it.res };
        if (slot === 'pr' && !NADE[p.weapon]) { p.weapon = it.w; p.reloadEnd = 0; p.shotIdx = 0; p.sc = false; p.nextShot = now + CFG.SWITCH_DELAY; this.emit('equip', { i: p.id, w: p.weapon }); }
        else if (slot === 'se' && p.weapon === 'knife' && !p.inv.pr) { p.weapon = it.w; p.nextShot = now + CFG.SWITCH_DELAY; this.emit('equip', { i: p.id, w: p.weapon }); }
        p.socket.emit('got', { w: it.w });
        break;
      }
    }
  }
  // Клавиш G: носителят хвърля бомбата пред себе си
  throwBomb(p) {
    if (!p.alive || !p.inv.bomb || (this.phase !== 'live' && this.phase !== 'freeze')) return;
    const fx = -Math.sin(p.yw), fz = -Math.cos(p.yw);
    let tx = p.x + fx * 1.6, tz = p.z + fz * 1.6;
    if (boxCollides(this.world, tx, p.y, tz, 0.2, 0.4)) { tx = p.x; tz = p.z; }
    this.dropBomb(p, { x: tx, y: p.y + 0.9, z: tz });
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
    if (!h.length) return { x: p.x, y: p.y, z: p.z, cr: p.cr };
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].t <= t) {
        if (i === h.length - 1) return h[i];
        const a = h[i], b = h[i + 1], k = (t - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, cr: b.cr };
      }
    }
    return h[0];
  }

  // трасира лъч: връща най-близкия враг и стената; чупи стъклата по пътя
  trace(shooter, o, dir, maxDist, rewind, breakGlass = true) {
    let best = null;
    for (const e of this.players.values()) {
      if (!e.alive || e.team === shooter.team) continue;
      const pos = this.posAt(e, rewind), H = pos.cr ? MOVE.CROUCH_H : MOVE.STAND_H;
      const t = rayAABB(o, dir, [pos.x - CFG.HW, pos.y, pos.z - CFG.HW], [pos.x + CFG.HW, pos.y + H, pos.z + CFG.HW]);
      if (t !== null && t <= maxDist && (!best || t < best.t)) best = { e, t, ry: (o[1] + dir[1] * t - pos.y) / H, pos };
    }
    let tWall = maxDist;
    const glass = [];
    traverse(this.world, o[0], o[1], o[2], dir[0], dir[1], dir[2], maxDist, (x, y, z, t) => {
      const bl = this.world.get(x, y, z);
      if (!SOLID[bl]) return false;
      if (bl === BLOCK.glass) { glass.push([x, y, z, t]); return false; }
      tWall = t; return true;
    });
    const hit = best && best.t < tWall ? best : null;
    const tEnd = hit ? hit.t : tWall;
    if (breakGlass) {
      const broken = [];
      for (const g of glass) if (g[3] < tEnd) { this.world.set(g[0], g[1], g[2], 0); broken.push([g[0], g[1], g[2], BLOCK.glass]); }
      this.pushBroken(broken);
    }
    return { hit, tEnd };
  }

  // ----- стрелба (CS2: spray pattern + неточност) -----
  spreadOf(p) { return spreadFor(p.weapon, { cr: p.cr, sc: p.sc, spd: p.spd, g: p.g, idx: p.shotIdx }); }

  // burst = true: следващ куршум от серия (Glock в режим „серия“); сървърът го пуска сам, с насочването от първия
  shoot(p, d, burst = false) {
    const now = Date.now();
    if (!this.cfg.combat || this.phase !== 'live' || !p.alive) return;
    const w = WEAPONS[p.weapon];
    if (!w || !w.mag) return;
    const am = p.ammo[p.weapon];
    if (burst ? (p.reloadEnd > now || !am || am.mag <= 0) : (now < p.nextShot || p.reloadEnd > now)) { if (burst) { p.bq = null; return; } return this.deny(p, now, Math.max(p.nextShot, p.reloadEnd) - now); }
    if (!am || am.mag <= 0) { this.reload(p); return this.deny(p, now, 250); }
    am.mag--;
    if (!burst) p.nextShot = now + w.rate * 1000 - 12;
    if (!burst && w.burst && p.burst) { p.nextShot = now + ((w.burst.n - 1) * w.burst.gap + w.burst.cd) * 1000; p.bq = { w: p.weapon, left: w.burst.n - 1, at: now + w.burst.gap * 1000, gap: w.burst.gap * 1000, d: { yw: d.yw, pt: d.pt, sc: 0, d: d.d } }; }
    p.sc = !!d.sc;
    if (now - p.lastShot > w.rreset * 1000) p.shotIdx = 0;
    p.lastShot = now;

    const [ry, rp] = recoilAt(p.weapon, p.shotIdx);
    const yw = num(d.yw) + ry, pt = clamp(num(d.pt) + rp, -1.55, 1.55);
    const spread = this.spreadOf(p);
    p.shotIdx++;

    const o = [p.x, p.y + (p.cr ? MOVE.EYE_CROUCH : MOVE.EYE_STAND), p.z];
    const rewind = now - clamp(num(d.d), 0, 400);
    const f = dirFrom(yw, pt);
    const rt = [Math.cos(yw), 0, -Math.sin(yw)];
    const up = [Math.sin(yw) * Math.sin(pt), Math.cos(pt), Math.cos(yw) * Math.sin(pt)];
    const ends = []; let total = 0, anyHead = false, anyKill = false, hitAny = 0;
    for (let k = 0; k < (w.pellets || 1); k++) {
      const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
      const a = Math.cos(ang) * rad, b = Math.sin(ang) * rad;
      let dir = [f[0] + rt[0] * a + up[0] * b, f[1] + up[1] * b, f[2] + rt[2] * a + up[2] * b];
      const L = Math.hypot(...dir); dir = dir.map(v => v / L);
      const { hit, tEnd } = this.trace(p, o, dir, 150, rewind);
      ends.push([r2(o[0] + dir[0] * tEnd), r2(o[1] + dir[1] * tEnd), r2(o[2] + dir[2] * tEnd)]);
      if (hit) {
        hitAny = 1;
        const ry2 = hit.ry, head = ry2 >= CFG.HEAD_FRAC;
        const mult = head ? CFG.HEAD_MULT : ry2 >= 0.55 ? 1 : ry2 >= 0.38 ? 1.25 : 0.75;
        const dmg = w.dmg * mult * Math.pow(w.range, hit.t / 12.5);
        const was = hit.e.alive;
        const dealt = this.hurt(hit.e, p, dmg, p.weapon, head, { ratio: w.ratio });
        total += dealt; anyHead = anyHead || head; if (was && !hit.e.alive) anyKill = true;
      }
    }
    this.emit('shot', { i: p.id, o: o.map(r2), e: ends, w: p.weapon, hit: hitAny, bs: burst ? 1 : 0 });
    for (const q of this.players.values()) if (q.bot && q.alive && q.team !== p.team) q.bot.onShotHeard(p, Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
    if (total) p.socket.emit('hit', { dmg: total, hd: anyHead, kill: anyKill });
    if (am.mag === 0 && am.res > 0) this.reload(p);
  }

  // Сървърът отказа изстрел: връща на клиента реалните патрони и колко още да чака.
  deny(p, now, wait) {
    if (now - p.deniedAt < 120) return;
    p.deniedAt = now;
    const am = p.ammo[p.weapon];
    p.socket.emit('denied', { w: p.weapon, mag: NADE[p.weapon] ? p.inv.g[NADE[p.weapon]] : am ? am.mag : 0, res: am ? am.res : 0, wait: Math.max(0, Math.round(wait)) });
  }

  // ----- нож -----
  knife(p, d) {
    const now = Date.now();
    if (this.phase !== 'live' || !p.alive || p.weapon !== 'knife') return;
    if (!this.cfg.combat) { this.emit('knife', { i: p.id, k: d.k === 'r' ? 'r' : 'l', hit: 0, back: 0 }); return; }
    if (now < p.nextShot) return this.deny(p, now, p.nextShot - now);
    const kind = d.k === 'r' ? KNIFE.right : KNIFE.left;
    p.nextShot = now + kind.rate * 1000;
    const yw = num(d.yw), pt = clamp(num(d.pt), -1.55, 1.55);
    const f = dirFrom(yw, pt), rt = [Math.cos(yw), 0, -Math.sin(yw)];
    const o = [p.x, p.y + (p.cr ? MOVE.EYE_CROUCH : MOVE.EYE_STAND), p.z];
    const rewind = now - clamp(num(d.d), 0, 400);
    let best = null;
    for (const [a, b] of [[0, 0], [0.22, 0], [-0.22, 0], [0, -0.3], [0, 0.25]]) {
      let dir = [f[0] + rt[0] * a * 0.5, f[1] + b * 0.5, f[2] + rt[2] * a * 0.5];
      const L = Math.hypot(...dir); dir = dir.map(v => v / L);
      const { hit } = this.trace(p, o, dir, kind.range, rewind, false);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    let dealt = 0, back = false;
    if (best) {
      const v = best.e, fv = [-Math.sin(v.yw), -Math.cos(v.yw)];
      const hl = Math.hypot(f[0], f[2]) || 1, dot = fv[0] * f[0] / hl + fv[1] * f[2] / hl;
      back = dot > 0.35;
      dealt = this.hurt(v, p, back ? kind.back : kind.dmg, 'knife', false, { ratio: 0.85 });
      p.socket.emit('hit', { dmg: dealt, hd: back, kill: !v.alive });
    }
    this.emit('knife', { i: p.id, k: d.k === 'r' ? 'r' : 'l', hit: best ? 1 : 0, back: back ? 1 : 0 });
  }

  reloadTime(w, am) { return w.shell ? 0.6 + 0.5 * (w.mag - am.mag) : w.reload; }
  reload(p) {
    const now = Date.now();
    const w = WEAPONS[p.weapon];
    if (!w || !w.mag || p.reloadEnd > now) return;
    const am = p.ammo[p.weapon];
    if (!am || am.mag >= w.mag || am.res <= 0) return;
    const t = this.reloadTime(w, am);
    p.reloadEnd = now + t * 1000;
    this.emit('reload', { i: p.id, w: p.weapon, t });
  }

  switchTo(p, slot) {
    if (!p.alive) return;
    const wid = SLOT_WEAPON(p, slot);
    if (!wid || wid === p.weapon) return;
    p.weapon = wid; p.reloadEnd = 0; p.nextShot = Date.now() + CFG.SWITCH_DELAY; p.shotIdx = 0; p.sc = false;
    this.emit('equip', { i: p.id, w: wid });
  }

  buy(p, item) {
    if (!p.alive || !this.cfg.shop) return;
    const inFreeze = this.phase === 'freeze';
    const inLive = this.phase === 'live' && Date.now() - Math.max(this.liveStart || 0, p.readyAt || 0) <= CFG.BUY_TIME * 1000 * TS;
    if (!inFreeze && !inLive) return p.socket.emit('err', 'Времето за купуване изтече');
    if (!inFreeze && !inBuyZone(this.map.json.spawns[p.team], p.x, p.z)) return p.socket.emit('err', 'Можеш да купуваш само в зоната около spawn-а');
    if (item === 'pistol') return;
    if (WEAPONS[item]?.team && WEAPONS[item].team !== p.team) return p.socket.emit('err', 'Това оръжие е само за ' + (WEAPONS[item].team === 'att' ? 'нападателите' : 'защитниците'));
    if (WEAPONS[item] && WEAPONS[item].slot !== 'pr' && WEAPONS[item].slot !== 'se' && !NADE[item]) return;
    const price = item === 'armor' ? 650 : item === 'kit' ? 400 : nadePrice(item, p.team);
    if (price === undefined || item === 'knife') return;
    if (p.money < price) return p.socket.emit('err', 'Нямаш достатъчно пари');
    if (NADE[item]) {
      const k = NADE[item], lim = k === 'flash' ? CFG.MAX_FLASH : 1;
      if (p.inv.g[k] >= lim) return p.socket.emit('err', k === 'flash' ? 'Най-много 2 flashbang-а' : 'Вече имаш такава граната');
      if (p.inv.n >= CFG.MAX_NADES) return p.socket.emit('err', 'Носиш най-много 4 гранати');
      p.inv.g[k]++; syncNades(p);
    } else if (item === 'armor') {
      if (p.armor >= CFG.ARMOR) return p.socket.emit('err', 'Вече имаш броня');
      p.armor = CFG.ARMOR;
    } else if (item === 'kit') {
      if (p.team !== 'def') return p.socket.emit('err', 'Defuse kit е само за защитниците');
      if (p.kit) return p.socket.emit('err', 'Вече имаш defuse kit');
      p.kit = true;
    } else {
      if (p.inv[WEAPONS[item].slot] === item) return p.socket.emit('err', 'Вече го имаш');
      if (p.inv[WEAPONS[item].slot]) this.dropSlot(p, WEAPONS[item].slot, false);       // старото оръжие от слота пада на земята (като в CS)
      this.giveWeapon(p, item);
    }
    p.money -= price;
    p.socket.emit('bought', item);
    this.emit('equip', { i: p.id, w: p.weapon });
  }

  throwNade(p, d) {
    const kind = NADE[p.weapon];
    if (!this.cfg.combat || this.phase !== 'live' || !p.alive || !kind || p.inv.g[kind] <= 0) return;
    if (Date.now() < p.nextShot) return;
    const f = dirFrom(num(d.yw), clamp(num(d.pt), -1.5, 1.5));
    p.inv.g[kind]--; syncNades(p);
    const eye = p.y + (p.cr ? MOVE.EYE_CROUCH : MOVE.EYE_STAND);
    this.nades.push({
      id: this.nid++, owner: p.id, ownerTeam: p.team, kind, hit: false,
      x: p.x + f[0] * 0.5, y: eye + f[1] * 0.5 - 0.1, z: p.z + f[2] * 0.5,
      vx: f[0] * 16, vy: f[1] * 16 + 3, vz: f[2] * 16, fuse: { he: CFG.NADE_FUSE, flash: CFG.FLASH_FUSE, smoke: CFG.SMOKE_FUSE, molo: CFG.MOLO_FUSE }[kind],
    });
    p.weapon = p.inv.pr || p.inv.se || 'knife';
    p.nextShot = Date.now() + 500;
    this.emit('equip', { i: p.id, w: p.weapon });
    this.emit('throw', { i: p.id });
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
            if (ax === 'y' && g.vy < -0.6) g.hit = true;
            g['v' + ax] *= -0.42;
            if (ax === 'y') { g.vx *= 0.75; g.vz *= 0.75; if (Math.abs(g.vy) < 1) g.vy = 0; }
          } else g[ax] = n;
        }
      }
      const spd = Math.hypot(g.vx, g.vy, g.vz);
      if (g.fuse <= 0 || (g.kind === 'molo' && g.hit) || (g.kind === 'smoke' && g.hit && spd < 1.4)) { this.nades.splice(i, 1); this.detonate(g); }
    }
  }

  detonate(g) {
    if (g.kind === 'flash') return this.flashBang(g);
    if (g.kind === 'smoke') return this.popSmoke(g);
    if (g.kind === 'molo') return this.igniteMolotov(g);
    return this.explodeNade(g);
  }
  // облаците дим спират погледа (не и куршумите)
  smokeBlocks(a, b) {
    const now = Date.now();
    for (const s of this.smokes) {
      if (now >= s.until || now < s.t0 + 500) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L2 = dx * dx + dy * dy + dz * dz; if (L2 < 1e-6) continue;
      const cy = s.y + 1.2; let t = ((s.x - a[0]) * dx + (cy - a[1]) * dy + (s.z - a[2]) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const px = a[0] + dx * t - s.x, py = a[1] + dy * t - cy, pz = a[2] + dz * t - s.z;
      if (px * px + py * py + pz * pz < (s.r * 0.92) ** 2) return true;
    }
    return false;
  }
  losClear(a, b) {   // дали между две точки няма твърд блок (стъклото е прозрачно)
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); if (L < 0.01) return true;
    let blocked = false;
    traverse(this.world, a[0], a[1], a[2], dx / L, dy / L, dz / L, L, (x, y, z, t) => { if (t >= L) return true; const bl = this.world.get(x, y, z); if (SOLID[bl] && bl !== BLOCK.glass) { blocked = true; return true; } return false; });
    return !blocked;
  }
  flashBang(g) {
    this.emit('boom', { x: g.x, y: g.y, z: g.z, r: 0, kind: 'flash' });
    const now = Date.now(), o = [g.x, g.y, g.z];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const eye = [p.x, p.y + (p.cr ? MOVE.EYE_CROUCH : MOVE.EYE_STAND), p.z], dx = o[0] - eye[0], dy = o[1] - eye[1], dz = o[2] - eye[2], dist = Math.hypot(dx, dy, dz);
      if (dist > CFG.FLASH_R || !this.losClear(eye, o) || this.smokeBlocks(eye, o)) continue;
      const f = dirFrom(p.yw, p.pt), dot = dist > 0.01 ? (f[0] * dx + f[1] * dy + f[2] * dz) / dist : 1;
      const fac = Math.max(0.12, Math.min(1, (dot + 0.45) / 1.0)), dur = Math.max(0.6, 5.0 * (1 - dist / CFG.FLASH_R)) * fac * (dist < 1.5 ? 1.2 : 1);
      p.blindUntil = Math.max(p.blindUntil, now + dur * 1000 * TS);
      p.socket.emit('flashed', { d: Math.round(dur * 100) / 100, a: Math.round(fac * 100) / 100 });
    }
  }
  popSmoke(g) {
    const now = Date.now(), s = { id: g.id, x: g.x, y: g.y, z: g.z, r: CFG.SMOKE_R, t0: now, until: now + CFG.SMOKE_TIME * 1000 * TS };
    this.smokes.push(s);
    for (const f of this.fires) if (Math.hypot(f.x - s.x, f.z - s.z) < s.r + 1 && Math.abs(f.y - s.y) < 3) f.until = now;       // димът гаси огъня
    this.emit('smoke', { i: s.id, x: s.x, y: s.y, z: s.z, r: s.r, d: CFG.SMOKE_TIME * TS });
  }
  igniteMolotov(g) {
    const now = Date.now(); this.emit('boom', { x: g.x, y: g.y, z: g.z, r: 0, kind: 'molotov' });
    for (const s of this.smokes) if (now < s.until && Math.hypot(s.x - g.x, s.z - g.z) < s.r) return;           // в облак дим не се разгаря
    const f = { id: g.id, x: g.x, y: g.y, z: g.z, r: CFG.MOLO_R, t0: now, until: now + CFG.MOLO_TIME * 1000 * TS, owner: g.owner, ownerTeam: g.ownerTeam, tick: now };
    this.fires.push(f);
    this.emit('fire', { i: f.id, x: f.x, y: f.y, z: f.z, r: f.r, d: CFG.MOLO_TIME * TS });
  }
  updateFires(dt, now) {
    this.smokes = this.smokes.filter(s => now < s.until);
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (now >= f.until) { this.fires.splice(i, 1); continue; }
      if (now - f.tick < 500) continue; f.tick = now;
      const owner = this.players.get(f.owner);
      for (const p of this.players.values()) {
        if (!p.alive || Math.hypot(p.x - f.x, p.z - f.z) > f.r || Math.abs(p.y - f.y) > 1.6) continue;
        this.hurt(p, owner || null, CFG.MOLO_DPS * 0.5, 'molotov', false, { noArmor: true, ignoreTeam: p.id === f.owner });
      }
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
          if (SOLID[b] && b !== BLOCK.glass && t > 0.3 && t < dist - 0.3) { blocked = true; return true; }
          return false;
        });
      }
      if (blocked) continue;
      const dmg = CFG.NADE_DMG * (1 - dist / CFG.NADE_RADIUS);
      if (dmg >= 1) this.hurt(p, owner || null, dmg, 'grenade', false, { ignoreTeam: p.id === g.owner, ratio: 1.0, from: [g.x, g.y, g.z] });
    }
    this.breakRadius(g.x, g.y, g.z, CFG.NADE_BREAK);
  }

  // ----- бомба: залагане / обезвреждане / вдигане -----
  siteAt(p) {
    for (const [name, [x1, z1, x2, z2]] of Object.entries(this.map.json.sites))
      if (p.x >= x1 && p.x <= x2 + 1 && p.z >= z1 && p.z <= z2 + 1) return name;
    return null;
  }

  updateUse(dt, now) {
    for (const p of this.players.values()) {
      let kind = null;
      if (p.using && p.alive && this.phase === 'live') {
        if (p.team === 'att' && p.inv.bomb && !this.bomb && p.g && this.siteAt(p)) kind = 'plant';
        else if (p.team === 'def' && this.bomb && !this.bomb.defused && p.g && Math.hypot(p.x - this.bomb.x, p.z - this.bomb.z) < 2.4 && Math.abs(p.y - this.bomb.y) < 2) kind = 'defuse';
      }
      if (!kind) { p.useP = 0; p.useKind = null; p.useStart = null; continue; }
      if (p.useKind !== kind || !p.useStart) { p.useKind = kind; p.useP = 0; p.useStart = { x: p.x, z: p.z }; }
      // ако мръднеш, действието се прекъсва (като в CS)
      if (Math.hypot(p.x - p.useStart.x, p.z - p.useStart.z) > 0.4 || p.spd > 1.2) { p.useP = 0; p.useStart = { x: p.x, z: p.z }; continue; }
      p.useP += dt;
      const need = kind === 'plant' ? CFG.PLANT : (p.kit ? CFG.DEFUSE_KIT : CFG.DEFUSE);
      p.useNeed = need;
      if (kind === 'plant' && p.useP >= need) {
        const site = this.siteAt(p);
        this.bomb = { site, x: p.x, y: p.y, z: p.z, explodeAt: now + CFG.BOMB * 1000 * TS, defused: false, tick: now };
        p.inv.bomb = false; this.drop = null;
        p.money = Math.min(CFG.MAX_MONEY, p.money + CFG.PLANT_BONUS);
        p.useP = 0; p.using = false;
        this.emit('msg', { t: 'plant', site, by: p.name });
      } else if (kind === 'defuse' && p.useP >= need) {
        this.bomb.defused = true;
        p.money = Math.min(CFG.MAX_MONEY, p.money + CFG.DEFUSE_BONUS);
        this.emit('msg', { t: 'defuse', by: p.name });
        this.endRound('def', 'Бомбата е обезвредена!');
        p.useP = 0; p.using = false;
      }
    }
  }

  updatePickup() {
    if (!this.drop || this.phase !== 'live') return;
    for (const p of this.players.values()) {
      if (!p.alive || p.team !== 'att' || p.inv.bomb) continue;
      if (this.dropOwner === p.id && Date.now() < this.dropFree) continue;
      if (Math.hypot(p.x - this.drop.x, p.z - this.drop.z) < CFG.BOMB_PICKUP && Math.abs(p.y - this.drop.y) < 1.5) {
        p.inv.bomb = true; this.drop = null;
        this.emit('msg', { t: 'pickup', by: p.name });
        break;
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
    // по време на freeze се приемат само ъглите; позицията не се променя
    if (this.phase === 'freeze') {
      p.yw = num(s.yw); p.pt = clamp(num(s.pt), -1.56, 1.56); p.spd = 0;
      if (Math.hypot(x - p.x, z - p.z) > 0.25 || Math.abs(y - p.y) > 0.6) p.socket.emit('correct', { x: p.x, y: p.y, z: p.z });
      return;
    }
    const cr = !!s.cr, H = cr ? MOVE.CROUCH_H : MOVE.STAND_H;
    const hd = Math.hypot(x - p.x, z - p.z);
    // скорост: разстояние / време по тиковете на симулацията на клиента (64 Hz), а не по момента на пристигане на пакета
    const tk = Number(s.tk); let dtk = null;
    if (Number.isFinite(tk) && p.lastTk !== null) { const d = (tk - p.lastTk) / 64; if (d > 0 && d < 1) dtk = d; }
    if (Number.isFinite(tk)) p.lastTk = tk;
    const dEff = dtk !== null ? Math.max(dt, dtk) : dt;
    // допустими скорости по режим: surf стига до 87 м/с, parkour има слуз (13 м/с нагоре) и water jump
    const LIM = this.map.bsp ? { h: 110, v: 110 } : this.cfg.move;
    if (now - (p.respawnAt || 0) < 120) return;     // позиции, изпратени преди респауна
    const bad = hd > LIM.h * dEff + 0.4 || y - p.y > LIM.v * dEff + 0.5 || (!this.map.bsp && y < -1) || (this.map.bsp ? boxBlockedBsp(this.map.bsp, x, y, z, cr) : boxBlocked(this.world, x, y, z, CFG.HW, H, 0.03));
    if (bad) { p.socket.emit('correct', { x: p.x, y: p.y, z: p.z }); return; }
    const inst = dtk !== null ? Math.min(hd / dtk, this.cfg.move.inst) : Math.min(hd / Math.max(dt, 0.03), this.cfg.move.inst);
    p.spd = p.spd * 0.5 + inst * 0.5;
    // щети от падане (като в CS: над 580 ед/с)
    const g = !!s.g;
    if (!g) { if (!p.wasAir) p.peak = p.y; p.peak = Math.max(p.peak, y); p.wasAir = true; }
    else if (p.wasAir) {
      p.wasAir = false;
      const fall = p.peak - y;
      const inWater = this.world.get(Math.floor(x), Math.floor(y), Math.floor(z)) === BLOCK.water || this.world.get(Math.floor(x), Math.floor(y + 0.5), Math.floor(z)) === BLOCK.water;
      if (fall > 1 && !inWater && this.cfg.fallDamage) {
        const v = Math.sqrt(2 * MOVE.GRAVITY * fall);
        if (v > MOVE.FALL_SAFE) this.hurt(p, null, (v * 40 - 580) * 0.225, 'fall', false, { noArmor: true, ignoreTeam: true });
      }
    }
    if (g && this.world.get(Math.floor(x), Math.floor(y), Math.floor(z)) !== BLOCK.water) p.lastGround = { x, y, z };
    p.x = x; p.y = y; p.z = z; p.cr = cr; p.g = g; p.wk = !!s.wk; p.sc = !!s.sc;
    p.yw = num(s.yw); p.pt = clamp(num(s.pt), -1.56, 1.56);
    p.hist.push({ t: now, x, y, z, cr });
    while (p.hist.length && now - p.hist[0].t > 1200) p.hist.shift();
    if (this.cfg.race) this.runState(p, now);
  }

  // ----- тик -----
  tick(now) {
    const dt = clamp((now - this.lastTick) / 1000, 0.001, 0.1);
    this.lastTick = now;
    if (this.phase === 'lobby') return;
    if (!this.cfg.rounds) { this.broadcast(now); return; }       // режим без рундове (състезание): само снапшоти

    for (const p of this.players.values()) {
      if (p.reloadEnd && now >= p.reloadEnd) {
        p.reloadEnd = 0;
        const am = p.ammo[p.weapon], w = WEAPONS[p.weapon];
        if (am && w) { const take = Math.min(w.mag - am.mag, am.res); am.mag += take; am.res -= take; }
      }
    }
    if (this.phase !== 'matchover') for (const p of this.players.values()) if (p.bot) p.bot.update(dt, now);
    for (const p of this.players.values()) if (p.bq) {                                    // серия: останалите куршуми излизат през равни интервали
      if (!p.alive || p.weapon !== p.bq.w) { p.bq = null; continue; }
      if (now >= p.bq.at) { const q = p.bq; q.left--; q.at += q.gap; if (q.left <= 0) p.bq = null; this.shoot(p, q.d, true); }
    }
    if (this.phase !== 'lobby') { this.updateItems(dt); if (this.phase === 'freeze' || this.phase === 'live') this.pickItems(now); }
    if (this.phase === 'freeze' && now >= this.phaseEnd) {
      // freeze не свършва, докато някой човек още е на екрана „Готов ли си?“ (най-много CFG.READY_WAIT сек повече)
      const waiting = !TEST && [...this.players.values()].some(q => !q.bot && !q.ready) && now < this.roundStart + (CFG.FREEZE + CFG.READY_WAIT) * 1000;
      if (!waiting) { this.phase = 'live'; this.liveStart = now; this.phaseEnd = now + CFG.LIVE * 1000 * TS; }
    }
    if (this.phase === 'live') {
      this.updateUse(dt, now);
      this.updatePickup();
      this.updateNades(dt);
      this.updateFires(dt, now);
      this.checkEnd(now);
    } else if (this.phase === 'end') {
      this.updateNades(dt);
      if (now >= this.phaseEnd) this.nextRound();
    } else if (this.phase === 'matchover') {
      if (now >= this.phaseEnd) { this.phase = 'lobby'; this.nades = []; this.bomb = null; this.drop = null; this.items = []; this.emitLobby(); return; }
    }
    this.broadcast(now);
  }

  broadcast(now) {
    const pl = [];
    for (const p of this.players.values())
      pl.push({ i: p.id, n: p.name, tm: p.team, x: r2(p.x), y: r2(p.y), z: r2(p.z), yw: r2(p.yw), pt: r2(p.pt), hp: p.hp, al: p.alive ? 1 : 0, w: p.weapon, k: p.kills, d: p.deaths, cr: p.cr ? 1 : 0, g: p.g ? 1 : 0, wk: p.wk ? 1 : 0, bm: p.inv.bomb ? 1 : 0, po: p.possessedBy ? 1 : 0, sc: p.sc ? 1 : 0, us: p.useP > 0 ? (p.useKind === 'plant' ? 1 : 2) : 0, rs: p.run ? p.run.st : 0, ...(TEST ? { sp: r2(p.spd) } : {}) });
    const snap = {
      mode: this.mode, lb: this.cfg.race ? [...this.best.entries()].map(([id, b]) => [b.name, b.time, id]).sort((a, b) => a[1] - b[1]).slice(0, 10) : undefined,
      t: now, el: this.roundStart ? Math.round((now - this.roundStart) / 100) / 10 : 0, ph: this.phase, tl: Math.max(0, (this.phaseEnd - now) / 1000), rd: this.round, sc: this.sc, pl,
      bomb: this.bomb ? { s: this.bomb.site, x: this.bomb.x, y: this.bomb.y, z: this.bomb.z, st: this.bomb.exploded ? 'exploded' : this.bomb.defused ? 'defused' : 'planted', tl: this.bomb.exploded || this.bomb.defused ? 0 : Math.max(0, (this.bomb.explodeAt - now) / 1000) } : null,
      bd: this.drop,
      it: this.items.map(g => [g.id, g.w, r2(g.x), r2(g.y), r2(g.z), g.rest ? 1 : 0]),
      gr: this.nades.map(g => ({ i: g.id, k: g.kind, x: r2(g.x), y: r2(g.y), z: r2(g.z) })),
      sm: this.smokes.map(s => ({ i: s.id, x: s.x, y: s.y, z: s.z, r: s.r, a: Math.round((now - s.t0) / 100) / 10, tl: Math.max(0, Math.round((s.until - now) / 100) / 10) })),
      fr: this.fires.map(f => ({ i: f.id, x: f.x, y: f.y, z: f.z, r: f.r, a: Math.round((now - f.t0) / 100) / 10, tl: Math.max(0, Math.round((f.until - now) / 100) / 10) })),
    };
    this.emit('snap', snap);
    for (const p of this.players.values()) {
      const am = p.ammo[p.weapon];
      p.socket.emit('me', {
        hp: p.hp, ar: Math.round(p.armor), mo: p.money, w: p.weapon, inv: p.inv, kit: p.kit, bu: p.burst ? 1 : 0,
        mag: NADE[p.weapon] ? p.inv.g[NADE[p.weapon]] : am ? am.mag : 0, res: am && !NADE[p.weapon] ? am.res : 0,
        rl: p.reloadEnd > now ? 1 : 0, tm: p.team,
        sp: (() => { if (p.alive || !p.specId) return null; const t = this.players.get(p.specId); if (!t || !t.alive || t.team !== p.team) return null; const ta = t.ammo[t.weapon]; return { id: t.id, hp: t.hp, ar: Math.round(t.armor), w: t.weapon, mag: NADE[t.weapon] ? t.inv.g[NADE[t.weapon]] : ta ? ta.mag : 0, res: ta && !NADE[t.weapon] ? ta.res : 0, rl: t.reloadEnd > now ? 1 : 0, kit: t.kit, bomb: t.inv.bomb, g: t.inv.g }; })(),
        bt: this.phase === 'freeze' ? 99 : this.phase === 'live' ? Math.max(0, Math.ceil(CFG.BUY_TIME - (now - Math.max(this.liveStart || 0, p.readyAt || 0)) / 1000 / TS)) : 0,
        us: p.useP > 0 ? { k: p.useKind, p: p.useP / (p.useNeed || 1) } : null,
        bd: p.team === 'att' ? this.drop : null,
        rn: this.cfg.race && p.run ? { st: p.run.st, t0: p.run.t0, tm: p.run.tm, cps: p.cpSet ? p.cpSet.size : 0, total: this.map.cpCount } : null,
      });
    }
  }
}

// честота на симулацията/снапшотите на сървъра (по подразбиране 30 Hz); при по-мощен хостинг: TICK_MS=22 (~45 Hz) или 16 (~60 Hz)
const TICK_MS = Math.max(10, Math.min(50, Number(process.env.TICK_MS) || 33));
setInterval(() => { const now = Date.now(); for (const r of rooms.values()) r.tick(now); }, TICK_MS);

// ---------- Socket.io ----------
const cleanSkin = v => String(v || '').replace(/[^a-z0-9_]/gi, '').slice(0, 16);
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
    if (r.players.size >= CFG.MAX_PLAYERS || (r.phase !== 'lobby' && r.cfg.mapMax && r.players.size >= r.map.max)) return cb({ ok: false, error: 'Стаята е пълна' });
    room = r;
    p = r.addPlayer(socket, name);
    cb({ ok: true, id: p.id, code });
    r.emitLobby();
    for (const q of r.players.values()) socket.emit('cos', { i: q.id, cos: q.cos });
    if (r.phase !== 'lobby') {
      socket.emit('gameStart', { mapId: r.mapId, mode: r.mode, changes: r.changes });
      socket.emit('round', { n: r.round, sc: r.sc, late: true, mapId: r.mapId, mode: r.mode });
      if (r.cfg.race) { r.spawnRun(p, r.players.size); r.sendSpawn(p, false); }
    }
  });

  socket.on('team', t => {
    if (!room || room.phase !== 'lobby' || (t !== 'att' && t !== 'def')) return;
    p.team = t; room.emitLobby();
  });
  socket.on('setMap', id => {
    if (!room || room.hostId !== p.id || room.phase !== 'lobby' || !MAPS[id] || MAPS[id].mode !== room.mode) return;
    room.mapId = id; room.emitLobby();
  });
  socket.on('setMode', m => {
    if (!room || room.hostId !== p.id || room.phase !== 'lobby' || !GAME_MODES[m]) return;
    room.mode = m;
    if (!modeOf(m).bots) for (const q of [...room.players.values()]) if (q.bot) room.removePlayer(q.id);       // ботове има само в режими с флаг bots
    if (MAPS[room.mapId]?.mode !== m) room.mapId = Object.values(MAPS).filter(x => x.mode === m).sort((a, b) => (a.json.order ?? 0) - (b.json.order ?? 0))[0]?.json.id || room.mapId;
    room.emitLobby();
  });
  socket.on('addBot', d => { if (room && p && room.hostId === p.id) room.addBot(d?.team === 'def' ? 'def' : 'att', DIFFS[d?.diff] ? d.diff : 'medium'); });
  socket.on('removeBot', id => { if (room && p && room.hostId === p.id && typeof id === 'string') room.removeBot(id); });
  socket.on('cp', () => { if (room && p && room.cfg.race && p.alive) room.respawnRun(p, 'cp'); });
  socket.on('restart', () => { if (room && p && room.cfg.race && p.alive) room.restartRun(p); });
  socket.on('tolobby', () => {
    if (!room || room.hostId !== p.id || room.phase === 'lobby') return;
    room.phase = 'lobby'; room.nades = []; room.bomb = null; room.drop = null; room.emitLobby();
  });
  socket.on('start', () => {
    if (!room || room.hostId !== p.id || room.phase !== 'lobby') return;
    if (room.cfg.mapMax && room.players.size > room.map.max) return socket.emit('err', `Тази карта е за най-много ${room.map.max} играчи (${room.map.max / 2} срещу ${room.map.max / 2}). Избери по-голяма карта или махни играчи/ботове.`);
    room.startMatch();
  });
  socket.on('loadout', c => {
    if (!room || !p || !c) return;
    const skins = {};
    for (const [k, v] of Object.entries(c.skins || {})) if (WEAPONS[k] || /^knife_[a-z]+$/.test(k)) skins[k.slice(0, 20)] = cleanSkin(v);
    p.cos = { knife: KNIFE_TYPES[c.knife] ? c.knife : 'bayonet', skins, char: cleanChars(c.char) };
    room.emit('cos', { i: p.id, cos: p.cos });
  });
  socket.on('state', s => room && p && room.onState(p, s || {}));
  socket.on('shoot', d => room && p && room.shoot(p, d || {}));
  socket.on('knife', d => room && p && room.knife(p, d || {}));
  socket.on('throw', d => room && p && room.throwNade(p, d || {}));
  socket.on('reload', () => room && p && p.alive && room.reload(p));
  socket.on('switch', s => room && p && ['pr', 'se', 'kn', 'n'].includes(s) && room.switchTo(p, s));
  socket.on('buy', item => room && p && typeof item === 'string' && room.buy(p, item));
  // текстов чат: чист текст (без управляващи знаци), най-много 120 символа, ограничение на честотата; клиентът го показва само чрез textContent
  socket.on('chat', d => {
    if (!room || !p) return;
    const now = Date.now(); if (now - (p.lastChat || 0) < CFG.CHAT_GAP) return;
    const text = String(d?.t ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, CFG.CHAT_MAX);
    if (!text) return; p.lastChat = now;
    const teamOnly = !!d?.team && room.cfg.teams, msg = { id: p.id, n: p.name, tm: p.team, team: teamOnly, t: text };
    if (teamOnly) { for (const q of room.players.values()) if (!q.bot && q.team === p.team) q.socket.emit('chat', msg); }
    else room.emit('chat', msg);
  });
  // гласов чат: сървърът само препраща сигналите (offer/answer/ICE) между хора в една стая; ботовете се игнорират
  socket.on('vc:signal', d => {
    if (!room || !p || typeof d?.to !== 'string') return;
    const to = room.players.get(d.to); if (!to || to.bot || to.id === p.id) return;
    const data = d.data; if (!data || typeof data !== 'object') return;
    let len = 0; try { len = JSON.stringify(data).length; } catch { return; } if (len > 20000) return;
    to.socket.emit('vc:signal', { from: p.id, data });
  });
  // кой говори (за индикатора): в рунд само до съотборниците, иначе до всички
  socket.on('vc:talk', on => {
    if (!room || !p) return; const msg = { id: p.id, on: !!on };
    for (const q of room.players.values()) { if (q.bot || q.id === p.id) continue; if (room.phase !== 'lobby' && room.cfg.teams && q.team !== p.team) continue; q.socket.emit('vc:talk', msg); }
  });
  socket.on('spec', id => { if (p) p.specId = typeof id === 'string' ? id.slice(0, 40) : null; });
  socket.on('takeover', id => { if (room && p && typeof id === 'string') room.takeOver(p, id); });
  socket.on('ready', () => { if (p && !p.ready) { p.ready = true; p.readyAt = Date.now(); } });
  socket.on('use', down => { if (p) { p.using = !!down && p.alive; if (!down || !p.alive) p.useP = 0; } });
  socket.on('dropbomb', () => room && p && room.throwBomb(p));
  socket.on('burst', () => { if (room && p && p.alive && WEAPONS[p.weapon]?.burst) { p.burst = !p.burst; p.bq = null; } });
  socket.on('dropw', () => room && p && room.dropHeld(p));
  socket.on('swap', id => room && p && Number.isInteger(id) && room.swapItem(p, id));
  socket.on('leave', cb => {
    if (room && p) { socket.leave(room.code); room.removePlayer(p.id); room = null; p = null; }
    if (typeof cb === 'function') cb({ ok: true });
  });
  if (TEST) socket.on('dbgKill', () => { if (room && p && p.alive) room.hurt(p, null, 1000, 'bomb', false, { ignoreTeam: true, noArmor: true }); });
  if (TEST) socket.on('dbgKillId', id => { const t = room?.players.get(id); if (t && t.alive) room.hurt(t, p, 1000, t.weapon || 'rifle', true, {}); });
  if (TEST) socket.on('dbgGive', id => { if (room && p && p.alive && WEAPONS[id]) { room.giveWeapon(p, id); room.emit('equip', { i: p.id, w: id }); } });
  if (TEST) socket.on('dbgTp',t => { if (p) { p.x = t.x; p.y = t.y; p.z = t.z; p.hist.push({ t: Date.now(), x: t.x, y: t.y, z: t.z, cr: false }); } });
  socket.on('disconnect', () => { if (room && p) room.removePlayer(p.id); });
});

server.listen(PORT, () => console.log(`BlockStrike слуша на http://localhost:${PORT}  (карти: ${Object.keys(MAPS).join(', ')})`));

export const __test = { Room, MAPS, rooms, io, server };
