// Прост бот за ръчно тестване: влиза в стая, върви напред-назад, сменя оръжия и стреля.
//   node tools/bot.mjs ROOM [име] [оръжие-слот: pr|se|kn|n] [нож] [скин]
import { io } from 'socket.io-client';
const [room = 'DEMO', name = 'Бот', slot = 'se', knife = 'karambit', skin = 'lava'] = process.argv.slice(2);
const s = io('http://localhost:' + (process.env.PORT || 3000), { transports: ['websocket'] });
let me = null, snap = null, t0 = 0;
s.on('connect', () => s.emit('join', { name, room }, r => {
  console.log('бот влезе', r.code);
  s.emit('loadout', { knife, skins: { rifle: skin, pistol: skin, sniper: skin, smg: skin, deagle: skin, shotgun: skin, ['knife_' + knife]: skin } });
}));
s.on('lobby', L => { if (L.hostId === s.id && L.phase === 'lobby' && L.players.length >= 2 && !s.started) { s.started = true; setTimeout(() => s.emit('start'), 500); } });
s.on('me', m => { me = m; });
s.on('snap', x => { snap = x; });
s.on('spawn', p => { t0 = Date.now(); s.pos = { ...p }; });
setInterval(() => {
  if (!s.pos || !me || me.hp <= 0) return;
  const t = (Date.now() - t0) / 1000;
  const walk = Math.sin(t * 0.5) > 0;
  s.pos.z += walk ? 0.06 : -0.06;
  s.emit('state', { x: s.pos.x, y: s.pos.y, z: s.pos.z, yw: Math.PI, pt: 0, cr: false, g: true, wk: false, sc: false });
  if (me && me.w !== (slot === 'kn' ? 'knife' : me.w)) s.emit('switch', slot);
}, 33);
setTimeout(() => s.emit('switch', slot), 2000);
console.log('бот работи; Ctrl+C за изход');
