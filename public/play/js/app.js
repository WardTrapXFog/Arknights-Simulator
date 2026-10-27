import { setTerminalState, terminalTransition, terminalReady } from '../../sandbox/js/terminal-shell.js';
import { data } from '../../js/data.js';
import { createAssets } from '../../js/assets.js';
import { loadOperatorLibrary, PROFESSIONS } from '../../sandbox/js/operator-library.js';
import { AVAILABLE_IDS, isDiy } from '../../sandbox/js/roster.js';
import { MAX_SQUAD } from '../../sandbox/js/state.js';
import { ENEMY_LIBRARY, LIBRARY_KEYS } from '../../sandbox/js/enemy-library.js';
import { ROWS, COLS } from '../../sandbox/js/battlefield.js';
import { avatar, skillIcon, useAssets } from '../../sandbox/js/asset-urls.js';
import { esc } from '../../sandbox/js/ui/html.js';
import { listLevels, loadLevels, lastLevelsError, importLevel, fetchLevelText } from '../../level/js/level-store.js';
import { parseLevel } from '../../../shared/level.js';
import { levelThumbnail } from '../../../shared/level-preview.js';
import { createLevelRun } from '../../sandbox/js/level-run.js';
import { readTeams, writeTeam, cleanTeam } from './team-store.js';
import { createAutoScroll } from '../../sandbox/js/ui/auto-scroll.js';
import { createDescriptionPager } from './description-pager.js';

