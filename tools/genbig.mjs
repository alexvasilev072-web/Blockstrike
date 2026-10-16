// Генератор на големите карти за 5 срещу 5: „Старият град“ (oldtown) и „Индустриален комплекс“ (factory) -> server/maps/*.json
//   node tools/genbig.mjs
// Картата е решетка 12 x 12 клетки по 8 блока (96 x 96). Всяка клетка е тип по буква; генераторът я разгръща в блокове.
// Легенда:  # плътна сграда  b сграда с врати (може да се влезе)  . улица  c купчина щайги  w фонтан (вода)  p платформа със стълби (снайпер)
//           x руини (ниски стени)  A / B бомбена точка  C / S spawn на защитниците / нападателите  K контейнери  T резервоар  r релси  H голям хангар
import { writeMap } from './mapjson.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/maps');
const N = 12, C = 8, SIZE = N * C;

const hash = (x, z, s = 0) => { let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 1274126177); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

class M {
  constructor() { this.ops = []; }
  fill(b, x1, y1, z1, x2, y2, z2) { this.ops.push([b, x1, y1, z1, x2, y2, z2]); }
  set(b, x, y, z) { this.fill(b, x, y, z, x, y, z); }
}

function build(theme, grid, extra = {}) {
  const m = new M(), T = theme, g = (cx, cz) => (cx < 0 || cz < 0 || cx >= N || cz >= N ? '#' : grid[cz][cx]);
  const open = ch => ch === '.' || ch === 'C' || ch === 'S' || ch === 'c' || ch === 'w' || ch === 'x' || ch === 'r' || ch === 'K' || ch === 'T' || ch === 'p' || ch === 'A' || ch === 'B';
  const R = (cx, cz) => ({ x1: cx * C, z1: cz * C, x2: cx * C + C - 1, z2: cz * C + C - 1 });
  // под
  m.fill(T.floor, 0, 0, 0, SIZE - 1, 0, SIZE - 1);
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) { const ch = g(cx, cz), r = R(cx, cz); if (ch === '.' || ch === 'C' || ch === 'S') m.fill(T.street, r.x1, 0, r.z1, r.x2, 0, r.z2); }
  // периметър
  m.fill(T.wall, 0, 1, 0, SIZE - 1, 7, 0); m.fill(T.wall, 0, 1, SIZE - 1, SIZE - 1, 7, SIZE - 1);
  m.fill(T.wall, 0, 1, 0, 0, 7, SIZE - 1); m.fill(T.wall, SIZE - 1, 1, 0, SIZE - 1, 7, SIZE - 1);

  // ---------- по клетки ----------
  const sites = {}; const bbox = {};
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
    const ch = g(cx, cz), r = R(cx, cz), h0 = hash(cx, cz, 1);
    if (ch === 'A' || ch === 'B') { const b = bbox[ch] || (bbox[ch] = { x1: 1e9, z1: 1e9, x2: -1, z2: -1 }); b.x1 = Math.min(b.x1, r.x1); b.z1 = Math.min(b.z1, r.z1); b.x2 = Math.max(b.x2, r.x2); b.z2 = Math.max(b.z2, r.z2); continue; }
    if (ch === '#') {                                           // плътна сграда: височина 4..6, понякога с друг материал
      const h = 4 + Math.floor(h0 * 3), mat = h0 > 0.65 ? T.accent : T.wall;
      m.fill(mat, r.x1, 1, r.z1, r.x2, h, r.z2);
      if (h0 < 0.3) m.fill(T.wall, r.x1, h + 1, r.z1, r.x2, h + 1, r.z2 - 4);    // ниска надстройка
    } else if (ch === 'b') {                                    // сграда с вътрешност: врати към улиците, прозорци към останалите страни
      m.fill(T.wall, r.x1, 1, r.z1, r.x2, 4, r.z2); m.fill('air', r.x1 + 1, 1, r.z1 + 1, r.x2 - 1, 3, r.z2 - 1);
      const sides = [['n', g(cx, cz - 1), r.x1 + 3, r.z1, r.x1 + 4, r.z1], ['s', g(cx, cz + 1), r.x1 + 3, r.z2, r.x1 + 4, r.z2], ['w', g(cx - 1, cz), r.x1, r.z1 + 3, r.x1, r.z1 + 4], ['e', g(cx + 1, cz), r.x2, r.z1 + 3, r.x2, r.z1 + 4]];
      const doors = sides.filter(s => s[1] === '.' || s[1] === 'c' || s[1] === 'x').slice(0, 2);
      for (const d of sides) {
        if (doors.includes(d)) { m.fill('air', d[2] - (d[0] === 'n' || d[0] === 's' ? 1 : 0), 1, d[3] - (d[0] === 'w' || d[0] === 'e' ? 1 : 0), d[4] + (d[0] === 'n' || d[0] === 's' ? 1 : 0), 3, d[5] + (d[0] === 'w' || d[0] === 'e' ? 1 : 0)); }
        else if (open(d[1])) { const [x1, , z1, x2, , z2] = [d[2], 0, d[3], d[4], 0, d[5]]; m.fill('glass', x1, 2, z1, x2, 3, z2); }
      }
      const ox = h0 > 0.5 ? r.x1 + 1 : r.x2 - 2, oz = h0 > 0.25 ? r.z1 + 1 : r.z2 - 2; m.fill(T.crate, ox, 1, oz, ox + 1, 1 + (h0 > 0.7 ? 1 : 0), oz + 1);
    } else if (ch === 'c') {                                    // купчини щайги
      for (let i = 0; i < 3; i++) { const x = r.x1 + 1 + Math.floor(hash(cx, cz, 10 + i) * 5), z = r.z1 + 1 + Math.floor(hash(cx, cz, 20 + i) * 5), h = 1 + Math.floor(hash(cx, cz, 30 + i) * 2); m.fill(T.crate, x, 1, z, Math.min(r.x2 - 1, x + 1), h, Math.min(r.z2 - 1, z + 1)); }
    } else if (ch === 'w') {                                    // фонтан
      m.fill('water', r.x1 + 2, 0, r.z1 + 2, r.x2 - 2, 0, r.z2 - 2); m.fill('stone', r.x1 + 3, 1, r.z1 + 3, r.x1 + 4, 1, r.z1 + 4); m.fill(T.accent, r.x1 + 3, 2, r.z1 + 3, r.x1 + 3, 3, r.z1 + 3);
    } else if (ch === 'x') {                                    // руини: ниски стени с пролуки
      m.fill(T.wall, r.x1 + 1, 1, r.z1 + 1, r.x1 + 5, 2, r.z1 + 1); m.fill(T.wall, r.x1 + 1, 1, r.z1 + 1, r.x1 + 1, 2, r.z1 + 4); m.fill(T.wall, r.x1 + 4, 1, r.z1 + 5, r.x2 - 1, 1, r.z1 + 5); m.fill(T.crate, r.x2 - 2, 1, r.z2 - 2, r.x2 - 1, 2, r.z2 - 1);
    } else if (ch === 'p') {                                    // платформа за снайперист (3 блока) със стълби отдолу
      m.fill(T.wall, r.x1 + 2, 1, r.z1 + 2, r.x2 - 2, 3, r.z2 - 3); m.fill(T.accent, r.x1 + 2, 3, r.z1 + 2, r.x2 - 2, 3, r.z2 - 3);
      m.fill(T.wall, r.x1 + 3, 1, r.z2 - 2, r.x1 + 4, 2, r.z2 - 2); m.fill(T.wall, r.x1 + 3, 1, r.z2 - 1, r.x1 + 4, 1, r.z2 - 1);
      m.fill(T.crate, r.x1 + 2, 4, r.z1 + 2, r.x2 - 2, 4, r.z1 + 2);
    } else if (ch === 'K') {                                    // двор с контейнери: подредени по оста x или z, две височини, едно „стъпало“ за качване
      const cols = ['cont_red', 'cont_blue', 'cont_green', 'cont_yellow'], alongX = hash(cx, cz, 5) > 0.5;
      const place = (ox, oz, len, hgt, col) => { alongX ? m.fill(col, r.x1 + ox, 1, r.z1 + oz, r.x1 + ox + len - 1, hgt, r.z1 + oz + 1) : m.fill(col, r.x1 + oz, 1, r.z1 + ox, r.x1 + oz + 1, hgt, r.z1 + ox + len - 1); };
      place(1, 1, 5, 2, cols[Math.floor(hash(cx, cz, 6) * 4)]); place(2, 5, 5, 1 + Math.floor(hash(cx, cz, 7) * 2), cols[Math.floor(hash(cx, cz, 8) * 4)]);
      place(0, 3, 2, 1, cols[Math.floor(hash(cx, cz, 9) * 4)]);       // стъпало до контейнера
    } else if (ch === 'T') {                                    // резервоар (квадратен) с тръби
      m.fill('metal', r.x1 + 2, 1, r.z1 + 2, r.x1 + 5, 6, r.z1 + 5); m.fill('rust', r.x1 + 2, 4, r.z1 + 2, r.x1 + 5, 4, r.z1 + 5); m.fill('metal', r.x1 + 1, 1, r.z1 + 3, r.x1 + 1, 2, r.z1 + 4);
    } else if (ch === 'r') {                                    // релси
      for (let x = r.x1; x <= r.x2; x++) { m.set('rail', x, 1, r.z1 + 2); m.set('rail', x, 1, r.z1 + 5); }
    }
  }
  // бомбени точки
  const sitesOut = {};
  for (const k of ['A', 'B']) {
    const b = bbox[k], cxm = (b.x1 + b.x2 + 1) / 2, czm = (b.z1 + b.z2 + 1) / 2, sx1 = Math.round(cxm - 5), sz1 = Math.round(czm - 5), sx2 = sx1 + 9, sz2 = sz1 + 9;
    sitesOut[k] = [sx1, sz1, sx2, sz2];
    if (T.hall && k === 'A') {                                  // A е в голям хангар
      m.fill(T.hallWall, b.x1, 1, b.z1, b.x2, 5, b.z2); m.fill('air', b.x1 + 1, 1, b.z1 + 1, b.x2 - 1, 4, b.z2 - 1);
      for (const [x1, z1, x2, z2] of [[b.x2, b.z1 + 4, b.x2, b.z1 + 7], [b.x1 + 4, b.z2, b.x1 + 7, b.z2], [b.x1 + 14, b.z2, b.x1 + 17, b.z2]]) m.fill('air', x1, 1, z1, x2, 4, z2);
      for (const [x1, z1, x2, z2] of [[b.x1 + 3, b.z1, b.x1 + 4, b.z1], [b.x1 + 12, b.z1, b.x1 + 13, b.z1], [b.x1, b.z1 + 4, b.x1, b.z1 + 5]]) m.fill('glass', x1, 3, z1, x2, 4, z2);
      for (const [x, z] of [[b.x1 + 5, b.z1 + 5], [b.x1 + 18, b.z1 + 5], [b.x1 + 5, b.z2 - 5], [b.x1 + 18, b.z2 - 5]]) m.fill('metal', x, 1, z, x, 4, z);
      for (const [x, z] of [[b.x1 + 2, b.z1 + 2], [b.x2 - 4, b.z2 - 4], [b.x1 + 2, b.z2 - 4]]) m.fill(T.crate, x, 1, z, x + 1, 2, z + 1);
      m.fill('lamp', b.x1 + 11, 5, b.z1 + 7, b.x1 + 12, 5, b.z1 + 8);
    } else { for (const [dx, dz] of [[-1, -1], [10, -1], [-1, 10], [10, 10]]) m.fill(T.crate, sx1 + dx + (dx < 0 ? 0 : 0), 1, sz1 + dz, sx1 + dx + 1, 2, sz1 + dz + 1); }
    m.fill('site', sx1, 0, sz1, sx2, 0, sz2); m.fill(T.siteIn, sx1 + 1, 0, sz1 + 1, sx2 - 1, 0, sz2 - 1);
  }
  // осветление/украса
  for (const [x, z] of T.lamps || []) m.fill('lamp', x, 6, z, x, 6, z);
  // spawn-ове: по 6 от всяка страна (средата на ред 0 и ред 11)
  const sx = [38, 42, 46, 50, 54, 58], sp = (z0, z1) => sx.map((x, i) => [x, i % 2 ? z1 : z0]);
  const spawns = { att: sp(90, 92), def: sp(3, 5) };
  for (const zz of [86, 9]) { m.fill(T.crate, 34, 1, zz, 35, 2, zz + 1); m.fill(T.crate, 60, 1, zz, 61, 2, zz + 1); }
  return { size: [SIZE, 12, SIZE], ops: m.ops, spawns, sites: sitesOut, ...extra };
}

