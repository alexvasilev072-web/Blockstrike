// Звук: всичко е синтезирано с Web Audio API (без файлове). Позиционните звуци минават през PannerNode (HRTF),
// така че се чува от коя посока и колко далеч е стъпката/изстрелът.
let ctx = null, master = null, comp = null, volume = 0.7;
try { volume = Math.max(0, Math.min(1, parseFloat(localStorage.getItem('bs_vol') ?? '0.7'))); } catch { }
if (!Number.isFinite(volume)) volume = 0.7;
let noiseBuf = null, mixFx = 1, mixSteps = 1;

const rnd = (a, b) => a + Math.random() * (b - a);

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    master = ctx.createGain(); master.gain.value = volume;
    master.connect(comp).connect(ctx.destination);
    const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return true;
  } catch { ctx = null; return false; }
}

// Изход за звук: позиционен (PannerNode) или обикновен.
function out(pos, vol = 1, kind = 'fx') {
  const g = ctx.createGain(); g.gain.value = vol * (kind === 'steps' ? mixSteps : mixFx);
  if (pos) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3.5; p.rolloffFactor = 1.35; p.maxDistance = 200;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(pos[0], pos[1], pos[2]);
    g.connect(p).connect(master);
  } else g.connect(master);
  return g;
}

function noise(dest, { dur = 0.1, type = 'lowpass', f = 1500, f2 = null, q = 1, vol = 0.3, attack = 0.002, delay = 0, rate = 1 } = {}) {
  const t = ctx.currentTime + delay, s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.playbackRate.value = rate; s.loop = true;
  flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f, t); if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(flt).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.02);
}
function tone(dest, { f = 440, f2 = null, dur = 0.1, type = 'sine', vol = 0.2, attack = 0.002, delay = 0 } = {}) {
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
}
const click = (dest, f = 2400, vol = 0.18, delay = 0) => { noise(dest, { dur: 0.03, type: 'bandpass', f, q: 3, vol, delay }); tone(dest, { f: f * 0.5, f2: f * 0.3, dur: 0.03, type: 'square', vol: vol * 0.3, delay }); };

// ---------- звуци ----------
const SHOTS = {
  pistol(o) { noise(o, { dur: 0.11, type: 'bandpass', f: 2200, f2: 900, q: 0.8, vol: 0.5 }); noise(o, { dur: 0.03, type: 'highpass', f: 4000, vol: 0.3 }); tone(o, { f: 220, f2: 90, dur: 0.1, type: 'triangle', vol: 0.35 }); },
  deagle(o) { noise(o, { dur: 0.28, type: 'lowpass', f: 3800, f2: 600, vol: 0.8 }); noise(o, { dur: 0.04, type: 'highpass', f: 3000, vol: 0.5 }); tone(o, { f: 130, f2: 40, dur: 0.3, type: 'sine', vol: 0.7 }); noise(o, { dur: 0.35, type: 'lowpass', f: 500, vol: 0.25, delay: 0.09 }); },
  smg(o) { noise(o, { dur: 0.07, type: 'bandpass', f: 3000, f2: 1400, q: 0.9, vol: 0.4 }); noise(o, { dur: 0.02, type: 'highpass', f: 5000, vol: 0.25 }); tone(o, { f: 300, f2: 120, dur: 0.06, type: 'triangle', vol: 0.25 }); },
  rifle(o) { noise(o, { dur: 0.16, type: 'bandpass', f: 2000, f2: 500, q: 0.7, vol: 0.7 }); noise(o, { dur: 0.03, type: 'highpass', f: 3500, vol: 0.5 }); tone(o, { f: 160, f2: 45, dur: 0.18, type: 'sawtooth', vol: 0.4 }); noise(o, { dur: 0.3, type: 'lowpass', f: 450, vol: 0.18, delay: 0.08 }); },
  shotgun(o) { noise(o, { dur: 0.4, type: 'lowpass', f: 2600, f2: 300, vol: 0.9 }); tone(o, { f: 90, f2: 30, dur: 0.4, type: 'sine', vol: 0.8 }); noise(o, { dur: 0.05, type: 'highpass', f: 2500, vol: 0.5 }); },
  sniper(o) { noise(o, { dur: 0.05, type: 'highpass', f: 3500, vol: 0.8 }); noise(o, { dur: 0.6, type: 'lowpass', f: 1800, f2: 200, vol: 0.9 }); tone(o, { f: 80, f2: 28, dur: 0.6, type: 'sine', vol: 0.9 }); noise(o, { dur: 0.7, type: 'lowpass', f: 600, vol: 0.3, delay: 0.16 }); },
};

