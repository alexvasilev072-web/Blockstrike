// Генератор на карта от кутии (без кубчета): „Нощен двор“ -> server/maps/yard.json
//   node tools/genbrush.mjs
// Карта 80 x 80 м. Огледална по оста x = 40 (точка A на запад, точка B на изток). Защитниците са на север, нападателите на юг.
// Мерки в метри; подът е с горна повърхност y = 1 (както във воксел картите). Стъпалата са по 0.25 м (играчът ги изкачва сам, до 0.55 м).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/maps');
const SX = 80, SY = 14, SZ = 80, G = 1;                          // G: ниво на пода (y)
const brushes = [], decor = [], lamps = [];
const r2 = v => Math.round(v * 1000) / 1000;
// B: кутия (x1,y1,z1,x2,y2,z2); M: същата + огледалния образ спрямо x=40
const B = (x1, y1, z1, x2, y2, z2, tex, fl = '') => { brushes.push([r2(x1), r2(y1), r2(z1), r2(x2), r2(y2), r2(z2), tex, fl]); };
const M = (x1, y1, z1, x2, y2, z2, tex, fl = '') => { B(x1, y1, z1, x2, y2, z2, tex, fl); B(SX - x2, y1, z1, SX - x1, y2, z2, tex, fl); };
// стени: по оста x (z фиксиран, дебелина t) с пролуки [[a,b],...] (врати: от пода до lh над пода) и прозорци [[a,b],...]
function wallX(x1, x2, z, t, h, tex, { gaps = [], windows = [], base = G, lintel = 2.2, mirror = false } = {}) {
  const put = (a, b, y1, y2, tx, fl) => { if (b - a > 1e-6) (mirror ? M : B)(a, y1, z, b, y2, z + t, tx || tex, fl || ''); };
  const cuts = [...gaps.map(g => ({ a: g[0], b: g[1], k: 'g' })), ...windows.map(g => ({ a: g[0], b: g[1], k: 'w' }))].sort((p, q) => p.a - q.a);
  let x = x1;
  for (const c of cuts) { put(x, c.a, base, base + h); x = c.b;
    if (c.k === 'g') { if (lintel < h) put(c.a, c.b, base + lintel, base + h); }
    else { put(c.a, c.b, base, base + 1.1); put(c.a, c.b, base + 2.3, base + h); (mirror ? M : B)(c.a + 0.05, base + 1.1, z + t / 2 - 0.05, c.b - 0.05, base + 2.3, z + t / 2 + 0.05, 'glass', 'g'); } }
  put(x, x2, base, base + h);
}
function wallZ(z1, z2, x, t, h, tex, { gaps = [], windows = [], base = G, lintel = 2.2, mirror = false } = {}) {
  const put = (a, b, y1, y2, tx, fl) => { if (b - a > 1e-6) (mirror ? M : B)(x, y1, a, x + t, y2, b, tx || tex, fl || ''); };
  const cuts = [...gaps.map(g => ({ a: g[0], b: g[1], k: 'g' })), ...windows.map(g => ({ a: g[0], b: g[1], k: 'w' }))].sort((p, q) => p.a - q.a);
  let z = z1;
  for (const c of cuts) { put(z, c.a, base, base + h); z = c.b;
    if (c.k === 'g') { if (lintel < h) put(c.a, c.b, base + lintel, base + h); }
    else { put(c.a, c.b, base, base + 1.1); put(c.a, c.b, base + 2.3, base + h); (mirror ? M : B)(x + t / 2 - 0.05, base + 1.1, c.a + 0.05, x + t / 2 + 0.05, base + 2.3, c.b - 0.05, 'glass', 'g'); } }
  put(z, z2, base, base + h);
}
// стъпала: 4 стъпала по 0.25 м, всяко с дълбочина 0.5 м; dir – накъде се изкачва ('n' към -z, 's' към +z, 'w' към -x, 'e' към +x); (x1..x2, z1..z2) е външният ръб на стълбата до ръба на терасата
function stairs(dir, a1, a2, edge, base, rise = 4, tex = 'step', mirror = false) {
  for (let k = 0; k < rise; k++) {
    const top = base + 0.25 * (k + 1), far = 0.5 * rise - 0.5 * k, near = far - 0.5;           // разстояние от ръба на терасата (k=0 е най-ниското и най-далечното)
    if (dir === 'n') (mirror ? M : B)(a1, base, edge + near, a2, top, edge + far, tex);        // стълба към -z: ниската страна е на +z
    if (dir === 'w') (mirror ? M : B)(edge + near, base, a1, edge + far, top, a2, tex);        // стълба към -x: ниската страна е на +x
  }
}
const crate = (x, z, s = 1.2, y = G, tex = 'crate', mirror = false) => (mirror ? M : B)(x, y, z, x + s, y + s, z + s, tex);
const barrel = (x, z, mirror = true) => (mirror ? M : B)(x - 0.35, G, z - 0.35, x + 0.35, G + 1.0, z + 0.35, 'barrel');

