// Проверка на картите: spawn точките са свободни и върху твърда земя, A/B са достижими от двата spawn-а
// и има поне 3 (приблизително независими) пътя от spawn-а на нападателите до всяка точка.
//   node tools/validate-maps.mjs [id ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, BLOCK, SOLID, boxCollides } from '../shared/world.js';
import { Bsp, boxBlockedBsp } from '../shared/bsp.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/maps');
const want = process.argv.slice(2);
let bad = 0;
const fail = m => { console.log('   ✗ ' + m); bad++; };

function analyzeBsp(json) {
  const bsp = new Bsp(json); console.log(`
${json.id} (GoldSrc BSP)`);
  for (const [x, z, y] of json.spawns.att) if (boxBlockedBsp(bsp, x, y, z, false)) fail(`spawn ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} е в твърдо`);
  if (json.spawns.att.length < 1) fail('няма spawn точки');
  console.log(`   spawn-ове ${json.spawns.att.length}, trigger_push ${bsp.pushes.length}, teleport ${bsp.teleports.length}`);
}
function analyze(json) {
  if (json.type === 'bsp') return analyzeBsp(json);
  const w = World.fromMap(json), { sx, sy, sz } = w;
  console.log(`\n${json.id} (${sx}x${sy}x${sz})`);
  const sp = (s, side) => json.spawns[side].map(([x, z, y]) => [x, y ?? 1, z]);
  for (const side of ['att', 'def']) {
    for (const [x, y, z] of sp(null, side)) {
      if (boxCollides(w, x + 0.5, y, z + 0.5, 0.3, 1.8)) fail(`spawn ${side} ${x},${y},${z} е в блок`);
      if (!SOLID[w.get(x, y - 1, z)] && w.get(x, y - 1, z) !== BLOCK.water) fail(`spawn ${side} ${x},${z} няма земя под себе си`);
    }
    if (json.spawns[side].length < 5) fail(`малко spawn точки за ${side}`);
  }
  const free = (x, y, z) => !SOLID[w.get(x, y, z)] && !SOLID[w.get(x, y + 1, z)];
  const support = (x, y, z) => SOLID[w.get(x, y - 1, z)] || w.get(x, y - 1, z) === BLOCK.water;
  const id = (x, y, z) => (y * sz + z) * sx + x;
  const neighbors = (x, y, z, fn) => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= sx || nz >= sz) continue;
      for (const dy of [0, 1, -1, -2, -3]) {            // ниво, стъпало нагоре със скок, падане
        const ny = y + dy; if (ny < 1 || ny >= sy - 2) continue;
        if (dy === 1 && !free(x, y + 1, z)) continue;     // няма място за скок
        if (!free(nx, ny, nz) || !support(nx, ny, nz)) continue;
        if (dy < 0 && (!free(nx, y, nz) || !free(nx, y + 1, nz))) continue;
        fn(nx, ny, nz); break;
      }
    }
  };
  const bfs = (from, blocked) => {
    const dist = new Map(); const q = [from]; dist.set(id(...from), 0);
    for (let h = 0; h < q.length; h++) {
      const [x, y, z] = q[h], d = dist.get(id(x, y, z));
      neighbors(x, y, z, (nx, ny, nz) => { const k = id(nx, ny, nz); if (!dist.has(k) && !(blocked && blocked.has(k))) { dist.set(k, d + 1); q.push([nx, ny, nz]); } });
    }
    return dist;
  };
  const start = sp(null, 'att')[0];
  const dist = bfs(start);
  console.log(`   достижими клетки: ${dist.size}`);
  let loose = 0; for (let y = 1; y < sy - 2; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (free(x, y, z) && support(x, y, z) && !dist.has(id(x, y, z))) loose++;
  console.log(`   недостижими свободни клетки: ${loose}`);
  for (const [x, y, z] of [...sp(null, 'att'), ...sp(null, 'def')]) if (!dist.has(id(x, y, z))) fail(`spawn ${x},${z} не е достижим`);

  // най-близката достижима клетка до центъра на бомбена точка
  for (const [name, [x1, z1, x2, z2]] of Object.entries(json.sites)) {
    const cx = (x1 + x2) >> 1, cz = (z1 + z2) >> 1;
    let target = null, best = 1e9;
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) for (let y = 1; y < sy - 1; y++) {
      if (!dist.has(id(x, y, z))) continue; const dd = Math.hypot(x - cx, z - cz); if (dd < best) { best = dd; target = [x, y, z]; }
    }
    if (!target) { fail(`точка ${name} (${cx},${cz}) не е достижима`); continue; }
    // кой блок е на пода
    const fl = w.get(cx, target[1] - 1, cz); if (fl !== BLOCK.site && fl !== BLOCK.concrete && fl !== BLOCK.gravel && fl !== BLOCK.sand) { /* ок */ }
    // независими пътища: премахваме коридора на най-краткия път и повтаряме
    let blocked = new Set(), routes = 0;
    for (let iter = 0; iter < 6; iter++) {
      const d = bfs(start, blocked), tk = id(...target); if (process.env.DBG) console.log("     итерация", iter, "блокирани", blocked.size, "достижими", d.size, "M1(27,40)", d.has(id(28,1,40)), "hub", d.has(id(25,1,25)), "HA", d.has(id(20,1,20))); if (!d.has(tk)) break;
      routes++;
      // възстановяване на пътя назад (по намаляващо разстояние)
      let cur = target; const path = [cur];
      while (d.get(id(...cur)) > 0) {
        let nxt = null; const cd = d.get(id(...cur));
        for (let yy = 1; yy < sy - 1 && !nxt; yy++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = id(cur[0] + dx, yy, cur[2] + dz); if (d.get(k) === cd - 1) { nxt = [cur[0] + dx, yy, cur[2] + dz]; break; } }
        if (!nxt) break; cur = nxt; path.push(cur);
      }
      if (process.env.DBG) console.log("     път", routes, path.length, path.filter((_, i) => i % 5 === 0).map(p => p[0] + "," + p[2]).join(" "));
      for (const [px, py, pz] of path) {
        if (Math.hypot(px - start[0], pz - start[2]) < 9 || Math.hypot(px - target[0], pz - target[2]) < 9) continue;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -3; dy <= 3; dy++) {
          const X = px + dx, Y = py + dy, Z = pz + dz; if (X >= 0 && Z >= 0 && X < sx && Z < sz && Y >= 0 && Y < sy) blocked.add(id(X, Y, Z));
        }
      }
    }
    console.log(`   точка ${name}: независими маршрути ≈ ${routes}`);
    const need = json.minRoutes ?? 3; if (routes < need) fail(`точка ${name}: по-малко от ${need} пътя (${routes})`);
    // защитниците също стигат
    if (!bfs(sp(null, 'def')[0]).has(id(...target))) fail(`точка ${name} недостъпна за защитниците`);
  }
}

for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.json'))) {
  const json = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (want.length && !want.includes(json.id)) continue;
  analyze(json);
}
console.log(bad ? `\nПроблеми: ${bad}` : '\nВсички карти са валидни.');
process.exit(bad ? 1 : 0);
