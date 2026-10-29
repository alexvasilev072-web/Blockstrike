// Генератор на карти с релеф за 5 срещу 5 -> server/maps/*.json
//   node tools/genterrain.mjs
// Картите са 96 x 96 блока, нарисувани върху мрежа 24 x 24 клетки по 4 блока. Дизайнът е огледално симетричен спрямо оста между двата spawn-а,
// затова точка A и точка B са еднакво трудни по разстояния и подходи; разликите са само в украсата и в прикритията.
// Релефът: всяка клетка има ниво (правоъгълници `levels`), нивата се изглаждат, а където склонът е 1 блок – се слага рампа.
// Легенда: # скала  . земя  A / B бомбени точки  C / S spawn на защитниците / нападателите  c щайги  x камъни  p възвишение  w вдлъбнатина (езерце)
//          h постройка / тунел с покрив  d вход на постройка/тунел (отворът е срещу съседната 'h')
import { writeMap } from './mapjson.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/maps');
const N = 24, CS = 4, SIZE = N * CS, SY = 16;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (x, z, s = 0) => { let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 1274126177); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const vnoise = (x, z, sc, s) => { const fx = x / sc, fz = z / sc, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, a = hash(ix, iz, s), b = hash(ix + 1, iz, s), c = hash(ix, iz + 1, s), d = hash(ix + 1, iz + 1, s), sm = t => t * t * (3 - 2 * t); return (a + (b - a) * sm(tx)) * (1 - sm(tz)) + (c + (d - c) * sm(tx)) * sm(tz); };

// ---------- рисуване на схема ----------
// mode: 'v' – огледално по вертикалната ос (A <-> B); 'd' – по диагонала от NE към SW (A <-> B), за картата с диагонални spawn-ове
class Plan {
  constructor(mode) { this.mode = mode; this.g = Array.from({ length: N }, () => Array(N).fill('#')); this.levels = []; this.covers = []; this.zones = []; }
  swap(ch) { return ch === 'A' ? 'B' : ch === 'B' ? 'A' : ch; }
  mir(c1, r1, c2, r2) { return this.mode === 'v' ? [N - 1 - c2, r1, N - 1 - c1, r2] : [N - 1 - r2, N - 1 - c2, N - 1 - r1, N - 1 - c1]; }
  rect(ch, c1, r1, c2, r2) { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r >= 0 && c >= 0 && r < N && c < N) this.g[r][c] = ch; return this; }
  // рисува и огледалния образ (ключът за A/B е разменен; по диагонала C/S също)
  sym(ch, c1, r1, c2, r2) { this.rect(ch, c1, r1, c2, r2); const [a, b, c, d] = this.mir(c1, r1, c2, r2); this.rect(this.swap(ch), a, b, c, d); return this; }
  lvl(c1, r1, c2, r2, l) { this.levels.push([c1, r1, c2, r2, l]); const [a, b, c, d] = this.mir(c1, r1, c2, r2); this.levels.push([a, b, c, d, l]); return this; }
  lvl1(c1, r1, c2, r2, l) { this.levels.push([c1, r1, c2, r2, l]); return this; }
  zone(name, c1, r1, c2, r2) { this.zones.push([name, c1, r1, c2, r2]); return this; }
  zoneSym(n1, n2, c1, r1, c2, r2) { this.zones.push([n1, c1, r1, c2, r2]); const [a, b, c, d] = this.mir(c1, r1, c2, r2); this.zones.push([n2 || n1, a, b, c, d]); return this; }
}