// ---------- под и периметър ----------
B(0, 0, 0, SX, G, SZ, 'ground');
B(0, G, 0, SX, G + 8, 1, 'brick2'); B(0, G, SZ - 1, SX, G + 8, SZ, 'brick2');
B(0, G, 0, 1, G + 8, SZ, 'brick2'); B(SX - 1, G, 0, SX, G + 8, SZ, 'brick2');

// ---------- спаун на защитниците (центрирано север) ----------
wallZ(1, 16, 27, 0.5, 4, 'concrete', { gaps: [[9, 14]], mirror: true });                    // странични стени с пролука към коридора
wallX(28, 36, 15.5, 0.5, 4, 'concrete', { mirror: true });                                     // южна стена с централна пролука x 36..44
crate(28.6, 2.5, 1.2); crate(28.6, 3.8, 1.2); crate(28.6, 3.1, 1.2, G + 1.2); crate(33, 12, 2.4, G, 'crate', true);

// ---------- точка A: тераса на запад (x 1..22, z 1..22), горна повърхност y=2 ----------
B(1, G, 1, 22, 2, 22, 'concrete'); B(SX - 22, G, 1, SX - 1, 2, 22, 'concrete');
wallX(1, 22, 21.6, 0.4, 1.0, 'concrete', { gaps: [[10, 16]], base: 2, mirror: true });          // парапет на юг (пролука за стълбата)
wallZ(1, 22, 21.6, 0.4, 1.0, 'concrete', { gaps: [[10, 16]], base: 2, mirror: true });           // парапет на изток
stairs('n', 10, 16, 22, G, 4, 'step', true);                                                    // стълба от юг (z 22..24)
stairs('w', 10, 16, 22, G, 4, 'step', true);                                                    // стълба от изток (x 22..24)
// прикритие около мястото за залагане (центърът е около (11.5, 11.5)): стени на юг и изток със свободни ъгли
B(8, 2, 17.4, 15, 4.4, 18, 'concrete'); B(17.4, 2, 8, 18, 4.4, 15, 'concrete');
B(SX - 15, 2, 17.4, SX - 8, 4.4, 18, 'concrete'); B(SX - 18, 2, 8, SX - 17.4, 4.4, 15, 'concrete');
crate(3, 3, 1.2, 2, 'crate', true); crate(4.3, 3, 1.2, 2, 'crate', true); crate(3.6, 3, 1.2, 3.2, 'crate', true);
crate(12.2, 12.6, 1.2, 2, 'crate', true); crate(19, 18.8, 1.2, 2, 'crate', true); barrel(6, 17); barrel(19.5, 4);

