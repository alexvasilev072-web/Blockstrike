// BlockStrike - клиент (Three.js). Сървърът е авторитетен за попадения, щети, бомба и рунд; тук са рендерът,
// входът и предвиждането на собственото движение (физика като в CS2).
import * as THREE from 'three';
import { World, BLOCK, DEFS, boxCollides, waterDepth } from '/shared/world.js';
import { NADE_IDS, NADE_ORDER, NADE_W, nadePrice, WEAPONS, ITEMS, BUY_CATS, weaponsOfCat, canUse, CFG, MOVE, KNIFE, recoilAt, spreadFor, inBuyZone } from '/shared/weapons.js';
import { settings, initSettings } from './settings.js';
import { stepBody, platformsAt } from '/shared/physics.js';
import { Bsp, decodeF32, decodeU8, decodeU32 } from '/shared/bsp.js';
import { buildAtlas, BLOCK_TILES, setAtlasFilter } from './textures.js';
import { WorldRenderer } from './mesher.js';
import { audio } from './audio.js';
import { ViewModel } from './viewmodel.js';
import { initSkins } from './skins.js';
import { drawRadar, markRadarDirty } from './radar.js';
import { buildCharacter, makeArm, defaultChar } from './characters.js';
import { initHeroes, loadChar } from './heroes.js';
import { initVoice } from './voice.js';
import { music } from './music.js';
import { weaponIcon } from './wicons.js';
import { Ragdoll, rememberRest, resetRagdollPose, applyRagdoll } from './ragdoll.js';
import { keyLabel } from './settings.js';
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
  buyOpen: false, boardOpen: false, specId: null, vmWeapon: null, kick: 0, lastBeep: 0, shake: 0, cosById: new Map(), speed: 0, mdx: 0, mdy: 0, vmReset: false, tick: 0, specCr: 0, specSpeed: 0, specG: true, specLast: null, vmSpec: null, boardPinned: false, everLocked: false,
  mode: 'comp', wjT: 0, surfing: false, platform: null, groundN: null, jumped: false, platDefs: [], platsNow: [], simT: 0,
};
window.__S = S;

// ================= Главно меню / лоби =================
const qRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
$('#name').value = localStorage.getItem('bs_name') || '';
if (qRoom) { $('#room').value = qRoom; $('#joinQuery').textContent = `Влез в стая ${qRoom}`; $('#joinQuery').classList.remove('hidden'); $('#createBtn').classList.remove('primary'); }

function joinRoom(code) {
  audio.init();
  const name = $('#name').value.trim(); localStorage.setItem('bs_name', name);
  $('#joinErr').textContent = '';
  socket.emit('join', { name, room: code }, res => {
    if (!res.ok) { $('#joinErr').textContent = res.error; return; }
    S.id = res.id; S.code = res.code;
    history.replaceState(null, '', '?room=' + res.code);
    $('#join').classList.add('hidden'); $('#lobby').classList.remove('hidden');
    sendLoadout();
  });
}
$('#createBtn').onclick = () => joinRoom('');
$('#joinBtn').onclick = () => joinRoom($('#room').value.trim());
$('#joinQuery').onclick = () => joinRoom(qRoom);
$('#name').onkeydown = e => { if (e.code === 'Enter' || e.code === 'NumpadEnter') joinRoom(qRoom); };
$('#room').onkeydown = e => { if (e.code === 'Enter' || e.code === 'NumpadEnter') joinRoom($('#room').value.trim()); };
$('#copyLink').onclick = () => { navigator.clipboard?.writeText(location.href); $('#copyLink').textContent = 'Копирано!'; setTimeout(() => $('#copyLink').textContent = 'Копирай линк', 1500); };
document.querySelectorAll('[data-team]:not(.addBot)').forEach(b => b.onclick = () => socket.emit('team', b.dataset.team));
document.querySelectorAll('.addBot').forEach(b => b.onclick = () => socket.emit('addBot', { team: b.dataset.team, diff: $('#botDiff').value }));
$('#botFill').onclick = () => { const L = S.lobby; if (!L) return; const cnt = { att: 0, def: 0 }; L.players.forEach(p => cnt[p.team]++); let n = (L.maps.find(m => m.id === L.mapId)?.max || 10) - L.players.length; while (n-- > 0) { const t = cnt.att <= cnt.def ? 'att' : 'def'; cnt[t]++; socket.emit('addBot', { team: t, diff: $('#botDiff').value }); } };
$('#botClear').onclick = () => (S.lobby?.players || []).filter(p => p.bot).forEach(p => socket.emit('removeBot', p.id));
$('#startBtn').onclick = () => { audio.init(); socket.emit('start'); };
$('#mapSel').onchange = e => socket.emit('setMap', e.target.value);
$('#backBtn').onclick = () => leaveRoom();
document.querySelectorAll('.modeBtn').forEach(b => b.onclick = () => socket.emit('setMode', b.dataset.mode));
$('#pLobby').onclick = () => socket.emit('tolobby');

// Напускане на стаята (бутон „Назад“ в лобито и „Излез в главното меню“ в паузата). Без презареждане на страницата.
function leaveRoom() {
  socket.emit('leave'); voice.closeAll(); music.setScene('menu'); document.body.classList.remove('ingame'); setupPlatforms(null); S.mode = 'comp'; $('#hud').classList.remove('run');
  S.inGame = false; S.id = null; S.code = null; S.lobby = null; S.snap = null; S.phase = 'lobby'; S.locked = false; S.everLocked = false;
  S.me = { ...S.me, hp: 0, inv: { pr: null, se: 'pistol', n: 0, bomb: false } };
  if (document.pointerLockElement) document.exitPointerLock();
  for (const m of models.values()) disposeModel(m);
  models.clear(); S.pbuf.clear();
  for (const m of nadeMeshes.values()) scene.remove(m);
  nadeMeshes.clear();
  if (bombMesh) { scene.remove(bombMesh); bombMesh = null; }
  if (dropMesh) { scene.remove(dropMesh); dropMesh = null; }
  for (const id of ['#hud', '#lobby', '#clickplay', '#settings', '#skins', '#confirm', '#board']) $(id).classList.add('hidden');
  S.boardPinned = false; S.boardOpen = false; S.buyOpen = false;
  history.replaceState(null, '', location.pathname);
  $('#join').classList.remove('hidden'); $('#createBtn').classList.add('primary'); $('#joinQuery').classList.add('hidden'); $('#room').value = '';
}

// цял екран + Keyboard Lock (за да не се затваря табът с Ctrl+W)
function setKbdMsg(t, ok) { document.querySelectorAll('.kbdmsg').forEach(e => { e.textContent = t; e.style.color = ok ? '#7cf08a' : '#ffb066'; }); }
async function goFullscreen() {
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { setKbdMsg('Цял екран не е позволен от браузъра. Клякане: C.', false); return; }
  if (navigator.keyboard?.lock) {
    try {
      await navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyG', 'KeyC', 'KeyE', 'KeyB', 'Tab', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'Space', 'Escape']);
      setKbdMsg('Цял екран + заключена клавиатура: Ctrl не затваря таба.', true);
    } catch { setKbdMsg('Keyboard Lock не успя. Ползвай C за клякане.', false); }
  } else setKbdMsg('Браузърът не поддържа Keyboard Lock. Клякане: C (вместо Ctrl).', false);
}
document.querySelectorAll('.fsbtn').forEach(b => b.onclick = goFullscreen);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { try { navigator.keyboard?.unlock?.(); } catch { } } });
addEventListener('beforeunload', e => { if (S.inGame) { e.preventDefault(); e.returnValue = ''; } });

socket.on('lobby', onLobby);
function onLobby(L) {
  S.lobby = L; voice.sync();
  $('#lobCode').textContent = L.code;
  for (const t of ['att', 'def']) {
    $(t === 'att' ? '#listAtt' : '#listDef').innerHTML = L.players.filter(p => p.team === t)
      .map(p => `<li class="${p.id === S.id ? 'me' : ''}">${p.bot ? '🤖 ' : ''}${esc(p.name)}${voice.isTalking(p.id) ? '<span class="spk">🔊</span>' : ''} ${p.id === L.hostId ? '<span class="host">★ домакин</span>' : ''}${p.bot ? `<span class="botdiff d-${p.diff}">${{ easy: 'лесен', medium: 'среден', hard: 'труден', expert: 'експерт' }[p.diff] || ''}</span>${L.hostId === S.id ? `<button class="rmBot" data-id="${p.id}" title="Махни бота">✕</button>` : ''}` : ''}</li>`).join('');
  }
  document.querySelectorAll('.rmBot').forEach(b => b.onclick = () => socket.emit('removeBot', b.dataset.id));
  const curMap = L.maps.find(m => m.id === L.mapId), maxP = L.mode === 'comp' ? (curMap?.max || 10) : 10, over = L.mode === 'comp' && L.players.length > maxP;
  const hostNow = L.hostId === S.id, canBots = hostNow && L.mode === 'comp' && L.players.length < maxP;
  document.querySelectorAll('.addBot').forEach(b => b.disabled = !canBots);
  $('#botBar').style.display = L.mode === 'comp' && hostNow ? '' : 'none'; $('#botFill').disabled = !canBots; $('#botClear').disabled = !L.players.some(p => p.bot);
  document.querySelectorAll('.addBot').forEach(b => b.style.display = L.mode === 'comp' && hostNow ? '' : 'none');
  const maps = L.maps.filter(m => m.mode === L.mode), sel = $('#mapSel'), key = maps.map(m => m.id).join(',');
  if (sel.dataset.key !== key) { sel.innerHTML = maps.map(m => `<option value="${m.id}">${esc(m.name)}${L.mode === 'comp' && m.max <= 4 ? ' (2 срещу 2)' : m.big ? ' (5 срещу 5)' : ''}</option>`).join(''); sel.dataset.key = key; }
  sel.value = L.mapId; sel.disabled = L.hostId !== S.id;
  document.querySelectorAll('.modeBtn').forEach(b => { b.classList.toggle('on', b.dataset.mode === L.mode); b.disabled = L.hostId !== S.id; });
  $('.teams').style.display = L.mode === 'comp' ? '' : 'none';
  $('#runPlayers').style.display = L.mode === 'comp' ? 'none' : '';
  $('#runPlayers').innerHTML = L.players.map(p => `<span class="chip ${p.id === S.id ? 'me' : ''}">${esc(p.name)}${p.id === L.hostId ? ' ★' : ''}</span>`).join('');
  $('#mapDesc').textContent = (curMap?.desc || '') + (L.mode === 'comp' && curMap ? ` • Играчи: до ${curMap.max} (${curMap.max / 2} срещу ${curMap.max / 2})` : '');
  $('#startBtn').classList.toggle('over', over); $('#startBtn').title = over ? `Тази карта е за най-много ${maxP} играчи` : '';
  const host = L.hostId === S.id;
  $('#startBtn').style.display = host ? '' : 'none';
  $('#lobHint').textContent = host ? 'Ти си домакин – избери карта и натисни „Старт“. Можеш да стартираш и сам за проба.' : 'Изчакване домакинът да избере карта и да стартира играта…';
  if (over && L.hostId === S.id) $('#lobHint').textContent = `Има ${L.players.length} играчи, а тази карта е за най-много ${maxP}. Махни ботове или избери по-голяма карта.`;
  S.phase = L.phase;
  if (L.phase === 'lobby' && S.inGame) leaveGame();
}

function leaveGame() {   // мачът приключи: връщане в лобито на същата стая
  music.setScene('menu'); document.body.classList.remove('ingame'); clearGroundItems();
  S.inGame = false; setupPlatforms(null); S.locked = false; S.everLocked = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('#hud').classList.add('hidden'); $('#clickplay').classList.add('hidden'); $('#lobby').classList.remove('hidden');
  for (const m of models.values()) disposeModel(m);
  models.clear(); S.pbuf.clear();
}

// ================= Three.js =================
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const QUAL = { low: 1.0, medium: 1.5, high: 2.0 };       // таван на devicePixelRatio по качество (реалният е min с devicePixelRatio на екрана)
const maxPR = () => Math.min(devicePixelRatio, QUAL[settings.quality] || 1.5);
let pixelRatio = maxPR();
renderer.setPixelRatio(pixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 260);
camera.rotation.order = 'YXZ';
scene.add(camera);
const vmod = new ViewModel(renderer);
function resize() { renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vmod.resize(camera.aspect, settings.fov); vmod.userScale = settings.vmScale || 1; }
addEventListener('resize', resize); resize();

