// Звук: синтезиран с Web Audio API. Позиционните звуци минават през PannerNode (HRTF).
// Ако в public/sounds/ има файл с подходящо име (виж public/sounds/README.md), той се ползва вместо синтезирания звук.
// „Ретро звук (1.6 стил)“: по-суров звук – ~11 kHz, 8-битово квантуване, леко изкривяване, къси опашки, по-остри щраквания.
let ctx = null, master = null, comp = null, volume = 0.7, mixFx = 1, mixSteps = 1, retro = false;
try { volume = Math.max(0, Math.min(1, parseFloat(localStorage.getItem('bs_vol') ?? '0.7'))); } catch { }
if (!Number.isFinite(volume)) volume = 0.7;
let noiseBuf = null, crushNode = null, shaper = null, lowp = null;
const files = new Map();       // базово име -> [url, ...] (всички варианти с този префикс)
const buffers = new Map();     // url -> AudioBuffer | 'loading' | 'bad'
let manifestLoaded = false;

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- верига: master -> (ретро: crush -> shaper -> lowpass) -> compressor -> изход ----------
function rebuildChain() {
  if (!ctx) return;
  try { master.disconnect(); } catch { }
  for (const n of [crushNode, shaper, lowp]) { try { n?.disconnect(); } catch { } }
  if (retro && shaper) {
    let last = master;
    if (crushNode) { last.connect(crushNode); last = crushNode; }
    last.connect(shaper); shaper.connect(lowp); lowp.connect(comp);
  } else master.connect(comp);
}
function makeShaper() {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.round(Math.tanh(2.4 * x) * 96) / 96; }   // изкривяване + груб (~7-битов) праг
  const s = ctx.createWaveShaper(); s.curve = c; s.oversample = 'none'; return s;
}
const WORKLET = `class Crush extends AudioWorkletProcessor {
  constructor() { super(); this.ph = 0; this.last = [0, 0]; }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0], step = sampleRate / 11025;       // ~11 kHz
    for (let ch = 0; ch < out.length; ch++) {
      const i = inp[ch] || inp[0], o = out[ch];
      for (let n = 0; n < o.length; n++) { this.ph += 1; if (this.ph >= step) { this.ph -= step; this.last[ch] = i ? i[n] : 0; } o[n] = this.last[ch]; }
    }
    return true;
  }
}
registerProcessor('crush', Crush);`;

// ---------- „лечение“: звукът никога не бива да остава замлъкнал ----------
// Причини за пълна тишина: контекстът е спрян (suspended/interrupted), филтър/компресор е „залепнал“ на NaN, главната сила остава намалена (flashbang).
let probe = null, probeBuf = null, flashUntil = 0, healed = 0;
function makeComp() {
  const c = ctx.createDynamicsCompressor(); c.threshold.value = -14; c.ratio.value = 6; c.attack.value = 0.003; c.release.value = 0.15;
  c.connect(ctx.destination); if (probe) c.connect(probe); return c;
}
function heal() {
  if (!ctx) return;
  if (ctx.state !== 'running') { try { ctx.resume(); } catch { } return; }
  // 1) NaN/∞ в изхода на веригата (филтър или компресор „умира“ завинаги) – изграждаме ги наново
  if (probe) {
    probe.getFloatTimeDomainData(probeBuf); let bad = false;
    for (let i = 0; i < probeBuf.length; i++) if (!Number.isFinite(probeBuf[i])) { bad = true; break; }
    if (bad) {
      healed++; try { comp.disconnect(); } catch { }
      comp = makeComp(); lowp = ctx.createBiquadFilter(); lowp.type = 'lowpass'; lowp.frequency.value = 5200; lowp.Q.value = 0.7; shaper = makeShaper(); rebuildChain();
    }
  }
  // 2) главната сила трябва да е равна на настройката, освен докато трае заслепяването
  if (performance.now() > flashUntil && master && Math.abs(master.gain.value - volume) > 0.01) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(volume, ctx.currentTime); }
}
if (typeof document !== 'undefined') {
  setInterval(heal, 1000);
  for (const ev of ['pointerdown', 'keydown', 'focus', 'visibilitychange']) addEventListener(ev, () => { if (ctx && ctx.state !== 'running') { try { ctx.resume(); } catch { } } }, { capture: true, passive: true });
}