function build(plan, cfg) {
  const T = cfg.theme, grid = plan.g, g = (cx, cz) => (cx < 0 || cz < 0 || cx >= N || cz >= N ? '#' : grid[cz][cx]);
  const cellLevel = (cx, cz) => {
    const ch = g(cx, cz); let l = cfg.baseLevel ?? 1;
    for (const [c1, r1, c2, r2, v] of plan.levels) if (cx >= c1 && cx <= c2 && cz >= r1 && cz <= r2) l = v;
    if (ch === 'p') l += 2; if (ch === 'w') l -= 2;
    if (ch === 'A' || ch === 'B') l = cfg.siteLv; if (ch === 'C') l = cfg.spawnLv.def; if (ch === 'S') l = cfg.spawnLv.att;
    return clamp(l, 0, 6);
  };
  const flatCell = ch => 'ABCShd'.includes(ch);
  const H = new Float32Array(SIZE * SIZE), open = new Uint8Array(SIZE * SIZE), flat = new Uint8Array(SIZE * SIZE), id = (x, z) => z * SIZE + x;
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), ch = g(cx, cz);
    if (ch === '#') continue;
    open[id(x, z)] = 1; H[id(x, z)] = cellLevel(cx, cz); if (flatCell(ch)) flat[id(x, z)] = 1;
  }
  for (let pass = 0; pass < 3; pass++) {
    const src = H.slice();
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      if (!open[id(x, z)]) continue; let s = 0, n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= SIZE || zz >= SIZE || !open[id(xx, zz)]) continue; s += src[id(xx, zz)]; n++; }
      H[id(x, z)] = s / n;
    }
  }
  const S = new Int16Array(SIZE * SIZE), top = new Array(SIZE * SIZE), body = new Array(SIZE * SIZE);
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const i = id(x, z), cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    if (!open[i]) {
      const n = vnoise(x, z, 6, 5), edge = x === 0 || z === 0 || x === SIZE - 1 || z === SIZE - 1;
      S[i] = edge ? 11 : 8 + Math.floor(n * 3 + hash(x, z, 6) * 0.9); top[i] = hash(x, z, 7) < 0.15 ? T.rockAlt : T.rock; body[i] = T.rockBody; continue;
    }
    let h = H[i]; if (flat[i]) h = cellLevel(cx, cz); else h += (vnoise(x, z, 8, 1) - 0.5) * 0.6;
    S[i] = clamp(Math.round(h), 0, 7);
    const n = vnoise(x, z, 5, 3);
    top[i] = T.ground[Math.min(T.ground.length - 1, Math.floor(n * T.ground.length * 0.999))]; if (hash(x, z, 4) < T.patchP) top[i] = T.patch; body[i] = T.body;
  }
  const m = [], fill = (b, x1, y1, z1, x2, y2, z2) => m.push([b, x1, y1, z1, x2, y2, z2]), set = (b, x, y, z) => fill(b, x, y, z, x, y, z);
  for (let z = 0; z < SIZE; z++) {
    let x = 0;
    while (x < SIZE) {
      let x2 = x; const k = xx => S[id(xx, z)] + '|' + top[id(xx, z)] + '|' + body[id(xx, z)];
      while (x2 + 1 < SIZE && k(x2 + 1) === k(x)) x2++;
      const s = S[id(x, z)]; if (s > 0) fill(body[id(x, z)], x, 0, z, x2, s - 1, z); fill(top[id(x, z)], x, s, z, x2, s, z); x = x2 + 1;
    }
  }
  // рампи
  const DIRS = [['e', 1, 0], ['w', -1, 0], ['s', 0, 1], ['n', 0, -1]], hasWedge = new Set();
  for (let z = 1; z < SIZE - 1; z++) for (let x = 1; x < SIZE - 1; x++) {
    const i = id(x, z); if (!open[i] || flat[i]) continue;
    for (const [d, dx, dz] of DIRS) { const j = id(x + dx, z + dz); if (open[j] && S[j] === S[i] + 1) { set('ramp_' + d, x, S[i] + 1, z); hasWedge.add(i); break; } }
  }
  const surf = (x, z) => S[id(clamp(x, 0, SIZE - 1), clamp(z, 0, SIZE - 1))];
  // бомбени точки (по клетките A / B)
  const sites = {}, bbox = {};
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) { const ch = g(cx, cz); if (ch === 'A' || ch === 'B') { const b = bbox[ch] || (bbox[ch] = { x1: 1e9, z1: 1e9, x2: -1, z2: -1 }); b.x1 = Math.min(b.x1, cx * CS); b.z1 = Math.min(b.z1, cz * CS); b.x2 = Math.max(b.x2, cx * CS + CS - 1); b.z2 = Math.max(b.z2, cz * CS + CS - 1); } }
  const siteCenters = {};
  for (const k of ['A', 'B']) {
    const b = bbox[k], cxm = (b.x1 + b.x2 + 1) / 2, czm = (b.z1 + b.z2 + 1) / 2, sx1 = Math.round(cxm - 5), sz1 = Math.round(czm - 5), sx2 = sx1 + 9, sz2 = sz1 + 9;
    sites[k] = [sx1, sz1, sx2, sz2]; siteCenters[k] = [cxm, czm]; const lv = cfg.siteLv;
    fill('site', sx1, lv, sz1, sx2, lv, sz2); fill(T.siteIn, sx1 + 1, lv, sz1 + 1, sx2 - 1, lv, sz2 - 1);
  }
  // прикритие на точките: стени и колони, зададени от плана (в блокове, спрямо центъра на точката; за B се огледалят)
  for (const [k, list] of [['A', cfg.cover.A], ['B', cfg.cover.B]]) {
    const [cx, cz] = siteCenters[k], lv = cfg.siteLv;
    for (const [dx1, dz1, dx2, dz2, h, mat] of list) fill(mat || T.cover, Math.round(cx + dx1), lv + 1, Math.round(cz + dz1), Math.round(cx + dx2), lv + h, Math.round(cz + dz2));
  }
  // постройки: 'h' (покрив) и 'd' (вход)
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
    const ch = g(cx, cz); if (ch !== 'h' && ch !== 'd') continue;
    const x1 = cx * CS, z1 = cz * CS, x2 = x1 + CS - 1, z2 = z1 + CS - 1, lv = cellLevel(cx, cz);
    const side = [['n', 0, -1], ['s', 0, 1], ['w', -1, 0], ['e', 1, 0]];
    for (const [s, dx, dz] of side) {
      const nb = g(cx + dx, cz + dz); let wall = false;
      if (ch === 'h') wall = nb !== '#' && nb !== 'h' && nb !== 'd';
      else if (nb !== '#' && nb !== 'h' && nb !== 'd') { const opp = g(cx - dx, cz - dz); wall = !(opp === 'h'); }      // отворът на входа е срещу вътрешността
      if (!wall) continue;
      const wx1 = s === 'e' ? x2 : x1, wx2 = s === 'w' ? x1 : x2, wz1 = s === 's' ? z2 : z1, wz2 = s === 'n' ? z1 : z2;
      fill(T.wall, wx1, lv + 1, wz1, wx2, lv + 3, wz2);
      if (ch === 'h' && hash(cx, cz, 70 + dx * 3 + dz) < 0.35) { const mx = s === 'n' || s === 's' ? x1 + 1 : wx1, mz = s === 'w' || s === 'e' ? z1 + 1 : wz1; fill('glass', mx, lv + 2, mz, s === 'n' || s === 's' ? x1 + 2 : wx1, lv + 2, s === 'w' || s === 'e' ? z1 + 2 : wz1); }
    }
    if (ch === 'h' && T.roof) fill(T.wall, x1, lv + 4, z1, x2, lv + 4, z2); else if (ch === 'd') fill(T.wall, x1, lv + 3, z1, x2, lv + 3, z2);
  }
  // щайги, камъни, езерце
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
    const ch = g(cx, cz), x1 = cx * CS, z1 = cz * CS;
    if (ch === 'c') for (let i = 0; i < 2; i++) { const x = x1 + Math.floor(hash(cx, cz, 10 + i) * 3), z = z1 + Math.floor(hash(cx, cz, 20 + i) * 3), hh = 1 + Math.floor(hash(cx, cz, 30 + i) * 2), s = surf(x, z); fill(T.crate, x, s + 1, z, x + 1, s + hh, z + 1); }
    else if (ch === 'x') for (let i = 0; i < 3; i++) { const x = x1 + Math.floor(hash(cx, cz, 40 + i) * 3), z = z1 + Math.floor(hash(cx, cz, 50 + i) * 3), s = surf(x, z), hh = 1 + Math.floor(hash(cx, cz, 60 + i) * 2); fill(T.rock, x, s + 1, z, x + (i % 2), s + hh, z + ((i + 1) % 2)); }
    else if (ch === 'w' && T.water) { const lv = cellLevel(cx, cz); for (let z = z1; z < z1 + CS; z++) for (let x = x1; x < x1 + CS; x++) if (surf(x, z) <= lv) set('water', x, surf(x, z), z); }
  }
  // дървета и камъни по свободния терен
  for (let z = 3; z < SIZE - 3; z++) for (let x = 3; x < SIZE - 3; x++) {
    const i = id(x, z); if (!open[i] || flat[i] || hasWedge.has(i)) continue;
    const r = hash(x, z, 77), s = S[i];
    if (T.trees && r < T.trees && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => S[id(x + dx, z + dz)] === s && open[id(x + dx, z + dz)])) {
      const hgt = 3 + Math.floor(hash(x, z, 78) * 2); fill('wood', x, s + 1, z, x, s + hgt, z); fill(T.leaf, x - 1, s + hgt, z - 1, x + 1, s + hgt + 1, z + 1); set(T.leaf, x, s + hgt + 2, z);
    } else if (r > 0.996 - (T.rocks || 0.004)) fill(T.rock, x, s + 1, z, x + 1, s + 1 + Math.floor(hash(x, z, 79) * 2), z + 1);
  }
  // spawn-ове: шест точки равномерно в клетките C / S
  const cells = ch => { const l = []; for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) if (g(cx, cz) === ch) l.push([cx * CS + 2, cz * CS + 2]); return l; };
  const pick = (l, lv) => { const out = []; for (let i = 0; i < 6; i++) { const p = l[Math.floor((i + 0.5) * l.length / 6)]; out.push([p[0] + (i % 2 ? 1 : 0), p[1], lv]); } return out; };
  const spawns = { att: pick(cells('S'), cfg.spawnLv.att + 1), def: pick(cells('C'), cfg.spawnLv.def + 1) };
  return { size: [SIZE, SY, SIZE], ops: m, spawns, sites, zones: plan.zones.map(([n, c1, r1, c2, r2]) => [n, c1 * CS, r1 * CS, c2 * CS + CS, r2 * CS + CS]), ...cfg.extra };
}

