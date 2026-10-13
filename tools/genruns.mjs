// Генератор на parkour и surf картите -> server/maps/*.json
//   node tools/genruns.mjs
// Всеки скок се проверява балистично (assertHop): най-големият допустим процеп зависи от разликата във височината.
import { writeMap } from './mapjson.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/maps');
const G = 20, JUMP = 7.55, RUN = 6.25;

class B {
  constructor() { this.ops = []; this.route = []; }
  fill(b, x1, y1, z1, x2, y2, z2) { this.ops.push([b, x1, y1, z1, x2, y2, z2]); }
  set(b, x, y, z) { this.fill(b, x, y, z, x, y, z); }
  // платформа: блокове на y..y+h-1; краката са на y+h
  plat(x, y, z, w, d, block = 'stone', h = 1, tag = null) {
    this.fill(block, x, y, z, x + w - 1, y + h - 1, z + d - 1);
    const p = { x, z, w, d, top: y + h, tag };
    this.route.push(p); return p;
  }
}

// Колко най-много блока процеп се прескача от a до b (дясно и надясно), при скорост vh. Хоризонтално разстояние между правоъгълниците.
function rectGap(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), dz = Math.max(0, Math.max(a.z, b.z) - Math.min(a.z + a.d, b.z + b.d));
  return Math.hypot(dx, dz);
}
function maxGap(dy, vh = RUN) {
  const disc = JUMP * JUMP - 2 * G * dy; if (disc < 0) return -1;
  const t = (JUMP + Math.sqrt(disc)) / G;
  return vh * t - 0.6;                  // център-до-център минус двете половини на кутията
}
function assertHop(a, b, margin, name, speedMul = 1) {
  const gap = rectGap(a, b), dy = b.top - a.top, lim = maxGap(dy, RUN * speedMul);
  if (dy > 1.2) throw new Error(`${name}: твърде голям скок нагоре (${dy})`);
  if (gap > lim - margin) throw new Error(`${name}: процеп ${gap.toFixed(2)} > допустим ${(lim - margin).toFixed(2)} (dy=${dy})`);
}
function chain(route, margin, name, skip = new Set()) {
  for (let i = 1; i < route.length; i++) if (!skip.has(i)) assertHop(route[i - 1], route[i], margin, `${name} #${i}`);
}
const rep = (m) => ({ ...m, spawns: { att: m.spawns.att, def: m.spawns.att } });
const LAVA_ENV = { sky: '#2a1a40', fogColor: '#3a1c30', fog: [50, 150], ambient: 0.5, sun: 0.9, ground: '#d04a10' };
const YAW_E = -Math.PI / 2;            // поглед към +x

// ============================ PARKOUR: ЛЕСЕН ============================
const SPAWNS = Y => [[3, 19, Y + 1], [4, 19, Y + 1], [5, 19, Y + 1], [3, 21, Y + 1], [4, 21, Y + 1], [5, 21, Y + 1]];
function pEasy() {
  const b = new B(); const S = [66, 14, 40], Y = 3, route = [];
  b.fill('lava', 0, 0, 0, S[0] - 1, 0, S[2] - 1);
  route.push(b.plat(2, Y, 17, 6, 6, 'startpad'));
  route.push(b.plat(10, Y, 19, 3, 3, 'stone'));            // процеп 2
  route.push(b.plat(15, Y, 19, 3, 3, 'stone'));
  route.push(b.plat(20, Y + 1, 19, 3, 3, 'stone'));        // +1 нагоре
  route.push(b.plat(25, Y + 1, 20, 2, 2, 'stone'));
  route.push(b.plat(29, Y + 1, 18, 5, 5, 'checkpoint'));   // checkpoint 1
  route.push(b.plat(36, Y + 1, 22, 3, 3, 'stone'));
  route.push(b.plat(41, Y + 1, 26, 3, 3, 'stone'));
  route.push(b.plat(46, Y + 1, 26, 3, 3, 'stone'));
  route.push(b.plat(51, Y + 1, 24, 5, 5, 'checkpoint'));   // checkpoint 2
  route.push(b.plat(58, Y + 1, 25, 4, 4, 'finish'));
  chain(route, 0.8, 'p_easy');
  return rep({
    id: 'p_easy', name: 'Parkour: Лесен', level: 'Лесен', order: 1, mode: 'parkour', description: 'Скокове между блокове над лава. Процепи до 2 блока и 2 checkpoint-а.',
    size: S, env: LAVA_ENV, ops: b.ops, start: [2, 17, 7, 22], startY: 8, startYaw: YAW_E, spawns: { att: SPAWNS(Y) }, sites: {}, route: route.map(p => [p.x, p.z, p.w, p.d, p.top]),
  });
}

