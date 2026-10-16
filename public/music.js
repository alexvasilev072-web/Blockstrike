// Фонова музика за менюто и лобито: тактически/военен ambient, генериран процедурно с Web Audio (без файлове, без авторски права).
// Бавни пад-акорди в минор, нисък бас, тихо „сърцебиене“ и рядки камбанки със забавяне/реверб. Спира плавно в игра, тръгва пак в менюто.
// Autoplay: браузърите изискват жест – контекстът се пуска при първо кликване/клавиш (unlock).
const BPM = 70, BEAT = 60 / BPM, BAR = BEAT * 4;
const hz = n => 440 * Math.pow(2, (n - 69) / 12);
// Am – Fmaj7 – Dm – E (хармоничен минор): бас + акорд (MIDI)
const PROG = [
  { bass: 33, pad: [57, 60, 64, 67], bell: [69, 72, 76, 79, 81] },
  { bass: 29, pad: [53, 57, 60, 64], bell: [69, 72, 77, 81, 84] },
  { bass: 26, pad: [50, 57, 62, 65], bell: [69, 74, 77, 81, 86] },
  { bass: 28, pad: [52, 56, 59, 62], bell: [68, 71, 76, 80, 83] },
];

let ctx = null, an = null, anBuf = null, master = null, out = null, verb = null, delay = null, timer = null;
let vol = 0.25, muted = false, scene = 'menu', started = false, nextBar = 0, barIdx = 0, running = false;

function impulse(c, sec = 3.2, decay = 2.6) {                       // синтетичен импулс за реверб (затихващ шум)
  const n = Math.floor(c.sampleRate * sec), buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return buf;
}
function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
  out = ctx.createGain(); out.connect(comp); comp.connect(master); master.connect(ctx.destination);
  an = ctx.createAnalyser(); an.fftSize = 2048; anBuf = new Float32Array(2048); master.connect(an);
  verb = ctx.createConvolver(); verb.buffer = impulse(ctx); const vg = ctx.createGain(); vg.gain.value = 0.55; verb.connect(vg); vg.connect(out);
  delay = ctx.createDelay(1.5); delay.delayTime.value = BEAT * 0.75; const fb = ctx.createGain(), dl = ctx.createBiquadFilter(); fb.gain.value = 0.38; dl.type = 'lowpass'; dl.frequency.value = 2600;
  delay.connect(dl); dl.connect(fb); fb.connect(delay); dl.connect(verb); dl.connect(out);
}
const target = () => (muted || scene !== 'menu' ? 0 : vol * 0.55);
function applyGain(tc = 0.4) { if (master) master.gain.setTargetAtTime(target(), ctx.currentTime, tc); }

