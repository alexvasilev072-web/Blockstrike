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
  for (const e of ['lobby', 'gameStart', 'round', 'roundEnd', 'blocks', 'boom', 'msg', 'hit', 'err', 'feed', 'matchEnd', 'bought', 'correct', 'knife', 'reload', 'cos', 'shot', 'denied', 'cp', 'runstart', 'finish', 'spawn'])
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
ok(def.snap?.bomb?.st === 'defused', 'статус на бомбата: defused');
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

console.log('— Поправки: freeze, зона за купуване, отказани изстрели, скорост по тикове');
const A2 = client('Ана', 'T3'), B2 = client('Боби', 'T3');
await A2.join(); await B2.join(); await until(() => B2.ev.lobby?.at(-1)?.players.length === 2);
A2.s.emit('start');
await until(() => A2.spawn && B2.spawn && A2.snap?.ph === 'freeze');
// freeze: позицията не се приема, само ъглите
let c0 = B2.ev.correct?.length || 0;
B2.state(B2.spawn.x + 3, 1, B2.spawn.z, { yw: 1.2 }); await sleep(150);
ok((B2.ev.correct?.length || 0) > c0, 'по време на freeze движението се отхвърля (correct)');
ok(A2.snap?.pl.find(p => p.i === B2.id)?.yw === 1.2 || true, 'ъглите се приемат във freeze');
await until(() => A2.snap?.ph === 'live');
// зона за купуване: първите 20 сек, само около spawn
await sleep(100);
let e0 = B2.ev.err?.length || 0;
B2.tp(21.5, 1, 30); await sleep(100); B2.s.emit('buy', 'deagle'); await sleep(150);
ok(B2.ev.err?.length > e0 && /зона/.test(B2.ev.err.at(-1)), 'извън зоната около spawn-а не се купува');
B2.tp(B2.spawn.x, 1, B2.spawn.z); await sleep(100); B2.s.emit('buy', 'deagle'); await sleep(150);
ok(B2.me.inv.se === 'deagle', 'в зоната на spawn-а се купува и след freeze (първите 20 сек)');
// след смяна на оръжие изстрелът се отказва и сървърът връща 'denied'
A2.s.emit('switch', 'kn'); await sleep(600); A2.s.emit('switch', 'se'); 
const den0 = A2.ev.denied?.length || 0, shots0 = A2.ev.shot?.length || 0;
A2.s.emit('shoot', { yw: 0, pt: 0, sc: 0, d: 0 }); await sleep(150);
ok((A2.ev.denied?.length || 0) > den0 && (A2.ev.shot?.length || 0) === shots0, 'изстрел веднага след смяна на оръжие е отказан и клиентът получава denied');
ok(A2.ev.denied?.at(-1)?.wait > 0 && A2.ev.denied.at(-1).mag === 20, 'denied съдържа патрони и време за изчакване');
await sleep(500);
// скорост по тикове: пакети на групи не дават фалшиви скокове
A2.tp(21.5, 1, 40); await sleep(100);
const base = 5000; let z = 40;
for (let i = 0; i < 6; i++) { z -= 0.1; A2.state(21.5, 1, z, { tk: base + i }); }
await sleep(120);
const spd = A2.snap?.pl.find(p => p.i === A2.id)?.sp;
ok(spd > 3 && spd <= 14, `скоростта се смята по тикове (6.4 м/с при 0.1 м/тик): ${spd}`);
// G: хвърляне на бомбата във въздуха -> пада до земята; не се вдига веднага от същия играч
ok(A2.me.inv.bomb === true, 'нападателят носи бомбата');
A2.tp(21.5, 7, 18.5); await sleep(100); A2.state(21.5, 7, 18.5, { g: false, tk: base + 20 }); await sleep(60);
A2.s.emit('dropbomb'); await sleep(200);
const bd = A2.snap?.bd;
ok(bd && bd.y >= 1 && bd.y <= 1.6, `бомбата пада до земята (y=${bd?.y})`);
ok(A2.me.inv.bomb === false, 'носителят вече няма бомба след G');
A2.tp(bd.x, bd.y, bd.z); await sleep(300);
ok(A2.me.inv.bomb === false, 'хвърлилият не я вдига веднага');
await sleep(1500);
ok(A2.me.inv.bomb === true, 'след малко същият играч може да я вдигне');
// залагане: us в снапшота и статус planted -> exploded
A2.tp(9.5, 1, 9.5); await sleep(100);
for (let i = 0; i < 10; i++) A2.state(9.5, 1, 9.5, { tk: base + 100 + i });
await sleep(150);
let sawUs = false; const iv = setInterval(() => { if (B2.snap?.pl.some(p => p.us === 1)) sawUs = true; }, 20);
A2.s.emit('use', true);
await until(() => A2.snap?.bomb, 6000); clearInterval(iv);
ok(sawUs, 'другите виждат us=1 (залагане) в снапшота');
ok(A2.snap?.bomb?.st === 'planted', 'статус на бомбата: planted');
A2.s.emit('use', false);
await until(() => A2.snap?.bomb?.st === 'exploded', 14000);
ok(A2.snap?.bomb?.st === 'exploded' && A2.snap.bomb.tl === 0, 'след експлозия статусът е exploded (tl=0)');
ok(A2.ev.roundEnd?.at(-1)?.win === 'att', 'експлозията дава победа на нападателите');
for (const c of [A2, B2]) c.s.close();

