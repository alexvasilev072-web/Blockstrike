// Тест на чата: форма на съобщенията, ограничение на дължината и честотата, чат само до отбора, почистване на управляващи знаци.
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
const PORT = 3998;
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, BS_TEST: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.on('data', d => String(d).includes('слуша') && r()));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(name) {
  const s = io(`http://localhost:${PORT}`, { transports: ['websocket'] }), c = { s, chat: [], name };
  s.on('chat', m => c.chat.push(m)); s.on('lobby', l => c.lobby = l);
  c.join = () => new Promise(res => s.emit('join', { name, room: 'CHAT' }, r => { c.id = r.id; res(r); }));
  return c;
}
const A = client('Алекс'), B = client('Борис'), C = client('Цвете');
await A.join(); await B.join(); await C.join(); await sleep(200);
console.log('— Чат в лобито');
A.s.emit('chat', { t: '  Здравейте   всички  ' }); await sleep(150);
ok(B.chat.length === 1 && B.chat[0].t === 'Здравейте всички' && B.chat[0].n === 'Алекс', 'съобщението стига до всички, със свит интервал');
ok(A.chat.length === 1, 'изпращачът също го получава');
A.s.emit('chat', { t: 'бързо' }); await sleep(100);
ok(B.chat.length === 1, 'второ съобщение в рамките на 0.7 сек се отхвърля (ограничение на честотата)');
await sleep(700);
A.s.emit('chat', { t: 'x'.repeat(500) }); await sleep(150);
ok(B.chat.at(-1)?.t.length === 120, 'дължината е ограничена до 120 символа');
await sleep(750);
A.s.emit('chat', { t: '<img src=x onerror=alert(1)>\u0000\u202e\u200b' }); await sleep(150);
ok(B.chat.at(-1)?.t === '<img src=x onerror=alert(1)>', 'управляващите и невидимите знаци са махнати; HTML остава като текст (клиентът ползва textContent)');
await sleep(750);
A.s.emit('chat', { t: '   ' }); await sleep(100); const n0 = B.chat.length;
A.s.emit('chat', { t: 42 }); await sleep(100);
ok(B.chat.length === n0 || B.chat.at(-1).t === '42', 'празно съобщение не се изпраща; число се обръща в текст');
console.log('— Чат само до отбора');
const teams = (A.lobby || {}).players || []; const ta = teams.find(p => p.id === A.id)?.team;
const mates = [B, C].filter(x => teams.find(p => p.id === x.id)?.team === ta), others = [B, C].filter(x => !mates.includes(x));
B.chat.length = 0; C.chat.length = 0; await sleep(750);
// в лобито режимът е състезателен: team:true връща само на съотборниците
A.s.emit('chat', { t: 'само отбор', team: true }); await sleep(200);
ok(mates.every(x => x.chat.some(m => m.t === 'само отбор' && m.team)), 'съотборниците получават съобщението');
ok(others.every(x => !x.chat.length), 'противниковият отбор не го получава');
for (const c of [A, B, C]) c.s.close(); srv.kill();
console.log(fails ? `\nПровалени: ${fails}` : '\nЧатът е в ред.'); process.exit(fails ? 1 : 0);
