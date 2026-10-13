// GoldSrc (CS 1.6) карти: колизия по clipnode hull-овете на BSP файла и движение в стил GoldSrc (PM_FlyMove/WalkMove/AirMove).
// Работи в CS единици вътре (40 ед = 1 м): игровите оси са (X, Y нагоре, Z) = (csX, csZ, -csY) / 40.
// Използва се от клиента (предвиждане), сървъра (проверка на позицията) и тестовете.
export const U = 40;
const SOLID = -2, EMPTY = -1;
const EPS = 0.03125;

const b64 = s => { const buf = Buffer_from(s); return buf; };
function Buffer_from(s) {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer;
}
export const decodeF32 = s => new Float32Array(b64(s));
export const decodeU8 = s => new Uint8Array(b64(s));
export const decodeU32 = s => new Uint32Array(b64(s));

// GoldSrc параметри на движението (CS 1.6 surf сървър: sv_airaccelerate 100, sv_maxvelocity 3500)
export const GS = { GRAVITY: 800, JUMP: 268.33, ACCEL: 5, AIR_ACCEL: 100, AIR_CAP: 30, FRICTION: 4, STOP: 100, STEP: 18, MAXVEL: 3500, WATER_FRIC: 1, CROUCH_MUL: 0.333, WALK_MUL: 0.52, LADDER: 200 };
export const HULL = { stand: { hz: 36 }, duck: { hz: 18 } };

