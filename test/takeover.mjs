// Тест на наблюдението и „Поеми бота“: данни за HUD-а на наблюдавания, поемане на бот (само мъртъв играч, само бот от своя отбор).
let fake = 1_700_000_000_000; Date.now = () => fake;
const realSI = globalThis.setInterval; globalThis.setInterval = () => 0; process.env.PORT = '0';
const { __test } = await import('../server/index.js'); globalThis.setInterval = realSI;
const { Room } = __test;
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const adv = (room, sec) => { for (let i = 0; i < Math.round(sec * 30); i++) { fake += 33; room.tick(fake); } };

const room = new Room('TAKE'); room.mapId = 'dunes'; room.emit = () => { };
const ev = [], sock = { id: 'H1', emit(n, d) { ev.push([n, d]); }, join() { } };
const human = room.addPlayer(sock, 'Хума'); human.team = 'att';
const mate = room.addBot('att', 'easy'), enemy = room.addBot('def', 'easy'); room.addBot('def', 'easy'); room.addBot('att', 'easy');
room.startMatch(); human.ready = true; adv(room, 14);
ok(room.phase === 'live', 'рундът е в live');
for (const b of room.players.values()) if (b.bot) b.bot.update = () => { };       // ботовете стоят (иначе стрелят и броячът на патроните се мени)
const me = () => [...ev].reverse().find(e => e[0] === 'me')?.[1];

console.log('— Наблюдение: данни за наблюдавания');
mate.hp = 63; mate.armor = 100; mate.inv.pr = 'rifle'; mate.weapon = 'rifle'; mate.ammo.rifle = { mag: 17, res: 60 };
human.specId = mate.id; adv(room, 0.2);
ok(me()?.sp === null || me()?.sp === undefined, 'докато си жив, няма данни за наблюдавания');
room.hurt(human, null, 1000, 'bomb', false, { ignoreTeam: true, noArmor: true }); adv(room, 0.3);
const s = me()?.sp;
ok(s && s.id === mate.id && s.hp === 63 && s.ar === 100 && s.w === 'rifle' && s.mag === 17 && s.res === 60, `мъртвият получава hp/броня/оръжие/патрони на наблюдавания (${JSON.stringify(s)})`);
human.specId = enemy.id; adv(room, 0.2);
ok(!me()?.sp, 'противников играч не може да се наблюдава (няма данни)');

console.log('— Поеми бота');
ok(room.takeOver(human, enemy.id) === false && !human.alive, 'не може да поемеш бот от противниковия отбор');
const posBefore = { x: mate.x, y: mate.y, z: mate.z };
const botsAlive = [...room.players.values()].filter(p => p.alive && p.team === 'att').length;
ok(room.takeOver(human, mate.id) === true, 'поемането на бот от своя отбор успява');
ok(human.alive && human.hp === 63 && human.armor === 100 && human.weapon === 'rifle' && human.ammo.rifle.mag === 17, 'получаваш здравето, бронята, оръжието и патроните на бота');
ok(Math.abs(human.x - posBefore.x) < 1e-6 && Math.abs(human.z - posBefore.z) < 1e-6, 'позицията е същата като на бота');
ok(!mate.alive && mate.possessedBy === human.id, 'ботът остава мъртъв за рунда');
const sp = ev.filter(e => e[0] === 'spawn').pop()?.[1];
ok(sp && sp.takeover === mate.name && sp.quiet, 'клиентът получава „spawn“ със знак за поемане');
const attAlive = [...room.players.values()].filter(p => p.alive && p.team === 'att').length;
ok(attAlive === botsAlive, 'броят живи в отбора остава същият');
ok(room.takeOver(human, mate.id) === false, 'не можеш да поемеш втори път (вече си жив / ботът е мъртъв)');
adv(room, 1); ok(human.alive && Math.abs(human.x - posBefore.x) < 0.5, 'след няколко тика всичко е стабилно');
console.log(fails ? `\nПровалени: ${fails}` : '\nНаблюдението и поемането на бот са в ред.'); process.exit(fails ? 1 : 0);
