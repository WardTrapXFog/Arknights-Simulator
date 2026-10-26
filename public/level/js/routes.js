import { Grid } from '/sim/grid.js';
import { MAX_ROUTE_POINTS } from "../../../shared/level.js";
import { ROWS } from '../../sandbox/js/battlefield.js';

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
const coord = (p) => p ? `(${p[0]},${p[1]})` : '停在末点';
const copy = (v) => JSON.parse(JSON.stringify(v));

export function routeReferences(level, index) {
  const id = typeof index === 'string' ? index : level.stage.routes[index]?.id;
  return level.spawns.filter((s) => s.route === id).length;
}

export function routePoints(route) {
  const points = [{ pos: route.start, cp: -1, terminal: false }];
  route.checkpoints.forEach((cp, i) => { if (cp.type === 'MOVE') points.push({ pos: cp.pos, cp: i, terminal: false }); });
  if (route.end) {
    const last = points[points.length - 1];
    if (same(last.pos, route.end)) last.terminal = true;
    else points.push({ pos: route.end, cp: null, terminal: true });
  }
  return points;
}

/** Same ground query as sandbox/controller.js paintRoute / firstBlockedSegment. */
export function previewRoute(stage, route, grid = new Grid(stage, stage.rect)) {
  const points = routePoints(route), segments = [], problems = [];
  const pass = (p) => Array.isArray(p) && (route.motion === 'FLY' ? grid.flyPassable(...p) : grid.groundPassable(...p));
  if (!pass(route.start)) problems.push('起点不在当前范围内的可通行格');
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].pos, b = points[i].pos;
    const path = pass(a) && pass(b) ? route.motion === 'FLY' ? [a, b]
      : grid.waypoints(...a, ...b) || grid.waypoints(...a, ...b, { ignoreObstacles: true }) : null;
    segments.push({ from: a, to: b, path, ok: !!path });
    if (!path) problems.push(`第 ${i} 段 ${coord(a)} → ${coord(b)} 无法到达`);
  }
  return { points, segments, problems, ok: problems.length === 0 };
}

export class LevelRoutesEditor {
  constructor(host, overlay, api) {
    this.host = host; this.overlay = overlay; this.api = api;
    this.names = []; this.selected = -1; this.point = -1; this.pending = false; this.editing = false;
    this.gridKey = ''; this.grid = null;
    host.onclick = (e) => this.clickControl(e);
    host.onchange = (e) => this.changeControl(e);
    this.render();
  }

  get level() { return this.api.level(); }
  get route() { return this.level.stage.routes[this.selected] || null; }
  label(i) { return this.level.stage.routes[i]?.name || `路线 ${i + 1}`; }
  summary(i) {
    const route = this.level.stage.routes[i];
    return `${i} · ${this.label(i)} · ${coord(route.start)} → ${coord(route.end)}`;
  }

  getGrid() {
    const stage = this.level.stage, key = stage.rows.join('') + JSON.stringify(stage.rect);
    if (key !== this.gridKey) { this.gridKey = key; this.grid = new Grid(stage, stage.rect); }
    return this.grid;
  }

  previews() { return this.level.stage.routes.map((r) => previewRoute(this.level.stage, r, this.getGrid())); }
  problems() { return this.previews().flatMap((p, i) => p.problems.map((s) => `路线 ${i}：${s}`)); }

  select(i) {
    this.api.activate(); this.selected = i; this.point = -1;
    this.pending = false; this.editing = true; this.api.refresh();
  }

  deactivate() { this.pending = false; this.editing = false; this.point = -1; this.render(); }

  reset(names = []) {
    this.names = names.slice(); this.pending = false; this.editing = false; this.point = -1;
    if (this.selected >= this.level.stage.routes.length) this.selected = -1;
    this.gridKey = '';
  }

  appendEnd(route) {
    if (route.end && !same(routePoints(route).filter((p) => p.cp !== null).at(-1)?.pos, route.end)) {
      route.checkpoints.push({ type: 'MOVE', pos: route.end.slice(), time: 0 });
    }
    route.end = null;
  }

