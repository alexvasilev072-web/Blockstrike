// Тест на хвърляне/вдигане на оръжия: G, смърт, автоматично вдигане, размяна (E), забрана за незабавно вдигане, лимит на брой.
let fake = 1_700_000_000_000; Date.now = () => fake;
const realSI = globalThis.setInterval; globalThis.setInterval = () => 0; process.env.PORT = '0';
const { __test } = await import('../server/index.js'); globalThis.setInterval = realSI;
const { Room } = __test;
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const adv = (room, sec) => { for (let i = 0; i < Math.round(sec * 30); i++) { fake += 33; room.tick(fake); } };

const room = new Room('DROP'); room.mapId = 'dunes'; room.emit = () => { };
const got = [], sock = { id: 'H1', emit(n, d) { if (n === 'got') got.push(d); }, join() { } };
const me = room.addPlayer(sock, 'Хума'); me.team = 'att';
const foe = room.addBot('def', 'easy'); room.addBot('att', 'easy'); room.addBot('def', 'easy');
room.startMatch(); me.ready = true; adv(room, 14);
ok(room.phase === 'live', 'рундът е в live');
for (const b of room.players.values()) if (b.bot) { b.bot.update = () => { }; }       // ботовете стоят
room.items = [];                                              // оръжия, паднали от убити в първите секунди

console.log('— G: хвърляне');
room.giveWeapon(me, 'rifle'); me.money = 0;
me.yw = 0; me.pt = 0; me.weapon = 'rifle';
ok(room.dropHeld(me) === undefined && me.inv.pr === null && !me.ammo.rifle, 'основното оръжие излиза от инвентара');
ok(me.weapon === 'pistol', 'автоматично минава на следващото налично оръжие (пистолет)');
ok(room.items.length === 1 && room.items[0].w === 'rifle' && room.items[0].mag === 30 && room.items[0].res === 90, 'на земята е оръжието с патроните му');
adv(room, 2.5);
const it = room.items[0];
ok(it.rest, 'оръжието пада и спира на земята');
ok(Math.hypot(it.x - me.x, it.z - me.z) > 1.5, 'излита напред (на повече от 1.5 м)');
ok(!me.ammo.rifle && me.inv.pr === null, 'само хвърленото оръжие не е вдигнато обратно автоматично (далеч е)');

console.log('— автоматично вдигане и забрана ~1 с');
const sv = { x: me.x, z: me.z }; me.x = it.x; me.z = it.z; me.y = it.y;
const it2 = room.spawnItem('smg', null, me.x, me.y + 0.2, me.z, 0, 0, 0, me.id); it2.rest = true;
room.pickItems(fake);
ok(room.items.some(q => q.id === it2.id), 'току-що хвърлено от теб не се взима веднага');
ok(me.inv.pr === 'rifle' && me.ammo.rifle.mag === 30 && me.ammo.rifle.res === 90, 'празен слот: взима се автоматично, с патроните');
adv(room, 1.2);
ok(me.inv.pr === 'rifle', 'след 1 с вече е взето/слотът е зает');
ok(got.length >= 1, 'играчът получава „got“ за звука');

console.log('— размяна (E)');
const sm = room.items.find(q => q.w === 'smg') || room.spawnItem('smg', { mag: 11, res: 22 }, me.x + 0.5, me.y, me.z, 0, 0, 0, null);
sm.mag = 11; sm.res = 22; sm.rest = true; sm.owner = null;
ok(room.swapItem(me, sm.id) === true, 'размяната успява близо до оръжието');
ok(me.inv.pr === 'smg' && me.ammo.smg.mag === 11 && me.weapon === 'smg', 'слотът получава новото оръжие с патроните му');
ok(room.items.some(q => q.w === 'rifle' && q.mag === 30), 'старото пада на земята');
me.x += 30; ok(room.swapItem(me, room.items[0].id) === false, 'твърде далеч – размяната е отказана');
me.x -= 30;

console.log('— смърт');
room.giveWeapon(foe, 'sniper'); const before = room.items.length;
room.hurt(foe, me, 1000, 'rifle', true, {});
ok(foe.inv.pr === null && foe.inv.se === null, 'умрелият изпуска основното и пистолета');
ok(room.items.length === before + 2, 'и двете оръжия са на земята');

console.log('— лимит и нов рунд');
for (let i = 0; i < 40; i++) room.spawnItem('pistol', null, 5, 20, 5, 0, 0, 0, null);
ok(room.items.length <= 30, 'най-много 30 оръжия на картата (най-старите изчезват)');
room.nextRound();
ok(room.items.length === 0, 'оръжията на земята изчезват в началото на новия рунд');
console.log(fails ? `\nПровалени: ${fails}` : '\nХвърлянето и вдигането на оръжия са в ред.'); process.exit(fails ? 1 : 0);