// ---------- коридор между спауна и терасата, горна алея (z 22..34) ----------
crate(24, 6, 1.2, G, 'crate', true); crate(24.1, 7.3, 1.2, G, 'crate', true); crate(25, 17, 1.2, G, 'crate', true);
crate(14, 28, 2.4, G, 'crate', true); crate(5, 29, 1.2, G, 'crate', true); crate(6.4, 29, 1.2, G, 'crate', true); crate(5.7, 29, 1.2, G + 1.2, 'crate', true);

// ---------- западен склад (x 10..26, z 36..54), огледален; врати на север/юг/изток/запад, прозорци ----------
const WH = 6;
wallX(10, 26, 36, 0.5, WH, 'brick', { gaps: [[15, 17]], windows: [[11.5, 13], [19, 20.5], [22, 23.5]], mirror: true });
wallX(10, 26, 53.5, 0.5, WH, 'brick', { gaps: [[19, 21]], windows: [[11.5, 13], [14, 15.5], [23, 24.5]], mirror: true });
wallZ(36, 54, 9.5, 0.5, WH, 'brick', { gaps: [[44, 46]], windows: [[38.5, 40], [49, 50.5]], mirror: true });
wallZ(36, 54, 25.5, 0.5, WH, 'brick', { gaps: [[44, 46]], windows: [[38.5, 40], [49, 50.5]], mirror: true });
M(9.5, G + WH, 35.5, 26.5, G + WH + 0.4, 54, 'concrete');                                        // плосък покрив (сблъсък)
for (const [x1, x2] of [[9.5, 26.5], [SX - 26.5, SX - 9.5]]) decor.push({ type: 'gable', x1, z1: 35.5, x2, z2: 54, y: G + WH + 0.4, h: 2.8, axis: 'z', tex: 'roof', gtex: 'brick' });
// вътрешни прегради и щайги
wallZ(38, 43, 17.8, 0.4, 4.5, 'plaster', { mirror: true }); wallZ(47, 52, 17.8, 0.4, 4.5, 'plaster', { mirror: true });
crate(20, 38, 1.2, G, 'crate', true); crate(21.3, 38, 1.2, G, 'crate', true); crate(12, 50, 2.4, G, 'crate', true); crate(23, 48, 1.2, G, 'crate', true); barrel(11.5, 38.5); barrel(24, 52.5);

// ---------- площад в средата (x 28..52, z 34..54) ----------
// централен павилион: прекъсва правата линия на виждане между двата спауна (затворена сграда без входове)
B(36, G, 39.5, 44, G + 4, 40.1, 'brick2'); B(36, G, 45.9, 44, G + 4, 46.5, 'brick2'); B(36, G, 40.1, 36.6, G + 4, 45.9, 'plaster'); B(43.4, G, 40.1, 44, G + 4, 45.9, 'plaster'); B(35.8, G + 4, 39.3, 44.2, G + 4.4, 46.7, 'concrete');
crate(33, 36.5, 1.2, G, 'crate'); crate(46, 51, 1.2, G, 'crate'); crate(33, 49, 2.4, G, 'crate'); crate(44.5, 36, 1.2, G, 'crate');
crate(30, 36, 1.2, G, 'crate', true); crate(30, 50, 1.2, G, 'crate', true); crate(31.3, 50, 1.2, G + 0, 'crate', true);
B(28, G, 43.5, 31, G + 1.0, 44.1, 'concrete'); B(SX - 31, G, 43.5, SX - 28, G + 1.0, 44.1, 'concrete');

// ---------- западна уличка (x 1..10, z 34..66): ограда, барабани, щайги ----------
crate(2, 40, 1.2, G, 'crate', true); crate(2, 41.3, 1.2, G, 'crate', true); crate(6, 58, 2.4, G, 'crate', true); crate(2, 52, 1.2, G, 'crate', true);
barrel(8.5, 56); barrel(3, 62); B(1, G, 47.8, 4.5, G + 2, 48.2, 'fence', ''); B(SX - 4.5, G, 47.8, SX - 1, G + 2, 48.2, 'fence', '');