const atlas = buildAtlas(THREE);
atlas.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
const worldR = new WorldRenderer(scene, atlas);
function buildWorldMesh(world) { worldR.load(world, { ...(S.mapJson?.env || {}), realistic: settings.realistic, shadows: settings.realistic && settings.quality === 'high' }); buildBspMesh(S.mapJson); applyRealism(); }

// ----- GoldSrc (CS 1.6) карта: геометрията е готова триъгълна мрежа с вградено осветление -----
let bspGroup = null;
function buildBspMesh(json) {
  if (bspGroup) { scene.remove(bspGroup); bspGroup.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); bspGroup = null; }
  S.bsp = json?.type === 'bsp' ? new Bsp(json) : null; { const r = document.querySelector('#radar'); if (r) r.style.display = S.bsp ? 'none' : ''; }
  if (!S.bsp) return;
  bspGroup = new THREE.Group();
  const m = json.mesh, mk = (pos, col, idx, alpha) => {
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3, true)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: alpha ? THREE.DoubleSide : THREE.FrontSide, transparent: !!alpha, opacity: alpha ? 0.55 : 1, depthWrite: !alpha });
    const mesh = new THREE.Mesh(g, mat); if (alpha) mesh.renderOrder = 2; bspGroup.add(mesh);
  };
  mk(decodeF32(m.pos), decodeU8(m.col), decodeU32(m.idx), false);
  mk(decodeF32(m.apos), decodeU8(m.acol), decodeU32(m.aidx), true);
  scene.add(bspGroup);
}


// ----- реалистично небе: градиент, слънце, облаци -----
let skyGroup = null, skyClouds = [];
function cloudTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 46; i++) { const x = 40 + Math.random() * 176, y = 40 + Math.random() * 48, r = 14 + Math.random() * 26, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.34)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  return new THREE.CanvasTexture(c);
}
function buildSky(env) {
  if (skyGroup) { scene.remove(skyGroup); skyGroup.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); skyGroup = null; skyClouds = []; }
  if (!settings.realistic || !env || !(env.sun > 0.2)) return;
  skyGroup = new THREE.Group();
  const top = new THREE.Color(env.sky || '#8fd0ff'), hor = new THREE.Color(env.fogColor || env.sky || '#b9dcff');
  const zen = top.clone().multiplyScalar(0.62).lerp(new THREE.Color(0x2b5fb0), 0.35), geo = new THREE.SphereGeometry(235, 24, 14), col = [], p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const h = Math.max(0, p.getY(i) / 235), t = Math.pow(h, 0.6), c = hor.clone().lerp(zen, t); col.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  skyGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  const sd = (env.sunDir || [-0.55, 0.75, -0.38]), sl = Math.hypot(...sd), sdn = sd.map(v => v / sl);
  const sunTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62); gr.addColorStop(0, 'rgba(255,252,235,1)'); gr.addColorStop(0.18, 'rgba(255,244,205,0.95)'); gr.addColorStop(0.5, 'rgba(255,225,160,0.28)'); gr.addColorStop(1, 'rgba(255,220,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true })); sun.scale.set(70, 70, 1); sun.position.set(sdn[0] * 225, sdn[1] * 225, sdn[2] * 225); skyGroup.add(sun);
  const ct = cloudTexture();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5, el = 0.2 + Math.random() * 0.45, r = 222;
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.75 })); m.scale.set(95 + Math.random() * 70, 38 + Math.random() * 24, 1);
    m.userData = { a, el, r, sp: 0.004 + Math.random() * 0.006 }; skyGroup.add(m); skyClouds.push(m);
  }
  scene.add(skyGroup);
}
function updateSky(dt) {
  if (!skyGroup) return;
  skyGroup.position.copy(camera.position);
  for (const m of skyClouds) { m.userData.a += m.userData.sp * dt; const { a, el, r } = m.userData; m.position.set(Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r); }
}
function applyRealism() { document.body.classList.toggle('real', !!settings.realistic); setAtlasFilter(THREE, atlas.texture, settings.realistic); buildSky(S.mapJson?.env); }

// ----- следи от куршуми по стените -----
const decals = [];
const decalMat = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 1, 32, 32, 30); gr.addColorStop(0, 'rgba(10,8,6,0.95)'); gr.addColorStop(0.35, 'rgba(25,20,16,0.8)'); gr.addColorStop(0.7, 'rgba(60,50,40,0.35)'); gr.addColorStop(1, 'rgba(60,50,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); })();
const decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
function addDecal(e, dir) {
  if (!settings.realistic || !S.world) return;
  // нормалата е по оста, при която точката лежи на цяла координата
  let ax = -1, best = 0.04; for (let i = 0; i < 3; i++) { const fr = Math.abs(e[i] - Math.round(e[i])); if (fr < best) { best = fr; ax = i; } }
  if (ax < 0) return;
  const n = [0, 0, 0]; n[ax] = dir[ax] > 0 ? -1 : 1;
  const m = new THREE.Mesh(decalGeo, decalMat); m.position.set(e[0] + n[0] * 0.012, e[1] + n[1] * 0.012, e[2] + n[2] * 0.012);
  m.lookAt(m.position.x + n[0], m.position.y + n[1], m.position.z + n[2]); m.rotation.z += Math.random() * 6.28; m.scale.setScalar(0.6 + Math.random() * 0.6);
  scene.add(m); decals.push({ m, t: 25 }); if (decals.length > 140) { const o = decals.shift(); scene.remove(o.m); }
}
function updateDecals(dt) { for (let i = decals.length - 1; i >= 0; i--) { const d = decals[i]; d.t -= dt; if (d.t < 3) d.m.material = d.m.material; if (d.t <= 0) { scene.remove(d.m); decals.splice(i, 1); } } }

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
  if (json.type !== 'bsp') {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.ground) }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(sx / 2, -0.6, sz / 2); scene.add(ground); mapDeco.push(ground);
  }
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
const handGeoS = new THREE.SphereGeometry(0.052, 10, 8);
const BOMB_GEO = new THREE.BoxGeometry(0.4, 0.14, 0.26), LED_GEO = new THREE.BoxGeometry(0.06, 0.04, 0.06), LED_MAT = new THREE.MeshBasicMaterial({ color: 0xff2020 });
const SHADOW_GEO = new THREE.CircleGeometry(0.5, 12), SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
const charOf = (id, tm) => { const ch = S.cosById.get(id)?.char; return (ch && typeof ch === 'object' ? ch[tm] : null) || defaultChar(tm); };
function makeModel(p) {
  const char = charOf(p.i, p.tm), c = buildCharacter(char, p.tm);
  const g = new THREE.Group(), rig = new THREE.Group(), head = c.head, body = c.body, legL = c.legL, legR = c.legR;
  const sh = c.sh, aim = new THREE.Group(); aim.position.set(0, sh.y, 0); aim.rotation.order = 'YXZ';
  const armR = makeArm(c), armL = makeArm(c), hm = mat(c.handHex);
  const handR = new THREE.Mesh(handGeoS, hm), handL = new THREE.Mesh(handGeoS, hm);
  const gunHolder = new THREE.Group(); gunHolder.position.set(0.2, -0.2 - (sh.y - 1.3), -0.42);
  aim.add(armR.g, armL.g, handR, handL, gunHolder);
  const bomb = new THREE.Mesh(BOMB_GEO, mat(0x2d2d2d)); bomb.position.set(0, 1.05, 0.27); bomb.visible = false;
  const led = new THREE.Mesh(LED_GEO, LED_MAT); led.position.set(0.12, 0.09, 0); bomb.add(led);
  const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; shadow.renderOrder = 1;
  rig.add(head, body, legL, legR, aim, bomb); g.add(rig, shadow);
  const m = { shX: sh.x, shY: sh.y, char, tick: c.tick, g, rig, head, body, legL, legR, aim, armR, armL, handR, handL, gunHolder, gunModel: null, gunKey: '', flash: null, bomb, shadow, flashUntil: 0, swingT: 0, swingKind: 'l', team: p.tm, name: p.n, lie: 0, lastX: p.x, lastZ: p.z, phase: 0, stepAcc: 0, wasG: true, crAmt: 0, lastY: p.y };
  rememberRest(m); scene.add(g); return m;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _fwd = new THREE.Vector3(0, 0, -1);
function setArm(arm, hand, from, to, side) { arm.set(from, to, side); hand.position.copy(to); }
// оръжие в ръката на играч (воксел модел с LOD = 2 см кубчета), с неговия скин
function setGun(m, weapon, cos, team) {
  const id = modelIdFor(weapon, cos), skin = skinFor(weapon, cos), key = id + '/' + skin;
  if (m.gunKey === key) return; m.gunKey = key;
  if (m.gunModel) m.gunHolder.remove(m.gunModel);
  const gm = buildModel(id, { skin, step: 2, team }), bp = BP[id];
  m.gunHolder.add(gm); m.gunModel = gm; m.bp = bp;
  m.flash = null;
  if (bp.muzzle && !bp.knife && !NADE_IDS.includes(id)) { m.flash = buildModel('flash', { step: 2 }); m.flash.position.set(bp.muzzle[0] * VS, bp.muzzle[1] * VS, bp.muzzle[2] * VS); m.flash.visible = false; gm.add(m.flash); }
}
function poseArms(m) {
  const bp = m.bp; if (!bp) return;
  const gp = m.gunHolder.position;
  _b.set(gp.x + bp.rh[0] * VS, gp.y + bp.rh[1] * VS, gp.z + bp.rh[2] * VS);
  setArm(m.armR, m.handR, _a.set(m.shX, 0, 0), _b, 1);
  if (bp.lh) { _b.set(gp.x + bp.lh[0] * VS, gp.y + bp.lh[1] * VS, gp.z + bp.lh[2] * VS); setArm(m.armL, m.handL, _a.set(-m.shX, 0, 0), _b, -1); }
  else { _b.set(-0.22, -0.4, -0.12); setArm(m.armL, m.handL, _a.set(-m.shX, 0, 0), _b, -1); }
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

// махане на модела на играч: името (CanvasTexture) се освобождава, геометриите са общи и остават
function disposeModel(m) { scene.remove(m.g); m.g.traverse(o => { if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); } }); }
// накъде да падне трупът: напред/назад според свободното място (0 = свлича се на място)
function pickFall(pose) {
  const w = S.world; if (!w) return 1; const fx = -Math.sin(pose.yw), fz = -Math.cos(pose.yw);
  const free = s => { for (let d = 0.5; d <= 1.9; d += 0.4) { const x = pose.x + fx * d * s, z = pose.z + fz * d * s; for (const dy of [0.25, 0.9]) if (w.solid(Math.floor(x), Math.floor(pose.y + dy), Math.floor(z))) return false; } return true; };
  return free(1) ? 1 : free(-1) ? -1 : 0;
}
// височина на първата твърда повърхност под точка (за труповете); без воксел свят остава зададената
function groundY(x, y, z) {
  const w = S.world; if (!w || !w.solid) return y;
  const fx = Math.floor(x), fz = Math.floor(z);
  for (let yy = Math.floor(y + 0.5); yy >= 0; yy--) if (w.solid(fx, yy - 1, fz)) return yy;
  return 0;
}
function updateModels(dt) {
  const snap = S.snap; if (!snap) return;
  const rt = serverNow() - 100, ids = new Set();
  for (const p of snap.pl) {
    if (p.i === S.id) continue;
    ids.add(p.i);
    let m = models.get(p.i);
    if (!m || m.team !== p.tm || m.char !== charOf(p.i, p.tm)) { if (m) disposeModel(m); m = makeModel(p); models.set(p.i, m); if (p.tm === S.me.tm) m.g.add(nameSprite(p.n, TEAM_COL[p.tm])); }
    const pose = poseOf(p.i, rt) || p;
    m.g.visible = !(S.specId === p.i && !alive()) && !p.po;           // тялото на поетия бот се скрива (на негово място е играчът)
    // смърт: ragdoll (верле симулация, само на клиента); заспива след 2–3 с и остава до края на рунда
    if (!p.al && S.world && !S.bsp) {
      if (!m.rag) { const h = deathHits.get(p.i); deathHits.delete(p.i); m.rag = new Ragdoll(m.shX, { x: m.lastPX ?? pose.x, y: m.lastPY ?? pose.y, z: m.lastPZ ?? pose.z, yw: pose.yw, cr: pose.cr }, h && performance.now() - h.t < 4000 ? h : null, S.world, p.i.length * 7 + p.i.charCodeAt(p.i.length - 1)); m.ragDirty = true; }
      if (m.rag.step(dt) || m.ragDirty) { applyRagdoll(m, m.rag, setArm); m.ragDirty = false; }
      m.lastPX = pose.x; m.lastPY = pose.y; m.lastPZ = pose.z; continue;
    }
    if (m.rag) { resetRagdollPose(m); m.lie = 0; m.lieDir = undefined; m.deadY = undefined; }
    m.lastPX = pose.x; m.lastPY = pose.y; m.lastPZ = pose.z;
    m.g.position.set(pose.x, pose.y, pose.z);
    m.g.rotation.y = pose.yw;
    m.head.rotation.x = clamp(pose.pt * 0.8, -0.75, 0.75); m.head.rotation.y = 0; m.head.rotation.z = 0; m.aim.rotation.x = clamp(pose.pt * 0.95, -1.1, 1.1);   // глава: само накланяне, ограничено спрямо торса
    const dx = pose.x - m.lastX, dz = pose.z - m.lastZ, dist = Math.hypot(dx, dz), sp = dist / Math.max(dt, 0.001);
    m.lastX = pose.x; m.lastZ = pose.z;
    m.phase += Math.min(sp, 8) * dt * 2.2;
    const sw = p.al ? Math.sin(m.phase) * Math.min(1, sp / 4) * 0.8 : 0;
    { const cr = Math.max(m.crAmt, m.lieC || 0), kl = Math.min(0, sw) * 1.5 - Math.abs(sw) * 0.12, kr = Math.min(0, -sw) * 1.5 - Math.abs(sw) * 0.12;
      m.legL.rotation.x = sw * (1 - cr) + cr; m.legR.rotation.x = -sw * (1 - cr) + cr;
      m.legL.userData.shin.rotation.x = kl * (1 - cr) - 2.0 * cr; m.legR.userData.shin.rotation.x = kr * (1 - cr) - 2.0 * cr; m.rig.position.y = -0.39 * cr; }
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
    // смърт: пада напред/назад там, където има място (иначе се свлича на място) – така не влиза в стени и щайги; ръцете висят, оръжието не се вижда
    if (!p.al && m.lieDir === undefined) m.lieDir = pickFall(pose); else if (p.al) m.lieDir = undefined;
    m.lie += ((p.al ? 0 : 1) - m.lie) * Math.min(1, dt * 8);
    const L = m.lie, dir = m.lieDir ?? 1; m.g.rotation.order = 'YXZ';
    m.g.rotation.x = dir === 0 ? -L * 0.28 : dir > 0 ? -L * Math.PI / 2 : L * Math.PI / 2;
    m.g.position.y += dir === 0 ? 0 : L * 0.3;
    m.lieC = dir === 0 ? L : 0;
    m.shadow.visible = !!p.al;                                           // кръглата сянка е на пода; при легнал труп щеше да стои изправена като черен диск
    if (!p.al) {                                                        // паднал във въздуха/върху щайга: тялото се спуска до земята, а не виси там, където е умрял
      if (m.deadY === undefined) { m.deadY = pose.y; m.vy = 0; m.gy = groundY(pose.x, pose.y, pose.z); }
      m.vy -= 18 * dt; m.deadY += m.vy * dt; if (m.deadY <= m.gy) { m.deadY = m.gy; m.vy = 0; }
      m.g.position.y = m.deadY + (dir === 0 ? 0 : L * 0.3);
    } else m.deadY = undefined;
    m.gunHolder.visible = L < 0.08; m.head.rotation.x *= (1 - L); m.aim.rotation.x *= (1 - L);
    if (L > 0.08) { _b.set(m.shX + 0.04, m.shY - 0.6, -0.04); setArm(m.armR, m.handR, _a.set(m.shX, 0, 0), _b, 1); _b.set(-m.shX - 0.04, m.shY - 0.6, -0.04); setArm(m.armL, m.handL, _a.set(-m.shX, 0, 0), _b, -1); }
    m.bomb.visible = !!p.bm && !!p.al;
    if (m.flash) m.flash.visible = Date.now() < m.flashUntil;
    // тиктакащ звук при залагане/обезвреждане от други играчи
    if (p.us && p.al) { m.useT = (m.useT || 0) - dt; if (m.useT <= 0) { m.useT = p.us === 1 ? 0.5 : 0.8; (p.us === 1 ? audio.plantTick : audio.defuseTick)([pose.x, pose.y + 0.5, pose.z]); } }
  }
  for (const [id, m] of models) if (!ids.has(id)) { disposeModel(m); models.delete(id); }
}

