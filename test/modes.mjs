// Тест на режимите като таблица (shared/modes.js) и на това, че сървърът ги ползва: флагове, непознат режим, поведение на стая.
let fake = 1_700_000_000_000; Date.now = () => fake;
const realSI = globalThis.setInterval; globalThis.setInterval = () => 0; process.env.PORT = '0';
const { __test } = await import('../server/index.js'); globalThis.setInterval = realSI;
const { GAME_MODES, MODE_IDS, modeOf } = await import('../shared/modes.js');
const { Room } = __test;
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

console.log('— Таблица');
ok(MODE_IDS.join() === 'comp,parkour,surf', 'режимите са comp, parkour, surf');
ok(modeOf('nope') === GAME_MODES.comp && modeOf(undefined) === GAME_MODES.comp, 'непознат режим = състезателен');
const c = GAME_MODES.comp, p = GAME_MODES.parkour, s = GAME_MODES.surf;
ok(c.kind === 'rounds' && c.rounds && c.teams && c.bots && c.shop && c.combat && !c.race && c.fallDamage && c.mapMax, 'comp: рундове, отбори, ботове, магазин, стрелба, падане, лимит от картата');
ok(p.kind === 'race' && !p.rounds && !p.teams && !p.bots && !p.shop && !p.combat && p.race && !p.fallDamage && !p.mapMax, 'parkour: състезание без отбори, ботове, магазин и стрелба');
ok(s.kind === 'race' && s.race && s.move.h === 95 && p.move.h === 14 && c.move.h === 13 && s.move.inst === 110 && c.move.inst === 14, 'скоростните лимити са като преди (comp 13/16, parkour 14/18, surf 95/95)');
ok(Object.values(GAME_MODES).every(m => m.id && m.name && m.move), 'всеки режим има id, име и лимити');

console.log('— Стая');
const room = new Room('MODE'); room.emit = () => { };
ok(room.mode === 'comp' && room.cfg === c && room.run === false, 'нова стая е comp; run е лъжа');
room.mode = 'parkour'; ok(room.cfg === p && room.run === true, 'parkour: cfg и run (състезание)');
room.mode = 'surf'; ok(room.cfg === s && room.run === true, 'surf: cfg и run');
room.mode = 'comp';
const sock = { id: 'H1', emit() { }, join() { } }; const me = room.addPlayer(sock, 'Хума'); me.team = 'att';
ok(room.addBot('def', 'easy') !== null, 'в comp може да се добави бот');
room.mode = 'parkour'; ok(room.addBot('def', 'easy') === null, 'в parkour няма ботове');
room.mode = 'comp'; room.removePlayer([...room.players.values()].find(q => q.bot).id);
console.log(fails ? `\nПровалени: ${fails}` : '\nРежимите като таблица са в ред.'); process.exit(fails ? 1 : 0);
