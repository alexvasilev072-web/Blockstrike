// Радар: въртящ се около играча, показва стените от картата, съотборниците, носителя на бомбата и бомбата.
import { DEFS, SOLID, IS_WEDGE } from '/shared/world.js';
import { BLOCK_TILES } from './textures.js';

const SC = 4;            // пиксела на метър в кеша на картата
const VIEW = 3.2;        // пиксела на метър на екрана (180px ≈ 56 м)
let cache = null, cacheKey = '', dirty = true;

export function markRadarDirty() { dirty = true; }

function bake(world, atlas) {
  const cv = cache?.cv && cache.w === world.sx && cache.h === world.sz ? cache.cv : document.createElement('canvas');
  cv.width = world.sx * SC; cv.height = world.sz * SC;
  const g = cv.getContext('2d'), img = g.createImageData(cv.width, cv.height);
  for (let z = 0; z < world.sz; z++) for (let x = 0; x < world.sx; x++) {
    let top = -1, id = 0, water = false;
    for (let y = world.sy - 1; y >= 0; y--) { const b = world.data[(y * world.sz + z) * world.sx + x]; if (b && (SOLID[b] || IS_WEDGE[b])) { top = y; id = b; break; } if (b === 22) water = true; }
    let c = [18, 20, 26];
    if (top >= 0) {
      const a = atlas.avg[BLOCK_TILES[DEFS[id].name]?.side] || [120, 120, 120];
      const k = top >= 3 ? 0.42 : top >= 2 ? 0.62 : 0.95;      // високите стени са по-тъмни, подът е светъл
      c = [a[0] * k, a[1] * k, a[2] * k];
      if (water && top < 2) c = [40, 90, 150];
    } else if (water) c = [40, 90, 150];
    for (let j = 0; j < SC; j++) for (let i = 0; i < SC; i++) {
      const o = ((z * SC + j) * cv.width + (x * SC + i)) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  cache = { cv, w: world.sx, h: world.sz }; dirty = false;
}

// S: състоянието на клиента; follow: {x,z,yaw} на центъра (играч или наблюдаван съотборник)
export function drawRadar(canvas, S, atlas, follow, teamCols) {
  if (!S.world) return;
  if (dirty || !cache) bake(S.world, atlas);
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2, r = W / 2 - 2;
  g.clearRect(0, 0, W, H);
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
  g.translate(cx, cy); g.rotate(follow.yaw); g.scale(VIEW / SC, VIEW / SC); g.translate(-follow.x * SC, -follow.z * SC);
  g.imageSmoothingEnabled = false; g.drawImage(cache.cv, 0, 0);
  const P = (x, z) => [x * SC, z * SC];
  // бомбени точки
  g.font = 'bold 34px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [n, [x1, z1, x2, z2]] of Object.entries(S.mapJson?.sites || {})) {
    const [px, pz] = P((x1 + x2 + 1) / 2, (z1 + z2 + 1) / 2);
    g.save(); g.translate(px, pz); g.rotate(-follow.yaw); g.fillStyle = 'rgba(255,211,77,.35)'; g.beginPath(); g.arc(0, 0, 18, 0, 7); g.fill();
    g.fillStyle = '#ffd34d'; g.fillText(n, 0, 2); g.restore();
  }
  const blink = (performance.now() % 700) < 350;
  const snap = S.snap;
  // паднала бомба (само за нападателите) и заложена бомба (за всички)
  if (S.me.bd && S.me.tm === 'att') { const [px, pz] = P(S.me.bd.x, S.me.bd.z); g.fillStyle = blink ? '#fff' : '#ff3b30'; g.fillRect(px - 8, pz - 8, 16, 16); }
  if (snap?.bomb) { const [px, pz] = P(snap.bomb.x, snap.bomb.z); g.fillStyle = blink ? '#fff' : '#ff3b30'; g.beginPath(); g.arc(px, pz, 14, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 3; g.stroke(); }
  // съотборници
  if (snap) for (const p of snap.pl) {
    if (!p.al || p.tm !== S.me.tm) continue;
    const self = p.i === S.id;
    const pos = self ? { x: S.pos.x, z: S.pos.z, yw: S.yaw } : { x: p.x, z: p.z, yw: p.yw };
    const [px, pz] = P(pos.x, pos.z);
    g.save(); g.translate(px, pz); g.rotate(-pos.yw);   // посока на поглед
    g.fillStyle = self ? '#ffffff' : teamCols[p.tm];
    g.beginPath(); g.moveTo(0, -15); g.lineTo(10, 10); g.lineTo(0, 5); g.lineTo(-10, 10); g.closePath(); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2.5; g.stroke();
    if (p.bm) { g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(0, 18, 7, 0, 7); g.fill(); }
    g.restore();
  }
  g.restore();
  g.strokeStyle = '#2f3a4c'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
}