// ================= Панел с оръжията (долу вдясно) =================
// Редове: 1 основно, 2 пистолет, 3 нож, 4 гранати, бомба (G). Оръжието в ръката е ярко с акцент; останалите са полупрозрачни.
// При смяна/взимане/хвърляне панелът за миг става по-видим и после пак избледнява.
const wpRows = new Map(); let wpSig = '', wpTimer = 0;
function wpRow(key, label) {
  let r = wpRows.get(key); if (r) return r;
  r = { el: document.createElement('div'), icons: document.createElement('div'), n: document.createElement('span') };
  r.el.className = 'wprow'; r.n.className = 'wpkey'; r.n.textContent = label; r.icons.className = 'wpicons'; r.el.append(r.icons, r.n); $('#wpanel').appendChild(r.el); wpRows.set(key, r); return r;
}
function renderWpanel(m) {
  const P = $('#wpanel'); if (!P) return; const show = alive() && S.mode === 'comp' && S.inGame; P.style.display = show ? '' : 'none'; if (!show) return;
  const inv = m.inv || {}, g = inv.g || {}, cur = m.w, rows = [];
  rows.push(['pr', '1', inv.pr ? [[inv.pr, 0]] : []]);
  rows.push(['se', '2', inv.se ? [[inv.se, 0]] : []]);
  rows.push(['kn', '3', [['knife', 0]]]);
  rows.push(['n', '4', NADE_ORDER.filter(k => g[k] > 0).map(k => [NADE_W[k], g[k]])]);
  rows.push(['bomb', 'G', inv.bomb ? [['bomb', 0]] : []]);
  const sig = rows.map(r => r[0] + ':' + r[2].map(i => i[0] + i[1]).join(',')).join('|') + '#' + cur;
  if (sig === wpSig) return;
  if (wpSig) { P.classList.add('flash'); clearTimeout(wpTimer); wpTimer = setTimeout(() => P.classList.remove('flash'), 1800); }
  wpSig = sig;
  for (const [key, label, list] of rows) {
    const r = wpRow(key, label); r.el.style.display = list.length ? '' : 'none'; r.icons.textContent = '';
    for (const [id, cnt] of list) {
      const im = document.createElement('div'); im.className = 'wpicon' + (id === cur ? ' on' : ''); const img = new Image(); img.src = weaponIcon(id); img.alt = ''; im.appendChild(img);
      if (cnt > 1) { const c = document.createElement('i'); c.textContent = '×' + cnt; im.appendChild(c); }
      r.icons.appendChild(im);
    }
    r.el.classList.toggle('on', list.some(i => i[0] === cur));
  }
}

// ================= Оръжия на земята =================
// Сървърът праща в snap.it: [id, оръжие, x, y, z, лежи]. Тук само се показват: легнали настрани, бавно се въртят, с блестящ пръстен.
const itemMeshes = new Map(), itemTpl = new Map();
const ITEM_RING = new THREE.RingGeometry(0.3, 0.46, 24), ITEM_RING_MAT = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
function itemModel(w) {
  let t = itemTpl.get(w); const cos = { knife: 'bayonet', skins: {} };
  if (!t) { t = buildModel(modelIdFor(w, cos), { skin: skinFor(w, cos), step: 2, team: 'att' }); itemTpl.set(w, t); }
  return t.clone();
}
function updateGroundItems(dt) {
  const arr = S.snap?.it || [], seen = new Set(), tm = performance.now() / 1000, k = Math.min(1, dt * 16);
  for (const [id, w, x, y, z, rest] of arr) {
    seen.add(id); let o = itemMeshes.get(id);
    if (!o) {
      const g = new THREE.Group(), spin = new THREE.Group(), m = itemModel(w), ring = new THREE.Mesh(ITEM_RING, ITEM_RING_MAT);
      m.rotation.z = Math.PI / 2; spin.add(m); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.renderOrder = 2; g.add(spin, ring); g.position.set(x, y, z); scene.add(g);
      itemMeshes.set(id, o = { g, spin, ring, w });
    }
    o.g.position.x += (x - o.g.position.x) * k; o.g.position.y += (y - o.g.position.y) * k; o.g.position.z += (z - o.g.position.z) * k;
    o.spin.position.y = rest ? 0.14 + Math.sin(tm * 2 + id) * 0.025 : 0.14; o.spin.rotation.y += dt * (rest ? 1.1 : 9);
    o.ring.material === ITEM_RING_MAT && (o.ring.scale.setScalar(rest ? 1 + Math.sin(tm * 3 + id) * 0.06 : 0.7));
  }
  for (const [id, o] of itemMeshes) if (!seen.has(id)) { scene.remove(o.g); itemMeshes.delete(id); }
}
function clearGroundItems() { for (const o of itemMeshes.values()) scene.remove(o.g); itemMeshes.clear(); }
socket.on('got', () => audio.pickup());
// подсказка „E – вземи …“: има оръжие на земята наблизо, а слотът ти е зает (иначе се взима само при минаване)
// име на мястото, на което е играчът (или наблюдаваният): зоните са в картата (zones: [име, x1, z1, x2, z2])
function updateZoneName() {
  const el = $('#zoneName'); if (!el) return; const zs = S.mapJson?.zones;
  if (!zs || S.mode !== 'comp') { el.style.display = 'none'; return; }
  let x = S.pos.x, z = S.pos.z;
  if (!alive() && S.specId) { const q = poseOf(S.specId, serverNow() - 100); if (q) { x = q.x; z = q.z; } }
  let name = '';
  for (const [n, x1, z1, x2, z2] of zs) if (x >= x1 && x < x2 && z >= z1 && z < z2) { name = n; break; }
  if (!name) { const sites = S.mapJson.sites || {}; for (const k in sites) { const [a, b, c2, d] = sites[k]; if (x >= a && x <= c2 + 1 && z >= b && z <= d + 1) name = 'Точка ' + k; } }
  el.textContent = name; el.style.display = name ? '' : 'none';
}
function updatePickHint() {
  const el = $('#pickHint'); if (!el) return; let best = null;
  if (alive() && S.mode === 'comp' && S.snap?.it?.length && S.me.inv) {
    for (const it of S.snap.it) {
      const sl = WEAPONS[it[1]]?.slot; if (!sl || !S.me.inv[sl]) continue;
      const d = Math.hypot(S.pos.x - it[2], S.pos.z - it[4]);
      if (d < 2.0 && Math.abs(S.pos.y - it[3]) < 1.8 && (!best || d < best.d)) best = { id: it[0], w: it[1], d };
    }
  }
  S.swapHint = best; el.textContent = best ? 'E – вземи ' + WEAPONS[best.w].name : ''; el.style.display = best ? 'block' : 'none';
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
// махане на всички частици/гилзи/трасери (нов рунд, смърт, смяна на камерата) – нищо не остава „висящо“ във въздуха
function clearFx() { for (const f of fx) { scene.remove(f.mesh); if (f.type === 'tracer' || f.type === 'boom') { f.mesh.geometry.dispose(); f.mesh.material.dispose(); } } fx.length = 0; }
function updateFx(dt) {
  if (!(dt > 0) || dt > 1) dt = Math.min(0.05, Math.max(0, dt || 0));      // NaN/скок във времето не бива да „замразява“ живота на частиците
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.life -= dt;
    if (!Number.isFinite(f.mesh.position.x + f.mesh.position.y + f.mesh.position.z)) f.life = 0;
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
const _nv = new THREE.Vector3();
function nadeMesh(k) {
  if (k === 'flash') { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.15, 10), mat(0xb7bcc4)); return m; }
  if (k === 'smoke') { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 10), mat(0x5d7a63)); return m; }
  if (k === 'molo') { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.17, 10), mat(0x6b4524)), (() => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.08, 6), mat(0xdd5a1a)); r.position.y = 0.12; return r; })()); return g; }
  return new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(0x3c9c3c));
}
function updateNades() {
  const snap = S.snap; if (!snap) return;
  const ids = new Set();
  for (const g of snap.gr) {
    ids.add(g.i);
    let m = nadeMeshes.get(g.i);
    if (!m) { m = nadeMesh(g.k); m.position.set(g.x, g.y, g.z); scene.add(m); nadeMeshes.set(g.i, m); }
    m.rotation.x += 0.25; m.rotation.z += 0.12;
    m.position.lerp(_nv.set(g.x, g.y, g.z), 0.6);
  }
  for (const [id, m] of nadeMeshes) if (!ids.has(id)) { scene.remove(m); nadeMeshes.delete(id); }
}

