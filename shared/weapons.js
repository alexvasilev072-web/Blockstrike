// Споделени константи: оръжия, ножове, икономика, движение. Ползват се и от сървъра, и от клиента.
// Мерки: 1 блок = 1 метър; CS единици / 40 = метри (играч 72 ед. = 1.8 м).

// ---------- Движение (CS2) ----------
export const MOVE = {
  GRAVITY: 20,            // 800 ед/с²
  JUMP: 7.55,             // 302 ед/с -> ~1.43 м височина
  ACCEL: 5.5,             // sv_accelerate
  AIR_ACCEL: 12,          // sv_airaccelerate
  AIR_CAP: 0.75,          // 30 ед/с: таван на wishspeed във въздуха (основа на air strafing)
  FRICTION: 5.2,          // sv_friction
  STOP: 2.0,              // sv_stopspeed (80 ед/с)
  WALK_MUL: 0.52,         // Shift
  CROUCH_MUL: 0.34,       // Ctrl / C
  BHOP_CAP: 1.1,          // при скок скоростта се реже до 110% от максималната (без bunnyhopping)
  AIR_MAX: 1.7,           // абсолютен таван на хоризонталната скорост (× скоростта на ножа)
  STAND_H: 1.8, CROUCH_H: 1.35,
  EYE_STAND: 1.6, EYE_CROUCH: 1.15, CROUCH_TIME: 0.2,
  HW: 0.3,
  WATER_MUL: 0.62,
  STEP: 1 / 64,           // фиксирана стъпка на симулацията (tickrate 64)
  WALK_NY: 0.7,           // рампа с нормала Y >= 0.7 (<=45.5°) е ходима; по-стръмна = плъзгане (surf)
  SLIME_BOUNCE: 14,       // м/с нагоре при слуз
  SLICK_FRIC: 0.12, SLICK_ACC: 0.35,   // лед: множители на триенето и ускорението
  WATER_JUMP: 7.5,        // м/с нагоре при излизане от водата върху ръб
  SURF_DRIVE: 5, SURF_DRIVE_MAX: 55,   // м/с²: емулира лекия наклон надолу по трасето (рампите са хоризонтални); до 55 м/с
  SURF_AIR_ACCEL: 150, SURF_MAX: 87.5, // surf: sv_airaccelerate 150, макс. скорост 3500 ед/с
  FALL_SAFE: 14.5,        // м/с (580 ед/с): над тази скорост на падане има щети
};

// ---------- Оръжия ----------
// dmg: щети; ratio: armor ratio (пробив на бронята); range: множител на щетите на ~12.5 м; rate: сек между изстрелите
// speed: макс. скорост на движение (м/с) с оръжието в ръка; spread: радиани (стои / клекнал / движение / във въздуха)
// recoil: модел на spray pattern (виж recoilAt); rreset: сек без стрелба, след които откатът се нулира
export const WEAPONS = {
  pistol:  { name: 'P9 Пистолет',  slot: 'se', dmg: 30, ratio: 1.0,  range: 0.85, rate: 0.15, mag: 20, reserve: 120, reload: 2.2, auto: false, speed: 6.0, price: 0,    reward: 300,
             spread: { stand: 0.0035, crouch: 0.0022, move: 0.035, air: 0.08 }, recoil: { up: 0.055, rise: 4, sway: 0.012, freq: 0.9, drift: -0.002 }, rreset: 0.45, pellets: 1 },
  deagle:  { name: 'Дезърт .50',   slot: 'se', dmg: 53, ratio: 1.86, range: 0.93, rate: 0.225, mag: 7, reserve: 35,  reload: 2.2, auto: false, speed: 5.75, price: 700,  reward: 300,
             spread: { stand: 0.003, crouch: 0.002, move: 0.075, air: 0.13 }, recoil: { up: 0.09, rise: 2, sway: 0.01, freq: 1.2, drift: 0.003 }, rreset: 0.6, pellets: 1 },
  smg:     { name: 'SMG МП-9',     slot: 'pr', dmg: 26, ratio: 1.2,  range: 0.87, rate: 0.07, mag: 30, reserve: 120, reload: 2.1, auto: true,  speed: 5.5, price: 1250, reward: 600,
             spread: { stand: 0.004, crouch: 0.0028, move: 0.03, air: 0.075 }, recoil: { up: 0.10, rise: 7, sway: 0.03, freq: 0.7, drift: 0.0015 }, rreset: 0.3, pellets: 1 },
  rifle:   { name: 'Автомат АК-47', slot: 'pr', dmg: 36, ratio: 1.55, range: 0.98, rate: 0.10, mag: 30, reserve: 90,  reload: 2.5, auto: true,  speed: 5.4, price: 2700, reward: 300,
             spread: { stand: 0.0018, crouch: 0.0011, move: 0.06, air: 0.1 }, recoil: { up: 0.17, rise: 9, sway: 0.038, freq: 0.52, drift: -0.0016 }, rreset: 0.34, pellets: 1 },
  shotgun: { name: 'Пушка Nova',   slot: 'pr', dmg: 26, ratio: 1.0,  range: 0.70, rate: 0.88, mag: 8,  reserve: 32,  reload: 3.0, auto: false, speed: 5.5, price: 1050, reward: 900,
             spread: { stand: 0.042, crouch: 0.036, move: 0.05, air: 0.08 }, recoil: { up: 0.06, rise: 1, sway: 0.01, freq: 1, drift: 0 }, rreset: 0.9, pellets: 9, shell: true },
  sniper:  { name: 'Снайпер AWP',  slot: 'pr', dmg: 115, ratio: 1.95, range: 0.99, rate: 1.47, mag: 10, reserve: 30,  reload: 3.7, auto: false, speed: 5.0, scoped: 2.5, price: 4750, reward: 100,
             spread: { stand: 0.0008, crouch: 0.0005, move: 0.16, air: 0.2, unscoped: 0.06 }, recoil: { up: 0.045, rise: 1, sway: 0.004, freq: 1, drift: 0 }, rreset: 1.0, pellets: 1 },
  knife:   { name: 'Нож',          slot: 'kn', speed: 6.25, reward: 1500, price: 0 },
  grenade: { name: 'Граната (HE)', slot: 'n',  speed: 6.1, price: 300, reward: 300 },
  flash:   { name: 'Flashbang',    slot: 'n',  speed: 6.1, price: 200, reward: 300 },
  smoke:   { name: 'Димна граната', slot: 'n', speed: 6.1, price: 300, reward: 300 },
  molotov: { name: 'Молотов',      slot: 'n',  speed: 6.1, price: 400, reward: 300 },
};

