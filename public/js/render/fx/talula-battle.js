// Talula's travelling blades, expanding sword wave, fire wall and bounded ground fire.
import { GEO } from '../../../../shared/constants.js';
import { talulaRandom } from './talula-animation.js';
import { drawTalulaCrescent, takeTalulaSlash } from './talula-slash.js';
import { talulaFrame } from './talula-textures.js';

const HOT = 0xffe9a8, MID = 0xff8a3d, DEEP = 0xc23a12;
const TAU = Math.PI * 2;
const sat = (x) => Math.max(0, Math.min(1, x));
const DIR = { RIGHT: [1, 0], LEFT: [-1, 0], UP: [0, 1], DOWN: [0, -1] };
const rectOf = (fx) => fx.ctx.fieldRect?.() || { r0: 0, r1: 18, c0: 0, c1: 20 };

function visible(fx, p, margin = 0) {
  const size = fx.ctx.screenSize?.();
  return p.s > 0 && (!size || (p.x >= -margin && p.x <= size.width + margin
    && p.y >= -margin && p.y <= size.height + margin));
}

function graphic(fx, layer, add = true) {
  const g = new fx.P.Graphics();
  g.blendMode = add ? fx.P.BLEND_MODES.ADD : fx.P.BLEND_MODES.NORMAL;
  layer.addChild(g);
  return g;
}

function qiPosition(rec, p, out) {
  out.x = rec.x + (rec.tx - rec.x) * p;
  out.y = rec.y + (rec.ty - rec.y) * p;
  out.z = rec.z + (rec.tz - rec.z) * p;
  return out;
}

export function spawnTalulaQi(fx, at, ex) {
  const owner = at.v;
  const dir = DIR[ex.dir] || DIR.RIGHT;
  const tx = Number.isFinite(ex.tx) ? ex.tx : at.x + dir[0];
  const ty = Number.isFinite(ex.ty) ? ex.ty : at.y + dir[1];
  const dx = tx - at.x, dy = ty - at.y, length = Math.hypot(dx, dy);
  const ux = length > 0.001 ? dx / length : dir[0], uy = length > 0.001 ? dy / length : dir[1];
  const z = at.z + (owner?._float || 0) + 0.55;
  // Caster culling is not projectile visibility: a blade can fly into the viewport.
  const target = fx._viewOf(ex.target);
  const tz = target ? (target.z || 0) + (target.hover || 0) + (target._float || 0) + 0.5
    : fx._groundZ(tx, ty) + 0.5;
  const rec = takeTalulaSlash(fx, true);
  const lead = Math.min(0.28, length * 0.25);
  // Capture both endpoints now. Neither a later target move nor death can steer the blade.
  Object.assign(rec, {
    x: at.x + ux * lead, y: at.y + uy * lead, z, tx, ty, tz, ux, uy,
    // 发射点原样记下：剑气池会丢 owner，靠它反推会算错（实际是 length*0.25，不是 /3）
    sx: at.x, sy: at.y,
    kind: 'talulaQiSlash', owner: null, fly: Math.max(0.08, (length - lead) / 9), t: 0, struck: false,
    seed: talulaRandom(fx) * TAU,
  });
  rec.g.visible = true;
  fx.talulaQi.push(rec);
}

/**
 * 剑气：**薄刃**，不是半透明环段。
 *
 * 旧形态是 start=-0.68π、span=1.36π 的对称月牙，几乎半圆，看起来像塑料环。
 * 策划案要的是细长、两端尖锐、中间略厚的刃：跨度收窄、根部厚末端薄，
 * 并且只在飞行方向的一侧有厚度（单边刃），这样它读起来是一道「劈出去的线」。
 */
