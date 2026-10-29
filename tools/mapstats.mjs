// Показатели за баланс на картата: време за стигане до точките (нападатели / защитници) и колко „открито“ е мястото за залагане.
//   node tools/mapstats.mjs [карта ...]
// Разстоянията са по най-краткия проходим път (A* на ботовете) в блокове; времето е при бягане 6 м/с.
// Откритост = брой свободни колони в радиус 30 блока, видими от центъра на точката (на височина очи) – колкото по-малко, толкова по-защитено е залагането.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, SOLID, BLOCK, traverse } from '../shared/world.js';
import { Nav } from '../server/bots.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/maps');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
const SPEED = 6;

for (const id of ids) {
  const json = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8')), w = World.fromMap(json), nav = new Nav({ world: w });
  const sp = side => { const a = json.spawns[side]; const m = a.reduce((s, p) => [s[0] + p[0] / a.length, s[1] + p[1] / a.length, s[2] + (p[2] ?? 1) / a.length], [0, 0, 0]); return [Math.round(m[0]), Math.round(m[2]), Math.round(m[1])]; };
  const att = sp('att'), def = sp('def'), out = { id };
  // проходими колони (обхождане от спауна на нападателите): по скали и недостижими места не се брои
  const reach = new Set(), seen0 = new Set(), q = []; const s0 = nav.snap(att[0], att[1], att[2]); q.push(s0); seen0.add(s0.join(','));
  while (q.length) { const [x, y, z] = q.pop(); reach.add(x * 1000 + z); nav.neighbors(x, y, z, (nx, ny, nz) => { const k = nx + ',' + ny + ',' + nz; if (!seen0.has(k)) { seen0.add(k); q.push([nx, ny, nz]); } }); }
  console.log(`\n${id}`);
  const rows = {};
  for (const k of ['A', 'B']) {
    const [x1, z1, x2, z2] = json.sites[k], cx = (x1 + x2 + 1) / 2, cz = (z1 + z2 + 1) / 2, y = nav.groundAt(cx, cz, 1) ?? 1;
    const pa = nav.find([att[0], att[1], att[2]], [cx, y, cz], 200000), pd = nav.find([def[0], def[1], def[2]], [cx, y, cz], 200000);
    // откритост от 5 кандидат-места за залагане (центърът и четирите четвъртини); броят се само колони ИЗВЪН точката (подходите)
    const cands = [[0, 0], [-3, -3], [3, -3], [-3, 3], [3, 3]].map(([dx, dz]) => [cx + dx, cz + dz]); let best = null, avg = 0, total = 0;
    for (const [px, pz] of cands) {
      const py = nav.groundAt(px, pz, y) ?? y, eye = [px, py + 1.6, pz]; let seen = 0; total = 0; const R = 30;
      for (let z = Math.floor(pz - R); z <= pz + R; z++) for (let x = Math.floor(px - R); x <= px + R; x++) {
        if (x < 1 || z < 1 || x >= w.sx - 1 || z >= w.sz - 1 || Math.hypot(x + 0.5 - px, z + 0.5 - pz) > R) continue;
        if (x >= x1 && x <= x2 && z >= z1 && z <= z2) continue;                      // вътре в точката не се брои
        if (!reach.has(x * 1000 + z)) continue; const gy = nav.groundAt(x + 0.5, z + 0.5, py); if (gy === null) continue; total++;
        const tx = x + 0.5, ty = gy + 1.2, tz = z + 0.5, dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2], L = Math.hypot(dx, dy, dz); let blocked = false;
        traverse(w, eye[0], eye[1], eye[2], dx / L, dy / L, dz / L, L, (bx, by, bz, t) => { if (t >= L - 0.4) return true; if (SOLID[w.get(bx, by, bz)] && w.get(bx, by, bz) !== BLOCK.glass) { blocked = true; return true; } return false; });
        if (!blocked) seen++;
      }
      avg += seen / cands.length; if (best === null || seen < best) best = seen;
    }
    const seen = best;
    rows[k] = { attLen: pa ? pa.length : null, defLen: pd ? pd.length : null, exposed: seen, total };
    console.log(`  точка ${k}: нападатели ${pa ? pa.length + ' бл. ≈ ' + (pa.length / SPEED).toFixed(1) + ' с' : 'няма път'} | защитници ${pd ? pd.length + ' бл. ≈ ' + (pd.length / SPEED).toFixed(1) + ' с' : 'няма път'} | отношение ${pa && pd ? (pa.length / pd.length).toFixed(2) : '?'} | най-защитено място за залагане: видими ${seen} външни колони (средно ${Math.round(avg)})`);
  }
  const a = rows.A, b = rows.B;
  if (a.attLen && b.attLen) console.log(`  разлика A/B: път на нападателите ${Math.abs(a.attLen - b.attLen)} бл., на защитниците ${Math.abs(a.defLen - b.defLen)} бл., откритост ${Math.abs(a.exposed - b.exposed)} колони`);
}
