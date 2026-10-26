// Shared crescent surface and live sword-bone trails.
import { talulaProfileKey, talulaSweep } from './talula-animation.js';

export const TALULA_SLASH_LIMIT = 8;
const SEGMENTS = 12;
const PROFILE = [0, 0.5, 0.83, 0.96, 1];
const COLORS = [0xc23a12, 0xff8a3d, 0xffb85b, 0xffe9a8];
const OPACITY = [0.08, 0.26, 0.6, 0.98];

/** The two existing pools share one eight-instance allocation budget. */
export function takeTalulaSlash(fx, qi = false) {
  if (fx.talulaSlashes.length + fx.talulaQi.length >= TALULA_SLASH_LIMIT) {
    let oldest, list;
    for (const active of [fx.talulaSlashes, fx.talulaQi]) for (const rec of active) {
      if (!oldest || rec.t > oldest.t) { oldest = rec; list = active; }
    }
    list.splice(list.indexOf(oldest), 1);
    oldest.owner = null; oldest.g.clear(); oldest.g.visible = false;
    if (oldest.back) { oldest.back.clear(); oldest.back.visible = false; }
    (list === fx.talulaQi ? fx.talulaQiFree : fx.talulaSlashFree).push(oldest);
  }
  const pool = qi ? fx.talulaQiFree : fx.talulaSlashFree;
  const other = qi ? fx.talulaSlashFree : fx.talulaQiFree;
  const rec = pool.pop() || other.pop() || { g: new fx.P.Graphics(), a: {}, b: {}, world: {}, center: {} };
  if (rec.g.parent !== fx.ctx.layers.fxAdd) fx.ctx.layers.fxAdd.addChild(rec.g);
  rec.g.blendMode = fx.P.BLEND_MODES.ADD;
  rec.g.clear(); rec.g.visible = true;
  if (rec.back) { rec.back.clear(); rec.back.visible = false; }
  return rec;
}

/** Bone offsets already include the model's facing, tilt and squash. */
export function talulaBladePose(owner, out) {  if (!owner?.boneOffset || owner.destroyed) return null;
  const hilt = owner.boneOffset('R_Weapon', out.hilt || (out.hilt = {}));
  const blade = owner.boneOffset('F_R_Weapon', out.blade || (out.blade = {}));
  if (!hilt || !blade) return null;
  const sk = owner.actor.spine.skeleton;
  const length = sk.findBone('R_Weapon').data.length;
  const offset = sk.findBone('F_R_Weapon').data.x;
  const k = length / offset;
  out.tipX = hilt.x + (blade.x - hilt.x) * k;
  out.tipUp = hilt.up + (blade.up - hilt.up) * k;
  out.x = owner.x; out.y = owner.y;
  out.z = (owner.z || 0) + (owner.hover || 0) + (owner._float || 0) + (owner.lift || 0);
  return out;
}

function bladePoint(cam, pose, along, out) {
  cam.project(pose.x, pose.y, pose.z, out);
  out.x += (pose.hilt.x + (pose.tipX - pose.hilt.x) * along) * out.s;
  out.y -= (pose.hilt.up + (pose.tipUp - pose.hilt.up) * along) * out.s;
  return out;
}

