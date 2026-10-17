// Оръжие/нож от първо лице: воксел модел + ръце + анимации (вадене, откат, презареждане, inspect, удари с нож).
// Рендира се в отделна сцена с отделна камера (без да влиза в стени).
import * as THREE from 'three';
import { buildModel, modelIdFor, skinFor, BP, VS } from './voxmodel.js';

const UPPER_GEO = new THREE.BoxGeometry(1, 1, 1);
const _ua = new THREE.Vector3(), _ub = new THREE.Vector3();
const clamp01 = v => Math.max(0, Math.min(1, v));
const ease = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const seg = (u, a, b) => ease((u - a) / (b - a));              // 0..1 в интервала [a,b]
const bump = (u, a, b, c, d) => seg(u, a, b) * (1 - seg(u, c, d)); // нагоре a-b, надолу c-d
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

class Pose {
  constructor() { this.pos = [0, 0, 0]; this.rot = [0, 0, 0]; this.spin = [0, 0, 0]; this.parts = {}; this.lh = [0, 0, 0]; this.lhRot = [0, 0, 0]; this.hideLeft = false; }
  part(n) { return this.parts[n] || (this.parts[n] = { pos: [0, 0, 0], rot: [0, 0, 0] }); }
}

// базова позиция на оръжието спрямо камерата (м) и ъгли
const BASE = {
  pistol: { pos: [0.12, -0.15, -0.34], rot: [0.02, 0.0, 0] }, deagle: { pos: [0.13, -0.19, -0.42], rot: [0.02, 0, 0] },
  smg: { pos: [0.14, -0.17, -0.45], rot: [0.0, 0.03, 0] }, rifle: { pos: [0.15, -0.19, -0.5], rot: [0.0, 0.04, 0] },
  shotgun: { pos: [0.15, -0.18, -0.5], rot: [0.0, 0.04, 0] }, sniper: { pos: [0.15, -0.19, -0.5], rot: [0.0, 0.04, 0] },
  grenade: { pos: [0.16, -0.2, -0.38], rot: [0, 0, 0] }, flash: { pos: [0.16, -0.2, -0.38], rot: [0, 0, 0] }, smoke: { pos: [0.16, -0.2, -0.38], rot: [0, 0, 0] }, molotov: { pos: [0.16, -0.2, -0.38], rot: [0, 0, 0] },
  bayonet: { pos: [0.2, -0.22, -0.46], rot: [-0.45, 0.3, -1.0] }, karambit: { pos: [0.2, -0.2, -0.44], rot: [-0.25, 0.2, -0.9] }, butterfly: { pos: [0.2, -0.22, -0.46], rot: [-0.45, 0.3, -1.0] },
  hunting: { pos: [0.2, -0.22, -0.46], rot: [-0.45, 0.3, -1.0] }, falchion: { pos: [0.22, -0.23, -0.5], rot: [-0.5, 0.3, -1.1] },
};
const NADES = ['grenade', 'flash', 'smoke', 'molotov'];
const kindOf = id => (BP[id]?.knife ? 'knife' : id === 'deagle' ? 'pistol' : NADES.includes(id) ? 'grenade' : (BP[id]?.like || id));

// ---------- вадене ----------
const DRAW = {
  default(u, p) { p.rot[0] = lerp(-1.15, 0, ease(u)); p.pos[1] = lerp(-0.32, 0, ease(u)); p.pos[2] = lerp(0.1, 0, ease(u)); },
  pistol(u, p) { DRAW.default(u, p); p.part('slide').pos[2] = 0.03 * (1 - seg(u, 0.6, 0.9)); },
  rifle(u, p) { DRAW.default(u, p); p.rot[1] = lerp(0.5, 0.03, ease(u)); },
  shotgun(u, p) { DRAW.default(u, p); p.part('pump').pos[2] = 0.09 * (1 - seg(u, 0.55, 0.9)) * seg(u, 0.4, 0.55); },
  sniper(u, p) { DRAW.default(u, p); p.rot[2] = lerp(0.6, 0, ease(u)); },
  grenade(u, p) { DRAW.default(u, p); },
  bayonet(u, p) { p.rot[2] = lerp(1.3, 0, ease(u)); p.pos[1] = lerp(-0.34, 0, ease(u)); p.rot[0] = lerp(-0.6, -0.1, ease(u)); },
  karambit(u, p) { p.spin[2] = -TAU * 1.0 * ease(u); p.pos[1] = lerp(-0.3, 0, ease(u)); p.rot[0] = lerp(-0.7, -0.1, ease(u)); },
  butterfly(u, p) {
    p.pos[1] = lerp(-0.25, 0, ease(u)); p.rot[0] = lerp(-0.5, -0.1, ease(u));
    p.part('hA').rot[0] = Math.PI * (1 - seg(u, 0.1, 0.6)); p.part('hB').rot[0] = Math.PI * (1 - seg(u, 0.25, 0.8)); p.spin[2] = TAU * seg(u, 0.1, 0.9);
  },
  hunting(u, p) { p.rot[1] = lerp(1.1, 0, ease(u)); p.rot[2] = lerp(-0.9, 0, ease(u)); p.pos[0] = lerp(0.2, 0, ease(u)); p.pos[1] = lerp(-0.3, 0, ease(u)); },
  falchion(u, p) { p.rot[0] = lerp(-1.6, -0.1, ease(u)); p.rot[1] = lerp(-1.4, 0, ease(u)); p.pos[1] = lerp(-0.25, 0, ease(u)); p.spin[0] = -TAU * 0.5 * (1 - seg(u, 0.2, 1)); },
};
const DRAW_TIME = { knife: 0.55, default: 0.45 };

