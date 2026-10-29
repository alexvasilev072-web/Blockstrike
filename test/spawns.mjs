// Тест на spawn точките за режими без отбори: и двата списъка се ползват, достатъчно са, всички са годни, изборът е далеч от противниците.
let fake = 1_700_000_000_000; Date.now = () => fake;
const realSI = globalThis.setInterval; globalThis.setInterval = () => 0; process.env.PORT = '0';
const { __test } = await import('../server/index.js'); globalThis.setInterval = realSI;
const { Room, MAPS } = __test;
const { boxCollides, SOLID } = await import('../shared/world.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

for (const id of Object.keys(MAPS).filter(k => k !== 'desert')) {
  console.log('— ' + id);
  const room = new Room('SP' + id); room.mapId = id;
  const all = room.allSpawns(), j = MAPS[id].json, nAtt = j.spawns.att.length, nDef = j.spawns.def.length;
  ok(all.length === nAtt + nDef && all.length >= 12, `общо ${all.length} точки (и от двата отбора, поне 12)`);
  const w = MAPS[id].world;
  const bad = all.filter(p => boxCollides(w, p.x, p.y, p.z, 0.3, 1.8) || !SOLID[w.get(Math.floor(p.x), p.y - 1, Math.floor(p.z))]);
  ok(bad.length === 0, 'всяка точка е свободна и върху твърда земя');
  const fromAtt = j.spawns.att.map(([x, z]) => ({ x: x + 0.5, z: z + 0.5 })), sp = room.pickSpawn(fromAtt, () => 0);
  const dist = q => Math.min(...fromAtt.map(f => Math.hypot(f.x - q.x, f.z - q.z))), best = Math.max(...all.map(dist));
  ok(Math.abs(dist(sp) - best) < 1e-6, `при противници на мястото на нападателите се избира най-далечната точка (${dist(sp).toFixed(0)} м)`);
  ok(Number.isFinite(sp.yw), 'погледът е към центъра на картата');
  const seen = new Set(); for (let i = 0; i < 40; i++) { const q = room.pickSpawn([], Math.random); seen.add(q.x + ',' + q.z); }
  ok(seen.size > 3, `без противници изборът е случаен (${seen.size} различни точки за 40 опита)`);
}
console.log(fails ? `\nПровалени: ${fails}` : '\nSpawn точките са в ред.'); process.exit(fails ? 1 : 0);
