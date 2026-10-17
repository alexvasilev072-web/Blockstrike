// Лек ragdoll (само на клиента, не се синхронизира): верле симулация на ~14 точки, свързани с ограничения на разстоянието.
// Точките са ставите на скелета; частите на модела (глава, торс, крака, ръце) се подреждат по тях. Сблъсък със блоковете на картата
// (сфера срещу воксел), триене, „заспиване“ след 2–3 секунди. Без външни библиотеки.
import * as THREE from 'three';

const G = 22, DAMP = 0.992, STEP = 1 / 60, ITER = 7, SLEEP_MIN = 1.1, SLEEP_MAX = 2.8;
// индекси на точките
const H = 0, N = 1, SL = 2, SR = 3, HL = 4, HR = 5, KL = 6, KR = 7, FL = 8, FR = 9, DL = 10, DR = 11, C = 12;
const RAD = [0.11, 0.06, 0.1, 0.1, 0.1, 0.1, 0.07, 0.07, 0.06, 0.06, 0.05, 0.05, 0.1];
const MASSK = [1.25, 1, 1, 1, 0.8, 0.8, 0.6, 0.6, 0.45, 0.45, 0.9, 0.9, 1];      // колко от импулса получава всяка точка
const REST = shX => [[0, 1.665, 0], [0, 1.5, 0], [-shX, 1.455, 0], [shX, 1.455, 0], [-0.095, 0.88, 0], [0.095, 0.88, 0], [-0.095, 0.44, 0], [0.095, 0.44, 0], [-0.095, 0.05, -0.02], [0.095, 0.05, -0.02], [-0.24, 1.0, -0.04], [0.24, 1.0, -0.04], [0, 1.2, 0]];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _up = new THREE.Vector3(), _rt = new THREE.Vector3(), _bk = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0);

// ограничения: [a, b, дължина, вид] – eq: точно; max: въже (най-много); min: прът (най-малко)
function makeCons(P) {
  const d = (a, b, kind = 'eq', k = 1) => ({ a, b, len: P[a].distanceTo(P[b]) * (kind === 'min' ? 0.8 : 1), kind, k });
  return [
    d(H, N), d(N, SL), d(N, SR), d(SL, SR), d(HL, HR), d(SL, HL), d(SR, HR), d(SL, HR), d(SR, HL), d(N, C), d(C, SL), d(C, SR), d(C, HL), d(C, HR),
    d(HL, KL), d(KL, FL), d(HR, KR), d(KR, FR), d(H, SL, 'eq', 0.35), d(H, SR, 'eq', 0.35), d(H, C, 'min'),
    d(SL, DL, 'max'), d(SR, DR, 'max'), d(KL, KR, 'min'), d(FL, FR, 'min'), d(HL, FL, 'min'), d(HR, FR, 'min'),
  ];
}

