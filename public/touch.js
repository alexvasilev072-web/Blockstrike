// Сензорно управление за телефон/таблет: джойстик (движение), плъзгане по екрана (оглеждане) и бутони.
// Не променя играта: бутоните изпращат същите клавиши/събития като клавиатурата и мишката (синтетични KeyboardEvent/MouseEvent),
// затова всички проверки (сървърът е авторитетен, движението е в shared/physics.js) са същите.
export const isTouchDevice = () => { try { return matchMedia('(pointer: coarse)').matches || /[?&]touch=1/.test(location.search); } catch { return false; } };

export function initTouch({ S, settings, onMenu }) {
  document.body.classList.add('touch');
  const root = document.createElement('div'); root.id = 'touch'; root.className = 'off';
  root.innerHTML = `
    <div id="tLook"></div><div id="tJoy"><i id="tBase"></i><i id="tKnob"></i></div>
    <button class="tb" id="tFire" data-fire>🔫</button>
    <button class="tb" id="tJump" data-key="Space">⤒</button>
    <button class="tb" id="tCrouch" data-toggle="KeyC">⤓</button>
    <button class="tb" id="tReload" data-key="KeyR">R</button>
    <button class="tb" id="tUse" data-hold="KeyE">E</button>
    <button class="tb" id="tDrop" data-key="KeyG">G</button>
    <button class="tb" id="tScope" data-scope>◎</button>
    <button class="tb" id="tBuy" data-key="KeyB">$</button>
    <button class="tb" id="tMic" data-ptt>🎤</button>
    <button class="tb" id="tScore" data-hold="Tab">▤</button>
    <button class="tb" id="tMenu" data-menu>☰</button>
    <div id="tSlots"><button class="tb" data-key="Digit1">1</button><button class="tb" data-key="Digit2">2</button><button class="tb" data-key="Digit3">3</button><button class="tb" data-key="Digit4">4</button></div>`;
  document.body.appendChild(root);
  const $ = s => root.querySelector(s);
  const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
  const mouse = (type, button) => document.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));

  // ---------- джойстик (ляв палец) ----------
  const joy = $('#tJoy'), base = $('#tBase'), knob = $('#tKnob'); let jid = null, jx = 0, jy = 0;
  const R = () => Math.max(46, Math.min(innerWidth, innerHeight) * 0.11);
  const setMove = (nx, ny) => { const t = 0.28; S.keys.KeyW = ny < -t; S.keys.KeyS = ny > t; S.keys.KeyA = nx < -t; S.keys.KeyD = nx > t; S.keys.ShiftLeft = false; };
  joy.addEventListener('pointerdown', e => {
    if (jid !== null) return; jid = e.pointerId; joy.setPointerCapture(jid); jx = e.clientX; jy = e.clientY;
    base.style.cssText = `left:${jx}px;top:${jy}px;width:${R() * 2}px;height:${R() * 2}px;display:block`; knob.style.cssText = `left:${jx}px;top:${jy}px;display:block`; e.preventDefault();
  });
  joy.addEventListener('pointermove', e => {
    if (e.pointerId !== jid) return; let dx = e.clientX - jx, dy = e.clientY - jy; const r = R(), l = Math.hypot(dx, dy) || 1, k = Math.min(1, l / r);
    dx = dx / l * k; dy = dy / l * k; knob.style.left = jx + dx * r + 'px'; knob.style.top = jy + dy * r + 'px'; setMove(dx, dy); e.preventDefault();
  });
  const joyEnd = e => { if (e.pointerId !== jid) return; jid = null; setMove(0, 0); base.style.display = knob.style.display = 'none'; };
  joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);

  // ---------- оглеждане (десен палец) ----------
  const look = $('#tLook'); let lid = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', e => { if (lid !== null) return; lid = e.pointerId; look.setPointerCapture(lid); lx = e.clientX; ly = e.clientY; e.preventDefault(); });
  look.addEventListener('pointermove', e => {
    if (e.pointerId !== lid) return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx * 2.2, movementY: dy * 2.2, bubbles: true })); e.preventDefault();
  });
  const lookEnd = e => { if (e.pointerId === lid) lid = null; };
  look.addEventListener('pointerup', lookEnd); look.addEventListener('pointercancel', lookEnd);

  // ---------- бутони ----------
  const down = (b, fn) => b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture(e.pointerId); b.classList.add('on'); fn(e); });
  const up = (b, fn) => { const f = e => { b.classList.remove('on'); fn?.(e); }; b.addEventListener('pointerup', f); b.addEventListener('pointercancel', f); };
  for (const b of root.querySelectorAll('.tb')) {
    if (b.dataset.fire !== undefined) { down(b, () => mouse('mousedown', 0)); up(b, () => mouse('mouseup', 0)); }
    else if (b.dataset.key) { down(b, () => { key('keydown', b.dataset.key); }); up(b, () => key('keyup', b.dataset.key)); }
    else if (b.dataset.hold) { down(b, () => key('keydown', b.dataset.hold)); up(b, () => key('keyup', b.dataset.hold)); }
    else if (b.dataset.toggle) { let on = false; b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); on = !on; S.keys.ControlLeft = on; S.keys.KeyC = on; b.classList.toggle('on', on); }); }
    else if (b.dataset.scope !== undefined) { down(b, () => { mouse('mousedown', 2); mouse('mouseup', 2); }); up(b); }
    else if (b.dataset.ptt !== undefined) { down(b, () => key('keydown', settings.pttKey)); up(b, () => key('keyup', settings.pttKey)); }
    else if (b.dataset.menu !== undefined) { down(b, () => onMenu?.()); up(b); }
  }
  // следим дали да се показват: само в игра, когато мишката „е хваната“ (т.е. няма меню/магазин/пауза)
  setInterval(() => { root.classList.toggle('off', !(S.inGame && S.locked)); root.classList.toggle('run', S.mode !== 'comp'); if (!S.locked && jid !== null) { jid = null; setMove(0, 0); base.style.display = knob.style.display = 'none'; } }, 150);
  // никакво скролиране/приближаване/контекстно меню върху играта
  for (const ev of ['gesturestart', 'contextmenu']) document.addEventListener(ev, e => { if (S.inGame) e.preventDefault(); });
}