// ================= Димни облаци, пожари, flashbang =================
const smokeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(235,238,240,1)'); gr.addColorStop(0.55, 'rgba(205,210,214,0.75)'); gr.addColorStop(1, 'rgba(190,196,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(150,156,162,' + (0.03 + Math.random() * 0.05) + ')'; g.beginPath(); g.arc(30 + Math.random() * 68, 30 + Math.random() * 68, 8 + Math.random() * 16, 0, 7); g.fill(); }
  return new THREE.CanvasTexture(c);
})();
const smokeObjs = new Map(), fireObjs = new Map();
function makeSmoke(s) {
  const g = new THREE.Group(), sprites = [];
  for (let i = 0; i < 46; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.92, color: 0xd2d6d9, fog: true }));
    const u = Math.random(), v = Math.random() * Math.PI * 2, w = Math.acos(2 * Math.random() - 1), rr = s.r * 0.78 * Math.cbrt(u);
    sp.userData = { d: [Math.sin(w) * Math.cos(v) * rr, Math.abs(Math.cos(w)) * rr * 0.9 + 0.2, Math.sin(w) * Math.sin(v) * rr], size: s.r * (0.75 + Math.random() * 0.55), rot: Math.random() * 6, rs: (Math.random() - 0.5) * 0.25 };
    g.add(sp); sprites.push(sp);
  }
  g.position.set(s.x, s.y, s.z); scene.add(g); return { g, sprites, r: s.r };
}
function makeFire(f) {
  const n = 80, pos = new Float32Array(n * 3), ph = [];
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * f.r; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 2] = Math.sin(a) * r; ph.push(Math.random()); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: flameTexture(), size: 0.8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.8 }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(f.r, 24), new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04;
  const g = new THREE.Group(); g.add(disc, pts); g.position.set(f.x, f.y, f.z); scene.add(g); return { g, pts, disc, ph, base: pos.slice(), r: f.r, n };
}
function updateNadeFx(dt) {
  const snap = S.snap, tms = performance.now() / 1000;
  const sm = new Set(), fr = new Set();
  for (const s of snap?.sm || []) {
    sm.add(s.i); let o = smokeObjs.get(s.i); if (!o) { o = makeSmoke(s); smokeObjs.set(s.i, o); }
    const grow = Math.min(1, s.a / 0.9), e = 1 - (1 - grow) ** 2, fade = Math.min(1, s.tl / 2.5);
    o.sprites.forEach((sp, i) => { const d = sp.userData; sp.position.set(d.d[0] * e, d.d[1] * e, d.d[2] * e); sp.scale.setScalar(d.size * (0.35 + 0.65 * e)); sp.material.rotation = d.rot + tms * d.rs; sp.material.opacity = 0.92 * fade; });
  }
  for (const [id, o] of smokeObjs) if (!sm.has(id)) { scene.remove(o.g); o.sprites.forEach(sp => sp.material.dispose()); smokeObjs.delete(id); }
  for (const f of snap?.fr || []) {
    fr.add(f.i); let o = fireObjs.get(f.i); if (!o) { o = makeFire(f); fireObjs.set(f.i, o); }
    const fade = Math.min(1, f.tl / 1.2), arr = o.pts.geometry.attributes.position.array;
    for (let i = 0; i < o.n; i++) { const t = (tms * (0.7 + (o.ph[i] % 0.5)) + o.ph[i]) % 1; arr[i * 3] = o.base[i * 3] + Math.sin(tms * 3 + i) * 0.05; arr[i * 3 + 1] = t * 1.5 * Math.min(1, f.a / 0.6) + 0.05; arr[i * 3 + 2] = o.base[i * 3 + 2]; }
    o.pts.geometry.attributes.position.needsUpdate = true; o.pts.material.opacity = 0.8 * fade; o.disc.material.opacity = 0.22 * fade * (0.85 + 0.15 * Math.sin(tms * 12));
  }
  for (const [id, o] of fireObjs) if (!fr.has(id)) { scene.remove(o.g); o.pts.geometry.dispose(); fireObjs.delete(id); }
  // вътре в облак дим се вижда почти нищо
  { let inside = 0; for (const s of snap?.sm || []) { const d = Math.hypot(camera.position.x - s.x, camera.position.y - (s.y + 1.2), camera.position.z - s.z), k = Math.max(0, Math.min(1, (s.r * 0.95 - d) / (s.r * 0.45))) * Math.min(1, s.a / 0.8); inside = Math.max(inside, k); } const el2 = $('#smokefx'); if (el2) el2.style.opacity = (inside * 0.96).toFixed(3); }
  // flashbang: бял екран
  const el = $('#flashfx'), f = S.flashFx;
  if (f) { const t = (performance.now() - f.t0) / 1000, d = f.d; if (t >= d) { S.flashFx = null; el.style.opacity = 0; } else el.style.opacity = f.a * (t < 0.3 * d ? 1 : Math.pow(1 - (t - 0.3 * d) / (0.7 * d), 1.4)); }
}
function clearNadeFx() { for (const o of smokeObjs.values()) { scene.remove(o.g); } for (const o of fireObjs.values()) scene.remove(o.g); smokeObjs.clear(); fireObjs.clear(); S.flashFx = null; const el = $('#flashfx'); if (el) el.style.opacity = 0; const e2 = $('#smokefx'); if (e2) e2.style.opacity = 0; }
socket.on('flashed', f => { S.flashFx = { t0: performance.now(), d: f.d, a: Math.max(0.5, f.a) }; audio.flashed?.(f.d, f.a); });
socket.on('smoke', s => audio.smokePop?.([s.x, s.y + 0.3, s.z]));
socket.on('fire', f => audio.molotov?.([f.x, f.y + 0.3, f.z]));
function bombMeshNew() {
  const g = new THREE.Group();
  const body = box(0.5, 0.22, 0.34, mat(0x2d2d2d)); body.position.y = 0.11;
  const led = box(0.1, 0.06, 0.1, new THREE.MeshBasicMaterial({ color: 0xff2020 })); led.position.set(0.12, 0.25, 0);
  g.add(body, led); g.led = led; scene.add(g); return g;
}
let bombMesh = null, dropMesh = null;
// Състояния на бомбата от сървъра: planted (тиктака), defused (обезвредена – без звук), exploded (скрита – без звук)
function updateBomb() {
  const b = S.snap?.bomb, d = S.snap?.bd;
  if (d) { if (!dropMesh) dropMesh = bombMeshNew(); dropMesh.position.set(d.x, d.y, d.z); dropMesh.led.material.color.set((performance.now() % 600) < 200 ? 0xffffff : 0xff2020); }
  else if (dropMesh) { scene.remove(dropMesh); dropMesh = null; }
  const txt = $('#bombTxt');
  if (!b) { if (bombMesh) { scene.remove(bombMesh); bombMesh = null; } txt.textContent = ''; return; }
  if (b.st === 'exploded') {                       // скрий модела, спри звука
    if (bombMesh) { scene.remove(bombMesh); bombMesh = null; }
    txt.style.color = '#ff9a4a'; txt.textContent = 'Бомбата избухна'; return;
  }
  if (!bombMesh) bombMesh = bombMeshNew();
  bombMesh.position.set(b.x, b.y, b.z);
  if (b.st === 'defused') {                        // спри звука, покажи „Обезвредена“
    bombMesh.led.material.color.set(0x35e06a);
    txt.style.color = '#7cf08a'; txt.textContent = 'Обезвредена'; return;
  }
  const iv = b.tl > 20 ? 1.0 : b.tl > 10 ? 0.7 : b.tl > 5 ? 0.4 : b.tl > 2 ? 0.2 : 0.1, now = performance.now() / 1000;
  bombMesh.led.material.color.set((now % iv) < 0.08 ? 0xffffff : 0xff2020);
  if (now - S.lastBeep >= iv) { S.lastBeep = now; audio.beep([b.x, b.y + 0.2, b.z], 1, b.tl < 10); }
  txt.style.color = '#ff5a4a'; txt.textContent = `💣 Бомба на ${b.s}: ${b.tl.toFixed(1)}с`;
}
// ================= HUD помощници =================
let toastT = 0, bannerT = 0;
function toast(t, ms = 2200) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms); }
function banner(html, col, ms = 4000) { const el = $('#banner'); el.innerHTML = html; el.style.color = col; el.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => el.classList.remove('on'), ms); }
const alive = () => S.me.hp > 0;
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
initSkins({ onChange: () => sendLoadout() });
function sendLoadout() { try { const c = JSON.parse(localStorage.getItem('bs_cos') || '{}'); socket.emit('loadout', { knife: c.knife || 'bayonet', skins: c.skins || {}, char: loadChar() }); } catch { } }
initHeroes({ onChange: () => sendLoadout() });

