// Bounded hit feedback; damage numbers and hit flashes remain owned by FxNumbers.
import { talulaFrame } from './talula-textures.js';

const TAU = Math.PI * 2;
const sat = (v) => Math.max(0, Math.min(1, v));
const HOT = 0xffe9a8, FIRE = 0xff8a3d;
const HIT_FPS = 60, HIT_DURATION = 6 / HIT_FPS;

function releaseFeedback(fx, rec) {
  rec.view = null;
  if (rec.sprite) rec.sprite.visible = false;
  if (rec.burstSprite) rec.burstSprite.visible = false;
  fx.talulaFeedbackFree.push(rec);
}

function drawHitSlash(fx, rec) {
  const texture = talulaFrame('hit-slash', Math.floor(rec.t * HIT_FPS));
  if (!texture) return false;
  if (!rec.sprite) {
    rec.sprite = new fx.P.Sprite(texture);
    rec.sprite.anchor.set(0.5, 0.5);
    rec.sprite.blendMode = fx.P.BLEND_MODES.ADD;
    fx.ctx.layers.fxAdd.addChild(rec.sprite);
  }
  const sprite = rec.sprite;
  sprite.texture = texture;
  sprite.position.set(rec.q.x, rec.q.y);
  sprite.width = sprite.height = rec.q.s * 0.75;
  sprite.visible = true;
  return true;
}

/**
 * 延迟爆燃：真实命中后 0.06 游戏秒才出现，向上裂解。
 *
 * 时间线表要求它替换掉原来的圆形绽放——圆形冲击波是策划案明确禁止的。
 * 图集缺失时返回 false，调用方退回原有 Graphics 画法。
 */
function drawDelayedBurst(fx, rec, x, y, s) {
  const delay = 0.06;
  const local = rec.t - delay;
  if (local < 0) return false;
  const texture = talulaFrame('delayed-burst', Math.floor(local * 24));
  if (!texture) return false;
  if (!rec.burstSprite) {
    rec.burstSprite = new fx.P.Sprite(texture);
    rec.burstSprite.anchor.set(0.5, 0.5);
    rec.burstSprite.blendMode = fx.P.BLEND_MODES.ADD;
    fx.ctx.layers.fxAdd.addChild(rec.burstSprite);
  }
  const spr = rec.burstSprite;
  spr.texture = texture;
  spr.position.set(x, y);
  spr.width = spr.height = s * 0.8;
  spr.alpha = Math.max(0, 1 - local / 0.4);
  spr.visible = true;
  return true;
}

export function initTalulaFeedback(fx) {
  fx.talulaFeedback = [];
  fx.talulaFeedbackFree = [];
  fx.talulaFeedbackClock = 0;
  fx.talulaFeedbackInk = null;
  fx.talulaFeedbackAsh = null;
}

function ink(fx) {
  if (fx.talulaFeedbackInk) return;
  fx.talulaFeedbackInk = new fx.P.Graphics();
  fx.talulaFeedbackInk.blendMode = fx.P.BLEND_MODES.ADD;
  fx.ctx.layers.fxAdd.addChild(fx.talulaFeedbackInk);
  fx.talulaFeedbackAsh = new fx.P.Graphics();
  fx.ctx.layers.groundFx.addChild(fx.talulaFeedbackAsh);
}

export function spawnTalulaFeedback(fx, kind, at, ex = {}) {
  const view = at.v, q = fx.ctx.cam().project(at.x, at.y, at.z + 0.45, {});
  const size = fx.ctx.screenSize?.();
  if (view?.culled || (size && (q.x < -q.s || q.x > size.width + q.s || q.y < -q.s || q.y > size.height + q.s))) return;
  // Collapse repeated on-hit layers on one victim, without joining distinct victims.
  const key = view?.id ?? ex.id;
  if (key != null) for (const rec of fx.talulaFeedback) {
    if (rec.key === key && rec.kind === kind && fx.talulaFeedbackClock - rec.born < 0.055) return;
  }
  const cap = fx.quality === 'low' || fx.load >= 2 ? 64 : 128;
  if (fx.talulaFeedback.length >= cap) {
    if (kind !== 'burst') return;
    const replace = fx.talulaFeedback.findIndex((v) => v.kind !== 'burst');
    if (replace < 0) return;
    releaseFeedback(fx, fx.talulaFeedback.splice(replace, 1)[0]);
  }
  ink(fx);
  const rec = fx.talulaFeedbackFree.pop() || { q: {}, ground: {} };
  const dx = at.x - (Number.isFinite(ex.sx) ? ex.sx : at.x - 1);
  const dy = at.y - (Number.isFinite(ex.sy) ? ex.sy : at.y);
  Object.assign(rec, {
    kind, key, view: kind === 'burst' ? null : view, x: at.x, y: at.y, z: at.z,
    t: 0, born: fx.talulaFeedbackClock, angle: Math.atan2(-dy * 0.6 - 0.6, dx || 0.001),
    end: kind === 'burst' ? 0.95 : kind === 'phys' ? HIT_DURATION : 0.3,
  });
  if (rec.sprite) rec.sprite.visible = false;
  // The real hit shows frame 00 immediately; animation time only advances in update.
  if (kind === 'phys') {
    Object.assign(rec.q, q);
    drawHitSlash(fx, rec);
  }
  fx.talulaFeedback.push(rec);
}