// ======================= СТАРИЯТ ГРАД =======================
const OLD = [
  '####CCCC####',
  '#AA......BB#',
  '#AA#b..b#BB#',
  '#..#b..b#..#',
  '#....cwc...#',
  '##.##..##.##',
  '#b.b....b.b#',
  '##.##..##.##',
  '#x...pp...x#',
  '#..##..##..#',
  '#..........#',
  '##..SSSS..##',
];
const oldTown = build({ floor: 'sand', street: 'road', wall: 'sandstone', accent: 'brick', crate: 'crate', siteIn: 'sand', lamps: [[8, 8], [87, 8], [8, 87], [87, 87], [40, 40], [55, 55]] }, OLD, {
  id: 'oldtown', name: 'Старият град',
  description: 'Голям град за 5 срещу 5: три пътя (дълъг запад, среден площад, дълъг изток), две бомбени точки на север, платформа за снайперист в средата.',
  maxPlayers: 10, order: -2, big: true,
  env: { sky: '#8fd0ff', fog: [70, 190], ambient: 0.28, sun: 1, ground: '#b59d6a' },
});

// ======================= ИНДУСТРИАЛЕН КОМПЛЕКС =======================
const FAC = [
  '####CCCC####',
  '#AAA....BBB#',
  '#AAA#..#BBB#',
  '#..K#..#K..#',
  '#.K......K.#',
  '#.K#rrrr#K.#',
  '#...r..r...#',
  '#K.#r..r#.K#',
  '#K...TT...K#',
  '##.#....#.##',
  '#..K....K..#',
  '##..SSSS..##',
];
const factory = build({ floor: 'concrete', street: 'metal', wall: 'concrete', accent: 'rust', crate: 'crate', siteIn: 'concrete', hall: true, hallWall: 'metal', lamps: [[12, 12], [83, 12], [12, 83], [83, 83], [47, 47], [47, 30]] }, FAC, {
  id: 'factory', name: 'Индустриален комплекс',
  description: 'Голям завод за 5 срещу 5: хангар (A), двор с контейнери (B), релси и резервоари в средата. Много ъгли и прикрития.',
  maxPlayers: 10, order: -1, big: true,
  env: { sky: '#9aa7b5', fog: [60, 170], ambient: 0.3, sun: 0.9, ground: '#6f7680' },
});

writeMap(path.join(OUT, 'oldtown.json'), oldTown);
writeMap(path.join(OUT, 'factory.json'), factory);
console.log('Готово: oldtown, factory (96 x 96)');
