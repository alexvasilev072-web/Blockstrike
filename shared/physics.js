// Движение на играча (CS2 стил) – общо за браузъра и за Node (тестове/валидатор на карти).
// Работи върху обект B с полета: pos{x,y,z}, vel{x,y,z}, yaw, pitch, onGround, crouching, crouchAmt, inWater,
// wjT, surfing, platform, groundN, stepAcc, speed. Не ползва DOM и аудио: събитията се подават през ctx.emit.
import { MOVE } from './weapons.js';
import { stepBodyBsp } from './bsp.js';
import { BLOCK, DEFS, boxCollides, wedgePush, waterDepth } from './world.js';

const AIR_MAX_COMP = MOVE.AIR_MAX * 6.25;
export const MODES = {
  comp: { airAccel: MOVE.AIR_ACCEL, bhopCap: MOVE.BHOP_CAP, airMax: AIR_MAX_COMP },
  parkour: { airAccel: MOVE.AIR_ACCEL, bhopCap: MOVE.BHOP_CAP, airMax: AIR_MAX_COMP },
  // surf: sv_airaccelerate 150, без BHOP_CAP и AIR_MAX; таван на скоростта 3500 ед/с
  surf: { airAccel: MOVE.SURF_AIR_ACCEL, bhopCap: Infinity, airMax: MOVE.SURF_MAX },
};

export function makeBody() {
  return { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, onGround: false, crouching: false, crouchAmt: 0, inWater: false,
    wjT: 0, surfing: false, platform: null, groundN: null, stepAcc: 0, speed: 0, jumped: false };
}

const hspeed = v => Math.hypot(v.x, v.z);
function accelerate(v, wx, wz, wishspeed, accel, dt, cap = Infinity) {
  const ws = Math.min(wishspeed, cap), cur = v.x * wx + v.z * wz, add = ws - cur;
  if (add <= 0) return;
  const a = Math.min(accel * dt * wishspeed, add);
  v.x += wx * a; v.z += wz * a;
}
const platHit = (plats, x, y, z, H, HW) => {
  for (const q of plats) if (x + HW > q.min[0] && x - HW < q.max[0] && y + H > q.min[1] && y < q.max[1] && z + HW > q.min[2] && z - HW < q.max[2]) return q;
  return null;
};