// ---------- презареждане (u: 0..1) ----------
const RELOAD = {
  pistol(u, p) {
    const t = bump(u, 0.05, 0.2, 0.8, 0.95);
    p.rot[2] = -0.35 * t; p.rot[0] = 0.18 * t; p.pos[0] = -0.04 * t;
    const out = seg(u, 0.2, 0.38) * (1 - seg(u, 0.55, 0.72));
    p.part('mag').pos[1] = -0.2 * out; p.part('mag').rot[2] = 0.3 * out;
    p.lh[1] = -0.13 * bump(u, 0.15, 0.3, 0.45, 0.6) + 0.14 * bump(u, 0.5, 0.62, 0.72, 0.85); p.lh[0] = 0.02 * t; p.lh[2] = 0.03 * t;
    p.part('slide').pos[2] = 0.03 * bump(u, 0.76, 0.82, 0.84, 0.9);
  },
  smg(u, p) {
    const t = bump(u, 0.05, 0.22, 0.8, 0.95);
    p.rot[2] = -0.4 * t; p.rot[0] = 0.2 * t; p.pos[0] = -0.05 * t;
    const out = seg(u, 0.22, 0.4) * (1 - seg(u, 0.58, 0.75));
    p.part('mag').pos[1] = -0.26 * out; p.part('mag').rot[0] = 0.25 * out;
    p.lh[1] = -0.1 * bump(u, 0.18, 0.3, 0.45, 0.6) + 0.12 * bump(u, 0.52, 0.64, 0.72, 0.85); p.lh[2] = 0.05 * t;
    p.part('bolt').pos[2] = 0.05 * bump(u, 0.82, 0.88, 0.9, 0.95);
  },
  rifle(u, p) {
    const t = bump(u, 0.04, 0.2, 0.82, 0.96);
    p.rot[2] = -0.5 * t; p.rot[0] = 0.28 * t; p.pos[0] = -0.06 * t; p.rot[1] = 0.25 * t;
    const out = seg(u, 0.22, 0.4) * (1 - seg(u, 0.6, 0.74));
    p.part('mag').pos[1] = -0.3 * out; p.part('mag').pos[2] = 0.05 * out; p.part('mag').rot[0] = 0.4 * out;
    p.lh[1] = -0.12 * bump(u, 0.17, 0.3, 0.42, 0.56) + 0.14 * bump(u, 0.5, 0.62, 0.74, 0.84); p.lh[2] = 0.18 * bump(u, 0.12, 0.25, 0.42, 0.58);
    p.part('bolt').pos[2] = 0.07 * bump(u, 0.8, 0.88, 0.9, 0.96);
  },
  shotgun(u, p) {
    const t = bump(u, 0.04, 0.15, 0.85, 0.97);
    p.rot[2] = -0.3 * t; p.rot[0] = 0.25 * t; p.pos[1] = 0.03 * t;
    const n = 5, k = clamp01((u - 0.15) / 0.65), phase = (k * n) % 1;
    p.lh[1] = -0.2 * Math.sin(phase * Math.PI) * (u > 0.15 && u < 0.8 ? 1 : 0); p.lh[2] = 0.3 * (u > 0.15 && u < 0.8 ? 1 : 0);
    p.part('pump').pos[2] = 0.12 * bump(u, 0.82, 0.88, 0.9, 0.96) - 0.0;
    p.lhRot[0] = 0.0;
  },
  sniper(u, p) {
    const t = bump(u, 0.04, 0.18, 0.85, 0.97);
    p.rot[2] = -0.35 * t; p.rot[0] = 0.12 * t; p.rot[1] = 0.1 * t;
    p.part('bolt').rot[2] = -1.0 * bump(u, 0.08, 0.16, 0.7, 0.78); p.part('bolt').pos[2] = 0.09 * bump(u, 0.16, 0.24, 0.62, 0.7);
    const out = seg(u, 0.3, 0.45) * (1 - seg(u, 0.55, 0.65)); p.part('mag').pos[1] = -0.22 * out;
    p.lh[1] = -0.12 * bump(u, 0.26, 0.38, 0.48, 0.6) + 0.1 * bump(u, 0.5, 0.58, 0.64, 0.7); p.lh[2] = 0.2 * bump(u, 0.22, 0.34, 0.46, 0.62);
  },
  grenade(u, p) { p.pos[1] = -0.05 * bump(u, 0, 0.3, 0.7, 1); },
};
RELOAD.deagle = RELOAD.pistol;