function qiCrescent(fx, rec, p, width, alpha) {
  const w = qiPosition(rec, p, rec.world);
  const texture = talulaFrame('flame-crescent', Math.floor(rec.t * 24) % 8);
  if (texture && w.z >= fx._groundZ(w.x, w.y) + 0.04) {
    const cam = fx.ctx.cam(), center = cam.project(w.x, w.y, w.z, {});
    const forward = cam.project(rec.tx, rec.ty, rec.tz, {});
    const targetAngle = Math.atan2(forward.y - center.y, forward.x - center.x);
    if (rec.qiAtlasSeed !== rec.seed) {
      rec.qiAtlasSeed = rec.seed;
      rec.qiBladeAngle = targetAngle;
      // 剑气池会丢 owner，所以用 spawnTalulaQi 记下的发射点找持剑人（不再反推）。
      const sx = Number.isFinite(rec.sx) ? rec.sx : rec.x;
      const sy = Number.isFinite(rec.sy) ? rec.sy : rec.y;
      for (const view of fx.ctx.views?.() || []) {
        if (!view.entry?.anims?.swing?.talula || Math.hypot(view.x - sx, view.y - sy) > 0.1) continue;
        const hilt = view.boneOffset?.('R_Weapon', {});
        const blade = view.boneOffset?.('F_R_Weapon', {});
        if (hilt && blade) rec.qiBladeAngle = Math.atan2(hilt.up - blade.up, blade.x - hilt.x);
        break;
      }
    }
    const delta = Math.atan2(Math.sin(targetAngle - rec.qiBladeAngle), Math.cos(targetAngle - rec.qiBladeAngle));
    const angle = rec.qiBladeAngle + delta * sat(rec.t / 0.06);
    // Keep the source silhouette and aspect ratio: only rotate and uniformly scale.
    const scale = center.s * width * 2 / 256;
    const a = Math.cos(angle) * scale, b = Math.sin(angle) * scale;
    const c = -b, d = a, x = center.x - 128 * (a + c), y = center.y - 128 * (b + d);
    const matrix = rec.qiAtlasMatrix || (rec.qiAtlasMatrix = new fx.P.Matrix());
    matrix.set(a, b, c, d, x, y);
    rec.g.blendMode = fx.P.BLEND_MODES.ADD;
    rec.g.lineStyle(0);
    rec.g.beginTextureFill({ texture, matrix, alpha });
    rec.g.drawPolygon([x, y, x + a * 256, y + b * 256,
      x + (a + c) * 256, y + (b + d) * 256, x + c * 256, y + d * 256]);
    rec.g.endFill();
    return;
  }
  drawTalulaCrescent(fx, rec, {
    x: w.x, y: w.y, z: w.z,
    // 跨度从 1.36π 收到 0.92π，两端收尖；不再是对称半圆
    start: -Math.PI * 0.46, span: Math.PI * 0.92,
    radius: width,
    // 厚度减半，根部略厚；配合 taper 形成两端尖
    thickness: 0.085,
    ax: rec.ux * 0.5, ay: rec.uy * 0.5,
    bx: -rec.uy, by: rec.ux, bz: 0.35,
    // 拖尾沿飞行方向反向滞后，形成单边刃的读感
    trailX: rec.ux * 0.30, trailY: rec.uy * 0.30,
    terrain: true, alpha,
  });
}

