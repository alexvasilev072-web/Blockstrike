// Импортер на GoldSrc BSP (v30, CS 1.6 / Half-Life) -> server/maps/<id>.json (тип "bsp").
//   node tools/importbsp.mjs път/до/карта.bsp [id] [име] [описание]
// Изход: геометрия за рендиране (триъгълници с цвят по име на текстурата и осветление от lightmap), оригиналните клипнодове
// на играча (hull 1 = изправен 32x32x72, hull 3 = клекнал 32x32x36) за точна колизия, и обектите: spawn-ове, trigger_push,
// trigger_teleport, стълби, вода. Координатите в JSON остават в единиците на играта (CS единици); клиентът/сървърът ги
// преобразуват в метри (1 м = 40 ед.): (X,Y,Z) = (csX, csZ, -csY) / 40.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , input, idArg, nameArg, descArg] = process.argv;
if (!input) { console.error('Използване: node tools/importbsp.mjs карта.bsp [id] [име] [описание]'); process.exit(1); }
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/maps');
const b = fs.readFileSync(input);
if (b.readInt32LE(0) !== 30) { console.error('Поддържа се само GoldSrc BSP версия 30'); process.exit(1); }

const NAMES = ['entities', 'planes', 'textures', 'vertices', 'visibility', 'nodes', 'texinfo', 'faces', 'lighting', 'clipnodes', 'leaves', 'marksurfaces', 'edges', 'surfedges', 'models'];
const L = {}; NAMES.forEach((n, i) => { L[n] = { ofs: b.readInt32LE(4 + i * 8), len: b.readInt32LE(8 + i * 8) }; });

// ---------- обекти ----------
const entText = b.toString('latin1', L.entities.ofs, L.entities.ofs + L.entities.len).replace(/\0.*/s, '');
const ents = entText.split('}').map(s => s.trim()).filter(Boolean).map(s => { const o = {}; for (const m of s.matchAll(/"([^"]*)"\s+"([^"]*)"/g)) o[m[1]] = m[2]; return o; });
const vec = s => (s || '0 0 0').split(/\s+/).map(Number);

// ---------- равнини, клипнодове ----------
const np = L.planes.len / 20, planes = new Float32Array(np * 4);        // nx,ny,nz,dist
const planeType = new Uint8Array(np);
for (let i = 0; i < np; i++) { const o = L.planes.ofs + i * 20; for (let k = 0; k < 4; k++) planes[i * 4 + k] = b.readFloatLE(o + k * 4); planeType[i] = b.readInt32LE(o + 16); }
const ncn = L.clipnodes.len / 8, cnPlane = new Int32Array(ncn), cnC0 = new Int16Array(ncn), cnC1 = new Int16Array(ncn);
for (let i = 0; i < ncn; i++) { const o = L.clipnodes.ofs + i * 8; cnPlane[i] = b.readInt32LE(o); cnC0[i] = b.readInt16LE(o + 4); cnC1[i] = b.readInt16LE(o + 6); }

// ---------- модели ----------
const nm = L.models.len / 64, models = [];
for (let i = 0; i < nm; i++) {
  const o = L.models.ofs + i * 64, f = k => b.readFloatLE(o + k * 4);
  models.push({ mins: [f(0), f(1), f(2)], maxs: [f(3), f(4), f(5)], origin: [f(6), f(7), f(8)], head: [b.readInt32LE(o + 36), b.readInt32LE(o + 40), b.readInt32LE(o + 44), b.readInt32LE(o + 48)], firstface: b.readInt32LE(o + 56), numfaces: b.readInt32LE(o + 60) });
}