// ================= Мрежови събития =================
socket.on('gameStart', async ({ mapId, mode, changes }) => {
  music.setScene('game'); document.body.classList.add('ingame');
  S.sentReady = false; if (S.locked) { S.sentReady = true; socket.emit('ready'); }
  S.mode = mode || 'comp'; $('#hud').classList.toggle('run', S.mode !== 'comp');
  S.mapReady = (async () => {
    const json = await (await fetch(`/maps/${mapId}.json`)).json();
    S.mapJson = json; S.base = World.fromMap(json); S.world = S.base.clone();
    for (const c of changes) S.world.set(c[0], c[1], c[2], 0);
    buildWorldMesh(S.world); setupMapDecor(json); setupPlatforms(json);
  })();
  await S.mapReady;
  S.inGame = true;
  $('#lobby').classList.add('hidden'); $('#hud').classList.remove('hidden');
  $("#join").classList.add("hidden"); updatePause();
});
socket.on('round', async r => {
  await S.mapReady; S.mode = r.mode || 'comp'; $('#hud').classList.toggle('run', S.mode !== 'comp');
  S.world = S.base.clone(); buildWorldMesh(S.world); markRadarDirty();
  S.specId = null; S.scoped = false; S.shotIdx = 0; S.punch = [0, 0]; S.punchT = [0, 0]; S.pbuf.forEach(b => b.length = 0);
  S.crouching = false; S.crouchAmt = 0; clearNadeFx(); clearFx(); clearGroundItems();
  audio.roundStart();
  if (r.swapped) banner('СМЯНА НА СТРАНИТЕ', '#ffd34d', 3000);
  else toast(`Рунд ${r.n} — натисни B за магазина`, 3000);
});
socket.on('spawn', s => {
  if (s.takeover) { toast('Поемаш управлението на ' + s.takeover, 2500); S.vmSpec = null; S.vmReset = true; S.vmWeapon = null; }
  S.vmReset = !s.quiet; S.pos = { x: s.x, y: s.y, z: s.z }; S.prev = { ...S.pos }; S.vel = { x: 0, y: 0, z: 0 }; S.yaw = s.yw; S.pitch = 0;
  S.onGround = false; S.wasGround = true; S.platform = null; S.groundN = null; S.wjT = 0; S.surfing = false; S.inWater = false;
  if (s.why && WHY[s.why]) toast(WHY[s.why], 1600);
});
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
  if (prev === 'freeze' && s.ph === 'live') toast('Рундът започна!', 1500);
});
socket.on('me', m => { const mag = S.me.mag, same = S.me.w === m.w; S.me = m; if (same && Math.abs(mag - m.mag) === 0) return; });
socket.on('cos', ({ i, cos }) => S.cosById.set(i, cos));
socket.on('cosLeave', id => S.cosById.delete(id));
socket.on('shot', s => {
  const spec = !alive() && s.i === S.specId, mine = s.i === S.id || spec;
  if (spec) { vmod.fire(Date.now()); audio.shot(s.w, null); }
  let a = s.o;
  if (mine) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    a = [camera.position.x + f.x * 0.6 + r.x * 0.18, camera.position.y + f.y * 0.6 - 0.14, camera.position.z + f.z * 0.6 + r.z * 0.18];
  } else {
    const m = models.get(s.i); if (m) m.flashUntil = Date.now() + 60;
    audio.shot(s.w, s.o);
  }
  for (const e of s.e) {
    tracer(a, e); spawnParticles(e[0], e[1], e[2], s.hit ? 0xcc2222 : 0xdddddd, s.hit ? 4 : 2, 2);
    if (!s.hit) { const dx = e[0] - a[0], dy = e[1] - a[1], dz = e[2] - a[2], L = Math.hypot(dx, dy, dz) || 1; addDecal(e, [dx / L, dy / L, dz / L]); }
  }
});
socket.on('knife', k => { if (!alive() && k.i === S.specId) vmod.attack(k.k, Date.now()); const mm = models.get(k.i); if (mm) { mm.swingT = Date.now(); mm.swingKind = k.k; } if (k.i !== S.id) { const p = S.snap?.pl.find(q => q.i === k.i); audio.knife(k.k, k.hit, p ? [p.x, p.y + 1, p.z] : null); } });
socket.on('reload', r => { if (r.i === S.id || (!alive() && r.i === S.specId)) { audio.reload(r.w, null); vmod.reload(r.t, Date.now()); }  else { const p = S.snap?.pl.find(q => q.i === r.i); if (p) audio.reload(r.w, [p.x, p.y + 1, p.z]); } });
socket.on('equip', e => { if (e.i !== S.id) { const p = S.snap?.pl.find(q => q.i === e.i); if (p) audio.equip([p.x, p.y + 1, p.z]); } });
socket.on('throw', t => { const p = S.snap?.pl.find(q => q.i === t.i); audio.nadeThrow(t.i === S.id ? null : p ? [p.x, p.y + 1.2, p.z] : null); });
socket.on('hit', h => { const el = $('#hitmark'); el.className = 'on' + (h.hd ? ' head' : ''); void el.offsetWidth; requestAnimationFrame(() => el.className = h.hd ? 'head' : ''); audio.hit(h.hd); });
socket.on('hurt', h => { const v = $('#vignette'); v.style.transition = 'none'; v.style.opacity = Math.min(1, 0.3 + h.dmg / 60); void v.offsetWidth; v.style.transition = 'opacity .7s'; v.style.opacity = 0; audio.hurt(); });
socket.on('bought', item => { audio.buy(); const sl = WEAPONS[item]?.slot; if (sl === 'pr' || sl === 'se') S.nextFire = Math.max(S.nextFire, Date.now() + CFG.BUY_DELAY); });
// сървърът отказа изстрел/удар: връщаме реалните патрони и времето за изчакване (без призрачни изстрели)
socket.on('denied', d => {
  if (d.w === S.me.w) { S.me.mag = d.mag; S.me.res = d.res; }
  S.nextFire = Math.max(S.nextFire, Date.now() + d.wait); S.shotIdx = Math.max(0, S.shotIdx - 1);
});
socket.on('err', t => toast(t, 1500));
const deathHits = new Map();
socket.on('died', d => { deathHits.set(d.i, { ...d, t: performance.now() }); });
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
socket.on('boom', b => {
  if (b.kind === 'flash') { spawnParticles(b.x, b.y, b.z, 0xffffff, 16, 7); audio.flashBang?.([b.x, b.y, b.z]); return; }
  if (b.kind === 'molotov') { spawnParticles(b.x, b.y, b.z, 0xff8a1e, 18, 6); audio.molotov?.([b.x, b.y, b.z]); return; }
  explosion(b.x, b.y, b.z, b.r, b.big); audio.boom([b.x, b.y, b.z], b.big);
});
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
// Пауза: играта е multiplayer и НЕ спира. Когато мишката се освободи (Esc), персонажът остава на място.
function updatePause() {
  const show = S.inGame && !S.locked && !S.buyOpen;
  $('#pLobby').style.display = S.lobby?.hostId === S.id ? '' : 'none';
  $('#clickplay').classList.toggle('hidden', !show);
  if (show) {
    $('#pauseTitle').textContent = S.everLocked ? 'Пауза' : 'Готов ли си?';
    $('#pauseSub').textContent = S.everLocked ? 'Играта продължава' : 'Натисни „Играй“, за да хванеш мишката';
    $('#playBtn').textContent = S.everLocked ? 'Продължи' : 'Играй';
  }
}
function lockFailed() {   // Chrome не позволява pointer lock веднага след Esc (~1 сек): без грешка, само подканя за клик
  if (S.locked || !S.inGame) return;
  $('#pauseNote').textContent = 'Кликни, за да продължиш';
}
function requestLock() {
  audio.init(); $('#pauseNote').textContent = '';
  try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(lockFailed); } catch { lockFailed(); }
  setTimeout(() => { if (!S.locked) lockFailed(); }, 800);
}
function releaseInputs() { S.firing = false; S.clicked = false; S.rclick = false; S.keys = {}; S.scoped = false; S.jumpAt = 0; }
document.addEventListener('pointerlockchange', () => {
  const was = S.locked; S.locked = document.pointerLockElement === canvas;
  releaseInputs();
  if (S.locked) { S.everLocked = true; $('#pauseNote').textContent = ''; if (!S.sentReady) { S.sentReady = true; socket.emit('ready'); } }
  else { S.boardOpen = false; if (was) socket.emit('use', false); }
  updatePause();
});
document.addEventListener('pointerlockerror', lockFailed);
addEventListener('blur', () => { releaseInputs(); socket.emit('use', false); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseInputs(); socket.emit('use', false); } });
$('#clickplay').style.pointerEvents = 'auto';
$('#playBtn').onclick = e => { e.stopPropagation(); requestLock(); };
$('#clickplay').onclick = e => { if (e.target.closest('button, select, input, label, a')) return; requestLock(); };
$('#pBoard').onclick = () => { S.boardPinned = !S.boardPinned; $('#board').classList.toggle('pin', S.boardPinned); if (!S.boardPinned) $('#board').classList.add('hidden'); };
$('#board').addEventListener('click', e => { const b = e.target.closest('[data-vm]'); if (b) { voice.toggleMute(b.dataset.vm); b.textContent = voice.isMuted(b.dataset.vm) ? '🔇' : '🔈'; } });
function askConfirm(title, text, onYes) {
  $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirm').classList.remove('hidden');
  $('#confirmYes').onclick = () => { $('#confirm').classList.add('hidden'); onYes(); };
  $('#confirmNo').onclick = () => $('#confirm').classList.add('hidden');
}
$('#pLeave').onclick = () => askConfirm('Сигурен ли си?', 'Ще напуснеш стаята и ще се върнеш в главното меню.', leaveRoom);

