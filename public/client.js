// BlockStrike - клиент (Three.js). Сървърът е авторитетен за попадения, щети, бомба и рунд; тук са рендерът,
// входът и предвиждането на собственото движение (физика като в CS2).
import * as THREE from 'three';
import { World, BLOCK, DEFS, boxCollides, waterDepth } from '/shared/world.js';
import { WEAPONS, ITEMS, CFG, MOVE, KNIFE, recoilAt, spreadFor } from '/shared/weapons.js';
import { buildAtlas, BLOCK_TILES } from './textures.js';
import { WorldRenderer } from './mesher.js';
import { audio } from './audio.js';
import { ViewModel } from './viewmodel.js';
import { initSkins } from './skins.js';
import { drawRadar, markRadarDirty } from './radar.js';
import { buildModel, modelIdFor, skinFor, BP, VS } from './voxmodel.js';

const $ = s => document.querySelector(s);
const socket = io();
const TEAM_NAME = { att: 'Нападатели', def: 'Защитници' };
const TEAM_COL = { att: '#f0922b', def: '#4a90ff' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const S = {
  id: null, code: null, lobby: null, inGame: false, mapJson: null, base: null, world: null, mapReady: null,
  snap: null, pbuf: new Map(), offset: 0, offsetInit: false, ping: 60, phase: 'lobby',
  me: { hp: 0, ar: 0, mo: 0, w: 'pistol', inv: { pr: null, se: 'pistol', n: 0, bomb: false }, kit: false, mag: 0, res: 0, rl: 0, tm: 'att', us: null, bd: null },
  // собствено движение
  pos: { x: 0, y: 1, z: 0 }, prev: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, onGround: false,
  crouching: false, crouchAmt: 0, inWater: false, acc: 0, jumpAt: 0, stepAcc: 0, wasGround: false, lastVy: 0,
  keys: {}, locked: false, scoped: false,
  // стрелба
  firing: false, clicked: false, rclick: false, nextFire: 0, shotIdx: 0, lastShotT: 0, punch: [0, 0], punchT: [0, 0],
  buyOpen: false, boardOpen: false, specId: null, vmWeapon: null, kick: 0, lastBeep: 0, shake: 0, cosById: new Map(), speed: 0, mdx: 0, mdy: 0, vmReset: false,
};
window.__S = S;

// ================= Вход / лоби =================
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom) $('#room').value = qRoom.toUpperCase();
$('#name').value = localStorage.getItem('bs_name') || '';

function doJoin() {
  audio.init();
  const name = $('#name').value.trim();
  localStorage.setItem('bs_name', name);
  socket.emit('join', { name, room: $('#room').value.trim() }, res => {
    if (!res.ok) { $('#joinErr').textContent = res.error; return; }
    S.id = res.id; S.code = res.code;
    history.replaceState(null, '', '?room=' + res.code);
    $('#join').classList.add('hidden'); $('#lobby').classList.remove('hidden');
    sendLoadout();
  });
}
$('#joinBtn').onclick = doJoin;
$('#room').onkeydown = $('#name').onkeydown = e => { if (e.code === 'Enter' || e.code === 'NumpadEnter') doJoin(); };
$('#copyLink').onclick = () => { navigator.clipboard?.writeText(location.href); $('#copyLink').textContent = 'Копирано!'; setTimeout(() => $('#copyLink').textContent = 'Копирай линк', 1500); };
document.querySelectorAll('[data-team]').forEach(b => b.onclick = () => socket.emit('team', b.dataset.team));
$('#startBtn').onclick = () => { audio.init(); socket.emit('start'); };
$('#mapSel').onchange = e => socket.emit('setMap', e.target.value);

// сила на звука (в менюто и в лобито)
for (const el of document.querySelectorAll('.vol')) {
  el.value = Math.round(audio.volume * 100);
  el.oninput = () => { audio.setVolume(el.value / 100); document.querySelectorAll('.vol').forEach(o => o.value = el.value); audio.init(); };
}

// цял екран + Keyboard Lock (за да не се затваря табът с Ctrl+W)
function setKbdMsg(t, ok) { document.querySelectorAll('.kbdmsg').forEach(e => { e.textContent = t; e.style.color = ok ? '#7cf08a' : '#ffb066'; }); }
async function goFullscreen() {
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { setKbdMsg('Цял екран не е позволен от браузъра. Клякане: C.', false); return; }
  if (navigator.keyboard?.lock) {
    try {
      await navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyC', 'KeyE', 'KeyB', 'Tab', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'Space', 'Escape']);
      setKbdMsg('Цял екран + заключена клавиатура: Ctrl не затваря таба.', true);
    } catch { setKbdMsg('Keyboard Lock не успя. Ползвай C за клякане.', false); }
  } else setKbdMsg('Браузърът не поддържа Keyboard Lock. Клякане: C (вместо Ctrl).', false);
}
document.querySelectorAll('.fsbtn').forEach(b => b.onclick = goFullscreen);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { try { navigator.keyboard?.unlock?.(); } catch { } } });
addEventListener('beforeunload', e => { if (S.inGame) { e.preventDefault(); e.returnValue = ''; } });