function ensure() {
  if (ctx) { if (ctx.state !== 'running') ctx.resume(); return true; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    probe = ctx.createAnalyser(); probe.fftSize = 256; probeBuf = new Float32Array(256);
    comp = makeComp();
    ctx.onstatechange = () => { if (ctx.state !== 'running') { try { ctx.resume(); } catch { } } };
    master = ctx.createGain(); master.gain.value = volume;
    shaper = makeShaper(); lowp = ctx.createBiquadFilter(); lowp.type = 'lowpass'; lowp.frequency.value = 5200; lowp.Q.value = 0.7;
    rebuildChain();
    const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    if (ctx.audioWorklet) {
      try { const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })); ctx.audioWorklet.addModule(url).then(() => { crushNode = new AudioWorkletNode(ctx, 'crush'); crushNode.onprocessorerror = () => { try { crushNode.disconnect(); } catch { } crushNode = null; rebuildChain(); }; rebuildChain(); }).catch(() => { }); } catch { }
    }
    loadManifest();
    return true;
  } catch { ctx = null; return false; }
}

// ---------- звукови файлове (по избор) ----------
async function loadManifest() {
  if (manifestLoaded) return; manifestLoaded = true;
  try {
    const list = await (await fetch('/api/sounds')).json();
    // OGG (Vorbis); ако браузърът не го поддържа – MP3 резервен вариант от /sounds/mp3/
    const ogg = (() => { try { return !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch { return true; } })();
    for (const f of list) {
      const base = f.replace(/\.[a-z0-9]+$/i, ''), url = /\.ogg$/i.test(f) && !ogg ? '/sounds/mp3/' + base + '.mp3' : '/sounds/' + f;
      (files.get(base) || files.set(base, []).get(base)).push(url);
    }
    fileFor('wind');      // предварително зареждане на файла за вятъра (ако има)
  } catch { }
}
// Намира файл за име (ak47_fire) или за варианти (step_metal1, step_metal2…); връща декодирания буфер или null (и започва зареждане).
function fileFor(name) {
  const cands = []; for (const k of [name, name + '1', name + '2', name + '3', name + '4']) if (files.has(k)) cands.push(...files.get(k));
  if (!cands.length) return null;
  const url = cands[Math.floor(Math.random() * cands.length)], b = buffers.get(url);
  if (b && b !== 'loading' && b !== 'bad') return b;
  if (!b) {
    buffers.set(url, 'loading');
    fetch(url).then(r => r.arrayBuffer()).then(a => ctx.decodeAudioData(a)).then(buf => buffers.set(url, buf)).catch(() => buffers.set(url, 'bad'));
  }
  return null;
}
function playFile(name, pos, vol = 1, rate = 1) {
  if (!ctx) return false;
  const buf = fileFor(name); if (!buf) return false;
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate * rnd(0.97, 1.03);
  src.connect(out(pos, vol)); src.start(); return true;
}

// Изход за звук: позиционен (PannerNode) или обикновен.
function out(pos, vol = 1, kind = 'fx') {
  const g = ctx.createGain(); g.gain.value = Number.isFinite(vol) ? vol * (kind === 'steps' ? mixSteps : mixFx) : 0;
  if (pos && !(Number.isFinite(pos[0]) && Number.isFinite(pos[1]) && Number.isFinite(pos[2]))) pos = null;
  if (pos) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3.5; p.rolloffFactor = 1.35; p.maxDistance = 200;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(pos[0], pos[1], pos[2]);
    g.connect(p).connect(master);
  } else g.connect(master);
  return g;
}