// ---------- инструменти ----------
function pad(t0, notes, dur) {                                      // бавен пад: две леко разстроени триъгълни/трионообразни вълни през нискочестотен филтър
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.7;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 260; lfo.connect(lg); lg.connect(f.frequency); lfo.start(t0); lfo.stop(t0 + dur + 3);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.1, t0 + 2.2); g.gain.setValueAtTime(0.1, t0 + dur - 0.5); g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 2.5);
  f.connect(g); g.connect(out); g.connect(verb);
  for (const n of notes) for (const [type, det] of [['sawtooth', -7], ['triangle', 6]]) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(n); o.detune.value = det; const og = ctx.createGain(); og.gain.value = type === 'sawtooth' ? 0.2 : 0.4;
    o.connect(og); og.connect(f); o.start(t0); o.stop(t0 + dur + 3);
  }
}
function bass(t0, note, len = 1.1, g0 = 0.34) {                    // нисък бас: синус + тих субхармоник
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = hz(note); o2.frequency.value = hz(note + 12);
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(g0, t0 + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  const g2 = ctx.createGain(); g2.gain.value = 0.18; o.connect(g); o2.connect(g2); g2.connect(g); g.connect(out); o.start(t0); o2.start(t0); o.stop(t0 + len + 0.1); o2.stop(t0 + len + 0.1);
}
function thump(t0, g0 = 0.42) {                                     // мек „удар“ (като далечен барабан)
  const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(95, t0); o.frequency.exponentialRampToValueAtTime(42, t0 + 0.28);
  g.gain.setValueAtTime(g0, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.45);
}
let noiseBuf = null;
function tick(t0, g0 = 0.05) {                                      // много тих шум-хет
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6500; const g = ctx.createGain();
  g.gain.setValueAtTime(g0, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07); s.connect(f); f.connect(g); g.connect(out); s.start(t0); s.stop(t0 + 0.1);
}
function bell(t0, note, g0 = 0.1) {                                 // камбанка: синус + хармоника, мигновено затихване, праща се в забавянето и ревърба
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(g0, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
  for (const [m, a] of [[1, 1], [2.01, 0.3], [3.98, 0.1]]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = hz(note) * m; og.gain.value = a; o.connect(og); og.connect(g); o.start(t0); o.stop(t0 + 2.3); }
  g.connect(delay); g.connect(verb); g.connect(out);
}

// ---------- планировчик (на такт напред) ----------
function scheduleBar(t, idx) {
  const ch = PROG[Math.floor(idx / 2) % PROG.length], first = idx % 2 === 0;
  if (first) pad(t, ch.pad, BAR * 2);
  // пулс: бас на 1 и „и“ на 3, удар на 1 и 3, хет на всяка осма от втората половина
  bass(t, ch.bass, BEAT * 1.6); bass(t + BEAT * 2.5, ch.bass, BEAT * 1.1, 0.24); if (!first && Math.random() < 0.5) bass(t + BEAT * 3.5, ch.bass + 7, BEAT * 0.8, 0.16);
  thump(t, 0.4); thump(t + BEAT * 2, 0.28);
  for (let i = 0; i < 8; i++) if (i % 2 === 1 && (!first || i > 3)) tick(t + i * BEAT * 0.5, 0.025 + 0.015 * (i === 7));
  // рядки камбанки от гамата на акорда
  let tt = t + BEAT * (0.5 + Math.random());
  while (tt < t + BAR - BEAT * 0.5) { if (Math.random() < 0.55) bell(tt, ch.bell[Math.floor(Math.random() * ch.bell.length)], 0.06 + Math.random() * 0.05); tt += BEAT * (1 + Math.floor(Math.random() * 2)) * 0.75; }
}
function pump() {
  if (!running || !ctx) return;
  while (nextBar < ctx.currentTime + 1.2) { scheduleBar(nextBar, barIdx++); nextBar += BAR; }
}

export const music = {
  // първо взаимодействие на потребителя: създава/възобновява контекста и започва, ако сме в менюто
  unlock() {
    try {
      if (!ctx) build();
      if (ctx.state === 'suspended') ctx.resume();
      if (!started) { started = true; this.begin(); }
    } catch { }
  },
  begin() { if (!ctx || running) return; running = true; nextBar = ctx.currentTime + 0.2; pump(); timer = setInterval(pump, 250); applyGain(1.2); },
  halt() { running = false; clearInterval(timer); timer = null; },
  setVolume(v) { vol = Math.max(0, Math.min(1, v)); applyGain(); },
  setMuted(m) { muted = !!m; applyGain(); },
  // 'menu' – звучи; 'game' – плавно затихва (няколко секунди), после спира планировчика и изчиства опашката
  setScene(s) {
    if (s === scene) return; scene = s;
    if (!ctx) return;
    if (s === 'game') { applyGain(0.7); setTimeout(() => { if (scene === 'game') this.halt(); }, 3500); }
    else if (started) { if (ctx.state === 'suspended') ctx.resume(); this.halt(); this.begin(); applyGain(1.0); }
  },
  // ефективна стойност (RMS) на изхода – за проверка, че музиката наистина звучи
  rms() { if (!an) return 0; an.getFloatTimeDomainData(anBuf); let s = 0; for (const v of anBuf) s += v * v; return Math.sqrt(s / anBuf.length); },
  get state() { return { running, scene, vol, muted, ctx: ctx?.state, gain: master?.gain.value }; },
};
document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend?.(); else if (started) ctx.resume?.(); });