  mutate(fn) {
    if (!this.route) return;
    const candidate = copy(this.route);
    fn(candidate);
    if (candidate.checkpoints.length > MAX_ROUTE_POINTS) throw new Error(`每条路线最多 ${MAX_ROUTE_POINTS} 个检查点（含停留）`);
    this.api.change(() => { this.level.stage.routes[this.selected] = candidate; });
  }

  tile(pos) {
    if (!this.editing) return;
    try {
      if (this.pending) {
        const motion = this.host.querySelector('[data-route-motion]')?.value || 'WALK';
        const g = this.getGrid();
        if (!(motion === 'FLY' ? g.flyPassable(...pos) : g.groundPassable(...pos))) throw new Error('起点必须在当前范围内的可通行格');
        this.api.change(() => {
          this.level.stage.routes.push({ id: `r_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`, name: `路线 ${this.level.stage.routes.length + 1}`, motion, start: pos.slice(), end: null, checkpoints: [] });
          this.selected = this.level.stage.routes.length - 1; this.pending = false; this.point = 0;
          this.names[this.selected] = '';
          this.api.created?.(this.route.id);
        });
        return;
      }
      const route = this.route;
      if (!route) return;
      const existing = routePoints(route).findIndex((p) => same(p.pos, pos));
      if (existing >= 0) { this.point = existing; this.render(); return; }
      const gate = this.level.stage.rows[pos[0]][pos[1]] === 'E';
      this.mutate((next) => {
        this.appendEnd(next);
        if (gate) next.end = pos.slice();
        else next.checkpoints.push({ type: 'MOVE', pos: pos.slice(), time: 0 });
      });
      this.point = routePoints(this.route).length - 1;
      if (gate && previewRoute(this.level.stage, this.route, this.getGrid()).ok) this.editing = false;
      this.api.refresh();
    } catch (e) { this.api.fail(e); }
  }

  waitSeconds(route, point) {
    if (point.cp === null) return 0;
    let total = 0;
    for (let i = point.cp + 1; i < route.checkpoints.length; i++) {
      const cp = route.checkpoints[i];
      if (cp.type !== 'WAIT' || !same(cp.pos, point.pos)) break;
      total += cp.time;
    }
    return total;
  }