// ======================= ПУСТИНЕН КАНЬОН (огледална по вертикалата) =======================
// A (запад) и B (изток) са по две стени-ъгли във високата част; защитниците са на горната тераса в средата, нападателите долу.
// Три пътя за нападателите: западна/източна алея към своята точка и среден плато с два свързващи прохода (към алеите), всеки със завой.
function canyonPlan() {
  const p = new Plan('v');
  p.rect('C', 9, 0, 14, 1); p.rect('.', 10, 2, 13, 8);                      // спаун на защитниците и спускане към средата
  p.sym('A', 2, 2, 5, 5);                                                   // точки A и B
  p.sym('.', 6, 3, 9, 4);                                                   // горен проход от спауна на защитниците към точката
  // алея на зигзаг: нагоре към точката през два завоя; вътре в нея се влива проходът от платото
  p.sym('.', 3, 6, 4, 8); p.sym('.', 3, 9, 6, 10); p.sym('.', 5, 11, 6, 13); p.sym('.', 3, 14, 6, 15); p.sym('.', 3, 16, 4, 18);
  p.rect('.', 8, 9, 15, 14);                                                // среден плато
  p.sym('.', 7, 11, 7, 12);                                                 // свързващ проход плато <-> алея
  p.rect('.', 10, 15, 13, 19);                                              // път плато -> долна зона
  p.rect('.', 3, 19, 20, 21); p.rect('S', 8, 22, 15, 23);                   // долна зона и спаун на нападателите
  p.sym('d', 3, 16, 4, 16); p.sym('h', 3, 17, 4, 17); p.sym('d', 3, 18, 4, 18);   // тунел с покрив при изхода на алеята
  p.sym('x', 6, 9, 6, 9); p.rect('x', 10, 11, 10, 12); p.rect('x', 13, 10, 13, 11); p.rect('p', 11, 11, 12, 12); p.rect('c', 9, 16, 9, 16); p.rect('c', 14, 16, 14, 16);
  p.sym('x', 5, 20, 5, 20); p.sym('c', 7, 20, 7, 20); p.sym('x', 4, 14, 4, 14);
  p.lvl1(0, 0, 23, 23, 1);
  p.lvl(3, 14, 6, 18, 1); p.lvl(3, 9, 6, 13, 2); p.lvl(3, 6, 4, 8, 3); p.lvl1(8, 9, 15, 14, 2); p.lvl(7, 11, 7, 12, 2); p.lvl1(10, 2, 13, 8, 3); p.lvl(6, 3, 9, 4, 3); p.lvl1(9, 0, 14, 1, 4);
  p.zoneSym('Точка A', 'Точка B', 2, 2, 5, 5).zone('Лагер на защитниците', 9, 0, 14, 1).zoneSym('Горен проход към A', 'Горен проход към B', 6, 3, 9, 4)
    .zone('Спускане към средата', 10, 2, 13, 8).zoneSym('Западна алея', 'Източна алея', 3, 6, 4, 8).zoneSym('Западен завой', 'Източен завой', 3, 9, 6, 15)
    .zoneSym('Западен тунел', 'Източен тунел', 3, 16, 4, 18).zone('Среден плато', 8, 9, 15, 14).zoneSym('Западен проход', 'Източен проход', 7, 11, 7, 12)
    .zone('Път към средата', 10, 15, 13, 19).zone('Долна зона', 3, 19, 20, 21).zone('Лагер на нападателите', 8, 22, 15, 23);
  return p;
}
const canyon = build(canyonPlan(), {
  siteLv: 3, spawnLv: { def: 4, att: 1 }, baseLevel: 1,
  theme: { ground: ['sand', 'sand', 'gravel'], patch: 'gravel', patchP: 0.02, body: 'sandstone', rock: 'sandstone', rockAlt: 'rust', rockBody: 'sandstone', wall: 'sandstone', crate: 'crate', cover: 'sandstone', siteIn: 'sand', roof: true, rocks: 0.004 },
  // прикритие около точките: стени, които закриват мястото за залагане (центъра) от подходите; A е огледален на B
  cover: {
    A: [[5, -3, 6, 3, 3], [-3, 5, 3, 6, 3], [-6, -6, -5, -5, 2, 'crate'], [-1, -1, 0, 0, 1, 'crate']],
    B: [[-6, -3, -5, 3, 3], [-3, 5, 3, 6, 3], [5, -6, 6, -5, 2, 'crate'], [-1, -1, 0, 0, 1, 'crate']],
  },
  extra: {
    id: 'canyon', name: 'Пустинен каньон', maxPlayers: 10, order: 0, big: true,
    description: 'Пустинна карта с релеф за 5 срещу 5: високи скали, склонове и рампи. Две огледални точки, западна и източна алея с тунели, среден плато и горна тераса за защитниците.',
    env: { sky: '#8fd0ff', fog: [75, 200], ambient: 0.3, sun: 1, ground: '#c2ab74' },
  },
});

