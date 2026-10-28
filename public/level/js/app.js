import { setTerminalState, terminalReady } from '../../sandbox/js/terminal-shell.js';
// 关卡制作器：纯数据编辑与 SVG 轨迹推演。
import { data } from '../../js/data.js';
import { ROWS, COLS } from '../../sandbox/js/battlefield.js';
import { ENEMY_LIBRARY, LIBRARY_KEYS } from '../../sandbox/js/enemy-library.js';
import { listLevels, loadLevels, lastLevelsError, saveLevel, saveLevelAs, deleteLevel, duplicateLevel, createLevel, importLevel, fetchLevelText, exportLevel, nameTaken, findLevel } from './level-store.js';
import { validateLevel, cloneLevel, parseLevel, LevelError, MAX_SPAWNS, DEFAULT_DEPLOY_LIMIT, DEFAULT_LIFE_LIMIT, MAX_DIFFICULTY, levelNameProblem } from '../../../shared/level.js';
import { newSpawn, routeOf, invalidateTrajectories, playableUntil } from './level-model.js';
import { LevelTerrainEditor } from './terrain.js';
import { LevelRoutesEditor, previewRoute } from './routes.js';
import { LevelTimeline } from './timeline.js';
import { LevelTracer } from './tracer.js';
import { createWorkspaceLayout, closePanel } from './workspace-layout.js';

const root = document.getElementById('level');
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const notePreview = (value) => value ? value.length > 80 ? `${value.slice(0, 80)}…` : value : '暂无备注';
const names = Object.fromEntries([...ENEMY_LIBRARY.official, ...ENEMY_LIBRARY.statsOnly].map((e) => [e.key, e]));
let current = null, terrain = null, routes = null, timeline = null, tracer = null;
let sidePage = 'tool', libraryPage = 0;
let mode = 'terrain', cursor = 0, dirty = false, saved = '', error = '', past = [], future = [], transaction = null, disposing = false, leaving = false;
let speedOf = {}, duration = 60, drawingSpawnId = null;
let draftEnemy = ENEMY_LIBRARY.official[0]?.key || '', search = '', rank = '', flyOnly = false, rangedOnly = false, showStats = false;
const ctx = () => ({ rows: ROWS, cols: COLS, enemyKeys: LIBRARY_KEYS });
// 作战音乐：content/music 下的本地曲子（服务端 /api/music 列出来，/music/<name> 送文件）。
// 关卡只存文件名，播放时客户端拼成 /music/<encodeURIComponent(name)>，所以换目录、换机器都能用。
let musicFiles = null;   // null = 还没取到；[] = 目录为空或取失败
const musicOptions = (selected) => ['<option value="">（不播放）</option>']
  .concat((musicFiles || []).map((f) => `<option value="${esc(f.name)}"${f.name === selected ? ' selected' : ''}>${esc(f.name)}</option>`))
  .concat(selected && !(musicFiles || []).some((f) => f.name === selected) ? [`<option value="${esc(selected)}" selected>${esc(selected)}（当前无此文件）</option>`] : [])
  .concat(musicFiles && !musicFiles.length ? ['<option value="" disabled>（content/music 里没有曲子，或服务端还没重启）</option>'] : [])
  .join('');