socket.on('lobby', L => {
  S.lobby = L;
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
  $('#lobHint').textContent = host ? 'Ти си домакин – избери карта и натисни „Старт“. Можеш да стартираш и сам за проба.' : 'Изчакване домакинът да избере карта и да стартира играта…';
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

// ================= Three.js =================
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 260);
camera.rotation.order = 'YXZ';
scene.add(camera);
const vmod = new ViewModel(renderer);
function resize() { renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vmod.resize(camera.aspect); }
addEventListener('resize', resize); resize();

const atlas = buildAtlas(THREE);
atlas.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
const worldR = new WorldRenderer(scene, atlas);
function buildWorldMesh(world) { worldR.load(world, S.mapJson?.env || {}); }

// ----- декор на картата (небе, мъгла, букви на пода, пламъци на факлите) -----
let mapDeco = [], flames = null;
function flameTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,240,170,1)'); gr.addColorStop(0.35, 'rgba(255,150,40,.7)'); gr.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
function setupMapDecor(json) {
  mapDeco.forEach(o => { scene.remove(o); o.geometry?.dispose?.(); }); mapDeco = []; flames = null;
  const e = { sky: '#8fd0ff', fogColor: null, fog: [45, 130], ground: '#b59d6a', ...(json.env || {}) };
  scene.background = new THREE.Color(e.sky);
  scene.fog = new THREE.Fog(e.fogColor || e.sky, e.fog[0], e.fog[1]);
  const [sx, , sz] = json.size;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.ground) }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(sx / 2, -0.6, sz / 2); scene.add(ground); mapDeco.push(ground);
  for (const [name, [x1, z1, x2, z2]] of Object.entries(json.sites)) {
    const cx = (x1 + x2 + 1) / 2, cz = (z1 + z2 + 1) / 2;
    let fy = 1; for (let y = 8; y >= 0; y--) { if (S.base.solid(Math.floor(cx), y, Math.floor(cz)) || S.base.get(Math.floor(cx), y, Math.floor(cz)) === BLOCK.site) { fy = y + 1; break; } }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.font = 'bold 230px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 22; g.strokeStyle = 'rgba(20,16,10,.95)'; g.strokeText(name, 128, 140); g.fillStyle = '#ffd34d'; g.fillText(name, 128, 140);
    const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    plane.rotation.x = -Math.PI / 2; plane.position.set(cx, fy + 0.03, cz); plane.renderOrder = 1; scene.add(plane); mapDeco.push(plane);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, opacity: 0.6, fog: false }));
    sp.scale.set(2.2, 2.2, 1); sp.position.set(cx, fy + 3.4, cz); sp.renderOrder = 10; scene.add(sp); mapDeco.push(sp);
  }
  const tp = worldR.torches || [];
  if (tp.length) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(tp.flat(), 3));
    flames = new THREE.Points(geo, new THREE.PointsMaterial({ map: flameTexture(), size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    scene.add(flames); mapDeco.push(flames);
  }
}

// ================= Модели на играчите =================
const models = new Map();
const mats = {};
const mat = hex => mats[hex] || (mats[hex] = new THREE.MeshBasicMaterial({ color: hex }));
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
function nameSprite(name, col) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d'); g.font = 'bold 30px Segoe UI, Arial'; g.textAlign = 'center'; g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(name, 128, 34); g.fillStyle = col; g.fillText(name, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  s.scale.set(1.6, 0.3, 1); s.position.y = 2.15; s.renderOrder = 9; return s;
}
const armGeo = new THREE.BoxGeometry(0.15, 0.15, 1).translate(0, 0, -0.5);
const handGeo = new THREE.BoxGeometry(0.13, 0.13, 0.13);
function makeModel(p) {
  const shirt = p.tm === 'att' ? 0xe07b1a : 0x2f6fdc, dark = p.tm === 'att' ? 0x7a3d0c : 0x1a3b78;
  const g = new THREE.Group();
  const head = box(0.5, 0.5, 0.5, mat(0xe8b98f)); head.position.set(0, 1.55, 0);
  const hat = box(0.54, 0.16, 0.54, mat(dark)); hat.position.set(0, 0.2, 0); head.add(hat);
  const face = box(0.3, 0.08, 0.02, mat(0x222222)); face.position.set(0, 0.04, -0.26); head.add(face);
  const body = box(0.56, 0.72, 0.3, mat(shirt)); body.position.set(0, 1.0, 0);
  const mkLeg = x => { const l = new THREE.Group(); l.position.set(x, 0.66, 0); const m = box(0.24, 0.66, 0.26, mat(0x2b3550)); m.position.y = -0.33; l.add(m); return l; };
  const legL = mkLeg(-0.14), legR = mkLeg(0.14);
  const aim = new THREE.Group(); aim.position.set(0, 1.3, 0); aim.rotation.order = 'YXZ';
  const armR = new THREE.Mesh(armGeo, mat(shirt)), armL = new THREE.Mesh(armGeo, mat(shirt));
  const handR = new THREE.Mesh(handGeo, mat(0xe8b98f)), handL = new THREE.Mesh(handGeo, mat(0xe8b98f));
  const gunHolder = new THREE.Group(); gunHolder.position.set(0.2, -0.2, -0.42);
  aim.add(armR, armL, handR, handL, gunHolder);
  const bomb = box(0.4, 0.14, 0.26, mat(0x2d2d2d)); bomb.position.set(0, 1.05, 0.27); bomb.visible = false;
  const led = box(0.06, 0.04, 0.06, new THREE.MeshBasicMaterial({ color: 0xff2020 })); led.position.set(0.12, 0.09, 0); bomb.add(led);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; shadow.renderOrder = 1;
  g.add(head, body, legL, legR, aim, bomb, shadow);
  const m = { g, head, body, legL, legR, aim, armR, armL, handR, handL, gunHolder, gunModel: null, gunKey: '', flash: null, bomb, shadow, flashUntil: 0, swingT: 0, swingKind: 'l', team: p.tm, name: p.n, lie: 0, lastX: p.x, lastZ: p.z, phase: 0, stepAcc: 0, wasG: true, crAmt: 0, lastY: p.y };
  scene.add(g); return m;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _fwd = new THREE.Vector3(0, 0, -1);
function setArm(arm, hand, from, to) {
  _d.copy(to).sub(from); const len = Math.max(0.05, _d.length());
  arm.position.copy(from); arm.quaternion.setFromUnitVectors(_fwd, _d.normalize()); arm.scale.set(1, 1, len); hand.position.copy(to);
}
// оръжие в ръката на играч (воксел модел с LOD = 2 см кубчета), с неговия скин
function setGun(m, weapon, cos, team) {
  const id = modelIdFor(weapon, cos), skin = skinFor(weapon, cos), key = id + '/' + skin;
  if (m.gunKey === key) return; m.gunKey = key;
  if (m.gunModel) m.gunHolder.remove(m.gunModel);
  const gm = buildModel(id, { skin, step: 2, team }), bp = BP[id];
  m.gunHolder.add(gm); m.gunModel = gm; m.bp = bp;
  m.flash = null;
  if (bp.muzzle && !bp.knife && id !== 'grenade') { m.flash = buildModel('flash', { step: 2 }); m.flash.position.set(bp.muzzle[0] * VS, bp.muzzle[1] * VS, bp.muzzle[2] * VS); m.flash.visible = false; gm.add(m.flash); }
}
function poseArms(m) {
  const bp = m.bp; if (!bp) return;
  const gp = m.gunHolder.position;
  _b.set(gp.x + bp.rh[0] * VS, gp.y + bp.rh[1] * VS, gp.z + bp.rh[2] * VS);
  setArm(m.armR, m.handR, _a.set(0.3, 0, 0), _b);
  if (bp.lh) { _b.set(gp.x + bp.lh[0] * VS, gp.y + bp.lh[1] * VS, gp.z + bp.lh[2] * VS); setArm(m.armL, m.handL, _a.set(-0.3, 0, 0), _b); }
  else { _b.set(-0.22, -0.4, -0.12); setArm(m.armL, m.handL, _a.set(-0.3, 0, 0), _b); }
}

const lerpAng = (a, b, t) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
function poseOf(id, rt) {
  const b = S.pbuf.get(id); if (!b || !b.length) return null;
  if (rt <= b[0].t) return b[0];
  for (let i = b.length - 1; i >= 0; i--) if (b[i].t <= rt) {
    if (i === b.length - 1) return b[i];
    const a = b[i], c = b[i + 1], k = (rt - a.t) / Math.max(1, c.t - a.t);
    return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yw: lerpAng(a.yw, c.yw, k), pt: a.pt + (c.pt - a.pt) * k, cr: a.cr, g: a.g, wk: a.wk };
  }
  return b[0];
}
const serverNow = () => Date.now() + S.offset;
const surfaceAt = (x, y, z) => {
  if (!S.world) return 'stone';
  if (S.world.get(Math.floor(x), Math.floor(y + 0.2), Math.floor(z)) === BLOCK.water) return 'water';
  return DEFS[S.world.get(Math.floor(x), Math.floor(y - 0.05), Math.floor(z))]?.surface || 'stone';
};