// ======================= ПЛАНИНА И ГОРА (огледална по диагонала) =======================
// Защитниците са на североизток, нападателите на югозапад; A е на северозапад, B – на югоизток (огледални точки).
function mountainPlan() {
  const p = new Plan('d');
  p.rect('C', 14, 5, 18, 9); p.rect('S', 1, 18, 5, 22);                      // спауните лежат върху диагонала (сами себе си огледални)
  p.sym('A', 2, 2, 5, 5);                                                    // A (NW) <-> B (SE)
  p.sym('.', 6, 3, 15, 4);                                                   // северен път от защитниците към A  <->  южен/източен път към B
  p.sym('.', 3, 6, 4, 8); p.sym('.', 3, 9, 8, 10); p.sym('.', 7, 11, 8, 12); p.sym('.', 3, 13, 8, 14); p.sym('.', 3, 15, 4, 17);   // път на нападателите към A (и огледален към B) със завои
  p.sym('.', 14, 4, 15, 5);                                                  // връзка на спауна на защитниците с пътя
  p.rect('.', 8, 8, 15, 15); p.rect('w', 11, 11, 12, 12);                    // средна поляна с езерце
  p.sym('.', 11, 5, 12, 7);                                                  // от северния път към поляната
  p.sym('.', 6, 5, 7, 8);                                                     // трети подход: от ъгъла на поляната към точката
  p.sym('d', 3, 15, 4, 15); p.sym('h', 3, 16, 4, 16); p.sym('d', 3, 17, 4, 17);   // руини-тунел по пътя към точката
  p.rect('x', 9, 9, 9, 9); p.rect('x', 14, 14, 14, 14); p.rect('p', 8, 14, 9, 15); p.rect('p', 14, 8, 15, 9); p.sym('c', 12, 5, 12, 5);
  p.lvl1(0, 0, 23, 23, 2);
  p.lvl1(14, 5, 18, 9, 4); p.lvl1(1, 18, 5, 22, 1); p.lvl(2, 2, 5, 5, 3);
  p.lvl(6, 3, 15, 4, 3); p.lvl(3, 6, 4, 8, 3); p.lvl(3, 9, 8, 17, 2); p.lvl1(8, 8, 15, 15, 2);
  p.zoneSym('Точка A', 'Точка B', 2, 2, 5, 5).zone('Лагер на защитниците', 14, 5, 18, 9).zone('Лагер на нападателите', 1, 18, 5, 22)
    .zoneSym('Северен път', 'Южен път', 6, 3, 15, 4).zoneSym('Западен път', 'Южен път', 3, 6, 8, 14).zoneSym('Руините на запад', 'Руините на юг', 3, 15, 4, 17)
    .zone('Горска поляна', 8, 8, 15, 15);
  return p;
}
const mountain = build(mountainPlan(), {
  siteLv: 3, spawnLv: { def: 4, att: 1 }, baseLevel: 2,
  theme: { ground: ['grass', 'grass', 'dirt'], patch: 'dirt', patchP: 0.04, body: 'dirt', rock: 'stone', rockAlt: 'cobble', rockBody: 'stone', wall: 'cobble', crate: 'crate', cover: 'cobble', siteIn: 'gravel', roof: false, trees: 0.01, leaf: 'grass', rocks: 0.006, water: true },
  cover: {
    A: [[5, -3, 6, 3, 3], [-3, 5, 3, 6, 3], [-6, -6, -5, -5, 2, 'crate'], [-1, -1, 0, 0, 1, 'crate']],
    B: [[-6, -3, -5, 3, 3], [-3, -6, 3, -5, 3], [5, 5, 6, 6, 2, 'crate'], [-1, -1, 0, 0, 1, 'crate']],
  },  extra: {
    id: 'mountain', name: 'Планина и гора', maxPlayers: 10, order: 1, big: true, minRoutes: 2,
    description: 'Планинска карта за 5 срещу 5: гора, езерце, руини-тунели и склонове. Защитниците са на североизток, нападателите на югозапад, а точките са огледални – A на северозапад, B на югоизток.',
    env: { sky: '#a6d8ff', fog: [70, 190], ambient: 0.3, sun: 1, ground: '#6f8a4a' },
  },
});

