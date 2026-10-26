import { Grid } from '/sim/grid.js';
import { previewRoute } from './routes.js';

export const newId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
export function newSpawn({ at, enemy, route = null, pos = null }) {
  return { id: newId('s'), at, enemy, route, ...(pos ? { pos: pos.slice() } : {}) };
}
export function routeOf(level, spawn) {
  return typeof spawn.route === 'string' ? level.stage.routes.find((r) => r.id === spawn.route) : spawn.route;
}
const cache = new WeakMap();
export const invalidateTrajectories = (level) => cache.delete(level);
function context(level) {
  if (!cache.has(level)) cache.set(level, { grid: new Grid(level.stage, level.stage.rect), routes: new Map() });
  return cache.get(level);
}
export function walkPoints(polyline, waitList = []) {
  let dist = 0;
  return polyline.map(([r, c], i) => {
    if (i) dist += Math.hypot(r - polyline[i - 1][0], c - polyline[i - 1][1]);
    return { r, c, dist, wait: waitList[i] || 0 };
  });
}
function trajectory(level, spawn) {
  const route = routeOf(level, spawn);
  if (!route) return { points: walkPoints([spawn.pos]), pinned: true, ok: true };
  const ctx = context(level);
  if (ctx.routes.has(route)) return ctx.routes.get(route);
  const preview = previewRoute(level.stage, route, ctx.grid);
  const line = [route.start.slice()], waits = [0];
  let segment = 0;
  // WAIT 在引擎里是「在前一个 MOVE 落点停留」；pos 本身不触发移动。
  for (const cp of route.checkpoints) {
    if (cp.type === 'WAIT') waits[waits.length - 1] += cp.time;
    else {
      const path = preview.segments[segment++]?.path;
      if (path) for (const p of path.slice(1)) { line.push(p.slice()); waits.push(0); }
    }
  }
  if (route.end && segment < preview.segments.length) {
    const path = preview.segments[segment].path;
    if (path) for (const p of path.slice(1)) { line.push(p.slice()); waits.push(0); }
  }
  const value = { points: walkPoints(line, waits), pinned: !route.end, ok: preview.ok };
  ctx.routes.set(route, value);
  return value;
}
export function routePolyline(level, spawn) { return trajectory(level, spawn).points.map((p) => [p.r, p.c]); }
function atTrajectory(track, elapsed, speed) {
  const pts = track.points;
  const headingAt = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[i];
    return Math.atan2(b.r - a.r, b.c - a.c);
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (elapsed < p.wait || !track.ok) return { state: 'walking', pos: [p.r, p.c], heading: headingAt(i), distance: p.dist };
    elapsed -= p.wait;
    const q = pts[i + 1];
    if (!q) return { state: track.pinned ? 'walking' : 'arrived', pos: [p.r, p.c], heading: headingAt(i), distance: p.dist };
    const length = q.dist - p.dist, duration = speed > 0 ? length / speed : Infinity;
    if (elapsed < duration) {
      const f = speed > 0 && length > 0 ? elapsed * speed / length : 0;
      return { state: 'walking', pos: [p.r + (q.r - p.r) * f, p.c + (q.c - p.c) * f], heading: headingAt(i + 1), distance: p.dist + length * f };
    }
    elapsed -= duration;
  }
}
/**
 * 编辑器没有我方干员，不模拟阻挡、减速与攻击。仅按寻路折线、移速与 WAIT 解析位置；
 * 真正战斗仍交给沙盒。t < at 为 pending；其余按经过秒数扣停留、再走距离；终点抵达。
 */
export function spawnStateAt(level, spawn, t, speed = 1) {
  if (t < spawn.at) return { state: 'pending', pos: null, heading: 0, distance: 0 };
  return atTrajectory(trajectory(level, spawn), t - spawn.at, Math.max(0, speed));
}
export function fieldAt(level, t, speeds = {}) {
  return level.spawns.map((spawn) => ({ spawn, ...spawnStateAt(level, spawn, t, speeds[spawn.enemy] ?? 1) }));
}
export function playableUntil(level, speeds = {}) {
  let last = 0;
  for (const s of level.spawns) {
    const tr = trajectory(level, s), speed = speeds[s.enemy] ?? 1;
    const seconds = tr.pinned || !tr.ok || speed <= 0 ? 0 : tr.points.at(-1).dist / speed + tr.points.reduce((sum, p) => sum + p.wait, 0);
    last = Math.max(last, s.at + seconds);
  }
  return Math.max(60, Math.ceil(last + 60));
}