export class Ragdoll {
  // m: модел на играча (shX…); pose: {x,y,z,yw,cr}; hit: {dx,dy,dz,f,hd}; world: воксел свят със solid(x,y,z)
  constructor(shX, pose, hit, world, seed = 1) {
    this.world = world; this.t = 0; this.asleep = false; this.acc = 0; this.shX = shX;
    const rest = REST(shX), cy = Math.cos(pose.yw), sy = Math.sin(pose.yw), lower = pose.cr ? 0.78 : 1;
    this.p = rest.map(([x, y, z]) => new THREE.Vector3(pose.x + x * cy + z * sy, pose.y + y * lower, pose.z - x * sy + z * cy));
    this.o = this.p.map(v => v.clone());
    this.cons = makeCons(this.p);
    // първоначален импулс: тялото се тласка по посоката на куршума; главата (особено при хедшот) повече и нагоре
    let rnd = seed * 9301 + 49297; const r = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280 - 0.5; };
    const f = hit?.f ?? 0, dx = hit?.dx ?? 0, dy = hit?.dy ?? 0.3, dz = hit?.dz ?? 0, hd = hit?.hd ? 1 : 0;
    for (let i = 0; i < this.p.length; i++) {
      const k = MASSK[i] * (i === H && hd ? 1.9 : 1), vx = (dx * f + r() * 0.8) * k, vy = (dy * f * 0.7 + 0.4 + r() * 0.5) * k, vz = (dz * f + r() * 0.8) * k;
      this.o[i].set(this.p[i].x - vx * STEP, this.p[i].y - vy * STEP, this.p[i].z - vz * STEP);
    }
    if (hd) { this.o[H].y -= 0.012 * f; }
    // при хедшот горната част рязко „отхвръква“ назад около таза
    this.solidAt = (x, y, z) => { try { return !!world.solid(x, y, z); } catch { return false; } };
  }

  step(dt) {
    if (this.asleep) return false;
    this.acc += Math.min(dt, 0.05); let moved = false;
    while (this.acc >= STEP) { this.acc -= STEP; this.integrate(); this.t += STEP; moved = true; if (this.t > SLEEP_MAX || (this.t > SLEEP_MIN && this.energy() < 0.0004)) { this.asleep = true; break; } }
    return moved || this.asleep;
  }
  energy() { let e = 0; for (let i = 0; i < this.p.length; i++) e += this.p[i].distanceToSquared(this.o[i]); return e / this.p.length; }
  integrate() {
    const P = this.p, O = this.o, g = G * STEP * STEP;
    for (let i = 0; i < P.length; i++) {
      const x = P[i].x, y = P[i].y, z = P[i].z;
      P[i].x += (x - O[i].x) * DAMP; P[i].y += (y - O[i].y) * DAMP - g; P[i].z += (z - O[i].z) * DAMP;
      O[i].set(x, y, z);
    }
    for (let it = 0; it < ITER; it++) {
      for (const c of this.cons) {
        const a = P[c.a], b = P[c.b]; _a.copy(b).sub(a); const l = _a.length() || 1e-6;
        if (c.kind === 'max' ? l <= c.len : c.kind === 'min' ? l >= c.len : false) continue;
        const dif = (l - c.len) / l * 0.5 * c.k; _a.multiplyScalar(dif); a.add(_a); b.sub(_a);
      }
      for (let i = 0; i < P.length; i++) this.collide(i);
    }
  }
  // сфера срещу воксели: избутване по най-близката ос + триене по допирателната
  collide(i) {
    const p = this.p[i], o = this.o[i], r = RAD[i];
    if (p.y < r - 0.3) { p.y = r - 0.3; }                                   // под картата няма какво да пада безкрайно
    const x0 = Math.floor(p.x - r), x1 = Math.floor(p.x + r), y0 = Math.floor(p.y - r), y1 = Math.floor(p.y + r), z0 = Math.floor(p.z - r), z1 = Math.floor(p.z + r);
    for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) {
      if (!this.solidAt(bx, by, bz)) continue;
      const cx = Math.max(bx, Math.min(p.x, bx + 1)), cy = Math.max(by, Math.min(p.y, by + 1)), cz = Math.max(bz, Math.min(p.z, bz + 1));
      let nx = p.x - cx, ny = p.y - cy, nz = p.z - cz, d2 = nx * nx + ny * ny + nz * nz;
      if (d2 >= r * r) continue;
      let push;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); nx /= d; ny /= d; nz /= d; push = r - d; }
      else {                                                              // центърът е вътре в блока: излизаме през най-близката стена, която не е запълнена
        const opts = [[p.x - bx, -1, 0, 0], [bx + 1 - p.x, 1, 0, 0], [p.y - by, 0, -1, 0], [by + 1 - p.y, 0, 1, 0], [p.z - bz, 0, 0, -1], [bz + 1 - p.z, 0, 0, 1]].filter(q => !this.solidAt(bx + q[1], by + q[2], bz + q[3])).sort((u, v) => u[0] - v[0]);
        const q = opts[0] || [0.5, 0, 1, 0]; nx = q[1]; ny = q[2]; nz = q[3]; push = q[0] + r;
      }
      p.x += nx * push; p.y += ny * push; p.z += nz * push;
      // скорост: махаме компонентата към повърхността, триене по допирателната
      let vx = p.x - o.x, vy = p.y - o.y, vz = p.z - o.z; const vn = vx * nx + vy * ny + vz * nz;
      if (vn < 0) { vx -= nx * vn * 1.05; vy -= ny * vn * 1.05; vz -= nz * vn * 1.05; }
      const fr = ny > 0.5 ? 0.55 : 0.8; vx *= fr; vz *= fr; if (ny <= 0.5) vy *= 0.9;
      o.set(p.x - vx, p.y - vy, p.z - vz);
    }
  }
}

