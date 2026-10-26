// public/sandbox/js/ui/picker.js — 干员选择器（从 hud.js 抽出）。
import { esc } from './html.js';
import { PROFESSIONS } from '../operator-library.js';
import { avatar } from '../asset-urls.js';

export function setPicker(refs, on) { refs.picker.classList.toggle('is-on', !!on); }

/**
 * 选人器：自设干员与明确开放的支援，后接尚未接入的槽位。
 * @param {Array<{id,name,charId,rarity,prof}>} ops
 * @param {Array<{name:string,owner:string}>} [reserve]
 */
export function renderPicker(refs, ops, filter = '', reserve = []) {
  const q = filter.trim();
  const prof = refs._pickerProfession || '';
  if (!refs.pkProfessions) {
    refs.pkProfessions = document.createElement('nav'); refs.pkProfessions.className = 'pk__professions';
    refs.pkGrid.before(refs.pkProfessions);
    refs.pkProfessions.onclick = (e) => { const b = e.target.closest('[data-prof]'); if (!b) return; refs._pickerProfession = b.dataset.prof; renderPicker(refs, ops, refs.pkSearch.value, reserve); };
  }
  refs.pkProfessions.innerHTML = PROFESSIONS.map(([id, name]) => `<button class="dbtn${id === prof ? ' is-on' : ''}" data-prof="${id}">${name}</button>`).join('');
  const list = ops.filter((o) => (!prof || o.profession === prof) && (!q || o.name.includes(q) || o.id.includes(q)));
  const ready = list.map((o) => `<button class="pk__op" data-act="picker-pick" data-id="${esc(o.id)}" title="${esc(o.name)} · ${esc(o.prof)} · ${esc(o.role || '')}">
    <img src="${esc(avatar(o.charId))}" alt="" loading="lazy" /><span>${esc(o.name)}</span>
  </button>`).join('');
  const slots = q ? '' : reserve.map((r) => `<div class="pk__op pk__op--hold" title="${esc(r.owner)}">
    <i class="pk__ph">预留</i><span>${esc(r.name)}</span>
  </div>`).join('');
  refs.pkGrid.innerHTML = ready + slots
    || '<p class="dr__hint">没有匹配的干员。</p>';
}
