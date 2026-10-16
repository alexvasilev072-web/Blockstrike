// Генератор на картите mine / snow / harbor -> server/maps/*.json
//   node tools/genmaps.mjs
// Координати: x на изток, z на юг, y нагоре. Подът е на y=0 (крака на y=1), освен при harbor (кей до y=1, крака на y=2).
import { writeMap } from './mapjson.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/maps');

class Builder {
  constructor() { this.ops = []; this.foot = []; }
  fill(b, x1, y1, z1, x2, y2, z2) { this.ops.push([b, x1, y1, z1, x2, y2, z2]); }
  carve(x1, z1, x2, z2, h = 4, y0 = 1) { this.fill('air', x1, y0, z1, x2, y0 + h - 1, z2); this.foot.push([x1, z1, x2, z2]); }
  set(b, x, y, z) { this.fill(b, x, y, z, x, y, z); }
  ring(x1, z1, x2, z2, y = 0, inner = 'gravel') { this.fill('site', x1, y, z1, x2, y, z2); this.fill(inner, x1 + 1, y, z1 + 1, x2 - 1, y, z2 - 1); }
  // факли по права линия (axis 'z': променя z при фиксиран x)
  torches(axis, fixed, a, b, y, step, off = 0) {
    for (let i = a + off; i <= b; i += step) axis === 'z' ? this.set('torch', fixed, y, i) : this.set('torch', i, y, fixed);
  }
}

