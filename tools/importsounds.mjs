// Копира и преименува звуци от разархивиран CS:GO пакет (папката "sound") в public/sounds/ по имената, които ползва играта.
//   node tools/importsounds.mjs путь/до/csgo-master/sound
// Презарежданията се сглобяват от няколко файла (пълнител навън/навътре, затвор…) в един кратък звук.
// ВНИМАНИЕ: звуците са на Valve – само за лична игра. public/sounds/* е в .gitignore и не се качва в GitHub/Render.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('Използване: node tools/importsounds.mjs <папка sound>'); process.exit(1); }
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/sounds');
const S = p => path.join(src, p);

// ---- WAV (PCM16) -> моно Float32 @44.1k ----
function readWav(file) {
  const b = fs.readFileSync(file); let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), hz: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }; if (id === 'data') { data = b.subarray(o + 8, o + 8 + n); break; } o += 8 + n + (n & 1); }
  if (!fmt || !data || fmt.tag !== 1 || fmt.bits !== 16) throw new Error('неподдържан WAV: ' + file);
  const frames = Math.floor(data.length / 2 / fmt.ch), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2); mono[i] = s / fmt.ch / 32768; }
  return { hz: fmt.hz, data: mono };
}
function writeWav(file, hz, f32) {
  const b = Buffer.alloc(44 + f32.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + f32.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(hz, 24); b.writeUInt32LE(hz * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(f32.length * 2, 40);
  for (let i = 0; i < f32.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
}
const cleanOld = name => { for (const f of fs.readdirSync(OUT)) if (new RegExp('^' + name + '[1-4]?\\.(wav|ogg|mp3)$').test(f)) fs.unlinkSync(path.join(OUT, f)); };
let n = 0;
const copy = (name, rel) => { const f = S(rel); if (!fs.existsSync(f)) { console.warn('липсва', rel); return; } cleanOld(name); fs.copyFileSync(f, path.join(OUT, name + '.wav')); n++; };
const variants = (name, rels) => { cleanOld(name); rels.forEach((rel, i) => { const f = S(rel); if (!fs.existsSync(f)) return console.warn('липсва', rel); fs.copyFileSync(f, path.join(OUT, name + (i + 1) + '.wav')); n++; }); };
// сглобяване: [[файл, пауза преди (сек)], …]
function seq(name, parts, gain = 1) {
  const chunks = []; let hz = 44100, total = 0;
  for (const [rel, gap] of parts) { const f = S(rel); if (!fs.existsSync(f)) { console.warn('липсва', rel); continue; } const w = readWav(f); hz = w.hz; chunks.push([Math.round(gap * hz), w.data]); total += Math.round(gap * hz) + w.data.length; }
  const out = new Float32Array(total); let p = 0; for (const [g, d] of chunks) { p += g; for (let i = 0; i < d.length; i++) out[p + i] = Math.max(-1, Math.min(1, out[p + i] + d[i] * gain)); p += d.length; }
  cleanOld(name); writeWav(path.join(OUT, name + '.wav'), hz, out); n++;
}

const W = 'weapons/';
// ---- оръжия ----
copy('pistol_fire', W + 'hkp2000/hkp2000-1.wav'); copy('deagle_fire', W + 'deagle/deagle-1.wav'); copy('mp9_fire', W + 'mp9/mp9-1.wav');
copy('ak47_fire', W + 'ak47/ak47-1.wav'); copy('nova_fire', W + 'nova/nova-1.wav'); copy('awp_fire', W + 'awp/awp1.wav');
seq('pistol_reload', [[W + 'hkp2000/hkp2000_clipout.wav', 0.05], [W + 'hkp2000/hkp2000_clipin.wav', 0.5], [W + 'hkp2000/hkp2000_sliderelease.wav', 0.35]]);
seq('deagle_reload', [[W + 'deagle/de_clipout.wav', 0.05], [W + 'deagle/de_clipin.wav', 0.55], [W + 'deagle/de_slideforward.wav', 0.4]]);
seq('mp9_reload', [[W + 'mp9/mp9_clipout.wav', 0.05], [W + 'mp9/mp9_clipin.wav', 0.55], [W + 'mp9/mp9_boltforward.wav', 0.4]]);
seq('ak47_reload', [[W + 'ak47/ak47_clipout.wav', 0.05], [W + 'ak47/ak47_clipin.wav', 0.6], [W + 'ak47/ak47_boltpull.wav', 0.45]]);
seq('awp_reload', [[W + 'awp/awp_clipout.wav', 0.05], [W + 'awp/awp_clipin.wav', 0.6], [W + 'awp/awp_boltback.wav', 0.5], [W + 'awp/awp_boltforward.wav', 0.25]]);
seq('nova_reload', [[W + 'nova/nova_insertshell_01.wav', 0.05], [W + 'nova/nova_insertshell_02.wav', 0.45], [W + 'nova/nova_insertshell_03.wav', 0.45], [W + 'nova/nova_pump.wav', 0.4]]);
copy('empty', W + 'clipempty_pistol.wav');
variants('knife_slash', [W + 'knife/knife_slash1.wav', W + 'knife/knife_slash2.wav']); copy('knife_stab', W + 'knife/knife_stab.wav');
variants('knife_hit', [1, 2, 3, 4].map(i => W + `knife/knife_hit${i}.wav`));
copy('grenade_throw', W + 'hegrenade/grenade_throw.wav'); copy('grenade_explode', W + 'hegrenade/explode3.wav');
// ---- бомба ----
copy('bomb_explode', W + 'c4/c4_explode1.wav'); copy('bomb_beep', W + 'c4/c4_beep1.wav');
variants('bomb_plant', [1, 2, 3, 4].map(i => W + `c4/key_press${i}.wav`)); copy('bomb_planted', W + 'c4/c4_plant.wav');
copy('bomb_defuse', W + 'c4/c4_disarm.wav'); copy('bomb_defused', W + 'c4/c4_disarmfinish.wav');
// ---- движение ----
for (const [name, dir, pre] of [['step_stone', 'concrete'], ['step_metal', 'metal'], ['step_wood', 'wood'], ['step_grass', 'grass'], ['step_sand', 'sand'], ['step_snow', 'snow'], ['step_ice', 'tile'], ['step_water', 'wade']])
  variants(name, [1, 2, 3, 4].map(i => `player/footsteps/${dir}${i}.wav`));
variants('land', ['player/land.wav', 'player/land2.wav', 'player/land3.wav']);
variants('hurt', ['player/damage1.wav', 'player/damage2.wav', 'player/damage3.wav']);
variants('hit_head', ['player/headshot1.wav', 'player/headshot2.wav']);
console.log(`Готово: ${n} звука в public/sounds/`);