export class Bsp {
  constructor(json) {
    const d = json.bsp; this.json = json;
    this.planes = decodeF32(d.planes); this.ptype = decodeU8(d.planeType);
    this.cnPlane = new Int32Array(b64(d.cnPlane)); this.cnC0 = new Int16Array(b64(d.cnC0)); this.cnC1 = new Int16Array(b64(d.cnC1));
    this.roots = { stand: d.hulls[1], duck: d.hulls[3] };
    this.pushes = d.pushes; this.teleports = d.teleports; this.ladders = d.ladders; this.waters = d.waters;
    // статични плътни обекти (func_wall): отделен hull с отместване
    this.statics = (d.solids || []).filter(s => s.cls === 'func_wall').map(s => ({ ...s }));
    this.tr = { frac: 1, nx: 0, ny: 0, nz: 0, startSolid: false, allSolid: false, x: 0, y: 0, z: 0 };
  }
  contents(num, x, y, z) {
    while (num >= 0) {
      const pi = this.cnPlane[num], t = this.ptype[pi], P = this.planes, d = (t < 3 ? (t === 0 ? x : t === 1 ? y : z) : P[pi * 4] * x + P[pi * 4 + 1] * y + P[pi * 4 + 2] * z) - P[pi * 4 + 3];
      num = d < 0 ? this.cnC1[num] : this.cnC0[num];
    }
    return num;
  }
  // дали центърът на играча (CS ед.) е в твърдо
  solidAt(hull, x, y, z) {
    if (this.contents(this.roots[hull], x, y, z) === SOLID) return true;
    for (const s of this.statics) {
      if (x < s.min[0] - 20 || x > s.max[0] + 20 || y < s.min[1] - 20 || y > s.max[1] + 20 || z < s.min[2] - 40 || z > s.max[2] + 40) continue;
      const r = hull === 'stand' ? s.hull1 : s.hull3;
      if (r > 0 && this.contents(r, x - s.origin[0], y - s.origin[1], z - s.origin[2]) === SOLID) return true;
    }
    return false;
  }
  // Quake SV_RecursiveHullCheck: проследяване на точка (центъра на играча) от a до b в hull-а
  trace(hull, ax, ay, az, bx, by, bz) {
    const T = this.tr; T.frac = 1; T.allSolid = true; T.startSolid = false; T.nx = T.ny = T.nz = 0; T.x = bx; T.y = by; T.z = bz;
    this._root = this.roots[hull]; this._rec(this.roots[hull], 0, 1, ax, ay, az, bx, by, bz, T, ax, ay, az, bx, by, bz);
    if (T.allSolid) T.frac = 0;
    T.x = ax + (bx - ax) * T.frac; T.y = ay + (by - ay) * T.frac; T.z = az + (bz - az) * T.frac;
    const best = { frac: T.frac, nx: T.nx, ny: T.ny, nz: T.nz, startSolid: T.startSolid, allSolid: T.allSolid, x: T.x, y: T.y, z: T.z };
    for (const s of this.statics) {
      const r = hull === 'stand' ? s.hull1 : s.hull3;
      if (!(r > 0)) continue;
      if (Math.max(ax, bx) < s.min[0] - 20 || Math.min(ax, bx) > s.max[0] + 20 || Math.max(ay, by) < s.min[1] - 20 || Math.min(ay, by) > s.max[1] + 20 || Math.max(az, bz) < s.min[2] - 40 || Math.min(az, bz) > s.max[2] + 40) continue;
      const o = s.origin, t2 = this.tr; t2.frac = 1; t2.allSolid = true; t2.startSolid = false; t2.nx = t2.ny = t2.nz = 0;
      this._root = r; this._rec(r, 0, 1, ax - o[0], ay - o[1], az - o[2], bx - o[0], by - o[1], bz - o[2], t2, ax - o[0], ay - o[1], az - o[2], bx - o[0], by - o[1], bz - o[2]);
      if (t2.allSolid) t2.frac = 0;
      if (t2.frac < best.frac) { best.frac = t2.frac; best.nx = t2.nx; best.ny = t2.ny; best.nz = t2.nz; best.allSolid = t2.allSolid; best.startSolid = t2.startSolid; best.x = ax + (bx - ax) * t2.frac; best.y = ay + (by - ay) * t2.frac; best.z = az + (bz - az) * t2.frac; }
      else if (t2.startSolid) best.startSolid = true;
    }
    return best;
  }
  _rec(num, p1f, p2f, x1, y1, z1, x2, y2, z2, T, ox, oy, oz, ex, ey, ez) {
    if (num < 0) { if (num !== SOLID) { T.allSolid = false; } else T.startSolid = true; return true; }
    const pi = this.cnPlane[num], t = this.ptype[pi], P = this.planes, dist = P[pi * 4 + 3];
    let t1, t2;
    if (t < 3) { t1 = (t === 0 ? x1 : t === 1 ? y1 : z1) - dist; t2 = (t === 0 ? x2 : t === 1 ? y2 : z2) - dist; }
    else { const nx = P[pi * 4], ny = P[pi * 4 + 1], nz = P[pi * 4 + 2]; t1 = nx * x1 + ny * y1 + nz * z1 - dist; t2 = nx * x2 + ny * y2 + nz * z2 - dist; }
    if (t1 >= 0 && t2 >= 0) return this._rec(this.cnC0[num], p1f, p2f, x1, y1, z1, x2, y2, z2, T, ox, oy, oz, ex, ey, ez);
    if (t1 < 0 && t2 < 0) return this._rec(this.cnC1[num], p1f, p2f, x1, y1, z1, x2, y2, z2, T, ox, oy, oz, ex, ey, ez);
    let frac = t1 < 0 ? (t1 + EPS) / (t1 - t2) : (t1 - EPS) / (t1 - t2);
    frac = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    let midf = p1f + (p2f - p1f) * frac, mx = x1 + (x2 - x1) * frac, my = y1 + (y2 - y1) * frac, mz = z1 + (z2 - z1) * frac;
    const side = t1 < 0 ? 1 : 0, c = side ? [this.cnC1[num], this.cnC0[num]] : [this.cnC0[num], this.cnC1[num]];
    if (!this._rec(c[0], p1f, midf, x1, y1, z1, mx, my, mz, T, ox, oy, oz, ex, ey, ez)) return false;
    if (this.contents(c[1], mx, my, mz) !== SOLID) return this._rec(c[1], midf, p2f, mx, my, mz, x2, y2, z2, T, ox, oy, oz, ex, ey, ez);
    if (T.allSolid) return false;
    let nx = P[pi * 4], ny = P[pi * 4 + 1], nz = P[pi * 4 + 2];
    if (side) { nx = -nx; ny = -ny; nz = -nz; }
    // ако средата е в твърдо, връщаме се назад докато излезем (Quake)
    while (this.contents(this._root, mx, my, mz) === SOLID) {
      frac -= 0.1;
      if (frac < 0) { T.frac = midf; T.nx = nx; T.ny = ny; T.nz = nz; return false; }
      midf = p1f + (p2f - p1f) * frac; mx = x1 + (x2 - x1) * frac; my = y1 + (y2 - y1) * frac; mz = z1 + (z2 - z1) * frac;
    }
    T.frac = midf; T.nx = nx; T.ny = ny; T.nz = nz;
    return false;
  }
}

const inBox = (b, x, y, z, hx, hy, hz) => x + hx >= b.min[0] && x - hx <= b.max[0] && y + hy >= b.min[1] && y - hy <= b.max[1] && z + hz >= b.min[2] && z - hz <= b.max[2];