const RELOADS = {
  pistol(o) { click(o, 1400, 0.2); click(o, 1800, 0.22, 0.65); click(o, 900, 0.18, 1.0); },
  deagle(o) { click(o, 1200, 0.22); click(o, 1600, 0.25, 0.8); click(o, 800, 0.2, 1.2); },
  smg(o) { click(o, 1800, 0.2); noise(o, { dur: 0.12, type: 'bandpass', f: 900, q: 2, vol: 0.2, delay: 0.5 }); click(o, 2000, 0.25, 0.95); click(o, 1100, 0.2, 1.5); },
  rifle(o) { click(o, 1500, 0.22); noise(o, { dur: 0.15, type: 'bandpass', f: 700, q: 2, vol: 0.2, delay: 0.55 }); click(o, 1900, 0.28, 1.05); noise(o, { dur: 0.1, type: 'bandpass', f: 1200, q: 3, vol: 0.25, delay: 1.9 }); click(o, 1000, 0.25, 2.1); },
  shotgun(o) { for (let i = 0; i < 5; i++) click(o, 1300 + i * 60, 0.18, 0.5 + i * 0.5); noise(o, { dur: 0.15, type: 'bandpass', f: 600, q: 2, vol: 0.3, delay: 3.0 }); click(o, 900, 0.3, 3.1); },
  sniper(o) { click(o, 1300, 0.25); click(o, 1700, 0.28, 1.3); noise(o, { dur: 0.12, type: 'bandpass', f: 800, q: 2, vol: 0.3, delay: 2.6 }); click(o, 900, 0.3, 2.8); click(o, 1500, 0.3, 3.3); },
};

const STEPS = {
  stone(o, v) { noise(o, { dur: 0.06, type: 'bandpass', f: 900, q: 1.2, vol: 0.5 * v }); tone(o, { f: 150, f2: 90, dur: 0.06, vol: 0.25 * v }); noise(o, { dur: 0.02, type: 'highpass', f: 3000, vol: 0.12 * v }); },
  metal(o, v) { noise(o, { dur: 0.04, type: 'highpass', f: 1800, vol: 0.4 * v }); tone(o, { f: 520, f2: 480, dur: 0.18, type: 'triangle', vol: 0.18 * v }); tone(o, { f: 910, dur: 0.12, type: 'sine', vol: 0.1 * v }); },
  wood(o, v) { noise(o, { dur: 0.08, type: 'lowpass', f: 650, vol: 0.5 * v }); tone(o, { f: 120, f2: 80, dur: 0.09, vol: 0.3 * v }); tone(o, { f: 280, f2: 220, dur: 0.05, type: 'triangle', vol: 0.1 * v }); },
  snow(o, v) { for (let i = 0; i < 3; i++) noise(o, { dur: 0.05, type: 'lowpass', f: 1100, vol: 0.2 * v, attack: 0.01, delay: i * 0.035 }); },
  sand(o, v) { noise(o, { dur: 0.13, type: 'lowpass', f: 1300, f2: 600, vol: 0.28 * v, attack: 0.025 }); },
  grass(o, v) { noise(o, { dur: 0.1, type: 'bandpass', f: 800, q: 0.8, vol: 0.3 * v, attack: 0.015 }); tone(o, { f: 100, dur: 0.05, vol: 0.12 * v }); },
  ice(o, v) { STEPS.stone(o, v * 0.7); noise(o, { dur: 0.05, type: 'highpass', f: 4500, vol: 0.2 * v }); },
  water(o, v) { noise(o, { dur: 0.22, type: 'bandpass', f: 450, f2: 900, q: 1.4, vol: 0.4 * v, attack: 0.02 }); tone(o, { f: 300, f2: 760, dur: 0.12, vol: 0.12 * v, delay: 0.03 }); },
};

