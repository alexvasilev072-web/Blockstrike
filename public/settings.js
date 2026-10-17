// Настройки на играча (localStorage): мишка, FOV, звук, мерник, графика.
import { audio } from './audio.js';
import { music } from './music.js';

const KEY = 'bs_settings';
export const DEFAULTS = { sens: 1, invert: false, fov: 75, vol: 0.7, volFx: 1, volSteps: 1, crossColor: '#5dff7a', crossSize: 8, quality: 'high', showFps: true, retro: false, realistic: true, vmScale: 1, fpsLimit: 0, voice: true, voiceVol: 1, micId: '', pttKey: 'KeyV', musicVol: 0.25, musicMuted: false, controls: 'auto' };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    const legacyVol = parseFloat(localStorage.getItem('bs_vol'));
    return { ...DEFAULTS, ...(Number.isFinite(legacyVol) && s.vol === undefined ? { vol: legacyVol } : {}), ...s };
  } catch { return { ...DEFAULTS }; }
}
// живият обект – клиентът го чете директно
export const settings = load();
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(+v) ? +v : a));
let onChange = () => { };

function sanitize() {
  settings.sens = clamp(settings.sens, 0.1, 5); settings.fov = clamp(settings.fov, 60, 110);
  settings.vol = clamp(settings.vol, 0, 1); settings.volFx = clamp(settings.volFx, 0, 1); settings.volSteps = clamp(settings.volSteps, 0, 1);
  settings.crossSize = clamp(settings.crossSize, 3, 24);
  if (!['low', 'medium', 'high'].includes(settings.quality)) settings.quality = 'high';
  if (!/^#[0-9a-f]{6}$/i.test(settings.crossColor)) settings.crossColor = DEFAULTS.crossColor;
  settings.invert = !!settings.invert; settings.showFps = !!settings.showFps; settings.retro = !!settings.retro; settings.realistic = settings.realistic !== false; settings.vmScale = clamp(settings.vmScale, 0.6, 1.3); settings.fpsLimit = [0, 60, 144, 240].includes(+settings.fpsLimit) ? +settings.fpsLimit : 0;
  if (!['auto', 'touch', 'desktop'].includes(settings.controls)) settings.controls = 'auto';
  settings.musicVol = clamp(settings.musicVol, 0, 1); settings.musicMuted = !!settings.musicMuted;
  settings.voice = settings.voice !== false; settings.voiceVol = clamp(settings.voiceVol, 0, 1); settings.micId = String(settings.micId || ''); if (!/^[A-Za-z0-9]{1,24}$/.test(String(settings.pttKey))) settings.pttKey = 'KeyV';
}

const $ = s => document.querySelector(s);
export const keyLabel = c => String(c).replace(/^Key/, '').replace(/^Digit/, '').replace('Backquote', '`').replace('Space', 'Интервал');
function apply(save = true) {
  sanitize();
  audio.setVolume(settings.vol); audio.setMix({ fx: settings.volFx, steps: settings.volSteps }); audio.setRetro(settings.retro);
  music.setVolume(settings.musicVol); music.setMuted(settings.musicMuted);
  const r = document.documentElement.style;
  r.setProperty('--cc', settings.crossColor); r.setProperty('--cl', settings.crossSize + 'px');
  const fps = $('#fps'); if (fps) fps.style.display = settings.showFps ? '' : 'none';
  if (save) { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { } }
  onChange(settings);
}

function sync() {   // от обекта към контролите
  $('#setSens').value = settings.sens; $('#setSensN').value = settings.sens.toFixed(2);
  $('#setInvert').checked = settings.invert;
  $('#setFov').value = settings.fov; $('#setFovV').textContent = settings.fov;
  for (const [id, k] of [['setVol', 'vol'], ['setVolFx', 'volFx'], ['setVolSteps', 'volSteps']]) { $('#' + id).value = Math.round(settings[k] * 100); $('#' + id + 'V').textContent = Math.round(settings[k] * 100) + '%'; }
  $('#setCrossCol').value = settings.crossColor; $('#setCrossSize').value = settings.crossSize; $('#setCrossSizeV').textContent = settings.crossSize + 'px';
  $('#setQuality').value = settings.quality; $('#setFps').checked = settings.showFps; $('#setRetro').checked = settings.retro; $('#setReal').checked = settings.realistic; $('#setFpsLim').value = String(settings.fpsLimit); $('#setControls').value = settings.controls; $('#setMusic').value = Math.round(settings.musicVol * 100); $('#setMusicV').textContent = settings.musicMuted ? 'изкл.' : Math.round(settings.musicVol * 100) + '%'; if ($('#musicVol')) { $('#musicVol').value = Math.round(settings.musicVol * 100); $('#musicBtn').textContent = settings.musicMuted || settings.musicVol === 0 ? '🔇' : '🔊'; } $('#setVoice').checked = settings.voice; $('#setVoiceVol').value = Math.round(settings.voiceVol * 100); $('#setVoiceVolV').textContent = Math.round(settings.voiceVol * 100) + '%'; $('#setPtt').textContent = keyLabel(settings.pttKey); if ($('#setMic').value !== settings.micId && [...$('#setMic').options].some(o => o.value === settings.micId)) $('#setMic').value = settings.micId; $('#setVm').value = Math.round(settings.vmScale * 100); $('#setVmV').textContent = Math.round(settings.vmScale * 100) + '%';
  document.querySelectorAll('.vol').forEach(o => { o.value = Math.round(settings.vol * 100); });
}

export function openSettings() { sync(); $('#settings').classList.remove('hidden'); }
export function closeSettings() { $('#settings').classList.add('hidden'); }

export function initSettings(cb) {
  onChange = cb || onChange;
  const bind = (id, fn, ev = 'input') => $('#' + id).addEventListener(ev, e => { fn(e.target); apply(); sync(); });
  bind('setSens', el => { settings.sens = +el.value; });
  bind('setSensN', el => { settings.sens = +el.value; }, 'change');
  bind('setInvert', el => { settings.invert = el.checked; }, 'change');
  bind('setFov', el => { settings.fov = +el.value; });
  bind('setVol', el => { settings.vol = el.value / 100; audio.init(); });
  bind('setVolFx', el => { settings.volFx = el.value / 100; });
  bind('setVolSteps', el => { settings.volSteps = el.value / 100; });
  bind('setRetro', el => { settings.retro = el.checked; audio.init(); }, 'change');
  bind('setCrossCol', el => { settings.crossColor = el.value; });
  bind('setCrossSize', el => { settings.crossSize = +el.value; });
  bind('setQuality', el => { settings.quality = el.value; }, 'change');
  bind('setFps', el => { settings.showFps = el.checked; }, 'change');
  bind('setReal', el => { settings.realistic = el.checked; }, 'change');
  bind('setVm', el => { settings.vmScale = el.value / 100; });
  bind('setMusic', el => { settings.musicVol = el.value / 100; settings.musicMuted = false; music.unlock(); });
  bind('setFpsLim', el => { settings.fpsLimit = +el.value; }, 'change');
  bind('setControls', el => { settings.controls = el.value; }, 'change');
  bind('setVoice', el => { settings.voice = el.checked; }, 'change');
  bind('setVoiceVol', el => { settings.voiceVol = el.value / 100; });
  bind('setMic', el => { settings.micId = el.value; }, 'change');
  $('#setPtt').onclick = () => {                                        // смяна на клавиша за говорене
    const b = $('#setPtt'); b.textContent = 'Натисни клавиш…';
    const h = e => { e.preventDefault(); e.stopPropagation(); removeEventListener('keydown', h, true); if (e.code !== 'Escape') { settings.pttKey = e.code; apply(); } sync(); };
    addEventListener('keydown', h, true);
  };
  // малкият контрол горе вдясно (меню/лоби): иконата заглушава/пуска, плъзгачът е силата на музиката
  $('#musicBtn').onclick = () => { music.unlock(); settings.musicMuted = !settings.musicMuted; if (!settings.musicMuted && settings.musicVol === 0) settings.musicVol = 0.25; apply(); sync(); };
  $('#musicVol').oninput = e => { settings.musicVol = e.target.value / 100; settings.musicMuted = false; music.unlock(); apply(); sync(); };
  $('#setReset').onclick = () => { Object.assign(settings, DEFAULTS); apply(); sync(); };
  $('#setClose').onclick = closeSettings;
  document.querySelectorAll('.settingsOpen').forEach(b => b.onclick = openSettings);
  // плъзгачите за звук във входа/лобито са общата сила на звука
  document.querySelectorAll('.vol').forEach(el => { el.oninput = () => { settings.vol = el.value / 100; audio.init(); apply(); sync(); }; });
  sync(); apply(false);
}