function noise(dest, { dur = 0.1, type = 'lowpass', f = 1500, f2 = null, q = 1, vol = 0.3, attack = 0.002, delay = 0, rate = 1 } = {}) {
  if (retro) { if (delay > 0.05 && dur > 0.15) return; dur *= 0.78; attack = Math.min(attack, 0.001); }   // ретро: по-кратко ехо, по-сух звук
  const t = ctx.currentTime + delay, s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.playbackRate.value = rate; s.loop = true;
  flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f, t); if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(flt).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.02);
}
function tone(dest, { f = 440, f2 = null, dur = 0.1, type = 'sine', vol = 0.2, attack = 0.002, delay = 0 } = {}) {
  if (retro) { if (delay > 0.05 && dur > 0.15) return; dur *= 0.85; if (type === 'sine') type = 'triangle'; }
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
}
// щракане: в ретро режим е по-рязко и по-високо
const click = (dest, f = 2400, vol = 0.18, delay = 0) => {
  if (retro) { f *= 1.45; vol *= 1.35; noise(dest, { dur: 0.022, type: 'highpass', f: f * 0.8, q: 2, vol, delay }); tone(dest, { f: f * 0.45, f2: f * 0.2, dur: 0.02, type: 'square', vol: vol * 0.5, delay }); return; }
  noise(dest, { dur: 0.03, type: 'bandpass', f, q: 3, vol, delay }); tone(dest, { f: f * 0.5, f2: f * 0.3, dur: 0.03, type: 'square', vol: vol * 0.3, delay });
};

// ---------- синтезирани звуци ----------
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
const WNAME = { pistol: 'pistol', deagle: 'deagle', smg: 'mp9', rifle: 'ak47', shotgun: 'nova', sniper: 'awp' };
import { WEAPONS as WDEF } from '/shared/weapons.js';
const likeOf = w => WDEF[w]?.like || w, pitchOf = w => WDEF[w]?.pitch || 1;       // варианти на оръжие: звукът на базовото, с друга височина

// вятър при висока скорост: непрекъснат шум, чийто тон и сила растат с нивото (0..1)
let windSrc = null, windGain = null, windFlt = null, windFile = false;
function windInit() {
  windSrc = ctx.createBufferSource(); const wb = fileFor('wind'); windFile = !!wb; windSrc.buffer = wb || noiseBuf; windSrc.loop = true;      // файл public/sounds/wind.* или синтезиран шум
  windFlt = ctx.createBiquadFilter(); windFlt.type = windFile ? 'lowpass' : 'bandpass'; windFlt.Q.value = windFile ? 0.7 : 0.6; windFlt.frequency.value = windFile ? 18000 : 400;
  windGain = ctx.createGain(); windGain.gain.value = 0;
  windSrc.connect(windFlt).connect(windGain).connect(master); windSrc.start();
}