// ---------- геометрия ----------
const nv = L.vertices.len / 12, verts = new Float32Array(nv * 3);
for (let i = 0; i < nv * 3; i++) verts[i] = b.readFloatLE(L.vertices.ofs + i * 4);
const edges = new Uint16Array(L.edges.len / 2); for (let i = 0; i < edges.length; i++) edges[i] = b.readUInt16LE(L.edges.ofs + i * 2);
const surfedges = new Int32Array(L.surfedges.len / 4); for (let i = 0; i < surfedges.length; i++) surfedges[i] = b.readInt32LE(L.surfedges.ofs + i * 4);
const ntx = L.texinfo.len / 40, texinfo = [];
for (let i = 0; i < ntx; i++) { const o = L.texinfo.ofs + i * 40; const v = []; for (let k = 0; k < 8; k++) v.push(b.readFloatLE(o + k * 4)); texinfo.push({ s: v.slice(0, 4), t: v.slice(4, 8), miptex: b.readInt32LE(o + 32), flags: b.readInt32LE(o + 36) }); }
const to = L.textures.ofs, ntex = b.readInt32LE(to), texNames = [];
for (let i = 0; i < ntex; i++) { const off = b.readInt32LE(to + 4 + i * 4); texNames.push(off < 0 ? '' : b.toString('latin1', to + off, to + off + 16).replace(/\0.*/s, '').toLowerCase()); }
const faces = [];
for (let i = 0; i < L.faces.len / 20; i++) { const o = L.faces.ofs + i * 20; faces.push({ plane: b.readUInt16LE(o), side: b.readUInt16LE(o + 2), first: b.readInt32LE(o + 4), n: b.readUInt16LE(o + 8), tex: b.readUInt16LE(o + 10), light: b.readInt32LE(o + 16) }); }