// ---------- inspect (F) – уникален за всяко оръжие и нож; продължителност в сек ----------
const INSPECT = {
  pistol: { d: 3.0, fn(u, p) {
    const a = bump(u, 0.05, 0.25, 0.85, 1); p.pos[0] = -0.09 * a; p.pos[1] = 0.03 * a; p.pos[2] = 0.05 * a;
    p.rot[1] = -1.2 * bump(u, 0.15, 0.35, 0.5, 0.65); p.rot[2] = TAU * seg(u, 0.5, 0.82) * 0.5 * 2; p.part('slide').pos[2] = 0.03 * bump(u, 0.42, 0.46, 0.5, 0.54);
    p.lh[1] = -0.08 * bump(u, 0.1, 0.2, 0.3, 0.4); } },
  deagle: { d: 3.2, fn(u, p) {
    const a = bump(u, 0.04, 0.2, 0.86, 1); p.pos[0] = -0.07 * a; p.pos[1] = 0.04 * a; p.rot[1] = -0.7 * bump(u, 0.1, 0.3, 0.7, 0.9);
    p.rot[0] = -TAU * seg(u, 0.35, 0.65); p.pos[1] += 0.06 * Math.sin(seg(u, 0.35, 0.65) * Math.PI);
    p.part('slide').pos[2] = 0.035 * bump(u, 0.7, 0.74, 0.76, 0.8); } },
  smg: { d: 3.4, fn(u, p) {
    const a = bump(u, 0.05, 0.22, 0.85, 1); p.pos[0] = -0.08 * a; p.pos[2] = 0.04 * a;
    p.rot[1] = -0.9 * bump(u, 0.15, 0.4, 0.55, 0.7); p.rot[2] = TAU * seg(u, 0.55, 0.85);
    p.part('bolt').pos[2] = 0.06 * bump(u, 0.4, 0.46, 0.48, 0.54); p.lh[2] = 0.1 * bump(u, 0.05, 0.2, 0.5, 0.7); } },
  rifle: { d: 3.6, fn(u, p) {
    const a = bump(u, 0.05, 0.22, 0.85, 1); p.pos[0] = -0.1 * a; p.pos[2] = 0.07 * a; p.pos[1] = 0.03 * a;
    p.rot[1] = -1.15 * bump(u, 0.12, 0.4, 0.6, 0.8); p.rot[0] = 0.35 * bump(u, 0.4, 0.55, 0.7, 0.85); p.rot[2] = 0.3 * bump(u, 0.2, 0.4, 0.6, 0.8);
    p.part('bolt').pos[2] = 0.07 * bump(u, 0.46, 0.52, 0.56, 0.62); p.part('mag').pos[1] = -0.03 * bump(u, 0.3, 0.36, 0.7, 0.76); p.lh[2] = 0.15 * bump(u, 0.1, 0.25, 0.7, 0.85); } },
  shotgun: { d: 3.4, fn(u, p) {
    const a = bump(u, 0.05, 0.2, 0.86, 1); p.pos[0] = -0.08 * a; p.pos[2] = 0.05 * a;
    p.rot[1] = -0.6 * bump(u, 0.1, 0.3, 0.6, 0.8); p.rot[0] = 0.2 * bump(u, 0.3, 0.45, 0.6, 0.75);
    p.part('pump').pos[2] = 0.13 * (bump(u, 0.3, 0.36, 0.4, 0.46) + bump(u, 0.52, 0.58, 0.62, 0.68)); p.lh[2] = 0.0; } },
  sniper: { d: 4.0, fn(u, p) {
    const a = bump(u, 0.05, 0.2, 0.86, 1); p.pos[0] = -0.12 * a; p.pos[2] = 0.08 * a; p.pos[1] = 0.04 * a;
    p.rot[1] = -1.25 * bump(u, 0.12, 0.38, 0.6, 0.82); p.rot[2] = 0.4 * bump(u, 0.2, 0.4, 0.55, 0.75);
    p.part('bolt').rot[2] = -1.0 * bump(u, 0.4, 0.46, 0.55, 0.6); p.part('bolt').pos[2] = 0.09 * bump(u, 0.46, 0.52, 0.56, 0.6); p.lh[2] = 0.15 * bump(u, 0.1, 0.25, 0.7, 0.85); } },
  grenade: { d: 2.4, fn(u, p) {
    p.rot[1] = -TAU * seg(u, 0.1, 0.7) * 0.5; p.pos[2] = 0.05 * bump(u, 0.05, 0.2, 0.8, 1);
    p.part('lever').rot[2] = 0.7 * bump(u, 0.3, 0.38, 0.5, 0.56); p.part('pin').pos[1] = 0.05 * bump(u, 0.4, 0.5, 0.52, 0.6); } },
  bayonet: { d: 3.0, fn(u, p) {
    const a = bump(u, 0.05, 0.2, 0.85, 1); p.pos[0] = -0.07 * a; p.pos[2] = 0.07 * a;
    p.rot[1] = -1.0 * bump(u, 0.1, 0.3, 0.5, 0.65); p.spin[2] = TAU * seg(u, 0.5, 0.82); p.rot[0] = -0.3 * bump(u, 0.2, 0.4, 0.6, 0.8); } },
  karambit: { d: 3.4, fn(u, p) {
    const a = bump(u, 0.04, 0.16, 0.9, 1); p.pos[0] = -0.05 * a; p.pos[2] = 0.05 * a; p.pos[1] = 0.03 * a;
    p.spin[2] = -TAU * 2 * seg(u, 0.15, 0.75); p.rot[0] = -0.2 * bump(u, 0.15, 0.3, 0.7, 0.85); } },
  butterfly: { d: 3.8, fn(u, p) {
    const a = bump(u, 0.04, 0.16, 0.9, 1); p.pos[0] = -0.06 * a; p.pos[2] = 0.06 * a;
    const close = seg(u, 0.12, 0.32) * (1 - seg(u, 0.62, 0.84));
    p.part('hA').rot[0] = Math.PI * close; p.part('hB').rot[0] = Math.PI * close * (u < 0.5 ? 1 : (1 - seg(u, 0.7, 0.9)) + 0 * 1) ;
    p.spin[2] = TAU * 1.5 * seg(u, 0.28, 0.7); p.rot[1] = -0.5 * bump(u, 0.1, 0.3, 0.6, 0.8); } },
  hunting: { d: 3.0, fn(u, p) {
    const a = bump(u, 0.05, 0.2, 0.86, 1); p.pos[0] = -0.06 * a; p.pos[2] = 0.07 * a;
    p.rot[0] = -1.45 * bump(u, 0.12, 0.35, 0.55, 0.72); p.rot[1] = -TAU * seg(u, 0.4, 0.8) * 0.5 * 2 * 0.5; p.rot[2] = 0.3 * bump(u, 0.2, 0.4, 0.6, 0.8); } },
  falchion: { d: 3.6, fn(u, p) {
    const a = bump(u, 0.05, 0.2, 0.88, 1); p.pos[0] = -0.08 * a; p.pos[2] = 0.08 * a; p.pos[1] = 0.03 * a;
    p.rot[1] = -TAU * seg(u, 0.25, 0.75); p.rot[0] = -0.6 * bump(u, 0.15, 0.35, 0.65, 0.85); p.rot[2] = 0.4 * bump(u, 0.3, 0.5, 0.6, 0.75); } },
};