// ============================ PARKOUR: СРЕДЕН ============================
function pMedium() {
  const b = new B(); const S = [86, 18, 40], Y = 3, route = [];
  b.fill('lava', 0, 0, 0, S[0] - 1, 0, S[2] - 1);
  route.push(b.plat(2, Y, 17, 6, 6, 'startpad'));
  route.push(b.plat(9, Y, 20, 16, 1, 'planks'));               // тясна греда (1 блок)
  route.push(b.plat(27, Y, 18, 4, 5, 'checkpoint'));
  for (let i = 0; i < 4; i++) route.push(b.plat(32 + i * 3, Y + 1 + i, 19, 2, 3, 'brick'));   // стълби: +1 на стъпка
  route.push(b.plat(44, Y + 4, 20, 8, 1, 'planks'));           // тясна греда горе
  route.push(b.plat(54, Y + 4, 18, 4, 5, 'checkpoint'));
  const A = b.plat(60, Y + 4, 19, 3, 3, 'concrete'), Bp = b.plat(65, Y + 5, 19, 3, 3, 'concrete'), C = b.plat(70, Y + 5, 19, 3, 3, 'concrete');
  route.push(A, Bp, C);
  const fin = b.plat(75, Y + 5, 18, 5, 5, 'finish'); route.push(fin);
  // нисък таван над скоковете: изправен играч удря главата в апекса, клекнал минава (тавана е на 3 блока над краката)
  b.fill('stone', 61, A.top + 3, 17, 67, A.top + 3, 23);
  b.fill('stone', 68, Bp.top + 3, 17, 73, Bp.top + 3, 23);
  chain(route, 0.8, 'p_medium');
  return rep({
    id: 'p_medium', name: 'Parkour: Среден', level: 'Среден', order: 2, mode: 'parkour', description: 'Тесни греди, стълби и скокове с клякане под нисък таван.',
    size: S, env: LAVA_ENV, ops: b.ops, start: [2, 17, 7, 22], startY: 8, startYaw: YAW_E, spawns: { att: SPAWNS(Y) }, sites: {}, route: route.map(p => [p.x, p.z, p.w, p.d, p.top]),
  });
}

// ============================ PARKOUR: ТРУДЕН ============================
function pHard() {
  const b = new B(); const S = [100, 24, 44], Y = 3, route = [];
  b.fill('lava', 0, 0, 0, S[0] - 1, 0, S[2] - 1);
  route.push(b.plat(2, Y, 17, 6, 6, 'startpad'));
  route.push(b.plat(12, Y, 19, 3, 3, 'stone'), b.plat(19, Y, 19, 3, 3, 'stone'), b.plat(26, Y, 19, 3, 3, 'stone'));   // скокове на 4 блока
  const cp1 = b.plat(33, Y, 18, 4, 5, 'checkpoint'); route.push(cp1);
  const ice = b.plat(37, Y, 19, 10, 3, 'slick'); route.push(ice);                // плъзгащ лед
  const slime = b.plat(51, Y, 19, 3, 3, 'slime'); route.push(slime);             // слуз: ~4.2 м отскок
  const high = b.plat(57, Y + 4, 19, 3, 3, 'stone');
  const cp2 = b.plat(61, Y + 4, 18, 3, 5, 'checkpoint');
  const mid = b.plat(76, Y + 4, 18, 4, 5, 'checkpoint');
  const fin = b.plat(86, Y + 4, 18, 6, 5, 'finish');
  const platforms = [
    { size: [3, 1, 3], from: [65, Y + 4, 19], to: [72, Y + 4, 19], period: 8, block: 'metal' },
    { size: [3, 1, 3], from: [81, Y + 4, 12], to: [81, Y + 4, 26], period: 9, block: 'metal', phase: 2 },
  ];
  assertHop(route[0], route[1], 0.0, 'start->1', 1.1); assertHop(route[1], route[2], 0.0, '1->2', 1.1); assertHop(route[2], route[3], 0.0, '2->3', 1.1);
  assertHop(route[3], cp1, 0.0, '3->cp1', 1.1); assertHop(ice, slime, 0.0, 'ice->slime', 1.1);
  if (65 - (cp2.x + cp2.w) > 2.5 || 76 - (72 + 3) > 2.5 || 81 - (mid.x + mid.w) > 2.5 || fin.x - (81 + 3) > 2.5) throw new Error('p_hard: движещите се платформи са твърде далеч');
  void high;
  return rep({
    id: 'p_hard', name: 'Parkour: Труден', level: 'Труден', order: 3, mode: 'parkour', description: 'Скокове на 4 блока, плъзгащ лед, слуз и движещи се платформи.',
    size: S, env: LAVA_ENV, ops: b.ops, start: [2, 17, 7, 22], startY: 8, startYaw: YAW_E, platforms, spawns: { att: SPAWNS(Y) }, sites: {}, slimeHop: [slime.x, slime.z, high.x, high.z, high.top], route: route.map(p => [p.x, p.z, p.w, p.d, p.top]),
  });
}