/** A short history of the actual blade tip, with inward bands and pointed ends. */
export function drawTalulaBladeTrail(fx, rec, fade) {
  const view = rec.owner, actor = view?.actor, track = actor?.spine.state.tracks[0];
  const pose = talulaBladePose(view, rec.pose || (rec.pose = {}));
  let trail = rec.trail;
  // 只采「剑真的在扫」的那一段：区间随档位走，不写字面量帧号。
  const sweep = talulaSweep(talulaProfileKey(actor?.skillIndex, actor?.skillOn));
  const inSweep = !!track && track.trackTime >= sweep.from && track.trackTime <= sweep.to;
  if (pose && actor.mode === 'attack' && actor.current === view.entry.anims.swing.clip && inSweep) {
    const last = trail[trail.length - 1];
    if (!last || last.poseTime !== track.trackTime) trail.push({
      x: pose.x, y: pose.y, z: pose.z, hilt: { x: pose.hilt.x, up: pose.hilt.up },
      tipX: pose.tipX, tipUp: pose.tipUp, t: rec.t, poseTime: track.trackTime,
    });
  }
  const life = rec.fiery ? 0.20 : 0.12;
  while (trail.length && (rec.t - trail[0].t > life || trail.length > 12)) trail.shift();
  if (rec.fiery && pose && actor.mode === 'attack' && inSweep) {
    const cam = fx.ctx.cam(), a = bladePoint(cam, pose, 0.18, rec.a), b = bladePoint(cam, pose, 1, rec.b);
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    for (let k = 0; k < 3; k++) {
      const width = a.s * [0.055, 0.028, 0.009][k];
      rec.g.beginFill([0xc23a12, 0xff8a3d, 0xffe9a8][k], fade * [0.35, 0.65, 0.95][k]);
      rec.g.drawPolygon([a.x, a.y, a.x + (b.x - a.x) * 0.55 + nx * width,
        a.y + (b.y - a.y) * 0.55 + ny * width, b.x, b.y,
        a.x + (b.x - a.x) * 0.40 - nx * width * 0.5,
        a.y + (b.y - a.y) * 0.40 - ny * width * 0.5]);
      rec.g.endFill();
    }
  }
  if (trail.length < 2) return;
  if (trail.length === 2) {
    const [a, b] = trail;
    trail = [a, {
      x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
      hilt: { x: (a.hilt.x + b.hilt.x) / 2, up: (a.hilt.up + b.hilt.up) / 2 },
      tipX: (a.tipX + b.tipX) / 2, tipUp: (a.tipUp + b.tipUp) / 2, t: (a.t + b.t) / 2,
    }, b];
  }
  const cam = fx.ctx.cam(), rows = rec.trailRows || (rec.trailRows = []);
  for (let i = 0; i < trail.length; i++) {
    const row = rows[i] || (rows[i] = Array.from({ length: PROFILE.length }, () => ({})));
    const taper = Math.pow(Math.sin(Math.PI * i / (trail.length - 1)), 0.75);
    for (let band = 0; band < PROFILE.length; band++) {
      bladePoint(cam, trail[i], 1 - (rec.fiery ? 0.86 : 0.62) * taper * (1 - PROFILE[band]), row[band]);
    }
  }
  for (let band = 0; band < 4; band++) for (let i = 0; i < trail.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    const age = 1 - Math.min(1, (rec.t - trail[i].t) / life);
    rec.g.beginFill(COLORS[band], OPACITY[band] * fade * age * (rec.fiery ? 0.95 : 0.65));
    rec.g.drawPolygon([a[band].x, a[band].y, b[band].x, b[band].y,
      b[band + 1].x, b[band + 1].y, a[band + 1].x, a[band + 1].y]);
    rec.g.endFill();
  }
}

/** The ignition travels from the raised palm towards the current sword tip. */
export function drawTalulaIgnition(fx, rec) {
  const pose = talulaBladePose(rec.owner, rec.pose || (rec.pose = {}));
  if (!pose) return;
  const empower = rec.kind === 'talulaEmpower';
  const palm = empower ? pose.hilt : rec.owner.boneOffset('L_Hand', rec.palm || (rec.palm = {}));
  if (!palm) return;
  const cam = fx.ctx.cam(), origin = cam.project(pose.x, pose.y, pose.z, rec.center);
  const x = origin.x + palm.x * origin.s, y = origin.y - palm.up * origin.s;
  bladePoint(cam, pose, 1, rec.a);
  const dx = rec.a.x - x, dy = rec.a.y - y, length = Math.hypot(dx, dy);
  if (length < 1) return;
  const head = Math.min(1, rec.t / (empower ? 0.12 : 0.42)), tail = Math.max(0, head - 0.68);
  const fade = Math.min(1, rec.t / (empower ? 0.06 : 0.22), (rec.end - rec.t) / (empower ? 0.12 : 0.24));
  const nx = -dy / length, ny = dx / length;
  for (let layer = 0; layer < 3; layer++) {
    const points = rec.ignitionPoints || (rec.ignitionPoints = []); points.length = 0;
    for (const side of [-1, 1]) for (let j = 0; j <= 12; j++) {
      const u = side < 0 ? j / 12 : 1 - j / 12;
      const at = tail + (head - tail) * u;
      const width = Math.sin(Math.PI * u) * origin.s * [0.036, 0.018, 0.006][layer] * fade;
      points.push(x + dx * at + nx * width * side, y + dy * at + ny * width * side);
    }
    rec.g.beginFill([0xc23a12, 0xff8a3d, 0xffe9a8][layer], fade * [0.18, 0.5, 0.72][layer]);
    rec.g.drawPolygon(points); rec.g.endFill();
  }
}

