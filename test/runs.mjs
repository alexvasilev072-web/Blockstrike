// Тест на parkour / surf картите със симулиран играч (бот) върху същата физика като в играта.
//   node test/runs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, BLOCK, SOLID } from '../shared/world.js';
import { makeBody, stepBody, platformsAt } from '../shared/physics.js';
import { MOVE } from '../shared/weapons.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/maps');
const load = id => { const json = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8')); return { json, world: World.fromMap(json) }; };
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fails++; };
const STEP = MOVE.STEP;

// Бот: върви към целта (cx,cz), скача при ръба; връща {ok, time}
function hop(W, B, target, { maxT = 4, jumpMargin = 0.0, mode = 'parkour', crouchUnderCeil = true, plat = null } = {}) {
  const [tx, tz, tw, td, ttop] = target;
  const cx = tx + tw / 2, cz = tz + td / 2;
  for (let i = 0; i * STEP < maxT; i++) {
    const p = B.pos, dx = cx - p.x, dz = cz - p.z, l = Math.hypot(dx, dz) || 1;
    B.yaw = Math.atan2(-dx, -dz);
    const ahead = W.get(Math.floor(p.x + dx / l * (0.32 + jumpMargin)), Math.floor(p.y - 0.4), Math.floor(p.z + dz / l * (0.32 + jumpMargin)));
    const edge = B.onGround && !SOLID[ahead];
    let ceil = false; if (crouchUnderCeil && !B.onGround) for (let k = 2; k <= 4; k++) if (W.solid(Math.floor(p.x), Math.floor(p.y + k * 0.8 + 0.1), Math.floor(p.z))) ceil = true;
    stepBody(B, { can: true, fx: 0, fz: -1, crouch: !!ceil, walk: false, jumpNow: edge, jumpHeld: false }, { world: W, vmax: 6.25, mode, platforms: plat ? plat(i * STEP) : [] }, STEP);
    const inside = p.x > tx - 0.05 && p.x < tx + tw + 0.05 && p.z > tz - 0.05 && p.z < tz + td + 0.05;
    if (B.onGround && inside && Math.abs(p.y - ttop) < 0.05) return { ok: true, time: i * STEP };
    if (p.y < ttop - 3) return { ok: false, why: 'падна' };
  }
  return { ok: false, why: 'време' };
}

for (const id of ['p_easy', 'p_medium']) {
  console.log(`— ${id}: бот минава всички скокове`);
  const { json, world } = load(id);
  const R = json.route, B = makeBody();
  const [sx, sz, sy] = json.spawns.att[0]; B.pos = { x: sx + 0.5, y: sy, z: sz + 0.5 }; B.onGround = true;
  let all = true;
  for (let i = 1; i < R.length; i++) {
    // старт от далечния ръб на текущата платформа (максимален засилване)
    const [px, pz, pw, pd] = R[i - 1], [tx, tz] = R[i];
    const back = { x: R[i - 1][0] + 0.5, z: pz + pd / 2 }; if (i > 1) { B.pos.x = Math.min(B.pos.x, px + pw - 0.5); }
    const r = hop(world, B, R[i]);
    if (!r.ok) { all = false; ok(false, `скок ${i} (${R[i][0]},${R[i][1]}): ${r.why}`); break; }
    B.vel.x = 0; B.vel.z = 0;                                   // кратка пауза на платформата
    // нов засилване към края на платформата
  }
  ok(all, `${R.length - 1} скока са изпълними със симулирания играч`);
}