function updateModels(dt) {
  const snap = S.snap; if (!snap) return;
  const rt = serverNow() - 100, ids = new Set();
  for (const p of snap.pl) {
    if (p.i === S.id) continue;
    ids.add(p.i);
    let m = models.get(p.i);
    if (!m || m.team !== p.tm) { if (m) scene.remove(m.g); m = makeModel(p); models.set(p.i, m); if (p.tm === S.me.tm) m.g.add(nameSprite(p.n, TEAM_COL[p.tm])); }
    const pose = poseOf(p.i, rt) || p;
    m.g.visible = !(S.specId === p.i && !alive());
    m.g.position.set(pose.x, pose.y, pose.z);
    m.g.rotation.y = pose.yw;
    m.head.rotation.x = pose.pt * 0.8; m.aim.rotation.x = pose.pt * 0.95;
    const dx = pose.x - m.lastX, dz = pose.z - m.lastZ, dist = Math.hypot(dx, dz), sp = dist / Math.max(dt, 0.001);
    m.lastX = pose.x; m.lastZ = pose.z;
    m.phase += Math.min(sp, 8) * dt * 2.2;
    const sw = p.al ? Math.sin(m.phase) * Math.min(1, sp / 4) * 0.8 : 0;
    m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
    // звуци на другите играчи: стъпки (не се чуват при Shift/клякане), скок, приземяване
    if (p.al && dist < 2) {
      const pos = [pose.x, pose.y + 0.2, pose.z];
      if (pose.g && !pose.cr && !pose.wk && sp > 1.6) { m.stepAcc += dist; if (m.stepAcc >= 2.0) { m.stepAcc = 0; audio.footstep(surfaceAt(pose.x, pose.y, pose.z), pos, 1); } } else if (!pose.g) m.stepAcc = 0;
      if (m.wasG && !pose.g && pose.y > m.lastY + 0.02) audio.jump(pos, surfaceAt(pose.x, pose.y, pose.z));
      if (!m.wasG && pose.g) audio.land(pos, clamp((m.peakY - pose.y) / 2, 0.3, 2), surfaceAt(pose.x, pose.y, pose.z));
      if (!pose.g) m.peakY = Math.max(m.peakY ?? pose.y, pose.y); else m.peakY = pose.y;
    }
    m.wasG = !!pose.g; m.lastY = pose.y;
    m.crAmt += ((pose.cr ? 1 : 0) - m.crAmt) * Math.min(1, dt * 12);
    setGun(m, p.w, S.cosById.get(p.i), p.tm); poseArms(m);
    { const sw = (Date.now() - m.swingT) / 380; if (sw >= 0 && sw < 1) { m.aim.rotation.x += -0.9 * Math.sin(sw * Math.PI); m.aim.rotation.y = 0.5 * Math.sin(sw * Math.PI) * (m.swingKind === 'r' ? 0 : 1); } else m.aim.rotation.y = 0; }
    m.lie += ((p.al ? 0 : 1) - m.lie) * Math.min(1, dt * 8);
    m.g.rotation.order = 'YXZ'; m.g.rotation.x = -m.lie * Math.PI / 2;
    m.g.scale.y = 1 - 0.25 * m.crAmt;
    m.g.position.y += m.lie * 0.3;
    m.bomb.visible = !!p.bm && !!p.al;
    if (m.flash) m.flash.visible = Date.now() < m.flashUntil;
    // тиктакащ звук при залагане/обезвреждане от други играчи
    if (p.us && p.al) { m.useT = (m.useT || 0) - dt; if (m.useT <= 0) { m.useT = p.us === 1 ? 0.5 : 0.35; (p.us === 1 ? audio.plantTick : audio.defuseTick)([pose.x, pose.y + 0.5, pose.z]); } }
  }
  for (const [id, m] of models) if (!ids.has(id)) { scene.remove(m.g); models.delete(id); }
}

