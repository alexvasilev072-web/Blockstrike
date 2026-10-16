// Симулация на мачове само с ботове на ускорен часовник (без мрежа): проверява, че ботовете играят цели рундове
// (купуват, движат се, стрелят, залагат и обезвреждат бомбата) и сравнява нивата на трудност.
//   node test/botsim.mjs [карта] [нападатели] [защитници] [мачове]      напр.: node test/botsim.mjs desert expert medium 2
let fake = 1_700_000_000_000;
Date.now = () => fake;
const realSI = globalThis.setInterval; globalThis.setInterval = () => 0;
process.env.PORT = '0';
const { __test } = await import('../server/index.js');
globalThis.setInterval = realSI;
const { Room, MAPS } = __test;
const [, , mapArg = 'desert', attD = 'hard', defD = 'hard', nm = '1', nPerArg = '5'] = process.argv;
const N = Number(nPerArg);

const stats = {};
const bump = (k, f, n = 1) => { (stats[k] || (stats[k] = {}))[f] = ((stats[k] || {})[f] || 0) + n; };
let ticks = 0, tickMs = 0, plants = 0, defuses = 0, explodes = 0, rounds = 0, roundWins = { att: 0, def: 0 }, reasons = {};

function runMatch(att, def) {
  const room = new Room('SIM' + Math.random().toString(36).slice(2, 5));
  room.mapId = mapArg;
  const first = room.addBot('att', att); if (!first) throw new Error('addBot failed');
  for (let i = 1; i < N; i++) room.addBot('att', att);
  for (let i = 0; i < N; i++) room.addBot('def', def);
  const diffOf = new Map([...room.players.values()].map(p => [p.name, p.diff]));
  room.emit = (ev, data) => {
    if (ev === 'feed') { const dk = diffOf.get(data.k), dv = diffOf.get(data.v); if (data.k && data.k !== data.v) { bump('kills', dk); if (data.hd) bump('heads', dk); bump('deaths', dv); bump('w_' + data.w, dk); } }
    if (ev === 'msg' && data.t === 'plant') plants++;
    if (ev === 'msg' && data.t === 'defuse') defuses++;
    if (ev === 'boom' && data.big) explodes++;
    if (ev === 'roundEnd') { rounds++; roundWins[data.win]++; reasons[data.why] = (reasons[data.why] || 0) + 1; }
  };
  room.startMatch();
  let guard = 0;
  while (room.phase !== 'matchover' && room.phase !== 'lobby' && guard++ < 6_000_000) {
    fake += 33; const t0 = process.hrtime.bigint(); room.tick(fake); tickMs += Number(process.hrtime.bigint() - t0) / 1e6; ticks++;
  }
  return { sc: room.sc, round: room.round, win: room.matchWinner };
}

const results = [];
for (let i = 0; i < Number(nm); i++) {
  // всеки втори мач със сменени нива, за да няма предимство на страната
  const swap = i % 2 === 1, r = runMatch(swap ? defD : attD, swap ? attD : defD);
  results.push({ swap, ...r });
}
console.log(`карта ${mapArg}  ${attD} (att) срещу ${defD} (def), ${N}v${N}, мачове ${nm}`);
console.log('резултати (att:def, след смяна на страните първата половина е играна като att):', results.map(r => `${r.sc.att}:${r.sc.def}${r.swap ? '*' : ''}`).join('  '));
console.log('убийства/смърти/хедшот по ниво:', JSON.stringify(Object.fromEntries(Object.keys({ ...stats.kills, ...stats.deaths }).map(k => [k, { k: stats.kills?.[k] || 0, d: stats.deaths?.[k] || 0, hs: stats.heads?.[k] || 0 }]))));
console.log(`рундове ${rounds} (att ${roundWins.att} / def ${roundWins.def}), заложени ${plants}, обезвредени ${defuses}, взривове ${explodes}`);
console.log('край на рунд:', JSON.stringify(reasons));
console.log(`тикове ${ticks}, средно ${(tickMs / ticks).toFixed(3)} ms/тик`);
const w = Object.fromEntries(Object.entries(stats).filter(([k]) => k.startsWith('w_'))); console.log('оръжия:', JSON.stringify(w));
process.exit(0);