export const audio = {
  init() { ensure(); },
  debug() { return { state: ctx?.state, gain: master?.gain.value, volume, healed, retro, crush: !!crushNode }; },
  get volume() { return volume; },
  get retro() { return retro; },
  setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; },
  setMix({ fx = 1, steps = 1 } = {}) { mixFx = fx; mixSteps = steps; },
  setRetro(on) { retro = !!on; if (ctx) rebuildChain(); },
  setWind(level) {
    if (!ctx) return;
    if (!windSrc) { if (level <= 0.01) return; windInit(); }
    const t = ctx.currentTime, l = Math.max(0, Math.min(1, level));
    windGain.gain.setTargetAtTime(l * l * (windFile ? 0.9 : 0.55) * mixFx, t, 0.08); if (!windFile) windFlt.frequency.setTargetAtTime(350 + l * 1700, t, 0.1);
  },

  setListener(x, y, z, fx, fy, fz) {
    if (!ctx || !(Number.isFinite(x + y + z + fx + fy + fz)) || (!fx && !fy && !fz)) return; const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
  },

  shot(w, pos) { if (!ensure()) return; const L = likeOf(w); if (playFile(WNAME[L] + '_fire', pos, pos ? 1.2 : 0.9, pitchOf(w))) return; const o = out(pos, pos ? 1.2 : 0.9), f = SHOTS[L] || SHOTS.pistol; f(o); },
  reload(w, pos) { if (!ensure()) return; const L = likeOf(w); if (playFile(WNAME[L] + '_reload', pos, pos ? 0.9 : 0.7, pitchOf(w))) return; const o = out(pos, pos ? 0.9 : 0.7); (RELOADS[L] || RELOADS.pistol)(o); },
  equip(pos) { if (!ensure()) return; if (playFile('draw', pos, 0.7)) return; const o = out(pos, 0.7); click(o, 1500, 0.18); click(o, 1000, 0.15, 0.09); },
  knife(kind, hit, pos) {
    if (!ensure()) return;
    const f1 = playFile(kind === 'r' ? 'knife_stab' : 'knife_slash', pos, 0.9), f2 = hit && playFile('knife_hit', pos, 0.9);
    if (f1 || f2) return;
    const o = out(pos, 0.9);
    noise(o, { dur: kind === 'r' ? 0.26 : 0.16, type: 'bandpass', f: 700, f2: 3200, q: 1.2, vol: 0.35, attack: 0.04 });
    if (hit) { noise(o, { dur: 0.12, type: 'lowpass', f: 700, vol: 0.7, delay: 0.09 }); tone(o, { f: 150, f2: 70, dur: 0.12, vol: 0.4, delay: 0.09 }); }
  },
  footstep(surface, pos, vol = 1) {
    if (!ensure()) return; if (playFile('step_' + surface, pos, (pos ? 1.1 : 0.55) * vol, 1)) return;
    const o = out(pos, pos ? 1.1 : 0.55, 'steps'); (STEPS[surface] || STEPS.stone)(o, vol * rnd(0.85, 1.1));
    if (retro) { noise(o, { dur: 0.018, type: 'highpass', f: 3500, vol: 0.32 * vol }); tone(o, { f: 90, f2: 60, dur: 0.03, type: 'square', vol: 0.1 * vol }); }   // „тракане“
  },
  jump(pos, surface = 'stone') { if (!ensure()) return; if (playFile('jump', pos, 0.8)) return; const o = out(pos, pos ? 0.8 : 0.45, 'steps'); noise(o, { dur: 0.1, type: 'bandpass', f: 500, q: 0.6, vol: 0.2 }); (STEPS[surface] || STEPS.stone)(o, 0.5); },
  land(pos, strength = 1, surface = 'stone') { if (!ensure()) return; if (playFile('land', pos, 1)) return; const o = out(pos, pos ? 1.1 : 0.7, 'steps'), v = Math.min(1.6, 0.5 + strength * 0.5); (STEPS[surface] || STEPS.stone)(o, v); tone(o, { f: 110, f2: 55, dur: 0.14, vol: 0.3 * v, type: 'sine' }); },
  bounce(pos) { if (!ensure()) return; if (playFile('slime_bounce', pos, 1)) return; const o = out(pos, 0.9); tone(o, { f: 200, f2: 760, dur: 0.22, type: 'sine', vol: 0.35 }); tone(o, { f: 400, f2: 1100, dur: 0.16, type: 'triangle', vol: 0.16, delay: 0.04 }); noise(o, { dur: 0.1, type: 'bandpass', f: 500, q: 2, vol: 0.2 }); },
  hit(head) { if (!ensure()) return; if (playFile(head ? 'hit_head' : 'hit', null, 0.9)) return; const o = out(null, 0.9); if (head) { tone(o, { f: 2400, dur: 0.12, vol: 0.3 }); tone(o, { f: 1200, dur: 0.16, vol: 0.2, delay: 0.04 }); noise(o, { dur: 0.05, type: 'highpass', f: 4000, vol: 0.25 }); } else tone(o, { f: 1300, dur: 0.07, vol: 0.28 }); },
  hurt() { if (!ensure()) return; if (playFile('hurt', null, 1)) return; const o = out(null, 1); tone(o, { f: 150, f2: 70, dur: 0.22, type: 'sawtooth', vol: 0.25 }); noise(o, { dur: 0.15, type: 'lowpass', f: 600, vol: 0.4 }); },
  impact(pos, flesh) { if (!ensure()) return; const o = out(pos, 0.9); if (flesh) { noise(o, { dur: 0.08, type: 'lowpass', f: 500, vol: 0.6 }); tone(o, { f: 120, f2: 60, dur: 0.08, vol: 0.3 }); } else { noise(o, { dur: 0.05, type: 'highpass', f: 2500, vol: 0.35 }); tone(o, { f: 2000, f2: 1200, dur: 0.05, type: 'triangle', vol: 0.12 }); } },
  glass(pos) { if (!ensure()) return; if (playFile('glass_break', pos, 1)) return; const o = out(pos, 1); noise(o, { dur: 0.3, type: 'highpass', f: 3200, vol: 0.55 }); for (let i = 0; i < 6; i++) tone(o, { f: rnd(2800, 6500), dur: rnd(0.05, 0.15), type: 'triangle', vol: 0.08, delay: rnd(0, 0.25) }); },
  breakBlock(pos) { if (!ensure()) return; if (playFile('block_break', pos, 1)) return; const o = out(pos, 1); noise(o, { dur: 0.25, type: 'lowpass', f: 900, vol: 0.6 }); tone(o, { f: 140, f2: 60, dur: 0.15, vol: 0.3 }); },
  boom(pos, big) {
    if (!ensure()) return; if (playFile(big ? 'bomb_explode' : 'grenade_explode', pos, big ? 2.2 : 1.4)) return;
    const o = out(pos, big ? 2.2 : 1.4);
    noise(o, { dur: big ? 2.2 : 1.1, type: 'lowpass', f: 900, f2: 60, vol: 1.0, attack: 0.004 });
    tone(o, { f: 70, f2: 22, dur: big ? 2.0 : 1.0, type: 'sine', vol: 1.0 }); noise(o, { dur: 0.1, type: 'highpass', f: 1500, vol: 0.5 });
    noise(o, { dur: big ? 1.6 : 0.8, type: 'lowpass', f: 300, vol: 0.4, delay: 0.25 });
  },
  // flashbang: силен пукот + звънтене в ушите (само за заслепения играч)
  flashBang(pos) { if (!ensure()) return; if (playFile('flash_explode', pos, 1.6)) return; const o = out(pos, 1.6); noise(o, { dur: 0.32, type: 'highpass', f: 1500, vol: 0.9 }); tone(o, { f: 3600, f2: 2400, dur: 0.18, type: 'square', vol: 0.3 }); noise(o, { dur: 0.7, type: 'lowpass', f: 900, vol: 0.35 }); },
  flashed(d, a = 1) {
    if (!ensure()) return; const t = ctx.currentTime;
    d = Number.isFinite(d) ? Math.max(0.2, Math.min(8, d)) : 2; a = Number.isFinite(a) ? a : 1;
    if (master) { master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(volume * 0.18, t, 0.02); master.gain.setValueAtTime(volume * 0.18, t + d * 0.75); master.gain.linearRampToValueAtTime(volume, t + d * 0.75 + d * 0.3 + 0.1); flashUntil = performance.now() + (d * 1.05 + 0.3) * 1000; }
    const o = out(null, 0.5 * a); tone(o, { f: 4200, dur: Math.max(0.6, d), type: 'sine', vol: 0.12 * a }); tone(o, { f: 6100, dur: Math.max(0.4, d * 0.7), type: 'sine', vol: 0.05 * a });
  },
  smokePop(pos) { if (!ensure()) return; if (playFile('smoke_pop', pos, 1.2)) return; const o = out(pos, 1.2); noise(o, { dur: 0.5, type: 'lowpass', f: 700, vol: 0.4 }); noise(o, { dur: 1.6, type: 'highpass', f: 2500, vol: 0.1 }); tone(o, { f: 160, f2: 60, dur: 0.3, type: 'sine', vol: 0.3 }); },
  molotov(pos) { if (!ensure()) return; if (playFile('molotov_explode', pos, 1.3)) return; const o = out(pos, 1.3); noise(o, { dur: 0.25, type: 'highpass', f: 3000, vol: 0.5 }); noise(o, { dur: 0.9, type: 'bandpass', f: 500, f2: 1600, q: 1, vol: 0.45 }); for (let i = 0; i < 6; i++) click(o, 1800 + i * 300, 0.12, 0.25 + i * 0.12); },
  nadeThrow(pos) { if (!ensure()) return; if (playFile('grenade_throw', pos, 0.8)) return; const o = out(pos, 0.8); noise(o, { dur: 0.2, type: 'bandpass', f: 600, f2: 1800, q: 1, vol: 0.25 }); click(o, 900, 0.2, 0.18); },
  beep(pos, vol = 1, hi = false) { if (!ensure()) return; if (playFile('bomb_beep', pos, 1.3 * vol, hi ? 1.25 : 1)) return; const o = out(pos, 1.3 * vol); tone(o, { f: hi ? 1700 : 1350, dur: 0.1, type: 'square', vol: 0.3 }); tone(o, { f: hi ? 3400 : 2700, dur: 0.05, type: 'sine', vol: 0.08 }); },
  plantTick(pos) { if (!ensure()) return; if (playFile('bomb_plant', pos, 0.9)) return; const o = out(pos, 1.0); tone(o, { f: 1900, dur: 0.035, type: 'square', vol: 0.22 }); tone(o, { f: 2500, dur: 0.035, type: 'square', vol: 0.18, delay: 0.05 }); },
  defuseTick(pos) { if (!ensure()) return; if (playFile('bomb_defuse', pos, 0.9)) return; const o = out(pos, 1.0); click(o, 1400, 0.3); tone(o, { f: 1200, dur: 0.03, type: 'square', vol: 0.16 }); click(o, 1900, 0.22, 0.07); },
  plantDone(pos) { if (!ensure()) return; if (playFile('bomb_planted', pos, 1.2)) return; const o = out(pos, 1.3); for (let i = 0; i < 4; i++) tone(o, { f: 1500, dur: 0.07, type: 'square', vol: 0.3, delay: i * 0.1 }); tone(o, { f: 900, f2: 1800, dur: 0.35, type: 'square', vol: 0.22, delay: 0.5 }); },
  defuseDone(pos) { if (!ensure()) return; if (playFile('bomb_defused', pos, 1.2)) return; const o = out(pos, 1.3); tone(o, { f: 1000, dur: 0.1, type: 'square', vol: 0.28 }); tone(o, { f: 1500, dur: 0.1, type: 'square', vol: 0.28, delay: 0.13 }); tone(o, { f: 2000, dur: 0.4, type: 'square', vol: 0.25, delay: 0.26 }); },
  pickup() { if (!ensure()) return; if (playFile('pickup', null, 0.8)) return; const o = out(null, 0.8); tone(o, { f: 600, f2: 1100, dur: 0.12, type: 'triangle', vol: 0.25 }); },
  buy() { if (!ensure()) return; if (playFile('buy', null, 0.8)) return; const o = out(null, 0.8); tone(o, { f: 1200, dur: 0.08, type: 'triangle', vol: 0.25 }); tone(o, { f: 1800, dur: 0.14, type: 'triangle', vol: 0.25, delay: 0.07 }); },
  empty() { if (!ensure()) return; if (playFile('empty', null, 0.7)) return; click(out(null, 0.7), 700, 0.25); },
  roundStart() { if (!ensure()) return; if (playFile('round_start', null, 0.8)) return; const o = out(null, 0.8); tone(o, { f: 440, dur: 0.15, type: 'square', vol: 0.15 }); tone(o, { f: 880, dur: 0.25, type: 'square', vol: 0.15, delay: 0.16 }); },
  roundEnd(win) { if (!ensure()) return; if (playFile(win ? 'round_win' : 'round_lose', null, 0.8)) return; const o = out(null, 0.8); const n = win ? [523, 659, 784] : [392, 330, 262]; n.forEach((f, i) => tone(o, { f, dur: 0.25, type: 'triangle', vol: 0.22, delay: i * 0.18 })); },
};
