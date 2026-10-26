// Projected shapes shared by the two custom operator presentations.
export const TAU = Math.PI * 2;
export const fade = (t, duration) => Math.max(0, 1 - t / duration);
export const direction = (dir) => ({ RIGHT: [1, 0], LEFT: [-1, 0], UP: [0, 1], DOWN: [0, -1] }[dir] || [1, 0]);

export function makePaint(fx) {
  const ground = new fx.P.Graphics(), ink = new fx.P.Graphics();
  ground.blendMode = ink.blendMode = fx.P.BLEND_MODES.ADD;
  fx.ctx.layers.groundFx.addChild(ground);
  fx.ctx.layers.fxAdd.addChild(ink);
  return { ground, ink };
}

export function stroke(g, points, color, width = 1, alpha = 1, close = false) {
  if (points.length < 2) return;
  g.lineStyle(width, color, alpha).moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
  if (close) g.lineTo(points[0][0], points[0][1]);
}

export function fill(g, points, color, alpha = 1) {
  g.lineStyle(0).beginFill(color, alpha).drawPolygon(points.flat()).endFill();
}

export function arc(g, x, y, rx, ry, start, end, color, width = 1, alpha = 1, steps = 24) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + (end - start) * i / steps;
    points.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]);
  }
  stroke(g, points, color, width, alpha);
}

export function worldStroke(fx, g, points, z, color, width = 1, alpha = 1, close = false) {
  const cam = fx.ctx.cam();
  stroke(g, points.map(([x, y]) => { const p = cam.project(x, y, z); return [p.x, p.y]; }), color, width, alpha, close);
}

export function groundRing(fx, g, x, y, r, color, alpha = 1, phase = 0) {
  const z = fx._groundZ(x, y) + .025, points = [];
  for (let i = 0; i <= 32; i++) {
    const a = i / 32 * TAU + phase;
    points.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  worldStroke(fx, g, points, z, color, 1.3, alpha);
}

export function star(g, x, y, r, color, alpha = 1, angle = 0) {
  const points = [];
  for (let i = 0; i < 8; i++) {
    const a = angle + i * Math.PI / 4, d = i % 2 ? r * .15 : r;
    points.push([x + Math.cos(a) * d, y + Math.sin(a) * d]);
  }
  fill(g, points, color, alpha);
}

export function crescent(g, x, y, r, color, alpha = 1, angle = 0, width = .18) {
  const points = [];
  for (let side = 0; side < 2; side++) for (let j = 0; j <= 18; j++) {
    const i = side ? 18 - j : j, a = angle - 1.1 + i / 18 * 2.2;
    const rad = r * (side ? 1 - Math.sin(i / 18 * Math.PI) * width : 1);
    points.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad * .7]);
  }
  fill(g, points, color, alpha);
}

export function crown(g, x, y, s, color, alpha = 1) {
  stroke(g, [[x-s*.4,y],[x-s*.5,y-s*.35],[x-s*.18,y-s*.2],[x,y-s*.55],[x+s*.18,y-s*.2],[x+s*.5,y-s*.35],[x+s*.4,y],[x-s*.4,y]], color, Math.max(1,s*.035), alpha);
  stroke(g, [[x-s*.35,y+s*.09],[x+s*.35,y+s*.09]], color, 1.5, alpha);
}

export function cue(list, rec, limit = 72) {
  if (list.length >= limit) list.shift();
  list.push({ t: 0, ...rec });
}

export function live(view) { return !!view && !view.destroyed && view.alive && !(view.dying > 0); }

export function feet(fx, view, lift = 0) {
  return fx.ctx.cam().project(view.x, view.y, (view.z || 0) + (view.hover || 0) + lift);
}
