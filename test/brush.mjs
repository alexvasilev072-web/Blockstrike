// Тест на картите от кутии: сблъсък на играча (под, стена, стъпала, щайга), лъчи, груба воксел сянка.
import { BrushWorld } from '../shared/brushes.js';
import { traverse, SOLID, BLOCK } from '../shared/world.js';
import { makeBody, stepBody } from '../shared/physics.js';
import { MOVE } from '../shared/weapons.js';
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const brushes = [
  [0, 0, 0, 40, 1, 40, 'ground'],                                  // под (горна повърхност y=1)
  [20, 1, 0, 21, 5, 40, 'brick'],                                  // стена през x=20..21 с отвор по-долу
  ...[0, 1, 2, 3].map(k => [10, 1, 12 - 0.5 * k, 12, 1.25 + 0.25 * k, 12.5 - 0.5 * k, 'step']),   // стъпала с издигане 0.25 (до y=2), по оста z
  [10, 1, 20, 11.2, 2.2, 21.2, 'crate'],                           // щайга 1.2 м (висока 1.2): над стъпалото, не се изкачва, а се скача
  [30, 1, 5, 31, 3, 6, 'glass', 'g'],                              // стъкло: спира играча, не и лъча
];
// отвор в стената: махаме парче (две кутии)
brushes[1] = [20, 1, 0, 21, 5, 15, 'brick']; brushes.push([20, 1, 17, 21, 5, 40, 'brick'], [20, 3.2, 15, 21, 5, 17, 'brick']);   // отвор 2 м (z 15..17), горе над него стена
const W = BrushWorld.fromMap({ size: [48, 12, 48], brushes });
const STEP = MOVE.STEP, IDLE = { can: true, fx: 0, fz: 0, crouch: false, walk: false, jumpNow: false, jumpHeld: false };
const run = (B, secs, inp) => { for (let i = 0; i < Math.round(secs / STEP); i++) stepBody(B, typeof inp === 'function' ? inp(i) : inp, { world: W, vmax: 6.25, mode: 'comp', emit() { }, platforms: [] }, STEP); };
const body = (x, y, z, yaw) => { const B = makeBody(); B.pos = { x, y, z }; B.yaw = yaw; return B; };

console.log('— под и стена');
{ const B = body(5, 3, 5, 0); run(B, 1, IDLE); ok(Math.abs(B.pos.y - 1) < 0.01 && B.onGround, `пада върху пода (y=${B.pos.y.toFixed(3)})`);
  const C = body(15, 1, 5, -Math.PI / 2); run(C, 0.2, IDLE); run(C, 3, { ...IDLE, fz: -1 }); ok(C.pos.x < 20 - 0.29 + 1e-3 && C.pos.x > 19.5, `спира пред стена (x=${C.pos.x.toFixed(2)})`); }
console.log('— стъпала и щайга');
{ const B = body(11, 1, 17, 0); run(B, 0.2, IDLE); let maxY = 1; run(B, 2.2, () => { maxY = Math.max(maxY, B.pos.y); return { ...IDLE, fz: -1 }; }); ok(maxY > 1.95 && B.pos.z < 11, `изкачва стъпала по 0.25 без скок (най-високо y=${maxY.toFixed(2)})`);
  const C = body(10.6, 1, 24, 0); run(C, 0.2, IDLE); run(C, 1.5, { ...IDLE, fz: -1 }); ok(C.pos.z > 21.1, `щайга от 1.2 м не се изкачва пеша (z=${C.pos.z.toFixed(2)}, y=${C.pos.y.toFixed(2)})`);
  const D = body(10.6, 1, 24, 0); run(D, 0.2, IDLE); let up = false; run(D, 1.6, i => { if (D.pos.y > 2.1) up = true; return { ...IDLE, fz: -1, jumpNow: i === 6 || (D.pos.z < 22.6 && D.onGround), jumpHeld: true }; }); ok(up || D.pos.y > 2.1, `щайга от 1.2 м се качва със скок (y до ${D.pos.y.toFixed(2)})`); }
console.log('— отвор в стена');
{ const B = body(15, 1, 16, -Math.PI / 2); run(B, 0.2, IDLE); run(B, 2, { ...IDLE, fz: -1 }); ok(B.pos.x > 22, `минава през отвор от 2 м (x=${B.pos.x.toFixed(2)})`);
  const C = body(15, 1, 16, -Math.PI / 2); C.crouching = false; ok(!W.bw.collides(15, 1, 16, 0.3, 1.8), 'прав играч е свободен пред отвора'); }
console.log('— лъчи и сянка');
{ let hit = null; traverse(W, 5, 2, 5, 1, 0, 0, 30, (x, y, z, t) => { if (SOLID[W.get(x, y, z)]) { hit = t; return true; } return false; }); ok(hit !== null && Math.abs(hit - 15) < 0.05, `лъчът удря стената на 15 м (t=${hit})`);
  let hit2 = null; traverse(W, 5, 2, 15.9, 1, 0, 0, 30, (x, y, z, t) => { if (SOLID[W.get(x, y, z)]) { hit2 = t; return true; } return false; }); ok(hit2 === null, 'лъчът минава през отвора (до края)');
  let hit3 = null; traverse(W, 25, 2, 5.5, 1, 0, 0, 20, (x, y, z, t) => { if (SOLID[W.get(x, y, z)] && W.get(x, y, z) !== BLOCK.glass) { hit3 = t; return true; } return false; }); ok(hit3 === null, 'лъчът минава през стъкло');
  ok(W.solid(15, 0, 5) && !W.solid(15, 1, 5) && W.solid(20, 2, 5), 'груба сянка: подът и стената са твърди, въздухът не е'); }
console.log(fails ? `\nПровалени: ${fails}` : '\nКартите от кутии са в ред.'); process.exit(fails ? 1 : 0);
