// Конвертира WAV звуците в public/sounds в OGG (Vorbis) + MP3 резервен вариант (за браузъри без OGG) с ffmpeg.
//   node tools/convertsounds.mjs [--delete]      (ffmpeg от PATH или от променливата FFMPEG=път/до/ffmpeg)
// OGG остават в public/sounds/<име>.ogg, MP3 – в public/sounds/mp3/<име>.mp3. С --delete оригиналните WAV се трият.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/sounds'), FF = process.env.FFMPEG || 'ffmpeg';
const del = process.argv.includes('--delete');
fs.mkdirSync(path.join(DIR, 'mp3'), { recursive: true });
let n = 0, before = 0, after = 0, after2 = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!/\.wav$/i.test(f)) continue;
  const base = f.replace(/\.wav$/i, ''), src = path.join(DIR, f), ogg = path.join(DIR, base + '.ogg'), mp3 = path.join(DIR, 'mp3', base + '.mp3');
  const common = ['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '44100'];
  let r = spawnSync(FF, [...common, '-c:a', 'libvorbis', '-q:a', '3', ogg]);
  if (r.status !== 0) { console.error('OGG грешка за', f, String(r.stderr || r.error)); process.exit(1); }
  r = spawnSync(FF, [...common, '-c:a', 'libmp3lame', '-b:a', '80k', mp3]);
  if (r.status !== 0) { console.error('MP3 грешка за', f, String(r.stderr || r.error)); process.exit(1); }
  before += fs.statSync(src).size; after += fs.statSync(ogg).size; after2 += fs.statSync(mp3).size; n++;
  if (del) fs.unlinkSync(src);
}
const mb = v => (v / 1048576).toFixed(2) + ' MB';
console.log(`Конвертирани ${n} файла: WAV ${mb(before)} -> OGG ${mb(after)} (+ MP3 резерв ${mb(after2)})`);
