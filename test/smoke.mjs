// Автоматичен тест на сървъра (стартира собствен сървър с BS_TEST=1: ускорени таймери + телепорт).
//   npm test
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { DESTRUCTIBLE } from '../shared/world.js';

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
  for (const e of ['lobby', 'gameStart', 'round', 'roundEnd', 'blocks', 'boom', 'msg', 'hit', 'err', 'feed', 'matchEnd', 'bought', 'correct', 'knife', 'reload', 'cos', 'shot'])
    s.on(e, d => { (c.ev[e] ||= []).push(d); });
  s.on('me', m => c.me = m); s.on('snap', m => c.snap = m); s.on('spawn', m => c.spawn = m);
  c.join = () => new Promise(res => s.emit('join', { name, room }, r => { c.id = r.id; res(r); }));
  c.tp = (x, y, z) => s.emit('dbgTp', { x, y, z });
  c.state = (x, y, z, o = {}) => s.emit('state', { x, y, z, yw: 0, pt: 0, cr: false, g: true, wk: false, sc: false, ...o });
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

console.log('— Бомба: носител, магазин, kit');
await until(() => att.me?.mo && def.me?.mo);
ok(att.me.inv.bomb === true && def.me.inv.bomb === false, 'нападателят получава бомбата в началото на рунда');
att.s.emit('buy', 'rifle'); await sleep(150);
ok(att.ev.err?.length >= 1, 'автоматът ($2700) не може да се купи с $800');
att.s.emit('buy', 'armor'); await sleep(200);
ok(att.me.ar === 100 && att.me.mo === 150, `бронята е купена, пари: ${att.me.mo}`);
def.s.emit('buy', 'kit'); await sleep(150);
ok(def.me.kit === true, 'защитникът купува defuse kit');
att.s.emit('buy', 'kit'); await sleep(150);
ok(att.me.kit === false, 'нападателят не може да купи kit');

console.log('— Стрелба (hitscan, авторитетна)');
await until(() => att.snap?.ph === 'live');
ok(att.snap?.ph === 'live', 'фазата става live след замръзването');
att.tp(21.5, 1, 18.5); def.tp(21.5, 1, 8.5); await sleep(200);
for (let i = 0; i < 20 && !att.ev.roundEnd; i++) { att.s.emit('shoot', { yw: 0, pt: -0.121, sc: 0, d: 0 }); await sleep(180); }
ok(att.ev.hit?.length > 0, `попадения: ${att.ev.hit?.length || 0}`);
ok(att.ev.shot?.length > 0 && Array.isArray(att.ev.shot[0].e), 'събитие shot с крайни точки');
ok(att.ev.feed?.some(f => f.k === att.name && f.v === def.name), 'kill feed: убийство регистрирано');
await until(() => att.ev.roundEnd);
ok(att.ev.roundEnd?.[0].win === 'att', 'рундът е спечелен от нападателите (елиминация)');
await sleep(100);

console.log('— Рунд 2: пари, залагане, обезвреждане');
await until(() => att.ev.round?.length >= 2);
ok(att.ev.round?.length >= 2, 'започва рунд 2');
def.s.emit('buy', 'kit'); await sleep(150);
ok(def.me.kit === true, 'defuse kit се купува отново (загубен при смърт)');
await until(() => att.snap?.ph === 'live', 8000);
ok(att.me.mo > 3000, `награда за победа/убийство: $${att.me.mo}`);
ok(att.me.inv.bomb === true, 'бомбата се връща при нападателя (случаен избор)');
att.tp(9.5, 1, 9.5); await sleep(150);
att.s.emit('use', true);
await until(() => att.ev.msg?.some(m => m.t === 'plant'), 6000);
ok(att.ev.msg?.some(m => m.t === 'plant' && m.site === 'A'), 'бомбата е заложена на A след задържане на E');
ok(att.snap?.bomb?.s === 'A' || (await until(() => att.snap?.bomb)), 'бомбата е в snapshot');
att.s.emit('use', false);
def.tp(9.5, 1, 9.5); await sleep(100); def.s.emit('use', true);
await until(() => def.ev.msg?.some(m => m.t === 'defuse'), 9000);
ok(def.ev.msg?.some(m => m.t === 'defuse'), 'защитникът (с kit) обезврежда бомбата с E');
await until(() => def.ev.roundEnd?.length >= 2);
ok(def.ev.roundEnd?.[1]?.win === 'def', 'рундът е спечелен от защитниците');