// Нож: left = бърз удар, right = силен удар; back = множител при удар в гръб
export const KNIFE = {
  left:  { dmg: 40, back: 90,  rate: 0.45, range: 2.0 },
  right: { dmg: 65, back: 180, rate: 1.05, range: 1.7 },
};
// Герои (модели на играчите): само името; моделите са в public/characters.js
export const CHARACTERS = {
  t_ultra:    { team: 'att', name: 'Хулиган',    desc: 'Футболен хулиган: шал на лицето, пухено яке, анцуг с райета, маратонки' },
  t_dealer:   { team: 'att', name: 'Дилър',      desc: 'Махленски тип: потник, златна верижка, шапка, маска, чантичка' },
  t_enforcer: { team: 'att', name: 'Изпълнител', desc: 'Балаклава, суитшърт с качулка, къси гащи, маратонки' },
  ct_gdbop:   { team: 'def', name: 'ГДБОП',      desc: 'Каска, маска, тактическа жилетка с надпис ГДБОП' },
  ct_police:  { team: 'def', name: 'Полицай',    desc: 'Полицейска униформа, шапка, жилетка с надпис ПОЛИЦИЯ' },
  ct_special: { team: 'def', name: 'Спецчаст',   desc: 'Каска с нощно виждане, слушалки, цялата екипировка в черно' },
};
export const defaultChars = () => ({ att: 't_ultra', def: 'ct_gdbop' });
// проверка на избора на герои (по един за всеки отбор)
export function cleanChars(c) {
  const d = defaultChars();
  if (c && typeof c === 'object') for (const t of ['att', 'def']) if (CHARACTERS[c[t]]?.team === t) d[t] = c[t];
  return d;
}
export const KNIFE_TYPES = {
  bayonet:  { name: 'Байонет' },
  karambit: { name: 'Карамбит' },
  butterfly:{ name: 'Сгъваем (Butterfly)' },
  hunting:  { name: 'Ловджийски' },
  falchion: { name: 'Фалшион' },
};

// Spray pattern: cumulative отклонение на куршума/мерника след i изстрела подред (i=0 -> точно в центъра).
// Връща [yaw, pitch] в радиани; pitch>0 е нагоре.
export function recoilAt(weapon, i) {
  const r = WEAPONS[weapon]?.recoil; if (!r || i <= 0) return [0, 0];
  const up = r.up * (1 - Math.exp(-i / r.rise));
  const ramp = Math.min(1, i / 6);
  const yaw = r.sway * Math.sin(i * r.freq) * ramp + r.drift * i;
  return [yaw, up];
}

// Неточност (радиани, половин конус) като в CS2: най-точен си на място или клекнал.
// st: { cr, sc, spd (м/с), g (на земята), idx (изстрели подред) }
export function spreadFor(id, st) {
  const w = WEAPONS[id], s = w?.spread; if (!s) return 0;
  let v = st.cr ? s.crouch : s.stand;
  if (id === 'sniper' && !st.sc) v = s.unscoped;
  const vmax = (st.sc && w.scoped) ? w.scoped : w.speed;
  const f = Math.max(0, Math.min(1, (st.spd - 0.34 * vmax) / (0.66 * vmax)));
  v += f * s.move;
  if (!st.g) v = Math.max(v, s.air);
  return v + Math.min(st.idx, 12) * 0.0006;
}