async function loadMusic() {
  try { const r = await fetch('/api/music', { cache: 'no-store' }); musicFiles = (await r.json())?.files || []; } catch { musicFiles = []; }
  const sel = root.querySelector('[data-level-field="bgm"]');
  if (sel && current) { const v = current.meta.bgm || ''; sel.innerHTML = musicOptions(v); sel.value = v; }
}
function fail(e) { error = e instanceof LevelError ? `${e.path}：${e.reason}` : e.message || String(e); if (current) showError(); else renderList(); }
function showError() {
  const el = root.querySelector('#lv-error');
  if (el) { el.textContent = error ? `查看问题：${error.split('\n')[0]}` : ''; el.hidden = !error; el.title = error; }
  const body = root.querySelector('#lv-error-details'); if (body) body.textContent = error;
}
function snapshot() { return { level: cloneLevel(current), selected: [...(timeline?.ids || [])], route: routes?.selected ?? -1, mode, cursor }; }
function fingerprint(state = snapshot()) { return JSON.stringify(state.level); }
function markDirty() {
  dirty = !!current && fingerprint() !== saved;
  const el = root.querySelector('#lv-dirty'); if (el) el.textContent = dirty ? '未保存' : '已保存';
  const undo = root.querySelector('[data-act="undo"]'), redo = root.querySelector('[data-act="redo"]');
  if (undo) undo.disabled = !past.length; if (redo) redo.disabled = !future.length;
}
function begin() { if (transaction || !current) return; timeline && (timeline.playing = false); transaction = snapshot(); error = ''; showError(); }
function commit() {
  if (!transaction) return;
  if (fingerprint(transaction) !== fingerprint()) { past.push(transaction); if (past.length > 32) past.shift(); future = []; }
  transaction = null; markDirty();
}
function finishEdits() { terrain?.finishGesture(); if (timeline?.drag) timeline.pointerUp(); commit(); }
function restore(state) {
  current = cloneLevel(state.level); mode = state.mode; cursor = state.cursor;
  drawingSpawnId = null; routes.reset(); routes.selected = state.route;
  timeline.ids = new Set(state.selected); timeline.setLevel(current); applyMode(); terrain.renderControls(); refresh();
}
function change(fn) {
  finishEdits(); begin();
  try { fn(); commit(); refresh(); }
  catch (e) { const before = transaction; transaction = null; if (before) restore(before); throw e; }
}
function undo(redo = false) {
  finishEdits(); const from = redo ? future : past, to = redo ? past : future;
  if (!from.length) return; to.push(snapshot()); if (to.length > 32) to.shift(); restore(from.pop());
}
function refresh() {
  if (!current || disposing) return;
  invalidateTrajectories(current); duration = playableUntil(current, speedOf);
  terrain?.renderMap(); routes?.render();
  timeline.ids = new Set([...timeline.ids].filter((id) => current.spawns.some((s) => s.id === id)));
  if (!timeline?.drag) timeline?.render();
  for (const el of root.querySelectorAll('[data-level-field]')) {
    if (el === document.activeElement) continue;
    const f = el.dataset.levelField;
    el.value = f === 'name' ? current.name : f === 'tags' ? current.meta.tags.join('，') : f === 'bgm' ? (current.meta.bgm || '') : f === 'author' ? (current.meta.author || '') : f === 'deployLimit' ? (current.meta.deployLimit ?? DEFAULT_DEPLOY_LIMIT) : f === 'lifeLimit' ? (current.meta.lifeLimit ?? DEFAULT_LIFE_LIMIT) : current.meta[f];
  }
  const note = root.querySelector('.lv-note-preview'); if (note) note.textContent = notePreview(current.meta.note);
  renderNameHints();
  renderSpawn(); timeline?.setCursor(cursor); tracer?.highlight(timeline?.selected); markDirty(); showError();
}
function previewChange() { invalidateTrajectories(current); duration = playableUntil(current, speedOf); terrain.renderMap(); routes?.render(); tracer?.showAt(cursor); markDirty(); }
function applyMode() {
  for (const b of root.querySelectorAll('[data-side-page]')) b.classList.toggle('is-on', b.dataset.sidePage === sidePage);
  root.querySelector('#lv-info').hidden = sidePage !== 'info';
  for (const b of root.querySelectorAll('[data-mode]')) b.classList.toggle('is-on', b.dataset.mode === mode);
  for (const section of ['terrain', 'routes', 'spawns']) root.querySelector(`#lv-${section}`).hidden = ({ terrain: 'terrain', routes: 'route', spawns: 'spawn' })[section] !== mode || sidePage !== 'tool';
}
function setMode(next) {
  finishEdits(); if (next !== 'terrain') terrain.exit(); if (next !== 'route') routes.deactivate();
  mode = next; sidePage = 'tool'; applyMode(); routes.render(); tracer?.showAt(cursor);
}
function filteredEnemies() {
  return [...ENEMY_LIBRARY.official, ...(showStats ? ENEMY_LIBRARY.statsOnly : [])].filter((e) =>
    (!search || `${e.name} ${e.short} ${e.key}`.toLowerCase().includes(search.toLowerCase())) && (!rank || rank === e.rank) && (!flyOnly || e.fly) && (!rangedOnly || e.ranged));
}
function enemyOptions(selected = draftEnemy) {
  const entries = filteredEnemies(), groups = { NORMAL: '普通', ELITE: '精英', BOSS: '首领' };
  const included = entries.some((e) => e.key === selected);
  return (!included && names[selected] ? `<option value="${esc(selected)}" selected>${esc(names[selected].name)}（当前选择）</option>` : '')
    + Object.entries(groups).map(([key, label]) => `<optgroup label="${label}">${entries.filter((e) => e.rank === key).map((e) => `<option value="${esc(e.key)}" title="${esc(e.note)}"${e.key === selected ? ' selected' : ''}>${ENEMY_LIBRARY.statsOnly.includes(e) ? '⚠ ' : ''}${esc(e.name)}${e.fly ? ' · 飞行' : ''}</option>`).join('')}</optgroup>`).join('');
}
function renderEnemyPick() {
  root.querySelector('#lv-enemy-pick').innerHTML = enemyOptions();
  const label = root.querySelector('[data-open-panel="lv-enemy-dialog"]');
  if (label) label.textContent = `敌人：${names[draftEnemy]?.short || '选择'} ▾`;
  root.querySelector('#lv-enemy-note').textContent = names[draftEnemy]?.note || '当前筛选没有匹配敌人';
}
function addSpawns({ at = cursor, interval = 0, count = 1, enemy = draftEnemy, route = null, pos = null }) {
  if (!Number.isFinite(at) || at < 0 || !Number.isFinite(interval) || interval < 0 || !Number.isInteger(count) || count < 1) throw new Error('出生时间与间隔须非负，数量须为正整数');
  if (at + interval * (count - 1) > 3600) throw new Error('最后一只的出生时间不能超过 3600 秒');
  if (current.spawns.length + count > MAX_SPAWNS) throw new Error(`这一关最多允许 ${MAX_SPAWNS} 条出生`);
  if (!LIBRARY_KEYS.has(enemy)) throw new Error('请先选择敌人');
  const created = Array.from({ length: count }, (_, i) => newSpawn({ at: Math.round((at + i * interval) * 1000) / 1000, enemy, route, pos }));
  change(() => { current.spawns.push(...created); timeline.ids = new Set(created.map((s) => s.id)); });
}
function placeAtTime(at) {
  const route = routes.route;
  addSpawns({ at, route: route?.id || null, pos: route ? null : [current.stage.rect.r0, current.stage.rect.c0] });
}
function renderSpawn() {
  const host = root.querySelector('#lv-spawns'), s = timeline?.selected;
  if (!host) return;
  host.innerHTML = `<h2>出生 ${current.spawns.length} · 已选 ${timeline?.ids.size || 0}</h2><p class="lv-hint">在地图点一格原地放置；点时间轴或单位查看属性。多选时，下面只修改第一只。</p>` + (!s ? '' : `
    <div class="lv-field"><label>敌人</label><select data-spawn-field="enemy">${enemyOptions(s.enemy)}</select></div>
    <p class="lv-hint">${esc(names[s.enemy]?.note)}</p>
    <div class="lv-field"><label>第几秒</label><input data-spawn-field="at" type="number" min="0" max="3600" step="0.1" value="${s.at}"></div>
    <div class="lv-field"><label>路线</label><select data-spawn-field="route"><option value=""${s.route == null ? ' selected' : ''}>原地不动</option>${typeof s.route === 'object' && s.route ? '<option value="__private" selected>导入的私有路线</option>' : ''}${current.stage.routes.map((r) => `<option value="${esc(r.id)}"${s.route === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}<option value="__new">新画一条…</option></select></div>
    ${s.route == null ? `<div class="lv-field"><label>行 / 列</label><input data-spawn-field="row" type="number" min="0" max="${ROWS - 1}" value="${s.pos[0]}"><input data-spawn-field="col" type="number" min="0" max="${COLS - 1}" value="${s.pos[1]}"></div>` : ''}
    <div class="lv-field"><label>备注</label><input data-spawn-field="note" maxlength="400" value="${esc(s.note || '')}"></div>
    <div class="lv-row"><button class="lv-btn lv-btn--red" data-act="spawn-delete">删除选中</button></div>`);
}
function requireReady() {
  finishEdits(); if (routes.pending) throw new Error('请先设置路线起点，或按 Esc 取消画线'); validateLevel(current, ctx());
  const problems = routes.problems();
  current.spawns.forEach((s, i) => { if (s.route && typeof s.route === 'object') problems.push(...previewRoute(current.stage, s.route).problems.map((p) => `出生 ${i + 1}：${p}`)); });
  if (problems.length) throw new Error(problems.join('\n'));
}
/**
 * 导入一份关卡文本：撞 id 就问「覆盖更新」还是「另存为新关」，绝不静默改写别人的关卡。
 * 导入后重新拉一次关卡库：写盘失败（磁盘错误、权限）会体现在 lastLevelsError 里，界面能看到真实结果。
 */
async function importWithChoice(text) {
  const probe = parseLevel(text, ctx());
  const same = findLevel(probe.id);
  const overwrite = same
    ? confirm(`关卡库里已经有同一关「${same.name}」（id ${same.id}）。\n\n确定 = 覆盖更新那一关（内容会被这份文件替换）\n取消 = 另存为新关卡（新 id，旧关卡保留）`)
    : false;
  const level = await importLevel(text, ctx(), { mode: overwrite ? 'overwrite' : 'copy' });
  await loadLevels(ctx());
  if (lastLevelsError()) throw new Error(lastLevelsError());
  return level;
}
function requireName(name, exceptId = current?.id) {
  const problem = levelNameProblem(name);
  if (problem) throw new LevelError('level.name', problem);
  if (nameTaken(name, exceptId)) throw new LevelError('level.name', `已经有叫「${name}」的关卡了`);
}
/** 保存：id 不动；关卡名变了，磁盘上的文件跟着改名。失败抛出，界面显示原因。 */
async function save() {
  requireReady();
  await saveLevel(current, ctx(), { wait: true });
  saved = fingerprint(); markDirty(); showError(); renderNameHints();
  return current;
}
/** 另存为：新 id、新文件名，当前编辑对象切到那一关，原关卡一个字不动。 */
async function saveAs(name) {
  requireReady();
  requireName(name, '');   // 另存为总造新关卡，所以名字不能被任何一关占着
  const savedLevel = await saveLevelAs(current, ctx(), name);
  current = cloneLevel(savedLevel); past = []; future = []; transaction = null;
  timeline?.setLevel(current);
  // 地址栏跟着换成新关卡的 id：另存为之后再刷新，打开的是刚存下的这一份，而不是原关卡。
  history.replaceState(null, '', `/studio/level.html?level=${encodeURIComponent(current.id)}`);
  saved = fingerprint(); markDirty(); refresh(); renderNameHints();
}
function renderNameHints() {
  if (!current) return;
  const nameHint = root.querySelector('#lv-name-hint');
  if (nameHint) nameHint.textContent = nameTaken(current.name, current.id) ? `关卡库里已经有叫「${current.name}」的关卡了，换个名字再保存。` : `关卡名同时是文件名（${current.name}.json），保存时一并重命名。`;
  const idHint = root.querySelector('#lv-id-hint'); if (idHint) idHint.textContent = current.id;
  const sub = root.querySelector('.lv-head .lv-sub'); if (sub) sub.textContent = `${current.name}.json`;
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = `${name}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function disposeEditor() {
  disposing = true; terrain?.destroy(); routes?.destroy(); timeline?.destroy(); tracer?.destroy();
  terrain = routes = timeline = tracer = null; disposing = false;
}
function openLevel(id) {
  const lv = listLevels(ctx()).find((v) => v.id === id); if (!lv) throw new Error('找不到这一关');
  disposeEditor(); current = cloneLevel(lv); error = ''; past = []; future = []; transaction = null; mode = 'terrain'; cursor = 0; drawingSpawnId = null;
  renderEditor(); saved = fingerprint(); markDirty();
}
function renderList() {
  setTerminalState('menu');
  root.oninput = null;
  const levels = listLevels(ctx());
  root.className = 'lv-workspace lv-workspace--library';
  const columns = Math.max(1, Math.min(3, Math.floor(root.clientWidth / 360)));
  const rows = Math.max(1, Math.floor((root.clientHeight - 260) / 240)), perPage = rows * columns;
  const pages = Math.max(1, Math.ceil(levels.length / perPage)); libraryPage = Math.min(libraryPage, pages - 1);
  const visibleLevels = levels.slice(libraryPage * perPage, (libraryPage + 1) * perPage);
  root.innerHTML = `<header class="lv-head"><h1>关卡制作器</h1><span class="lv-sub">关卡库 · ${levels.length} 关</span><span class="lv-spacer"></span></header>
    <div class="lv-body">${error ? `<button id="lv-error" class="lv-err" data-open-panel="lv-error-dialog">${esc(error.split('\n')[0])}</button>` : ''}<div class="lv-actions"><button class="lv-btn lv-btn--pri" data-act="new">新建关卡</button><button class="lv-btn" data-act="import">导入 JSON</button></div>
    <dialog id="lv-import" class="lv-dialog"><header><h2>导入关卡</h2><button class="lv-btn" data-close-panel>关闭</button></header><div class="lv-dialog-body"><input id="lv-file" type="file" accept="application/json,.json"><textarea id="lv-import-text" rows="6" placeholder="或在此粘贴关卡 JSON"></textarea><button class="lv-btn" data-act="import-text">导入文本</button><div class="lv-field"><label>链接</label><input id="lv-import-url" placeholder="https://…（gist / 仓库里的关卡 JSON 直链）"></div><button class="lv-btn" data-act="import-url">从链接导入</button></div></dialog>
    <div class="lv-list" style="--library-columns:${columns};--library-rows:${rows}">${visibleLevels.map((lv) => `<div class="lv-card"><div class="lv-card__main"><img class="lv-card__preview" src="${esc(lv.thumbnail)}" alt="${esc(lv.name)}关卡简图" loading="lazy"><div class="lv-card__name">${esc(lv.name)}</div><div class="lv-card__meta">难度 ${lv.meta.difficulty} · 敌人 ${lv.spawns.length}${lv.meta.author ? ` · by ${esc(lv.meta.author)}` : ''}</div></div><div class="lv-card__ops">${[['open', '打开'], ['dup', '复制'], ['export', '导出'], ['del', '删除']].map(([act, text]) => `<button class="lv-btn${act === 'del' ? ' lv-btn--red' : act === 'open' ? ' lv-btn--pri' : ''}" data-act="${act}" data-id="${esc(lv.id)}">${text}</button>`).join('')}</div></div>`).join('') || '<div class="lv-empty">还没有关卡，先新建一关。</div>'}</div><nav class="lv-pagination"><button class="lv-btn" data-act="page-prev"${libraryPage === 0 ? ' disabled' : ''}>上一页</button><span>${libraryPage + 1} / ${pages} · 共 ${levels.length} 关</span><button class="lv-btn" data-act="page-next"${libraryPage + 1 === pages ? ' disabled' : ''}>下一页</button></nav></div><dialog id="lv-error-dialog" class="lv-dialog"><header><h2>关卡问题</h2><button class="lv-btn" data-close-panel>关闭</button></header><pre class="lv-dialog-body" id="lv-error-details">${esc(error)}</pre></dialog>`;
  root.onclick = (e) => {
    if (e.target.closest('[data-close-panel]')) { closePanel(e.target); return; }
    const opener = e.target.closest('[data-open-panel]'); if (opener) { root.querySelector(`#${opener.dataset.openPanel}`).showModal(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    try {
      const id = b.dataset.id;
      if (b.dataset.act === 'page-prev') { libraryPage--; renderList(); }
      else if (b.dataset.act === 'page-next') { libraryPage++; renderList(); }
      else if (b.dataset.act === 'new') openLevel(createLevel({ rows: ROWS, cols: COLS }, ctx()).id);
      else if (b.dataset.act === 'open') openLevel(id);
      else if (b.dataset.act === 'dup') { duplicateLevel(id, ctx()); renderList(); }
      else if (b.dataset.act === 'del' && confirm('删除这张关卡？')) { deleteLevel(id, ctx()); renderList(); }
      else if (b.dataset.act === 'export') { const lv = levels.find((v) => v.id === id); download(lv.name, exportLevel(lv)); }
      else if (b.dataset.act === 'import') root.querySelector('#lv-import').showModal();
      else if (b.dataset.act === 'import-text') { importWithChoice(root.querySelector('#lv-import-text').value).then((lv) => openLevel(lv.id)).catch(fail); }
      else if (b.dataset.act === 'import-url') {
        const url = root.querySelector('#lv-import-url').value.trim();
        if (!url) { fail(new Error('先填一个链接')); return; }
        b.disabled = true;
        fetchLevelText(url).then((text) => importWithChoice(text)).then((lv) => { root.querySelector('#lv-import')?.close(); openLevel(lv.id); })
          .catch((err) => fail(err)).finally(() => { b.disabled = false; });
      }
    } catch (err) { fail(err); }
  };
  root.onchange = async (e) => { if (e.target.id !== 'lv-file' || !e.target.files[0]) return; try { openLevel((await importWithChoice(await e.target.files[0].text())).id); } catch (err) { fail(err); } };
}
function renderEditor() {
  setTerminalState('editor', () => {
    finishEdits();
    if (dirty && !confirm('有未保存的改动，仍要返回列表吗？')) return;
    disposeEditor(); current = null; dirty = false; error = ''; renderList();
  }, () => {
    finishEdits();
    if (dirty && !confirm('有未保存的改动，仍要离开编辑器吗？')) return false;
    leaving = true; return true;
  });
  root.className = 'lv-workspace lv-workspace--editor';
  sidePage = 'tool';
  root.innerHTML = `<header class="lv-head"><h1>关卡制作器</h1><span class="lv-sub">${esc(current.name)}.json</span><span class="lv-spacer"></span></header>
    <div class="lv-toolbar"><button class="lv-btn lv-btn--pri" data-act="save">保存</button><button class="lv-btn" data-act="save-as">另存为</button><button class="lv-btn" data-act="export">导出</button><button class="lv-btn" data-act="play">试玩</button><button class="lv-btn" data-act="undo">撤销</button><button class="lv-btn" data-act="redo">重做</button><span id="lv-dirty" class="lv-dirty"></span><button class="lv-btn lv-enemy-button" data-open-panel="lv-enemy-dialog">选择敌人 ▾</button><span class="lv-spacer"></span><button class="lv-btn" data-mode="terrain">地形</button><button class="lv-btn" data-mode="route">路线</button><button class="lv-btn" data-mode="spawn">出生</button></div>
    <button id="lv-error" class="lv-err lv-editor-error" data-open-panel="lv-error-dialog" hidden></button>
    <div class="lv-stage"><div class="lv-canvas-wrap"><div id="lv-map-host"></div></div><aside class="lv-side"><nav class="lv-side-tabs"><button class="lv-btn" data-side-page="tool">当前工具</button><button class="lv-btn" data-side-page="info">关卡信息</button></nav>
      <section id="lv-info"><h2>关卡信息</h2><div class="lv-field"><label>关卡名</label><input data-level-field="name" maxlength="40" value="${esc(current.name)}" title="关卡名就是磁盘上的文件名，保存时一并重命名"></div><p class="lv-hint" id="lv-name-hint">关卡名同时是文件名（${esc(current.name)}.json），保存时一并重命名。</p><p class="lv-hint">关卡 id：<code id="lv-id-hint">${esc(current.id)}</code>（创建时固定，不随改名改变）</p><div class="lv-field"><label>难度星级</label><input data-level-field="difficulty" type="number" min="0" max="${MAX_DIFFICULTY}" step="1" value="${current.meta.difficulty}"></div><div class="lv-field"><label>部署上限</label><input data-level-field="deployLimit" type="number" min="1" max="13" step="1" value="${current.meta.deployLimit ?? DEFAULT_DEPLOY_LIMIT}"></div><div class="lv-field"><label>目标生命上限</label><input data-level-field="lifeLimit" type="number" min="1" max="999" step="1" value="${current.meta.lifeLimit ?? DEFAULT_LIFE_LIMIT}"></div><div class="lv-field"><label>标签</label><input data-level-field="tags" value="${esc(current.meta.tags.join('，'))}" placeholder="用逗号分隔"></div><div class="lv-field"><label>作者</label><input data-level-field="author" maxlength="40" value="${esc(current.meta.author || '')}" placeholder="署名，会写进关卡 JSON"></div><div class="lv-field"><label>作战音乐</label><select data-level-field="bgm">${musicOptions(current.meta.bgm)}</select></div><button class="lv-btn" data-open-panel="lv-note-dialog">编辑备注</button><p class="lv-note-preview">${esc(notePreview(current.meta.note))}</p></section>

      <section id="lv-terrain"></section><section id="lv-routes"></section><section id="lv-spawns"></section></aside></div><div class="lv-timeline" id="lv-timeline"></div>      <dialog id="lv-enemy-dialog" class="lv-dialog"><header><h2>敌人库</h2><button class="lv-btn" data-close-panel>完成选择</button></header><div class="lv-dialog-body"><input id="lv-enemy-search" placeholder="搜索敌人名称 / 编号" value="${esc(search)}"><div class="lv-row"><select id="lv-enemy-rank"><option value="">全部等级</option><option value="NORMAL">普通</option><option value="ELITE">精英</option><option value="BOSS">首领</option></select><label><input id="lv-enemy-fly" type="checkbox"${flyOnly ? ' checked' : ''}>飞行</label><label><input id="lv-enemy-ranged" type="checkbox"${rangedOnly ? ' checked' : ''}>远程</label></div><label class="lv-hint"><input id="lv-enemy-stats" type="checkbox"${showStats ? ' checked' : ''}>显示未验证（特性未实现）</label><div class="lv-field"><select id="lv-enemy-pick"></select></div><p id="lv-enemy-note" class="lv-hint"></p></div></dialog><dialog id="lv-note-dialog" class="lv-dialog"><header><h2>关卡备注</h2><button class="lv-btn" data-close-panel>完成</button></header><div class="lv-dialog-body"><textarea data-level-field="note" maxlength="400" rows="8">${esc(current.meta.note)}</textarea></div></dialog><dialog id="lv-saveas-dialog" class="lv-dialog"><header><h2>另存为</h2><button class="lv-btn" data-close-panel>取消</button></header><div class="lv-dialog-body"><div class="lv-field"><label>新关卡名</label><input id="lv-saveas-name" maxlength="40" value="${esc(current.name)} 副本"></div><p class="lv-hint">会以这个名字新建一份关卡文件，原关卡一个字不动；新关卡拿到一个新的 id。</p><p class="lv-hint" id="lv-saveas-status"></p><div class="lv-row"><button class="lv-btn lv-btn--pri" data-act="saveas-confirm">另存为</button></div></div></dialog><dialog id="lv-error-dialog" class="lv-dialog"><header><h2>关卡问题</h2><button class="lv-btn" data-close-panel>关闭</button></header><pre class="lv-dialog-body" id="lv-error-details"></pre></dialog>`;
  timeline = new LevelTimeline(root.querySelector('#lv-timeline'), { enemies: ENEMY_LIBRARY.official, names, speeds: () => speedOf, duration: () => duration,
    change, onError: fail, onBeforeChange: begin, onChange: () => { if (!timeline.drag) commit(); refresh(); },
    onSelect: () => { renderSpawn(); tracer?.highlight(timeline.selected); }, onCursor: (t) => { cursor = t; tracer?.showAt(t); }, onPlace: placeAtTime });
  timeline.setLevel(current);
  terrain = new LevelTerrainEditor(root.querySelector('#lv-map-host'), root.querySelector('#lv-terrain'), {
    level: () => current, begin, commit, change, refresh, preview: previewChange, fail,
    activate: () => setMode('terrain'),
    onTile: (pos) => { try { if (mode === 'route') routes.tile(pos); else if (mode === 'spawn') addSpawns({ pos }); } catch (e) { fail(e); } },
    validateStage: (stage) => validateLevel({ ...current, stage, spawns: [] }, ctx()),
    importStage: (stage) => { validateLevel({ ...current, stage }, ctx()); change(() => { current.stage = stage; routes.reset(); }); },
  });
  routes = new LevelRoutesEditor(root.querySelector('#lv-routes'), terrain.overlay, { level: () => current, change, refresh, fail,
    activate: () => setMode('route'), visible: () => mode === 'route', enemyOptions, cursor: () => cursor, addSpawns,
    created: (id) => { if (drawingSpawnId) { const s = current.spawns.find((s) => s.id === drawingSpawnId); if (s) { s.route = id; delete s.pos; } drawingSpawnId = null; } },
  });
  tracer = new LevelTracer(terrain.overlay, { level: () => current, speeds: () => speedOf, names: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.short])), onSelect: (s) => { timeline.select(s); timeline.render(); setMode('spawn'); }, onCounts: (c) => timeline.setCounts(c) });
  renderEnemyPick(); root.querySelector('#lv-enemy-rank').value = rank; applyMode(); refresh();
  root.onclick = (e) => {
    if (e.target.closest('[data-close-panel]')) { closePanel(e.target); return; }
    const opener = e.target.closest('[data-open-panel]');
    if (opener) { root.querySelector(`#${opener.dataset.openPanel}`).showModal(); return; }
    const tab = e.target.closest('[data-side-page]');
    if (tab) { finishEdits(); sidePage = tab.dataset.sidePage; applyMode(); return; }
    const b = e.target.closest('[data-act],[data-mode]'); if (!b) return;
    try {
      if (b.dataset.mode) { drawingSpawnId = null; setMode(b.dataset.mode); return; }
      if (b.dataset.act === 'back') { finishEdits(); if (dirty && !confirm('有未保存的改动，仍要返回列表吗？')) return; disposeEditor(); current = null; dirty = false; error = ''; renderList(); }
      else if (b.dataset.act === 'save') save().catch(fail);
      else if (b.dataset.act === 'save-as') { const dlg = root.querySelector('#lv-saveas-dialog'); dlg.querySelector('#lv-saveas-name').value = `${current.name} 副本`; dlg.querySelector('#lv-saveas-status').textContent = ''; dlg.showModal(); }
      else if (b.dataset.act === 'saveas-confirm') {
        const status = root.querySelector('#lv-saveas-status');
        const name = root.querySelector('#lv-saveas-name').value.trim();
        b.disabled = true;
        saveAs(name).then(() => { root.querySelector('#lv-saveas-dialog')?.close(); })
          .catch((err) => { status.textContent = err instanceof LevelError ? `${err.path}：${err.reason}` : err.message; })
          .finally(() => { b.disabled = false; });
      }
      else if (b.dataset.act === 'play') { save().then(() => window.open(`/studio/play.html?level=${encodeURIComponent(current.id)}`, '_blank', 'noopener')).catch(fail); }
      else if (b.dataset.act === 'export') { requireReady(); download(current.name, exportLevel(current)); }
      else if (b.dataset.act === 'undo') undo(); else if (b.dataset.act === 'redo') undo(true);
      else if (b.dataset.act === 'spawn-delete') change(() => timeline.remove());
    } catch (err) { fail(err); }
  };
  root.oninput = (e) => {
    if (e.target.id !== 'lv-enemy-search') return; search = e.target.value; renderEnemyPick();
  };
  root.onchange = (e) => {
    const el = e.target;
    try {
      if (el.id === 'lv-enemy-rank') rank = el.value;
      else if (el.id === 'lv-enemy-fly') flyOnly = el.checked;
      else if (el.id === 'lv-enemy-ranged') rangedOnly = el.checked;
      else if (el.id === 'lv-enemy-stats') showStats = el.checked;
      else if (el.id === 'lv-enemy-pick') { draftEnemy = el.value; renderEnemyPick(); return; }
      else if (el.dataset.levelField) {
        const f = el.dataset.levelField; change(() => { if (f === 'name') { const v = el.value.trim(); const problem = levelNameProblem(v); if (problem) throw new LevelError('level.name', problem); if (nameTaken(v, current.id)) throw new LevelError('level.name', `已经有叫「${v}」的关卡了`); current.name = v; } else if (['difficulty', 'deployLimit', 'lifeLimit'].includes(f)) { const v = el.valueAsNumber, min = f === 'difficulty' ? 0 : 1, max = f === 'difficulty' ? MAX_DIFFICULTY : f === 'deployLimit' ? 13 : 999; if (!Number.isInteger(v) || v < min || v > max) throw new Error(`此项须为 ${min}–${max} 的整数`); current.meta[f] = v; } else if (f === 'tags') current.meta.tags = el.value.split(/[,，]/).map((v) => v.trim()).filter(Boolean); else if (f === 'bgm') { if (el.value) current.meta.bgm = el.value; else delete current.meta.bgm; } else if (f === 'author') { const v = el.value.trim().slice(0, 40); if (v) current.meta.author = v; else delete current.meta.author; } else current.meta.note = el.value; }); const note = root.querySelector('.lv-note-preview'); if (note) note.textContent = notePreview(current.meta.note); return;
      } else if (el.dataset.spawnField && timeline.selected) {
        const s = timeline.selected, f = el.dataset.spawnField;
        if (f === 'route' && el.value === '__new') { drawingSpawnId = s.id; setMode('route'); routes.startNew(); return; }
        change(() => {
          if (f === 'enemy' || f === 'note') s[f] = el.value;
          else if (f === 'at') { if (!Number.isFinite(el.valueAsNumber) || el.valueAsNumber < 0 || el.valueAsNumber > 3600) throw new Error('时间须在 0–3600 秒之间'); s.at = el.valueAsNumber; }
          else if (f === 'route' && el.value !== '__private') { const previous = routeOf(current, s); s.route = el.value || null; if (!s.route) s.pos = previous?.start.slice() || s.pos || [current.stage.rect.r0, current.stage.rect.c0]; else delete s.pos; }
          else if (f === 'row' || f === 'col') { const max = f === 'row' ? ROWS - 1 : COLS - 1; if (!Number.isInteger(el.valueAsNumber) || el.valueAsNumber < 0 || el.valueAsNumber > max) throw new Error(`坐标须为 0–${max} 之间的整数`); s.pos[f === 'row' ? 0 : 1] = el.valueAsNumber; }
        }); return;
      } else return;
      renderEnemyPick(); routes.render(); renderSpawn();
    } catch (err) { fail(err); }
  };
}
window.addEventListener('beforeunload', (e) => { if (!leaving && current && (dirty || transaction && fingerprint(transaction) !== fingerprint())) { e.preventDefault(); e.returnValue = ''; } });
root.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]'); if (!link || !current || link.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey) return;
  finishEdits(); if (dirty && !confirm('有未保存的改动，仍要离开吗？')) e.preventDefault(); else leaving = true;
}, true);
window.addEventListener('keydown', (e) => {
  if (!current || root.querySelector('dialog[open]')) return;
  const typing = e.target.closest('input,select,textarea,[contenteditable="true"]');
  if (e.key === 'Escape') { drawingSpawnId = null; terrain.exit(); routes.deactivate(); refresh(); }
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); change(() => timeline.shift((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : .1))); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && timeline.ids.size) { e.preventDefault(); change(() => timeline.remove()); }
    else if (e.code === 'Space') { e.preventDefault(); timeline.playing = !timeline.playing; timeline.updatePlayback(); }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(e.shiftKey); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && timeline) { timeline.playing = false; timeline.updatePlayback(); } });
