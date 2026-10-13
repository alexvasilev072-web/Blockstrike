// BlockStrike - клиент (Three.js). Сървърът е авторитетен за попадения и състояние; тук е рендерът, входът и предвиждането на движението.
import * as THREE from 'three';
import { World, BLOCK, boxCollides } from '/shared/world.js';
import { WEAPONS, ITEMS, CFG } from '/shared/weapons.js';

const $ = s => document.querySelector(s);
const socket = io();
const TEAM_NAME = { att: 'Нападатели', def: 'Защитници' };
const TEAM_COL = { att: '#f0922b', def: '#4a90ff' };

const S = {
  id: null, code: null, lobby: null, inGame: false, mapJson: null, base: null, world: null, mapReady: null,
  snap: null, pbuf: new Map(), offset: 0, offsetInit: false, ping: 60, phase: 'lobby',
  me: { hp: 0, ar: 0, mo: 0, w: 'pistol', inv: { pr: null, se: 'pistol', n: 0 }, mag: 0, res: 0, rl: 0, tm: 'att', us: null },
  pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, recoil: 0, onGround: false,
  keys: {}, firing: false, clicked: false, nextFire: 0, scoped: false, locked: false,
  meshDirty: false, buyOpen: false, boardOpen: false, specId: null, vmWeapon: null, kick: 0, lastBeep: 0, lastBought: 0,
};
window.__S = S;

// ================= Лоби / вход =================
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom) $('#room').value = qRoom.toUpperCase();
$('#name').value = localStorage.getItem('bs_name') || '';

function doJoin() {
  const name = $('#name').value.trim();
  localStorage.setItem('bs_name', name);
  socket.emit('join', { name, room: $('#room').value.trim() }, res => {
    if (!res.ok) { $('#joinErr').textContent = res.error; return; }
    S.id = res.id; S.code = res.code;
    history.replaceState(null, '', '?room=' + res.code);
    $('#join').classList.add('hidden'); $('#lobby').classList.remove('hidden');
  });
}
$('#joinBtn').onclick = doJoin;
$('#room').onkeydown = $('#name').onkeydown = e => { if (e.key === 'Enter') doJoin(); };
$('#copyLink').onclick = () => { navigator.clipboard?.writeText(location.href); $('#copyLink').textContent = 'Копирано!'; setTimeout(() => $('#copyLink').textContent = 'Копирай линк', 1500); };
document.querySelectorAll('[data-team]').forEach(b => b.onclick = () => socket.emit('team', b.dataset.team));
$('#startBtn').onclick = () => socket.emit('start');
$('#mapSel').onchange = e => socket.emit('setMap', e.target.value);

socket.on('lobby', L => {
  S.lobby = L;
  const me = L.players.find(p => p.id === S.id);
  if (me) S.myTeam = me.team;
  $('#lobCode').textContent = L.code;
  for (const t of ['att', 'def']) {
    $(t === 'att' ? '#listAtt' : '#listDef').innerHTML = L.players.filter(p => p.team === t)
      .map(p => `<li class="${p.id === S.id ? 'me' : ''}">${esc(p.name)} ${p.id === L.hostId ? '<span class="host">★ домакин</span>' : ''}</li>`).join('');
  }
  const sel = $('#mapSel');
  if (sel.options.length !== L.maps.length) sel.innerHTML = L.maps.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  sel.value = L.mapId; sel.disabled = L.hostId !== S.id;
  $('#mapDesc').textContent = L.maps.find(m => m.id === L.mapId)?.desc || '';
  const host = L.hostId === S.id;
  $('#startBtn').style.display = host ? '' : 'none';
  $('#lobHint').textContent = host ? 'Ти си домакин – натисни „Старт“, когато всички са готови. Можеш да стартираш и сам за проба.' : 'Изчакване домакинът да стартира играта…';
  S.phase = L.phase;
  if (L.phase === 'lobby' && S.inGame) leaveGame();
});