// ---------- южен двор и спаун на нападателите ----------
wallX(28, 36, 64.5, 0.5, 4, 'concrete', { mirror: true });
wallZ(65, 79, 27, 0.5, 4, 'concrete', { gaps: [[68, 74]], mirror: true });
crate(31, 70, 1.2, G, 'crate'); crate(31, 71.3, 1.2, G, 'crate'); crate(45, 75, 2.4, G, 'crate'); crate(12, 70, 2.4, G, 'crate', true); crate(20, 60, 1.2, G, 'crate', true); barrel(24, 72); barrel(5, 72);
crate(13, 56, 1.2, G, 'crate', true); crate(15, 62, 1.2, G, 'crate', true);

// ---------- светлини (нощно осветление във върховете) ----------
for (const [x, z] of [[12, 30], [4, 40], [4, 60], [24, 28], [30, 60], [38, 20], [24, 70]]) { lamps.push([x, G + 4.2, z, 10, '#ffd9a0'], [SX - x, G + 4.2, z, 10, '#ffd9a0']); }
lamps.push([40, G + 4.2, 40, 11, '#ffd9a0'], [40, G + 4.2, 8, 9, '#ffd9a0'], [40, G + 4.2, 72, 9, '#ffd9a0'], [11, 4.5, 11, 9, '#ffe7b0'], [SX - 11, 4.5, 11, 9, '#ffe7b0']);

// ---------- spawn-ове, точки, зони ----------
const spawns = { def: [[34, 5], [37, 5], [40, 5], [43, 5], [46, 5], [40, 9]].map(([x, z]) => [x, z, G]), att: [[32, 74], [36, 73], [40, 74], [44, 73], [48, 74], [36, 69]].map(([x, z]) => [x, z, G]) };
const sites = { A: [6, 6, 16, 16], B: [SX - 16, 6, SX - 6, 16] };
const mirZ = (name, x1, z1, x2, z2, name2) => [[name, x1, z1, x2, z2], [name2 || name, SX - x2, z1, SX - x1, z2]];
const zones = [
  ...mirZ('Точка A', 1, 1, 22, 22, 'Точка B'), ['Лагер на защитниците', 28, 1, 52, 16], ...mirZ('Коридор към A', 22, 1, 28, 24, 'Коридор към B'), ['Централен изход', 28, 16, 52, 24],
  ...mirZ('Горна алея', 1, 24, 28, 34, 'Горна алея'), ...mirZ('Западен склад', 9.5, 35.5, 26.5, 54, 'Източен склад'), ['Площад', 28, 34, 52, 54], ...mirZ('Западна уличка', 1, 34, 9.5, 66, 'Източна уличка'),
  ['Южен двор', 28, 54, 52, 65], ...mirZ('Западен двор', 1, 54, 28, 79, 'Източен двор'), ['Лагер на нападателите', 28, 65, 52, 79],
];
const map = {
  id: 'yard', type: 'brush', name: 'Нощен двор', maxPlayers: 10, order: 0, big: true,
  description: 'Нощна карта от истински стени и сгради за 5 срещу 5: тухлени складове с прозорци и стълби, тераси със точките, щайги и улички. Точките са огледални.',
  size: [SX, SY, SZ], brushes, decor, lamps, spawns, sites, zones,
  env: { night: true, sky: '#0d0a1f', fogColor: '#171230', fog: [30, 120], ambient: 0.4, sun: 0 },
};
// четим JSON: по една кутия на ред
const { brushes: bl, decor: dl, lamps: ll, ...rest } = map;
const out = '{\n' + Object.entries(rest).map(([k, v]) => ' "' + k + '": ' + JSON.stringify(v)).join(',\n') + ',\n "brushes": [\n' + bl.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n ],\n "decor": ' + JSON.stringify(dl) + ',\n "lamps": ' + JSON.stringify(ll) + '\n}\n';
fs.writeFileSync(path.join(OUT, 'yard.json'), out);
console.log('Готово: yard (' + bl.length + ' кутии)');