// CS ед. <-> игрови метри
export const toCs = (p, hz) => [p.x * U, -p.z * U, p.y * U + hz];
export const fromCs = (cx, cy, cz, hz) => ({ x: cx / U, y: (cz - hz) / U, z: -cy / U });

export function boxBlockedBsp(bsp, x, y, z, crouch) {
  const hz = crouch ? 18 : 36, c = toCs({ x, y, z }, hz);
  return bsp.solidAt(crouch ? 'duck' : 'stand', c[0], c[1], c[2]);
}

function clipVel(v, nx, ny, nz, out, over = 1) {
  const back = (v[0] * nx + v[1] * ny + v[2] * nz) * over;
  for (let i = 0; i < 3; i++) { out[i] = v[i] - [nx, ny, nz][i] * back; if (out[i] > -0.1 && out[i] < 0.1) out[i] = 0; }
}

// ---------- движение ----------
// B: същият обект като в physics.js (pos в метри, vel в м/с). ctx: { bsp, vmax, emit }
export function stepBodyBsp(B, inp, ctx, dt) {
  const bsp = ctx.bsp, emit = ctx.emit || (() => { }), p = B.pos;
  B.jumped = false; B.platform = null; B.groundN = null;
  const hull0 = B.crouching ? 'duck' : 'stand', hz0 = B.crouching ? 18 : 36;
  // клякане: ставане само ако има място
  const wantCrouch = !!inp.crouch;
  if (wantCrouch && !B.crouching) B.crouching = true;
  else if (!wantCrouch && B.crouching) { const c = toCs(p, 36); if (!bsp.solidAt('stand', c[0], c[1], c[2])) B.crouching = false; }
  const hull = B.crouching ? 'duck' : 'stand', hz = B.crouching ? 18 : 36, hy = hz;
  const tgt = B.crouching ? 1 : 0; B.crouchAmt += Math.max(-dt / 0.2, Math.min(dt / 0.2, tgt - B.crouchAmt));

  let [ox, oy, oz] = toCs(p, hz), vx = B.vel.x * U, vy = -B.vel.z * U, vz = B.vel.y * U;
  const vmax = (ctx.vmax || 6.25) * U * (B.crouching ? GS.CROUCH_MUL : inp.walk ? GS.WALK_MUL : 1);

  // вода / стълба
  let inWater = false; for (const w of bsp.waters) if (inBox(w, ox, oy, oz - hz + 8, 16, 16, 8)) { inWater = true; break; }
  B.inWater = inWater;
  let ladder = null; if (inp.can) for (const l of bsp.ladders) if (inBox(l, ox, oy, oz, 18, 18, hy)) { ladder = l; break; }

  // тласък от trigger_push (basevelocity)
  let bvx = 0, bvy = 0, bvz = 0;
  for (const t of bsp.pushes) if (inBox(t, ox, oy, oz, 16, 16, hy)) {
    const sx = t.dir[0] * t.speed, sy = t.dir[1] * t.speed, sz = t.dir[2] * t.speed;
    if (t.once) { vx += sx; vy += sy; vz += sz; } else { bvx += sx; bvy += sy; bvz += sz; }
  }
  if (bvx || bvy || bvz) { vx += bvx; vy += bvy; vz += bvz; }

  // земя?
  const cat = () => { const tr = bsp.trace(hull, ox, oy, oz, ox, oy, oz - 2); return tr; };
  let gtr = vz > 180 ? null : cat();
  let onGround = !!gtr && gtr.frac < 1 && gtr.nz >= 0.7 && !gtr.allSolid;
  const wasGround = B.onGround;

  const wf = inp.fz, wr = inp.fx, sn = Math.sin(B.yaw), cs = Math.cos(B.yaw);
  // игрови (x, z) -> CS (x, y): csY = -z
  let wxg = wr * cs + wf * sn, wzg = -wr * sn + wf * cs;
  let wx = wxg, wy = -wzg; const wl = Math.hypot(wx, wy); if (wl > 0) { wx /= wl; wy /= wl; }
  const wishspeed = wl > 0 ? vmax : 0;

  const clipv = [0, 0, 0], tmpv = [0, 0, 0];
  // ---- FlyMove ----
  const flyMove = () => {
    let timeLeft = dt, blocked = 0; const planes = []; const orig = [vx, vy, vz], prim = [vx, vy, vz]; let nv = [0, 0, 0];
    for (let bump = 0; bump < 4; bump++) {
      if (vx === 0 && vy === 0 && vz === 0) break;
      const tr = bsp.trace(hull, ox, oy, oz, ox + vx * timeLeft, oy + vy * timeLeft, oz + vz * timeLeft);
      if (tr.allSolid) { vx = vy = vz = 0; return 4; }
      if (tr.frac > 0) { ox = tr.x; oy = tr.y; oz = tr.z; planes.length = 0; orig[0] = vx; orig[1] = vy; orig[2] = vz; }
      if (tr.frac === 1) break;
      if (tr.nz > 0.7) blocked |= 1; if (tr.nz === 0) blocked |= 2;
      timeLeft -= timeLeft * tr.frac;
      if (planes.length >= 5) { vx = vy = vz = 0; return blocked; }
      planes.push([tr.nx, tr.ny, tr.nz]);
      let i, j;
      for (i = 0; i < planes.length; i++) {
        clipVel(orig, planes[i][0], planes[i][1], planes[i][2], nv, 1);
        for (j = 0; j < planes.length; j++) if (j !== i && nv[0] * planes[j][0] + nv[1] * planes[j][1] + nv[2] * planes[j][2] < 0) break;
        if (j === planes.length) break;
      }
      if (i !== planes.length) { vx = nv[0]; vy = nv[1]; vz = nv[2]; }
      else {
        if (planes.length !== 2) { vx = vy = vz = 0; break; }
        const a = planes[0], b = planes[1], dx = a[1] * b[2] - a[2] * b[1], dy = a[2] * b[0] - a[0] * b[2], dz = a[0] * b[1] - a[1] * b[0], d = dx * vx + dy * vy + dz * vz;
        vx = dx * d; vy = dy * d; vz = dz * d;
      }
      if (vx * prim[0] + vy * prim[1] + vz * prim[2] <= 0) { vx = vy = vz = 0; break; }
    }
    return blocked;
  };
  const accel = (wdx, wdy, wspd, ac, cap = Infinity) => {
    const ws = Math.min(wspd, cap), cur = vx * wdx + vy * wdy, add = ws - cur; if (add <= 0) return;
    const a = Math.min(ac * dt * wspd, add); vx += a * wdx; vy += a * wdy;
  };

  let jumped = false;
  if (ladder) {
    // стълба: W = нагоре, S = надолу, Space = скок настрани
    const up = inp.fz < 0 ? 1 : inp.fz > 0 ? -1 : 0;
    if (inp.jumpHeld && !wasGround) { vz = GS.JUMP * 0.5; vx = -sn * 180; vy = cs * 180; }
    else { vx = 0; vy = 0; vz = up * GS.LADDER * (B.pitch < -0.1 && up > 0 ? 1 : 1); if (inp.fx) { vx = cs * inp.fx * 100; vy = sn * inp.fx * 100; } }
    flyMove(); onGround = false;
  } else if (inWater) {
    // плуване по посока на погледа (CS ос: напред = (-sin, +cos); csY = -gameZ)
    const cp = Math.cos(B.pitch), wvx0 = (-sn * -wf + cs * wr) * cp, wvy0 = (cs * -wf + sn * wr) * cp;
    let wvx = wvx0, wvy = wvy0, wvz = Math.sin(B.pitch) * -wf + (inp.jumpHeld ? 0.8 : 0) - (inp.crouch ? 0.8 : 0);
    const wl3 = Math.hypot(wvx, wvy, wvz), ws = Math.min(vmax * 0.8, wl3 ? vmax * 0.8 : 0);
    const sp = Math.hypot(vx, vy, vz);
    if (sp > 0.1) { const nsp = Math.max(0, sp - sp * 4 * dt); const k = nsp / sp; vx *= k; vy *= k; vz *= k; }
    if (wl3 > 0) { wvx /= wl3; wvy /= wl3; wvz /= wl3; const cur = vx * wvx + vy * wvy + vz * wvz, add = ws - cur; if (add > 0) { const a = Math.min(10 * dt * ws, add); vx += a * wvx; vy += a * wvy; vz += a * wvz; } }
    else vz -= 25 * dt * 4;
    flyMove(); onGround = false;
  } else if (onGround) {
    // скок (без автоматичен bhop – нужно е ново натискане)
    if (inp.can && inp.jumpNow) { vz = GS.JUMP; onGround = false; jumped = true; B.jumped = true; }
    else {
      // триене
      const sp = Math.hypot(vx, vy, vz);
      if (sp >= 0.1) { const ctl = sp < GS.STOP ? GS.STOP : sp, drop = ctl * GS.FRICTION * dt; const ns = Math.max(0, sp - drop); const k = ns / sp; vx *= k; vy *= k; vz *= k; }
      vz = 0; accel(wx, wy, wishspeed, GS.ACCEL); vz = 0;
      const hs = Math.hypot(vx, vy);
      if (hs > 0.1) {
        const sx = ox, sy = oy, sz = oz, svx = vx, svy = vy;
        const tr = bsp.trace(hull, ox, oy, oz, ox + vx * dt, oy + vy * dt, oz);
        if (tr.frac === 1) { ox = tr.x; oy = tr.y; oz = tr.z; }
        else {
          // 1) обикновено движение с плъзгане
          flyMove(); const dx = ox, dy = oy, dz = oz, dvx = vx, dvy = vy, dvz = vz;
          // 2) със стъпало: нагоре, напред, надолу
          ox = sx; oy = sy; oz = sz; vx = svx; vy = svy; vz = 0;
          const up = bsp.trace(hull, ox, oy, oz, ox, oy, oz + GS.STEP); if (!up.allSolid) { ox = up.x; oy = up.y; oz = up.z; }
          flyMove();
          const dn = bsp.trace(hull, ox, oy, oz, ox, oy, oz - GS.STEP);
          if (dn.nz < 0.7 && dn.frac < 1) { ox = dx; oy = dy; oz = dz; vx = dvx; vy = dvy; vz = dvz; }
          else {
            if (!dn.allSolid) { ox = dn.x; oy = dn.y; oz = dn.z; }
            const downd = (dx - sx) ** 2 + (dy - sy) ** 2, upd = (ox - sx) ** 2 + (oy - sy) ** 2;
            if (downd > upd) { ox = dx; oy = dy; oz = dz; vx = dvx; vy = dvy; vz = dvz; } else vz = dvz;
          }
        }
        // залепване за земята при спускане по наклон
        const sn2 = bsp.trace(hull, ox, oy, oz, ox, oy, oz - GS.STEP);
        if (!sn2.allSolid && sn2.frac < 1 && sn2.nz >= 0.7 && vz <= 0) { ox = sn2.x; oy = sn2.y; oz = sn2.z; }
      }
    }
    if (jumped) { vz = GS.JUMP; /* въздушна фаза този кадър */ vz -= GS.GRAVITY * dt * 0.5; flyMove(); }
  } else {
    // въздух: ускорение 100 (surf), cap 30
    accel(wx, wy, wishspeed, GS.AIR_ACCEL, GS.AIR_CAP);
    vz -= GS.GRAVITY * dt * 0.5;
    flyMove();
    vz -= GS.GRAVITY * dt * 0.5;
  }

  // след движението: махаме basevelocity, ограничаваме скоростта
  if (bvx || bvy || bvz) { vx -= bvx; vy -= bvy; vz -= bvz; }
  const sp3 = Math.hypot(vx, vy, vz); if (sp3 > GS.MAXVEL) { const k = GS.MAXVEL / sp3; vx *= k; vy *= k; vz *= k; }

  // нова категория (земя)
  const g2 = vz > 180 ? null : bsp.trace(hull, ox, oy, oz, ox, oy, oz - 2);
  const nowGround = !!g2 && g2.frac < 1 && g2.nz >= 0.7 && !g2.allSolid && !inWater && !ladder;
  const surfing = !nowGround && !!g2 && g2.frac < 1 && g2.nz > 0.01 && g2.nz < 0.7 && vz < 0;
  const vyBefore = B.vel.y;
  B.onGround = nowGround; B.surfing = surfing; B.groundN = nowGround ? { nx: g2.nx, ny: g2.nz, nz: -g2.ny } : null;
  if (nowGround && !wasGround && vyBefore < -3.5) emit('land', { strength: -vyBefore / 8, surface: 'stone' });
  if (jumped) emit('jump', { surface: 'stone' });
  const np = fromCs(ox, oy, oz, hz); p.x = np.x; p.y = np.y; p.z = np.z;
  B.vel.x = vx / U; B.vel.y = vz / U; B.vel.z = -vy / U;
  const hs = Math.hypot(B.vel.x, B.vel.z); B.speed = hs;
  if (nowGround && hs > 1.6 && !inp.walk && !B.crouching) { B.stepAcc = (B.stepAcc || 0) + hs * dt; if (B.stepAcc >= 2.0) { B.stepAcc = 0; emit('step', { surface: 'stone' }); } }
  B.wjT = 0; B.platform = null;
}