function leaveGame() {
  S.inGame = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('#hud').classList.add('hidden'); $('#lobby').classList.remove('hidden');
  for (const m of models.values()) scene.remove(m.g);
  models.clear(); S.pbuf.clear();
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ================= Three.js =================
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ----- текстури (процедурни, пикселирани) -----
const NT = 9;
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const TILE = {
  1: { c: [220, 197, 138], v: 14 }, 2: { c: [201, 169, 107], v: 12, brick: [158, 128, 80] }, 3: { c: [156, 107, 58], v: 14, planks: true },
  4: { glass: true }, 5: { c: [125, 127, 131], v: 14 }, 6: { site: true }, 7: { c: [154, 74, 58], v: 14, brick: [205, 195, 185] },
  8: { c: [108, 122, 137], v: 8, rivets: true }, 9: { c: [165, 143, 98], v: 12 },
};
function makeAtlas() {
  const c = document.createElement('canvas'); c.width = 16 * NT; c.height = 16;
  const g = c.getContext('2d'); const R = rng(1337);
  for (let id = 1; id <= NT; id++) {
    const d = TILE[id], ox = (id - 1) * 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let col, a = 1;
      if (d.glass) {
        col = [175, 225, 255]; a = 0.26;
        if (x === 0 || y === 0 || x === 15 || y === 15) { col = [225, 245, 255]; a = 0.85; }
        else if ((x + y === 6) || (x + y === 7) || (x + y === 11)) a = 0.55;
      } else if (d.site) {
        col = ((x + y) >> 2) & 1 ? [242, 194, 48] : [48, 44, 40];
      } else {
        const v = (R() - 0.5) * d.v; col = d.c.map(k => k + v);
        if (d.brick) { const row = y >> 2; if (y % 4 === 0 || (x + (row % 2) * 4) % 8 === 0) col = d.brick.map(k => k + (R() - .5) * 8); }
        if (d.planks && (y % 4 === 0)) col = col.map(k => k * 0.6);
        if (d.planks && R() < 0.12) col = col.map(k => k * 0.85);
        if (d.rivets && ((x % 8 === 1 || x % 8 === 6) && (y % 8 === 1 || y % 8 === 6))) col = [200, 210, 220];
        if (d.rivets && (x === 0 || y === 0)) col = col.map(k => k * 0.7);
      }
      g.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a})`; g.fillRect(ox + x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const atlas = makeAtlas();
const matOpaque = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true });
const matGlass = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, transparent: true, depthWrite: false });

const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], l: 0.82 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], l: 0.82 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], l: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], l: 0.5 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], l: 0.7 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], l: 0.7 },
];
const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
let worldGroup = null;
function buildWorldMesh(world) {
  if (worldGroup) { scene.remove(worldGroup); worldGroup.children.forEach(m => m.geometry.dispose()); }
  const B = () => ({ pos: [], uv: [], col: [], idx: [] });
  const buckets = [B(), B()];
  for (let y = 0; y < world.sy; y++) for (let z = 0; z < world.sz; z++) for (let x = 0; x < world.sx; x++) {
    const b = world.data[(y * world.sz + z) * world.sx + x]; if (!b) continue;
    const isG = b === BLOCK.glass, k = buckets[isG ? 1 : 0];
    const h = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 255;
    for (const f of FACES) {
      const nb = world.get(x + f.n[0], y + f.n[1], z + f.n[2]);
      if (!(nb === 0 || (nb === BLOCK.glass && !isG))) continue;
      const base = k.pos.length / 3, sh = f.l * (0.93 + 0.07 * (h / 255));
      for (let i = 0; i < 4; i++) {
        k.pos.push(x + f.c[i][0], y + f.c[i][1], z + f.c[i][2]);
        k.uv.push(((b - 1) + UVS[i][0] * 0.98 + 0.01) / NT, UVS[i][1] * 0.98 + 0.01);
        k.col.push(sh, sh, sh);
      }
      k.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  worldGroup = new THREE.Group();
  buckets.forEach((k, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(k.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(k.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(k.col, 3));
    g.setIndex(k.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, i ? matGlass : matOpaque);
    if (i) m.renderOrder = 2;
    worldGroup.add(m);
  });
  scene.add(worldGroup);
}

// ----- декор на картата -----
let mapDeco = [];
function setupMapDecor(json) {
  mapDeco.forEach(o => scene.remove(o)); mapDeco = [];
  scene.background = new THREE.Color(json.sky || '#8fd0ff');
  scene.fog = new THREE.Fog(json.sky || '#8fd0ff', 45, 130);
  const [sx, , sz] = json.size;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshBasicMaterial({ color: new THREE.Color('#b59d6a') }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(sx / 2, -0.6, sz / 2); scene.add(ground); mapDeco.push(ground);
  for (const [name, [x1, z1, x2, z2]] of Object.entries(json.sites)) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); g.font = 'bold 110px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#000'; g.strokeText(name, 64, 70); g.fillStyle = '#ffd34d'; g.fillText(name, 64, 70);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, opacity: 0.75, fog: false }));
    sp.scale.set(2.6, 2.6, 1); sp.position.set((x1 + x2 + 1) / 2, 4.2, (z1 + z2 + 1) / 2); sp.renderOrder = 10;
    scene.add(sp); mapDeco.push(sp);
  }
}

// ================= Модели на играчите =================
const models = new Map();
const mats = {};
const mat = (hex) => mats[hex] || (mats[hex] = new THREE.MeshBasicMaterial({ color: hex }));
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
function nameSprite(name, col) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d'); g.font = 'bold 30px Segoe UI, Arial'; g.textAlign = 'center'; g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(name, 128, 34); g.fillStyle = col; g.fillText(name, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  s.scale.set(1.6, 0.3, 1); s.position.y = 2.15; s.renderOrder = 9; return s;
}
function makeModel(p) {
  const shirt = p.tm === 'att' ? 0xe07b1a : 0x2f6fdc, dark = p.tm === 'att' ? 0x7a3d0c : 0x1a3b78;
  const g = new THREE.Group();
  const head = box(0.5, 0.5, 0.5, mat(0xe8b98f)); head.position.set(0, 1.55, 0);
  const hat = box(0.54, 0.16, 0.54, mat(dark)); hat.position.set(0, 0.2, 0); head.add(hat);
  const face = box(0.3, 0.08, 0.02, mat(0x222222)); face.position.set(0, 0.04, -0.26); head.add(face);
  const body = box(0.56, 0.72, 0.3, mat(shirt)); body.position.set(0, 1.0, 0);
  const mkLeg = x => { const l = new THREE.Group(); l.position.set(x, 0.66, 0); const m = box(0.24, 0.66, 0.26, mat(0x2b3550)); m.position.y = -0.33; l.add(m); return l; };
  const legL = mkLeg(-0.14), legR = mkLeg(0.14);
  const mkArm = x => { const a = new THREE.Group(); a.position.set(x, 1.32, 0); const m = box(0.18, 0.62, 0.18, mat(shirt)); m.position.y = -0.28; a.add(m); return a; };
  const armL = mkArm(-0.37), armR = mkArm(0.37);
  armR.rotation.x = -1.45; armL.rotation.x = -1.2; armL.rotation.y = 0.35;
  const gun = box(0.08, 0.1, 0.6, mat(0x222222)); gun.position.set(0, -0.62, -0.28); armR.add(gun);
  const flash = box(0.16, 0.16, 0.2, new THREE.MeshBasicMaterial({ color: 0xffe08a })); flash.position.set(0, 0, -0.45); flash.visible = false; gun.add(flash);
  g.add(head, body, legL, legR, armL, armR);
  const m = { g, head, legL, legR, armL, armR, gun, flash, flashUntil: 0, team: p.tm, name: p.n, lie: 0, lastX: p.x, lastZ: p.z, phase: 0 };
  scene.add(g); return m;
}
function setGunColor(m, w) { m.gun.scale.z = w === 'sniper' ? 1.4 : w === 'rifle' ? 1.1 : w === 'grenade' ? 0.3 : 0.55; m.gun.material = mat(w === 'sniper' ? 0x2c4a2c : w === 'rifle' ? 0x4a3322 : w === 'deagle' ? 0xaaaaaa : w === 'grenade' ? 0x3c9c3c : 0x333333); }

const lerpAng = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
function poseOf(id, rt) {
  const b = S.pbuf.get(id); if (!b || !b.length) return null;
  if (rt <= b[0].t) return b[0];
  for (let i = b.length - 1; i >= 0; i--) if (b[i].t <= rt) {
    if (i === b.length - 1) return b[i];
    const a = b[i], c = b[i + 1], k = (rt - a.t) / Math.max(1, c.t - a.t);
    return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yw: lerpAng(a.yw, c.yw, k), pt: a.pt + (c.pt - a.pt) * k };
  }
  return b[0];
}
const serverNow = () => Date.now() + S.offset;

function updateModels(dt) {
  const snap = S.snap; if (!snap) return;
  const rt = serverNow() - 100, ids = new Set();
  for (const p of snap.pl) {
    if (p.i === S.id) continue;
    ids.add(p.i);
    let m = models.get(p.i);
    if (!m || m.team !== p.tm) { if (m) scene.remove(m.g); m = makeModel(p); models.set(p.i, m); if (p.tm === S.me.tm) { m.g.add(nameSprite(p.n, TEAM_COL[p.tm])); } }
    const pose = poseOf(p.i, rt) || p;
    m.g.visible = !(S.specId === p.i && !alive());
    m.g.position.set(pose.x, pose.y, pose.z);
    m.g.rotation.y = pose.yw;
    m.head.rotation.x = -pose.pt * 0.8;
    const sp = Math.hypot(pose.x - m.lastX, pose.z - m.lastZ) / Math.max(dt, 0.001); m.lastX = pose.x; m.lastZ = pose.z;
    m.phase += Math.min(sp, 8) * dt * 2.2;
    const sw = p.al ? Math.sin(m.phase) * Math.min(1, sp / 4) * 0.8 : 0;
    m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
    if (m.gunW !== p.w) { m.gunW = p.w; setGunColor(m, p.w); }
    m.lie += ((p.al ? 0 : 1) - m.lie) * Math.min(1, dt * 8);
    m.g.rotation.x = -m.lie * Math.PI / 2; m.g.rotation.order = 'YXZ';
    m.g.position.y += m.lie * 0.3;
    m.flash.visible = Date.now() < m.flashUntil;
  }
  for (const [id, m] of models) if (!ids.has(id)) { scene.remove(m.g); models.delete(id); }
}

// ================= Ефекти =================
const fx = []; // {mesh, v, life, type}
const partGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const BLOCK_COL = { 3: 0x9c6b3a, 4: 0xbfe6ff };
function spawnParticles(x, y, z, color, n, speed = 3) {
  for (let i = 0; i < n && fx.length < 400; i++) {
    const m = new THREE.Mesh(partGeo, mat(color)); m.position.set(x, y, z); m.scale.setScalar(0.6 + Math.random() * 0.8);
    scene.add(m); fx.push({ mesh: m, v: [(Math.random() - .5) * speed, Math.random() * speed, (Math.random() - .5) * speed], life: 0.6 + Math.random() * 0.5, type: 'part' });
  }
}
function tracer(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); if (len < 0.1) return;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 1), new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.9 }));
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.lookAt(b[0], b[1], b[2]); m.scale.z = len;
  scene.add(m); fx.push({ mesh: m, life: 0.07, type: 'tracer' });
}
function explosion(x, y, z, r, big) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.85 }));
  m.position.set(x, y, z); scene.add(m); fx.push({ mesh: m, life: 0.5, max: 0.5, r: r * (big ? 0.6 : 0.4), type: 'boom' });
  spawnParticles(x, y, z, 0x555555, big ? 30 : 14, 8); spawnParticles(x, y, z, 0xffcc44, 14, 9);
  const d = Math.hypot(S.pos.x - x, S.pos.y - y, S.pos.z - z); S.shake = Math.max(S.shake || 0, Math.max(0, 1 - d / (r * 2.2)) * 0.35);
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.life -= dt;
    if (f.type === 'part') { f.v[1] -= 16 * dt; f.mesh.position.x += f.v[0] * dt; f.mesh.position.y += f.v[1] * dt; f.mesh.position.z += f.v[2] * dt; }
    else if (f.type === 'boom') { const k = 1 - f.life / f.max; f.mesh.scale.setScalar(0.3 + f.r * k); f.mesh.material.opacity = 0.85 * (1 - k); }
    if (f.life <= 0) { scene.remove(f.mesh); if (f.type !== 'part') { f.mesh.geometry.dispose(); f.mesh.material.dispose(); } fx.splice(i, 1); }
  }
}

// ----- гранати и бомба -----
const nadeMeshes = new Map();
function updateNades() {
  const snap = S.snap; if (!snap) return;
  const ids = new Set();
  for (const g of snap.gr) {
    ids.add(g.i);
    let m = nadeMeshes.get(g.i);
    if (!m) { m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), mat(0x3c9c3c)); scene.add(m); nadeMeshes.set(g.i, m); }
    m.position.lerp(new THREE.Vector3(g.x, g.y, g.z), 0.6);
  }
  for (const [id, m] of nadeMeshes) if (!ids.has(id)) { scene.remove(m); nadeMeshes.delete(id); }
}
let bombMesh = null;
function updateBomb() {
  const b = S.snap?.bomb;
  if (!b) { if (bombMesh) { scene.remove(bombMesh); bombMesh = null; } $('#bombTxt').textContent = ''; return; }
  if (!bombMesh) {
    bombMesh = new THREE.Group();
    const body = box(0.5, 0.22, 0.34, mat(0x2d2d2d)); body.position.y = 0.11;
    const led = box(0.1, 0.06, 0.1, new THREE.MeshBasicMaterial({ color: 0xff2020 })); led.position.set(0.12, 0.25, 0);
    bombMesh.add(body, led); bombMesh.led = led; scene.add(bombMesh);
  }
  bombMesh.position.set(b.x, b.y, b.z);
  const iv = b.tl > 10 ? 1.0 : b.tl > 5 ? 0.5 : 0.22, now = performance.now() / 1000;
  const on = (now % iv) < 0.1;
  bombMesh.led.material.color.set(on ? 0xffffff : 0xff2020);
  if (now - S.lastBeep >= iv) { S.lastBeep = now; const d = Math.hypot(S.pos.x - b.x, S.pos.z - b.z); sfx.beep(Math.max(0.05, 0.5 / (1 + d * 0.08))); }
  $('#bombTxt').textContent = `💣 Бомба на ${b.s}: ${b.tl.toFixed(1)}с`;
}

// ================= Звук =================
let AC = null;
const sfx = {
  init() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { } } if (AC?.state === 'suspended') AC.resume(); },
  tone(f, d, type = 'square', v = 0.15, slide = 0) {
    if (!AC) return; const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d);
  },
  noise(d, v = 0.2, cutoff = 3000) {
    if (!AC) return; const n = Math.floor(AC.sampleRate * d), buf = AC.createBuffer(1, n, AC.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); f.type = 'lowpass'; f.frequency.value = cutoff; g.gain.value = v;
    s.buffer = buf; s.connect(f).connect(g).connect(AC.destination); s.start();
  },
  shot(w, vol = 1) { if (w === 'sniper') { this.noise(0.4, 0.5 * vol, 1500); this.tone(90, 0.3, 'sawtooth', 0.3 * vol, -50); } else if (w === 'rifle') { this.noise(0.12, 0.3 * vol, 2800); this.tone(150, 0.1, 'sawtooth', 0.15 * vol, -80); } else if (w === 'deagle') { this.noise(0.2, 0.4 * vol, 2000); this.tone(110, 0.15, 'square', 0.2 * vol, -60); } else { this.noise(0.09, 0.22 * vol, 3500); this.tone(240, 0.07, 'square', 0.1 * vol, -120); } },
  hit() { this.tone(1200, 0.06, 'sine', 0.2); }, headhit() { this.tone(1800, 0.09, 'sine', 0.25); this.tone(900, 0.12, 'sine', 0.15); },
  boom(vol = 1) { this.noise(0.9, 0.7 * vol, 700); this.tone(60, 0.6, 'sawtooth', 0.4 * vol, -30); },
  beep(v = 0.2) { this.tone(1500, 0.08, 'square', v); }, click() { this.tone(300, 0.03, 'square', 0.1); },
  reload() { this.tone(500, 0.05, 'square', 0.1); setTimeout(() => this.tone(700, 0.06, 'square', 0.1), 700); }, buy() { this.tone(800, 0.05, 'square', 0.12); this.tone(1200, 0.08, 'square', 0.12); },
  hurt() { this.tone(180, 0.15, 'sawtooth', 0.2, -80); },
};

// ================= HUD помощници =================
let toastT = 0, bannerT = 0;
function toast(t, ms = 2200) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms); }
function banner(html, col, ms = 4000) { const el = $('#banner'); el.innerHTML = html; el.style.color = col; el.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => el.classList.remove('on'), ms); }
const alive = () => S.me.hp > 0;
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ================= Мрежови събития =================
socket.on('gameStart', async ({ mapId, changes }) => {
  S.mapReady = (async () => {
    const json = await (await fetch(`/maps/${mapId}.json`)).json();
    S.mapJson = json; S.base = World.fromMap(json); S.world = S.base.clone();
    for (const c of changes) S.world.set(c[0], c[1], c[2], 0);
    setupMapDecor(json); buildWorldMesh(S.world);
  })();
  await S.mapReady;
  S.inGame = true;
  $('#lobby').classList.add('hidden'); $('#hud').classList.remove('hidden');
  updatePlayPrompt();
});
socket.on('round', async r => {
  await S.mapReady;
  S.world = S.base.clone(); buildWorldMesh(S.world);
  S.specId = null; S.scoped = false; S.recoil = 0; S.pbuf.forEach(b => b.length = 0);
  if (r.swapped) banner('СМЯНА НА СТРАНИТЕ', '#ffd34d', 3000);
  else toast(`Рунд ${r.n} — натисни B за магазина`, 3000);
});
socket.on('spawn', s => { S.pos = { x: s.x, y: s.y, z: s.z }; S.vel = { x: 0, y: 0, z: 0 }; S.yaw = s.yw; S.pitch = 0; S.onGround = false; });
socket.on('correct', s => { S.pos = { x: s.x, y: s.y, z: s.z }; S.vel = { x: 0, y: 0, z: 0 }; });
socket.on('snap', s => {
  const off = s.t - Date.now();
  S.offset = S.offsetInit ? S.offset * 0.9 + off * 0.1 : off; S.offsetInit = true;
  const prev = S.phase; S.snap = s; S.phase = s.ph;
  const ids = new Set();
  for (const p of s.pl) {
    ids.add(p.i);
    let b = S.pbuf.get(p.i); if (!b) S.pbuf.set(p.i, b = []);
    b.push({ t: s.t, x: p.x, y: p.y, z: p.z, yw: p.yw, pt: p.pt }); if (b.length > 40) b.shift();
  }
  for (const id of S.pbuf.keys()) if (!ids.has(id)) S.pbuf.delete(id);
  if (prev === 'freeze' && s.ph === 'live') { toast('Рундът започна!', 1500); closeBuy(); }
});
socket.on('me', m => { S.me = m; });
socket.on('shot', s => {
  const mine = s.i === S.id;
  let a = s.o;
  if (mine) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    a = [camera.position.x + f.x * 0.6 + r.x * 0.18, camera.position.y + f.y * 0.6 - 0.14, camera.position.z + f.z * 0.6 + r.z * 0.18];
  } else {
    const m = models.get(s.i); if (m) { m.flashUntil = Date.now() + 60; }
    const d = Math.hypot(S.pos.x - s.o[0], S.pos.z - s.o[2]); sfx.shot(s.w, Math.min(1, 6 / (1 + d * 0.4)));
  }
  tracer(a, s.e);
  spawnParticles(s.e[0], s.e[1], s.e[2], s.hit ? 0xcc2222 : 0xdddddd, s.hit ? 5 : 3, 2);
});
socket.on('hit', h => { const el = $('#hitmark'); el.className = 'on' + (h.hd ? ' head' : ''); void el.offsetWidth; requestAnimationFrame(() => el.className = h.hd ? 'head' : ''); h.hd ? sfx.headhit() : sfx.hit(); });
socket.on('hurt', h => { const v = $('#vignette'); v.style.transition = 'none'; v.style.opacity = Math.min(1, 0.3 + h.dmg / 60); void v.offsetWidth; v.style.transition = 'opacity .7s'; v.style.opacity = 0; sfx.hurt(); });
socket.on('reloading', () => sfx.reload());
socket.on('bought', () => sfx.buy());
socket.on('err', t => toast(t, 1500));
socket.on('feed', f => {
  const el = document.createElement('div');
  const c = t => t === 'att' ? 'att-c' : 'def-c';
  const wn = f.w === 'bomb' ? '💣' : (WEAPONS[f.w]?.name || f.w);
  el.innerHTML = (f.k ? `<span class="${c(f.kt)}">${esc(f.k)}</span> [${esc(wn)}]${f.hd ? ' 🎯' : ''} ` : '') + `<span class="${c(f.vt)}">${esc(f.v)}</span>`;
  $('#killfeed').appendChild(el); setTimeout(() => el.remove(), 6000);
  while ($('#killfeed').children.length > 6) $('#killfeed').firstChild.remove();
});
socket.on('blocks', list => {
  if (!S.world) return;
  for (const [x, y, z, b] of list) {
    S.world.set(x, y, z, 0); spawnParticles(x + 0.5, y + 0.5, z + 0.5, BLOCK_COL[b] || 0xcccccc, 7, 4);
  }
  S.meshDirty = true;
  const [x, y, z] = list[0]; const d = Math.hypot(S.pos.x - x, S.pos.z - z); if (d < 30) sfx.noise(0.15, 0.25 / (1 + d * 0.1), 4000);
});
socket.on('boom', b => { explosion(b.x, b.y, b.z, b.r, b.big); const d = Math.hypot(S.pos.x - b.x, S.pos.z - b.z); sfx.boom(Math.min(1, 10 / (1 + d * 0.5))); });
socket.on('msg', m => {
  if (m.t === 'plant') { toast(`💣 Бомбата е заложена на ${m.site}!`, 3000); sfx.beep(0.3); }
  if (m.t === 'defuse') toast('Бомбата е обезвредена!', 3000);
});
socket.on('roundEnd', r => {
  const mine = S.me.tm === r.win;
  banner(`<span style="color:${TEAM_COL[r.win]}">${r.win === 'att' ? 'НАПАДАТЕЛИТЕ' : 'ЗАЩИТНИЦИТЕ'}</span> печелят рунда<small>${esc(r.why)} • ${mine ? 'Победа' : 'Загуба'}</small>`, '#fff', 4500);
});
socket.on('matchEnd', r => {
  setTimeout(() => banner(r.win ? `МАЧЪТ ПРИКЛЮЧИ<br><span style="color:${TEAM_COL[r.win]}">${TEAM_NAME[r.win]} печелят!</span><small>${r.sc.att} : ${r.sc.def}</small>` : `РАВЕНСТВО<small>${r.sc.att} : ${r.sc.def}</small>`, '#fff', 11000), 4500);
});
socket.on('connect_error', () => { $('#joinErr').textContent = 'Няма връзка със сървъра'; });
setInterval(() => { const t = performance.now(); socket.emit('ping', () => { S.ping = performance.now() - t; }); }, 2000);

// ================= Вход (клавиатура / мишка) =================
function updatePlayPrompt() { $('#clickplay').classList.toggle('hidden', !S.inGame || S.locked); }
document.addEventListener('pointerlockchange', () => { S.locked = document.pointerLockElement === canvas; if (!S.locked) { S.firing = false; S.keys = {}; S.boardOpen = false; } updatePlayPrompt(); });
$('#clickplay').style.pointerEvents = 'auto';
$('#clickplay').onclick = () => { sfx.init(); canvas.requestPointerLock?.(); };
document.addEventListener('mousemove', e => {
  if (!S.locked) return;
  const k = S.scoped ? 0.35 : 1;
  S.yaw -= e.movementX * 0.0022 * k;
  S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch - e.movementY * 0.0022 * k));
});
document.addEventListener('mousedown', e => {
  if (!S.locked) return;
  if (e.button === 0) { S.firing = true; S.clicked = true; if (!alive()) cycleSpec(); }
  if (e.button === 2 && alive() && S.me.w === 'sniper') S.scoped = !S.scoped;
});
document.addEventListener('mouseup', e => { if (e.button === 0) S.firing = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => {
  if (!S.locked || !alive()) return;
  const order = ['pr', 'se', 'n'].filter(s => s === 'n' ? S.me.inv.n > 0 : S.me.inv[s]);
  const cur = order.findIndex(s => (s === 'n' ? 'grenade' : S.me.inv[s]) === S.me.w);
  const next = order[(cur + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length]; if (next) switchSlot(next);
});
function switchSlot(s) { S.scoped = false; socket.emit('switch', s); }
addEventListener('keydown', e => {
  if (!S.inGame) return;
  if (e.code === 'Tab') { e.preventDefault(); S.boardOpen = true; return; }
  if (e.repeat) return;
  S.keys[e.code] = true;
  if (!S.locked) return;
  if (e.code === 'KeyB' && S.phase === 'freeze' && alive()) S.buyOpen ? closeBuy() : openBuy(); else if (e.code === 'KeyB' && S.buyOpen) closeBuy();
  if (S.buyOpen && /^Digit[1-5]$/.test(e.code)) { socket.emit('buy', ITEMS[+e.code[5] - 1].id); return; }
  if (e.code === 'Digit1') switchSlot('pr'); if (e.code === 'Digit2') switchSlot('se'); if (e.code === 'Digit3') switchSlot('n');
  if (e.code === 'KeyR') socket.emit('reload');
  if (e.code === 'KeyE') socket.emit('use', true);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => {
  S.keys[e.code] = false;
  if (e.code === 'Tab') { S.boardOpen = false; $('#board').classList.add('hidden'); }
  if (e.code === 'KeyE') socket.emit('use', false);
});
function openBuy() { S.buyOpen = true; $('#buy').classList.remove('hidden'); renderBuy(); }
function closeBuy() { S.buyOpen = false; $('#buy').classList.add('hidden'); }
function renderBuy() {
  const m = S.me;
  $('#buyList').innerHTML = `<div class="buyrow"><span>Пари</span><b>$${m.mo}</b></div>` + ITEMS.map(it => {
    const own = it.id === 'armor' ? m.ar >= 100 : it.id === 'grenade' ? m.inv.n >= 1 : m.inv[WEAPONS[it.id].slot] === it.id;
    return `<div class="buyrow ${m.mo < it.price || own ? 'no' : ''}"><span>[${it.key}] ${it.label}</span><span>${own ? '<em>имаш</em>' : '<b>$' + it.price + '</b>'}</span></div>`;
  }).join('');
}

// ================= Физика на играча =================
function physics(dt) {
  const W = S.world; if (!W) return;
  const can = S.locked && alive() && (S.phase === 'freeze' || S.phase === 'live' || S.phase === 'end');
  let fx = 0, fz = 0;
  if (can) { fx = (S.keys.KeyD ? 1 : 0) - (S.keys.KeyA ? 1 : 0); fz = (S.keys.KeyS ? 1 : 0) - (S.keys.KeyW ? 1 : 0); }
  const sn = Math.sin(S.yaw), cs = Math.cos(S.yaw);
  let wx = fx * cs + fz * sn, wz = -fx * sn + fz * cs;
  const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  const speed = CFG.SPEED * (S.scoped ? 0.55 : 1);
  const rate = S.onGround ? 14 : 2.2, k = 1 - Math.exp(-rate * dt);
  if (S.onGround || wl > 0) { S.vel.x += (wx * speed - S.vel.x) * k; S.vel.z += (wz * speed - S.vel.z) * k; }
  if (can && S.keys.Space && S.onGround) { S.vel.y = CFG.JUMP; S.onGround = false; }
  S.vel.y = Math.max(-40, S.vel.y - CFG.GRAVITY * dt);
  const p = S.pos, v = S.vel, HW = CFG.HW, H = CFG.H;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt / 0.3)), sd = dt / n;
  for (let i = 0; i < n; i++) {
    let d = v.x * sd; p.x += d;
    if (boxCollides(W, p.x, p.y, p.z, HW, H)) { p.x = d > 0 ? Math.floor(p.x + HW) - HW - 1e-4 : Math.floor(p.x - HW) + 1 + HW + 1e-4; v.x = 0; }
    d = v.z * sd; p.z += d;
    if (boxCollides(W, p.x, p.y, p.z, HW, H)) { p.z = d > 0 ? Math.floor(p.z + HW) - HW - 1e-4 : Math.floor(p.z - HW) + 1 + HW + 1e-4; v.z = 0; }
    d = v.y * sd; p.y += d; S.onGround = false;
    if (boxCollides(W, p.x, p.y, p.z, HW, H)) {
      if (d > 0) p.y = Math.floor(p.y + H) - H - 1e-4; else { p.y = Math.floor(p.y) + 1; S.onGround = true; }
      v.y = 0;
    }
  }
}
setInterval(() => {
  if (S.inGame && alive() && S.phase !== 'lobby') socket.emit('state', { x: S.pos.x, y: S.pos.y, z: S.pos.z, yw: S.yaw, pt: S.pitch });
}, 33);

// ================= Стрелба =================
function tryFire(now) {
  const clicked = S.clicked; S.clicked = false;
  const m = S.me; if (!alive() || !S.locked || S.phase !== 'live' || S.buyOpen) return;
  const w = WEAPONS[m.w]; if (!w) return;
  if (!S.firing && !clicked) return;
  if (now < S.nextFire) return;
  if (m.w === 'grenade') {
    if (clicked && m.mag > 0) { socket.emit('throw', { yw: S.yaw, pt: S.pitch + S.recoil }); S.nextFire = now + 700; S.kick = 1; }
    return;
  }
  if (!w.auto && !clicked) return;
  if (m.rl) return;
  if (m.mag <= 0) { if (clicked) sfx.click(); S.nextFire = now + 250; return; }
  S.nextFire = now + w.rate * 1000;
  m.mag--;
  socket.emit('shoot', { yw: S.yaw, pt: S.pitch + S.recoil, sc: S.scoped ? 1 : 0, d: Math.round(100 + S.ping) });
  S.recoil = Math.min(0.22, S.recoil + w.kick); S.kick = 1; S.vmFlash = now + 50;
  sfx.shot(m.w, 0.9);
  if (m.w === 'sniper') S.scoped = false;
}

// ================= Наблюдение =================
function cycleSpec() {
  const mates = S.snap?.pl.filter(p => p.al && p.tm === S.me.tm && p.i !== S.id) || [];
  if (!mates.length) { S.specId = null; return; }
  const i = mates.findIndex(p => p.i === S.specId);
  S.specId = mates[(i + 1) % mates.length].i;
}

// ================= Viewmodel =================
const vm = new THREE.Group(); camera.add(vm); vm.position.set(0.26, -0.24, -0.5);
const vmFlash = box(0.12, 0.12, 0.1, new THREE.MeshBasicMaterial({ color: 0xffe08a })); vmFlash.visible = false;
function buildVM(w) {
  while (vm.children.length) vm.remove(vm.children[0]);
  const body = (x, y, z, c, px = 0, py = 0, pz = 0) => { const m = box(x, y, z, mat(c)); m.position.set(px, py, pz); vm.add(m); return m; };
  if (w === 'rifle') { body(0.08, 0.12, 0.7, 0x3a2a1c, 0, 0, -0.2); body(0.06, 0.06, 0.3, 0x222222, 0, 0.02, -0.7); body(0.07, 0.2, 0.1, 0x222222, 0, -0.14, -0.1); vmFlash.position.set(0, 0.02, -0.9); }
  else if (w === 'sniper') { body(0.07, 0.1, 0.9, 0x2c4a2c, 0, 0, -0.25); body(0.05, 0.05, 0.4, 0x151515, 0, 0.02, -0.85); body(0.05, 0.07, 0.25, 0x111111, 0, 0.1, -0.2); vmFlash.position.set(0, 0.02, -1.1); }
  else if (w === 'deagle') { body(0.08, 0.12, 0.34, 0xb0b0b0, 0, 0, -0.2); body(0.07, 0.18, 0.1, 0x222222, 0, -0.13, -0.05); vmFlash.position.set(0, 0.03, -0.42); }
  else if (w === 'grenade') { const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat(0x3c9c3c)); s.position.set(-0.05, 0, -0.25); vm.add(s); vmFlash.position.set(0, 0, 0); }
  else { body(0.07, 0.1, 0.3, 0x383838, 0, 0, -0.18); body(0.06, 0.16, 0.08, 0x222222, 0, -0.11, -0.05); vmFlash.position.set(0, 0.02, -0.38); }
  const arm = body(0.1, 0.1, 0.5, 0xe8b98f, 0.04, -0.12, 0.15); arm.rotation.x = 0.4;
  vm.add(vmFlash);
}

// ================= Главен цикъл =================
let last = performance.now(), hudT = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
  if (!S.inGame || !S.world) { renderer.render(scene, camera); return; }
  const now = Date.now();

  physics(dt);
  tryFire(now);
  S.recoil = Math.max(0, S.recoil - (S.recoil * 5 + 0.02) * dt);
  S.kick = Math.max(0, S.kick - dt * 9);
  if (S.meshDirty) { S.meshDirty = false; buildWorldMesh(S.world); }
  updateModels(dt); updateNades(); updateBomb(); updateFx(dt);

  // камера
  const isAlive = alive();
  let cp, cyaw, cpitch;
  if (isAlive) {
    cp = [S.pos.x, S.pos.y + CFG.EYE, S.pos.z]; cyaw = S.yaw; cpitch = S.pitch + S.recoil;
    S.specId = null;
  } else {
    if (!S.specId || !S.snap?.pl.find(p => p.i === S.specId && p.al)) cycleSpec();
    const pose = S.specId ? poseOf(S.specId, serverNow() - 100) : null;
    if (pose) { cp = [pose.x, pose.y + CFG.EYE, pose.z]; cyaw = pose.yw; cpitch = pose.pt; }
    else { cp = [S.pos.x, S.pos.y + 1.0, S.pos.z]; cyaw = S.yaw; cpitch = S.pitch; }
  }
  const sh = S.shake || 0; S.shake = Math.max(0, sh - dt * 0.8);
  camera.position.set(cp[0] + (Math.random() - .5) * sh, cp[1] + (Math.random() - .5) * sh, cp[2] + (Math.random() - .5) * sh);
  camera.rotation.set(cpitch, cyaw, 0);
  const targetFov = S.scoped && isAlive ? 22 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }

  // viewmodel
  const showVM = isAlive && !S.scoped;
  vm.visible = showVM;
  if (showVM) {
    if (S.vmWeapon !== S.me.w) { S.vmWeapon = S.me.w; buildVM(S.me.w); }
    const sp = Math.hypot(S.vel.x, S.vel.z), t = now / 1000;
    vm.position.set(0.26 + Math.sin(t * 8) * 0.008 * sp / 5, -0.24 + Math.abs(Math.sin(t * 8)) * 0.01 * sp / 5 - (S.me.rl ? 0.12 : 0), -0.5 + S.kick * 0.07);
    vm.rotation.x = S.kick * 0.06 + (S.me.rl ? -0.5 : 0);
    vmFlash.visible = now < (S.vmFlash || 0);
  }
  $('#scope').style.display = S.scoped && isAlive ? 'block' : 'none';
  $('#cross').style.display = S.scoped || !isAlive ? 'none' : '';

  renderer.render(scene, camera);

  hudT += dt; if (hudT > 0.05) { hudT = 0; updateHud(); }
}
requestAnimationFrame(frame);

function inSite() {
  if (!S.mapJson) return null;
  for (const [n, [x1, z1, x2, z2]] of Object.entries(S.mapJson.sites)) if (S.pos.x >= x1 && S.pos.x <= x2 + 1 && S.pos.z >= z1 && S.pos.z <= z2 + 1 && S.pos.y < 3) return n;
  return null;
}
function updateHud() {
  const s = S.snap, m = S.me; if (!s) return;
  $('#scoreAtt').textContent = s.sc.att; $('#scoreDef').textContent = s.sc.def;
  $('#timer').textContent = s.bomb ? '💣' : fmt(s.tl);
  $('#phaseTxt').textContent = s.ph === 'freeze' ? `Купуване: ${Math.ceil(s.tl)}с  •  Рунд ${s.rd}` : `Рунд ${s.rd}  •  ${m.tm === 'att' ? 'Нападател' : 'Защитник'}`;
  $('#phaseTxt').style.color = TEAM_COL[m.tm];
  $('#money').textContent = m.mo;
  $('#hp b').textContent = Math.max(0, m.hp); $('#ar b').textContent = m.ar;
  const w = WEAPONS[m.w]; $('#wname').textContent = (w?.name || '') + (m.rl ? ' — презарежда…' : '');
  $('#ammo b').textContent = m.mag; $('#ammo span').textContent = m.w === 'grenade' ? '' : ' / ' + m.res;
  const us = m.us;
  $('#useBar').classList.toggle('hidden', !us);
  if (us) { $('#useBar div').style.width = (us.p * 100) + '%'; $('#useBar span').textContent = us.k === 'plant' ? 'Залагане на бомбата…' : 'Обезвреждане…'; }
  let hint = '';
  if (alive()) {
    if (s.ph === 'freeze') hint = 'Натисни B за магазина';
    else if (s.ph === 'live' && m.tm === 'att' && !s.bomb && inSite()) hint = `Дръж E, за да заложиш бомбата (${inSite()})`;
    else if (s.ph === 'live' && m.tm === 'def' && s.bomb && Math.hypot(S.pos.x - s.bomb.x, S.pos.z - s.bomb.z) < 2.4) hint = 'Дръж E, за да обезвредиш бомбата';
  }
  $('#hint').textContent = us ? '' : hint;
  const sp = $('#spec'); sp.classList.toggle('hidden', alive() || s.ph === 'lobby');
  if (!alive()) { const t = s.pl.find(p => p.i === S.specId); sp.textContent = t ? `Наблюдаваш: ${t.n} (клик – следващ)` : 'Мъртъв си'; }
  if (S.buyOpen) { if (s.ph !== 'freeze') closeBuy(); else renderBuy(); }
  if (S.boardOpen) renderBoard(s);
}
function renderBoard(s) {
  const el = $('#board'); el.classList.remove('hidden');
  const tbl = t => `<h4 style="color:${TEAM_COL[t]}">${TEAM_NAME[t]} — ${s.sc[t]}</h4><table><tr><th>Играч</th><th>У</th><th>С</th></tr>` +
    s.pl.filter(p => p.tm === t).sort((a, b) => b.k - a.k).map(p => `<tr class="${p.i === S.id ? 'me' : ''} ${p.al ? '' : 'dead'}"><td>${esc(p.n)}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('') + '</table>';
  el.innerHTML = tbl('att') + tbl('def') + `<div style="color:#9aa6b8;font-size:13px">Пинг: ${Math.round(S.ping)} мс • Рунд ${s.rd}/${CFG.MAX_ROUNDS} • до ${CFG.WIN_ROUNDS} победи</div>`;
}