// цвят по име на текстурата (оригиналните текстури са във WAD, който липсва)
function texColor(name) {
  const n = name.replace(/^[-+~{!]\d?/, '');
  const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const pal = (h, base, spread) => base.map((v, i) => Math.max(0, Math.min(255, v + (((h >> (i * 5)) & 31) - 16) * spread)));
  if (/sky/.test(n)) return null;
  if (/^(clip|null|origin|aaatrigger|trigger|black|bevel|hint|skip)/.test(n) || /trigger/.test(n)) return null;
  const h = hash(n);
  if (/water|slime/.test(name)) return { c: [40, 110, 200], alpha: 0.55 };
  if (/glass|spot|laser/.test(n)) return { c: pal(h, [120, 200, 230], 2), alpha: 0.5 };
  if (/crete|concrete|wall|brd|stair/.test(n)) return { c: pal(h, [140, 142, 150], 2) };
  if (/fifties|fifts/.test(n)) return { c: pal(h, [196, 176, 120], 3) };
  if (/crate|wood|drawer|dskdrwr/.test(n)) return { c: pal(h, [150, 104, 60], 3) };
  if (/tech|metal|mtl|babtech|dr\d|lab|gar|vat/.test(n)) return { c: pal(h, [96, 112, 130], 3) };
  if (/ice|frost|snow|icicle/.test(n)) return { c: pal(h, [196, 226, 244], 2) };
  if (/bars|grate|razor|^\{/.test(name)) return { c: [90, 90, 96], alpha: 0.8 };
  return { c: pal(h, [150, 150, 160], 3) };
}
// среден тон на lightmap-а на лицето (0..1)
function faceLight(f, pts) {
  if (f.light < 0 || !L.lighting.len) return 0.85;
  const ti = texinfo[f.tex]; let smin = 1e9, smax = -1e9, tmin = 1e9, tmax = -1e9;
  for (const p of pts) { const s = p[0] * ti.s[0] + p[1] * ti.s[1] + p[2] * ti.s[2] + ti.s[3], t = p[0] * ti.t[0] + p[1] * ti.t[1] + p[2] * ti.t[2] + ti.t[3]; smin = Math.min(smin, s); smax = Math.max(smax, s); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
  const w = Math.ceil(smax / 16) - Math.floor(smin / 16) + 1, h = Math.ceil(tmax / 16) - Math.floor(tmin / 16) + 1;
  let sum = 0, cnt = 0; const o = L.lighting.ofs + f.light;
  for (let i = 0; i < w * h && o + i * 3 + 2 < b.length; i++) { sum += (b[o + i * 3] + b[o + i * 3 + 1] + b[o + i * 3 + 2]) / 3; cnt++; }
  const avg = cnt ? sum / cnt / 255 : 0.8;
  return Math.max(0.3, Math.min(1.1, 0.32 + 0.9 * Math.pow(avg, 0.75)));
}

// кои модели се рисуват и колко прозрачни са
const RENDER_CLASSES = new Set(['worldspawn', 'func_wall', 'func_illusionary', 'func_door', 'func_door_rotating', 'func_breakable', 'func_pushable', 'func_button', 'func_water', 'func_conveyor']);
const modelEnt = new Map(); // model index -> entity
for (const e of ents) if (e.model && e.model[0] === '*') modelEnt.set(+e.model.slice(1), e);
modelEnt.set(0, { classname: 'worldspawn' });

const pos = [], col = [], idx = [], alphaPos = [], alphaCol = [], alphaIdx = [];
const toGame = (x, y, z) => [x / 40, z / 40, -y / 40];
for (const [mi, e] of modelEnt) {
  if (!RENDER_CLASSES.has(e.classname)) continue;
  const m = models[mi], off = vec(e.origin);
  for (let fi = m.firstface; fi < m.firstface + m.numfaces; fi++) {
    const f = faces[fi], name = texNames[texinfo[f.tex].miptex] || '';
    const tc = texColor(name); if (!tc) continue;
    const pts = [];
    for (let k = 0; k < f.n; k++) {
      const se = surfedges[f.first + k], ei = Math.abs(se), v = se >= 0 ? edges[ei * 2] : edges[ei * 2 + 1];
      pts.push([verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]]);
    }
    if (pts.length < 3) continue;
    const pn = [planes[f.plane * 4], planes[f.plane * 4 + 1], planes[f.plane * 4 + 2]], sg = f.side ? -1 : 1;
    const nrm = toGame(pn[0] * sg * 40, pn[1] * sg * 40, pn[2] * sg * 40);                  // нормала в игровите оси
    const lt = faceLight(f, pts), shade = (0.78 + 0.22 * Math.max(0, nrm[1])) * lt;
    const target = tc.alpha ? { pos: alphaPos, col: alphaCol, idx: alphaIdx } : { pos, col, idx };
    const base = target.pos.length / 3;
    for (const p of pts) { const g = toGame(p[0] + off[0], p[1] + off[1], p[2] + off[2]); target.pos.push(g[0], g[1], g[2]); target.col.push(Math.round(Math.min(255, tc.c[0] * shade)), Math.round(Math.min(255, tc.c[1] * shade)), Math.round(Math.min(255, tc.c[2] * shade))); }
    // триъгълници по ръба на лицето; ориентацията се подрежда спрямо нормалата
    for (let k = 1; k < pts.length - 1; k++) {
      const a = k === 1 ? 0 : 0, tri = [a, k, k + 1];
      const P = tri.map(i => target.pos.slice((base + i) * 3, (base + i) * 3 + 3));
      const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2], vx = P[2][0] - P[0][0], vy = P[2][1] - P[0][1], vz = P[2][2] - P[0][2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * nrm[0] + cy * nrm[1] + cz * nrm[2] >= 0) target.idx.push(base + tri[0], base + tri[1], base + tri[2]); else target.idx.push(base + tri[0], base + tri[2], base + tri[1]);
      if (tc.alpha) target.idx.push(base + tri[0], base + tri[2], base + tri[1]);      // прозрачните са двустранни
    }
  }
}
const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');

// ---------- обекти за играта ----------
const aabb = (m, e) => { const off = vec(e.origin); return { min: m.mins.map((v, i) => v + off[i]), max: m.maxs.map((v, i) => v + off[i]) }; };
const targets = {}; for (const e of ents) if (e.targetname && e.origin && !e.model) targets[e.targetname] = { origin: vec(e.origin), angles: vec(e.angles) };
const movedir = (angles, e) => { // UTIL_SetMovedir
  const [p, y] = angles; if (p === 0 && y === -1) return [0, 0, 1]; if (p === 0 && y === -2) return [0, 0, -1];
  const cp = Math.cos(p * Math.PI / 180), sp = Math.sin(p * Math.PI / 180), cy = Math.cos(y * Math.PI / 180), sy = Math.sin(y * Math.PI / 180);
  return [cp * cy, cp * sy, -sp];
};
const pushes = [], teleports = [], ladders = [], waters = [], solids = [];
for (const [mi, e] of modelEnt) {
  if (mi === 0) continue; const m = models[mi];
  if (e.classname === 'trigger_push') pushes.push({ ...aabb(m, e), dir: movedir(vec(e.angles), e), speed: +e.speed || 100, once: !!(+e.spawnflags & 1) });
  else if (e.classname === 'trigger_teleport' && targets[e.target]) teleports.push({ ...aabb(m, e), to: targets[e.target].origin, yaw: targets[e.target].angles[1] || 0, name: e.target });
  else if (e.classname === 'func_ladder') ladders.push(aabb(m, e));
  else if (e.classname === 'func_water') waters.push(aabb(m, e));
  else if (['func_wall', 'func_door', 'func_breakable', 'func_pushable', 'func_button'].includes(e.classname) && !(+e.spawnflags & 0 && 0)) solids.push({ head: m.head.slice(1), origin: vec(e.origin), cls: e.classname, ...aabb(m, e) });
}
const startsRaw = ents.filter(e => e.classname === 'info_player_start' || e.classname === 'info_player_deathmatch' || e.classname === 'info_player_terrorist');
const spawns = startsRaw.map(e => { const o = vec(e.origin), g = toGame(o[0], o[1], o[2] - 36); return [g[0], g[2], g[1], vec(e.angles)[1] || 0]; });   // [X, Z, Y(крака), yaw°]
const w0 = models[0];
const id = idArg || path.basename(input, '.bsp'), mn = toGame(w0.mins[0], w0.mins[1], w0.mins[2]), mx = toGame(w0.maxs[0], w0.maxs[1], w0.maxs[2]);
const out = {
  id, name: nameArg || id, description: descArg || 'GoldSrc карта', mode: 'surf', type: 'bsp', free: true, order: 9,
  scale: 40, level: 'CS 1.6',
  size: [1, 1, 1], ops: [],
  bounds: { min: [Math.min(mn[0], mx[0]), Math.min(mn[1], mx[1]), Math.min(mn[2], mx[2])], max: [Math.max(mn[0], mx[0]), Math.max(mn[1], mx[1]), Math.max(mn[2], mx[2])] },
  env: { sky: '#7fa8d8', fogColor: '#9cbbe0', fog: [150, 420], ambient: 0.5, sun: 1, ground: '#304860' },
  spawns: { att: spawns.map(s => [s[0], s[1], s[2]]), def: spawns.map(s => [s[0], s[1], s[2]]) }, startYaw: spawns[0] ? (spawns[0][3] - 90) * Math.PI / 180 : 0,
  sites: {}, killY: -1e9, drive: [0, 0, 0],
  bsp: {
    planes: b64(planes), planeType: b64(planeType), cnPlane: b64(cnPlane), cnC0: b64(cnC0), cnC1: b64(cnC1),
    hulls: { 1: models[0].head[1], 3: models[0].head[3] },
    solids: solids.map(s => ({ min: s.min, max: s.max, origin: s.origin, hull1: s.head[0], hull3: s.head[2], cls: s.cls })),
    pushes, teleports, ladders, waters,
  },
  mesh: { pos: b64(new Float32Array(pos)), col: b64(new Uint8Array(col)), idx: b64(new Uint32Array(idx)), n: pos.length / 3,
    apos: b64(new Float32Array(alphaPos)), acol: b64(new Uint8Array(alphaCol)), aidx: b64(new Uint32Array(alphaIdx)), an: alphaPos.length / 3 },
};
fs.writeFileSync(path.join(OUT, id + '.json'), JSON.stringify(out));
console.log(`${id}: ${(fs.statSync(path.join(OUT, id + '.json')).size / 1024).toFixed(0)} KB; върхове ${pos.length / 3} (+${alphaPos.length / 3} прозрачни), триъгълници ${idx.length / 3}`);
console.log(`spawn-ове ${spawns.length}, trigger_push ${pushes.length}, teleport ${teleports.length}, стълби ${ladders.length}, вода ${waters.length}, плътни обекти ${solids.length}`);
console.log('граници (м):', JSON.stringify(out.bounds), 'hull корени', JSON.stringify(out.bsp.hulls));
