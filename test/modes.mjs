// Тест на режимите като таблица (shared/modes.js) и на това, че сървърът ги ползва: флагове, непознат режим, поведение на стая.
let fake = 1_700_000_000_000; Date.now = () => fake;
const realSI = globalThis.setInterval; globalThis.setInterval = () => 0; process.env.PORT = '0';
const { __test } = await import('../server/index.js'); globalThis.setInterval = realSI;
const { GAME_MODES, MODE_IDS, modeOf } = await import('../shared/modes.js');
const { Room } = __test;
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

console.log('— Таблица');
ok(MODE_IDS.join() === 'comp', 'остава един режим: comp (parkour и surf са премахнати)');
ok(modeOf('parkour') === GAME_MODES.comp && modeOf('nope') === GAME_MODES.comp && modeOf(undefined) === GAME_MODES.comp, 'непознат (или премахнат) режим = състезателен');
const c = GAME_MODES.comp;
ok(c.kind === 'rounds' && c.rounds && c.teams && c.bots && c.shop && c.combat && c.fallDamage && c.mapMax, 'comp: рундове, отбори, ботове, магазин, стрелба, падане, лимит от картата');
ok(c.move.h === 13 && c.move.v === 16 && c.move.inst === 14, 'лимитите на скоростта са 13/16 (моментна 14)');
ok(Object.values(GAME_MODES).every(m => m.id && m.name && m.move), 'всеки режим има id, име и лимити');

console.log('— Стая');
const room = new Room('MODE'); room.emit = () => { };
ok(room.mode === 'comp' && room.cfg === c, 'нова стая е comp и ползва cfg от таблицата');
const sock = { id: 'H1', emit() { }, join() { } }; const me = room.addPlayer(sock, 'Хума'); me.team = 'att';
ok(room.addBot('def', 'easy') !== null, 'в comp може да се добави бот');
room.mode = 'zombie'; ok(room.cfg === c, 'непознат режим в стаята се третира като comp');
console.log(fails ? `\nПровалени: ${fails}` : '\nРежимите като таблица са в ред.'); process.exit(fails ? 1 : 0);
