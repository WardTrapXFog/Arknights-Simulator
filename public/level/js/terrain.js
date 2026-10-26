import { TERRAIN, paintTile, ROWS, COLS } from '../../sandbox/js/battlefield.js';
import { newLevel } from "../../../shared/level.js";

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, hi) => Math.max(0, Math.min(hi, Math.round(v)));

/** Level rects permit one tile; sandbox normRect deliberately requires at least 2×2. */
export function levelRect(rect) {
  const r0 = clamp(Number(rect.r0), ROWS - 1), r1 = clamp(Number(rect.r1), ROWS - 1);
  const c0 = clamp(Number(rect.c0), COLS - 1), c1 = clamp(Number(rect.c1), COLS - 1);
  return { r0: Math.min(r0, r1), r1: Math.max(r0, r1), c0: Math.min(c0, c1), c1: Math.max(c0, c1) };
}

/** Parse before assignment. Runtime stage validation is supplied by the editor. */
export function parseStageImport(text, validateStage, routes = []) {
  const input = JSON.parse(text);
  const value = input?.stage || input;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('地图 JSON 必须是对象');
  if (!Array.isArray(value.rows) || value.rows.length !== ROWS
    || value.rows.some((r) => typeof r !== 'string' || r.length !== COLS || /[^rfhX#SE]/.test(r))) {
    throw new Error(`地图必须是 ${ROWS} 行、每行 ${COLS} 个地形字符（r f h X # S E）`);
  }
  const R = value.rect;
  if (!R || Object.keys(R).length !== 4 || !['r0', 'r1', 'c0', 'c1'].every((k) => Number.isInteger(R[k]))
    || R.r0 < 0 || R.r1 >= ROWS || R.c0 < 0 || R.c1 >= COLS || R.r0 > R.r1 || R.c0 > R.c1) {
    throw new Error('部署区必须是整数矩形，不能越界或倒置');
  }
  const stage = { rows: value.rows.slice(), rect: { ...R }, routes: structuredClone(routes) };
  validateStage(stage);
  for (const route of stage.routes) for (const cp of route.checkpoints) {
    if (cp.type === 'MOVE' && cp.time !== 0) throw new Error('MOVE 检查点的 time 必须为 0');
    if (cp.type === 'WAIT' && (typeof cp.time !== 'number' || !Number.isFinite(cp.time))) throw new Error('WAIT 检查点必须填写停留秒数');
  }
  return stage;
}

/** Owns map pointer gestures; all writes pass through the main editor's shared history. */
export class LevelTerrainEditor {
  constructor(host, controls, api) {
    this.host = host; this.controls = controls; this.api = api;
    this.brush = null; this.rectEditing = false; this.drag = null;
    this.cells = [];
    const tiles = [];
    for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) {
      tiles.push(`<button type="button" class="lv-tile" data-r="${r}" data-c="${c}"></button>`);
    }
    host.innerHTML = `<div class="lv-map" role="group" aria-label="地形与路线画布">
      <div class="lv-map-grid">${tiles.join('')}</div>
      <svg class="lv-route-overlay" viewBox="0 0 ${COLS} ${ROWS}" aria-hidden="true"></svg>
      <div class="lv-rect-outline">${['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((h) =>
        `<button type="button" class="lv-rect-handle lv-rect-handle--${h}" data-handle="${h}" aria-label="拖动部署区 ${h}"></button>`).join('')}</div>
    </div>`;
    this.map = host.querySelector('.lv-map');
    this.outline = host.querySelector('.lv-rect-outline');
    this.overlay = host.querySelector('.lv-route-overlay');
    this.cells = [...host.querySelectorAll('.lv-tile')];
    this.down = (e) => this.pointerDown(e);
    this.move = (e) => this.pointerMove(e);
    this.up = (e) => this.pointerUp(e);
    this.map.addEventListener('pointerdown', this.down);
    this.map.addEventListener('pointermove', this.move);
    this.map.addEventListener('pointerup', this.up);
    this.map.addEventListener('pointercancel', this.up);
    controls.onclick = (e) => this.controlClick(e);
    controls.oninput = (e) => this.rectInput(e);
    controls.onchange = (e) => {
      const key = e.target.dataset.rect;
      if (key) { e.target.value = this.api.level().stage.rect[key]; this.api.commit(); this.api.refresh(); }
    };
    this.renderControls();
    this.renderMap();
  }

  renderControls() {
    const R = this.api.level().stage.rect;
    this.controls.innerHTML = `<h2>地形</h2><div class="lv-brushes">${TERRAIN.map((t) =>
      `<button type="button" class="lv-brush ${t.cls}${this.brush === t.g ? ' is-on' : ''}" data-brush="${esc(t.g)}" title="${esc(t.hint)}" aria-pressed="${this.brush === t.g}">${t.ico}<span>${t.label}</span></button>`).join('')}</div>
      <div class="lv-row"><button class="lv-btn${this.rectEditing ? ' is-on' : ''}" data-terrain="rect">调整部署区</button>
      <button class="lv-btn" data-terrain="pave">重铺部署区</button></div>
      <div class="lv-rect-fields">${['r0', 'r1', 'c0', 'c1'].map((k) => `<label>${k}<input type="number" data-rect="${k}" min="0" max="${k[0] === 'r' ? ROWS - 1 : COLS - 1}" step="1" value="${R[k]}"></label>`).join('')}</div>
      <div class="lv-row"><button class="lv-btn" data-terrain="import">从沙盒导入</button>
      <button class="lv-btn lv-btn--red" data-terrain="reset">重置为空白</button></div>
      <dialog class="lv-dialog lv-terrain-import"><header><h2>导入地图</h2><button class="lv-btn" data-terrain="close-import">关闭</button></header><div class="lv-dialog-body lv-map-import"><label>沙盒地形 JSON（只读取地形与部署区）<textarea rows="6" spellcheck="false"></textarea></label>
      <div class="lv-row"><button class="lv-btn" data-terrain="apply-import">导入地图</button><button class="lv-btn" data-terrain="close-import">取消</button></div></div></dialog>
      <p class="lv-hint">按住拖动连续绘制，Esc 或再次点击笔刷退出。行 0 在最下方，列 0 在最左侧。</p>`;
  }

  exit() {
    this.finishGesture(); this.brush = null; this.rectEditing = false;
    this.renderControls(); this.renderMap();
  }

  renderMap() {
    const stage = this.api.level().stage, R = stage.rect;
    for (const cell of this.cells) {
      const r = Number(cell.dataset.r), c = Number(cell.dataset.c), glyph = stage.rows[r][c];
      const terrain = TERRAIN.find((t) => t.g === glyph);
      const outside = r < R.r0 || r > R.r1 || c < R.c0 || c > R.c1;
      cell.className = `lv-tile ${terrain.cls}${outside ? ' is-outside' : ''}`;
      cell.textContent = terrain.ico;
      cell.title = `行 ${r} · 列 ${c} · ${terrain.label}`;
      cell.setAttribute('aria-label', cell.title);
    }
    Object.assign(this.outline.style, {
      left: `${R.c0 / COLS * 100}%`, top: `${(ROWS - 1 - R.r1) / ROWS * 100}%`,
      width: `${(R.c1 - R.c0 + 1) / COLS * 100}%`, height: `${(R.r1 - R.r0 + 1) / ROWS * 100}%`,
    });
    this.map.classList.toggle('is-painting', this.brush !== null);
    this.map.classList.toggle('is-rect-editing', this.rectEditing);
    for (const input of this.controls.querySelectorAll('[data-rect]')) {
      if (input !== document.activeElement) input.value = R[input.dataset.rect];
    }
  }

  position(e, bounded = false) {
    const b = this.map.getBoundingClientRect();
    const c = Math.floor((e.clientX - b.left) / b.width * COLS);
    const r = ROWS - 1 - Math.floor((e.clientY - b.top) / b.height * ROWS);
    if (!bounded && (r < 0 || r >= ROWS || c < 0 || c >= COLS)) return null;
    return [clamp(r, ROWS - 1), clamp(c, COLS - 1)];
  }

  pointerDown(e) {
    if (e.button !== 0 || this.drag) return;
    const handle = e.target.closest('[data-handle]')?.dataset.handle;
    const pos = this.position(e, !!handle);
    if (!pos) return;
    if (handle || this.brush !== null) {
      this.api.begin();
      this.drag = { id: e.pointerId, handle, last: pos, rect: { ...this.api.level().stage.rect } };
      this.map.setPointerCapture(e.pointerId);
      if (!handle) this.paint(pos);
      e.preventDefault();
    } else if (!this.rectEditing) this.api.onTile(pos);
  }

  paint(to) {
    let [r, c] = this.drag.last;
    const dr = Math.abs(to[0] - r), dc = Math.abs(to[1] - c);
    const sr = r < to[0] ? 1 : -1, sc = c < to[1] ? 1 : -1;
    let error = dc - dr, stage = this.api.level().stage;
    for (;;) {
      stage = paintTile(stage, r, c, this.brush);
      if (r === to[0] && c === to[1]) break;
      const twice = error * 2;
      if (twice > -dr) { error -= dr; c += sc; }
      if (twice < dc) { error += dc; r += sr; }
    }
    this.api.level().stage = stage;
    this.drag.last = to;
    this.api.preview();
  }

  pointerMove(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const pos = this.position(e, true), h = this.drag.handle;
    if (!h) { this.paint(pos); return; }
    const R = { ...this.drag.rect };
    if (h.includes('n')) R.r1 = Math.max(R.r0, pos[0]);
    if (h.includes('s')) R.r0 = Math.min(R.r1, pos[0]);
    if (h.includes('e')) R.c1 = Math.max(R.c0, pos[1]);
    if (h.includes('w')) R.c0 = Math.min(R.c1, pos[1]);
    this.api.level().stage = { ...this.api.level().stage, rect: levelRect(R) };
    this.api.preview();
  }

  pointerUp(e) { if (this.drag?.id === e.pointerId) this.finishGesture(); }

  finishGesture() {
    if (!this.drag) return;
    const id = this.drag.id; this.drag = null;
    if (this.map.hasPointerCapture(id)) this.map.releasePointerCapture(id);
    this.api.commit(); this.api.refresh();
  }

  rectInput(e) {
    const key = e.target.dataset.rect;
    if (!key || e.target.value === '' || !Number.isFinite(e.target.valueAsNumber)) return;
    this.api.begin();
    const R = { ...this.api.level().stage.rect, [key]: clamp(e.target.valueAsNumber, key[0] === 'r' ? ROWS - 1 : COLS - 1) };
    if (key === 'r0') R.r1 = Math.max(R.r0, R.r1);
    if (key === 'r1') R.r0 = Math.min(R.r0, R.r1);
    if (key === 'c0') R.c1 = Math.max(R.c0, R.c1);
    if (key === 'c1') R.c0 = Math.min(R.c0, R.c1);
    this.api.level().stage = { ...this.api.level().stage, rect: R };
    this.api.preview();
  }

  controlClick(e) {
    const brush = e.target.closest('[data-brush]');
    if (brush) {
      this.finishGesture(); this.api.activate();
      this.brush = this.brush === brush.dataset.brush ? null : brush.dataset.brush;
      this.rectEditing = false; this.renderControls(); this.renderMap(); return;
    }
    const action = e.target.closest('[data-terrain]')?.dataset.terrain;
    if (!action) return;
    try {
      if (action === 'rect') {
        this.finishGesture(); this.api.activate(); this.brush = null; this.rectEditing = !this.rectEditing;
        this.renderControls(); this.renderMap();
      } else if (action === 'pave') this.api.change(() => {
        let stage = this.api.level().stage;
        const R = stage.rect;
        for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) stage = paintTile(stage, r, c, 'r');
        this.api.level().stage = stage;
      });
      else if (action === 'reset' && confirm('恢复新关卡的默认地形与部署区？路线和波次会保留。')) this.api.change(() => {
        const blank = newLevel({ rows: ROWS, cols: COLS }).stage;
        this.api.level().stage = { ...this.api.level().stage, rows: blank.rows, rect: blank.rect };
      });
      else if (action === 'import') this.controls.querySelector('.lv-terrain-import').showModal();
      else if (action === 'close-import') this.controls.querySelector('.lv-terrain-import').close();
      else if (action === 'apply-import') {
        const stage = parseStageImport(this.controls.querySelector('textarea').value, this.api.validateStage, this.api.level().stage.routes);
        this.controls.querySelector('.lv-terrain-import').close();
        this.api.importStage(stage);
        this.renderControls();
      }
    } catch (error) { this.api.fail(error); }
  }

  destroy() {
    this.finishGesture();
    this.map.removeEventListener('pointerdown', this.down);
    this.map.removeEventListener('pointermove', this.move);
    this.map.removeEventListener('pointerup', this.up);
    this.map.removeEventListener('pointercancel', this.up);
    this.controls.onclick = null; this.controls.oninput = null; this.controls.onchange = null;
  }
}