export function updateTalulaQi(fx, dt) {
  const cam = fx.ctx.cam(), step = dt * fx._ts();
  let write = 0;
  for (const rec of fx.talulaQi) {
    rec.t += step;
    const g = rec.g, after = rec.t - rec.fly;
    g.clear();
    if (after >= 0.42) {
      g.visible = false; fx.talulaQiFree.push(rec); continue;
    }
    fx.talulaQi[write++] = rec;
    if (after < 0) {
      // One surface includes its own wake; camera clipping acts on the blade, not its caster.
      qiCrescent(fx, rec, rec.t / rec.fly, 0.52, 0.95);
      continue;
    }
    cam.project(rec.tx, rec.ty, rec.tz, rec.center);
    const c = rec.center;
    if (!visible(fx, c, c.s * 0.35) || rec.tz < fx._groundZ(rec.tx, rec.ty) + 0.04) continue;
    const u = sat(after / 0.14), fade = 1 - sat(after / 0.42);
    if (after < 0.14) {
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + rec.seed;
        const r0 = u * c.s * 0.06, r1 = (0.08 + u * 0.37) * c.s;
        rec.a.x = c.x + Math.cos(a) * r0; rec.a.y = c.y + Math.sin(a) * r0 * 0.65;
        rec.b.x = c.x + Math.cos(a) * r1; rec.b.y = c.y + Math.sin(a) * r1 * 0.65;
        const half = c.s * 0.025 * (1 - u);
        filled(g, [rec.a.x, rec.a.y, rec.b.x - Math.sin(a) * half, rec.b.y + Math.cos(a) * half,
          rec.b.x + Math.sin(a) * half, rec.b.y - Math.cos(a) * half], i & 1 ? MID : HOT, (1 - u) * 0.85);
      }
    }
    // Four bounded ember traces remain at the captured endpoint.
    for (let i = 0; i < 4; i++) {
      const a = rec.seed + i * 2.4, spread = (0.04 + after * 0.22) * c.s;
      const x = c.x + Math.cos(a) * spread, y = c.y - after * c.s * 0.42 + Math.sin(a) * spread * 0.45;
      const half = c.s * 0.008;
      filled(g, [x - half, y, x, y - c.s * 0.03, x + half, y,
        x - rec.ux * c.s * 0.035, y + c.s * 0.055], i & 1 ? MID : HOT, fade * 0.75);
    }
    if (!rec.struck) {
      rec.struck = true;
      if (after < 0.1 && fx.rich && fx._room()) fx.particle('flare', c.x, c.y, {
        tint: HOT, life: 0.1 / fx._ts(), s0: c.s / 128 * 0.5, s1: 0, a0: 0.65, a1: 0,
      });
    }
  }
  fx.talulaQi.length = write;
}

/**
 * S3 圆弧剑气只要两件事：朝哪边发，够得到多远。
 *
 * 弧本身是圆的，所以半径取「她自己附近最远的那格」一次就够。旧版按 64 个角度
 * 逐条射线求交、得出贴住范围外沿的半径表，是为了让弧沿外沿绕圈；那个画法已经取消，
 * 半径表一起删掉——留着只会让人以为外沿还在影响形状。
 *
 * `rangeKeys` 里并了 extraRangeKeys（全场灼燃爆发的敌人），不截断的话远处一个敌人
 * 就能把半径撑到整张地图。这里与 `_updateRangeEdge` 用同一条规则：只看附近 3 格。
 */
export function prepareTalulaRange(rec, rangeKeys, dir) {
  rec.rangeAngle = Math.atan2(dir[1], dir[0]);
  const centerR = Math.round(rec.y), centerC = Math.round(rec.x);
  let reach = 0;
  for (const key of rangeKeys) {
    const c = key % GEO.COLS, r = (key - c) / GEO.COLS;
    if (Math.abs(r - centerR) > 3 || Math.abs(c - centerC) > 3) continue;
    reach = Math.max(reach, Math.hypot(c - rec.x, r - rec.y) + 0.5);
  }
  rec.reach = Math.max(1.6, reach);
}

