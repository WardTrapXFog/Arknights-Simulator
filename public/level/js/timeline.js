// 出生点时间轴：数据编辑、时间游标与框选；不运行战斗。
import { MAX_SPAWNS, cloneLevel } from '../../../shared/level.js';
import { newId, playableUntil } from './level-model.js';
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export class LevelTimeline {
  constructor(host, opts) {
    this.host = host; this.opts = opts; this.level = null; this.ids = new Set(); this.cursor = 0; this.pps = 14; this.fitted = false; this.fullView = true; this.viewStart = 0; this.viewSpan = 60; this.drag = null;
    this.draftKey = opts.enemies[0]?.key || ''; this.playing = false;
    this.down = (e) => this.pointerDown(e);
    this.move = (e) => this.pointerMove(e);
    this.up = (e) => this.pointerUp(e);
    this.wheel = (e) => {
      const viewport = this.host.querySelector('.lv-tl-scroll'); if (!e.target.closest('.lv-tl-scroll')) return;
      e.preventDefault();
      const box = viewport.getBoundingClientRect(), x = (e.clientX - box.left) / (box.width / viewport.clientWidth);
      const fraction = clamp((x - 12) / (this.width() - 24), 0, 1), anchor = this.viewStart + fraction * this.viewSpan;
      this.viewSpan = clamp(this.viewSpan * Math.exp(e.deltaY * .0015), Math.min(2, this.span()), this.span());
      this.fullView = this.viewSpan >= this.span();
      this.viewStart = clamp(anchor - fraction * this.viewSpan, 0, this.span() - this.viewSpan); this.render();
    };
    host.addEventListener('pointerdown', this.down); host.addEventListener('wheel', this.wheel, { passive: false });
    host.ondblclick = (e) => { if (e.target.closest('.lv-tl-lane') && !e.target.closest('[data-spawn-id]')) { this.fit(); this.render(); } };
    host.onchange = (e) => { if (e.target.matches('[data-tl-enemy]')) this.draftKey = e.target.value; };
    host.onclick = (e) => {
      const act = e.target.closest('[data-tl-act]')?.dataset.tlAct;
      try {
        if (act === 'play') { if (this.cursor >= this.span()) this.setCursor(0); this.playing = !this.playing; this.updatePlayback(); }
        if (act === 'place') this.opts.onPlace?.(this.cursor);
        if (act === 'fit') { this.fit(); this.render(); }
        if (act === 'prev' || act === 'next') { this.viewStart = clamp(this.viewStart + (act === 'prev' ? -1 : 1) * this.viewSpan * .8, 0, this.span() - this.viewSpan); this.render(); }
        if (act === 'duplicate') {
          const interval = Number(host.querySelector('[data-tl-interval]').value), count = Number(host.querySelector('[data-tl-count]').value);
          this.opts.change(() => this.duplicate(interval, count));
        }
      } catch (err) { this.opts.onError?.(err); }
    };
  }
  get selected() { return this.level?.spawns.find((s) => this.ids.has(s.id)) || null; }
  get selection() { return this.level?.spawns.filter((s) => this.ids.has(s.id)) || []; }
  setLevel(level) { this.level = level; this.ids = new Set([...this.ids].filter((id) => level.spawns.some((s) => s.id === id))); this.render(); }
  select(spawn, additive = false) {
    if (!additive) this.ids.clear();
    if (spawn) { if (additive && this.ids.has(spawn.id)) this.ids.delete(spawn.id); else this.ids.add(spawn.id); }
    this.syncSelection(); this.opts.onSelect?.(this.selected);
  }
  syncSelection() { for (const el of this.host.querySelectorAll('[data-spawn-id]')) el.classList.toggle('is-on', this.ids.has(el.dataset.spawnId)); }
  span() { return this.opts.duration?.() ?? playableUntil(this.level, this.opts.speeds?.()); }
  width() { return Math.max(100, this.host.clientWidth - 32); }
  fit() { this.fullView = true; this.viewStart = 0; this.viewSpan = this.span(); this.fitted = true; }
  resize() { if (this.drag) this.pointerUp(); this.render(); }
  setCursor(t) {
    this.cursor = clamp(t, 0, this.span());
    if (this.playing && (this.cursor < this.viewStart || this.cursor > this.viewStart + this.viewSpan)) {
      this.viewStart = clamp(this.cursor - this.viewSpan * .1, 0, this.span() - this.viewSpan); this.render();
    }
    const el = this.host.querySelector('.lv-tl-cursor');
    if (el) { el.style.left = `${12 + (this.cursor - this.viewStart) * this.pps}px`; el.hidden = this.cursor < this.viewStart || this.cursor > this.viewStart + this.viewSpan; }
    const label = this.host.querySelector('[data-tl-time]'); if (label) label.textContent = `${this.cursor.toFixed(1)} s`;
    this.opts.onCursor?.(this.cursor);
  }
  updatePlayback() { const button = this.host.querySelector('[data-tl-act="play"]'); if (button) button.textContent = this.playing ? 'Ⅱ 暂停推演' : '▶ 播放推演'; }
  advance(dt) { if (!this.playing || this.drag) return; this.setCursor(this.cursor + dt); if (this.cursor >= this.span()) { this.playing = false; this.updatePlayback(); } }
  setCounts(c) { const el = this.host.querySelector('[data-tl-counts]'); if (el) el.textContent = `场上 ${c.walking} · 未出 ${c.pending} · 已抵达 ${c.arrived}`; }
  pointerDown(e) {
    if (e.button !== 0 || !this.level || !e.target.closest('.lv-tl-lane')) return;
    const lane = e.target.closest('.lv-tl-lane'), dot = e.target.closest('[data-spawn-id]'), box = lane.getBoundingClientRect();
    this.playing = false; this.updatePlayback();
    const scale = box.width / lane.clientWidth, x = (e.clientX - box.left) / scale, y = (e.clientY - box.top) / scale;
    if (dot) {
      const s = this.level.spawns.find((v) => v.id === dot.dataset.spawnId);
      if (e.shiftKey || !this.ids.has(s.id)) this.select(s, e.shiftKey);
      this.opts.onBeforeChange?.();
      this.drag = { kind: 'points', id: e.pointerId, x, y, lane, starts: this.selection.map((s) => [s, s.at]) };
    } else {
      this.drag = { kind: y < 24 || e.target.closest('.lv-tl-cursor') ? 'cursor' : 'box', id: e.pointerId, x, y, lane, original: e.shiftKey ? new Set(this.ids) : new Set(), moved: false };
      if (this.drag.kind === 'cursor') this.setCursor(this.viewStart + (x - 12) / this.pps);
    }
    this.host.setPointerCapture(e.pointerId);
    window.addEventListener('pointermove', this.move); window.addEventListener('pointerup', this.up); window.addEventListener('pointercancel', this.up); e.preventDefault();
  }
  pointerMove(e) {
    const d = this.drag; if (!d || d.id !== e.pointerId) return;
    const box = d.lane.getBoundingClientRect(), scale = box.width / d.lane.clientWidth, x = (e.clientX - box.left) / scale, y = (e.clientY - box.top) / scale;
    d.moved ||= Math.hypot(x - d.x, y - d.y) > 3;
    if (d.kind === 'cursor') { this.setCursor(this.viewStart + (x - 12) / this.pps); return; }
    if (d.kind === 'points') {
      if (!d.starts.length) return;
      let delta = (x - d.x) / this.pps;
      if (!e.altKey) delta = Math.round(delta * 10) / 10;
      delta = clamp(delta, -Math.min(...d.starts.map((p) => p[1])), 3600 - Math.max(...d.starts.map((p) => p[1])));
      for (const [s, at] of d.starts) s.at = Math.round((at + delta) * 1000) / 1000;
      for (const dot of this.host.querySelectorAll('[data-spawn-id]')) { const s = this.level.spawns[Number(dot.dataset.index)]; dot.style.left = `${12 + (s.at - this.viewStart) * this.pps}px`; }
      this.opts.onChange?.(); return;
    }
    const left = Math.min(d.x, x), top = Math.min(d.y, y), width = Math.abs(x - d.x), height = Math.abs(y - d.y);
    let selection = d.lane.querySelector('.lv-tl-box');
    if (!selection) { selection = document.createElement('div'); selection.className = 'lv-tl-box'; d.lane.append(selection); }
    Object.assign(selection.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    this.ids = new Set(d.original);
    for (const dot of this.host.querySelectorAll('[data-spawn-id]')) {
      const px = parseFloat(dot.style.left), py = parseFloat(dot.style.top);
      if (px >= left - 6 && px <= left + width + 6 && py >= top - 6 && py <= top + height + 6) this.ids.add(dot.dataset.spawnId);
    }
    this.syncSelection();
  }
  pointerUp(e) {
    const d = this.drag; if (!d || e && e.pointerId !== d.id) return;
    if (d.kind === 'box' && !d.moved) { this.ids.clear(); this.setCursor(this.viewStart + (d.x - 12) / this.pps); }
    this.cancelDrag(); this.render(); this.opts.onSelect?.(this.selected);
    if (d.kind === 'points') this.opts.onChange?.();
  }
  cancelDrag() {
    const id = this.drag?.id; this.drag = null;
    window.removeEventListener('pointermove', this.move); window.removeEventListener('pointerup', this.up); window.removeEventListener('pointercancel', this.up);
    if (id != null && this.host.hasPointerCapture(id)) this.host.releasePointerCapture(id);
  }
  shift(delta) {
    const selected = this.selection; if (!selected.length) return;
    delta = clamp(delta, -Math.min(...selected.map((s) => s.at)), 3600 - Math.max(...selected.map((s) => s.at)));
    for (const s of selected) s.at = Math.round((s.at + delta) * 10) / 10;
  }
  remove() { this.level.spawns = this.level.spawns.filter((s) => !this.ids.has(s.id)); this.ids.clear(); }
  duplicate(interval = 1, count = 1) {
    const originals = this.selection;
    if (!originals.length) return;
    if (!Number.isFinite(interval) || interval < 0 || !Number.isInteger(count) || count < 1) throw new Error('复制间隔须非负，份数须为正整数');
    if (this.level.spawns.length + originals.length * count > MAX_SPAWNS) throw new Error(`复制后超过 ${MAX_SPAWNS} 条出生`);
    if (originals.some((s) => s.at + interval * count > 3600)) throw new Error('复制后的出生时间不能超过 3600 秒');
    const created = [];
    for (let i = 1; i <= count; i++) for (const original of originals) created.push({ ...cloneLevel(original), id: newId('s'), at: Math.round((original.at + i * interval) * 1000) / 1000 });
    this.level.spawns.push(...created); this.ids = new Set(created.map((s) => s.id));
  }
  render() {
    if (!this.level) return;
    if (!this.fitted) this.fit();
    const interval = this.host.querySelector('[data-tl-interval]')?.value || '2', count = this.host.querySelector('[data-tl-count]')?.value || '1';
    const span = this.span(), width = this.width();
    if (this.fullView) { this.viewStart = 0; this.viewSpan = span; }
    this.viewSpan = Math.min(this.viewSpan, span); this.viewStart = clamp(this.viewStart, 0, span - this.viewSpan);
    this.pps = (width - 24) / this.viewSpan;
    const step = Math.max(.1, Math.ceil(75 / this.pps / 5) * 5), ticks = [];
    for (let t = Math.ceil(this.viewStart / step) * step; t <= this.viewStart + this.viewSpan; t += step) ticks.push(`<span class="lv-tl-tick" style="left:${12 + (t - this.viewStart) * this.pps}px">${Number(t.toFixed(1))}s</span>`);
    const routeColors = new Map(this.level.stage.routes.map((r, i) => [r.id, `hsl(${(i * 67 + 35) % 360} 65% 66%)`]));
    const lanes = new Map();
    const dots = this.level.spawns.map((s, i) => {
      if (s.at < this.viewStart || s.at > this.viewStart + this.viewSpan) return '';
      const bucket = Math.round(s.at * this.pps / 14), row = (lanes.get(bucket) || 0) % 3; lanes.set(bucket, (lanes.get(bucket) || 0) + 1);
      const entry = this.opts.names?.[s.enemy], name = entry?.short || entry?.name || s.enemy;
      return `<button class="lv-tl-dot${this.ids.has(s.id) ? ' is-on' : ''}" data-spawn-id="${esc(s.id)}" data-index="${i}" style="left:${12 + (s.at - this.viewStart) * this.pps}px;top:${32 + row * 18}px;--point-color:${routeColors.get(s.route) || '#bfc8cf'}" title="${esc(name)} · ${s.at.toFixed(1)} 秒"><span>${esc(name)}</span></button>`;
    }).join('');
    this.host.innerHTML = `<div class="lv-tl-bar"><b>出生 ${this.level.spawns.length}</b><span data-tl-counts></span><b data-tl-time>${this.cursor.toFixed(1)} s</b><button class="lv-btn" data-tl-act="play">▶ 播放推演</button><span class="lv-spacer"></span><button class="lv-btn" data-tl-act="prev" aria-label="上一段时间"${this.viewStart <= 0 ? ' disabled' : ''}>◀</button><span class="lv-tl-window">${this.viewStart.toFixed(1)}–${(this.viewStart + this.viewSpan).toFixed(1)}s</span><button class="lv-btn" data-tl-act="next" aria-label="下一段时间"${this.viewStart + this.viewSpan >= span ? ' disabled' : ''}>▶</button><button class="lv-btn" data-tl-act="fit">全览</button><button class="lv-btn" data-tl-act="place">＋ 放一只</button></div>
      ${this.ids.size ? `<div class="lv-tl-bulk">选中 ${this.ids.size} 只 · 每 <input data-tl-interval type="number" min="0" step="0.1" value="${esc(interval)}"> 秒复制 <input data-tl-count type="number" min="1" max="8000" value="${esc(count)}"> 份 <button class="lv-btn" data-tl-act="duplicate">复制</button></div>` : ''}
      <div class="lv-tl-scroll"><div class="lv-tl-lane" style="width:${width}px">${ticks.join('')}${dots}<div class="lv-tl-cursor" style="left:${12 + (this.cursor - this.viewStart) * this.pps}px"></div></div></div>
      <p class="lv-tl-hint">拖上沿移动游标 · 拖点改时间（Alt 关闭吸附）· Shift 点选 / 空白处框选 · ← → 平移，Shift 1 秒 · Delete 删除 · 滚轮缩放 · 前后按钮换时间段 · 全览显示整关</p>`;
    this.updatePlayback();
    const cursor = this.host.querySelector('.lv-tl-cursor'); cursor.hidden = this.cursor < this.viewStart || this.cursor > this.viewStart + this.viewSpan;
    this.opts.onCursor?.(this.cursor);
  }
  destroy() { this.cancelDrag(); this.host.removeEventListener('pointerdown', this.down); this.host.removeEventListener('wheel', this.wheel); this.host.onclick = this.host.onchange = this.host.ondblclick = null; }
}