document.addEventListener('mousemove', e => {
  if (!S.locked) return;
  const k = S.scoped ? 0.35 : 1, sens = 0.0022 * settings.sens * k;
  S.mdx += e.movementX; S.mdy += e.movementY;
  S.yaw -= e.movementX * sens;
  S.pitch = clamp(S.pitch - e.movementY * sens * (settings.invert ? -1 : 1), -1.5, 1.5);
});
document.addEventListener('mousedown', e => {
  if (!S.locked) return;
  if (e.button === 0) { S.firing = true; S.clicked = true; if (!alive()) cycleSpec(); }
  if (e.button === 2) { S.rclick = true; if (alive() && WEAPONS[S.me.w]?.scoped) S.scoped = !S.scoped; }
});
document.addEventListener('mouseup', e => { if (e.button === 0) S.firing = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => {
  if (!S.locked || !alive()) return;
  const order = ['pr', 'se', 'kn', 'n'].filter(s => s === 'n' ? S.me.inv.n > 0 : s === 'kn' ? true : S.me.inv[s]);
  const cur = order.indexOf(WEAPONS[S.me.w]?.slot);
  const next = order[(cur + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length]; if (next) switchSlot(next);
});
// След смяна на оръжие сървърът блокира стрелбата за CFG.SWITCH_DELAY мс; клиентът знае същото забавяне (няма „призрачни“ изстрели).
function switchSlot(s) {
  const inv = S.me.inv, target = s === 'pr' ? inv.pr : s === 'se' ? inv.se : s === 'kn' ? 'knife' : (inv.n > 0 ? 'nade' : null);
  if (target && (target === 'nade' || target !== S.me.w)) S.nextFire = Math.max(S.nextFire, Date.now() + CFG.SWITCH_DELAY);
  S.scoped = false; S.shotIdx = 0; socket.emit('switch', s);
}
const GAME_KEYS = new Set(['Backspace', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyE', 'KeyF', 'KeyG', 'KeyB', 'KeyC', 'Space', 'Tab', ...Array.from({ length: 10 }, (_, i) => 'Digit' + i), 'Minus']);
// Купуване: във freeze и първите CFG.BUY_TIME сек след него, само в зоната около spawn-а на отбора
function canBuy() {
  const s = S.snap; if (!s || !alive()) return false;
  if (s.ph === 'freeze') return true;
  if (s.ph === 'live' && S.mapJson) return S.me.bt > 0 && inBuyZone(S.mapJson.spawns[S.me.tm], S.pos.x, S.pos.z);
  return false;
}
addEventListener('keydown', e => {
  if (S.chatOpen) return;
  if (!S.inGame) return;
  // Ctrl/Cmd + игрова клавиш не бива да задейства браузърни команди (Ctrl+D отметка, Ctrl+S запазване, Ctrl+A маркиране…)
  if (S.locked && (e.ctrlKey || e.metaKey) && GAME_KEYS.has(e.code)) e.preventDefault();
  if (S.buyOpen && !S.locked && (e.code === 'KeyB' || e.code === 'Escape')) { e.preventDefault(); closeBuy(); return; }
  if (!S.locked) return;
  if (e.code === 'Tab') { e.preventDefault(); S.boardOpen = true; return; }
  if (e.repeat) { if (e.code === 'Space' || e.code.startsWith('Control')) e.preventDefault(); return; }
  S.keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); S.jumpAt = performance.now(); }
  if (e.code === 'KeyB' && S.mode === 'comp') { if (S.buyOpen) closeBuy(); else if (canBuy()) openBuy(); }
  if (e.code === 'Digit1') switchSlot('pr'); if (e.code === 'Digit2') switchSlot('se'); if (e.code === 'Digit3') switchSlot('kn'); if (e.code === 'Digit4') switchSlot('n');
  if (e.code === 'KeyR') socket.emit(S.mode === 'comp' ? 'reload' : 'cp');        // в parkour/surf R = към последния checkpoint
  if (e.code === 'Backspace') { e.preventDefault(); if (S.mode !== 'comp') socket.emit('restart'); }
  if (e.code === 'KeyE') S.eT = performance.now();
  if (e.code === 'KeyE') { if (!alive() && S.mode === 'comp' && S.specId && String(S.specId).startsWith('bot')) socket.emit('takeover', S.specId); else socket.emit('use', true); }
  if (e.code === 'KeyG' && alive() && !e.repeat) socket.emit('dropw');          // хвърля оръжието в ръката (или бомбата, ако в ръката няма оръжие)
  if (e.code === 'KeyF' && alive() && !S.me.rl && S.phase !== 'lobby') vmod.inspect(Date.now());
  if (e.code.startsWith('Control') || e.code === 'KeyC') e.preventDefault();
});
addEventListener('keyup', e => {
  if (S.chatOpen) return;
  S.keys[e.code] = false;
  if (e.code === 'Tab') { S.boardOpen = false; if (!S.boardPinned) $('#board').classList.add('hidden'); }
  if (e.code === 'KeyE') { socket.emit('use', false); if (S.swapHint && alive() && performance.now() - (S.eT || 0) < 300) socket.emit('swap', S.swapHint.id); }   // кратко E = размяна; дълго = залагане/обезвреждане
});
// ----- музика: браузърите блокират autoplay – започва при първо кликване/клавиш -----
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => music.unlock(), { once: false, capture: true, passive: true });
window.__music = music;
// ================= Гласов чат (push-to-talk) =================
const voice = initVoice({
  socket, settings,
  getMyId: () => S.id, getPlayers: () => S.lobby?.players || [],
  // право на говорене: в рунд (състезателен режим) само със съотборниците, иначе с всички
  canTalk: id => { const pl = S.lobby?.players || [], me = pl.find(p => p.id === S.id), o = pl.find(p => p.id === id); if (!me || !o) return false; return !S.inGame || S.mode !== 'comp' || me.team === o.team; },
  onChange: () => { renderTalk(); if (S.lobby && !S.inGame) onLobby(S.lobby); },
  onError: m => toast(m, 2500),
});
function renderTalk() {
  const el = $('#talkHud'); if (!el) return; el.textContent = '';
  for (const id of voice.talkers()) { const nm = (S.lobby?.players || []).find(p => p.id === id)?.name; if (!nm) continue; const d = document.createElement('div'); d.textContent = '🔊 ' + (id === S.id ? 'Ти говориш' : nm); el.append(d); }
  el.classList.toggle('hidden', !el.children.length);
}
function pttKey(e) { return e.code === settings.pttKey && !e.repeat && !S.chatOpen && S.id && (S.inGame || !$('#lobby').classList.contains('hidden')) && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || ''); }
addEventListener('keydown', e => { if (pttKey(e)) { e.preventDefault(); voice.setPtt(true); } });
addEventListener('keyup', e => { if (e.code === settings.pttKey) voice.setPtt(false); });
addEventListener('blur', () => voice.setPtt(false));
socket.on('disconnect', () => voice.closeAll());
setInterval(() => voice.applyPolicy(), 1500);          // следи смяна на отбор / фаза
window.__voice = voice;
$('#setMic')?.addEventListener('change', () => voice.setMic($('#setMic').value));
$('#setVoice')?.addEventListener('change', () => { voice.sync(); });
$('#setVoiceVol')?.addEventListener('input', () => voice.applyPolicy());
// ================= Текстов чат =================
// Enter / Y – до всички, U – само до отбора, Esc – затваря. Докато пишеш, клавишите за игра не работят. Текстът се показва само чрез textContent (без HTML).
const chatEl = $('#chat'), chatLog = $('#chatLog'), chatBox = $('#chatBox'), chatInput = $('#chatInput'), chatTag = $('#chatTag');
function chatInRoom() { return !!S.id && (S.inGame || !$('#lobby').classList.contains('hidden')); }
function openChat(team) {
  if (!chatInRoom() || S.chatOpen) return;
  S.chatOpen = true; S.chatTeam = !!team && S.mode === 'comp'; releaseInputs(); S.buyOpen && closeBuy();
  chatTag.textContent = S.chatTeam ? 'Отбор' : 'Всички'; chatTag.style.color = S.chatTeam ? '#7cf08a' : '#fff';
  chatEl.classList.add('open'); chatBox.classList.remove('hidden'); chatInput.value = ''; chatInput.focus(); chatRefresh();
}
function closeChat() { if (!S.chatOpen) return; S.chatOpen = false; chatEl.classList.remove('open'); chatBox.classList.add('hidden'); chatInput.blur(); chatInput.value = ''; chatRefresh(); }
function sendChat() { const t = chatInput.value.trim(); if (t) socket.emit('chat', { t: t.slice(0, CFG.CHAT_MAX), team: S.chatTeam }); closeChat(); }
function addChatLine(m) {
  const d = document.createElement('div'); d.className = 'chatline'; d._t = Date.now();
  const tg = document.createElement('span'); tg.className = 'tg'; tg.textContent = m.team ? '[отбор]' : '[всички]';
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = m.n + ': '; nm.style.color = TEAM_COL[m.tm] || '#fff';
  const tx = document.createElement('span'); tx.textContent = m.t;
  d.append(tg, nm, tx); chatLog.append(d); while (chatLog.children.length > 80) chatLog.firstChild.remove();
  chatLog.scrollTop = chatLog.scrollHeight; chatRefresh();
}
function chatRefresh() {
  const now = Date.now(); let any = false;
  for (const d of chatLog.children) { const old = now - d._t > 8000; d.classList.toggle('old', old); if (!old) any = true; }
  chatEl.classList.toggle('hidden', !(S.chatOpen || any));
  chatEl.classList.toggle('lobby', !S.inGame);
}
setInterval(chatRefresh, 400);
socket.on('chat', addChatLine);
addEventListener('keydown', e => {
  if (!chatInRoom()) return;
  if (S.chatOpen) { if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); sendChat(); } else if (e.code === 'Escape') closeChat(); return; }
  const a = document.activeElement; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyY') { e.preventDefault(); openChat(false); }
  else if (e.code === 'KeyU') { e.preventDefault(); openChat(true); }
});
function openBuy() { S.buyOpen = true; S.buySig = ''; $('#buy').classList.remove('hidden'); renderBuy(); releaseInputs(); socket.emit('use', false); if (document.pointerLockElement) document.exitPointerLock(); updatePause(); }
function closeBuy() { const was = S.buyOpen; S.buyOpen = false; $('#buy').classList.add('hidden'); if (was && S.inGame && !S.locked) requestLock(); updatePause(); }
// Магазин: главна страница (любимо основно, любим пистолет, любим комплект, категории); цифрите избират, 0 е „назад“
const GEAR = [['armor', 'Броня', 650], ['kit', 'Defuse kit', 400]];
const NADE_NAMES = { he: 'Граната (HE)', flash: 'Flashbang', smoke: 'Димна граната', molo: 'Молотов' };
function buyOwn(id) {
  const m = S.me, g = m.inv.g || {};
  if (id === 'armor') return m.ar >= 100; if (id === 'kit') return !!m.kit;
  if (NADE_IDS.includes(id)) { const k = { grenade: 'he', flash: 'flash', smoke: 'smoke', molotov: 'molo' }[id]; return k === 'flash' ? g.flash >= 2 : g[k] >= 1; }
  return m.inv[WEAPONS[id]?.slot] === id;
}
function buyPrice(id) { return id === 'armor' ? 650 : id === 'kit' ? 400 : NADE_IDS.includes(id) ? nadePrice(id, S.me.tm) : WEAPONS[id].price; }
function buyPages() {
  const team = S.me.tm, pages = { top: [] };
  for (const c of BUY_CATS) pages[c.id] = weaponsOfCat(c, team).map(id => ({ id, label: WEAPONS[id].name }));
  pages.gear = [{ id: 'armor', label: 'Броня' }, ...(team === 'def' ? [{ id: 'kit', label: 'Defuse kit' }] : [])];
  pages.nade = ['grenade', 'flash', 'smoke', 'molotov'].map(id => ({ id, label: WEAPONS[id].name }));
  // колони като в CS2: 1 екипировка, 2 пистолети, 3 средна класа, 4 автомати, 5 гранати
  pages.cols = [{ page: 'gear', label: 'Екипировка' }, ...BUY_CATS.map(c => ({ page: c.id, label: c.label })), { page: 'nade', label: 'Гранати' }];
  return pages;
}
function renderBuy() {
  const m = S.me, pages = buyPages(), g = m.inv.g || {};
  const sig = [m.mo, m.ar, m.kit, m.inv.pr, m.inv.se, m.inv.n, g.he, g.flash, g.smoke, g.molo, m.tm].join('|');
  if (S.buySig === sig) return; S.buySig = sig;                                // не пре-рисуваме без промяна (иначе кликовете се губят)
  const btn = it => {
    const own = buyOwn(it.id), price = buyPrice(it.id), blocked = NADE_IDS.includes(it.id) && !own && m.inv.n >= CFG.MAX_NADES, off = m.mo < price || own || blocked;
    return `<button class="bw ${off ? 'no' : ''}" data-buy="${it.id}" type="button"><img src="${weaponIcon(it.id)}" alt=""><b>${it.label}</b><span>${own ? '<em>имаш</em>' : '$' + price}</span></button>`;
  };
  $('#buyList').innerHTML = `<div class="buyrow"><span>Пари</span><b>$${m.mo}</b></div><div class="buycols">` +
    pages.cols.map(c => `<div class="buycol"><h4>${c.label}</h4>${(pages[c.page] || []).map(btn).join('')}</div>`).join('') + '</div>';
}
$('#buyList').addEventListener('click', e => { const b = e.target.closest('[data-buy]'); if (b && !b.classList.contains('no')) { socket.emit('buy', b.dataset.buy); } });

// ================= Физика на играча: споделеното ядро shared/physics.js (CS2: ускорение, триене, air strafing, bhop; вода, рампи, платформи) =================
function readInput() {
  const can = S.locked && alive() && S.phase !== 'lobby' && S.phase !== 'freeze';   // във freeze (купуване) – само оглеждане
  let fx = 0, fz = 0;
  if (can) { fx = (S.keys.KeyD ? 1 : 0) - (S.keys.KeyA ? 1 : 0); fz = (S.keys.KeyS ? 1 : 0) - (S.keys.KeyW ? 1 : 0); }
  const jumpNow = !!(can && S.jumpAt && performance.now() - S.jumpAt < 130);   // малък буфер преди приземяване (без автоматичен bhop)
  return { can, fx, fz, crouch: can && !!(S.keys.ControlLeft || S.keys.ControlRight || S.keys.KeyC), walk: can && !!(S.keys.ShiftLeft || S.keys.ShiftRight), jumpNow, jumpHeld: can && !!S.keys.Space };
}
function physEmit(name, d) {
  if (name === 'jump') audio.jump(null, d.surface);
  else if (name === 'land') audio.land(null, d.strength, d.surface);
  else if (name === 'step') audio.footstep(d.surface, null, 0.5);
  else if (name === 'bounce') audio.bounce?.();
  else if (name === 'waterjump') audio.footstep('water', null, 1);
}
const NO_PLATFORMS = [];
function stepPhysics(inp, simT) {
  const wdef = WEAPONS[S.me.w];
  let vmax = wdef?.speed ?? 6.25; if (S.scoped && wdef?.scoped) vmax = wdef.scoped;
  const plats = S.platDefs.length ? platformsAt(S.platDefs, simT, MOVE.STEP) : NO_PLATFORMS;
  S.platsNow = plats;
  stepBody(S, inp, { world: S.world, bsp: S.bsp, vmax, mode: S.mode, platforms: plats, drive: S.mapJson?.drive, emit: physEmit }, MOVE.STEP);
  if (S.jumped) S.jumpAt = 0;
}

// движещи се платформи (parkour): мешове от блокове, позицията идва от същата функция като в симулацията
const platMeshes = [];
function setupPlatforms(json) {
  for (const r of platMeshes) { r.clear(); scene.remove(r.group); }
  platMeshes.length = 0; S.platDefs = json?.platforms || [];
  for (const def of S.platDefs) {
    const w = new World(def.size[0], def.size[1], def.size[2]); w.data.fill(BLOCK[def.block || 'metal']);
    const r = new WorldRenderer(scene, atlas); r.load(w, { ambient: 0.6, sun: 1 }); platMeshes.push(r);
  }
}
function updatePlatformMeshes() {
  for (let i = 0; i < platMeshes.length; i++) { const q = S.platsNow[i]; if (q) platMeshes[i].group.position.set(q.min[0], q.min[1], q.min[2]); }
}