// ================= Ефекти =================
const fx = [];
const partGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const blockColor = id => { const a = atlas.avg[BLOCK_TILES[DEFS[id].name]?.side] || [160, 160, 160]; return (a[0] << 16) | (a[1] << 8) | a[2]; };
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
// гилзи: изхвърлят се от пушката, падат и отскачат от пода
const casingGeo = new THREE.BoxGeometry(0.032, 0.012, 0.012), casingMat = new THREE.MeshBasicMaterial({ color: 0xd8b04a });
function spawnCasing(c) {
  if (fx.filter(f => f.type === 'casing').length > 30) return;
  const wp = camera.localToWorld(c.pos.clone());
  const v = new THREE.Vector3(c.vel[0], c.vel[1], c.vel[2]).applyQuaternion(camera.quaternion);
  const m = new THREE.Mesh(casingGeo, casingMat); m.position.copy(wp); m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  scene.add(m); fx.push({ mesh: m, v: [v.x, v.y, v.z], life: 2.2, type: 'casing', spin: [Math.random() * 20, Math.random() * 20, Math.random() * 20] });
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
    else if (f.type === 'casing') {
      const p = f.mesh.position; f.v[1] -= 14 * dt;
      p.x += f.v[0] * dt; p.z += f.v[2] * dt; p.y += f.v[1] * dt;
      if (S.world && S.world.solid(Math.floor(p.x), Math.floor(p.y - 0.01), Math.floor(p.z))) { p.y = Math.floor(p.y) + 1.012; f.v[1] = Math.abs(f.v[1]) * 0.35; f.v[0] *= 0.5; f.v[2] *= 0.5; f.spin = f.spin.map(s => s * 0.5); if (f.v[1] < 0.4) f.v[1] = 0; }
      f.mesh.rotation.x += f.spin[0] * dt; f.mesh.rotation.y += f.spin[1] * dt;
    }
    else if (f.type === 'boom') { const k = 1 - f.life / f.max; f.mesh.scale.setScalar(0.3 + f.r * k); f.mesh.material.opacity = 0.85 * (1 - k); }
    if (f.life <= 0) { scene.remove(f.mesh); if (f.type === 'tracer' || f.type === 'boom') { f.mesh.geometry.dispose(); f.mesh.material.dispose(); } fx.splice(i, 1); }
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
function bombMeshNew() {
  const g = new THREE.Group();
  const body = box(0.5, 0.22, 0.34, mat(0x2d2d2d)); body.position.y = 0.11;
  const led = box(0.1, 0.06, 0.1, new THREE.MeshBasicMaterial({ color: 0xff2020 })); led.position.set(0.12, 0.25, 0);
  g.add(body, led); g.led = led; scene.add(g); return g;
}
let bombMesh = null, dropMesh = null;
function updateBomb() {
  const b = S.snap?.bomb, d = S.snap?.bd;
  if (d) { if (!dropMesh) dropMesh = bombMeshNew(); dropMesh.position.set(d.x, d.y, d.z); dropMesh.led.material.color.set((performance.now() % 600) < 200 ? 0xffffff : 0xff2020); }
  else if (dropMesh) { scene.remove(dropMesh); dropMesh = null; }
  if (!b) { if (bombMesh) { scene.remove(bombMesh); bombMesh = null; } $('#bombTxt').textContent = ''; return; }
  if (!bombMesh) bombMesh = bombMeshNew();
  bombMesh.position.set(b.x, b.y, b.z);
  const iv = b.tl > 20 ? 1.0 : b.tl > 10 ? 0.7 : b.tl > 5 ? 0.4 : b.tl > 2 ? 0.2 : 0.1, now = performance.now() / 1000;
  bombMesh.led.material.color.set((now % iv) < 0.08 ? 0xffffff : 0xff2020);
  if (now - S.lastBeep >= iv) { S.lastBeep = now; audio.beep([b.x, b.y + 0.2, b.z], 1, b.tl < 10); }
  $('#bombTxt').textContent = `💣 Бомба на ${b.s}: ${b.tl.toFixed(1)}с`;
}

// ================= HUD помощници =================
let toastT = 0, bannerT = 0;
function toast(t, ms = 2200) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms); }
function banner(html, col, ms = 4000) { const el = $('#banner'); el.innerHTML = html; el.style.color = col; el.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => el.classList.remove('on'), ms); }
const alive = () => S.me.hp > 0;
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
initSkins({ onChange: () => sendLoadout() });
function sendLoadout() { try { const c = JSON.parse(localStorage.getItem('bs_cos') || '{}'); socket.emit('loadout', { knife: c.knife || 'bayonet', skins: c.skins || {} }); } catch { } }

// ================= Мрежови събития =================
socket.on('gameStart', async ({ mapId, changes }) => {
  S.mapReady = (async () => {
    const json = await (await fetch(`/maps/${mapId}.json`)).json();
    S.mapJson = json; S.base = World.fromMap(json); S.world = S.base.clone();
    for (const c of changes) S.world.set(c[0], c[1], c[2], 0);
    buildWorldMesh(S.world); setupMapDecor(json);
  })();
  await S.mapReady;
  S.inGame = true;
  $('#lobby').classList.add('hidden'); $('#hud').classList.remove('hidden');
  updatePlayPrompt();
});
socket.on('round', async r => {
  await S.mapReady;
  S.world = S.base.clone(); buildWorldMesh(S.world); markRadarDirty();
  S.specId = null; S.scoped = false; S.shotIdx = 0; S.punch = [0, 0]; S.punchT = [0, 0]; S.pbuf.forEach(b => b.length = 0);
  S.crouching = false; S.crouchAmt = 0;
  audio.roundStart();
  if (r.swapped) banner('СМЯНА НА СТРАНИТЕ', '#ffd34d', 3000);
  else toast(`Рунд ${r.n} — натисни B за магазина`, 3000);
});
socket.on('spawn', s => { S.vmReset = true; S.pos = { x: s.x, y: s.y, z: s.z }; S.prev = { ...S.pos }; S.vel = { x: 0, y: 0, z: 0 }; S.yaw = s.yw; S.pitch = 0; S.onGround = false; S.wasGround = true; });
socket.on('correct', s => { S.pos = { x: s.x, y: s.y, z: s.z }; S.prev = { ...S.pos }; S.vel = { x: 0, y: 0, z: 0 }; });
socket.on('snap', s => {
  const off = s.t - Date.now();
  S.offset = S.offsetInit ? S.offset * 0.9 + off * 0.1 : off; S.offsetInit = true;
  const prev = S.phase; S.snap = s; S.phase = s.ph;
  const ids = new Set();
  for (const p of s.pl) {
    ids.add(p.i);
    let b = S.pbuf.get(p.i); if (!b) S.pbuf.set(p.i, b = []);
    b.push({ t: s.t, x: p.x, y: p.y, z: p.z, yw: p.yw, pt: p.pt, cr: p.cr, g: p.g, wk: p.wk }); if (b.length > 40) b.shift();
  }
  for (const id of S.pbuf.keys()) if (!ids.has(id)) S.pbuf.delete(id);
  if (prev === 'freeze' && s.ph === 'live') { toast('Рундът започна!', 1500); closeBuy(); }
});
socket.on('me', m => { const mag = S.me.mag, same = S.me.w === m.w; S.me = m; if (same && Math.abs(mag - m.mag) === 0) return; });
socket.on('cos', ({ i, cos }) => S.cosById.set(i, cos));
socket.on('cosLeave', id => S.cosById.delete(id));
socket.on('shot', s => {
  const mine = s.i === S.id;
  let a = s.o;
  if (mine) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    a = [camera.position.x + f.x * 0.6 + r.x * 0.18, camera.position.y + f.y * 0.6 - 0.14, camera.position.z + f.z * 0.6 + r.z * 0.18];
  } else {
    const m = models.get(s.i); if (m) m.flashUntil = Date.now() + 60;
    audio.shot(s.w, s.o);
  }
  for (const e of s.e) { tracer(a, e); spawnParticles(e[0], e[1], e[2], s.hit ? 0xcc2222 : 0xdddddd, s.hit ? 4 : 2, 2); }
});
socket.on('knife', k => { const mm = models.get(k.i); if (mm) { mm.swingT = Date.now(); mm.swingKind = k.k; } if (k.i !== S.id) { const p = S.snap?.pl.find(q => q.i === k.i); audio.knife(k.k, k.hit, p ? [p.x, p.y + 1, p.z] : null); } });
socket.on('reload', r => { if (r.i === S.id) { audio.reload(r.w, null); vmod.reload(r.t, Date.now()); }  else { const p = S.snap?.pl.find(q => q.i === r.i); if (p) audio.reload(r.w, [p.x, p.y + 1, p.z]); } });
socket.on('equip', e => { if (e.i !== S.id) { const p = S.snap?.pl.find(q => q.i === e.i); if (p) audio.equip([p.x, p.y + 1, p.z]); } });
socket.on('throw', t => { const p = S.snap?.pl.find(q => q.i === t.i); audio.nadeThrow(t.i === S.id ? null : p ? [p.x, p.y + 1.2, p.z] : null); });
socket.on('hit', h => { const el = $('#hitmark'); el.className = 'on' + (h.hd ? ' head' : ''); void el.offsetWidth; requestAnimationFrame(() => el.className = h.hd ? 'head' : ''); audio.hit(h.hd); });
socket.on('hurt', h => { const v = $('#vignette'); v.style.transition = 'none'; v.style.opacity = Math.min(1, 0.3 + h.dmg / 60); void v.offsetWidth; v.style.transition = 'opacity .7s'; v.style.opacity = 0; audio.hurt(); });
socket.on('bought', () => audio.buy());
socket.on('err', t => toast(t, 1500));
socket.on('feed', f => {
  const el = document.createElement('div');
  const c = t => t === 'att' ? 'att-c' : 'def-c';
  const wn = f.w === 'bomb' ? '💣' : f.w === 'fall' ? 'падане' : (WEAPONS[f.w]?.name || f.w);
  el.innerHTML = (f.k ? `<span class="${c(f.kt)}">${esc(f.k)}</span> [${esc(wn)}]${f.hd ? ' 🎯' : ''} ` : `[${esc(wn)}] `) + `<span class="${c(f.vt)}">${esc(f.v)}</span>`;
  $('#killfeed').appendChild(el); setTimeout(() => el.remove(), 6000);
  while ($('#killfeed').children.length > 6) $('#killfeed').firstChild.remove();
});
socket.on('blocks', list => {
  if (!S.world) return;
  for (const [x, y, z, b] of list) { S.world.set(x, y, z, 0); spawnParticles(x + 0.5, y + 0.5, z + 0.5, blockColor(b), 7, 4); }
  worldR.refresh(list); markRadarDirty();
  const [x, y, z, b] = list[0]; (b === BLOCK.glass ? audio.glass : audio.breakBlock)([x + 0.5, y + 0.5, z + 0.5]);
});
socket.on('boom', b => { explosion(b.x, b.y, b.z, b.r, b.big); audio.boom([b.x, b.y, b.z], b.big); });
socket.on('msg', m => {
  if (m.t === 'plant') { toast(`💣 Бомбата е заложена на ${m.site}!`, 3500); audio.plantDone(S.snap?.bomb ? [S.snap.bomb.x, S.snap.bomb.y, S.snap.bomb.z] : null); }
  if (m.t === 'defuse') { toast('Бомбата е обезвредена!', 3000); audio.defuseDone(null); }
  if (m.t === 'drop') toast('Носителят на бомбата загина – бомбата падна!', 2500);
  if (m.t === 'pickup') { toast(`${m.by} вдигна бомбата`, 2000); audio.pickup(); }
});
socket.on('roundEnd', r => {
  const mine = S.me.tm === r.win; audio.roundEnd(mine);
  banner(`<span style="color:${TEAM_COL[r.win]}">${r.win === 'att' ? 'НАПАДАТЕЛИТЕ' : 'ЗАЩИТНИЦИТЕ'}</span> печелят рунда<small>${esc(r.why)} • ${mine ? 'Победа' : 'Загуба'}</small>`, '#fff', 4500);
});
socket.on('matchEnd', r => {
  setTimeout(() => banner(r.win ? `МАЧЪТ ПРИКЛЮЧИ<br><span style="color:${TEAM_COL[r.win]}">${TEAM_NAME[r.win]} печелят!</span><small>${r.sc.att} : ${r.sc.def}</small>` : `РАВЕНСТВО<small>${r.sc.att} : ${r.sc.def}</small>`, '#fff', 11000), 4500);
});
socket.on('connect_error', () => { $('#joinErr').textContent = 'Няма връзка със сървъра'; });
setInterval(() => { const t = performance.now(); socket.emit('ping', () => { S.ping = performance.now() - t; }); }, 2000);

