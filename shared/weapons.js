// Споделени константи: оръжия, икономика, физика. Ползват се и от сървъра, и от клиента.
export const WEAPONS = {
  pistol:  { name: 'P9 Пистолет',  slot: 'se', dmg: 26,  mag: 12, reserve: 48, rate: 0.18, reload: 1.5, auto: false, spread: 0.006, kick: 0.020, reward: 300, price: 0 },
  deagle:  { name: 'Дезърт .50',   slot: 'se', dmg: 55,  mag: 7,  reserve: 35, rate: 0.35, reload: 1.9, auto: false, spread: 0.004, kick: 0.050, reward: 300, price: 500 },
  rifle:   { name: 'Автомат АК-Б', slot: 'pr', dmg: 32,  mag: 30, reserve: 90, rate: 0.10, reload: 2.4, auto: true,  spread: 0.012, kick: 0.012, reward: 300, price: 2500 },
  sniper:  { name: 'Снайпер AWP',  slot: 'pr', dmg: 160, mag: 5,  reserve: 25, rate: 1.40, reload: 3.4, auto: false, spread: 0.0015, unscoped: 0.06, kick: 0.080, reward: 100, price: 4000 },
  grenade: { name: 'Граната',      slot: 'n',  price: 300, reward: 300 },
};

export const ITEMS = [
  { id: 'deagle',  key: '1', label: 'Пистолет Дезърт .50', price: 500 },
  { id: 'rifle',   key: '2', label: 'Автомат АК-Б',        price: 2500 },
  { id: 'sniper',  key: '3', label: 'Снайпер AWP',         price: 4000 },
  { id: 'grenade', key: '4', label: 'Граната',             price: 300 },
  { id: 'armor',   key: '5', label: 'Броня',               price: 650 },
];

export const CFG = {
  HW: 0.3, H: 1.8, EYE: 1.62, HEAD_Y: 1.42,
  HEAD_MULT: 4,
  FREEZE: 12, LIVE: 105, END: 5, MATCHEND: 8,
  PLANT: 3.2, DEFUSE: 5, BOMB: 40,
  WIN_ROUNDS: 8, MAX_ROUNDS: 14, HALF: 7,
  START_MONEY: 800, MAX_MONEY: 16000,
  WIN_REWARD: 3250, LOSE_REWARD: 1400, STREAK_BONUS: 500, PLANT_BONUS: 300, DEFUSE_BONUS: 300,
  ARMOR: 100,
  SPEED: 5.2, JUMP: 8.0, GRAVITY: 24,
  NADE_RADIUS: 7, NADE_DMG: 100, NADE_BREAK: 3.6, NADE_FUSE: 1.8,
  MAX_PLAYERS: 10,
};