/** An expanding sword wave: a sharp outer edge with burning exhaust behind it. */
export function drawTalulaRing(fx, rec, fade) {
  const g = rec.g;
  g.visible = true;
  g.clear();
  if (rec.back) { rec.back.clear(); rec.back.visible = false; }
  const duration = rec.end || 0.6;
  if (rec.t >= duration) return;
  const p = sat(rec.t / duration);
  const reach = rec.reach || 1.6;
  const radius = 0.12 + (reach - 0.12) * p;
  const facing = rec.rangeAngle || 0, span = Math.PI * 0.82;
  const alpha = sat(rec.t / 0.025) * sat((duration - rec.t) / 0.18) * fade;
  const owner = rec.owner;
  // 弧面贴着地形走：每个采样点用自己脚下的地面高度。整片共用施放者的高度，
  // 在高低差地图上远处那一截会扎进坡里或浮在半空。
  const lift = (owner?.hover || 0) + (owner?._float || 0) + (owner?.lift || 0) + 0.52;
  const cam = fx.ctx.cam(), segments = 64;
  const depth = Math.min(radius * 0.65, 0.24 + p * 0.34);
  // All bands share one circular front. Only the rear boundary breaks into
  // flame tongues; the cutting edge stays thin, continuous and pointed.
  const bands = [
    { color: DEEP, alpha: 0.16, front: 0.03, back: 1.2, flame: 0.3 },
    { color: MID, alpha: 0.32, front: -0.02, back: 0.85, flame: 0.5 },
    { color: 0xffb347, alpha: 0.70, front: 0, back: 0.23, flame: 0.03 },
    { color: HOT, alpha: 0.98, front: 0.008, back: 0.045, flame: 0 },
  ];
  // 采样角度与地面高度一帧算一次，四条带共用；投影写进同一个临时对象，不再逐个 new。
  const samples = [], q = {};
  for (let k = 0; k <= segments; k++) {
    const u = k / segments, angle = facing + span * (u - 0.5);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const zx = rec.x + cos * radius, zy = rec.y + sin * radius;
    samples.push({ u, cos, sin, z: fx._groundZ(zx, zy) + lift });
  }
  g.lineStyle(0);
  for (const band of bands) {
    const rows = [];
    for (const sample of samples) {
      const taper = Math.pow(Math.sin(Math.PI * sample.u), 0.72);
      const flicker = 0.5 + 0.5 * Math.sin(sample.u * 47 - rec.t * 33)
        * Math.sin(sample.u * 19 + rec.t * 21);
      const outer = radius + band.front * taper;
      const inner = Math.max(0.03, radius - depth * (band.back + band.flame * flicker) * taper);
      const row = [];
      for (const r of [outer, inner]) {
        cam.project(rec.x + sample.cos * r, rec.y + sample.sin * r, sample.z, q);
        row.push(q.x, q.y);
      }
      rows.push(row);
    }
    g.beginFill(band.color, alpha * band.alpha);
    for (let k = 0; k < segments; k++) {
      const a = rows[k], b = rows[k + 1];
      g.drawPolygon([a[0], a[1], b[0], b[1], b[2], b[3], a[2], a[3]]);
    }
    g.endFill();
  }
}

export function setTalulaWave(fx, o) {
  if (!o) return;
  const axis = o.axis === 'row' ? 'row' : 'col', sign = Number(o.sign) < 0 ? -1 : 1;
  const at = Number(axis === 'col' ? o.x : o.y);
  if (!Number.isFinite(at)) return;
  // kit 现在带 waveId：新焰浪替换旧焰浪时，旧实例必须结束，不能两条同时画。
  const waveId = Number(o.waveId) || 0;
  if (waveId) {
    for (const old of [...fx.talulaWaves]) {
      if (old.waveId && old.waveId !== waveId) { freeTalulaWave(old); fx.talulaWaves.splice(fx.talulaWaves.indexOf(old), 1); }
    }
  }
  let w = fx.talulaWaves.find((v) => v.id === o.id && v.axis === axis && v.sign === sign);
  if (w) {
    // 机制报告的波前是唯一真相：直接对齐，不靠渲染侧推算。
    w.waveId = waveId || w.waveId;
    w.pos = at;
    w.to = at;
    w.since = 0;
    if (Number.isFinite(o.speed)) w.speed = Number(o.speed);
    return;
  }
  w = {
    id: o.id, waveId, axis, sign, pos: at, to: at, since: 0, age: 0, emit: 0,
    // speed 只用于「两帧之间补间」，不是独立推进时钟；推进量永远以 to 为上限。
    speed: Number.isFinite(o.speed) ? Number(o.speed) : 8,
    seed: talulaRandom(fx) * TAU,
    g: graphic(fx, fx.ctx.layers.fxAdd), wake: graphic(fx, fx.ctx.layers.groundFx, false),
    bands: [[], [], []], curl: [], trail: [], a: {}, b: {},
  };
  fx.talulaWaves.push(w);
  while (fx.talulaWaves.length > 3) freeTalulaWave(fx.talulaWaves.shift());
}

