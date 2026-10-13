// Тест на GoldSrc BSP карта: колизия по clipnodes и движение (споделен shared/bsp.js)
import fs from 'node:fs';
import { Bsp, stepBodyBsp, boxBlockedBsp, toCs, U } from '../shared/bsp.js';
import { makeBody } from '../shared/physics.js';
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const json = JSON.parse(fs.readFileSync(new URL('../server/maps/surf_ski.json', import.meta.url), 'utf8'));
const bsp = new Bsp(json);
const IDLE = { can: true, fx: 0, fz: 0, crouch: false, walk: false, jumpNow: false, jumpHeld: false };
const run = (B, secs, inp = IDLE) => { const ev = []; const n = Math.round(secs * 64); for (let i = 0; i < n; i++) stepBodyBsp(B, typeof inp === 'function' ? inp(i, B) : inp, { bsp, vmax: 6.25, emit: (k) => ev.push(k) }, 1 / 64); return ev; };
const body = (x, y, z) => { const B = makeBody(); B.pos = { x, y, z }; return B; };

console.log('— BSP: спавн и земя');
const sp = json.spawns.att;
let good = 0; for (const [x, z, y] of sp) { if (!boxBlockedBsp(bsp, x, y, z, false)) good++; }
ok(good === sp.length, `всички ${sp.length} spawn-а са свободни (${good})`);
const [sx, sz, sy0] = sp[0]; const c0 = toCs({ x: sx, y: sy0, z: sz }, 36), fl = bsp.trace('stand', c0[0], c0[1], c0[2], c0[0], c0[1], c0[2] - 400), sy = (fl.z - 36) / U; const B = body(sx, sy + 0.05, sz);
run(B, 1.0);
ok(B.onGround && Math.abs(B.pos.y - sy) < 0.2, `стои на земята (y=${B.pos.y.toFixed(2)}, под ${sy.toFixed(2)})`);
let best = 0; for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) { const Bq = body(sx, sy + 0.05, sz); Bq.yaw = yaw; run(Bq, 1.5, { ...IDLE, fz: -1 }); best = Math.max(best, Bq.speed); }
ok(best > 5.5 && best < 6.4, `тича със ~6.25 м/с (${best.toFixed(2)})`);
const B2 = body(sx, sy + 0.05, sz); run(B2, 0.5); const ys = []; run(B2, 1, (i, b) => { ys.push(b.pos.y); return { ...IDLE, jumpNow: i === 0 }; });
ok(Math.max(...ys) - sy > 1.0 && Math.max(...ys) - sy < 1.6, `височина на скока ${(Math.max(...ys) - sy).toFixed(2)} м (CS 1.6 ~1.1)`);
console.log('— BSP: падане през празно');
const F = body(sx, sy + 1.5, sz); run(F, 1); ok(F.onGround || F.pos.y < sy + 5, 'пада и се приземява');
console.log(fails ? `\nПровалени: ${fails}` : '\nBSP е в ред.'); process.exit(fails ? 1 : 0);