// ======================= МИНЬОРСКА ШАХТА =======================
function mine() {
  const m = new Builder();
  m.fill('stone', 0, 0, 0, 55, 9, 55);
  for (let x = 0; x < 56; x += 8) m.fill('cobble', x, 0, 0, x + 3, 9, 55);
  for (let z = 4; z < 56; z += 10) m.fill('cobble', 0, 0, z, 55, 9, z + 2);
  // зали
  m.carve(20, 44, 35, 52, 6);   // spawn на нападателите
  m.carve(20, 3, 35, 10, 6);    // spawn на защитниците
  m.carve(4, 4, 17, 17, 7);     // бомбена точка A
  m.carve(38, 4, 51, 17, 7);    // бомбена точка B
  m.carve(21, 22, 34, 34, 6);   // централна зала
  // тунели
  m.carve(6, 18, 9, 47); m.carve(10, 44, 19, 47);          // западен основен път
  m.carve(46, 18, 49, 47); m.carve(36, 44, 45, 47);        // източен основен път
  m.carve(26, 35, 29, 43);                                 // среден път от spawn към залата
  m.carve(10, 26, 20, 29); m.carve(35, 26, 45, 29);        // зала -> западен/източен тунел
  m.carve(26, 11, 29, 21);                                 // зала -> spawn на защитниците
  m.carve(18, 5, 19, 8); m.carve(36, 5, 37, 8);            // защитници -> A / B
  m.carve(14, 19, 25, 21); m.carve(14, 18, 17, 21);        // зала -> A (горен коридор)
  m.carve(30, 19, 41, 21); m.carve(38, 18, 41, 21);        // зала -> B
  for (const [x1, z1, x2, z2] of m.foot) m.fill('gravel', x1, 0, z1, x2, 0, z2);

  // подпори и греди (дънери + дъски)
  for (const z of [24, 32, 40]) for (const x0 of [6, 46]) { m.fill('wood', x0, 1, z, x0, 4, z); m.fill('wood', x0 + 3, 1, z, x0 + 3, 4, z); m.fill('wood', x0, 4, z, x0 + 3, 4, z); }
  for (const x of [13, 16]) for (const z0 of [44]) { m.fill('wood', x, 1, z0, x, 4, z0); m.fill('wood', x, 1, z0 + 3, x, 4, z0 + 3); m.fill('wood', x, 4, z0, x, 4, z0 + 3); }
  for (const x of [39, 42]) { m.fill('wood', x, 1, 44, x, 4, 44); m.fill('wood', x, 1, 47, x, 4, 47); m.fill('wood', x, 4, 44, x, 4, 47); }
  for (const [x, z] of [[22, 24], [33, 24], [22, 32], [33, 32]]) m.fill('wood', x, 1, z, x, 5, z);
  m.fill('stone', 30, 1, 27, 31, 5, 28); m.fill('stone', 23, 1, 27, 24, 5, 28);   // колони в залата
  for (const [x, z] of [[22, 46], [33, 46], [22, 50], [33, 50], [22, 5], [33, 5], [22, 8], [33, 8]]) m.fill('wood', x, 1, z, x, 5, z);

  // релси и вагонетки
  for (let z = 11; z <= 43; z++) if (!(z >= 22 && z <= 34 && false)) m.set('rail', 27, 1, z);
  for (let z = 18; z <= 45; z++) m.set('rail', 7, 1, z);
  for (let x = 7; x <= 19; x++) m.set('rail', x, 1, 45);
  for (let z = 18; z <= 45; z++) m.set('rail', 48, 1, z);
  for (let x = 36; x <= 48; x++) m.set('rail', x, 1, 45);
  const cart = (x, z) => { m.fill('rust', x, 1, z, x + 1, 1, z + 1); m.fill('metal', x, 2, z, x + 1, 2, z, ); m.set('cobble', x, 2, z + 1); m.set('gravel', x + 1, 2, z + 1); };
  cart(7, 27); cart(47, 36); cart(27, 14); cart(26, 38); cart(21, 26);

  // бомбени точки + прикритие
  m.ring(8, 7, 13, 12); m.ring(42, 7, 47, 12);
  for (const [x, z] of [[6, 6], [15, 6], [6, 14], [15, 14], [10, 15], [40, 6], [49, 6], [40, 14], [49, 14], [45, 15]]) m.fill('crate', x, 1, z, x + 1, 2, z + 1);
  m.fill('planks', 10, 1, 4, 11, 2, 4); m.fill('planks', 44, 1, 4, 45, 2, 4);
  m.fill('crate', 13, 3, 6, 13, 3, 6);

  // осветление: лампи в залите, факли по тунелите (някои участъци нарочно са тъмни)
  for (const [x, z] of [[8, 8], [13, 8], [8, 13], [13, 13], [42, 8], [47, 8], [42, 13], [47, 13]]) m.set('lamp', x, 7, z);
  for (const [x, z] of [[24, 48], [31, 48], [24, 6], [31, 6]]) m.set('lamp', x, 6, z);
  m.set('lamp', 27, 6, 25); m.set('lamp', 28, 6, 31);
  m.torches('z', 6, 20, 46, 3, 6); m.torches('z', 9, 23, 46, 3, 6); m.torches('z', 46, 20, 46, 3, 6); m.torches('z', 49, 23, 46, 3, 6);
  m.torches('z', 26, 12, 20, 3, 4); m.torches('z', 29, 14, 20, 3, 4); m.torches('z', 26, 36, 43, 3, 5); m.torches('z', 29, 38, 43, 3, 5);
  m.torches('x', 26, 11, 20, 3, 4); m.torches('x', 29, 36, 45, 3, 5); m.torches('x', 14, 20, 45, 3, 5);
  m.torches('x', 19, 15, 24, 3, 4); m.torches('x', 31, 31, 40, 3, 4);
  m.set('torch', 21, 3, 25); m.set('torch', 34, 3, 25); m.set('torch', 21, 3, 31); m.set('torch', 34, 3, 31);
  m.set('torch', 18, 3, 5); m.set('torch', 37, 3, 5);

  const sp = (xs, zs) => xs.map((x, i) => [x, zs[i]]);
  return {
    id: 'mine', name: 'Миньорска шахта', maxPlayers: 4,
    description: 'Тесни тъмни тунели, релси и вагонетки. Факлите са единствената светлина.',
    size: [56, 10, 56],
    env: { sky: '#050608', fogColor: '#050608', fog: [4, 38], ambient: 0.06, sun: 0, ground: '#050505' },
    ops: m.ops,
    spawns: { att: sp([23, 25, 27, 29, 31, 33], [50, 49, 50, 49, 50, 49]), def: sp([23, 25, 27, 29, 31, 33], [5, 6, 5, 6, 5, 6]) },
    sites: { A: [8, 7, 13, 12], B: [42, 7, 47, 12] },
  };
}