setInterval(() => {
  if (S.inGame && alive() && S.phase !== 'lobby' && !S.noSend) {
    const moving = S.speed > 0.5;
    socket.emit('state', { x: S.pos.x, y: S.pos.y, z: S.pos.z, yw: S.yaw, pt: S.pitch, cr: S.crouching, g: S.onGround, wk: moving && !!(S.keys.ShiftLeft || S.keys.ShiftRight), sc: S.scoped, tk: S.tick });
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
  if (NADE_IDS.includes(m.w)) {
    if (clicked && m.mag > 0) { socket.emit('throw', { yw: S.yaw, pt: S.pitch + S.punch[1] }); S.nextFire = now + 700; vmod.cancelInspect(); }
    return;
  }
  if (!w.auto && !clicked) return;
  if (m.rl) return;
  if (m.mag <= 0) { if (clicked) audio.empty(); S.nextFire = now + 250; return; }
  S.nextFire = now + w.rate * 1000;
  m.mag--;
  fireTiming(now, w);
  const idx = S.shotIdx;   // същият индекс, който сървърът ползва за този куршум (recoilAt(p.shotIdx) преди увеличаването)
  socket.emit('shoot', { yw: S.yaw, pt: S.pitch, sc: S.scoped ? 1 : 0, d: Math.round(100 + S.ping) });
  const [ry, rp] = recoilAt(m.w, idx); S.punchT = [ry, rp]; S.punch = [ry, rp];
  S.shotIdx = idx + 1; S.lastShotT = now;
  S.kick = 1;
  const cs = vmod.fire(now); if (cs) spawnCasing(cs);
  audio.shot(m.w, null);
  if (!WEAPONS[m.w]?.scoped) S.scoped = false;
}

// ================= Наблюдение =================
function setSpec(id) { if (S.specId !== id) { S.specId = id; socket.emit('spec', id); } }
function cycleSpec() {
  const mates = S.snap?.pl.filter(p => p.al && p.tm === S.me.tm && p.i !== S.id) || [];
  if (!mates.length) { setSpec(null); return; }
  const i = mates.findIndex(p => p.i === S.specId);
  setSpec(mates[(i + 1) % mates.length].i);
}

// ================= Главен цикъл =================
const _lf = new THREE.Vector3();
// ---- панел за производителност (F3): FPS, време на кадър по части, draw calls, триъгълници ----
renderer.info.autoReset = false;
const perf = { raf: 0, on: false, el: null, sum: [0, 0, 0, 0], max: 0, n: 0, t: 0 };
addEventListener('keydown', e => {
  if (e.code !== 'F3') return; e.preventDefault(); perf.on = !perf.on;
  if (!perf.el) { perf.el = document.createElement('pre'); perf.el.style.cssText = 'position:fixed;left:8px;top:150px;z-index:20;margin:0;padding:6px 8px;background:rgba(0,0,0,.7);color:#9dffb0;font:12px/1.35 Consolas,monospace;pointer-events:none;white-space:pre'; document.body.appendChild(perf.el); }
  perf.el.style.display = perf.on ? '' : 'none';
});
function perfReport(dt) {
  if (!perf.on) return; perf.t += dt; if (perf.t < 0.5) return;
  const n = Math.max(1, perf.n), a = perf.sum.map(v => (v / n).toFixed(2)), i = renderer.info;
  perf.el.textContent = [
    `FPS ${fpsShown}   кадър (CPU) ${a[3]} мс  (макс ${perf.max.toFixed(1)})   браузърът дава кадри на ≈ ${perf.raf ? Math.round(1000 / perf.raf) : '?'} Hz (лимит в играта: ${settings.fpsLimit || 'няма'})`,
    `  логика+модели ${a[0]} мс   сцена ${a[1]} мс   оръжие+HUD ${a[2]} мс`,
    `draw calls ${i.render.calls}   триъгълници ${(i.render.triangles / 1000).toFixed(1)}k   точки ${i.render.points}`,
    `геометрии ${i.memory.geometries}   текстури ${i.memory.textures}   чънкове ${worldR.chunks.size}   играчи ${models.size}   pixelRatio ${pixelRatio.toFixed(2)}`,
  ].join('\n');
  perf.sum = [0, 0, 0, 0]; perf.max = 0; perf.n = 0; perf.t = 0;
}
let last = performance.now(), hudT = 0, fpsAcc = 0, fpsN = 0, fpsShown = 0;
let lastRender = 0, lastRaf = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  if (lastRaf) { const d = nowMs - lastRaf; if (d > 0 && d < 200) perf.raf = perf.raf ? perf.raf * 0.97 + d * 0.03 : d; } lastRaf = nowMs;       // реалният интервал между кадрите на браузъра (= честотата на екрана, когато няма лимит)
  if (settings.fpsLimit && nowMs - lastRender < 1000 / settings.fpsLimit - 0.6) return;   // лимит на FPS (0 = без лимит)
  lastRender = nowMs;
  const dt = Math.min(0.05, Math.max(0, (nowMs - last) / 1000)); last = nowMs;
  fpsAcc += dt; fpsN++; S.frames = (S.frames || 0) + 1;
  if (fpsAcc >= 1) { fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; adaptQuality(fpsShown); }
  if (!S.inGame) { menuFrame(dt, Date.now()); return; }
  if (!S.world) { renderer.render(scene, camera); return; }
  const now = Date.now(), pf0 = performance.now(); renderer.info.reset();

  // фиксирана стъпка 64 Hz
  const inp = readInput();
  S.acc += dt;
  let simT = serverNow() / 1000 - S.acc;
  while (S.acc >= MOVE.STEP) { S.prev.x = S.pos.x; S.prev.y = S.pos.y; S.prev.z = S.pos.z; simT += MOVE.STEP; stepPhysics(inp, simT); S.tick++; S.acc -= MOVE.STEP; }
  updatePlatformMeshes();
  const al = S.acc / MOVE.STEP;
  tryFire(now);
  // откат: мерникът се връща към центъра, когато спреш да стреляш
  const wd = WEAPONS[S.me.w];
  if (wd?.rreset && now - S.lastShotT > wd.rreset * 1000) { S.shotIdx = 0; S.punchT = [0, 0]; }
  S.punch[0] += (S.punchT[0] - S.punch[0]) * Math.min(1, dt * 14); S.punch[1] += (S.punchT[1] - S.punch[1]) * Math.min(1, dt * 14);
  S.kick = Math.max(0, S.kick - dt * 9);
  updateModels(dt); updateNades(); updateNadeFx(dt); updateDecals(dt); updateBomb(); updateFx(dt); updateGroundItems(dt);
  if (flames) flames.material.size = 0.85 + Math.sin(now / 90) * 0.1 + Math.sin(now / 37) * 0.05;

  // камера
  const isAlive = alive(), dbg = S.debugCam;
  let cp, cyaw, cpitch;
  const eyeY = MOVE.EYE_STAND + (MOVE.EYE_CROUCH - MOVE.EYE_STAND) * (S.crouchAmt * S.crouchAmt * (3 - 2 * S.crouchAmt));
  if (isAlive) {
    cp = [S.prev.x + (S.pos.x - S.prev.x) * al, S.prev.y + (S.pos.y - S.prev.y) * al + eyeY, S.prev.z + (S.pos.z - S.prev.z) * al];
    cyaw = S.yaw + S.punch[0]; cpitch = S.pitch + S.punch[1];
    if (S.specId) setSpec(null);
    if (S.vmSpec) { S.vmSpec = null; S.vmReset = true; }
  } else {
    if (!S.specId || !S.snap?.pl.find(p => p.i === S.specId && p.al)) cycleSpec();
    const pose = S.specId ? poseOf(S.specId, serverNow() - 100) : null;
    if (pose) {
      // гледаме през очите на наблюдавания: плавно клякане, скорост за люлеенето на оръжието
      S.specCr += ((pose.cr ? 1 : 0) - S.specCr) * Math.min(1, dt * 12);
      const ey = MOVE.EYE_STAND + (MOVE.EYE_CROUCH - MOVE.EYE_STAND) * (S.specCr * S.specCr * (3 - 2 * S.specCr));
      cp = [pose.x, pose.y + ey, pose.z]; cyaw = pose.yw; cpitch = pose.pt;
      if (S.specLast) { const dd = Math.hypot(pose.x - S.specLast[0], pose.z - S.specLast[1]); S.specSpeed += (Math.min(9, dd / Math.max(dt, 0.001)) - S.specSpeed) * Math.min(1, dt * 8); } S.specLast = [pose.x, pose.z];
      S.specG = !!pose.g;
    } else { cp = [S.pos.x, S.pos.y + 1.0, S.pos.z]; cyaw = S.yaw; cpitch = S.pitch; S.specLast = null; }
  }
  const specT = !isAlive && S.specId ? S.snap?.pl.find(q => q.i === S.specId && q.al) : null;
  if (dbg) { cp = [dbg.x, dbg.y, dbg.z]; cyaw = dbg.yaw; cpitch = dbg.pitch; }
  const sh = S.shake || 0; S.shake = Math.max(0, sh - dt * 0.8);
  camera.position.set(cp[0] + (Math.random() - .5) * sh, cp[1] + (Math.random() - .5) * sh, cp[2] + (Math.random() - .5) * sh);
  camera.rotation.set(cpitch, cyaw, 0); updateSky(dt);
  const spd3 = Math.hypot(S.vel.x, S.vel.y, S.vel.z), fast = clamp((spd3 - 12) / 40, 0, 1);
  const specScoped = !!(specT && specT.sc && WEAPONS[specT.w]?.scoped);
  const zoomW = specScoped && !isAlive ? specT.w : S.me.w, targetFov = (S.scoped && isAlive) || specScoped ? (WEAPONS[zoomW]?.zoom || 22) : settings.fov + (isAlive ? fast * 14 : 0);
  audio.setWind(isAlive ? fast : 0);
  if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
  const fwd = _lf.set(0, 0, -1).applyQuaternion(camera.quaternion);
  audio.setListener(camera.position.x, camera.position.y, camera.position.z, fwd.x, fwd.y, fwd.z);

  // viewmodel (отделна сцена, не влиза в стени)
  const myCos = S.cosById.get(S.id);
  if (isAlive && !S.debugVM && (S.vmWeapon !== S.me.w || S.vmReset || S.vmTeam !== S.me.tm)) { S.vmWeapon = S.me.w; S.vmReset = false; S.vmTeam = S.me.tm; vmod.setWeapon(S.me.w, myCos, S.me.tm, now); S.inspect = 0; }
  // оръжие на наблюдавания играч/бот – както го вижда той
  if (specT && !S.debugVM && (S.vmWeapon !== specT.w || S.vmSpec !== specT.i || S.vmTeam !== specT.tm)) { S.vmWeapon = specT.w; S.vmSpec = specT.i; S.vmTeam = specT.tm; vmod.setWeapon(specT.w, S.cosById.get(specT.i), specT.tm, now); }
  vmod.visible = (isAlive ? !S.scoped : !!specT && !specScoped) && (!dbg || S.debugVM);
  vmod.update(dt, now, isAlive || !specT ? { speed: S.speed, onGround: S.onGround, crouchAmt: S.crouchAmt, mdx: S.mdx, mdy: S.mdy } : { speed: S.specSpeed, onGround: S.specG, crouchAmt: S.specCr, mdx: 0, mdy: 0 });
  S.mdx = 0; S.mdy = 0;
  $('#scope').style.display = ((S.scoped && isAlive) || specScoped) && !WEAPONS[zoomW]?.zoom ? 'block' : 'none';
  $('#cross').style.display = (S.scoped && isAlive) || specScoped || (!isAlive && !specT) ? 'none' : '';

  const pf1 = performance.now();
  renderer.render(scene, camera);
  const pf2 = performance.now();
  vmod.render(renderer);
  if (!S.bsp && now - (S.radarT || 0) > 33) { S.radarT = now; const f = isAlive ? { x: S.pos.x, z: S.pos.z, yaw: S.yaw } : (S.specId && poseOf(S.specId, serverNow() - 100)) ? (() => { const q = poseOf(S.specId, serverNow() - 100); return { x: q.x, z: q.z, yaw: q.yw }; })() : { x: S.pos.x, z: S.pos.z, yaw: S.yaw }; drawRadar($('#radar'), S, atlas, f, TEAM_COL); }

  hudT += dt; if (hudT > 0.05) { hudT = 0; updateHud(); updatePickHint(); updateZoneName(); }
  { const pf3 = performance.now(); perf.sum[0] += pf1 - pf0; perf.sum[1] += pf2 - pf1; perf.sum[2] += pf3 - pf2; perf.sum[3] += pf3 - pf0; perf.max = Math.max(perf.max, pf3 - pf0); perf.n++; perfReport(dt); }
}
requestAnimationFrame(frame); window.__frame = frame; window.__vm = vmod; window.__socket = socket; window.__renderer = renderer;

// динамично намаляване на разделителната способност при ниски FPS
let lowCount = 0, highCount = 0;
function adaptQuality(fps) {
  if (!S.inGame) return;
  if (fps < 38) { lowCount++; highCount = 0; } else if (fps > 58) { highCount++; lowCount = 0; } else { lowCount = 0; highCount = 0; }
  if (lowCount >= 3 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.2); resize(); lowCount = 0; }
  else if (highCount >= 8 && pixelRatio < maxPR()) { pixelRatio = Math.min(maxPR(), pixelRatio + 0.1); resize(); highCount = 0; }
}