let lastFrame = null;
function frame(now) { const dt = lastFrame == null ? 0 : Math.min(.1, (now - lastFrame) / 1000); lastFrame = now; timeline?.advance(dt); requestAnimationFrame(frame); }
async function boot() {
  try {
    await data.loadAll('enemies');
    const enemies = data.getRaw('enemies');
    if (!enemies) throw new Error('敌人与干员数据未加载');
    speedOf = Object.fromEntries(Object.entries(enemies).map(([key, e]) => [key, e.stats?.moveSpeed ?? 1]));
    // 关卡库来自服务端目录（content/levels/），先拉一次再渲染列表
    await loadLevels(ctx());
    if (lastLevelsError()) error = lastLevelsError();
    const requested = new URLSearchParams(location.search).get('level');
    if (requested && listLevels().some((level) => level.id === requested)) openLevel(requested);
    else { if (requested) error = '找不到这张关卡，请从关卡列表重新选择或导入'; renderList(); }
    requestAnimationFrame(frame);
    void loadMusic();   // 曲目清单先拉一次，关卡信息里的「作战音乐」下拉就有内容
  } catch (e) { root.innerHTML = `<div class="lv-err">${esc(e.message)}</div>`; }
  finally { terminalReady(); }
}
const layout = createWorkspaceLayout(root, () => { if (current) timeline?.resize(); else if (root.classList.contains('lv-workspace--library') && !root.querySelector('dialog[open]')) renderList(); });
root.addEventListener('close', () => { if (!current) layout.resize(); }, true);
boot();
