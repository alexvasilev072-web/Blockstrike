// Режими на игра като таблица (общо за сървъра и клиента). Новият режим се добавя тук с флагове и после в методите на Room (server/index.js).
//   kind    – вид на режима ('rounds': рундове с отбори, като CS)
//   rounds  – има рундове, замръзване, край на рунд и мач
//   teams   – има отбори (чатът и гласът в рунд са само за отбора, лобито показва отборите)
//   bots    – позволени са ботове
//   shop    – има магазин и пари
//   combat  – оръжия, стрелба, гранати, бомба, предмети на земята, щети
//   fallDamage – щети от падане
//   mapMax  – броят играчи е ограничен от картата (map.max)
//   move    – допустими скорости (м/с) за проверката на движението на сървъра: h хоризонтално, v нагоре, inst моментна
export const GAME_MODES = {
  comp: { id: 'comp', name: 'Състезателен', kind: 'rounds', rounds: true, teams: true, bots: true, shop: true, combat: true, fallDamage: true, mapMax: true, move: { h: 13, v: 16, inst: 14 } },
};
export const MODE_IDS = Object.keys(GAME_MODES);
// конфигурацията на режима; непознат режим се третира като състезателен (както преди)
export const modeOf = m => GAME_MODES[m] || GAME_MODES.comp;
