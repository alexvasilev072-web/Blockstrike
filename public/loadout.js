// Меню „Инвентар“ (главното меню): любимите оръжия и екипировка за всеки отбор. В магазина (B) има бързи бутони за тях.
// Парите и цените са както в играта – това е само предпочитание. Пази се в localStorage.
import { WEAPONS, BUY_CATS, weaponsOfCat, cleanLoadout, DEFAULT_LOADOUT } from '/shared/weapons.js';
import { weaponIcon } from './wicons.js';

const $ = s => document.querySelector(s), KEY = 'bs_loadout';
export function loadLoadout() { try { return cleanLoadout(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return cleanLoadout(); } }
export const loadout = loadLoadout();
const NADE_LABELS = [['he', 'HE граната'], ['flash', 'Flashbang'], ['smoke', 'Димна'], ['molo', 'Молотов']];

export function initLoadout() {
  let team = 'att';
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(loadout)); } catch { } };
  const wbtn = (id, on, slot) => `<button class="lw ${on ? 'on' : ''}" data-w="${id}" data-s="${slot}"><img src="${weaponIcon(id)}" alt=""><b>${WEAPONS[id].name}</b><span>$${WEAPONS[id].price}</span></button>`;
  function render() {
    const L = loadout[team];
    document.querySelectorAll('#loadoutTeam button').forEach(b => b.classList.toggle('on', b.dataset.t === team));
    const pr = BUY_CATS.filter(c => c.id !== 'se').flatMap(c => weaponsOfCat(c, team)), se = weaponsOfCat(BUY_CATS[0], team);
    $('#loadoutBody').innerHTML =
      `<h4>Основно оръжие</h4><div class="lgrid"><button class="lw ${L.pr === null ? 'on' : ''}" data-w="" data-s="pr"><b>Без основно</b><span>само пистолет</span></button>${pr.map(id => wbtn(id, L.pr === id, 'pr')).join('')}</div>` +
      `<h4>Пистолет</h4><div class="lgrid"><button class="lw ${L.se === null ? 'on' : ''}" data-w="" data-s="se"><b>Стандартният</b><span>безплатен</span></button>${se.map(id => wbtn(id, L.se === id, 'se')).join('')}</div>` +
      `<h4>Екипировка</h4><div class="lrow">${NADE_LABELS.map(([k, n]) => `<label class="chk"><input type="checkbox" data-n="${k}" ${L.nades.includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}` +
      `<label class="chk"><input type="checkbox" data-g="armor" ${L.armor ? 'checked' : ''}> Броня</label>${team === 'def' ? `<label class="chk"><input type="checkbox" data-g="kit" ${L.kit ? 'checked' : ''}> Defuse kit</label>` : ''}</div>`;
    $('#loadoutBody').querySelectorAll('.lw').forEach(b => b.onclick = () => { L[b.dataset.s] = b.dataset.w || null; save(); render(); });
    $('#loadoutBody').querySelectorAll('input[data-n]').forEach(i => i.onchange = () => { L.nades = NADE_LABELS.map(x => x[0]).filter(k => (k === i.dataset.n ? i.checked : L.nades.includes(k))); save(); });
    $('#loadoutBody').querySelectorAll('input[data-g]').forEach(i => i.onchange = () => { L[i.dataset.g] = i.checked; save(); });
  }
  document.querySelectorAll('.loadoutOpen').forEach(b => b.onclick = () => { $('#loadout').classList.remove('hidden'); render(); });
  $('#loadoutClose').onclick = () => $('#loadout').classList.add('hidden');
  document.querySelectorAll('#loadoutTeam button').forEach(b => b.onclick = () => { team = b.dataset.t; render(); });
  $('#loadoutReset').onclick = () => { Object.assign(loadout, JSON.parse(JSON.stringify(DEFAULT_LOADOUT))); save(); render(); };
}