export function freeTalulaWave(w) { w.g.destroy(); w.wake.destroy(); }

function wavePoint(fx, w, cam, along, across, height, out) {
  const x = w.axis === 'col' ? along : across, y = w.axis === 'col' ? across : along;
  return cam.project(x, y, fx._groundZ(x, y) + height, out);
}

function filled(g, points, tint, alpha) {
  g.lineStyle(0);
  g.beginFill(tint, alpha); g.drawPolygon(points); g.endFill();
}

export function updateTalulaWaves(fx, dt) {
  const cam = fx.ctx.cam(), R = rectOf(fx), step = dt * fx._ts();
  const seg = fx.quality === 'low' || fx.load >= 2 ? 8 : 16;
  let write = 0;
  for (const w of fx.talulaWaves) {
    w.age += step; w.since += step;
    const along0 = w.axis === 'col' ? R.c0 : R.r0;
    const along1 = w.axis === 'col' ? R.c1 : R.r1;
    const across0 = (w.axis === 'col' ? R.r0 : R.c0) - 0.5;
    const across1 = (w.axis === 'col' ? R.r1 : R.c1) + 0.5;
    // 波前以机制报告的 `to` 为上限补间，绝不越过它自己往前推。
    // 旧实现按 since*8 预测到 `to + 0.5`，等于渲染侧自造速度，会和真实伤害位置错开。
    const gap = (w.to - w.pos) * w.sign;
    if (gap > 0) w.pos += w.sign * Math.min(Math.max(gap, 0), w.speed * step * 1.35, gap);
    if (w.since > 0.5 || (w.sign > 0 ? w.pos > along1 + 0.9 : w.pos < along0 - 0.9)) {
      freeTalulaWave(w); continue;
    }
    fx.talulaWaves[write++] = w;
    w.g.clear(); w.wake.clear();
    const fade = sat(w.age / 0.08) * (1 - sat((w.since - 0.2) / 0.3));
    const frame = Math.floor(w.age * 16) % 8;
    const body = talulaFrame('wall-body', frame), crest = talulaFrame('wall-crest', frame);
    if (body && crest) {
      const g = w.g, count = Math.ceil((across1 - across0) / 0.75);
      const pitch = (across1 - across0) / count, pixelHeight = 1.5 / 320;
      // 每个面片一份 Matrix：PIXI 7 的 fill style 会持有传入对象，
      // 共用一份会让先前画好的面片跟着最后一次 set 一起变，整面墙变成一个贴图变换。
      const newMatrix = () => new fx.P.Matrix();
      // Textured quads remain Graphics geometry: clear/free keep their existing
      // lifecycle, with no extra sprites surviving a wave replacement or clear.
      const quad = (texture, a, b, c, d, origin, ox, oy, tw, th) => {
        if (Math.abs(a * d - b * c) < 1e-8) return; // edge-on vertical plane
        const x = origin.x - ox * a - oy * c, y = origin.y - ox * b - oy * d;
        const matrix = newMatrix().set(a, b, c, d, x, y);
        g.beginTextureFill({ texture, matrix, alpha: fade * 0.78 });
        g.drawPolygon([x, y, x + a * tw, y + b * tw,
          x + a * tw + c * th, y + b * tw + d * th, x + c * th, y + d * th]);
        g.endFill();
      };
      g.blendMode = fx.P.BLEND_MODES.ADD;
      g.lineStyle(0);
      for (let k = 0; k < count; k++) {
        const across = across0 + (k + 0.5) * pitch;
        const base = wavePoint(fx, w, cam, w.pos, across, 0.03, {});
        const right = wavePoint(fx, w, cam, w.pos, across + pitch * 192 / 160, 0.03, {});
        const top = wavePoint(fx, w, cam, w.pos, across, 0.03 + pixelHeight * 320, {});
        const a = (right.x - base.x) / 192, b = (right.y - base.y) / 192;
        const c = (base.x - top.x) / 320, d = (base.y - top.y) / 320;
        quad(body, a, b, c, d, base, 96, 296, 192, 320);
        // The cap anchor is exactly body pixel (96,160). Its +X follows
        // propagation, so the asset's -X curl always bends behind the front.
        const socket = { x: base.x - c * 136, y: base.y - d * 136 };
        const height = 0.03 + pixelHeight * 136;
        const front = wavePoint(fx, w, cam, w.pos + w.sign * pixelHeight * 256, across, height, {});
        const origin = wavePoint(fx, w, cam, w.pos, across, height, {});
        const cross = wavePoint(fx, w, cam, w.pos, across + pitch, height, {});
        // Give the folded cap width along the wave as well as vertical height;
        // it stays readable when propagation points into the camera.
        quad(crest, (front.x - origin.x) / 256, (front.y - origin.y) / 256,
          c + (cross.x - origin.x) / 192, d + (cross.y - origin.y) / 192,
          socket, 128, 164, 256, 192);
      }
    } else {
      for (let layer = 0; layer < 3; layer++) {
        const pts = w.bands[layer]; pts.length = 0;
        for (let k = 0; k <= seg; k++) {
          const v = across0 + (across1 - across0) * k / seg;
          wavePoint(fx, w, cam, w.pos - w.sign * (0.55 - layer * 0.12), v, 0.03 + layer * 0.08, w.a);
          pts.push(w.a.x, w.a.y);
        }
        for (let k = seg; k >= 0; k--) {
          const v = across0 + (across1 - across0) * k / seg;
          const phase = w.age * 9 + v * 2.6 + w.seed;
          const height = (1.25 + Math.sin(phase) * 0.2 + Math.sin(phase * 1.7) * 0.08) * (1 - layer * 0.22);
          wavePoint(fx, w, cam, w.pos + w.sign * (0.08 + Math.sin(phase) * 0.09), v, height, w.a);
          pts.push(w.a.x, w.a.y);
        }
        filled(w.g, pts, [DEEP, MID, HOT][layer], [0.22, 0.28, 0.34][layer] * fade);
      }
      // The original Graphics cap is retained when either atlas is unavailable.
      w.curl.length = 0;
      for (let side = 0; side < 2; side++) for (let j = 0; j <= seg; j++) {
        const k = side ? seg - j : j, v = across0 + (across1 - across0) * k / seg;
        const phase = w.age * 9 + v * 2.6 + w.seed;
        const h = 1.25 + Math.sin(phase) * 0.2 + Math.sin(phase * 1.7) * 0.08;
        wavePoint(fx, w, cam, w.pos + w.sign * (side ? 0.3 : 0.04), v, h - (side ? 0.24 : 0), w.a);
        w.curl.push(w.a.x, w.a.y);
      }
      filled(w.g, w.curl, MID, 0.36 * fade);
    }
    // The dark ember bed trails on the movement axis, for all four axis/sign combinations.
    w.trail.length = 0;
    for (let side = 0; side < 2; side++) for (let j = 0; j <= seg; j++) {
      const k = side ? seg - j : j, v = across0 + (across1 - across0) * k / seg;
      wavePoint(fx, w, cam, w.pos - w.sign * (side ? 0.18 : 0.95), v, 0.025, w.a);
      w.trail.push(w.a.x, w.a.y);
    }
    filled(w.wake, w.trail, 0x572316, fade * 0.28);
    w.emit += dt;
    if (!fx.rich || w.emit < 0.09 || !fx._room()) continue;
    w.emit = 0;
    for (let i = 0; i < 4; i++) {
      const v = across0 + (across1 - across0) * talulaRandom(fx);
      wavePoint(fx, w, cam, w.pos - w.sign * (0.3 + talulaRandom(fx) * 0.5), v, 0.2, w.a);
      if (!visible(fx, w.a)) continue;
      wavePoint(fx, w, cam, w.pos - w.sign * 0.8, v, 0.7, w.b);
      fx.particle('spark', w.a.x, w.a.y, {
        tint: i & 1 ? MID : HOT, life: 0.3,
        vx: (w.b.x - w.a.x) * 0.65, vy: (w.b.y - w.a.y) * 0.65,
        s0: w.a.s / 64 * 0.16, s1: 0, a0: fade * 0.7, a1: 0,
      });
    }
  }
  fx.talulaWaves.length = write;
}