export function talulaDamageFeedback(fx, view, amount, type, source) {
  if (!(amount > 0) || !source?.entry?.anims?.swing?.talula || (type !== 'phys' && type !== 'arts')) return false;
  spawnTalulaFeedback(fx, type, {
    x: view.x, y: view.y, z: (view.z || 0) + (view.hover || 0) + (view._float || 0), v: view,
  }, { sx: source.x, sy: source.y });
  return true;
}

function line(g, x0, y0, x1, y1, width, tint, alpha) {
  g.lineStyle(Math.max(1, width), tint, alpha);
  g.moveTo(x0, y0); g.lineTo(x1, y1);
}

export function updateTalulaFeedback(fx, dt) {
  const step = dt * fx._ts();
  fx.talulaFeedbackClock += step;
  if (!fx.talulaFeedbackInk) return;
  const cam = fx.ctx.cam(), g = fx.talulaFeedbackInk, ash = fx.talulaFeedbackAsh;
  const size = fx.ctx.screenSize?.();
  g.clear(); ash.clear();
  let write = 0;
  for (const rec of fx.talulaFeedback) {
    rec.t += step;
    if (rec.t >= rec.end) { releaseFeedback(fx, rec); continue; }
    fx.talulaFeedback[write++] = rec;
    const v = rec.view;
    if (v && !v.destroyed) {
      rec.x = v.x; rec.y = v.y; rec.z = (v.z || 0) + (v.hover || 0) + (v._float || 0);
    }
    cam.project(rec.x, rec.y, rec.z + 0.45, rec.q);
    const { x, y, s } = rec.q;
    if (rec.sprite) rec.sprite.visible = false;
    if (size && (x < -s || x > size.width + s || y < -s || y > size.height + s)) continue;
    const u = sat(rec.t / rec.end), fade = 1 - u;
    if (rec.kind === 'phys') {
      if (drawHitSlash(fx, rec)) continue;
      // A short warm-white cut with two sharp fragments, without a circular bloom.
      const a = rec.angle, length = s * (0.18 + u * 0.26);
      const dx = Math.cos(a) * length, dy = Math.sin(a) * length;
      line(g, x - dx, y - dy, x + dx, y + dy, s * 0.042, 0xffd6a0, fade * 0.28);
      line(g, x - dx, y - dy, x + dx, y + dy, s * 0.016, 0xfff1d6, fade);
      for (const sign of [-1, 1]) {
        const b = a + sign * 0.9, r = s * (0.07 + u * 0.22);
        line(g, x + Math.cos(b) * r, y + Math.sin(b) * r,
          x + Math.cos(b) * (r + s * 0.06), y + Math.sin(b) * (r + s * 0.06), s * 0.014, HOT, fade);
      }
    } else if (rec.kind === 'arts' || rec.kind === 'mark') {
      // A violet angular seal with an orange core distinguishes arts from the cut.
      const radius = s * (0.1 + u * 0.22);
      g.lineStyle(Math.max(1, s * 0.019), rec.kind === 'mark' ? FIRE : 0xd5a5ff, fade * 0.8);
      for (let i = 0; i <= 4; i++) {
        const a = i * TAU / 4 + Math.PI / 4, px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius;
        if (!i) g.moveTo(px, py); else g.lineTo(px, py);
      }
      line(g, x - s * 0.045, y, x + s * 0.045, y, s * 0.035, HOT, fade);
      line(g, x, y - s * 0.045, x, y + s * 0.045, s * 0.025, FIRE, fade);
    } else {
      if (drawDelayedBurst(fx, rec, x, y, s)) continue;
      const bloom = sat(rec.t / 0.16), energy = 1 - sat(rec.t / 0.28);
      if (energy > 0) {
        for (let i = 0; i < 8; i++) {
          const a = i * TAU / 8 + 0.2, r0 = s * bloom * 0.1, r1 = s * (0.1 + bloom * 0.48);
          line(g, x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.75,
            x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.75,
            s * 0.032, i & 1 ? FIRE : HOT, energy);
        }
      }
      cam.project(rec.x, rec.y, fx._groundZ(rec.x, rec.y) + 0.025, rec.ground);
      const ground = rec.ground, r = ground.s * (0.19 + bloom * 0.18);
      // Three dark fissures and their fading hot edges remain after the burst.
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3 + 0.3;
        const px = ground.x + Math.cos(a) * r, py = ground.y + Math.sin(a) * r * 0.45;
        line(ash, ground.x, ground.y, px, py, ground.s * 0.065, 0x321c16, fade * 0.55);
        line(g, ground.x, ground.y, px, py, ground.s * 0.014, FIRE, fade * 0.35);
      }
    }
  }
  fx.talulaFeedback.length = write;
}

export function clearTalulaFeedback(fx) {
  for (const rec of [...fx.talulaFeedback, ...fx.talulaFeedbackFree]) {
    rec.view = null;
    rec.sprite?.destroy();
  }
  fx.talulaFeedback.length = 0; fx.talulaFeedbackFree.length = 0;
  fx.talulaFeedbackClock = 0;
  fx.talulaFeedbackInk?.destroy(); fx.talulaFeedbackAsh?.destroy();
  fx.talulaFeedbackInk = null; fx.talulaFeedbackAsh = null;
}
