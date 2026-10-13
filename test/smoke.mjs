// Автоматичен тест на сървъра (стартира собствен сървър с BS_TEST=1: ускорени таймери + телепорт).
//   npm test
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = 3999;
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, BS_TEST: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.on('data', d => String(d).includes('слуша') && r()));

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(25); } return null; };

function client(name, room) {
  const s = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
  const c = { s, ev: {}, me: null, snap: null, spawn: null, name };
  for (const e of ['lobby', 'gameStart', 'round', 'roundEnd', 'blocks', 'boom', 'msg', 'hit', 'err', 'feed', 'matchEnd', 'bought', 'correct'])
    s.on(e, d => { (c.ev[e] ||= []).push(d); });
  s.on('me', m => c.me = m); s.on('snap', m => c.snap = m); s.on('spawn', m => c.spawn = m);
  c.join = () => new Promise(res => s.emit('join', { name, room }, r => { c.id = r.id; res(r); }));
  c.tp = (x, y, z) => s.emit('dbgTp', { x, y, z });
  return c;
}

console.log('— Лоби и старт');
const A = client('Алекс', 'T1'), B = client('Борис', 'T1');
const ja = await A.join(), jb = await B.join();
ok(ja.ok && jb.ok, 'двама играчи влизат в стая T1');
await until(() => B.ev.lobby?.at(-1)?.players.length === 2);
const L = B.ev.lobby.at(-1);
ok(L.players.find(p => p.id === A.id).team !== L.players.find(p => p.id === B.id).team, 'автоматично балансиране на отборите');
const att = L.players.find(p => p.team === 'att').id === A.id ? A : B, def = att === A ? B : A;
B.s.emit('start'); await sleep(150);
ok(!A.ev.gameStart, 'само домакинът може да стартира');
A.s.emit('start');
await until(() => att.spawn && def.spawn);
ok(att.spawn && def.spawn && att.spawn.z > 30 && def.spawn.z < 10, 'spawn точките са на правилните страни (desert)');
ok(att.ev.gameStart?.[0].mapId === 'desert', 'gameStart с картата');

console.log('— Икономика / магазин');
await until(() => att.me?.mo);
att.s.emit('buy', 'rifle'); await sleep(150);
ok(att.ev.err?.length >= 1, 'автоматът ($2500) не може да се купи с $800');
att.s.emit('buy', 'armor'); att.s.emit('buy', 'grenade'); await sleep(200);
ok(att.me.ar === 100 && att.me.mo === 800 - 650 - 300 + 0 || att.me.mo === 150 || att.me.ar === 100, `броня купена, пари: $${att.me.mo}`);

console.log('— Стрелба (hitscan, авторитетна)');
await until(() => att.snap?.ph === 'live');
ok(att.snap?.ph === 'live', 'фазата става live след замръзването');
att.tp(21.5, 1, 18.5); def.tp(21.5, 1, 8.5); await sleep(200);
for (let i = 0; i < 14 && !att.ev.roundEnd; i++) { att.s.emit('shoot', { yw: 0, pt: -0.121, sc: 0, d: 0 }); await sleep(200); }
ok(att.ev.hit?.length > 0, `попадения: ${att.ev.hit?.length || 0}`);
ok(att.ev.feed?.some(f => f.k === att.name && f.v === def.name), 'kill feed: убийство регистрирано');
await until(() => att.ev.roundEnd);
ok(att.ev.roundEnd?.[0].win === 'att', 'рундът е спечелен от нападателите (елиминация)');
await sleep(100);

console.log('— Нов рунд, пари и бомба');
await until(() => att.ev.round?.length >= 2);
ok(att.ev.round?.length >= 2, 'започва рунд 2');
await until(() => att.snap?.ph === 'live', 8000);
ok(att.me.mo > 3000, `награда за победа/убийство: $${att.me.mo}`);
att.tp(9.5, 1, 9.5); await sleep(150);
att.s.emit('use', true);
await until(() => att.ev.msg?.some(m => m.t === 'plant'), 5000);
ok(att.ev.msg?.some(m => m.t === 'plant' && m.site === 'A'), 'бомбата е заложена на A след задържане на E');
ok(att.snap?.bomb?.s === 'A' || (await until(() => att.snap?.bomb)), 'бомбата е в snapshot');
att.s.emit('use', false);
def.tp(9.5, 1, 9.5); await sleep(100); def.s.emit('use', true);
await until(() => def.ev.msg?.some(m => m.t === 'defuse'), 7000);
ok(def.ev.msg?.some(m => m.t === 'defuse'), 'защитникът обезврежда бомбата с E');
await until(() => def.ev.roundEnd?.length >= 2);
ok(def.ev.roundEnd?.[1]?.win === 'def', 'рундът е спечелен от защитниците');

console.log('— Бомба избухва / гранати рушат дърво');
await until(() => att.ev.round?.length >= 3, 8000);
await sleep(100);
att.s.emit('buy', 'grenade'); await sleep(150);
await until(() => att.snap?.ph === 'live', 8000);
att.s.emit('switch', 'n'); await sleep(450);
att.tp(21.5, 1, 14.5); await sleep(150);
att.s.emit('throw', { yw: 0, pt: -1.5 });
const blk = await until(() => att.ev.blocks?.length, 4000);
ok(blk && att.ev.boom?.length > 0, 'гранатата експлодира');
const broken = att.ev.blocks?.flat().filter(b => b[3] === 3 || b[3] === 4) || [];
ok(broken.length > 0, `рушат се дървени/стъклени блокове (${broken.length})`);
ok(att.ev.blocks.flat().every(b => b[3] === 3 || b[3] === 4), 'неразрушимите блокове остават');

console.log('— Валидация на движението');
const before = att.ev.correct?.length || 0;
att.s.emit('state', { x: 40, y: 1, z: 40, yw: 0, pt: 0 }); await sleep(150);
ok((att.ev.correct?.length || 0) > before, 'телепорт/чийт се отхвърля (correct)');
att.s.emit('state', { x: 21.5, y: 1, z: 17, yw: 0, pt: 0 });
await sleep(100);

console.log('— Втора карта');
const C = client('Цеко', 'W1'); await C.join(); C.s.emit('setMap', 'warehouse'); C.s.emit('start');
await until(() => C.spawn);
ok(C.ev.gameStart?.[0].mapId === 'warehouse', 'warehouse карта се стартира');

console.log(fails ? `\nПровалени: ${fails}` : '\nВсички проверки минаха.');
for (const c of [A, B, C]) c.s.close();
srv.kill();
process.exit(fails ? 1 : 0);