// ================= Вход (клавиатура / мишка) – само event.code =================
function updatePlayPrompt() { $('#clickplay').classList.toggle('hidden', !S.inGame || S.locked); }
document.addEventListener('pointerlockchange', () => { S.locked = document.pointerLockElement === canvas; if (!S.locked) { S.firing = false; S.keys = {}; S.boardOpen = false; S.scoped = false; } updatePlayPrompt(); });
$('#clickplay').style.pointerEvents = 'auto';
$('#playBtn').onclick = e => { e.stopPropagation(); audio.init(); canvas.requestPointerLock?.(); };
$('#clickplay').onclick = e => { if (e.target.closest('.panel')) return; audio.init(); canvas.requestPointerLock?.(); };
document.addEventListener('mousemove', e => {
  if (!S.locked) return;
  const k = S.scoped ? 0.35 : 1;
  S.mdx += e.movementX; S.mdy += e.movementY;
  S.yaw -= e.movementX * 0.0022 * k;
  S.pitch = clamp(S.pitch - e.movementY * 0.0022 * k, -1.5, 1.5);
});
document.addEventListener('mousedown', e => {
  if (!S.locked) return;
  if (e.button === 0) { S.firing = true; S.clicked = true; if (!alive()) cycleSpec(); }
  if (e.button === 2) { S.rclick = true; if (alive() && S.me.w === 'sniper') S.scoped = !S.scoped; }
});
document.addEventListener('mouseup', e => { if (e.button === 0) S.firing = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => {
  if (!S.locked || !alive()) return;
  const order = ['pr', 'se', 'kn', 'n'].filter(s => s === 'n' ? S.me.inv.n > 0 : s === 'kn' ? true : S.me.inv[s]);
  const cur = order.findIndex(s => (s === 'n' ? 'grenade' : s === 'kn' ? 'knife' : S.me.inv[s]) === S.me.w);
  const next = order[(cur + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length]; if (next) switchSlot(next);
});
function switchSlot(s) { S.scoped = false; S.shotIdx = 0; socket.emit('switch', s); }
addEventListener('keydown', e => {
  if (!S.inGame) return;
  if (e.code === 'Tab') { e.preventDefault(); S.boardOpen = true; return; }
  if (e.repeat) { if (e.code === 'Space' || e.code.startsWith('Control')) e.preventDefault(); return; }
  S.keys[e.code] = true;
  if (!S.locked) return;
  if (e.code === 'Space') { e.preventDefault(); S.jumpAt = performance.now(); }
  if (e.code === 'KeyB') { if (S.buyOpen) closeBuy(); else if (S.phase === 'freeze' && alive()) openBuy(); }
  if (S.buyOpen && /^Digit[1-8]$/.test(e.code)) { socket.emit('buy', ITEMS[+e.code[5] - 1].id); return; }
  if (e.code === 'Digit1') switchSlot('pr'); if (e.code === 'Digit2') switchSlot('se'); if (e.code === 'Digit3') switchSlot('kn'); if (e.code === 'Digit4') switchSlot('n');
  if (e.code === 'KeyR') socket.emit('reload');
  if (e.code === 'KeyE') socket.emit('use', true);
  if (e.code === 'KeyF' && alive() && !S.me.rl && S.phase !== 'lobby') vmod.inspect(Date.now());
  if (e.code.startsWith('Control') || e.code === 'KeyC') e.preventDefault();
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
    const own = it.id === 'armor' ? m.ar >= 100 : it.id === 'grenade' ? m.inv.n >= 1 : it.id === 'kit' ? m.kit : m.inv[WEAPONS[it.id].slot] === it.id;
    const blocked = it.id === 'kit' && m.tm !== 'def';
    return `<div class="buyrow ${m.mo < it.price || own || blocked ? 'no' : ''}"><span>[${it.key}] ${it.label}</span><span>${own ? '<em>имаш</em>' : '<b>$' + it.price + '</b>'}</span></div>`;
  }).join('');
}

// ================= Физика на играча (CS2: ускорение, триене, air strafing, bhop с ограничение) =================
function readInput() {
  const can = S.locked && alive() && S.phase !== 'lobby';
  let fx = 0, fz = 0;
  if (can) { fx = (S.keys.KeyD ? 1 : 0) - (S.keys.KeyA ? 1 : 0); fz = (S.keys.KeyS ? 1 : 0) - (S.keys.KeyW ? 1 : 0); }
  return { can, fx, fz, crouch: can && !!(S.keys.ControlLeft || S.keys.ControlRight || S.keys.KeyC), walk: can && !!(S.keys.ShiftLeft || S.keys.ShiftRight), jumpHeld: can && !!S.keys.Space };
}
const hspeed = v => Math.hypot(v.x, v.z);
function accelerate(v, wx, wz, wishspeed, accel, dt, cap = Infinity) {
  const ws = Math.min(wishspeed, cap), cur = v.x * wx + v.z * wz, add = ws - cur;
  if (add <= 0) return;
  const a = Math.min(accel * dt * wishspeed, add);
  v.x += wx * a; v.z += wz * a;
}
function simStep(dt, inp) {
  const W = S.world, p = S.pos, v = S.vel, HW = MOVE.HW;
  // клякане: хитбоксът се променя веднага; ставането изисква място
  if (inp.crouch && !S.crouching) S.crouching = true;
  else if (!inp.crouch && S.crouching && !boxCollides(W, p.x, p.y, p.z, HW, MOVE.STAND_H)) S.crouching = false;
  const H = S.crouching ? MOVE.CROUCH_H : MOVE.STAND_H;
  const tgt = S.crouching ? 1 : 0; S.crouchAmt += clamp(tgt - S.crouchAmt, -dt / MOVE.CROUCH_TIME, dt / MOVE.CROUCH_TIME);
  S.inWater = waterDepth(W, p.x, p.y, p.z, H) > 0.45;

  const wdef = WEAPONS[S.me.w];
  let vmax = wdef?.speed ?? 6.25; if (S.scoped && wdef?.scoped) vmax = wdef.scoped;
  let mult = 1; if (S.crouching) mult = MOVE.CROUCH_MUL; else if (inp.walk) mult = MOVE.WALK_MUL;
  if (S.inWater) mult *= MOVE.WATER_MUL;
  const maxSpeed = vmax * mult;

  const sn = Math.sin(S.yaw), cs = Math.cos(S.yaw);
  let wx = inp.fx * cs + inp.fz * sn, wz = -inp.fx * sn + inp.fz * cs;
  const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  const wishspeed = wl > 0 ? maxSpeed : 0;

  // скок (без автоматичен bhop: трябва ново натискане; малък буфер преди приземяване)
  const now = performance.now();
  if (inp.can && S.jumpAt && now - S.jumpAt < 130 && S.onGround && !S.inWater) {
    v.y = MOVE.JUMP; S.onGround = false; S.jumpAt = 0;
    const cap = vmax * (S.crouching ? MOVE.CROUCH_MUL * 3 : 1) * MOVE.BHOP_CAP, hs = hspeed(v);
    if (hs > cap) { v.x *= cap / hs; v.z *= cap / hs; }
    audio.jump(null, surfaceAt(p.x, p.y, p.z));
  }

  if (S.inWater) {
    const hs = hspeed(v); if (hs > 0) { const drop = Math.min(hs, hs * 2.2 * dt + 0.02); v.x *= (hs - drop) / hs; v.z *= (hs - drop) / hs; }
    accelerate(v, wx, wz, wishspeed, 6, dt);
    if (inp.jumpHeld) v.y = Math.min(3.4, v.y + 26 * dt); else v.y += (-2.0 - v.y) * Math.min(1, 3 * dt);
  } else if (S.onGround) {
    const hs = hspeed(v);
    if (hs < 0.03) { v.x = 0; v.z = 0; } else { const control = Math.max(hs, MOVE.STOP), drop = control * MOVE.FRICTION * dt, ns = Math.max(0, hs - drop) / hs; v.x *= ns; v.z *= ns; }
    accelerate(v, wx, wz, wishspeed, MOVE.ACCEL, dt);
  } else {
    accelerate(v, wx, wz, wishspeed, MOVE.AIR_ACCEL, dt, MOVE.AIR_CAP);
    const hs = hspeed(v), cap = MOVE.AIR_MAX * 6.25; if (hs > cap) { v.x *= cap / hs; v.z *= cap / hs; }
  }
  if (!S.inWater) v.y = Math.max(-45, v.y - MOVE.GRAVITY * dt);

  const wasGround = S.onGround, vyBefore = v.y;
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
  // приземяване и стъпки (стъпки няма при Shift и клякане)
  if (S.onGround && !wasGround && vyBefore < -3.5 && !S.inWater) audio.land(null, -vyBefore / 8, surfaceAt(p.x, p.y, p.z));
  const hs = hspeed(v);
  if (S.onGround && hs > 1.6 && !inp.walk && !S.crouching) { S.stepAcc += hs * dt; if (S.stepAcc >= 2.0) { S.stepAcc = 0; audio.footstep(surfaceAt(p.x, p.y, p.z), null, 0.5); } }
  else if (!S.onGround) S.stepAcc = 0;
  S.speed = hs;
}

setInterval(() => {
  if (S.inGame && alive() && S.phase !== 'lobby' && !S.noSend) {
    const moving = S.speed > 0.5;
    socket.emit('state', { x: S.pos.x, y: S.pos.y, z: S.pos.z, yw: S.yaw, pt: S.pitch, cr: S.crouching, g: S.onGround, wk: moving && !!(S.keys.ShiftLeft || S.keys.ShiftRight), sc: S.scoped });
  }
}, 33);

// ================= Стрелба (spray pattern като в CS2) =================
function fireTiming(now, w) { if (now - S.lastShotT > w.rreset * 1000) S.shotIdx = 0; }
function tryFire(now) {
  const clicked = S.clicked, rclick = S.rclick; S.clicked = false; S.rclick = false;
  const m = S.me; if (!alive() || !S.locked || S.phase !== 'live' || S.buyOpen) return;
  const w = WEAPONS[m.w]; if (!w) return;
  if (m.w === 'knife') {
    if (now < S.nextFire) return;
    const kk = (clicked || S.firing) ? 'l' : rclick ? 'r' : null;
    if (kk) { const kd = kk === 'l' ? KNIFE.left : KNIFE.right; S.nextFire = now + kd.rate * 1000; socket.emit('knife', { k: kk, yw: S.yaw, pt: S.pitch, d: Math.round(100 + S.ping) }); vmod.attack(kk, now); vmod.cancelInspect(); audio.knife(kk, false, null); }
    return;
  }
  if (!S.firing && !clicked) return;
  if (now < S.nextFire) return;
  if (m.w === 'grenade') {
    if (clicked && m.mag > 0) { socket.emit('throw', { yw: S.yaw, pt: S.pitch + S.punch[1] }); S.nextFire = now + 700; vmod.cancelInspect(); }
    return;
  }
  if (!w.auto && !clicked) return;
  if (m.rl) return;
  if (m.mag <= 0) { if (clicked) audio.empty(); S.nextFire = now + 250; return; }
  S.nextFire = now + w.rate * 1000;
  m.mag--;
  fireTiming(now, w);
  socket.emit('shoot', { yw: S.yaw, pt: S.pitch, sc: S.scoped ? 1 : 0, d: Math.round(100 + S.ping) });
  S.shotIdx++; S.lastShotT = now;
  const [ry, rp] = recoilAt(m.w, S.shotIdx); S.punchT = [ry, rp]; S.punch = [ry, rp];
  S.kick = 1;
  const cs = vmod.fire(now); if (cs) spawnCasing(cs);
  audio.shot(m.w, null);
  if (m.w === 'sniper') S.scoped = false;
}

// ================= Наблюдение =================
function cycleSpec() {
  const mates = S.snap?.pl.filter(p => p.al && p.tm === S.me.tm && p.i !== S.id) || [];
  if (!mates.length) { S.specId = null; return; }
  const i = mates.findIndex(p => p.i === S.specId);
  S.specId = mates[(i + 1) % mates.length].i;
}

// ================= Главен цикъл =================
const _lf = new THREE.Vector3();
let last = performance.now(), hudT = 0, fpsAcc = 0, fpsN = 0, fpsShown = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (nowMs - last) / 1000)); last = nowMs;
  fpsAcc += dt; fpsN++; S.frames = (S.frames || 0) + 1;
  if (fpsAcc >= 1) { fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; adaptQuality(fpsShown); }
  if (!S.inGame || !S.world) { renderer.render(scene, camera); return; }
  const now = Date.now();

  // фиксирана стъпка 64 Hz
  const inp = readInput();
  S.acc += dt;
  while (S.acc >= MOVE.STEP) { S.prev.x = S.pos.x; S.prev.y = S.pos.y; S.prev.z = S.pos.z; simStep(MOVE.STEP, inp); S.acc -= MOVE.STEP; }
  const al = S.acc / MOVE.STEP;
  tryFire(now);
  // откат: мерникът се връща към центъра, когато спреш да стреляш
  const wd = WEAPONS[S.me.w];
  if (wd?.rreset && now - S.lastShotT > wd.rreset * 1000) { S.shotIdx = 0; S.punchT = [0, 0]; }
  S.punch[0] += (S.punchT[0] - S.punch[0]) * Math.min(1, dt * 14); S.punch[1] += (S.punchT[1] - S.punch[1]) * Math.min(1, dt * 14);
  S.kick = Math.max(0, S.kick - dt * 9);
  updateModels(dt); updateNades(); updateBomb(); updateFx(dt);
  if (flames) flames.material.size = 0.85 + Math.sin(now / 90) * 0.1 + Math.sin(now / 37) * 0.05;

  // камера
  const isAlive = alive(), dbg = S.debugCam;
  let cp, cyaw, cpitch;
  const eyeY = MOVE.EYE_STAND + (MOVE.EYE_CROUCH - MOVE.EYE_STAND) * (S.crouchAmt * S.crouchAmt * (3 - 2 * S.crouchAmt));
  if (isAlive) {
    cp = [S.prev.x + (S.pos.x - S.prev.x) * al, S.prev.y + (S.pos.y - S.prev.y) * al + eyeY, S.prev.z + (S.pos.z - S.prev.z) * al];
    cyaw = S.yaw + S.punch[0]; cpitch = S.pitch + S.punch[1];
    S.specId = null;
  } else {
    if (!S.specId || !S.snap?.pl.find(p => p.i === S.specId && p.al)) cycleSpec();
    const pose = S.specId ? poseOf(S.specId, serverNow() - 100) : null;
    if (pose) { cp = [pose.x, pose.y + (pose.cr ? MOVE.EYE_CROUCH : MOVE.EYE_STAND), pose.z]; cyaw = pose.yw; cpitch = pose.pt; }
    else { cp = [S.pos.x, S.pos.y + 1.0, S.pos.z]; cyaw = S.yaw; cpitch = S.pitch; }
  }
  if (dbg) { cp = [dbg.x, dbg.y, dbg.z]; cyaw = dbg.yaw; cpitch = dbg.pitch; }
  const sh = S.shake || 0; S.shake = Math.max(0, sh - dt * 0.8);
  camera.position.set(cp[0] + (Math.random() - .5) * sh, cp[1] + (Math.random() - .5) * sh, cp[2] + (Math.random() - .5) * sh);
  camera.rotation.set(cpitch, cyaw, 0);
  const targetFov = S.scoped && isAlive ? 22 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
  const fwd = _lf.set(0, 0, -1).applyQuaternion(camera.quaternion);
  audio.setListener(camera.position.x, camera.position.y, camera.position.z, fwd.x, fwd.y, fwd.z);

  // viewmodel (отделна сцена, не влиза в стени)
  const myCos = S.cosById.get(S.id);
  if (isAlive && !S.debugVM && (S.vmWeapon !== S.me.w || S.vmReset || S.vmTeam !== S.me.tm)) { S.vmWeapon = S.me.w; S.vmReset = false; S.vmTeam = S.me.tm; vmod.setWeapon(S.me.w, myCos, S.me.tm, now); S.inspect = 0; }
  vmod.visible = isAlive && !S.scoped && (!dbg || S.debugVM);
  vmod.update(dt, now, { speed: S.speed, onGround: S.onGround, crouchAmt: S.crouchAmt, mdx: S.mdx, mdy: S.mdy });
  S.mdx = 0; S.mdy = 0;
  $('#scope').style.display = S.scoped && isAlive ? 'block' : 'none';
  $('#cross').style.display = S.scoped || !isAlive ? 'none' : '';

  renderer.render(scene, camera);
  vmod.render(renderer);
  if (now - (S.radarT || 0) > 33) { S.radarT = now; const f = isAlive ? { x: S.pos.x, z: S.pos.z, yaw: S.yaw } : (S.specId && poseOf(S.specId, serverNow() - 100)) ? (() => { const q = poseOf(S.specId, serverNow() - 100); return { x: q.x, z: q.z, yaw: q.yw }; })() : { x: S.pos.x, z: S.pos.z, yaw: S.yaw }; drawRadar($('#radar'), S, atlas, f, TEAM_COL); }

  hudT += dt; if (hudT > 0.05) { hudT = 0; updateHud(); }
}
requestAnimationFrame(frame); window.__frame = frame; window.__vm = vmod; window.__socket = socket; window.__renderer = renderer;