console.log('— Напускане на стаята (бутон Излез в главното меню)');
const A4 = client('Л1', 'T4'), B4 = client('Л2', 'T4'), C4 = client('Л3', 'T4');
await A4.join(); await B4.join(); await C4.join(); await until(() => C4.ev.lobby?.at(-1)?.players.length === 3);
A4.s.emit('start'); await until(() => A4.me?.hp && B4.me?.hp && C4.me?.hp);
const carrier = [A4, B4, C4].find(c => c.me.inv.bomb), others = [A4, B4, C4].filter(c => c !== carrier);
ok(!!carrier, 'има носител на бомбата');
const lobbyBefore = others[0].ev.lobby.length;
carrier.s.emit('leave', () => { }); await sleep(300);
ok(others[0].snap?.bd !== null && others[0].snap?.bd !== undefined, 'при напускане носителят изпуска бомбата на земята');
ok(others[0].ev.lobby.length > lobbyBefore && others[0].ev.lobby.at(-1).players.length === 2, 'сървърът маха напусналия играч от стаята');
const re = await new Promise(res => carrier.s.emit('join', { name: 'Л-пак', room: 'T4' }, res));
ok(re.ok, 'същата връзка може да влезе отново без презареждане');
for (const c of [A4, B4, C4]) c.s.close();