export function setTalulaFire(fx, o) {
  if (!o) return;
  const r = Math.round(Number(o.r)), c = Math.round(Number(o.c));
  if (!Number.isFinite(r) || !Number.isFinite(c)) return;
  const R = rectOf(fx);
  if (r < R.r0 || r > R.r1 || c < R.c0 || c > R.c1) return;
  const dur = Number.isFinite(Number(o.dur)) ? Math.max(0, Number(o.dur)) : 6;
  if (!dur) return;
  const key = `${r}:${c}`, old = fx.talulaFires.find((v) => v.key === key);
  if (old) { old.dur = Math.max(old.dur, old.t + dur); return; }
  if (fx.talulaFires.length >= 48) releaseTalulaFire(fx, fx.talulaFires.shift());
  const rec = fx.talulaFireFree.pop() || {
    g: graphic(fx, fx.ctx.layers.groundFx, false), clip: graphic(fx, fx.ctx.layers.groundFx, false),
    tile: [], patches: [[], []], tongues: [[], [], [], [], [], [], [], []], q: {},
  };
  Object.assign(rec, { key, r, c, t: 0, dur, seed: talulaRandom(fx) * TAU });
  rec.g.mask = rec.clip; rec.g.visible = true; rec.clip.visible = true;
  // 图集 sprite：与 Graphics 版并存，谁有内容谁显示（图集未就绪时 sprite 不可见）。
  if (!rec.sprite && fx.talulaSpritePool) {
    const spr = new fx.P.Sprite(fx.P.Texture.WHITE);
    spr.anchor.set(0.5, 0.5);
    spr.visible = false;
    spr.blendMode = fx.P.BLEND_MODES.ADD;
    fx.ctx.layers.groundFx.addChild(spr);
    rec.sprite = spr;
  }
  const z = fx._groundZ(c, r);
  fx._onGround(rec.g, r, z); fx._onGround(rec.clip, r, z);
  fx.talulaFires.push(rec);
}