console.log('— Рунд 3: нов магазин, граната руши дърво');
await until(() => att.ev.round?.length >= 3, 8000);
await sleep(100);
att.s.emit('buy', 'rifle'); att.s.emit('buy', 'grenade'); await sleep(200);
ok(att.me.inv.pr === 'rifle' && att.me.mag === 30, 'автоматът е купен (пълнител 30)');
await until(() => att.snap?.ph === 'live', 8000);
att.s.emit('switch', 'n'); await sleep(550);
att.tp(21.5, 1, 14.5); await sleep(150);
att.s.emit('throw', { yw: 0, pt: -1.5 });
const blk = await until(() => att.ev.blocks?.length, 4000);
ok(blk && att.ev.boom?.length > 0, 'гранатата експлодира');
const broken = att.ev.blocks?.flat().filter(b => DESTRUCTIBLE.has(b[3])) || [];
ok(broken.length > 0, `рушат се дървени/стъклени блокове (${broken.length})`);
ok(att.ev.blocks.flat().every(b => DESTRUCTIBLE.has(b[3])), 'неразрушимите блокове остават');

console.log('— Нож и удар в гръб');
await sleep(2500);
await until(() => att.me?.hp > 0 || att.snap?.ph !== 'live', 1000);
if (att.snap.ph === 'live' && att.me.hp > 0) {
  att.s.emit('switch', 'kn'); await sleep(550);
  att.tp(21.5, 1, 13.5); def.tp(21.5, 1, 12.2); await sleep(100);
  def.state(21.5, 1, 12.2, { yw: Math.PI }); await sleep(100);   // защитникът гледа към +z (към нападателя)
  const h0 = def.me.hp;
  att.s.emit('knife', { k: 'l', yw: 0, pt: 0, d: 0 }); await sleep(200);
  ok(att.ev.knife?.some(k => k.hit), 'ударът с нож улучва');
  ok(def.me.hp < h0 || !def.me.hp, `щети от нож отпред (${h0} -> ${def.me.hp})`);
} else console.log('  (пропуснато: нападателят загина от собствената граната)');

console.log('— Падане и валидация на движението');
await until(() => att.snap?.ph === 'live' || att.ev.round?.length >= 4, 9000);
const before = att.ev.correct?.length || 0;
att.s.emit('state', { x: 40, y: 1, z: 40, yw: 0, pt: 0 }); await sleep(150);
ok((att.ev.correct?.length || 0) > before, 'телепорт/чийт се отхвърля (correct)');

console.log('— Втора карта и нови карти');
const C = client('Цеко', 'W1'); await C.join(); C.s.emit('setMap', 'warehouse'); C.s.emit('start');
await until(() => C.spawn);
ok(C.ev.gameStart?.[0].mapId === 'warehouse', 'warehouse карта се стартира');
for (const id of ['mine', 'snow', 'harbor']) {
  const D = client('Д' + id, 'M' + id); await D.join(); D.s.emit('setMap', id); D.s.emit('start');
  await until(() => D.spawn);
  ok(D.ev.gameStart?.[0].mapId === id && D.spawn, `картата ${id} се стартира`);
  D.s.close();
}

console.log(fails ? `\nПровалени: ${fails}` : '\nВсички проверки минаха.');
for (const c of [A, B, C]) c.s.close();
srv.kill();
process.exit(fails ? 1 : 0);
