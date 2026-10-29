// Процедурни текстури за картите от кутии (стил CS 1.6: ниска резолюция, мръсни повърхности). Всичко е нарисувано с canvas – без външни картинки.
// scale = колко метра покрива една плочка (повторение по света, така че шевовете са еднакви по всички стени).
const S = 128;
let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const clamp = v => Math.max(0, Math.min(255, v | 0));
const mk = fn => { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); fn(g, c); return c; };
const rgb = (r, g, b) => `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
// шум по пиксели: добавя зърно и леки петна
function grain(g, amt = 14, blotch = 0) {
  const im = g.getImageData(0, 0, S, S), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * amt; d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n); }
  g.putImageData(im, 0, 0);
  for (let i = 0; i < blotch; i++) { const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 18; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${0.08 + rnd() * 0.12})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
}
const brick = (base, mortar) => mk(g => {
  g.fillStyle = mortar; g.fillRect(0, 0, S, S);
  const rows = 8, h = S / rows, w = S / 4;
  for (let r = 0; r < rows; r++) for (let c = -1; c < 4; c++) {
    const x = c * w + (r % 2 ? w / 2 : 0), j = (rnd() - 0.5) * 22;
    g.fillStyle = rgb(base[0] + j, base[1] + j * 0.7, base[2] + j * 0.6); g.fillRect(x + 1, r * h + 1, w - 2, h - 2);
  }
  grain(g, 18, 10);
});
const planks = (base, horizontal = true) => mk(g => {
  const n = 6, h = S / n;
  for (let i = 0; i < n; i++) {
    const j = (rnd() - 0.5) * 20; g.fillStyle = rgb(base[0] + j, base[1] + j * 0.8, base[2] + j * 0.6);
    if (horizontal) g.fillRect(0, i * h, S, h - 1.5); else g.fillRect(i * h, 0, h - 1.5, S);
    for (let k = 0; k < 7; k++) { g.strokeStyle = `rgba(30,18,8,${0.15 + rnd() * 0.2})`; g.beginPath(); if (horizontal) { const y = i * h + rnd() * h; g.moveTo(0, y); g.lineTo(S, y + (rnd() - 0.5) * 4); } else { const x = i * h + rnd() * h; g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 4, S); } g.stroke(); }
    g.fillStyle = 'rgba(25,20,18,0.8)'; if (horizontal) { g.fillRect(6, i * h + h / 2, 2, 2); g.fillRect(S - 8, i * h + h / 2, 2, 2); } else { g.fillRect(i * h + h / 2, 6, 2, 2); g.fillRect(i * h + h / 2, S - 8, 2, 2); }
  }
  grain(g, 14, 6);
});
const crateTex = () => mk(g => {                                         // дървена щайга: рамка, дъски, диагонал
  g.fillStyle = rgb(96, 64, 36); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5; i++) { const j = (rnd() - 0.5) * 18; g.fillStyle = rgb(112 + j, 76 + j * 0.8, 44 + j * 0.6); g.fillRect(10, 10 + i * 22, S - 20, 21); g.strokeStyle = 'rgba(25,15,6,0.55)'; g.strokeRect(10.5, 10.5 + i * 22, S - 21, 20); }
  g.fillStyle = rgb(78, 52, 28); g.fillRect(0, 0, S, 11); g.fillRect(0, S - 11, S, 11); g.fillRect(0, 0, 11, S); g.fillRect(S - 11, 0, 11, S);
  g.strokeStyle = 'rgba(20,12,4,0.8)'; g.lineWidth = 2; g.strokeRect(1, 1, S - 2, S - 2);
  g.strokeStyle = rgb(70, 46, 24); g.lineWidth = 8; g.beginPath(); g.moveTo(14, 14); g.lineTo(S - 14, S - 14); g.stroke();
  g.fillStyle = 'rgba(20,14,10,0.9)'; for (const [x, y] of [[6, 6], [S - 7, 6], [6, S - 7], [S - 7, S - 7]]) g.fillRect(x - 1, y - 1, 3, 3);
  grain(g, 16, 8);
});
const concrete = (base) => mk(g => {
  g.fillStyle = rgb(...base); g.fillRect(0, 0, S, S); grain(g, 22, 18);
  g.strokeStyle = 'rgba(20,20,26,0.45)'; g.lineWidth = 1; for (let i = 0; i < 3; i++) { g.beginPath(); let x = rnd() * S, y = rnd() * S; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 30; y += 8 + rnd() * 14; g.lineTo(x, y); } g.stroke(); }
  g.strokeStyle = 'rgba(15,15,20,0.5)'; g.strokeRect(0.5, 0.5, S - 1, S - 1);
});
const ground = () => mk(g => {
  g.fillStyle = rgb(62, 62, 70); g.fillRect(0, 0, S, S); grain(g, 28, 22);
  for (let i = 0; i < 160; i++) { const v = 70 + rnd() * 70; g.fillStyle = rgb(v, v, v + 6); g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2); }
});
const metal = () => mk(g => {
  for (let i = 0; i < 16; i++) { const j = (i % 2 ? -14 : 6); g.fillStyle = rgb(86 + j, 98 + j, 110 + j); g.fillRect(i * 8, 0, 8, S); }
  for (let i = 0; i < 9; i++) { const x = rnd() * S, y = rnd() * S, r = 5 + rnd() * 12; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(120,64,30,0.55)'); gr.addColorStop(1, 'rgba(120,64,30,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.fillStyle = 'rgba(20,24,30,0.7)'; g.fillRect(0, 0, S, 3); g.fillRect(0, S - 3, S, 3); g.fillRect(0, S / 2 - 1, S, 3);
  grain(g, 14, 4);
});
const plaster = () => mk(g => { g.fillStyle = rgb(158, 148, 130); g.fillRect(0, 0, S, S); grain(g, 20, 24); });
const roofTex = () => mk(g => {
  g.fillStyle = rgb(48, 34, 40); g.fillRect(0, 0, S, S);
  const rows = 8, h = S / rows, w = S / 6;
  for (let r = 0; r < rows; r++) for (let c = -1; c < 6; c++) { const j = (rnd() - 0.5) * 18, x = c * w + (r % 2 ? w / 2 : 0); g.fillStyle = rgb(86 + j, 52 + j * 0.6, 54 + j * 0.6); g.fillRect(x + 1, r * h + 1, w - 2, h - 1); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 1, r * h + h - 3, w - 2, 2); }
  grain(g, 14, 8);
});
const glass = lit => mk(g => {
  g.fillStyle = lit ? rgb(255, 226, 150) : rgb(18, 24, 44); g.fillRect(0, 0, S, S);
  if (lit) { const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(255,255,230,0.35)'); gr.addColorStop(1, 'rgba(220,150,70,0.45)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
  else { g.fillStyle = 'rgba(60,80,120,0.25)'; g.fillRect(8, 8, 50, 50); }
  g.strokeStyle = 'rgba(28,18,10,0.95)'; g.lineWidth = 7; g.strokeRect(3, 3, S - 6, S - 6); g.lineWidth = 5; g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
});
const fence = () => mk(g => {
  g.clearRect(0, 0, S, S);
  const n = 8, w = S / n;
  for (let i = 0; i < n; i++) { const j = (rnd() - 0.5) * 14; g.fillStyle = rgb(96 + j, 70 + j, 46 + j * 0.6); g.fillRect(i * w + 1, 0, w - 2, S); g.strokeStyle = 'rgba(25,16,8,0.5)'; g.strokeRect(i * w + 1.5, 0.5, w - 3, S - 1); }
  g.fillStyle = 'rgba(40,28,16,0.75)'; g.fillRect(0, 24, S, 8); g.fillRect(0, S - 32, S, 8); grain(g, 10, 4);
});

// има ли даден тип текстура: { canvas, scale }; шаблоните са детерминистични (един и същ резултат при всяко зареждане)
export function brushTextureDefs() {
  seed = 7;
  return {
    brick: { c: brick([112, 64, 62], 'rgb(58,46,52)'), scale: 1.6 }, brick2: { c: brick([84, 54, 66], 'rgb(46,38,50)'), scale: 1.6 },
    wood: { c: planks([88, 60, 40]), scale: 1.0 }, crate: { c: crateTex(), scale: 1.2 }, concrete: { c: concrete([116, 116, 124]), scale: 2.0 },
    step: { c: concrete([128, 128, 134]), scale: 1.0 }, ground: { c: ground(), scale: 2.0 }, asphalt: { c: ground(), scale: 2.0 }, metal: { c: metal(), scale: 1.0 }, barrel: { c: metal(), scale: 0.9 },
    plaster: { c: plaster(), scale: 2.0 }, roof: { c: roofTex(), scale: 1.5 }, fence: { c: fence(), scale: 1.0, alpha: true }, tile: { c: concrete([150, 150, 156]), scale: 1.0 },
    glassLit: { c: glass(true), scale: 1.2 }, glassDark: { c: glass(false), scale: 1.2 },
  };
}