console.log('— p_hard: скокове на 4 блока, лед, слуз');
{
  const { json, world } = load('p_hard'), R = json.route, B = makeBody();
  const [sx, sz, sy] = json.spawns.att[0]; B.pos = { x: sx + 0.5, y: sy, z: sz + 0.5 }; B.onGround = true;
  let all = true;
  for (let i = 1; i <= 4; i++) {
    // засилване: тръгваме от задния ръб на платформата и тичаме целия път
    const [px, pz, pw, pd] = R[i - 1]; B.pos.x = px + 0.4; B.pos.z = pz + pd / 2; B.vel.x = 0; B.vel.z = 0; B.onGround = true;
    const r = hop(world, B, R[i], { jumpMargin: -0.1 });
    if (!r.ok) { all = false; ok(false, `скок ${i}: ${r.why} (x=${B.pos.x.toFixed(2)}, y=${B.pos.y.toFixed(2)})`); break; }
  }
  ok(all, 'четирите скока на 4 блока (старт и три платформи) са изпълними от ръба до ръба');
  // лед: влизаш с 6 м/с и се плъзгаш далеч
  const ice = R[5], I = makeBody(); I.pos = { x: ice[0] + 0.5, y: ice[4], z: ice[1] + 1.5 }; I.onGround = true; I.yaw = -Math.PI / 2; I.vel.x = 6;
  for (let i = 0; i < 64; i++) stepBody(I, { can: true, fx: 0, fz: 0, crouch: false, walk: false, jumpNow: false, jumpHeld: false }, { world, vmax: 6.25, mode: 'parkour' }, STEP);
  ok(I.pos.x - (ice[0] + 0.5) > 4.0, `по леда се плъзга ${(I.pos.x - ice[0] - 0.5).toFixed(1)} м за 1 сек`);
  // слуз: бот стъпва върху слузта и скача към високата платформа
  const [sx0, sz0, hx, hz, htop] = json.slimeHop, S = makeBody();
  S.pos = { x: sx0 + 0.3, y: R[6][4], z: sz0 + 1.5 }; S.vel.x = 5.5; S.onGround = true; S.yaw = -Math.PI / 2;
  let landed = false, maxY = 0;
  for (let i = 0; i < 160 && !landed; i++) {
    stepBody(S, { can: true, fx: 0, fz: -1, crouch: false, walk: false, jumpNow: false, jumpHeld: false }, { world, vmax: 6.25, mode: 'parkour' }, STEP);
    maxY = Math.max(maxY, S.pos.y);
    if (S.onGround && S.pos.x > hx - 0.1 && S.pos.x < hx + 3.1 && Math.abs(S.pos.y - htop) < 0.05) landed = true;
  }
  ok(maxY > R[6][4] + 3.8, `слузта изхвърля на ${(maxY - R[6][4]).toFixed(1)} м`);
  ok(landed, 'от слузта се стига до високата платформа (изкачване на 4 блока)');
  // движеща се платформа: може да се стои и носи
  const plats = platformsAt(json.platforms, 0, STEP);
  ok(plats.length === 2 && plats[0].size[0] === 3, 'картата има 2 движещи се платформи');
}

console.log('— Surf: долина с рампи');
for (const id of ['s_easy', 's_hard']) {
  const { json, world } = load(id);
  const top = 8 + 2 * (id === 's_easy' ? 10 : 6);
  // играчът пада върху лявата рампа и държи D към нея (стрейф); целта: да се задържи на рампата и да ускорява
  const xl = id === 's_easy' ? 14 : 15, B = makeBody(); B.pos = { x: xl - 1.5, y: 8 + 2 * 2 + 1.6, z: 20 }; B.vel.z = 10; B.yaw = Math.PI;      // на лявата рампа (колона 2), гледа към +z
  const drive = json.drive, endZ = id === 's_easy' ? 128 : 50; let attached = 0, t = 0, maxSp = 0, fell = false;
  for (let i = 0; i < 64 * 20 && B.pos.z < endZ; i++) {
    stepBody(B, { can: true, fx: 1, fz: 0, crouch: false, walk: false, jumpNow: false, jumpHeld: false }, { world, vmax: 6.25, mode: 'surf', drive }, STEP);
    t += STEP; maxSp = Math.max(maxSp, Math.hypot(B.vel.x, B.vel.y, B.vel.z));
    if (B.surfing) attached++;
    if (B.pos.y < 3) { fell = true; break; }
  }
  ok(!fell && B.pos.z >= endZ && attached * STEP > t * 0.6, `${id}: ботът минава сегмента на рампата без да падне (z=${B.pos.z.toFixed(0)}, контакт ${(100 * attached * STEP / t).toFixed(0)}% от ${t.toFixed(1)} с)`);
  ok(maxSp > 12, `${id}: скоростта расте (макс. ${maxSp.toFixed(1)} м/с = ${(maxSp * 40).toFixed(0)} ед/с)`);
  ok(maxSp <= 87.6, `${id}: скоростта не надхвърля 87.5 м/с`);
}

console.log(fails ? `\nПровалени: ${fails}` : '\nКартите за parkour и surf са изпълними.');
process.exit(fails ? 1 : 0);