// ---------- прилагане към частите на модела ----------
const basis = (x, y, z, out) => out.setFromRotationMatrix(_m.makeBasis(x, y, z));
// запазва началните позиции на частите, за да се върнат при нов рунд
export function rememberRest(m) {
  m.rest = { head: m.head.position.clone(), body: m.body.position.clone(), legL: m.legL.position.clone(), legR: m.legR.position.clone(), shinL: m.legL.userData.shin.position.clone(), shinR: m.legR.userData.shin.position.clone(), aim: m.aim.position.clone() };
}
export function resetRagdollPose(m) {
  if (!m.rest) return; const R = m.rest;
  m.head.position.copy(R.head); m.body.position.copy(R.body); m.legL.position.copy(R.legL); m.legR.position.copy(R.legR); m.aim.position.copy(R.aim);
  for (const o of [m.head, m.body, m.legL, m.legR, m.legL.userData.shin, m.legR.userData.shin, m.aim, m.rig, m.g]) o.quaternion.identity();
  m.legL.userData.shin.position.copy(R.shinL); m.legR.userData.shin.position.copy(R.shinR); m.rig.position.set(0, 0, 0); m.shadow.visible = true;
  m.g.traverse(o => { if (o.isSprite) o.visible = true; });
  m.gunHolder.visible = true; m.rag = null;
}
export function applyRagdoll(m, rg, setArm) {
  const P = rg.p; m.g.position.set(0, 0, 0); m.g.rotation.set(0, 0, 0); m.rig.position.set(0, 0, 0); m.shadow.visible = false; m.gunHolder.visible = false; m.bomb.visible = false;
  // торс: ос „нагоре“ от таза към раменете, „надясно“ от лявото към дясното рамо
  _up.copy(P[SL]).add(P[SR]).multiplyScalar(0.5); _c.copy(P[HL]).add(P[HR]).multiplyScalar(0.5); _up.sub(_c).normalize();
  _rt.copy(P[SR]).sub(P[SL]); _bk.crossVectors(_rt, _up).normalize(); _rt.crossVectors(_up, _bk).normalize();
  basis(_rt, _up, _bk, _q);
  m.body.position.copy(_c).addScaledVector(_up, 0.27); m.body.quaternion.copy(_q);
  // глава
  _a.copy(P[H]).sub(P[N]).normalize(); _b.crossVectors(_rt, _a).normalize(); _c.crossVectors(_a, _b).normalize(); basis(_c, _a, _b, _q2);
  m.head.position.copy(P[H]); m.head.quaternion.copy(_q2);
  // крака: бедро (от таза към коляното), подбедрица спрямо бедрото
  for (const [leg, hip, knee, foot] of [[m.legL, HL, KL, FL], [m.legR, HR, KR, FR]]) {
    _a.copy(P[hip]).sub(P[knee]).normalize(); _b.crossVectors(_rt, _a).normalize(); _c.crossVectors(_a, _b).normalize(); basis(_c, _a, _b, _q2);
    leg.position.copy(P[hip]); leg.quaternion.copy(_q2);
    const shin = leg.userData.shin; _a.copy(P[knee]).sub(P[foot]).normalize(); _b.crossVectors(_rt, _a).normalize(); _c.crossVectors(_a, _b).normalize();
    const wq = basis(_c, _a, _b, new THREE.Quaternion()); shin.quaternion.copy(_q2).invert().multiply(wq);
  }
  // ръце: рамото е в центъра на aim-групата; целта – ръката, в координатите на торса
  _c.copy(P[SL]).add(P[SR]).multiplyScalar(0.5); m.aim.position.copy(_c); m.aim.quaternion.copy(_q);
  _q2.copy(_q).invert();
  for (const [arm, hand, pt, side] of [[m.armL, m.handL, DL, -1], [m.armR, m.handR, DR, 1]]) {
    _b.copy(P[pt]).sub(_c).applyQuaternion(_q2); _a.set(side * m.shX, 0, 0); setArm(arm, hand, _a, _b, side);
  }
  m.g.traverse(o => { if (o.isSprite) o.visible = false; });
}
