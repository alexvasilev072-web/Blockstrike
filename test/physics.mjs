// Тест на общото физично ядро (shared/physics.js) без браузър и без сървър.
//   node test/physics.mjs
import fs from 'node:fs';
import { World, BLOCK } from '../shared/world.js';
import { makeBody, stepBody, platformsAt } from '../shared/physics.js';
import { MOVE } from '../shared/weapons.js';

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fails++; };
const STEP = MOVE.STEP;

function world(sx, sy, sz, ops) { const w = new World(sx, sy, sz); for (const [b, x1, y1, z1, x2, y2, z2] of ops) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) w.set(x, y, z, BLOCK[b]); return w; }
const IDLE = { can: true, fx: 0, fz: 0, crouch: false, walk: false, jumpNow: false, jumpHeld: false };
function run(B, W, secs, inp = IDLE, mode = 'comp', extra = {}) {
  const ev = []; const ctx = { world: W, vmax: 6.25, mode, emit: (n, d) => ev.push(n), ...extra };
  const n = Math.round(secs / STEP);
  for (let i = 0; i < n; i++) { const t = i * STEP; stepBody(B, typeof inp === 'function' ? inp(i, B) : inp, { ...ctx, platforms: extra.platDefs ? platformsAt(extra.platDefs, (extra.t0 || 0) + t, STEP) : ctx.platforms }, STEP); }
  return ev;
}
const body = (x, y, z, o = {}) => { const B = makeBody(); B.pos = { x, y, z }; Object.assign(B, o); return B; };

console.log('— Основно движение');
{
  const W = world(40, 12, 40, [['concrete', 0, 0, 0, 39, 0, 39]]);
  const B = body(5, 1, 20); run(B, W, 0.4);
  ok(B.onGround, 'стои на пода');
  run(B, W, 1.2, { ...IDLE, fz: -1 }); B.yaw = 0;
  ok(Math.abs(B.speed - 6.25) < 0.05, `скорост на тичане ${B.speed.toFixed(2)} м/с (нож 6.25)`);
  const B2 = body(20, 1, 20); run(B2, W, 0.3); let top = 1;
  run(B2, W, 1, (i) => ({ ...IDLE, jumpNow: i === 0 })); // скок
  const B3 = body(20, 1, 20); run(B3, W, 0.3); const ys = []; run(B3, W, 1, (i, b) => { ys.push(b.pos.y); return { ...IDLE, jumpNow: i === 0 }; });
  ok(Math.max(...ys) > 2.35 && Math.max(...ys) < 2.5, `височина на скока ${(Math.max(...ys) - 1).toFixed(2)} м (CS ~1.43)`);
}