function releaseTalulaFire(fx, rec) {
  rec.g.clear(); rec.clip.clear(); rec.g.visible = false; rec.clip.visible = false;
  if (rec.sprite) rec.sprite.visible = false;
  fx.talulaFireFree.push(rec);
}

export function updateTalulaFires(fx, dt) {
  const cam = fx.ctx.cam(), step = dt * fx._ts();
  const low = fx.quality === 'low' || fx.load >= 2;
  let write = 0;
  for (const f of fx.talulaFires) {
    f.t += step;
    if (f.t >= f.dur) { releaseTalulaFire(fx, f); continue; }
    fx.talulaFires[write++] = f;
    const z = fx._groundZ(f.c, f.r) + 0.025;
    cam.project(f.c, f.r, z, f.q);
    f.g.visible = visible(fx, f.q, f.q.s * 0.65);
    if (!f.g.visible) continue;
    f.g.clear(); f.clip.clear(); f.tile.length = 0;

    // 有图集就用图集的火舌簇帧；没有（或加载失败）再退回 Graphics 画法。
    const tex = talulaFrame('ground-tongues', 0, f.t * 1000 + f.seed * 100);
    if (tex && f.sprite) {
      const s = f.q.s;
      f.sprite.visible = true;
      f.sprite.texture = tex;
      f.sprite.x = f.q.x; f.sprite.y = f.q.y - s * 0.30;
      f.sprite.width = s * 0.92; f.sprite.height = s * 0.92;
      f.sprite.alpha = Math.min(sat(f.t / 0.16), sat((f.dur - f.t) / 0.4));
      continue;
    }
    if (f.sprite) f.sprite.visible = false;
    // The entire fire, including its tongues, is clipped inside this inset tile polygon.
    for (const [dx, dy] of [[-0.46, -0.46], [0.46, -0.46], [0.46, 0.46], [-0.46, 0.46]]) {
      cam.project(f.c + dx, f.r + dy, z, f.q); f.tile.push(f.q.x, f.q.y);
    }
    filled(f.clip, f.tile, 0xffffff, 1);
    const fade = Math.min(sat(f.t / 0.16), sat((f.dur - f.t) / 0.4));

    // 炭底：不规则多边形 + 一层更暗的内圈，不用正圆。
    for (let layer = 0; layer < 2; layer++) {
      const pts = f.patches[layer]; pts.length = 0;
      for (let i = 0; i < 10; i++) {
        const a = i * TAU / 10;
        const radius = (0.40 - layer * 0.12) * (1 + Math.sin(a * 3 + f.seed + f.t * 2.2) * 0.11);
        cam.project(f.c + Math.cos(a) * radius, f.r + Math.sin(a) * radius, z, f.q);
        pts.push(f.q.x, f.q.y);
      }
      filled(f.g, pts, [0x241612, DEEP][layer], [0.66, 0.34][layer] * fade);
    }

    // 火舌簇：3–4 个独立火舌尖，各自错相位抖动，向上舔。
    // 策划案要求「一小簇向上舔的火舌」而不是圆形火斑。
    const tongues = low ? 3 : 4;
    for (let i = 0; i < tongues; i++) {
      const a = f.seed + i * 1.9;
      const dx = Math.cos(a) * 0.15, dy = Math.sin(a) * 0.15;
      const x = f.c + dx, y = f.r + dy;
      // 每个舌尖自己的相位与高度
      const ph = f.t * (7.5 + i * 0.9) + a;
      const h = 0.10 + 0.13 * (0.5 + 0.5 * Math.sin(ph));
      const sway = Math.sin(f.t * 5.5 + a) * 0.035;
      const halfBase = 0.052 - i * 0.004;
      const pts = f.tongues[i]; pts.length = 0;
      // 三角火舌：底边两点 + 尖端
      cam.project(x - halfBase, y, z, f.q); pts.push(f.q.x, f.q.y);
      cam.project(x + halfBase, y, z, f.q); pts.push(f.q.x, f.q.y);
      cam.project(x + sway, y - 0.02, z + h, f.q); pts.push(f.q.x, f.q.y);
      // 内芯更亮更短
      filled(f.g, pts, i % 2 ? MID : DEEP, fade * 0.55);
      const pts2 = f.tongues[tongues + i]; pts2.length = 0;
      cam.project(x - halfBase * 0.42, y, z, f.q); pts2.push(f.q.x, f.q.y);
      cam.project(x + halfBase * 0.42, y, z, f.q); pts2.push(f.q.x, f.q.y);
      cam.project(x + sway * 0.6, y - 0.015, z + h * 0.62, f.q); pts2.push(f.q.x, f.q.y);
      filled(f.g, pts2, HOT, fade * 0.62);
    }
  }
  fx.talulaFires.length = write;
}

export function clearTalulaBattle(fx) {
  for (const rec of [...fx.talulaQi, ...fx.talulaQiFree]) { rec.g.destroy(); rec.back?.destroy(); }
  fx.talulaQi.length = 0; fx.talulaQiFree.length = 0;
  for (const w of fx.talulaWaves) freeTalulaWave(w);
  fx.talulaWaves.length = 0;
  for (const f of [...fx.talulaFires, ...fx.talulaFireFree]) {
    f.g.mask = null; f.g.destroy(); f.clip.destroy();
  }
  fx.talulaFires.length = 0; fx.talulaFireFree.length = 0;
}