// динамично намаляване на разделителната способност при ниски FPS
let lowCount = 0, highCount = 0;
function adaptQuality(fps) {
  if (!S.inGame) return;
  if (fps < 38) { lowCount++; highCount = 0; } else if (fps > 58) { highCount++; lowCount = 0; } else { lowCount = 0; highCount = 0; }
  if (lowCount >= 3 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.2); resize(); lowCount = 0; }
  else if (highCount >= 8 && pixelRatio < Math.min(devicePixelRatio, 1.5)) { pixelRatio = Math.min(Math.min(devicePixelRatio, 1.5), pixelRatio + 0.1); resize(); highCount = 0; }
}

function inSite() {
  if (!S.mapJson) return null;
  for (const [n, [x1, z1, x2, z2]] of Object.entries(S.mapJson.sites)) if (S.pos.x >= x1 && S.pos.x <= x2 + 1 && S.pos.z >= z1 && S.pos.z <= z2 + 1) return n;
  return null;
}
let crossGap = 6;
function updateHud() {
  const s = S.snap, m = S.me; if (!s) return;
  $('#scoreAtt').textContent = s.sc.att; $('#scoreDef').textContent = s.sc.def;
  $('#timer').textContent = s.bomb ? '💣' : fmt(s.tl);
  $('#phaseTxt').textContent = s.ph === 'freeze' ? `Купуване: ${Math.ceil(s.tl)}с  •  Рунд ${s.rd}` : `Рунд ${s.rd}  •  ${m.tm === 'att' ? 'Нападател' : 'Защитник'}`;
  $('#phaseTxt').style.color = TEAM_COL[m.tm];
  $('#money').textContent = m.mo;
  $('#hp b').textContent = Math.max(0, m.hp); $('#ar b').textContent = m.ar;
  const w = WEAPONS[m.w]; $('#wname').textContent = (w?.name || '') + (m.rl ? ' — презарежда…' : '');
  const noAmmo = m.w === 'knife';
  $('#ammo').style.visibility = noAmmo ? 'hidden' : 'visible';
  $('#ammo b').textContent = m.mag; $('#ammo span').textContent = m.w === 'grenade' ? '' : ' / ' + m.res;
  $('#items').textContent = [m.inv.bomb ? '💣 Бомба' : '', m.kit ? '🔧 Kit' : ''].filter(Boolean).join('  ');
  const us = m.us;
  $('#useBar').classList.toggle('hidden', !us);
  if (us) { $('#useBar div').style.width = (us.p * 100) + '%'; $('#useBar span').textContent = us.k === 'plant' ? 'Залагане на бомбата…' : 'Обезвреждане…'; }
  let hint = '';
  if (alive()) {
    if (s.ph === 'freeze') hint = 'Натисни B за магазина';
    else if (s.ph === 'live' && m.tm === 'att' && m.inv.bomb && !s.bomb && inSite()) hint = `Дръж E, за да заложиш бомбата (${inSite()})`;
    else if (s.ph === 'live' && m.tm === 'att' && m.inv.bomb && !s.bomb) hint = 'Носиш бомбата – иди на A или B';
    else if (s.ph === 'live' && m.tm === 'def' && s.bomb && Math.hypot(S.pos.x - s.bomb.x, S.pos.z - s.bomb.z) < 2.4) hint = `Дръж E, за да обезвредиш бомбата (${m.kit ? '5' : '10'}с)`;
  }
  $('#hint').textContent = us ? '' : hint;
  const sp = $('#spec'); sp.classList.toggle('hidden', alive() || s.ph === 'lobby');
  if (!alive()) { const t = s.pl.find(p => p.i === S.specId); sp.textContent = t ? `Наблюдаваш: ${t.n} (клик – следващ)` : 'Мъртъв си'; }
  if (S.buyOpen) { if (s.ph !== 'freeze') closeBuy(); else renderBuy(); }
  if (S.boardOpen) renderBoard(s);
  // динамичен мерник: колкото си по-неточен, толкова е по-широк
  if (alive() && w?.spread) {
    const spread = spreadFor(m.w, { cr: S.crouching, sc: S.scoped, spd: S.speed, g: S.onGround, idx: S.shotIdx });
    const target = 4 + Math.tan(spread) / Math.tan(camera.fov * Math.PI / 360) * (innerHeight / 2);
    crossGap += (Math.min(70, target) - crossGap) * 0.5; $('#cross').style.setProperty('--gap', crossGap.toFixed(1) + 'px');
  }
  $('#fps').textContent = fpsShown + ' FPS';
}
function renderBoard(s) {
  const el = $('#board'); el.classList.remove('hidden');
  const tbl = t => `<h4 style="color:${TEAM_COL[t]}">${TEAM_NAME[t]} — ${s.sc[t]}</h4><table><tr><th>Играч</th><th>У</th><th>С</th></tr>` +
    s.pl.filter(p => p.tm === t).sort((a, b) => b.k - a.k).map(p => `<tr class="${p.i === S.id ? 'me' : ''} ${p.al ? '' : 'dead'}"><td>${esc(p.n)}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('') + '</table>';
  el.innerHTML = tbl('att') + tbl('def') + `<div style="color:#9aa6b8;font-size:13px">Пинг: ${Math.round(S.ping)} мс • Рунд ${s.rd}/${CFG.MAX_ROUNDS} • до ${CFG.WIN_ROUNDS} победи</div>`;
}