// ======================= СНЕЖНА БАЗА =======================
function snow() {
  const m = new Builder();
  m.fill('snow', 0, 0, 0, 71, 0, 71);
  // планини по периметъра
  for (const [a, b, c, d] of [[0, 0, 71, 1], [0, 70, 71, 71], [0, 0, 1, 71], [70, 0, 71, 71]]) { m.fill('stone', a, 1, b, c, 9, d); m.fill('snow', a, 10, b, c, 11, d); }
  for (const [a, b, c, d] of [[2, 2, 69, 2], [2, 69, 69, 69], [2, 2, 2, 69], [69, 2, 69, 69]]) { m.fill('stone', a, 1, b, c, 3, d); m.fill('snow', a, 4, b, c, 4, d); }
  // замръзнало езеро в центъра
  m.fill('ice', 26, 0, 28, 46, 0, 44);
  for (const [x, z, w, d, h] of [[30, 32, 2, 2, 2], [40, 38, 3, 2, 3], [34, 30, 2, 1, 1], [36, 42, 2, 2, 1], [43, 31, 2, 2, 2]]) { m.fill('stone', x, 1, z, x + w - 1, h, z + d - 1); m.fill('snow', x, h + 1, z, x + w - 1, h + 1, z + d - 1); }
  m.fill('ice', 35, 1, 35, 36, 3, 36);
  // хребети (тераси по 1 блок: могат да се изкачат със скок)
  const mound = (x1, z1, x2, z2, h, bottom = 'stone') => { for (let k = 1; k <= h; k++) m.fill(k === h ? 'snow' : bottom, x1 + k - 1, k, z1 + k - 1, x2 - k + 1, k, z2 - k + 1); };
  mound(8, 30, 22, 40, 4); mound(49, 30, 63, 40, 4);
  mound(10, 52, 20, 58, 3); mound(51, 52, 61, 58, 3);
  mound(30, 14, 41, 18, 2);
  // чували с пясък (укрития)
  for (const [x1, z1, x2, z2] of [[24, 54, 29, 54], [42, 54, 47, 54], [30, 24, 33, 24], [38, 24, 41, 24], [28, 48, 28, 51], [43, 48, 43, 51], [18, 22, 18, 26], [53, 22, 53, 26]]) m.fill('snow', x1, 1, z1, x2, 2, z2);
  // бункери: черупка от бетон, вътрешност, врати, прозорци
  const bunker = (x1, z1, x2, z2, doors, windows) => {
    m.fill('concrete', x1, 1, z1, x2, 4, z2);
    m.fill('air', x1 + 1, 1, z1 + 1, x2 - 1, 3, z2 - 1);
    m.fill('concrete', x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1);
    for (const [a, b, c, d] of doors) m.fill('air', a, 1, b, c, 3, d);
    for (const [a, b, c, d] of windows) m.fill('glass', a, 2, b, c, 3, d);
  };
  bunker(10, 8, 24, 20, [[15, 20, 17, 20], [24, 13, 24, 15], [10, 13, 10, 15], [15, 8, 17, 8]], [[12, 8, 13, 8], [20, 8, 21, 8], [10, 10, 10, 11], [24, 17, 24, 18]]);
  bunker(47, 8, 61, 20, [[54, 20, 56, 20], [61, 13, 61, 15], [47, 13, 47, 15], [54, 8, 56, 8]], [[58, 8, 59, 8], [50, 8, 51, 8], [61, 10, 61, 11], [47, 17, 47, 18]]);
  m.ring(14, 11, 20, 17, 0, 'concrete'); m.ring(51, 11, 57, 17, 0, 'concrete');
  for (const [x, z] of [[12, 10], [22, 10], [12, 18], [22, 18], [16, 13], [49, 10], [59, 10], [49, 18], [59, 18], [53, 15]]) m.fill('crate', x, 1, z, x, 2, z);
  for (const x of [17, 54]) m.fill('lamp', x, 4, 14, x, 4, 14);
  // бази на spawn
  m.fill('metal', 26, 1, 66, 45, 3, 66); m.fill('air', 33, 1, 66, 38, 3, 66);
  m.fill('metal', 26, 1, 62, 27, 3, 66); m.fill('metal', 44, 1, 62, 45, 3, 66);
  m.fill('metal', 26, 1, 5, 45, 3, 5); m.fill('air', 33, 1, 5, 38, 3, 5);
  m.fill('metal', 26, 1, 5, 27, 3, 9); m.fill('metal', 44, 1, 5, 45, 3, 9);
  m.fill('rust', 30, 1, 62, 31, 2, 63); m.fill('rust', 40, 1, 62, 41, 2, 63); m.fill('rust', 30, 1, 8, 31, 2, 9); m.fill('rust', 40, 1, 8, 41, 2, 9);
  // наблюдателници (стълби от блокове; платформата е на y=6)
  const tower = (x, z, side) => {
    for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) m.fill('metal', x + dx, 1, z + dz, x + dx, 5, z + dz);
    m.fill('planks', x, 6, z, x + 3, 6, z + 3);
    m.fill('planks', x + 1, 7, z, x + 3, 7, z); m.fill('planks', x + 1, 7, z + 3, x + 3, 7, z + 3); m.fill('planks', x + 3, 7, z, x + 3, 7, z + 3);
    for (let i = 1; i <= 6; i++) m.fill('planks', side < 0 ? x - 1 : x + 4, 1, z + i - 3, side < 0 ? x - 1 : x + 4, i, z + i - 3);
  };
  tower(16, 44, -1); tower(52, 44, 1);
  tower(30, 56, 1); tower(38, 56, -1);
  // оголена земя и трева под снега
  for (const [x, z, w, d] of [[20, 62, 6, 4], [46, 62, 6, 4], [30, 36, 3, 3], [8, 20, 4, 3], [60, 44, 4, 4], [14, 44, 5, 3], [52, 20, 3, 3]]) { m.fill('dirt', x, 0, z, x + w - 1, 0, z + d - 1); m.fill('grass', x + 1, 0, z + 1, x + w - 2, 0, z + d - 2); }
  // камъни из полето
  for (const [x, z] of [[14, 26], [58, 26], [24, 12], [47, 12], [32, 20], [38, 20], [20, 60], [50, 60], [34, 50], [36, 50]]) { m.fill('stone', x, 1, z, x + 1, 2, z + 1); m.fill('snow', x, 3, z, x + 1, 3, z + 1); }
  const sp = (xs, zs) => xs.map((x, i) => [x, zs[i]]);
  return {
    id: 'snow', maxPlayers: 4, name: 'Снежна база',
    description: 'Открит терен за снайперисти: езеро от лед, хребети, бункери и наблюдателници.',
    size: [72, 14, 72],
    env: { sky: '#b8d4f0', fogColor: '#d3e3f3', fog: [70, 180], ambient: 0.38, sun: 1, ground: '#e6eef7' },
    ops: m.ops,
    spawns: { att: sp([30, 32, 34, 37, 39, 41], [64, 63, 65, 65, 63, 64]), def: sp([30, 32, 34, 37, 39, 41], [7, 8, 6, 6, 8, 7]) },
    sites: { A: [14, 11, 20, 17], B: [51, 11, 57, 17] },
  };
}