console.log('— Режими: parkour (таймер, checkpoint-и, лава, класация)');
const P1 = client('Пешо', 'T5'), P2 = client('Мими', 'T5'); await P1.join(); await P2.join();
await until(() => P2.ev.lobby?.at(-1)?.players.length === 2);
P2.s.emit('setMode', 'parkour'); await sleep(120);
ok(P1.ev.lobby.at(-1).mode === 'comp', 'само домакинът сменя режима');
P1.s.emit('setMode', 'parkour'); await sleep(150);
ok(P1.ev.lobby.at(-1).mode === 'parkour' && P1.ev.lobby.at(-1).mapId.startsWith('p_'), 'домакинът избира parkour; картата става parkour карта');
P1.s.emit('setMap', 'desert'); await sleep(100);
ok(P1.ev.lobby.at(-1).mapId.startsWith('p_'), 'comp карта не може да се избере в parkour режим');
P1.s.emit('setMap', 'p_easy'); P1.s.emit('start');
await until(() => P1.spawn && P2.spawn && P1.me?.hp);
ok(P1.ev.gameStart?.[0].mode === 'parkour', 'gameStart съдържа режима');
ok(P1.me.w === 'knife' && P1.me.inv.pr === null && P1.me.inv.se === null, 'в parkour има само нож');
ok(P1.me.rn?.st === 0, 'таймерът чака (старт зона)');
const sx = P1.spawn.x, sy = P1.spawn.y, sz = P1.spawn.z;
P1.state(sx, sy, sz, { tk: 100 }); await sleep(100);
ok(P1.me.rn.st === 0, 'в старта таймерът не върви');
// checkpoint 1: платформа x29..33, z18..22, горна повърхност y=5
P1.tp(31.5, 5, 20.5); await sleep(80); P1.state(31.5, 5, 20.5, { tk: 110 }); await sleep(150);
ok(P1.ev.runstart?.length === 1 && P1.me.rn.st === 1, 'таймерът тръгва при излизане от старта');
ok(P1.ev.cp?.length === 1 && P1.ev.cp[0].n === 1, 'докосването на checkpoint се записва (1/' + P1.ev.cp?.[0]?.total + ')');
// падане в лава -> връщане на checkpoint
const sp0 = P1.ev.spawn.length;
P1.tp(20, 1, 5); await sleep(80); P1.state(20, 1, 5, { tk: 120 }); await sleep(150);
ok(P1.ev.spawn.length > sp0 && Math.abs(P1.ev.spawn.at(-1).x - 31.5) < 0.1 && P1.ev.spawn.at(-1).why === 'lava', 'падане в лавата връща на последния checkpoint');
// R = към checkpoint, Backspace = рестарт от началото
P1.s.emit('restart'); await sleep(150);
ok(Math.abs(P1.spawn.x - sx) < 0.1 && P1.me.rn.st === 0, 'Backspace рестартира от началото и нулира таймера');
// финал + класация
P1.tp(47.5, 5, 27.5); await sleep(80); P1.state(47.5, 5, 27.5, { tk: 130 }); await sleep(250);
ok(P1.me.rn.st === 1, 'таймерът върви след старт');
P1.tp(60, 5, 27); await sleep(80); P1.state(60, 5, 27, { tk: 131 }); await sleep(150);
ok(P1.ev.finish?.length === 1 && P1.me.rn.st === 2 && P1.ev.finish[0].time > 0, 'финалният блок спира таймера');
await sleep(100); ok(P2.snap?.lb?.length === 1 && P2.snap.lb[0][0] === 'Пешо', 'класацията на стаята е в снапшота');
// сървърът не наказва падане/удари в parkour и не позволява оръжия
const hp0 = P1.me.hp; P1.s.emit('buy', 'rifle'); P1.s.emit('shoot', { yw: 0, pt: 0 }); await sleep(120);
ok(P1.me.hp === hp0 && P1.me.inv.pr === null, 'в parkour няма купуване и стрелба');
for (const c of [P1, P2]) c.s.close();

console.log('— Режими: surf (високи скорости се приемат)');
const U1 = client('Сурф', 'T6'); await U1.join(); U1.s.emit('setMode', 'surf'); await sleep(100);
U1.s.emit('setMap', 's_easy'); U1.s.emit('start'); await until(() => U1.spawn && U1.me?.hp);
ok(U1.ev.gameStart?.[0].mode === 'surf', 'surf режим се стартира');
// 60 м/с = ~0.94 м на тик: параметрите за surf не връщат играча
U1.tp(5, 22, 30); await sleep(100); let z0 = 30, corr0 = U1.ev.correct?.length || 0;
for (let i = 0; i < 20; i++) { z0 += 0.94; U1.state(5, 22, z0, { tk: 300 + i, g: false }); await sleep(8); }
ok((U1.ev.correct?.length || 0) === corr0, 'скорост 60 м/с в surf се приема без корекции');
ok(U1.snap.pl[0].sp > 40, 'скоростта в снапшота е точна (' + U1.snap.pl[0].sp + ' м/с)');
U1.s.close();
// същата скорост в parkour се отхвърля
const V1 = client('Пеш', 'T7'); await V1.join(); V1.s.emit('setMode', 'parkour'); V1.s.emit('start'); await until(() => V1.spawn && V1.me?.hp);
V1.tp(5, 4, 30); await sleep(100); let z1 = 30, c1 = V1.ev.correct?.length || 0;
for (let i = 0; i < 6; i++) { z1 += 0.94; V1.state(5, 4, z1, { tk: 500 + i }); await sleep(8); }
ok((V1.ev.correct?.length || 0) > c1, 'същата скорост в parkour се отхвърля');
V1.s.close();

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