/** Arc centre, angular aperture, inward thickness and a trailing displacement share one surface. */
export function drawTalulaCrescent(fx, rec, o) {
  const cam = fx.ctx.cam();
  const mesh = rec.blade || (rec.blade = {
    rows: Array.from({ length: SEGMENTS + 1 }, () => ({ world: {}, lag: {}, points: Array.from({ length: 6 }, () => ({})) })),
    polygons: Array.from({ length: SEGMENTS * 5 }, () => []), center: {},
  });
  const segments = o.knots ? o.knots.length - 1 : SEGMENTS;
  cam.project(o.x, o.y, o.back ? fx._groundZ(o.x, o.y) : o.z, mesh.center);
  for (let i = 0; i <= segments; i++) {
    const a = o.knots ? o.knots[i] : o.start + o.span * i / segments;
    const u = (a - o.start) / o.span;
    const taper = i === 0 || i === segments ? 0 : Math.pow(Math.sin(Math.PI * u), 0.75);
    const row = mesh.rows[i], w = row.world;
    if (o.sample) {
      o.sample(a, w);
      o.sample(a - (o.lag || 0) * taper, row.lag);
    } else {
      const c = Math.cos(a) * o.radius, s = Math.sin(a) * o.radius;
      w.x = o.x + c * o.ax + s * o.bx;
      w.y = o.y + c * o.ay + s * o.by;
      w.z = o.z + c * (o.az || 0) + s * (o.bz || 0);
      const lag = a - (o.lag || 0) * taper;
      const lc = Math.cos(lag) * o.radius, ls = Math.sin(lag) * o.radius;
      row.lag.x = o.x + lc * o.ax + ls * o.bx;
      row.lag.y = o.y + lc * o.ay + ls * o.by;
      row.lag.z = o.z + lc * (o.az || 0) + ls * (o.bz || 0);
    }
    const dx = w.x - o.x, dy = w.y - o.y, dz = w.z - o.z;
    const radius = Math.max(0.001, Math.hypot(dx, dy, dz));
    const width = Math.min(radius * 0.85, o.thickness * taper);
    row.above = !o.terrain || w.z >= fx._groundZ(w.x, w.y) + 0.04;
    for (let band = 0; band < PROFILE.length; band++) {
      const inset = width * (1 - PROFILE[band]) / radius;
      cam.project(w.x - dx * inset, w.y - dy * inset, w.z - dz * inset, row.points[band]);
    }
    cam.project(row.lag.x - (o.trailX || 0) * taper - dx * width / radius,
      row.lag.y - (o.trailY || 0) * taper - dy * width / radius,
      row.lag.z - (o.trailZ || 0) * taper - dz * width / radius, row.points[5]);
    row.depth = cam.depthOf(w.x, w.y, fx._groundZ(w.x, w.y));
  }
  // Fill only: stroked Graphics paths would add unbounded join/cap vertices.
  for (let band = -1; band < 4; band++) {
    for (let i = 0; i < segments; i++) {
      const a = mesh.rows[i], b = mesh.rows[i + 1];
      if (!a.above || !b.above) continue;
      const front = !o.back || (a.depth + b.depth) * 0.5 <= mesh.center.depth;
      const g = front ? rec.g : o.back;
      const inner = band < 0 ? 5 : band, outer = band < 0 ? 0 : band + 1;
      const pts = mesh.polygons[(band + 1) * SEGMENTS + i]; pts.length = 0;
      for (const p of [a.points[outer], b.points[outer], b.points[inner], a.points[inner]]) pts.push(p.x, p.y);
      g.lineStyle(0);
      g.beginFill(band < 0 ? 0xff8a3d : COLORS[band], o.alpha * (front ? 1 : 0.62) * (band < 0 ? 0.1 : OPACITY[band]));
      g.drawPolygon(pts); g.endFill();
    }
  }
}
