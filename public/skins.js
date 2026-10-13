// Меню "Скинове": избор на скин за всяко оръжие и нож с въртящ се 3D преглед. Изборът се пази в localStorage.
import * as THREE from 'three';
import { buildModel, BP } from './voxmodel.js';
import { SKINS, SKIN_IDS } from './skindata.js';
import { WEAPONS, KNIFE_TYPES } from '/shared/weapons.js';

const $ = s => document.querySelector(s);
const WEAPON_TABS = ['pistol', 'deagle', 'smg', 'rifle', 'shotgun', 'sniper', 'grenade'];

export function loadCos() {
  try { const c = JSON.parse(localStorage.getItem('bs_cos') || '{}'); return { knife: KNIFE_TYPES[c.knife] ? c.knife : 'bayonet', skins: c.skins || {} }; } catch { return { knife: 'bayonet', skins: {} }; }
}

export function initSkins({ onChange }) {
  let cos = loadCos(), tab = 'rifle', renderer = null, scene, camera, model = null, raf = 0, open = false, t0 = 0;
  const save = () => { try { localStorage.setItem('bs_cos', JSON.stringify(cos)); } catch { } onChange?.(cos); };
  const modelId = () => (KNIFE_TYPES[tab] ? tab : tab);
  const skinKey = () => (KNIFE_TYPES[tab] ? 'knife_' + tab : tab);

  function renderTabs() {
    const names = id => WEAPONS[id]?.name || KNIFE_TYPES[id]?.name || id;
    const items = [...WEAPON_TABS.filter(i => i !== 'grenade'), 'grenade', ...Object.keys(KNIFE_TYPES)];
    $('#skinTabs').innerHTML = items.map(id => `<button data-t="${id}" class="${id === tab ? 'on' : ''}">${KNIFE_TYPES[id] ? '🔪 ' : ''}${names(id)}${KNIFE_TYPES[id] && cos.knife === id ? ' ✓' : ''}</button>`).join('');
    $('#skinTabs').querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.t; if (KNIFE_TYPES[tab]) { cos.knife = tab; save(); } renderTabs(); renderList(); buildPreview(); });
  }
  function renderList() {
    const cur = cos.skins[skinKey()] || 'default';
    $('#skinList').innerHTML = (tab === 'grenade' ? [] : SKIN_IDS).map(id => `<button data-s="${id}" class="${id === cur ? 'on' : ''}">${SKINS[id].name}</button>`).join('') || '<span class="sub">Гранатата няма скинове.</span>';
    $('#skinList').querySelectorAll('button').forEach(b => b.onclick = () => { cos.skins[skinKey()] = b.dataset.s; save(); renderList(); buildPreview(); });
  }
  function buildPreview() {
    if (!renderer) return;
    if (model) scene.remove(model);
    model = new THREE.Group();
    const m = buildModel(modelId(), { skin: cos.skins[skinKey()] || 'default', step: 1, team: 'att' });
    // центриране по размерите на модела
    const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    m.position.sub(c); model.add(m); model.userData.size = Math.max(size.x, size.y, size.z) || 0.5;
    scene.add(model);
    const d = model.userData.size * 1.0 + 0.05; camera.position.set(0, 0.05, d); camera.lookAt(0, 0, 0);
  }
  function loop(t) {
    if (!open) return;
    raf = requestAnimationFrame(loop);
    if (model) { model.rotation.y = (t - t0) / 1800; model.rotation.x = Math.sin((t - t0) / 2600) * 0.25; }
    renderer.render(scene, camera);
  }
  function show() {
    open = true; $('#skins').classList.remove('hidden');
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas: $('#skinPreview'), antialias: false, alpha: true });
      renderer.setSize(420, 280, false); renderer.setClearColor(0x000000, 0);
      scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(36, 420 / 280, 0.01, 20);
    }
    t0 = performance.now(); renderTabs(); renderList(); buildPreview(); raf = requestAnimationFrame(loop);
  }
  function hide() { open = false; cancelAnimationFrame(raf); $('#skins').classList.add('hidden'); }
  document.querySelectorAll('.skinsOpen').forEach(b => b.onclick = show); $('#skinsClose').onclick = hide;
  return { cos: () => cos };
}
