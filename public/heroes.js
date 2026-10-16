// Меню „Герои“: избор на модела, с който играеш (по един герой за всеки отбор), с въртящ се 3D преглед.
// Изборът се пази в localStorage и другите играчи го виждат.
import * as THREE from 'three';
import { buildCharacter, makeArm, heroesFor, defaultChar } from './characters.js';
import { cleanChars } from '/shared/weapons.js';

const $ = s => document.querySelector(s);
export function loadChar() { try { return cleanChars(JSON.parse(localStorage.getItem('bs_chars') || '{}')); } catch { return cleanChars(); } }

export function initHeroes({ onChange }) {
  let cur = loadChar(), team = 'att', renderer = null, scene, camera, model = null, raf = 0, open = false, t0 = 0;
  const save = () => { try { localStorage.setItem('bs_chars', JSON.stringify(cur)); } catch { } onChange?.(cur); };
  function renderList() {
    $('#heroList').innerHTML = heroesFor(team).map(c => `<button data-c="${c.id}" class="${c.id === cur[team] ? 'on' : ''}"><b>${c.name}</b><span>${c.desc}</span></button>`).join('');
    $('#heroList').querySelectorAll('button').forEach(b => b.onclick = () => { cur[team] = b.dataset.c; save(); renderList(); buildPreview(); });
    document.querySelectorAll('#heroTeam button').forEach(b => b.classList.toggle('on', b.dataset.t === team));
  }
  function buildPreview() {
    if (!renderer) return;
    if (model) scene.remove(model);
    const c = buildCharacter(cur[team], team);
    model = new THREE.Group(); const g = new THREE.Group(); g.add(c.head, c.body, c.legL, c.legR);
    for (const s of [-1, 1]) {            // ръце свободно надолу (в менюто няма оръжие)
      const arm = makeArm(c), from = new THREE.Vector3(s * c.sh.x, c.sh.y, 0), to = new THREE.Vector3(s * (c.sh.x + 0.04), 0.88, -0.1);
      arm.set(from, to, s); g.add(arm.g);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), new THREE.MeshBasicMaterial({ color: c.handHex })); h.position.copy(to); g.add(h);
    }
    g.position.y = -0.9; model.add(g); scene.add(model);
  }
  function loop(t) {
    if (!open) return; raf = requestAnimationFrame(loop);
    if (model) model.rotation.y = (t - t0) / 1800 + Math.PI;
    renderer.render(scene, camera);
  }
  function show() {
    open = true; $('#heroes').classList.remove('hidden');
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas: $('#heroPreview'), antialias: true, alpha: true });
      renderer.setSize(420, 420, false); renderer.setClearColor(0x000000, 0);
      scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20); camera.position.set(0, 0.4, 4.4); camera.lookAt(0, 0.15, 0);
    }
    t0 = performance.now(); renderList(); buildPreview(); raf = requestAnimationFrame(loop);
  }
  function hide() { open = false; cancelAnimationFrame(raf); $('#heroes').classList.add('hidden'); }
  document.querySelectorAll('.heroOpen').forEach(b => b.onclick = show); $('#heroesClose').onclick = hide;
  document.querySelectorAll('#heroTeam button').forEach(b => b.onclick = () => { team = b.dataset.t; renderList(); buildPreview(); });
  return { char: () => cur };
}