// ---------- удари с нож: k = 'l' (бърз) / 'r' (силен); d: продължителност ----------
const KNIFE_ATK = {
  bayonet: {
    l: { d: 0.4, fn(u, p) { const t = seg(u, 0, 0.4) * (1 - seg(u, 0.55, 1)); p.pos[0] = lerp(0.1, -0.28, seg(u, 0, 0.45)) * (u < 0.7 ? 1 : 1 - seg(u, 0.7, 1)); p.rot[2] = lerp(-0.7, 0.8, seg(u, 0, 0.45)) * (1 - seg(u, 0.7, 1)); p.rot[1] = 0.6 * t; p.pos[2] = -0.1 * t; } },
    r: { d: 0.7, fn(u, p) { p.pos[2] = -0.42 * bump(u, 0.15, 0.4, 0.55, 0.9); p.pos[1] = 0.03 * bump(u, 0.15, 0.4, 0.55, 0.9); p.rot[0] = 0.25 * bump(u, 0.05, 0.2, 0.2, 0.4) - 0.2 * bump(u, 0.3, 0.45, 0.55, 0.9); } },
  },
  karambit: {
    l: { d: 0.4, fn(u, p) { const s = seg(u, 0, 0.45) * (1 - seg(u, 0.6, 1)); p.pos[0] = 0.08 - 0.3 * s; p.pos[1] = -0.1 * s; p.rot[2] = -1.2 * (1 - seg(u, 0, 0.45)) * (1 - seg(u, 0.6, 1)) + 0.9 * s; p.spin[0] = -TAU * 0.5 * seg(u, 0.1, 0.7); p.pos[2] = -0.1 * s; } },
    r: { d: 0.7, fn(u, p) { const s = bump(u, 0.1, 0.4, 0.5, 0.9); p.rot[0] = lerp(-0.1, -1.1, seg(u, 0.1, 0.4)) * (1 - seg(u, 0.55, 0.95)); p.pos[2] = -0.28 * s; p.pos[1] = -0.14 * s; p.spin[2] = -TAU * 0.4 * s; } },
  },
  butterfly: {
    l: { d: 0.45, fn(u, p) { const s = seg(u, 0, 0.45) * (1 - seg(u, 0.6, 1)); p.pos[0] = 0.08 - 0.3 * s; p.rot[2] = -0.9 + 1.5 * seg(u, 0, 0.5); p.rot[2] *= (1 - seg(u, 0.7, 1)); p.part('hA').rot[0] = 0.5 * s; p.part('hB').rot[0] = -0.5 * s; p.spin[2] = TAU * seg(u, 0.1, 0.8) * 0.5; p.pos[2] = -0.08 * s; } },
    r: { d: 0.75, fn(u, p) { const s = bump(u, 0.2, 0.42, 0.55, 0.9); p.spin[0] = -TAU * seg(u, 0.05, 0.6); p.pos[2] = -0.3 * s; p.pos[1] = 0.04 * s; p.part('hA').rot[0] = 0.4 * s; p.part('hB').rot[0] = 0.4 * s; } },
  },
  hunting: {
    l: { d: 0.5, fn(u, p) { const s = seg(u, 0, 0.5) * (1 - seg(u, 0.65, 1)); p.rot[1] = lerp(1.0, -0.9, seg(u, 0, 0.5)) * (1 - seg(u, 0.7, 1)); p.pos[0] = 0.18 - 0.4 * seg(u, 0, 0.5); p.pos[0] *= (1 - seg(u, 0.7, 1)); p.rot[2] = -0.2 * s; p.pos[2] = -0.12 * s; } },
    r: { d: 0.85, fn(u, p) { const s = bump(u, 0.2, 0.5, 0.6, 0.95); p.rot[0] = lerp(0.9, -1.0, seg(u, 0.2, 0.5)) * (u < 0.2 ? seg(u, 0, 0.2) : 1) * (1 - seg(u, 0.65, 1)); p.pos[2] = -0.22 * s; p.pos[1] = 0.12 * (1 - seg(u, 0.2, 0.5)) * seg(u, 0, 0.2) - 0.1 * s; } },
  },
  falchion: {
    l: { d: 0.6, fn(u, p) { const s = seg(u, 0, 0.55) * (1 - seg(u, 0.7, 1)); p.rot[1] = lerp(1.4, -1.3, seg(u, 0, 0.55)) * (1 - seg(u, 0.75, 1)); p.pos[0] = (0.22 - 0.5 * seg(u, 0, 0.55)) * (1 - seg(u, 0.75, 1)); p.rot[2] = -0.5 * s; p.pos[2] = -0.14 * s; } },
    r: { d: 0.95, fn(u, p) { const s = bump(u, 0.25, 0.55, 0.65, 1); p.rot[0] = lerp(1.1, -1.2, seg(u, 0.25, 0.55)) * (u < 0.25 ? seg(u, 0, 0.25) : 1) * (1 - seg(u, 0.7, 1)); p.pos[1] = 0.14 * seg(u, 0, 0.25) * (1 - seg(u, 0.25, 0.55)) - 0.18 * s; p.pos[2] = -0.2 * s; } },
  },
};


