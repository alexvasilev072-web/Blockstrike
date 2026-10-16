// Тест на ботовете: навигация до обектите на всички карти + кратки мачове на ускорен часовник (трудните бият лесните).
let fake = 1_700_000_000_000; Date.now = () => fake;
const realSI = globalThis.setInterval; globalThis.setInterval = () => 0; process.env.PORT = '0';
const { __test } = await import('../server/index.js'); globalThis.setInterval = realSI;
const { Room, MAPS } = __test; const { Nav, DIFFS } = await import('../server/bots.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

console.log('— Навигация: от spawn-ите до обектите');
for (const [id, m] of Object.entries(MAPS)) {
  if (m.mode !== 'comp' || m.bsp) continue;
  const room = new Room('NAV'); room.mapId = id; room.world = m.world.clone(); room.phase = 'lobby';
  let bad = [];
  for (const side of ['att', 'def']) {
    const b = room.addBot(side, 'hard'), sp = m.json.spawns[side][0]; b.x = sp[0] + 0.5; b.y = sp[2] ?? 1; b.z = sp[1] + 0.5;
    for (const name of Object.keys(m.json.sites)) { const s = b.bot.pickSpot(name, 2); if (!s) bad.push(side + '→' + name); }
  }
  ok(!bad.length, `${id}: има път от двата spawn-а до A и B${bad.length ? ' (липсва: ' + bad.join(', ') + ')' : ''}`);
}

function match(mapId, att, def, n) {
  const room = new Room('T' + Math.random().toString(36).slice(2, 5)); room.mapId = mapId;
  for (let i = 0; i < n; i++) { room.addBot('att', att); room.addBot('def', def); }
  const diff = new Map([...room.players.values()].map(p => [p.name, p.diff])); const st = { k: {}, rounds: 0, plants: 0, win: { att: 0, def: 0 } };
  room.emit = (ev, d) => { if (ev === 'feed' && d.k && d.k !== d.v) st.k[diff.get(d.k)] = (st.k[diff.get(d.k)] || 0) + 1; if (ev === 'msg' && d.t === 'plant') st.plants++; if (ev === 'roundEnd') { st.rounds++; st.win[d.win]++; } };
  room.startMatch(); let g = 0;
  while (room.phase !== 'matchover' && room.phase !== 'lobby' && g++ < 3_000_000) { fake += 33; room.tick(fake); }
  return { st, done: room.phase === 'matchover' || room.phase === 'lobby' };
}
console.log('— Мач: Експерт срещу Лесен (3v3)');
{
  const a = match('desert', 'expert', 'easy', 3), b = match('warehouse', 'easy', 'expert', 3);
  const ek = (a.st.k.expert || 0) + (b.st.k.expert || 0), lk = (a.st.k.easy || 0) + (b.st.k.easy || 0);
  ok(a.done && b.done, 'мачовете приключват (без зацикляне)');
  ok(a.st.rounds + b.st.rounds >= 10, `играни рундове: ${a.st.rounds + b.st.rounds}`);
  ok(ek > lk * 4, `експертите печелят убийствата (${ek} срещу ${lk})`);
  ok(a.st.plants + b.st.plants > 0, `ботовете залагат бомбата (${a.st.plants + b.st.plants} пъти)`);
}
console.log('— Мач: Труден срещу Среден (3v3)');
{
  const a = match('mine', 'hard', 'medium', 3), b = match('snow', 'medium', 'hard', 3);
  const hk = (a.st.k.hard || 0) + (b.st.k.hard || 0), mk = (a.st.k.medium || 0) + (b.st.k.medium || 0);
  ok(hk > mk * 1.5, `трудните печелят убийствата (${hk} срещу ${mk})`);
}
console.log(fails ? `\nПровалени: ${fails}` : '\nБотовете са в ред.'); process.exit(fails ? 1 : 0);