// inp: { can, fx, fz, crouch, walk, jumpNow, jumpHeld }   (fz<0 = напред)
// ctx: { world, vmax (м/с на оръжието), mode, platforms:[{id,min,max,d}], emit(name,data) }
export function stepBody(B, inp, ctx, dt) {
  if (ctx.bsp) return stepBodyBsp(B, inp, ctx, dt);     // GoldSrc карта (CS 1.6): отделна физика по clipnode hull-овете
  const W = ctx.world, p = B.pos, v = B.vel, HW = MOVE.HW, M = MODES[ctx.mode] || MODES.comp, plats = ctx.platforms || [], emit = ctx.emit || (() => { });
  B.jumped = false; const wasSurf = B.surfing; B.surfing = false;

  // движеща се платформа под краката: носи играча
  if (B.platform != null) { const pf = plats.find(q => q.id === B.platform); if (pf) { p.x += pf.d[0]; p.y += pf.d[1]; p.z += pf.d[2]; } }

  // клякане (във вода Ctrl е „надолу“, не клякане)
  const wantCrouch = inp.crouch && !B.inWater;
  const blockedAt = (x, y, z, h) => boxCollides(W, x, y, z, HW, h) || (() => { const w = wedgePush(W, x, y, z, HW, h); return !!w && w.pen > 1e-3; })();
  if (wantCrouch && !B.crouching) B.crouching = true;
  else if (!wantCrouch && B.crouching && !blockedAt(p.x, p.y, p.z, MOVE.STAND_H)) B.crouching = false;
  const H = B.crouching ? MOVE.CROUCH_H : MOVE.STAND_H;
  const tgt = B.crouching ? 1 : 0; B.crouchAmt += Math.max(-dt / MOVE.CROUCH_TIME, Math.min(dt / MOVE.CROUCH_TIME, tgt - B.crouchAmt));

  const depth = waterDepth(W, p.x, p.y, p.z, H);
  const inWater = B.inWater = depth > 0.2;
  const below = W.get(Math.floor(p.x), Math.floor(p.y - 0.06), Math.floor(p.z));
  const slick = B.onGround && below === BLOCK.slick;
  const surface = B.platform != null ? 'metal' : (DEFS[below]?.surface || 'stone');

  let vmax = ctx.vmax || 6.25, mult = 1;
  if (B.crouching) mult = MOVE.CROUCH_MUL; else if (inp.walk) mult = MOVE.WALK_MUL;
  if (inWater) mult *= MOVE.WATER_MUL;
  const maxSpeed = vmax * mult;

  const sn = Math.sin(B.yaw), cs = Math.cos(B.yaw);
  let wx = inp.fx * cs + inp.fz * sn, wz = -inp.fx * sn + inp.fz * cs;
  const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  const wishspeed = wl > 0 ? maxSpeed : 0;

  // скок (без автоматичен bhop: нужно е ново натискане; малък буфер преди приземяване)
  let jumped = false;
  if (inp.can && inp.jumpNow && B.onGround && !(inWater && depth > 0.75)) {
    v.y = MOVE.JUMP * (inWater ? 0.85 : 1); B.onGround = false; B.groundN = null; B.platform = null; jumped = true; B.jumped = true;
    const cap = vmax * (B.crouching ? MOVE.CROUCH_MUL * 3 : 1) * M.bhopCap, hs = hspeed(v);
    if (hs > cap) { v.x *= cap / hs; v.z *= cap / hs; }
    emit('jump', { surface });
  }
  // слуз: отскачане високо при всяко докосване
  if (B.onGround && !jumped && below === BLOCK.slime) { v.y = MOVE.SLIME_BOUNCE; B.onGround = false; B.groundN = null; B.platform = null; jumped = true; emit('bounce', {}); }

  // „water jump“ като в Source: във водата близо до повърхността, натиснат напред към ръб с място отгоре -> тласък нагоре и напред
  if (B.wjT > 0) B.wjT -= dt;
  if (inWater && B.wjT <= 0 && inp.can && wl > 0 && depth <= 0.75) {
    const ax = p.x + wx * 0.6, az = p.z + wz * 0.6, cx = Math.floor(ax), cz = Math.floor(az);
    const fy = Math.floor(p.y + 0.1);
    if (W.solid(cx, fy, cz) || W.solid(cx, Math.floor(p.y + 0.5), cz)) {
      let top = fy; while (top < p.y + 3 && W.solid(cx, top, cz)) top++;
      if (top - p.y <= 1.7 && !blockedAt(ax, top, az, H)) {
        v.y = MOVE.WATER_JUMP; v.x = wx * 3.4; v.z = wz * 3.4; B.wjT = 0.5; emit('waterjump', {});
      }
    }
  }

  const slope = B.onGround && B.groundN && B.groundN.ny < 0.999;
  if (inWater && B.wjT <= 0) {
    // плуване: гледането нагоре/надолу сменя посоката; Space = нагоре, Ctrl = надолу
    const cp = Math.cos(B.pitch), sp = Math.sin(B.pitch), fwd = -inp.fz;
    let tx = -sn * cp * fwd + cs * inp.fx, ty = sp * fwd + (inp.jumpHeld ? 1 : 0) - (inp.crouch ? 1 : 0), tz = -cs * cp * fwd - sn * inp.fx;
    const l = Math.hypot(tx, ty, tz); if (l > 1) { tx /= l; ty /= l; tz /= l; }
    const spd = maxSpeed, idle = l < 0.01;
    const k = 1 - Math.exp(-6 * dt);
    v.x += (tx * spd - v.x) * k; v.z += (tz * spd - v.z) * k; v.y += (ty * spd * (inp.jumpHeld || inp.crouch ? 0.9 : 1) - (idle ? 0.8 : 0) - v.y) * k;
    B.onGround = false; B.groundN = null; B.platform = null;
  } else if (B.onGround) {
    const hs = hspeed(v), fm = slick ? MOVE.SLICK_FRIC : 1, am = slick ? MOVE.SLICK_ACC : 1;
    if (hs < 0.03) { v.x = 0; v.z = 0; } else { const control = Math.max(hs, MOVE.STOP), drop = control * MOVE.FRICTION * fm * dt, ns = Math.max(0, hs - drop) / hs; v.x *= ns; v.z *= ns; }
    accelerate(v, wx, wz, wishspeed, MOVE.ACCEL * am, dt);
    if (slope) { const n = B.groundN; v.y = -(n.nx * v.x + n.nz * v.z) / n.ny; }   // по равнината, без гравитация
  } else {
    accelerate(v, wx, wz, wishspeed, M.airAccel, dt, MOVE.AIR_CAP);
    const hs = hspeed(v); if (hs > M.airMax && ctx.mode !== 'surf') { v.x *= M.airMax / hs; v.z *= M.airMax / hs; }
    // surf: рампите са хоризонтални, затова наклонът надолу по трасето се емулира с лек тласък по посока на картата
    if (ctx.mode === 'surf' && wasSurf && ctx.drive && hs > 3 && hs < MOVE.SURF_DRIVE_MAX) { v.x += ctx.drive[0] * MOVE.SURF_DRIVE * dt; v.z += ctx.drive[2] * MOVE.SURF_DRIVE * dt; }
  }
  if (!(inWater && B.wjT <= 0) && !(B.onGround && slope)) v.y = Math.max(-60, v.y - MOVE.GRAVITY * dt);
  if (ctx.mode === 'surf') { const sp3 = Math.hypot(v.x, v.y, v.z); if (sp3 > M.airMax) { const k = M.airMax / sp3; v.x *= k; v.y *= k; v.z *= k; } }

  // движение на под-стъпки с колизии: кубове по оси, платформи, после клинове (изтласкване по нормалата + clip на скоростта)
  const wasGround = B.onGround, vyBefore = v.y;
  const nsub = Math.max(1, Math.ceil(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt / 0.25)), sd = dt / nsub;
  let grounded = false, gN = null, platId = null;
  for (let i = 0; i < nsub; i++) {
    let d = v.x * sd; p.x += d;
    if (boxCollides(W, p.x, p.y, p.z, HW, H)) { p.x = d > 0 ? Math.floor(p.x + HW) - HW - 1e-4 : Math.floor(p.x - HW) + 1 + HW + 1e-4; v.x = 0; }
    else { const q = platHit(plats, p.x, p.y, p.z, H, HW); if (q) { p.x = d > 0 ? q.min[0] - HW - 1e-4 : q.max[0] + HW + 1e-4; v.x = 0; } }
    d = v.z * sd; p.z += d;
    if (boxCollides(W, p.x, p.y, p.z, HW, H)) { p.z = d > 0 ? Math.floor(p.z + HW) - HW - 1e-4 : Math.floor(p.z - HW) + 1 + HW + 1e-4; v.z = 0; }
    else { const q = platHit(plats, p.x, p.y, p.z, H, HW); if (q) { p.z = d > 0 ? q.min[2] - HW - 1e-4 : q.max[2] + HW + 1e-4; v.z = 0; } }
    d = v.y * sd; p.y += d;
    if (boxCollides(W, p.x, p.y, p.z, HW, H)) {
      if (d > 0) p.y = Math.floor(p.y + H) - H - 1e-4; else { p.y = Math.floor(p.y) + 1; grounded = true; gN = { nx: 0, ny: 1, nz: 0 }; }
      v.y = 0;
    } else {
      const q = platHit(plats, p.x, p.y, p.z, H, HW);
      if (q) { if (d > 0) p.y = q.min[1] - H - 1e-4; else { p.y = q.max[1]; grounded = true; gN = { nx: 0, ny: 1, nz: 0 }; platId = q.id; } v.y = 0; }
    }
    for (let k = 0; k < 4; k++) {
      const w = wedgePush(W, p.x, p.y, p.z, HW, H);
      if (!w || w.pen <= 1e-4) break;
      const e = w.pen + 1e-3; p.x += w.nx * e; p.y += w.ny * e; p.z += w.nz * e;
      const vn = v.x * w.nx + v.y * w.ny + v.z * w.nz;
      if (vn < 0) { v.x -= w.nx * vn; v.y -= w.ny * vn; v.z -= w.nz * vn; }
      if (w.ny >= MOVE.WALK_NY) { grounded = true; gN = w; } else if (w.ny > 0.05) B.surfing = true;
    }
  }
  // контакт с повърхност под краката (рампи, платформи, пред ръб)
  if (!grounded && v.y <= 0.6 && !jumped) {
    if (boxCollides(W, p.x, p.y - 0.03, p.z, HW, H)) { grounded = true; gN = { nx: 0, ny: 1, nz: 0 }; }
    else {
      const w = wedgePush(W, p.x, p.y - 0.03, p.z, HW, H);
      if (w && w.pen > 0) { if (w.ny >= MOVE.WALK_NY) { grounded = true; gN = w; } else if (w.ny > 0.05) B.surfing = true; }
      else { const q = platHit(plats, p.x, p.y - 0.03, p.z, H, HW); if (q) { grounded = true; gN = { nx: 0, ny: 1, nz: 0 }; platId = q.id; } }
    }
  }
  // залепване към наклона при слизане (до 0.35 м), за да не „хвърча“ при ходене по рампа надолу
  if (!grounded && wasGround && !jumped && !inWater && v.y <= 0.01 && slope) {
    let lo = 0, hi = 0.35;
    if (!blockedAt(p.x, p.y - hi, p.z, H)) hi = 0; else { for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; if (blockedAt(p.x, p.y - m, p.z, H)) hi = m; else lo = m; } }
    if (hi > 0) {
      const w = wedgePush(W, p.x, p.y - hi, p.z, HW, H);
      p.y -= lo; grounded = true; gN = w && w.ny >= MOVE.WALK_NY ? w : { nx: 0, ny: 1, nz: 0 };
      if (w && w.ny < MOVE.WALK_NY) { grounded = false; gN = null; p.y += lo; }
    }
  }
  B.onGround = grounded; B.groundN = grounded ? gN : null; B.platform = grounded ? platId : null;
  if (grounded && gN && gN.ny >= MOVE.WALK_NY) B.surfing = false;

  // приземяване, стъпки (няма при Shift и клякане), плъзгане
  const hs = hspeed(v);
  if (B.onGround && !wasGround && vyBefore < -3.5 && !inWater) emit('land', { strength: -vyBefore / 8, surface: DEFS[W.get(Math.floor(p.x), Math.floor(p.y - 0.06), Math.floor(p.z))]?.surface || 'stone' });
  if (B.onGround && hs > 1.6 && !inp.walk && !B.crouching) { B.stepAcc += hs * dt; if (B.stepAcc >= 2.0) { B.stepAcc = 0; emit('step', { surface: DEFS[W.get(Math.floor(p.x), Math.floor(p.y - 0.06), Math.floor(p.z))]?.surface || 'stone' }); } }
  else if (!B.onGround) B.stepAcc = 0;
  B.speed = hs;
}

// Позиции на движещите се платформи в момент t (сек): плавна синусоида между from и to. d = преместване спрямо t-dt.
export function platformsAt(defs, t, dt = 1 / 64) {
  const out = [];
  (defs || []).forEach((q, id) => {
    const at = tt => { const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * (tt + (q.phase || 0)) / q.period); return [q.from[0] + (q.to[0] - q.from[0]) * s, q.from[1] + (q.to[1] - q.from[1]) * s, q.from[2] + (q.to[2] - q.from[2]) * s]; };
    const a = at(t), b = at(t - dt);
    out.push({ id, min: a, max: [a[0] + q.size[0], a[1] + q.size[1], a[2] + q.size[2]], d: [a[0] - b[0], a[1] - b[1], a[2] - b[2]], block: q.block || 'metal', size: q.size });
  });
  return out;
}
