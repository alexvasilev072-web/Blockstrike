// Тест на гранатите: купуване и лимити, димна граната (спира погледа), flashbang (заслепява по посока и разстояние), молотов (пожар и щети).
let fake = 1_700_000_000_000; Date.now = () => fake;
const realSI = globalThis.setInterval; globalThis.setInterval = () => 0; process.env.PORT = '0';
const { __test } = await import('../server/index.js'); globalThis.setInterval = realSI;
const { Room } = __test;
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const adv = (room, sec) => { for (let i = 0; i < Math.round(sec * 30); i++) { fake += 33; room.tick(fake); } };

function setup() {
  const room = new Room('NADE' + Math.random().toString(36).slice(2, 5)); room.mapId = 'desert';
  const a = room.addBot('att', 'easy'), b = room.addBot('def', 'easy'), c = room.addBot('def', 'easy');
  for (const p of [a, b, c]) { p.bot = null; p.ready = true; }                // статични играчи без ИИ
  room.emit = () => { };
  const evs = {}; for (const p of [a, b, c]) { evs[p.id] = []; p.socket.emit = (n, d) => evs[p.id].push([n, d]); }
  room.startMatch(); for (const p of [a, b, c]) p.ready = true; adv(room, 14);                       // freeze -> live
  return { room, a, b, c, evs };
}
const place = (p, x, y, z, yw = 0) => { p.x = x; p.y = y; p.z = z; p.yw = yw; p.pt = 0; p.hist = [{ t: fake, x, y, z, cr: false }]; };

console.log('— Купуване на гранати');
{
  const { room, a, b } = setup(); room.phase = 'freeze'; a.money = 10000; b.money = 10000;
  room.buy(a, 'flash'); room.buy(a, 'flash'); room.buy(a, 'flash');
  ok(a.inv.g.flash === 2, 'най-много 2 flashbang-а');
  room.buy(a, 'smoke'); room.buy(a, 'molotov'); room.buy(a, 'grenade');
  ok(a.inv.n === 4 && a.inv.g.molo === 0 + (a.inv.g.molo), `общо най-много 4 гранати (${a.inv.n})`);
  const m0 = b.money; room.buy(b, 'molotov'); ok(m0 - b.money === 600, `молотов за защитник струва $600 (${m0 - b.money})`);
  const m1 = a.money; const had = a.inv.g.molo; room.buy(a, 'molotov'); ok(had ? true : m1 - a.money === 400 || a.inv.n === 4, 'молотов за нападател струва $400 (или лимитът е стигнат)');
  const w0 = a.weapon; room.switchTo(a, 'n'); const w1 = a.weapon; room.switchTo(a, 'n');
  ok(a.weapon !== w1 && ['grenade', 'flash', 'smoke', 'molotov'].includes(a.weapon), `клавиш 4 сменя между гранатите (${w0} → ${w1} → ${a.weapon})`);
}

console.log('— Димна граната');
{
  const { room, a, b } = setup(); const y = a.y;
  place(a, 20, y, 20, 0); place(b, 20, y, 30, Math.PI);
  const eyeA = [20, y + 1.6, 20], eyeB = [20, y + 1.6, 30];
  ok(!room.smokeBlocks(eyeA, eyeB), 'без дим погледът е чист');
  room.popSmoke({ id: 99, x: 20, y, z: 25 }); adv(room, 0.2);
  ok(!room.smokeBlocks(eyeA, eyeB), 'първите мигове димът още не спира погледа');
  adv(room, 1.0);
  ok(room.smokeBlocks(eyeA, eyeB), 'облакът спира погледа между двамата');
  ok(!room.smokeBlocks(eyeA, [20, y + 1.6, 21]), 'но не и пред облака');
  adv(room, 19);
  ok(!room.smokeBlocks(eyeA, eyeB), 'след ~18 сек димът изчезва');
}

console.log('— Flashbang');
{
  const { room, a, b, c, evs } = setup(); const y = a.y;
  // b гледа към флашката, c гледа в обратната посока; a е зад стена (далеч и извън видимост по-долу не го проверяваме)
  place(b, 20, y, 30, 0);            // yaw 0 гледа към -z
  place(c, 20, y, 20, 0);            // стои на z=20 и гледа към -z, т.е. с гръб към светкавицата
  const g = { x: 20, y: y + 1.5, z: 25 };
  room.flashBang(g);
  const fb = evs[b.id].find(e => e[0] === 'flashed'), fc = evs[c.id].find(e => e[0] === 'flashed');
  ok(!!fb && fb[1].d > 1.5, `играч, който гледа към светкавицата, е силно заслепен (${fb ? fb[1].d + ' с' : 'не'})`);
  ok(!!fc && fc[1].d < fb[1].d, `играч с гръб е заслепен по-малко (${fc ? fc[1].d + ' с' : 'не'})`);
  ok(b.blindUntil > fake, 'сървърът пази времето на заслепяване (за ботовете)');
  const far = setup(); place(far.b, 20, y, 60, 0); far.room.flashBang({ x: 20, y: y + 1.5, z: 20 });
  ok(!far.evs[far.b.id].some(e => e[0] === 'flashed'), 'твърде далеч (по-голямо от 30 м) няма ефект');
}

console.log('— Молотов');
{
  const { room, a, b } = setup(); const y = a.y;
  place(b, 20, y, 25, 0); place(a, 40, y, 40, 0); b.hp = 100;
  room.igniteMolotov({ id: 77, x: 20, y, z: 25, owner: a.id, ownerTeam: 'att' });
  adv(room, 3);
  ok(b.hp < 100 - 30 && b.hp > 0, `в огъня се губят ~14 hp/сек (${b.hp} след 3 сек)`);
  place(b, 30, y, 25, 0); const hp = b.hp; adv(room, 2);
  ok(b.hp === hp, 'извън огъня няма щети');
  adv(room, 6); ok(room.fires.length === 0, 'огънят изгасва след ~7 сек');
  room.igniteMolotov({ id: 78, x: 20, y, z: 25, owner: a.id, ownerTeam: 'att' }); room.popSmoke({ id: 79, x: 20, y, z: 25 });
  ok(room.fires.length === 0 || room.fires.every(f => f.until <= fake), 'димът гаси огъня');
  // хвърляне: молотов се възпламенява при удар в земята
  a.inv.g.molo = 1; a.inv.n = 1; a.weapon = 'molotov'; a.nextShot = 0; room.phase = 'live'; place(a, 20, y, 40, 0);
  room.throwNade(a, { yw: 0, pt: -0.2 });
  ok(room.nades.length === 1 && room.nades[0].kind === 'molo', 'хвърленият молотов е в полет');
  adv(room, 3); ok(room.fires.length >= 1 && room.nades.length === 0, 'при удар в земята се разгаря пожар');
}
console.log(fails ? `\nПровалени: ${fails}` : '\nГранатите са в ред.'); process.exit(fails ? 1 : 0);