const root = document.getElementById('start');
const context = { rows: ROWS, cols: COLS, enemyKeys: LIBRARY_KEYS };
const enemyNames = Object.fromEntries([...ENEMY_LIBRARY.official, ...ENEMY_LIBRARY.statsOnly].map((e) => [e.key, e]));
let selected = null, transient = null, screen = 'levels', team = cleanTeam(), teamIndex = 0;
let profession = '', search = '', sort = 'rarity', quick = true, active = null, error = '';
let records = {}, enemyData = {};
let rosterAuto = null, autoEnabled = false;
let descriptionPager = null;
const teamIds = () => new Set(team.ids);
function fail(e) { error = e.message || String(e); const el = root.querySelector('[data-status]'); if (el) el.textContent = error; }
function modal(title, html) {
  const dialog = document.createElement('dialog'); dialog.className = 'operation-dialog';
  dialog.innerHTML = `<header><h2>${esc(title)}</h2><button class="op-button" data-close>关闭 ×</button></header><div class="operation-dialog__body">${html}</div>`;
  dialog.onclick = (e) => { if (e.target.closest('[data-close]')) dialog.close(); };
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal(); return dialog;
}
function levels() {
  const library = listLevels(context);
  return transient && !library.some((l) => l.id === transient.id) ? [transient, ...library] : library;
}
function renderLevels() {
  descriptionPager?.destroy(); descriptionPager = null;
  rosterAuto?.destroy(); rosterAuto = null;
  screen = 'levels'; root.className = 'operation-screen'; setTerminalState('menu');
  const all = levels(); if (selected && !all.some((l) => l.id === selected.id)) selected = null;
  root.innerHTML = `<header class="operation-head"><div class="operation-heading"><span class="op-eyebrow">02 / OPERATION ARCHIVE</span><h1>选择作战</h1></div><span class="op-grow"></span><button class="op-button" data-action="import">导入 JSON</button></header>
    <div class="operation-levels"><main class="operation-level-grid">${all.map((lv) => `<button class="operation-level${lv.id === selected?.id ? ' is-on' : ''}" data-level="${esc(lv.id)}"><em class="operation-stars" aria-label="难度 ${lv.meta.difficulty} 星">${lv.meta.difficulty > 0 ? "★".repeat(lv.meta.difficulty) : "☆"}</em><img src="${esc(levelThumbnail(lv.stage))}" alt="${esc(lv.name)}关卡简图"><span><b>${esc(lv.name)}</b><small>${esc(lv.meta.tags.join(' / '))}</small></span></button>`).join('') || '<div class="operation-empty">还没有自制关卡。<br>可以导入 JSON，或在关卡制作器中制作并保存。</div>'}</main>
    <aside class="operation-level-detail${selected ? '' : ' is-unselected'}">${selected ? `<span class="op-eyebrow">OPERATION / BRIEFING</span><h2>${esc(selected.name)}</h2><p>${esc(selected.meta.note || '准备你的阵容，开始作战。')}</p><div class="op-tags">${selected.meta.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div><img class="operation-briefing-map" src="${esc(selected.thumbnail)}" alt="${esc(selected.name)}关卡简图"><div class="operation-briefing-summary"><div>作战难度<b>${selected.meta.difficulty > 0 ? "★".repeat(selected.meta.difficulty) : "☆"}</b></div><div>敌人种类<b>${new Set(selected.spawns.map((s) => s.enemy)).size}</b></div></div><div class="operation-briefing-actions"><button class="op-button" data-action="map">◇ 关卡简图</button><button class="op-button" data-action="enemies">◈ 敌方情报</button></div><span class="op-grow"></span><p class="op-dim">阵容与技能将在下一步由你选择。</p><button class="op-button op-button--primary" data-action="prepare">开始作战 →</button>` : '<div class="operation-level-invitation"><span class="operation-invitation-index" aria-hidden="true">OP / SELECT</span><div class="operation-invitation-threads" aria-hidden="true"><i></i><i></i><i></i><i></i></div><h2>请选择<br><strong>一张关卡</strong></h2><p>并开始你的<br><strong>挑战<span aria-hidden="true">↗</span></strong></p><small>选择左侧关卡，查看情报并编队出击。</small></div>'}<p class="op-status" data-status>${esc(error)}</p></aside></div>`;
}
function showEnemies() {
  const keys = [...new Set(selected.spawns.map((s) => s.enemy))];
  modal('敌方情报', `<div class="operation-enemies">${keys.map((key) => {
    const e = enemyData[key], manifest = data.getRaw('assets').enemies?.[key];
    return `<article>${manifest?.icon ? `<img src="${esc(manifest.icon)}" alt="">` : ''}<h3>${esc(e?.name || enemyNames[key]?.name || key)}</h3><small>${esc(({ NORMAL: '普通', ELITE: '精英', BOSS: '首领' })[e?.rank] || '')}${e?.isFlyEnemy ? ' · 飞行' : ''}</small><p>${esc(e?.desc || enemyNames[key]?.note || '')}</p></article>`;
  }).join('') || '<p>本关没有预设敌人。</p>'}</div>`);
}
function showImport() {
  const dialog = modal('导入自制关卡', `<input type="file" accept="application/json,.json" data-file><textarea data-json rows="10" placeholder="粘贴关卡 JSON"></textarea><label class="operation-url"><span>或粘贴链接</span><input data-url placeholder="https://…（gist / 仓库里的关卡 JSON 直链）"><button type="button" class="op-button" data-fetch>取回</button></label><label><input type="checkbox" data-keep checked>存入本地关卡库</label><button class="op-button op-button--primary" data-import>载入关卡</button><p data-import-error role="status"></p>`);
  dialog.onchange = async (e) => { if (!e.target.matches('[data-file]') || !e.target.files[0]) return; dialog.querySelector('[data-json]').value = await e.target.files[0].text(); };
  dialog.addEventListener('click', async (e) => {
    // 从链接取回：填进文本框，后面的「载入关卡」逻辑不分来源
    if (e.target.closest('[data-fetch]')) {
      const url = dialog.querySelector('[data-url]').value.trim();
      if (!url) { dialog.querySelector('[data-import-error]').textContent = '先填一个链接'; return; }
      try {
        dialog.querySelector('[data-json]').value = await fetchLevelText(url);
        dialog.querySelector('[data-import-error]').textContent = '已取回，检查一下再载入';
      } catch (err) { dialog.querySelector('[data-import-error]').textContent = err.message; }
      return;
    }
    if (!e.target.closest('[data-import]')) return;
    try {
      const text = dialog.querySelector('[data-json]').value;
      selected = dialog.querySelector('[data-keep]').checked ? importLevel(text, context) : parseLevel(text, context);
      transient = selected; error = ''; dialog.close(); renderLevels();
    } catch (err) { dialog.querySelector('[data-import-error]').textContent = err.message; }
  });
}
function getSkill(id) {
  const rec = records[id]; return rec.skills?.find((s) => s.index === team.skills[id]) || rec.skills?.find((s) => s.isDefault) || rec.skills?.[0];
}
/**
 * 选中的模组带来的文字：特性追加（traitOverride.moduleDesc）与天赋改写（talentChanges）。
 * 机械师特勤证章的那句「在【沉沦者的黑流树海】中，结构性原理的持续时间无限，5秒内未受到伤害后每秒获得4%最大生命的屏障」
 * 就在这里，面板上不显示的话玩家根本不知道带了模组之后会多出什么。
 */
function moduleText(rec, moduleId) {
  if (!moduleId || moduleId === 'none') return '';
  const m = (rec.modules || []).find((x) => x.uniEquipId === moduleId);
  if (!m) return '';
  const lines = [m.traitOverride?.moduleDesc, ...(m.talentChanges || []).map((t) => t.desc)]
    .filter((s) => typeof s === 'string' && s.trim());
  if (!lines.length) return '';
  return `<div class="operation-module-desc">${lines.map((s) => `<p>${esc(s)}</p>`).join('')}</div>`;
}
function initializeTeam() {
  team = readTeams()[teamIndex];
  if (!team.ids.length) team = cleanTeam({ ...team });
  for (const id of AVAILABLE_IDS) {
    const rec = records[id]; if (!rec) continue;
    if (!rec.skills?.some((s) => s.index === team.skills[id])) team.skills[id] = rec.skills?.find((s) => s.isDefault)?.index ?? 0;
    if (!Object.hasOwn(team.modules, id)) team.modules[id] = rec.module?.id || null;
    if (team.modules[id] && team.modules[id] !== 'none' && !rec.modules?.some((m) => m.uniEquipId === team.modules[id]) && rec.module?.id !== team.modules[id]) team.modules[id] = rec.module?.id || null;
  }
  active = team.ids[0] || AVAILABLE_IDS[0];
}
function renderPreparation() {
  descriptionPager?.destroy(); descriptionPager = null;
  const resumeAuto = autoEnabled;
  rosterAuto?.destroy();
  screen = 'team'; root.className = 'operation-screen'; setTerminalState('menu', () => { writeTeam(teamIndex, team); error = ''; renderLevels(); });
  root.innerHTML = `<header class="operation-head"><h1>${esc(selected.name)}</h1><span class="op-grow"></span><b>作战编队 <span data-team-count>${team.ids.length}</span> / ${MAX_SQUAD}</b><button class="op-button op-button--primary" data-action="battle">开始战斗 →</button></header>
    <div class="operation-team-bar"><nav class="operation-teams" aria-label="选择编队">${readTeams().map((t, i) => `<button class="op-button${i === teamIndex ? ' is-on' : ''}" data-team="${i}" title="${esc(t.name)}" aria-pressed="${i === teamIndex}"><small>${String(i + 1).padStart(2, '0')}</small><span>${esc(t.name)}</span></button>`).join('')}</nav><div class="operation-team-tools"><input maxlength="24" data-team-name value="${esc(team.name)}" aria-label="编队名称"><button class="op-button" data-action="save-team">保存编队</button><button class="op-button" data-action="clear-team">清空</button><label class="operation-quick-switch" title="开启后，点选干员即可编入或移出队伍"><input type="checkbox" data-quick${quick ? ' checked' : ''}><span>快速编队</span><b aria-hidden="true">${quick ? '开' : '关'}</b></label></div></div>
    <div class="operation-team"><nav class="operation-professions">${PROFESSIONS.map(([id, name]) => `<button class="op-button${profession === id ? ' is-on' : ''}" data-profession="${id}">${name}</button>`).join('')}</nav>
      <main class="operation-roster"><div class="operation-roster-tools"><input type="search" data-search value="${esc(search)}" placeholder="搜索干员 / 分支"><select data-sort><option value="rarity">稀有度</option><option value="cost">部署费用</option><option value="name">名称</option></select><button type="button" class="op-button" data-roster-auto aria-label="自动滚动干员列表" aria-pressed="false">[Auto]</button><small>满级 · 满潜 · 满信赖 · 技能满级</small></div><div class="operation-operators" data-operators></div></main>
      <aside class="operation-team-side"><div class="operation-selected-heading"><h2>已选阵容</h2><span>点选查看配装</span></div><div class="operation-selected" data-selected></div><section class="operation-loadout" data-loadout></section><p class="op-status" data-status>${esc(error)}</p></aside></div>`;
  root.querySelector('[data-sort]').value = sort; renderOperators(); renderSelection();
  rosterAuto = createAutoScroll(root.querySelector('[data-operators]'), root.querySelector('[data-roster-auto]'), (value) => { autoEnabled = value; });
  rosterAuto.setEnabled(resumeAuto);
}
function renderOperators() {
  const list = AVAILABLE_IDS.map((id) => records[id]).filter((r) => r && (!profession || r.profession === profession) && (!search || `${r.name} ${r.subProfessionName} ${r.charId}`.toLowerCase().includes(search.toLowerCase())));
  list.sort((a, b) => sort === 'cost' ? a.stats.cost - b.stats.cost : sort === 'name' ? a.name.localeCompare(b.name, 'zh') : b.rarity - a.rarity || a.name.localeCompare(b.name, 'zh'));
  const ids = teamIds();
  root.querySelector('[data-operators]').innerHTML = list.map((r) => `<button class="operation-operator${ids.has(r.chessId) ? ' is-selected' : ''}${active === r.chessId ? ' is-active' : ''}" data-operator="${esc(r.chessId)}"><img src="${esc(avatar(r.charId))}" alt="" loading="lazy"><b>${esc(r.name)}</b><small>${esc(PROFESSIONS.find(([id]) => id === r.profession)?.[1] || '')} · ${r.stats.cost} 费</small><span class="operation-operator-type">${isDiy(r.chessId) ? '自设' : `★${r.rarity}`}</span>${ids.has(r.chessId) ? `<span class="operation-operator-check">✓ ${team.ids.indexOf(r.chessId) + 1}</span>` : ''}</button>`).join('') || '<p class="operation-empty">没有匹配的干员。</p>';
}
function renderSelection() {
  descriptionPager?.destroy(); descriptionPager = null;
  root.querySelector('[data-team-count]').textContent = team.ids.length;
  root.querySelector('[data-selected]').innerHTML = Array.from({ length: MAX_SQUAD }, (_, i) => {
    const id = team.ids[i], rec = records[id];
    const label = rec ? `${i + 1} · ${rec.name} · S${(getSkill(id)?.index ?? 0) + 1}` : '';
    return rec ? `<div class="operation-selected-slot${id === active ? ' is-on' : ''}"><button class="operation-selected-focus" data-focus="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}"><img src="${esc(avatar(rec.charId))}" alt=""><span class="operation-selected-number" aria-hidden="true">${i + 1}</span><small aria-hidden="true">S${(getSkill(id)?.index ?? 0) + 1}</small></button><button class="operation-selected-remove" data-remove="${esc(id)}" title="移出${esc(rec.name)}" aria-label="移出${esc(rec.name)}">×</button></div>` : `<div class="operation-selected-slot is-empty">${i + 1}<small>＋</small></div>`;
  }).join('');
  const r = records[active], host = root.querySelector('[data-loadout]'); if (!r) { host.innerHTML = ''; return; }
  const skill = getSkill(active);
  host.innerHTML = `<div class="operation-loadout-identity"><h3>${esc(r.name)}${isDiy(active) ? '（自设）' : ''}</h3><small>${r.status?.phase ? `精英 ${r.status.phase} · ` : ''}Lv.${r.status?.level || ''} · ${esc(r.subProfessionName || '')}</small></div><div class="operation-skills">${(r.skills || []).map((s) => `<button class="op-button${skill?.index === s.index ? ' is-on' : ''}" data-skill="${s.index}" title="${esc(s.name)}">${skillIcon(s.skillId) ? `<img src="${esc(skillIcon(s.skillId))}" alt="">` : ''}S${s.index + 1}</button>`).join('')}</div><b class="operation-skill-name">${esc(skill?.name || '无主动技能')}</b>
    ${r.modules?.length ? `<label class="operation-module-choice">模组<select data-module><option value="none"${team.modules[active] === 'none' ? ' selected' : ''}>不装备</option>${r.modules.map((m) => `<option value="${esc(m.uniEquipId)}"${team.modules[active] === m.uniEquipId ? ' selected' : ''}>${esc(m.name)} · Lv.3</option>`).join('')}</select></label>` : ''}
    <div class="operation-description-panel"><div class="operation-description-viewport" data-description-viewport><div class="operation-description-pages" data-description-pages><p class="operation-skill-description">${esc(skill?.desc || '无主动技能说明。')}</p>${r.modules?.length ? moduleText(r, team.modules[active]) : r.module?.active ? `<p>${esc(r.module.name)} · Lv.${r.module.level}</p>` : ''}</div></div><div class="operation-description-controls"><span>技能 / 模组说明</span><button type="button" data-description-prev aria-label="上一页说明">‹</button><output data-description-status aria-live="polite">1 / 1</output><button type="button" data-description-next aria-label="下一页说明">›</button></div></div>
    <button class="op-button operation-loadout-toggle" data-action="toggle-active">${team.ids.includes(active) ? '移出编队' : '编入队伍'}</button>`;
  descriptionPager = createDescriptionPager(host);
}
function toggleOperator(id) {
  const index = team.ids.indexOf(id);
  if (index >= 0) team.ids.splice(index, 1);
  else { if (team.ids.length >= MAX_SQUAD) throw Error(`最多携带 ${MAX_SQUAD} 名干员`); team.ids.push(id); }
}
async function startBattle() {
  if (!team.ids.length) throw Error('请至少选择一名干员');
  writeTeam(teamIndex, team);
  const run = createLevelRun(selected, team.ids, team.skills, team.modules);
  // 出战配置只在本次页面内传递；不激活、不覆盖自由沙盒的当前现场或存档槽。
  await terminalTransition(async () => {
    descriptionPager?.destroy(); descriptionPager = null;
    rosterAuto?.destroy(); rosterAuto = null;
    setTerminalState('battle');
    root.innerHTML = '<div class="operation-empty">正在载入战场…</div>';
    const { bootSandbox } = await import('../../sandbox/js/controller.js');
    root.remove(); await bootSandbox({ run });
  });
}
root.onclick = async (e) => {
  try {
    const level = e.target.closest('[data-level]');
    if (level) { selected = levels().find((l) => l.id === level.dataset.level); error = ''; renderLevels(); return; }
    const prof = e.target.closest('[data-profession]'); if (prof) { profession = prof.dataset.profession; renderPreparation(); return; }
    const preset = e.target.closest('[data-team]'); if (preset) { writeTeam(teamIndex, team); teamIndex = Number(preset.dataset.team); initializeTeam(); renderPreparation(); return; }
    const op = e.target.closest('[data-operator]'); if (op) { active = op.dataset.operator; if (quick) { try { toggleOperator(active); } catch (err) { renderOperators(); renderSelection(); throw err; } } renderOperators(); renderSelection(); return; }
    const focus = e.target.closest('[data-focus]'); if (focus) { active = focus.dataset.focus; renderOperators(); renderSelection(); return; }
    const remove = e.target.closest('[data-remove]'); if (remove) { toggleOperator(remove.dataset.remove); renderOperators(); renderSelection(); return; }
    const skill = e.target.closest('[data-skill]'); if (skill) { team.skills[active] = Number(skill.dataset.skill); renderSelection(); return; }
    const act = e.target.closest('[data-action]')?.dataset.action;
    if (act === 'map') modal('关卡简图', `<img class="operation-map" src="${esc(levelThumbnail(selected.stage))}" alt="关卡简图"><p>红 ▼ 出生点 · 蓝 ▲ 目标点 · 棕色高台 · 金色边框为战场范围</p>`);
    if (act === 'enemies') showEnemies();
    if (act === 'import') showImport();
    if (act === 'prepare') { error = ''; initializeTeam(); await terminalTransition(renderPreparation); }
    if (act === 'back') { writeTeam(teamIndex, team); error = ''; renderLevels(); }
    if (act === 'clear-team') { team.ids = []; renderOperators(); renderSelection(); }
    if (act === 'save-team') { writeTeam(teamIndex, team); renderPreparation(); }
    if (act === 'toggle-active') { toggleOperator(active); renderOperators(); renderSelection(); }
    if (act === 'battle') await startBattle();
  } catch (err) { if (!root.isConnected) { document.getElementById('app').textContent = `载入失败：${err.message}`; } else fail(err); }
};
root.oninput = (e) => { if (e.target.matches('[data-search]')) { search = e.target.value; renderOperators(); } if (e.target.matches('[data-team-name]')) team.name = e.target.value; };
root.onchange = (e) => {
  if (e.target.matches('[data-quick]')) {
    quick = e.target.checked;
    e.target.closest('.operation-quick-switch').querySelector('b').textContent = quick ? '开' : '关';
  }
  if (e.target.matches('[data-sort]')) { sort = e.target.value; renderOperators(); }
  if (e.target.matches('[data-module]')) { team.modules[active] = e.target.value || 'none'; renderSelection(); }
};
async function boot() {
  root.className = 'operation-screen';
  try {
    await data.loadAll('chess', 'enemies', 'assets'); await loadOperatorLibrary(data);
    records = data.getRaw('chess'); enemyData = data.getRaw('enemies');
    const assets = createAssets(); assets.seed(data.getRaw('assets')); useAssets(assets);
    // 关卡库来自服务端目录（content/levels/），不是浏览器缓存
    await loadLevels(context);
    if (lastLevelsError()) error = lastLevelsError();
    const url = new URL(location.href), id = url.searchParams.get('level'), prepare = url.searchParams.has('squad');
    history.replaceState(null, '', location.pathname);
    if (id) { selected = listLevels(context).find((l) => l.id === id); if (!selected) throw Error('找不到这张关卡，请重新选择或导入 JSON'); }
    if (prepare && selected) { initializeTeam(); renderPreparation(); } else renderLevels();
  } catch (err) { renderLevels(); fail(err); }
  finally { terminalReady(); }
}
boot();