// ============================ SURF ============================
// Долина от две рампи (63°: двойка surf_lo / surf_hi), които растат навън. xl = колоната до процепа на лявата рампа (расте към -x),
// xr = колоната до процепа на дясната (расте към +x). Подпорите отдолу не са нужни – рампата е твърда под повърхността си.
function valley(b, { xl, xr, z0, z1, H0, cols, left = true, right = true }) {
  for (let i = 0; i < cols; i++) {
    if (left) { b.fill('surf_lo_w', xl - i, H0 + 2 * i, z0, xl - i, H0 + 2 * i, z1); b.fill('surf_hi_w', xl - i, H0 + 2 * i + 1, z0, xl - i, H0 + 2 * i + 1, z1); }
    if (right) { b.fill('surf_lo_e', xr + i, H0 + 2 * i, z0, xr + i, H0 + 2 * i, z1); b.fill('surf_hi_e', xr + i, H0 + 2 * i + 1, z0, xr + i, H0 + 2 * i + 1, z1); }
  }
}
const SURF_ENV = { sky: '#8fd2ff', fogColor: '#bfe3ff', fog: [90, 260], ambient: 0.5, sun: 1, ground: '#2a5a90' };

function sEasy() {
  const b = new B(); const S = [36, 44, 140];
  const H0 = 8, cols = 10, top = H0 + 2 * cols, xl = 14, xr = 21, z0 = 12, z1 = 132;
  valley(b, { xl, xr, z0, z1, H0, cols });
  // борд: ляв перваз (старт) и десен перваз (финал); стени навън
  const lx1 = 2, lx2 = xl - cols;            // ляв перваз x=2..4
  const rx1 = xr + cols, rx2 = 33;
  b.fill('concrete', lx1, top - 1, 2, lx2, top - 1, z1); b.fill('concrete', rx1, top - 1, 2, rx2, top - 1, z1);
  b.fill('concrete', 0, H0, 0, 1, top + 8, z1 + 6); b.fill('concrete', 34, H0, 0, 35, top + 8, z1 + 6);
  b.fill('concrete', 0, top - 1, z1 + 1, 35, top + 8, z1 + 6);
  b.fill('startpad', lx1, top - 1, 2, lx2, top - 1, 9);
  for (const z of [42, 84]) b.fill('checkpoint', lx1, top - 1, z, lx2, top - 1, z + 3);
  b.fill('finish', rx1, top - 1, z1 - 8, rx2, top - 1, z1 - 1);
  return rep({
    id: 's_easy', name: 'Surf: Лесна', level: 'Лесна', order: 1, mode: 'surf', description: 'Дълга широка долина от две рампи. Скачай от стартовия перваз и дръж A/D към рампата.',
    size: S, env: SURF_ENV, ops: b.ops, start: [lx1, 2, lx2, 9], startY: top + 6, startYaw: Math.PI, drive: [0, 0, 1],
    spawns: { att: [[3, 4, top], [4, 4, top], [3, 6, top], [4, 6, top], [3, 8, top], [4, 8, top]] }, sites: {}, killY: 2,
  });
}

function sHard() {
  const b = new B(); const S = [40, 40, 200];
  const H0 = 8, cols = 6, top = H0 + 2 * cols, xl = 15, xr = 21;
  // сегменти: първо двете рампи, после само дясната, после само лявата (трансфер през процепа), накрая двете
  const segs = [[12, 52, true, true], [58, 98, false, true], [104, 144, true, false], [150, 190, true, true]];
  for (const [z0, z1, left, right] of segs) valley(b, { xl, xr, z0, z1, H0, cols, left, right });
  const z1 = 198, lx2 = xl - cols, rx1 = xr + cols;
  b.fill('concrete', 2, top - 1, 2, lx2, top - 1, z1 - 4); b.fill('concrete', rx1, top - 1, 2, 37, top - 1, z1 - 4);
  b.fill('concrete', 0, H0, 0, 1, top + 8, z1 + 2); b.fill('concrete', 38, H0, 0, 39, top + 8, z1 + 2); b.fill('concrete', 0, top - 1, z1 - 3, 39, top + 8, z1 + 2);
  b.fill('startpad', 2, top - 1, 2, lx2, top - 1, 9);
  for (const z of [55, 101, 147]) { b.fill('checkpoint', 2, top - 1, z, lx2, top - 1, z + 2); b.fill('checkpoint', rx1, top - 1, z, 37, top - 1, z + 2); }
  b.fill('finish', 2, top - 1, z1 - 12, 37, top - 1, z1 - 5);
  return rep({
    id: 's_hard', name: 'Surf: Трудна', level: 'Трудна', order: 2, mode: 'surf', description: 'По-тесни рампи с трансфери: рампите се редуват, прехвърляй се през процепа във въздуха.',
    size: S, env: SURF_ENV, ops: b.ops, start: [2, 2, lx2, 9], startY: top + 6, startYaw: Math.PI, drive: [0, 0, 1],
    spawns: { att: [[3, 4, top], [4, 4, top], [3, 6, top], [4, 6, top], [3, 8, top], [5, 8, top]] }, sites: {}, killY: 2,
  });
}

for (const m of [pEasy(), pMedium(), pHard(), sEasy(), sHard()]) { writeMap(path.join(OUT, m.id + '.json'), m); console.log(m.id, m.ops.length, 'ops', JSON.stringify(m.size)); }