console.log('— Вода: плуване и излизане');
{
  // басейн 8x8, вода на y=1..2, дъно y=0; ръб (кей) на y=1..2 отдясно (x>=10): повърхността е на нивото на кея
  const W = world(30, 12, 30, [['concrete', 0, 0, 0, 29, 0, 29], ['concrete', 10, 1, 0, 29, 1, 29], ['water', 0, 1, 0, 9, 1, 29]]);
  const B = body(5, 1, 15); run(B, W, 0.5);
  ok(B.inWater, 'играчът е във водата');
  run(B, W, 1, { ...IDLE, jumpHeld: true });
  ok(B.pos.y > 1.2, `Space плува нагоре (y=${B.pos.y.toFixed(2)})`);
  const B2 = body(5, 2.4, 15); B2.inWater = true; run(B2, W, 0.8, { ...IDLE, crouch: true });
  ok(B2.pos.y < 1.5, `Ctrl плува надолу (y=${B2.pos.y.toFixed(2)})`);
  // плуване по посока на погледа: напред + поглед нагоре -> нагоре
  const B3 = body(3, 1, 15); B3.pitch = 0.9; B3.yaw = -Math.PI / 2; run(B3, W, 0.7, { ...IDLE, fz: -1 });
  ok(B3.pos.y > 1.6, `погледът нагоре променя посоката на плуване (y=${B3.pos.y.toFixed(2)})`);
  // излизане върху ръба: напред към кея (yaw=-PI/2 гледа към +x)
  const B4 = body(8.5, 1, 15); B4.yaw = -Math.PI / 2; run(B4, W, 3, { ...IDLE, fz: -1, jumpHeld: true });
  ok(B4.pos.x > 10.4 && B4.pos.y >= 2 - 0.01 && B4.onGround, `излиза от водата върху кея (x=${B4.pos.x.toFixed(2)}, y=${B4.pos.y.toFixed(2)})`);
    // по-висок ръб (1.5 блока над повърхността не, но 1 блок над нея да): кей на y=1..3
  const W2 = world(30, 12, 30, [['concrete', 0, 0, 0, 29, 0, 29], ['concrete', 10, 1, 0, 29, 2, 29], ['water', 0, 1, 0, 9, 1, 29]]);
  const B5 = body(8.5, 1, 15); B5.yaw = -Math.PI / 2; const ev = run(B5, W2, 3, { ...IDLE, fz: -1, jumpHeld: true });
ok(ev.includes('waterjump'), 'при по-висок ръб сработва water jump');
  ok(B5.pos.x > 10.4 && B5.onGround && B5.pos.y >= 3 - 0.01, `излиза и върху кей с 1 блок над водата (y=${B5.pos.y.toFixed(2)})`);
}

console.log('— Вода в картите: има изход');
{
  const load = id => World.fromMap(JSON.parse(fs.readFileSync(new URL('../server/maps/' + id + '.json', import.meta.url), 'utf8')));
  // oasis в пустинята: басейн 2x1 на y=0; отвън подът е с 1 блок по-висок
  const W = load('desert');
  for (const [dx, dz, yaw] of [[1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2], [0, 1, Math.PI], [0, -1, 0]]) {
    const B = body(23.5 + dx * 0.4, 0.0, 13.5 + dz * 0.0); B.yaw = yaw; B.onGround = true; run(B, W, 0.3);
    run(B, W, 2.5, { ...IDLE, fz: -1, jumpHeld: true, jumpNow: false });
    ok(B.pos.y >= 0.99 && B.onGround && !B.inWater, `излиза от басейна в посока (${dx},${dz}) (y=${B.pos.y.toFixed(2)}, x=${B.pos.x.toFixed(1)}, z=${B.pos.z.toFixed(1)})`);
  }
  // пристанище: морето е с дъно y=0, вода y=1, кеят е на y=1 -> краката на y=2
  const H = load('harbor'); const B = body(8.5, 1, 30); B.yaw = -Math.PI / 2; B.onGround = true;
  const ev = run(B, H, 4, { ...IDLE, fz: -1, jumpHeld: true });
  ok(B.pos.x > 12.4 && B.pos.y >= 1.99 && B.onGround, `от морето се излиза на кея (x=${B.pos.x.toFixed(1)}, y=${B.pos.y.toFixed(2)})`);
}