// ---------- реалистични вадене и оглеждане на огнестрелните оръжия (замества простите версии горе) ----------
const eo = t => 1 - Math.pow(1 - clamp01(t), 3);                                  // забавяне в края (ease-out)
const settle = (u, a, b) => { const t = clamp01((u - a) / (b - a)); return Math.sin(t * Math.PI) * (1 - t) * 0.6; };       // малък „припляскващ“ преход
// Вадене: оръжието идва отдолу вдясно, цевта е наклонена надолу-навън, изправя се бързо и се „установява“ с лек отскок.
function drawGun(u, p, o = {}) {
  const e = eo(u / 0.78), s = settle(u, 0.55, 1);
  p.pos[0] = lerp(o.x ?? 0.06, 0, e); p.pos[1] = lerp(o.y ?? -0.27, 0, e) - 0.012 * s; p.pos[2] = lerp(o.z ?? 0.09, 0, e) + 0.01 * s;
  p.rot[0] = lerp(o.rx ?? -0.62, 0, e) + 0.05 * s; p.rot[1] = lerp(o.ry ?? 0.38, 0, e); p.rot[2] = lerp(o.rz ?? -0.22, 0, e);
  p.lh[2] = (o.lz ?? 0.12) * (1 - eo(u / 0.7)); p.lh[1] = -0.04 * (1 - eo(u / 0.7));
}
DRAW.default = (u, p) => drawGun(u, p);
DRAW.pistol = (u, p) => drawGun(u, p, { y: -0.22, rx: -0.5, ry: 0.3, rz: -0.18, lz: 0.05 });
DRAW.rifle = (u, p) => drawGun(u, p, { ry: 0.42, lz: 0.16 });
DRAW.smg = (u, p) => drawGun(u, p, { y: -0.24, lz: 0.1 });
DRAW.shotgun = (u, p) => { drawGun(u, p, { ry: 0.4, lz: 0.2 }); p.part('pump').pos[2] = 0.1 * bump(u, 0.55, 0.65, 0.68, 0.85); p.lh[2] += 0.1 * bump(u, 0.52, 0.64, 0.68, 0.85); };
DRAW.sniper = (u, p) => { drawGun(u, p, { ry: 0.46, rz: -0.3, lz: 0.2 }); p.part('bolt').rot[2] = -1.0 * bump(u, 0.55, 0.64, 0.7, 0.78); p.part('bolt').pos[2] = 0.08 * bump(u, 0.6, 0.68, 0.72, 0.84); };
DRAW.grenade = (u, p) => drawGun(u, p, { x: 0.02, y: -0.2, z: 0.05, rx: -0.4, ry: 0.15, rz: -0.1, lz: 0 });
DRAW.deagle = DRAW.pistol;