// Магазин (клавиш B)
export const ITEMS = [
  { id: 'deagle',  key: '1', label: 'Пистолет Дезърт .50', price: 700 },
  { id: 'smg',     key: '2', label: 'SMG МП-9',            price: 1250 },
  { id: 'shotgun', key: '3', label: 'Пушка Nova',          price: 1050 },
  { id: 'rifle',   key: '4', label: 'Автомат АК-47',       price: 2700 },
  { id: 'sniper',  key: '5', label: 'Снайпер AWP',         price: 4750 },
  { id: 'grenade', key: '6', label: 'Граната (HE)',        price: 300 },
  { id: 'flash',   key: '7', label: 'Flashbang',           price: 200 },
  { id: 'smoke',   key: '8', label: 'Димна граната',       price: 300 },
  { id: 'molotov', key: '9', label: 'Молотов (защитници $600)', price: 400 },
  { id: 'armor',   key: '0', label: 'Броня',               price: 650 },
  { id: 'kit',     key: '-', label: 'Defuse kit (защитници)', price: 400 },
];

export const CFG = {
  HW: 0.3, H: 1.8, EYE: 1.6, HEAD_FRAC: 0.79,
  HEAD_MULT: 4,
  FREEZE: 12, LIVE: 115, END: 5, MATCHEND: 8,
  PLANT: 3.0, DEFUSE: 10, DEFUSE_KIT: 5, BOMB: 40, BOMB_RADIUS: 16,
  WIN_ROUNDS: 8, MAX_ROUNDS: 14, HALF: 7,
  START_MONEY: 800, MAX_MONEY: 16000,
  WIN_REWARD: 3250, LOSE_REWARD: 1400, STREAK_BONUS: 500, PLANT_BONUS: 300, DEFUSE_BONUS: 300, PLANTED_LOSS_BONUS: 800,
  ARMOR: 100,
  NADE_RADIUS: 8, NADE_DMG: 98, NADE_BREAK: 3.6, NADE_FUSE: 1.8,
  MAX_NADES: 4, MAX_FLASH: 2, FLASH_FUSE: 1.6, FLASH_R: 30,                     // flashbang: най-много 4 гранати общо, до 2 флашки
  SMOKE_FUSE: 2.4, SMOKE_R: 3.6, SMOKE_TIME: 18,                                // димна: пуфка при спиране (до 2.4 с), облак 3.6 м за 18 с
  MOLO_FUSE: 2.2, MOLO_R: 3.0, MOLO_TIME: 7, MOLO_DPS: 14,                     // молотов: пожар при удар в земята, 7 с, 14 щети/с
  MAX_PLAYERS: 10,
  BOMB_PICKUP: 1.3,
  SWITCH_DELAY: 450, BUY_DELAY: 400,          // мс: след смяна на оръжие / купуване не може да се стреля (и на клиента, и на сървъра)
  CHAT_MAX: 120, CHAT_GAP: 700,                // чат: най-много 120 символа и 1 съобщение на 0.7 сек
  READY_WAIT: 20,                             // сек: колко най-много чака freeze, докато играч още е на екрана „Готов ли си?“
  BUY_TIME: 20,                               // сек след края на freeze, през които може да се купува в зоната около spawn-а
  BUY_PAD: 6,                                 // метри около spawn точките на отбора
};

// Зона за купуване: правоъгълникът около spawn точките на отбора (метри)
export function inBuyZone(spawns, x, z, pad = CFG.BUY_PAD) {
  let x1 = 1e9, z1 = 1e9, x2 = -1e9, z2 = -1e9;
  for (const [sx, sz] of spawns) { x1 = Math.min(x1, sx); z1 = Math.min(z1, sz); x2 = Math.max(x2, sx + 1); z2 = Math.max(z2, sz + 1); }
  return x >= x1 - pad && x <= x2 + pad && z >= z1 - pad && z <= z2 + pad;
}

// Гранати: оръжие -> ключ в p.inv.g; ред на превключване с клавиш 4
export const NADE = { grenade: 'he', flash: 'flash', smoke: 'smoke', molotov: 'molo' };
export const NADE_W = { he: 'grenade', flash: 'flash', smoke: 'smoke', molo: 'molotov' };
export const NADE_ORDER = ['he', 'flash', 'smoke', 'molo'];
export const NADE_IDS = ['grenade', 'flash', 'smoke', 'molotov'];
export const nadePrice = (id, team) => (id === 'molotov' ? (team === 'def' ? 600 : 400) : WEAPONS[id]?.price);