console.log('— Слуз, лед, платформа');
{
  const W = world(30, 20, 30, [['concrete', 0, 0, 0, 29, 0, 29], ['slime', 5, 0, 5, 7, 0, 7], ['slick', 12, 0, 0, 29, 0, 29]]);
  const B = body(6, 1, 6); const ys = []; run(B, W, 1.5, (i, b) => { ys.push(b.pos.y); return IDLE; });
  ok(Math.max(...ys) > 5, `слузта отскача високо (y до ${Math.max(...ys).toFixed(1)})`);
  const C = body(20, 1, 10); C.vel.x = 5; C.onGround = true; run(C, W, 0.5, { ...IDLE });
  const D = body(3, 1, 10); D.vel.x = 5; D.onGround = true; run(D, W, 0.5, { ...IDLE });
  ok(C.vel.x > 3.5 && D.vel.x < 0.6, `ледът се плъзга (${C.vel.x.toFixed(2)} м/с) срещу бетон (${D.vel.x.toFixed(2)} м/с)`);
  const plat = [{ size: [4, 1, 4], from: [10, 3, 10], to: [10, 3, 20], period: 6, block: 'metal' }];
  const P = body(11, 4, 12); P.onGround = false; const z0 = P.pos.z;
  run(P, W, 1.5, IDLE, 'comp', { platDefs: plat, t0: 0.5 });
  ok(P.onGround && P.platform === 0 && Math.abs(P.pos.y - 4) < 0.05, 'стои върху движеща се платформа');
  const moved = platformsAt(plat, 2.0)[0].min[2] - platformsAt(plat, 0.5)[0].min[2];
  ok(Math.abs((P.pos.z - z0) - moved) < 0.6 && Math.abs(moved) > 0.3, `платформата го носи (${(P.pos.z - z0).toFixed(2)} м при ${moved.toFixed(2)} м)`);
}

console.log('— Рампи (wedge)');
{
  // 45° рампа (ramp_e): най-ниско при x=10, расте на изток; колоната под нея е запълнена
  const ops = [['concrete', 0, 0, 0, 39, 0, 39]];
  for (let i = 0; i < 6; i++) { if (i > 0) ops.push(['concrete', 10 + i, 1, 0, 10 + i, i, 39]); ops.push(['ramp_e', 10 + i, 1 + i, 0, 10 + i, 1 + i, 39]); }
  const W = world(40, 20, 40, ops);
  const B = body(12.5, 3.2, 20); const ev = run(B, W, 1.5);
  ok(B.onGround && B.groundN && Math.abs(B.groundN.ny - Math.SQRT1_2) < 0.01, `на 45° рампа се стои (ny=${B.groundN?.ny.toFixed(2)})`);
  ok(Math.hypot(B.vel.x, B.vel.z) < 0.5, 'не се плъзга по ходима рампа');
  // ходене нагоре по рампата
  const U = body(10.3, 1, 20); U.yaw = -Math.PI / 2; run(U, W, 2.0, { ...IDLE, fz: -1 });
  ok(U.pos.y > 3 && U.pos.x > 12, `изкачва 45° рампа (y=${U.pos.y.toFixed(2)})`);
  // странична стена / задна стена блокират
  const T = body(17.5, 7.5, 20); T.yaw = Math.PI / 2; run(T, W, 1.0, { ...IDLE, fz: -1 });
  ok(T.pos.y < 8.2, 'задната стена на рампата не „качва“ играча');
}
{
  // стръмна (63°) рампа: двойка surf_lo / surf_hi, расте на изток; стои се НЕ, плъзга се
  const ops = [['concrete', 0, 0, 0, 59, 0, 59], ['concrete', 0, 1, 0, 59, 11, 0]];
  for (let i = 0; i < 4; i++) { const b = 1 + i * 2; if (i > 0) ops.push(['concrete', 10 + i, 1, 0, 10 + i, b - 1, 59]); ops.push(['surf_lo_e', 10 + i, b, 0, 10 + i, b, 59]); ops.push(['surf_hi_e', 10 + i, b + 1, 0, 10 + i, b + 1, 59]); }
  const W = world(60, 20, 60, ops);
  const B = body(11.5, 5.2, 30); run(B, W, 0.6, IDLE, 'surf');
  ok(!B.onGround && B.surfing, `на 63° рампа не се стои, а се плъзга (surfing=${B.surfing}, ny=${B.groundN ? B.groundN.ny.toFixed(2) : '-'})`);
  ok(B.vel.x < -0.5, `плъзга се надолу по наклона (vx=${B.vel.x.toFixed(2)})`);
}

console.log(fails ? `\nПровалени: ${fails}` : '\nФизиката е в ред.');
process.exit(fails ? 1 : 0);