// ======================= ПРИСТАНИЩЕ =======================
function harbor() {
  const m = new Builder();
  // море (x0..11), кей (y0..1, крака на y=2)
  m.fill('dirt', 0, 0, 0, 11, 0, 55); m.fill('water', 1, 1, 0, 11, 1, 55);
  m.fill('stone', 0, 0, 0, 0, 9, 55);
  m.fill('concrete', 12, 0, 0, 71, 1, 55);
  m.fill('gravel', 12, 1, 0, 71, 1, 55);
  m.fill('concrete', 12, 1, 20, 71, 1, 21); m.fill('concrete', 40, 1, 0, 41, 1, 55);   // настилка на пътищата
  for (const [a, b, c, d] of [[0, 0, 71, 0], [0, 55, 71, 55], [71, 0, 71, 55]]) { m.fill('brick', a, 0, b, c, 9, d); m.fill('concrete', a, 10, b, c, 10, d); }
  // кейове в морето
  m.fill('planks', 3, 1, 21, 11, 1, 24); m.fill('planks', 3, 1, 8, 11, 1, 10); m.fill('planks', 3, 1, 44, 11, 1, 47);
  for (const z of [21, 24, 8, 10, 44, 47]) for (const x of [4, 8]) m.fill('wood', x, 0, z, x, 1, z);
  // зелени площи и пръст по кея
  m.fill('grass', 34, 1, 0, 39, 1, 8); m.fill('dirt', 34, 1, 9, 39, 1, 10); m.fill('grass', 42, 1, 0, 47, 1, 4); m.fill('grass', 12, 1, 36, 13, 1, 52); m.fill('dirt', 14, 1, 34, 14, 1, 52);
  // кораб (препятствие)
  m.fill('rust', 1, 1, 28, 8, 3, 41); m.fill('air', 3, 3, 29, 6, 3, 40); m.fill('planks', 2, 4, 31, 6, 6, 36); m.fill('metal', 4, 7, 33, 4, 10, 33);
  m.fill('cont_red', 3, 4, 38, 8, 6, 39);
  // кранове
  const crane = (x, z0, z1) => {
    for (const z of [z0, z1]) m.fill('metal', x, 2, z, x + 1, 12, z + 1);
    m.fill('metal', x, 13, z0, x + 1, 13, z1 + 1); m.fill('cont_yellow', x, 11, Math.floor((z0 + z1) / 2) - 1, x + 1, 12, Math.floor((z0 + z1) / 2) + 1);
  };
  crane(14, 27, 36); crane(66, 30, 40);
  // контейнери: 6x2x3 на ниво
  const cont = (x, z, dir, col, lv = 1, len = 6) => {
    const [w, d] = dir === 'x' ? [len, 2] : [2, len];
    for (let l = 0; l < lv; l++) m.fill('cont_' + col, x, 2 + l * 3, z, x + w - 1, 4 + l * 3, z + d - 1);
  };
  // двор A (северозапад)
  cont(15, 3, 'x', 'red'); cont(15, 3, 'x', 'red', 2); cont(23, 3, 'z', 'blue'); cont(28, 4, 'x', 'green');
  cont(15, 14, 'z', 'yellow'); cont(32, 14, 'z', 'blue', 2); cont(18, 16, 'x', 'green'); cont(26, 17, 'x', 'red');
  m.ring(19, 8, 26, 14, 1, 'concrete');
  for (const [x, z] of [[20, 9], [24, 13], [25, 9], [21, 13]]) m.fill('crate', x, 2, z, x, 3, z);
  // централен лабиринт от контейнери
  cont(14, 24, 'x', 'blue'); cont(22, 24, 'z', 'red', 2); cont(27, 26, 'x', 'yellow'); cont(34, 24, 'z', 'green');
  cont(14, 33, 'x', 'green', 2); cont(22, 34, 'x', 'blue'); cont(30, 32, 'z', 'red'); cont(34, 36, 'x', 'yellow');
  cont(18, 42, 'z', 'red'); cont(26, 41, 'x', 'green'); cont(32, 44, 'z', 'blue', 2);
  cont(44, 26, 'x', 'red'); cont(52, 28, 'z', 'blue'); cont(58, 26, 'x', 'green', 2); cont(46, 34, 'z', 'yellow'); cont(54, 36, 'x', 'red');
  cont(62, 36, 'z', 'blue'); cont(44, 42, 'x', 'green'); cont(54, 44, 'z', 'yellow', 2); cont(60, 46, 'x', 'red');
  // склад B (североизток): тухли, метален покрив, врати и прозорци
  m.fill('brick', 46, 2, 5, 68, 8, 22); m.fill('air', 47, 2, 6, 67, 7, 21); m.fill('metal', 46, 9, 5, 68, 9, 22);
  m.fill('air', 46, 2, 12, 46, 5, 15); m.fill('air', 55, 2, 22, 58, 5, 22); m.fill('air', 68, 2, 12, 68, 5, 15); m.fill('air', 52, 2, 5, 54, 5, 5);
  for (const x of [49, 51, 60, 62, 64]) m.fill('glass', x, 5, 22, x + 1, 6, 22);
  for (const z of [7, 8, 18, 19]) m.fill('glass', 46, 5, z, 46, 6, z);
  m.fill('tiles', 47, 1, 6, 67, 1, 21); m.ring(56, 10, 63, 17, 1, 'tiles');
  for (const [x, z] of [[49, 8], [52, 18], [65, 8], [66, 18], [58, 8], [60, 19], [48, 14]]) m.fill('crate', x, 2, z, x + 1, 3, z + 1);
  m.fill('metal', 54, 2, 12, 54, 4, 14); m.fill('metal', 66, 2, 12, 66, 4, 14);
  for (const [x, z] of [[52, 10], [60, 10], [52, 17], [60, 17], [66, 10], [66, 17]]) m.set('lamp', x, 8, z);
  // прибрежни складове / къщи
  m.fill('planks', 14, 2, 49, 24, 5, 54); m.fill('air', 15, 2, 50, 23, 4, 53); m.fill('air', 18, 2, 49, 20, 3, 49); m.fill('air', 24, 2, 51, 24, 3, 52);
  m.fill('glass', 16, 3, 49, 16, 4, 49); m.fill('glass', 22, 3, 49, 22, 4, 49); m.fill('wood', 14, 6, 49, 24, 6, 54);
  m.fill('crate', 15, 2, 51, 16, 3, 52);
  // фенери по кея
  for (const [x, z] of [[13, 19], [13, 40], [39, 19], [39, 40], [43, 19], [43, 40], [70, 25], [70, 50]]) { m.fill('metal', x, 2, z, x, 5, z); m.set('lamp', x, 6, z); }
  const sp = (xs, zs) => xs.map((x, i) => [x, zs[i], 2]);
  return {
    id: 'harbor', maxPlayers: 4, name: 'Пристанище',
    description: 'Контейнери, кранове и кейове над водата. Складът е на североизток.',
    size: [72, 15, 56],
    env: { sky: '#79b4e8', fogColor: '#b4d4ee', fog: [60, 170], ambient: 0.32, sun: 1, ground: '#2f6aa0' },
    ops: m.ops,
    spawns: { att: sp([36, 38, 43, 45, 37, 44], [51, 52, 51, 52, 49, 49]), def: sp([36, 38, 43, 45, 37, 44], [3, 4, 3, 4, 6, 6]) },
    sites: { A: [19, 8, 26, 14], B: [56, 10, 63, 17] },
  };
}

for (const [name, fn] of [['mine', mine], ['snow', snow], ['harbor', harbor]]) {
  const m = fn();
  writeMap(path.join(OUT, name + '.json'), m);
  console.log(name, m.ops.length, 'ops');
}
