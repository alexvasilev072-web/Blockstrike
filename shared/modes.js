// Режими на игра като таблица (общо за сървъра и клиента). Новият режим се добавя тук с флагове и после в методите на Room (server/index.js).
//   kind    – 'rounds' (рундове с отбори, като CS) или 'race' (състезание на време: parkour/surf)
//   rounds  – има рундове, замръзване, край на рунд и мач
//   teams   – има отбори (чатът и гласът в рунд са само за отбора, лобито показва отборите)
//   bots    – позволени са ботове
//   shop    – има магазин и пари
//   combat  – оръжия, стрелба, гранати, бомба, предмети на земята, щети (без това: няма стрелба и оръжия)
//   race    – таймер, checkpoint-и, класация (HUD „run“)
//   fallDamage – щети от падане
//   mapMax  – броят играчи е ограничен от картата (map.max)
//   move    – допустими скорости (м/с) за проверката на движението на сървъра: h хоризонтално, v нагоре, inst моментна (при изчисляване на скоростта)
// Движението (физиката) има свои режими с името на режима в shared/physics.js (MODES) – там са ускоренията; тук са правилата на играта.
export const GAME_MODES = {
  comp: { id: 'comp', name: 'Състезателен', kind: 'rounds', rounds: true, teams: true, bots: true, shop: true, combat: true, race: false, fallDamage: true, mapMax: true, move: { h: 13, v: 16, inst: 14 } },
  parkour: { id: 'parkour', name: 'Parkour', kind: 'race', rounds: false, teams: false, bots: false, shop: false, combat: false, race: true, fallDamage: false, mapMax: false, move: { h: 14, v: 18, inst: 14 } },
  surf: { id: 'surf', name: 'Surf', kind: 'race', rounds: false, teams: false, bots: false, shop: false, combat: false, race: true, fallDamage: false, mapMax: false, move: { h: 95, v: 95, inst: 110 } },
};
export const MODE_IDS = Object.keys(GAME_MODES);
// конфигурацията на режима; непознат режим се третира като състезателен (както преди)
export const modeOf = m => GAME_MODES[m] || GAME_MODES.comp;