  setWait(seconds) {
    const point = routePoints(this.route)[this.point];
    if (!point) return;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 99999) throw new Error('停留时间须在 0–99999 秒之间');
    this.mutate((route) => {
      let cp = point.cp;
      if (cp === null) {
        route.checkpoints.push({ type: 'MOVE', pos: point.pos.slice(), time: 0 });
        cp = route.checkpoints.length - 1;
      }
      while (route.checkpoints[cp + 1]?.type === 'WAIT' && same(route.checkpoints[cp + 1].pos, point.pos)) route.checkpoints.splice(cp + 1, 1);
      if (seconds > 0) route.checkpoints.splice(cp + 1, 0, { type: 'WAIT', pos: point.pos.slice(), time: seconds });
    });
  }

  removePoint() {
    const points = routePoints(this.route), p = points[this.point];
    if (!p) return;
    this.mutate((route) => {
      if (p.cp === -1) {
        const next = points[1];
        if (!next) throw new Error('只剩起点，请使用删除路线');
        route.start = next.pos.slice();
        if (next.cp === null) { route.checkpoints = []; route.end = null; }
        else route.checkpoints.splice(0, next.cp + 1);
      } else if (p.cp === null) route.end = null;
      else {
        let count = 1;
        while (route.checkpoints[p.cp + count]?.type === 'WAIT' && same(route.checkpoints[p.cp + count].pos, p.pos)) count++;
        route.checkpoints.splice(p.cp, count);
        if (p.terminal) route.end = null;
      }
    });
    this.point = -1; this.api.refresh();
  }

  setEnd() {
    const point = routePoints(this.route)[this.point];
    if (!point) return;
    const next = copy(this.route);
    if (point.cp === -1) next.checkpoints = [];
    else if (point.cp !== null) {
      let end = point.cp + 1;
      while (next.checkpoints[end]?.type === 'WAIT' && same(next.checkpoints[end].pos, point.pos)) end++;
      next.checkpoints = next.checkpoints.slice(0, end);
    }
    next.end = point.pos.slice();
    const check = previewRoute(this.level.stage, next, this.getGrid());
    if (!check.ok) throw new Error(check.problems.join('；'));
    this.api.change(() => { this.level.stage.routes[this.selected] = next; });
    this.editing = false; this.api.refresh();
  }

  removeRoute() {
    if (!this.route) return;
    const count = routeReferences(this.level, this.selected), id = this.route.id;
    if (count && !confirm(`有 ${count} 只敌人在用这条线。确定一起删掉？`)) return;
    this.api.change(() => {
      this.level.spawns = this.level.spawns.filter((s) => s.route !== id);
      this.level.stage.routes.splice(this.selected, 1);
      this.selected = -1; this.point = -1; this.editing = false;
    });
  }

  startNew() {
    this.api.activate(); this.pending = true; this.editing = true; this.selected = -1; this.point = -1; this.render();
  }

  clickControl(e) {
    const selected = e.target.closest('[data-route-index]');
    if (selected) { this.select(Number(selected.dataset.routeIndex)); return; }
    const point = e.target.closest('[data-route-point]');
    if (point) { this.point = Number(point.dataset.routePoint); this.render(); return; }
    const act = e.target.closest('[data-route-act]')?.dataset.routeAct;
    if (!act) return;
    try {
      if (act === 'new') {
        
        this.startNew();
      } else if (act === 'delete') this.removeRoute();
      else if (act === 'place') {
        const value = (name) => this.host.querySelector(`[data-place-${name}]`).value;
        this.api.addSpawns({ at: Number(value('at')), interval: Number(value('interval')), count: Number(value('count')), enemy: value('enemy'), route: this.route.id });
      }
      else if (act === 'wait') this.setWait(Number(this.host.querySelector('[data-route-wait]').value));
      else if (act === 'point-delete') this.removePoint();
      else if (act === 'end') this.setEnd();
      else if (act === 'done') {
        const check = previewRoute(this.level.stage, this.route, this.getGrid());
        if (!check.ok) throw new Error(check.problems.join('；'));
        this.editing = false; this.api.refresh();
      } else if (act === 'edit') { this.api.activate(); this.editing = true; this.render(); }
    } catch (error) { this.api.fail(error); }
  }

  changeControl(e) {
    try {
      if (e.target.matches('[data-route-choice]') && e.target.value !== '') { this.select(Number(e.target.value)); return; }
      if (e.target.matches('[data-route-point-select]')) { this.point = Number(e.target.value); this.render(); return; }
      if (e.target.matches('[data-route-name]')) this.api.change(() => { this.route.name = e.target.value.trim().slice(0, 16); });
      if (e.target.matches('[data-route-motion]') && this.route) this.mutate((r) => { r.motion = e.target.value; });
    } catch (error) { this.api.fail(error); }
  }

  render() {
    const route = this.route, previews = this.previews(), preview = previews[this.selected];
    const points = route ? routePoints(route) : [], point = points[this.point];
    this.host.innerHTML = `<h2>路线 · ${this.level.stage.routes.length} 条</h2><div class="lv-field"><select data-route-choice aria-label="选择路线"><option value="" disabled${this.selected < 0 ? ' selected' : ''}>选择路线…</option>${this.level.stage.routes.map((r, i) => `<option value="${i}"${i === this.selected ? ' selected' : ''}>${esc(this.label(i))} · ${routeReferences(this.level, i)} 只在用${previews[i].ok ? '' : ' · 路径不通'}</option>`).join('')}</select></div>
      <button class="lv-btn" data-route-act="new">新建路线</button>
      ${this.pending ? `<div class="lv-field"><label>行进</label><select data-route-motion><option value="WALK"${route?.motion !== 'FLY' ? ' selected' : ''}>地面 WALK</option><option value="FLY"${route?.motion === 'FLY' ? ' selected' : ''}>飞行 FLY</option></select></div>` : ''}
      ${this.pending ? '<p class="lv-hint">在画布上点一个可通行格作为起点。</p>' : ''}
      ${route ? `<div class="lv-field"><label>名称</label><input data-route-name maxlength="16" value="${esc(route.name)}" aria-label="路线名称"><select data-route-motion aria-label="行进方式"><option value="WALK"${route.motion !== 'FLY' ? ' selected' : ''}>地面</option><option value="FLY"${route.motion === 'FLY' ? ' selected' : ''}>飞行</option></select></div>
      <p class="lv-hint">修改这条路线会影响所有引用它的敌人。</p>
      <div class="lv-row"><button class="lv-btn" data-route-act="edit">画布编辑</button><button class="lv-btn lv-btn--red" data-route-act="delete">删除路线</button></div>
      <div class="lv-route-node-controls"${this.editing ? '' : ' hidden'}><div class="lv-field"><label>节点</label><select data-route-point-select><option value="-1"${this.point < 0 ? ' selected' : ''}>选择节点…</option>${points.map((p, i) => `<option value="${i}"${i === this.point ? ' selected' : ''}>${i === 0 ? '起点' : `点 ${i}`}${p.terminal ? ' / 终点' : ''} ${coord(p.pos)}${this.waitSeconds(route, p) ? ` · 停 ${this.waitSeconds(route, p)} 秒` : ''}</option>`).join('')}</select></div>
      ${point ? `<div class="lv-field"><label>停留秒数</label><input data-route-wait type="number" min="0" max="99999" step="0.1" value="${this.waitSeconds(route, point)}"><button class="lv-btn" data-route-act="wait">应用</button></div>
      <div class="lv-row"><button class="lv-btn" data-route-act="end">设为终点</button><button class="lv-btn" data-route-act="point-delete">删除此点</button></div>` : ''}
      <div class="lv-row"><button class="lv-btn lv-btn--pri" data-route-act="done"${preview.ok ? '' : ' disabled'}>完成并停在末点</button></div></div>
      ${preview.problems.length ? `<div class="lv-err">${esc(preview.problems[0])}${preview.problems.length > 1 ? `（共 ${preview.problems.length} 处，保存时列出全部）` : ''}</div>` : ''}` : ''}
      ${route && !this.editing ? `<div class="lv-route-place"><b>在这条线上放敌人</b>
        <div class="lv-field"><label>第几秒</label><input data-place-at type="number" value="${this.api.cursor?.() ?? 0}" min="0" max="3600" step="0.1"></div>
        <div class="lv-field"><label>每隔</label><input data-place-interval type="number" value="2" min="0" max="3600" step="0.1"><span>秒</span><input data-place-count type="number" value="6" min="1" max="8000"><span>只</span></div>
        <div class="lv-field"><select data-place-enemy>${this.api.enemyOptions?.() || ''}</select><button class="lv-btn lv-btn--pri" data-route-act="place">放</button></div></div>` : ''}
      <p class="lv-hint">${this.editing ? '点格子追加 MOVE，点已有点编辑；点蓝门设置出口。' : '选中路线后可在画布继续编辑。'}</p>`;
    this.draw(preview);
  }

  draw(preview) {
    const point = ([r, c]) => `${c + 0.5},${ROWS - r - 0.5}`;
    this.layer ||= this.overlay.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
    this.layer.setAttribute('class', 'lv-routes-layer');
    if (!this.api.visible?.()) { this.layer.innerHTML = ''; return; }
    this.layer.innerHTML = this.previews().map((pr, index) => pr.segments.map((s) =>
      `<polyline class="lv-route-line${s.ok ? '' : ' is-blocked'}${index === this.selected ? '' : ' is-muted'}" points="${(s.path || [s.from, s.to]).map(point).join(' ')}"/>`).join('')).join('')
      + (preview ? preview.points.map((p, i) => `<g class="lv-route-dot${i === this.point ? ' is-on' : ''}"><circle cx="${p.pos[1] + 0.5}" cy="${ROWS - p.pos[0] - 0.5}" r=".23"/><text x="${p.pos[1] + 0.5}" y="${ROWS - p.pos[0] - 0.5}">${i}</text></g>`).join('') : '');
  }

  destroy() { this.host.onclick = null; this.host.onchange = null; this.layer?.remove(); }
}