// Оглеждане: оръжието се доближава, завърта се да се види лявата страна, ръката/частите правят проверка и се връща. Без обороти на 360°.
function inspectGun(u, p, o) {
  const come = bump(u, 0.04, 0.2, 0.86, 1), turn = bump(u, 0.16, 0.38, 0.58, 0.8), tilt = bump(u, 0.3, 0.46, 0.55, 0.72);
  p.pos[0] = -0.07 * come - (o.sx ?? 0.03) * turn; p.pos[1] = 0.04 * come; p.pos[2] = 0.05 * come;
  p.rot[1] = -(o.yaw ?? 0.95) * turn; p.rot[2] = (o.roll ?? 0.28) * turn + (o.tilt ?? 0.18) * tilt; p.rot[0] = (o.pitch ?? 0.1) * turn - 0.12 * tilt;
  p.lh[2] = (o.lh ?? 0.08) * come; p.lh[0] = 0.02 * turn;
}
INSPECT.pistol = { d: 3.0, fn(u, p) { inspectGun(u, p, { yaw: 0.8, roll: 0.35, tilt: 0.1 }); p.part('slide').pos[2] = 0.03 * bump(u, 0.46, 0.5, 0.52, 0.58); } };
INSPECT.deagle = { d: 3.2, fn(u, p) { inspectGun(u, p, { yaw: 0.75, roll: 0.3, tilt: 0.12 }); p.part('slide').pos[2] = 0.035 * bump(u, 0.46, 0.5, 0.52, 0.58); } };
INSPECT.smg = { d: 3.2, fn(u, p) { inspectGun(u, p, { yaw: 0.95 }); p.part('bolt').pos[2] = 0.06 * bump(u, 0.44, 0.5, 0.52, 0.58); p.part('mag').pos[1] = -0.025 * bump(u, 0.62, 0.68, 0.72, 0.78); } };
INSPECT.rifle = { d: 3.4, fn(u, p) { inspectGun(u, p, { yaw: 1.0, roll: 0.3, lh: 0.1 }); p.part('bolt').pos[2] = 0.07 * bump(u, 0.44, 0.5, 0.52, 0.58); p.part('mag').pos[1] = -0.03 * bump(u, 0.62, 0.68, 0.72, 0.78); } };
INSPECT.shotgun = { d: 3.2, fn(u, p) { inspectGun(u, p, { yaw: 0.85 }); p.part('pump').pos[2] = 0.13 * (bump(u, 0.42, 0.47, 0.5, 0.55) + bump(u, 0.58, 0.63, 0.66, 0.72)); } };
INSPECT.sniper = { d: 3.8, fn(u, p) { inspectGun(u, p, { yaw: 1.05, roll: 0.35, lh: 0.12 }); p.part('bolt').rot[2] = -1.0 * bump(u, 0.42, 0.47, 0.57, 0.62); p.part('bolt').pos[2] = 0.09 * bump(u, 0.47, 0.52, 0.56, 0.6); } };
INSPECT.grenade = { d: 2.4, fn(u, p) {
  const come = bump(u, 0.05, 0.22, 0.8, 1); p.pos[2] = 0.05 * come; p.pos[1] = 0.03 * come; p.rot[1] = -0.9 * bump(u, 0.15, 0.4, 0.55, 0.78); p.rot[2] = 0.3 * bump(u, 0.2, 0.4, 0.55, 0.75);
  p.part('lever').rot[2] = 0.7 * bump(u, 0.3, 0.38, 0.5, 0.56); p.part('pin').pos[1] = 0.05 * bump(u, 0.4, 0.5, 0.52, 0.6); } };

