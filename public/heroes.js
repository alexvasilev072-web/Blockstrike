// Меню „Герои“: избор на модела, с който играеш, с въртящ се 3D преглед. Изборът се пази в localStorage и другите го виждат.
import * as THREE from 'three';
import { buildCharacter, CHAR_LIST, armGeoFor, handGeoFor } from './characters.js';

const $ = s => document.querySelector(s);
export function loadChar() { try { const c = localStorage.getItem('bs_char'); return CHAR_LIST.some(x => x.id === c) ? c : 'astro'; } catch { return 'astro'; } }

export function initHeroes({ onChange }) {
  let cur = loadChar(), team = 'att', renderer = null, scene, camera, model = null, raf = 0, open = false, t0 = 0, tick = null;
  const save = () => { try { localStorage.setItem('bs_char', cur); } catch { } onChange?.(cur); };
  function renderList() {
    $('#heroList').innerHTML = CHAR_LIST.map(c => `<button data-c="${c.id}" class="${c.id === cur ? 'on' : ''}"><b>${c.name}</b><span>${c.desc}</span></button>`).join('');
    $('#heroList').querySelectorAll('button').forEach(b => b.onclick = () => { cur = b.dataset.c; save(); renderList(); buildPreview(); });
    document.querySelectorAll('#heroTeam button').forEach(b => b.classList.toggle('on', b.dataset.t === team));
  }
  function buildPreview() {
    if (!renderer) return;
    if (model) scene.remove(model);
    const c = buildCharacter(cur, team); tick = c.tick;
    model = new THREE.Group(); const g = new THREE.Group(); g.add(c.head, c.body, c.legL, c.legR);
    const thin = !!c.thin, mA = new THREE.MeshBasicMaterial({ color: c.armHex, vertexColors: true }), mH = new THREE.MeshBasicMaterial({ color: c.handHex });
    for (const s of [-1, 1]) {            // ръце надолу край тялото (в менюто няма оръжие)
      const arm = new THREE.Mesh(armGeoFor(thin), mA); arm.position.set(0.3 * s, 1.28, 0); arm.rotation.x = -1.5; arm.scale.z = 0.6; g.add(arm);
      const h = new THREE.Mesh(handGeoFor(thin), mH); h.position.set(0.31 * s, 0.76, -0.04); g.add(h);
    }
    g.position.y = -0.9; model.add(g); scene.add(model);
  }
  function loop(t) {
    if (!open) return; raf = requestAnimationFrame(loop);
    if (model) { model.rotation.y = (t - t0) / 1500; tick?.((t - t0) / 1000, 3); }
    renderer.render(scene, camera);
  }
  function show() {
    open = true; $('#heroes').classList.remove('hidden');
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas: $('#heroPreview'), antialias: true, alpha: true });
      renderer.setSize(420, 420, false); renderer.setClearColor(0x000000, 0);
      scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20); camera.position.set(0, 0.35, 3.6); camera.lookAt(0, 0.1, 0);
    }
    t0 = performance.now(); renderList(); buildPreview(); raf = requestAnimationFrame(loop);
  }
  function hide() { open = false; cancelAnimationFrame(raf); $('#heroes').classList.add('hidden'); }
  document.querySelectorAll('.heroOpen').forEach(b => b.onclick = show); $('#heroesClose').onclick = hide;
  document.querySelectorAll('#heroTeam button').forEach(b => b.onclick = () => { team = b.dataset.t; renderList(); buildPreview(); });
  return { char: () => cur };
}
