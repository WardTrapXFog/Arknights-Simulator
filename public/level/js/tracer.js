import { fieldAt, routePolyline } from './level-model.js';
import { ROWS } from '../../sandbox/js/battlefield.js';
const NS = 'http://www.w3.org/2000/svg';
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const xy = ([r, c]) => `${c + .5},${ROWS - r - .5}`;
export class LevelTracer {
  constructor(svg, opts) {
    this.svg = svg; this.opts = opts; this.t = 0; this.selected = null; this.hovered = null;
    this.layer = svg.appendChild(document.createElementNS(NS, 'g')); this.layer.setAttribute('class', 'tracer');
    this.click = (e) => { const id = e.target.closest('[data-trace-id]')?.dataset.traceId; if (id) { e.stopPropagation(); opts.onSelect?.(opts.level().spawns.find((s) => s.id === id)); } };
    this.hover = (e) => { const id = e.target.closest('[data-trace-id]')?.dataset.traceId; if (id !== this.hovered) { this.hovered = id; this.showAt(this.t); } };
    this.leave = () => { this.hovered = null; this.showAt(this.t); };
    this.down = (e) => { if (e.target.closest('[data-trace-id]')) e.stopPropagation(); };
    svg.addEventListener('pointerdown', this.down);
    svg.addEventListener('click', this.click); svg.addEventListener('pointerover', this.hover); svg.addEventListener('pointerleave', this.leave);
  }
  highlight(spawn) { this.selected = spawn?.id || null; this.showAt(this.t); }
  showAt(t) {
    this.t = t;
    const level = this.opts.level(); if (!level) return;
    const states = fieldAt(level, t, this.opts.speeds()), focus = this.hovered || this.selected;
    const chosen = states.find((v) => v.spawn.id === focus);
    const walkers = states.filter((s) => s.state === 'walking');
    const paths = chosen ? [chosen] : walkers.length <= 3 ? walkers : [];
    const lines = paths.map((s) => {
      const points = routePolyline(level, s.spawn), walked = [], rest = [];
      let dist = 0;
      for (let i = 0; i < points.length; i++) {
        if (i) dist += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        if (dist <= s.distance && s.state !== 'pending') walked.push(points[i]); else rest.push(points[i]);
      }
      if (s.pos) { walked.push(s.pos); rest.unshift(s.pos); }
      return `<polyline class="tracer-route tracer-route--future" points="${rest.map(xy).join(' ')}"/><polyline class="tracer-route" points="${walked.map(xy).join(' ')}"/>`;
    }).join('');
    // 抵达只保留选中单位的空心终点，避免所有历史漏怪堆满蓝门。
    this.layer.innerHTML = lines + states.filter((s) => s.state === 'walking' || s.state === 'arrived' && s.spawn.id === focus).map((s) => {
      const [r, c] = s.pos, name = this.opts.names?.[s.spawn.enemy] || s.spawn.enemy;
      return `<g class="tracer-unit${s.state === 'arrived' ? ' is-arrived' : ''}${s.spawn.id === focus ? ' is-on' : ''}" data-trace-id="${esc(s.spawn.id)}" transform="translate(${c + .5} ${ROWS - r - .5})"><title>${esc(name)} · ${s.spawn.at.toFixed(1)}s${s.state === 'arrived' ? ' · 已抵达' : ''}</title><circle r=".23"/><path d="M .4 0 L .14 -.12 L .14 .12 Z" transform="rotate(${-s.heading * 180 / Math.PI})"/><text y=".54">${esc(name)}</text></g>`;
    }).join('');
    this.opts.onCounts?.({ walking: walkers.length, pending: states.filter((v) => v.state === 'pending').length, arrived: states.filter((v) => v.state === 'arrived').length });
  }
  clear() { this.layer.innerHTML = ''; }
  destroy() { this.svg.removeEventListener('pointerdown', this.down); this.svg.removeEventListener('click', this.click); this.svg.removeEventListener('pointerover', this.hover); this.svg.removeEventListener('pointerleave', this.leave); this.layer.remove(); }
}