export class ViewModel {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
    this.holder = new THREE.Group(); this.spinner = new THREE.Group(); this.holder.add(this.spinner);
    this.scene.add(this.holder);
    this.model = null; this.armR = null; this.armL = null; this.flash = null;
    this.id = null; this.skin = null; this.team = null;
    this.anim = null; this.fireKick = 0; this.sway = [0, 0]; this.flashUntil = 0; this.bobT = 0; this.shotCycle = null;
    this.visible = true;
  }
  // еднакъв хоризонтален изглед при всякакво съотношение: по-тесен прозорец -> по-малък вертикален FOV, моделът не „расте“ в кадъра
  resize(aspect, worldFov = 75) {
    this.aspect = aspect; const h = (2 * Math.atan(Math.tan(27 * Math.PI / 180) * (16 / 9))) * (0.82 + 0.18 * worldFov / 75);
    const v = 2 * Math.atan(Math.tan(h / 2) / aspect) * 180 / Math.PI;
    this.camera.fov = Math.max(32, Math.min(78, v)); this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
  }

  // weapon: 'rifle' | 'knife' ...; cos: козметика на играча; team за ръкава
  setWeapon(weapon, cos, team, now) {
    const id = modelIdFor(weapon, cos), skin = skinFor(weapon, cos);
    this.weapon = weapon;
    if (this.id === id && this.skin === skin && this.team === team) { this.anim = null; this.start('draw', now); return; }
    this.id = id; this.skin = skin; this.team = team;
    this.spinner.clear(); (this.upper || []).forEach(m => m && this.scene.remove(m));
    const bp = BP[id];
    this.model = buildModel(id, { skin, team, step: BP[id].knife ? 1 : 0.5 });
    const piv = bp.ringPivot || bp.spinPivot || [0, 0, 0];
    this.spinner.position.set(piv[0] * VS, piv[1] * VS, piv[2] * VS); this.model.position.set(-piv[0] * VS, -piv[1] * VS, -piv[2] * VS);
    this.spinner.add(this.model);
    const mk = (hand, dir) => {
      const a = buildModel('arm', { team }); a.position.set(hand[0] * VS, hand[1] * VS, hand[2] * VS);
      a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize()); this.model.add(a); return a;
    };
    this.armR = mk(bp.rh, [0.28, -0.42, 1]);
    this.armL = bp.lh ? mk(bp.lh, [-0.55, -0.5, 1]) : null;
    this.upper = [this.armR, this.armL].map((a, i) => { if (!a) return null; const m = new THREE.Mesh(UPPER_GEO, new THREE.MeshBasicMaterial({ color: team === 'def' ? 0x2f5cbe : 0xd67622 })); m.userData.anchor = i === 0 ? [0.34, -0.62, 0.3] : [-0.34, -0.62, 0.3]; this.scene.add(m); return m; });
    this.flash = null;
    if (bp.muzzle && !bp.knife && !NADES.includes(id)) { this.flash = buildModel('flash'); this.flash.position.set(bp.muzzle[0] * VS, bp.muzzle[1] * VS, bp.muzzle[2] * VS); this.flash.visible = false; this.model.add(this.flash); }
    this.start('draw', now);
  }

  start(type, now, extra = {}) {
    const kind = kindOf(this.id);
    let d = 0.5;
    if (type === 'draw') d = kind === 'knife' ? DRAW_TIME.knife : DRAW_TIME.default;
    else if (type === 'reload') d = extra.t || 2.2;
    else if (type === 'inspect') d = (INSPECT[this.id] || INSPECT[kind])?.d || 3;
    else if (type === 'knife') d = KNIFE_ATK[this.id]?.[extra.k]?.d || 0.5;
    this.anim = { type, t0: now, d: d * 1000, ...extra };
  }
  reload(t, now) { if (NADES.includes(this.id) || BP[this.id]?.knife) return; this.start('reload', now, { t }); }
  inspect(now) { if (!this.anim || this.anim.type === 'inspect') { if (this.anim?.type === 'inspect') { this.anim = null; return; } this.start('inspect', now); } }
  attack(k, now) { if (BP[this.id]?.knife) this.start('knife', now, { k }); }
  cancelInspect() { if (this.anim?.type === 'inspect') this.anim = null; }
  isBusy() { return !!this.anim && this.anim.type !== 'inspect'; }
  // изстрел: откат + проблясък; връща {pos, vel} за гилзата (в координатите на камерата) или null
  fire(now) {
    this.cancelInspect();
    this.fireKick = 1; this.flashUntil = now + 55;
    if (kindOf(this.id) === 'shotgun') this.shotCycle = { t0: now + 160, d: 520 };
    else if (kindOf(this.id) === 'sniper') this.shotCycle = { t0: now + 380, d: 900 };
    if (this.flash) { this.flash.rotation.z = Math.random() * TAU; this.flash.scale.setScalar(0.7 + Math.random() * 0.7); }
    const bp = BP[this.id]; if (!bp?.eject || kindOf(this.id) === 'shotgun') return null;
    const e = new THREE.Vector3(bp.eject[0] * VS, bp.eject[1] * VS, bp.eject[2] * VS);
    this.model.updateWorldMatrix(true, false); e.applyMatrix4(this.model.matrixWorld);
    return { pos: e, vel: [1.6 + Math.random() * 0.8, 1.6 + Math.random() * 0.8, 0.6 + Math.random() * 0.6] };
  }
  pumpEject(now) { // за пушка: гилза при помпането
    const bp = BP.shotgun; const e = new THREE.Vector3(bp.eject[0] * VS, bp.eject[1] * VS, bp.eject[2] * VS);
    this.model.updateWorldMatrix(true, false); e.applyMatrix4(this.model.matrixWorld);
    return { pos: e, vel: [1.4, 1.8, 0.5] };
  }

  update(dt, now, ctx) {
    if (!this.model) return;
    const kind = kindOf(this.id), p = new Pose();
    // активна анимация
    const a = this.anim;
    if (a) {
      const u = (now - a.t0) / a.d;
      if (u >= 1) this.anim = null;
      else if (u >= 0) {
        if (a.type === 'draw') (DRAW[this.id] || DRAW[kind] || DRAW.default)(u, p);
        else if (a.type === 'reload') (RELOAD[this.id] || RELOAD[kind] || RELOAD.pistol)(u, p);
        else if (a.type === 'inspect') (INSPECT[this.id] || INSPECT[kind])?.fn(u, p);
        else if (a.type === 'knife') KNIFE_ATK[this.id]?.[a.k]?.fn(u, p);
      }
    }
    // цикъл след изстрел (пушка/снайпер)
    if (this.shotCycle) {
      const u = (now - this.shotCycle.t0) / this.shotCycle.d;
      if (u >= 1) this.shotCycle = null;
      else if (u >= 0) {
        if (kindOf(this.id) === 'shotgun') { p.part('pump').pos[2] += 0.12 * bump(u, 0, 0.4, 0.55, 1); p.lh[2] += 0.02; }
        else { p.part('bolt').rot[2] += -1.0 * bump(u, 0, 0.2, 0.75, 0.95); p.part('bolt').pos[2] += 0.09 * bump(u, 0.15, 0.4, 0.55, 0.8); }
      }
    }
    this.fireKick = Math.max(0, this.fireKick - dt * 9);
    const k = this.fireKick;
    if (!BP[this.id].knife) {
      p.pos[2] += 0.045 * k; p.rot[0] += 0.055 * k; p.pos[1] += 0.008 * k;
      if (kindOf(this.id) === 'pistol') p.part('slide').pos[2] += 0.03 * Math.min(1, k * 1.3);
      if (kindOf(this.id) === 'smg' || kindOf(this.id) === 'rifle') p.part('bolt').pos[2] += 0.02 * Math.min(1, k * 1.5);
    }
    // люлеене при ходене и инерция от мишката
    this.bobT += dt * (2 + ctx.speed * 1.4);
    const sp = Math.min(1, ctx.speed / 6) * (ctx.onGround ? 1 : 0.2), bobY = Math.abs(Math.sin(this.bobT)) * 0.012 * sp, bobX = Math.sin(this.bobT) * 0.01 * sp;
    this.sway[0] += ((-ctx.mdx * 0.0006) - this.sway[0]) * Math.min(1, dt * 10); this.sway[1] += ((ctx.mdy * 0.0006) - this.sway[1]) * Math.min(1, dt * 10);
    const base = BASE[this.id] || BASE[kind] || BASE.rifle, crouch = ctx.crouchAmt * 0.02;
    this.holder.position.set(base.pos[0] + p.pos[0] + bobX, base.pos[1] + p.pos[1] - bobY - crouch + (ctx.onGround ? 0 : 0.012), base.pos[2] + p.pos[2]);
    this.holder.rotation.set(base.rot[0] + p.rot[0] + this.sway[1], base.rot[1] + p.rot[1] + this.sway[0], base.rot[2] + p.rot[2] + this.sway[0] * 0.6, 'YXZ');
    this.spinner.rotation.set(p.spin[0], p.spin[1], p.spin[2]);
    // части
    const parts = this.model.userData.parts;
    for (const n in parts) {
      const h = parts[n], q = p.parts[n], rest = h.userData.rest;
      if (q) { h.position.set(rest.x + q.pos[0], rest.y + q.pos[1], rest.z + q.pos[2]); h.rotation.set(q.rot[0], q.rot[1], q.rot[2]); } else { h.position.copy(rest); h.rotation.set(0, 0, 0); }
    }
    if (this.armL) {
      const bp = BP[this.id], lh = bp.lh;
      this.armL.position.set(lh[0] * VS + p.lh[0], lh[1] * VS + p.lh[1], lh[2] * VS + p.lh[2]);
    }
    if (this.flash) this.flash.visible = now < this.flashUntil;
    this.holder.scale.setScalar((BP[this.id].knife ? 1.3 : 1) * (this.userScale || 1));
    this.holder.visible = this.visible;
    // горна част на ръката: от края на предмишницата до рамото (долу в ъгъла на екрана); следва оръжието при всяко завъртане
    this.holder.updateMatrixWorld(true);
    (this.upper || []).forEach((m, i) => {
      if (!m) return; const a = i === 0 ? this.armR : this.armL, an = m.userData.anchor;
      _ua.set(0, 0, 0.395).applyMatrix4(a.matrixWorld); _ub.set(an[0], an[1], an[2]);
      const len = _ua.distanceTo(_ub); m.position.copy(_ua).add(_ub).multiplyScalar(0.5); m.lookAt(_ub); m.scale.set(0.068, 0.068, len); m.visible = this.visible;
    });
  }

  render(renderer) {
    if (!this.visible || !this.model) return;
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth();
    renderer.render(this.scene, this.camera); renderer.autoClear = ac;
  }
}
