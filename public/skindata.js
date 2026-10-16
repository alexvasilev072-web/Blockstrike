// Процедурни пикселни скинове (оригинални дизайни). Всеки скин е функция (x,y,z,base) -> [r,g,b],
// извиквана за всеки "основен" воксел на оръжието (ключове 'a' и 'w'). Координатите са воксел координати на модела.
const h3 = (x, y, z, s = 0) => {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041) ^ Math.imul(s | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296;
};
const sm = t => t * t * (3 - 2 * t);
function vn3(x, y, z, sc, seed) {
  const u = x / sc, v = y / sc, w = z / sc, ix = Math.floor(u), iy = Math.floor(v), iz = Math.floor(w), fx = sm(u - ix), fy = sm(v - iy), fz = sm(w - iz);
  const L = (a, b, c) => h3(a, b, c, seed), lerp = (a, b, t) => a + (b - a) * t;
  return lerp(lerp(lerp(L(ix, iy, iz), L(ix + 1, iy, iz), fx), lerp(L(ix, iy + 1, iz), L(ix + 1, iy + 1, iz), fx), fy),
    lerp(lerp(L(ix, iy, iz + 1), L(ix + 1, iy, iz + 1), fx), lerp(L(ix, iy + 1, iz + 1), L(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
const hsv = (h, s, v) => { const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; return [m[0] * 255, m[1] * 255, m[2] * 255]; };

export const SKINS = {
  default: { name: 'Стандартен', fn: (x, y, z, b) => b },

  neon_snake: { name: 'Неонова змия', fn: (x, y, z, b) => {
    const d = Math.sin((z * 0.42 + Math.sin(x * 0.5 + y * 0.35) * 2.2) + y * 0.2);
    const scale = ((x * 3 + z + y * 2) >> 1) & 1;
    if (d > 0.62) return scale ? [150, 255, 60] : [90, 230, 40];
    if (d > 0.5) return [20, 70, 30];
    return mul([22, 28, 30], 0.85 + h3(x, y, z, 1) * 0.3);
  } },

  lava: { name: 'Лава', fn: (x, y, z, b) => {
    const n = vn3(x, y, z, 4.5, 3), m = vn3(x, y, z, 2.2, 4), r = Math.abs(n - 0.5) * 2;
    if (r < 0.13) return mix([255, 210, 60], [255, 120, 20], (m + h3(x, y, z, 5) * 0.4) % 1);
    if (r < 0.2) return [200, 60, 20];
    return mul([46, 38, 36], 0.7 + m * 0.7);
  } },

  forest_camo: { name: 'Камуфлаж гора', fn: (x, y, z, b) => {
    const n = vn3(x, y, z, 5, 6), m = vn3(x + 40, y, z, 3.4, 7);
    let c = n < 0.38 ? [52, 68, 38] : n < 0.58 ? [88, 100, 54] : [38, 46, 30];
    if (m > 0.7) c = [110, 84, 52];
    return mul(c, 0.9 + h3(x, y, z, 8) * 0.2);
  } },

  gold: { name: 'Злато', fn: (x, y, z, b) => {
    const k = 0.85 + Math.sin(z * 0.35 + y * 0.6) * 0.1 + h3(x, y, z, 9) * 0.12, shine = vn3(x, y, z, 3, 10) > 0.74 ? 1.25 : 1;
    return mul([232, 184, 52], k * shine);
  } },

  pixel_rainbow: { name: 'Пиксел дъга', fn: (x, y, z, b) => {
    const px = Math.floor(z / 3), py = Math.floor((y + x * 0.5) / 3);
    const h = ((px * 0.09 + py * 0.05 + h3(px, py, 11) * 0.12) % 1 + 1) % 1;
    return hsv(h, 0.85, 0.96);
  } },

  night_sky: { name: 'Нощно небе', fn: (x, y, z, b) => {
    const g = Math.min(1, Math.max(0, (y + 10) / 28));
    let c = mix([14, 14, 52], [60, 28, 98], g);
    const cl = vn3(x, y, z, 4, 12); if (cl > 0.66) c = mix(c, [110, 60, 150], (cl - 0.66) * 3);
    const s = h3(x, y, z, 13); if (s > 0.955) return [255, 252, 220]; if (s > 0.935) return [150, 160, 220];
    return c;
  } },

  ice_crystal: { name: 'Леден кристал', fn: (x, y, z, b) => {
    const n = vn3(x, y, z, 3.2, 14), r = Math.abs(vn3(x, y, z, 5, 15) - 0.5) * 2;
    let c = mix([150, 210, 245], [210, 240, 255], n);
    if (r < 0.1) c = [255, 255, 255]; else if (r < 0.17) c = [100, 170, 225];
    if (h3(x, y, z, 16) > 0.97) c = [255, 255, 255];
    return c;
  } },

  rust: { name: 'Ръжда', fn: (x, y, z, b) => {
    const n = vn3(x, y, z, 3.6, 17), m = vn3(x, y, z, 1.8, 18);
    let c = n > 0.56 ? mix([150, 74, 34], [104, 48, 26], m) : mix([112, 108, 100], [150, 90, 50], n * 1.8);
    if (h3(x, y, z, 19) > 0.93) c = [72, 36, 22];
    return mul(c, 0.9 + h3(x, y, z, 20) * 0.2);
  } },
};

// ---------- по-добри скинове (детайл на 5 мм) ----------
const fract = v => v - Math.floor(v);
const fbm = (x, y, z, sc, seed) => vn3(x, y, z, sc, seed) * 0.55 + vn3(x, y, z, sc * 0.5, seed + 7) * 0.3 + vn3(x, y, z, sc * 0.25, seed + 13) * 0.15;
const grad = (stops, t) => { t = Math.max(0, Math.min(0.9999, t)); const n = stops.length - 1, f = t * n, i = Math.floor(f); return mix(stops[i], stops[i + 1], sm(f - i)); };
const NEW = {
  carbon: { name: 'Карбон', fn: (x, y, z) => {
    const u = Math.floor(z / 1.6), v = Math.floor(y / 1.6), cell = (u + v) & 1;
    const wv = cell ? Math.sin(z * 2.0) * 0.5 + 0.5 : Math.sin(y * 2.0 + 1.5) * 0.5 + 0.5, sheen = vn3(x, y, z, 7, 40) > 0.7 ? 26 : 0, b = 24 + wv * 26 + sheen;
    return [b, b, b + 5];
  } },
  fade: { name: 'Преливане', fn: (x, y, z) => {
    const t = Math.max(0, Math.min(1, (z + 70) / 140 + (vn3(x, y, z, 6, 41) - 0.5) * 0.12));
    return mul(grad([[255, 172, 38], [255, 92, 90], [222, 70, 190], [96, 90, 245], [60, 150, 255]], t), 0.94 + h3(x, y, z, 42) * 0.08);
  } },
  case_hard: { name: 'Закалена синя стомана', fn: (x, y, z) => {
    const w = fbm(x + vn3(x, y, z, 5, 43) * 6, y, z + vn3(x, y, z, 5, 44) * 6, 6, 45);
    return mul(grad([[16, 28, 88], [36, 68, 214], [118, 64, 206], [244, 206, 92], [36, 68, 214], [16, 28, 88]], fract(w * 1.7)), 0.92 + h3(x, y, z, 46) * 0.1);
  } },
  damascus: { name: 'Дамаска стомана', fn: (x, y, z) => {
    const q = z * 0.2 + y * 0.12 + fbm(x * 1.2, y * 1.2, z * 1.2, 6, 47) * 5, band = Math.sin(q * 6.28) * 0.5 + 0.5;
    return mul(grad([[46, 50, 58], [126, 132, 144], [62, 66, 74], [176, 182, 194]], band), 0.94 + h3(x, y, z, 48) * 0.08);
  } },
  urban: { name: 'Градски цифров камуфлаж', fn: (x, y, z) => {
    const cx = Math.floor(x / 2), cy = Math.floor(y / 2), cz = Math.floor(z / 2), n = vn3(cx, cy, cz, 3, 49), m = vn3(cx + 30, cy, cz, 1.8, 50);
    return n < 0.3 ? [34, 36, 40] : n < 0.55 ? [92, 96, 102] : n < 0.78 ? [138, 142, 148] : m > 0.5 ? [60, 64, 70] : [172, 176, 180];
  } },
  desert: { name: 'Пустинен камуфлаж', fn: (x, y, z) => {
    const n = fbm(x, y, z, 7, 51), m = vn3(x + 50, y, z, 3.2, 52);
    let c = n < 0.38 ? [112, 88, 58] : n < 0.58 ? [196, 168, 118] : [214, 192, 144];
    if (m > 0.72) c = [104, 106, 70];
    return mul(c, 0.92 + h3(x, y, z, 53) * 0.14);
  } },
  protocol: { name: 'Протокол', fn: (x, y, z) => {
    const cz = Math.floor((z + 200) / 9), cy = Math.floor((y + 40) / 5), hh = h3(cz, cy, 54);
    if (fract((z + 200) / 9) < 0.12 || fract((y + 40) / 5) < 0.14) return [28, 28, 32];
    if (hh < 0.46) return mul([238, 238, 234], 0.95 + h3(x, y, z, 55) * 0.06);
    if (hh < 0.76) return mul([238, 114, 24], 0.95 + h3(x, y, z, 56) * 0.06);
    if (hh < 0.9) return [172, 176, 184];
    return h3(Math.floor(z / 2), Math.floor(y / 2), 57) > 0.6 ? [26, 26, 30] : [216, 216, 212];
  } },
  dragon: { name: 'Драконови люспи', fn: (x, y, z) => {
    const gx = z / 3.4, gy = y / 3.4 + (Math.floor(gx) & 1) * 0.5, fx = fract(gx) - 0.5, fy = fract(gy) - 0.5, d = Math.hypot(fx, fy), id = h3(Math.floor(gx), Math.floor(gy), 58);
    if (d > 0.46) return [14, 30, 22];
    const hl = Math.max(0, 0.5 - Math.hypot(fx + 0.18, fy - 0.2) * 1.4), c = mix([22, 110, 62], [214, 176, 52], Math.min(1, id * 0.5 + (1 - d * 2) * 0.35));
    return mul(c, 0.8 + hl * 0.7);
  } },
  chrome: { name: 'Хром', fn: (x, y, z) => {
    const t = fract(y * 0.18 + z * 0.012 + vn3(x, y, z, 8, 59) * 0.25);
    return mul(grad([[236, 240, 248], [132, 152, 184], [38, 44, 56], [176, 188, 210], [236, 240, 248]], t), 0.96 + h3(x, y, z, 60) * 0.06);
  } },
  gunmetal: { name: 'Оръжейна стомана', fn: (x, y, z) => {
    let c = mix([40, 50, 70], [70, 84, 108], Math.max(0, Math.min(1, (y + 6) / 22)) * 0.8);
    if (vn3(x, y, z, 2.4, 61) > 0.8) c = mix(c, [168, 174, 186], 0.8);
    return mul(c, 0.94 + h3(x, y, z, 62) * 0.1);
  } },
  tiger: { name: 'Тигър', fn: (x, y, z) => {
    const w = Math.sin(z * 0.55 + vn3(x, y, z, 4.5, 63) * 5 + y * 0.4);
    if (w > 0.52) return [18, 14, 12];
    if (w > 0.4) return [150, 60, 14];
    return mul(mix([230, 128, 34], [244, 164, 56], vn3(x, y, z, 3, 64)), 0.94 + h3(x, y, z, 65) * 0.08);
  } },
  cyber: { name: 'Кибер неон', fn: (x, y, z) => {
    const lz = fract(z / 8), ly = fract(y / 6), cz = Math.floor(z / 8), cy = Math.floor(y / 6), on = h3(cz, cy, 66);
    let c = [12, 16, 26];
    if ((lz < 0.14 && on > 0.35) || (ly < 0.16 && on < 0.7)) c = on > 0.55 ? [40, 232, 250] : [244, 60, 210];
    if (lz < 0.2 && ly < 0.22 && on > 0.6) c = [255, 255, 255];
    return mul(c, 0.94 + h3(x, y, z, 67) * 0.1);
  } },
  web: { name: 'Червена мрежа', fn: (x, y, z) => {
    const a = Math.abs(vn3(x, y, z, 5, 68) - 0.5), b = Math.abs(vn3(x, y + 20, z, 3.2, 69) - 0.5);
    if (a < 0.035 || b < 0.025) return [210, 24, 30];
    return mul([20, 18, 20], 0.8 + h3(x, y, z, 70) * 0.5);
  } },
  ocean: { name: 'Океан', fn: (x, y, z) => {
    const w = Math.sin(z * 0.4 + Math.sin(y * 0.6 + x * 0.3) * 1.4 + vn3(x, y, z, 4, 71) * 2), t = Math.max(0, Math.min(1, (y + 8) / 24));
    let c = mix([14, 78, 130], [60, 190, 210], t * 0.8 + w * 0.12);
    if (w > 0.92) c = [220, 245, 250];
    return mul(c, 0.94 + h3(x, y, z, 72) * 0.1);
  } },
  sakura: { name: 'Сакура', fn: (x, y, z) => {
    const n = fbm(x, y, z, 6, 73);
    let c = mix([236, 184, 200], [250, 220, 228], n);
    if (h3(Math.floor(x), Math.floor(y / 1.5), Math.floor(z / 1.5), 74) > 0.86) c = [214, 96, 132];
    if (vn3(x, y, z, 5, 75) > 0.8) c = [76, 52, 48];
    return mul(c, 0.95 + h3(x, y, z, 76) * 0.08);
  } },
  plasma: { name: 'Плазма', fn: (x, y, z) => {
    const n = fbm(x + Math.sin(z * 0.3) * 3, y, z, 5, 77), v = Math.sin(n * 18) * 0.5 + 0.5;
    return grad([[18, 8, 40], [96, 24, 180], [240, 70, 210], [255, 200, 250]], Math.pow(v, 1.3) * 0.95);
  } },
};
Object.assign(SKINS, NEW);
export const SKIN_IDS_ALL = Object.keys(SKINS);
export const SKIN_IDS = Object.keys(SKINS);