// ======================= КАРИЕРА (огледална по вертикалата, с яма) =======================
function quarryPlan() {
  const p = new Plan('v');
  p.rect('C', 9, 0, 14, 1); p.rect('.', 10, 2, 13, 5);
  p.sym('A', 2, 2, 5, 5);
  p.sym('.', 6, 3, 9, 4);                                                   // от защитниците към терасите
  p.sym('.', 2, 6, 5, 8);                                                   // южна тераса пред точката
  p.sym('.', 4, 9, 5, 17);                                                  // рампи по краищата на ямата надолу
  p.rect('.', 8, 6, 15, 17); p.rect('w', 11, 11, 12, 12);                   // голяма яма в средата
  p.rect('.', 3, 18, 20, 21); p.rect('S', 8, 22, 15, 23);
  p.rect('.', 10, 18, 13, 19);
  p.sym('d', 6, 12, 6, 12); p.sym('h', 7, 12, 7, 12);                      // кабини на ръба на ямата
  p.sym('c', 7, 8, 7, 8); p.sym('x', 6, 15, 6, 15); p.rect('x', 10, 8, 10, 8); p.rect('x', 13, 15, 13, 15); p.rect('c', 9, 20, 9, 20); p.rect('c', 14, 20, 14, 20);
  p.lvl1(0, 0, 23, 23, 2);
  p.lvl1(9, 0, 14, 1, 4); p.lvl1(10, 2, 13, 5, 4); p.lvl(2, 2, 5, 5, 4); p.lvl(6, 3, 9, 4, 4);
  p.lvl(2, 6, 5, 8, 3); p.lvl(4, 9, 5, 17, 2); p.lvl1(8, 6, 15, 17, 0); p.lvl1(3, 18, 20, 21, 1);
  p.zoneSym('Точка A', 'Точка B', 2, 2, 5, 5).zone('Лагер на защитниците', 9, 0, 14, 1).zoneSym('Горен проход към A', 'Горен проход към B', 6, 3, 9, 4)
    .zone('Горна рампа', 10, 2, 13, 5).zoneSym('Западна тераса', 'Източна тераса', 2, 6, 5, 8).zoneSym('Западна рампа', 'Източна рампа', 4, 9, 5, 17)
    .zone('Голямата яма', 8, 6, 15, 17).zone('Изход от ямата', 10, 18, 13, 19).zone('Долна зона', 3, 18, 20, 21).zone('Лагер на нападателите', 8, 22, 15, 23);
  return p;
}
const quarry = build(quarryPlan(), {
  siteLv: 4, spawnLv: { def: 4, att: 1 }, baseLevel: 2,
  theme: { ground: ['gravel', 'gravel', 'dirt'], patch: 'stone', patchP: 0.04, body: 'stone', rock: 'stone', rockAlt: 'concrete', rockBody: 'stone', wall: 'concrete', crate: 'crate', cover: 'concrete', siteIn: 'concrete', roof: true, rocks: 0.006, water: true },
  cover: {
    A: [[5, -3, 6, 3, 3], [-3, 5, 3, 6, 3], [-6, -6, -5, -5, 2, 'crate'], [-1, -1, 0, 0, 1, 'crate']],
    B: [[-6, -3, -5, 3, 3], [-3, 5, 3, 6, 3], [5, -6, 6, -5, 2, 'crate'], [-1, -1, 0, 0, 1, 'crate']],
  },
  extra: {
    id: 'quarry', name: 'Кариера', maxPlayers: 10, order: 2, big: true,
    description: 'Кариера за 5 срещу 5: огромна яма в средата, високи тераси със точките на ръбовете и две дълги рампи надолу. Защитниците са горе, нападателите долу.',
    env: { sky: '#9db7d3', fog: [65, 180], ambient: 0.28, sun: 0.95, ground: '#7c7468' },
  },
});

writeMap(path.join(OUT, 'canyon.json'), canyon);
writeMap(path.join(OUT, 'mountain.json'), mountain);
writeMap(path.join(OUT, 'quarry.json'), quarry);
console.log('Готово: canyon, mountain, quarry (96 x 96 x 16)');