function inSite() {
  if (!S.mapJson) return null;
  for (const [n, [x1, z1, x2, z2]] of Object.entries(S.mapJson.sites)) if (S.pos.x >= x1 && S.pos.x <= x2 + 1 && S.pos.z >= z1 && S.pos.z <= z2 + 1) return n;
  return null;
}
let crossGap = 6;
function updateHud() {
  const s = S.snap, m0 = S.me; if (!s) return;
  if (S.mode !== 'comp') return updateRunHud(s, m0);
  // мъртъв: HP/броня/патрони/оръжие са на наблюдавания (сървърът ги праща в me.sp)
  const sp0 = !alive() && m0.sp ? m0.sp : null, m = sp0 ? { ...m0, hp: sp0.hp, ar: sp0.ar, w: sp0.w, mag: sp0.mag, res: sp0.res, rl: sp0.rl, kit: sp0.kit, inv: { ...m0.inv, bomb: sp0.bomb, g: sp0.g || {}, n: 0 } } : m0;
  $('#scoreAtt').textContent = s.sc.att; $('#scoreDef').textContent = s.sc.def;
  $('#timer').textContent = s.bomb && s.bomb.st === 'planted' ? '💣' : fmt(s.tl);
  const buyLeft = m.bt;
  let ph = s.ph === 'freeze' ? (s.tl <= 0 ? `Изчакване на играчите…  •  Рунд ${s.rd}` : `Купуване: ${Math.ceil(s.tl)}с  •  Рунд ${s.rd}`) : `Рунд ${s.rd}  •  ${m.tm === 'att' ? 'Нападател' : 'Защитник'}`;
  if (s.ph === 'live' && alive() && canBuy()) ph += `  •  Купуване (B): ${buyLeft}с`;
  $('#phaseTxt').textContent = ph;
  $('#phaseTxt').style.color = TEAM_COL[m.tm];
  $('#money').textContent = m0.mo;
  $('#hp b').textContent = Math.max(0, m.hp); $('#ar b').textContent = m.ar;
  const w = WEAPONS[m.w]; $('#wname').textContent = (w?.name || '') + (m.rl ? ' — презарежда…' : '');
  const noAmmo = m.w === 'knife';
  $('#ammo').style.visibility = noAmmo ? 'hidden' : 'visible';
  $('#ammo b').textContent = m.mag; $('#ammo span').textContent = NADE_IDS.includes(m.w) ? '' : ' / ' + m.res;
  { const g = m.inv.g || {}, nd = [g.he ? 'HE×' + g.he : '', g.flash ? '⚡×' + g.flash : '', g.smoke ? '☁×' + g.smoke : '', g.molo ? '🔥×' + g.molo : ''].filter(Boolean).join(' ');
    $('#items').textContent = m.kit ? '🔧 Defuse kit' : ''; }
  renderWpanel(m);
  const us = m.us;
  $('#useBar').classList.toggle('hidden', !us);
  if (us) { const nt = performance.now(); if (nt >= (S.useTickT || 0)) { S.useTickT = nt + (us.k === 'plant' ? 500 : 800); (us.k === 'plant' ? audio.plantTick : audio.defuseTick)(null); } } else S.useTickT = 0;
  if (us) { $('#useBar div').style.width = (us.p * 100) + '%'; $('#useBar span').textContent = us.k === 'plant' ? 'Залагане на бомбата…' : 'Обезвреждане…'; }
  let hint = '';
  const planted = s.bomb && s.bomb.st === 'planted';
  if (alive()) {
    if (s.ph === 'freeze') hint = 'Натисни B за магазина';
    else if (s.ph === 'live' && m.tm === 'att' && m.inv.bomb && !s.bomb && inSite()) hint = `Дръж E, за да заложиш бомбата (${inSite()})`;
    else if (s.ph === 'live' && m.tm === 'att' && m.inv.bomb && !s.bomb) hint = 'Носиш бомбата – иди на A или B';
    else if (s.ph === 'live' && m.tm === 'def' && planted && Math.hypot(S.pos.x - s.bomb.x, S.pos.z - s.bomb.z) < 2.4) hint = `Дръж E, за да обезвредиш бомбата (${m.kit ? '5' : '10'}с)`;
  }
  if (!alive() && S.specId && String(S.specId).startsWith('bot') && s.ph === 'live') hint = 'Натисни E, за да поемеш управлението на бота';
  $('#hint').textContent = us ? '' : hint;
  const sp = $('#spec'); sp.classList.toggle('hidden', alive() || s.ph === 'lobby');
  if (!alive()) { const t = s.pl.find(p => p.i === S.specId), bot = t && String(t.i).startsWith('bot'); sp.textContent = t ? `Наблюдаваш: ${t.n} (клик – следващ)` + (bot && s.ph === 'live' ? '  •  E – поеми управлението на бота' : '') : 'Мъртъв си'; }
  if (S.buyOpen) { if (!canBuy()) closeBuy(); else renderBuy(); }
  if (S.boardOpen || S.boardPinned) renderBoard(s);
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
  if (S.mode !== 'comp') {
    const lb = s.lb || [];
    el.innerHTML = `<h4>Класация – най-добро време</h4><table><tr><th>Играч</th><th>Време</th></tr>${lb.map((r, i) => `<tr class="${r[2] === S.id ? 'me' : ''}"><td>${i + 1}. ${esc(r[0])}</td><td>${fmtT(r[1])}</td></tr>`).join('') || '<tr><td colspan=2>Още няма завършили</td></tr>'}</table><h4>Играчи</h4>${s.pl.map(p => `<span class="chip ${p.i === S.id ? 'me' : ''}">${esc(p.n)}${p.rs === 1 ? ' ▶' : p.rs === 2 ? ' ✔' : ''}</span>`).join(' ')}`;
    return;
  }
  const tbl = t => `<h4 style="color:${TEAM_COL[t]}">${TEAM_NAME[t]} — ${s.sc[t]}</h4><table><tr><th>Играч</th><th>У</th><th>С</th></tr>` +
    s.pl.filter(p => p.tm === t).sort((a, b) => b.k - a.k).map(p => `<tr class="${p.i === S.id ? 'me' : ''} ${p.al ? '' : 'dead'}"><td>${esc(p.n)}${voice.isTalking(p.i) ? '<span class="spk">🔊</span>' : ''}${S.boardPinned && p.i !== S.id && !String(p.i).startsWith('bot') ? `<button class="vm" data-vm="${esc(p.i)}" title="Заглуши / пусни гласа">${voice.isMuted(p.i) ? '🔇' : '🔈'}</button>` : ''}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('') + '</table>';
  el.innerHTML = tbl('att') + tbl('def') + `<div style="color:#9aa6b8;font-size:13px">Пинг: ${Math.round(S.ping)} мс • Рунд ${s.rd}/${CFG.MAX_ROUNDS} • до ${CFG.WIN_ROUNDS} победи</div>`;
}

// ================= Анимиран 3D фон на менютата =================
let menuAng = Math.random() * Math.PI * 2, menuLoading = false;
async function initMenuBg() {
  if (menuLoading) return; menuLoading = true;
  try {
    const list = await (await fetch('/api/maps')).json();
    const pool = list.filter(m => m.id !== 'mine' && !m.bsp), pick = pool[Math.floor(Math.random() * pool.length)] || list[0];
    const json = await (await fetch(`/maps/${pick.id}.json`)).json();
    if (S.inGame) return;
    S.mapJson = json; S.base = World.fromMap(json); S.world = S.base.clone();
    buildWorldMesh(S.world); setupMapDecor(json);
  } catch { }
}
function menuFrame(dt, now) {
  if (S.world && S.mapJson) {
    const [sx, sy, sz] = S.mapJson.size, r = Math.max(sx, sz) * 0.62;
    menuAng += dt * 0.07;
    camera.position.set(sx / 2 + Math.cos(menuAng) * r, 14 + Math.sin(menuAng * 0.6) * 3, sz / 2 + Math.sin(menuAng) * r);
    camera.lookAt(sx / 2, 3, sz / 2);
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
    if (flames) flames.material.size = 0.85 + Math.sin(now / 90) * 0.1;
  }
  renderer.render(scene, camera);
}

// ================= parkour / surf: HUD и събития =================
const fmtT = ms => { ms = Math.max(0, ms | 0); const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, c = ms % 1000; return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(3, '0')}`; };
const pbKey = () => 'bs_pb_' + (S.mapJson?.id || '');
function getPb() { try { const v = +localStorage.getItem(pbKey()); return v > 0 ? v : null; } catch { return null; } }
function updateRunHud(s, m) {
  const rn = m.rn; if (!rn) return;
  const t = rn.st === 1 ? serverNow() - rn.t0 : rn.st === 2 ? rn.tm : 0;
  $('#runTimer').textContent = fmtT(t);
  $('#runTimer').className = rn.st === 2 ? 'done' : rn.st === 1 ? 'on' : '';
  $('#runState').textContent = rn.st === 0 ? 'Излез от стартовата зона, за да тръгне таймерът' : rn.st === 2 ? 'Финал! Backspace – нов опит' : '';
  $('#runCp').textContent = `Checkpoint ${rn.cps}/${rn.total}`;
  const pb = getPb(); $('#runPb').textContent = pb ? `Лично най-добро: ${fmtT(pb)}` : 'Лично най-добро: –';
  $('#speedo').textContent = Math.round(S.speed * 40) + ' ед/с';
  const lb = s.lb || [];
  $('#lbList').innerHTML = lb.length ? lb.map((r, i) => `<div class="${r[2] === S.id ? 'me' : ''}"><span>${i + 1}. ${esc(r[0])}</span><b>${fmtT(r[1])}</b></div>`).join('') : '<div class="dim">Още няма завършили</div>';
  $('#spec').classList.add('hidden');
  if (S.boardOpen || S.boardPinned) renderBoard(s);
  $('#fps').textContent = fpsShown + ' FPS';
}
socket.on('cp', c => { toast(`Checkpoint ${c.n}/${c.total}`, 1600); audio.pickup(); });
socket.on('runstart', () => { toast('Старт!', 900); audio.beep(null, 0.8, true); });
socket.on('finish', f => {
  if (f.id === S.id) {
    audio.roundEnd(true); let msg = `Финал: ${fmtT(f.time)}`;
    const pb = getPb(); if (!pb || f.time < pb) { try { localStorage.setItem(pbKey(), String(f.time)); } catch { } msg += ' — нов личен рекорд!'; }
    banner(msg, '#7cf08a', 4500);
  } else toast(`${f.name} завърши за ${fmtT(f.time)}`, 2500);
});
const WHY = { lava: 'Лава! Връщаш се на checkpoint', water: 'Вода! Връщаш се на checkpoint', void: 'Падна! Връщаш се на checkpoint', restart: 'Рестарт от началото' };

let lastReal = settings.realistic, lastQual = settings.quality;
initSettings(() => { const t = maxPR(); if (pixelRatio !== t) pixelRatio = t; resize(); if (lastReal !== settings.realistic || lastQual !== settings.quality) { lastReal = settings.realistic; lastQual = settings.quality; if (S.world && S.mapJson) buildWorldMesh(S.world); else applyRealism(); } });
initMenuBg();