export const audio = {
  init() { ensure(); },
  get volume() { return volume; },
  setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; },

  setMix({ fx = 1, steps = 1 } = {}) { mixFx = fx; mixSteps = steps; },

  setListener(x, y, z, fx, fy, fz) {
    if (!ctx) return; const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
  },

  shot(w, pos) { if (!ensure()) return; const o = out(pos, pos ? 1.2 : 0.9), f = SHOTS[w] || SHOTS.pistol; f(o); },
  reload(w, pos) { if (!ensure()) return; const o = out(pos, pos ? 0.9 : 0.7); (RELOADS[w] || RELOADS.pistol)(o); },
  equip(pos) { if (!ensure()) return; const o = out(pos, 0.7); click(o, 1500, 0.18); click(o, 1000, 0.15, 0.09); },
  knife(kind, hit, pos) {
    if (!ensure()) return; const o = out(pos, 0.9);
    noise(o, { dur: kind === 'r' ? 0.26 : 0.16, type: 'bandpass', f: 700, f2: 3200, q: 1.2, vol: 0.35, attack: 0.04 });
    if (hit) { noise(o, { dur: 0.12, type: 'lowpass', f: 700, vol: 0.7, delay: 0.09 }); tone(o, { f: 150, f2: 70, dur: 0.12, vol: 0.4, delay: 0.09 }); }
  },
  footstep(surface, pos, vol = 1) { if (!ensure()) return; const o = out(pos, pos ? 1.1 : 0.55, 'steps'); (STEPS[surface] || STEPS.stone)(o, vol * rnd(0.85, 1.1)); },
  jump(pos, surface = 'stone') { if (!ensure()) return; const o = out(pos, pos ? 0.8 : 0.45, 'steps'); noise(o, { dur: 0.1, type: 'bandpass', f: 500, q: 0.6, vol: 0.2 }); (STEPS[surface] || STEPS.stone)(o, 0.5); },
  land(pos, strength = 1, surface = 'stone') { if (!ensure()) return; const o = out(pos, pos ? 1.1 : 0.7, 'steps'), v = Math.min(1.6, 0.5 + strength * 0.5); (STEPS[surface] || STEPS.stone)(o, v); tone(o, { f: 110, f2: 55, dur: 0.14, vol: 0.3 * v, type: 'sine' }); },
  hit(head) { if (!ensure()) return; const o = out(null, 0.9); if (head) { tone(o, { f: 2400, dur: 0.12, vol: 0.3 }); tone(o, { f: 1200, dur: 0.16, vol: 0.2, delay: 0.04 }); noise(o, { dur: 0.05, type: 'highpass', f: 4000, vol: 0.25 }); } else tone(o, { f: 1300, dur: 0.07, vol: 0.28 }); },
  hurt() { if (!ensure()) return; const o = out(null, 1); tone(o, { f: 150, f2: 70, dur: 0.22, type: 'sawtooth', vol: 0.25 }); noise(o, { dur: 0.15, type: 'lowpass', f: 600, vol: 0.4 }); },
  impact(pos, flesh) { if (!ensure()) return; const o = out(pos, 0.9); if (flesh) { noise(o, { dur: 0.08, type: 'lowpass', f: 500, vol: 0.6 }); tone(o, { f: 120, f2: 60, dur: 0.08, vol: 0.3 }); } else { noise(o, { dur: 0.05, type: 'highpass', f: 2500, vol: 0.35 }); tone(o, { f: 2000, f2: 1200, dur: 0.05, type: 'triangle', vol: 0.12 }); } },
  glass(pos) { if (!ensure()) return; const o = out(pos, 1); noise(o, { dur: 0.3, type: 'highpass', f: 3200, vol: 0.55 }); for (let i = 0; i < 6; i++) tone(o, { f: rnd(2800, 6500), dur: rnd(0.05, 0.15), type: 'triangle', vol: 0.08, delay: rnd(0, 0.25) }); },
  breakBlock(pos) { if (!ensure()) return; const o = out(pos, 1); noise(o, { dur: 0.25, type: 'lowpass', f: 900, vol: 0.6 }); tone(o, { f: 140, f2: 60, dur: 0.15, vol: 0.3 }); },
  boom(pos, big) {
    if (!ensure()) return; const o = out(pos, big ? 2.2 : 1.4);
    noise(o, { dur: big ? 2.2 : 1.1, type: 'lowpass', f: 900, f2: 60, vol: 1.0, attack: 0.004 });
    tone(o, { f: 70, f2: 22, dur: big ? 2.0 : 1.0, type: 'sine', vol: 1.0 }); noise(o, { dur: 0.1, type: 'highpass', f: 1500, vol: 0.5 });
    noise(o, { dur: big ? 1.6 : 0.8, type: 'lowpass', f: 300, vol: 0.4, delay: 0.25 });
  },
  nadeThrow(pos) { if (!ensure()) return; const o = out(pos, 0.8); noise(o, { dur: 0.2, type: 'bandpass', f: 600, f2: 1800, q: 1, vol: 0.25 }); click(o, 900, 0.2, 0.18); },
  beep(pos, vol = 1, hi = false) { if (!ensure()) return; const o = out(pos, 1.3 * vol); tone(o, { f: hi ? 1700 : 1350, dur: 0.1, type: 'square', vol: 0.3 }); tone(o, { f: hi ? 3400 : 2700, dur: 0.05, type: 'sine', vol: 0.08 }); },
  plantTick(pos) { if (!ensure()) return; const o = out(pos, 0.9); tone(o, { f: 900, dur: 0.06, type: 'square', vol: 0.18 }); },
  defuseTick(pos) { if (!ensure()) return; const o = out(pos, 0.9); click(o, 1400, 0.2); click(o, 1900, 0.15, 0.07); },
  plantDone(pos) { if (!ensure()) return; const o = out(pos, 1.2); for (let i = 0; i < 3; i++) tone(o, { f: 1000 + i * 250, dur: 0.12, type: 'square', vol: 0.25, delay: i * 0.14 }); },
  defuseDone(pos) { if (!ensure()) return; const o = out(pos, 1.2); tone(o, { f: 700, dur: 0.12, type: 'sine', vol: 0.3 }); tone(o, { f: 1400, dur: 0.3, type: 'sine', vol: 0.3, delay: 0.1 }); },
  pickup() { if (!ensure()) return; const o = out(null, 0.8); tone(o, { f: 600, f2: 1100, dur: 0.12, type: 'triangle', vol: 0.25 }); },
  buy() { if (!ensure()) return; const o = out(null, 0.8); tone(o, { f: 1200, dur: 0.08, type: 'triangle', vol: 0.25 }); tone(o, { f: 1800, dur: 0.14, type: 'triangle', vol: 0.25, delay: 0.07 }); },
  empty() { if (!ensure()) return; click(out(null, 0.7), 700, 0.25); },
  roundStart() { if (!ensure()) return; const o = out(null, 0.8); tone(o, { f: 440, dur: 0.15, type: 'square', vol: 0.15 }); tone(o, { f: 880, dur: 0.25, type: 'square', vol: 0.15, delay: 0.16 }); },
  roundEnd(win) { if (!ensure()) return; const o = out(null, 0.8); const n = win ? [523, 659, 784] : [392, 330, 262]; n.forEach((f, i) => tone(o, { f, dur: 0.25, type: 'triangle', vol: 0.22, delay: i * 0.18 })); },
};
