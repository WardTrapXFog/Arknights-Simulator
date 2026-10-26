// public/js/render/fx/talula.js — 塔露拉（自设干员 char_1503_talula）三个技能的专属视觉。
//
// 图集帧负责火焰，随剑几何负责刀光，粒子补充余烬。
//
//   S1 薪火裁决：烈焰刀光沿实挥剑路展开，目标处爆燃。
//   S2 炽翼掠火：背后展开图集火翼，每目标独立剑气飞向捕获的终点。
//   S3 恶火重燃 —— 「浪」。持续 30 秒：圆弧剑气从她自身向前扩散，竖直火墙（wall-body + wall-crest
//                  图集）从她身后横推过整张地图，推进过的地块留下【恶火】地面火斑。
//
// 这三个 fx kind 由 server/sim/content/kits/ops/chess_char_5_99-talula.js 的 battle.fx 发出：
//   talulaIgnite  → S1 开技音频锚点，不绘制掌心火光
//   talulaWing    → S2 开启 / 关闭（携带 on:true|false 与时长）
//   talulaTakeoff → S2 / S3 起飞（小尺寸火弧渐显、收束）
//   talulaLand    → 技能结束时落地（火环收束 + 扬尘）
//   talulaEmpower → 天赋 1 的 20% 攻击力提升（刀身火弧）
//   talulaQiSlash → S2 的独立剑气（发射、拖尾、抵达爆点、余焰）
//   talulaWave    → S3 的焰浪前端（携带 axis / sign）
//   talulaFire    → 【恶火】地块（携带 r,c，持续 dur 秒，逐帧续烧）
//   scorch        → 焚尽（天赋 2）的施加瞬间（烙在目标身上的焦痕环）

import { clamp } from './limits.js';
import { GEO } from '../../../../shared/constants.js';
import { talulaRandom, startTalulaMotion, clearTalulaMotion, talulaCasting } from './talula-animation.js';
import { ensureTalulaTextures, talulaFrame, disposeTalulaTextures } from './talula-textures.js';
import { drawTalulaCrescent, drawTalulaBladeTrail, drawTalulaIgnition, takeTalulaSlash } from './talula-slash.js';
import {
  spawnTalulaQi, updateTalulaQi, drawTalulaRing, prepareTalulaRange,
  setTalulaWave, freeTalulaWave, updateTalulaWaves,
  setTalulaFire, updateTalulaFires, clearTalulaBattle,
} from './talula-battle.js';
import {
  initTalulaFeedback, spawnTalulaFeedback, talulaDamageFeedback,
  updateTalulaFeedback, clearTalulaFeedback,
} from './talula-feedback.js';
import { TalulaAudioAnchors } from './talula-audio.js';

const num = (v, d) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };

/** 塔露拉素材自带的刀痕插槽（灰色大片扇面），用自定义刀光时必须屏蔽。 */
const TALULA_NATIVE_SLASH_SLOTS = Object.freeze(['F_R_Weapon_E']);

const FIRE_HOT = 0xffe9a8;   // 火心
const FIRE_MID = 0xff8a3d;   // 主色
const FIRE_DEEP = 0xc23a12;  // 暗部 / 烟
const EMBER = 0xffb347;
const ASH = 0x2a201a;        // 暗烟

/** 四向朝向 → 单位向量（与 server/sim/grid.js FOUR_WAYS 同号：UP 为行 +1）。 */
const DIRV = { RIGHT: [1, 0], LEFT: [-1, 0], UP: [0, 1], DOWN: [0, -1] };

/** 塔露拉专用特效：挂在 FxSystem 原型上（与其它 fx/*.js 同样的「方法容器」写法）。 */
export class FxTalula {
  talulaDamageFeedback(view, amount, type, source) {
    return talulaDamageFeedback(this, view, amount, type, source);
  }

  talulaAudioEvent(event) {
    // Audio is optional and must never interrupt the renderer or simulation.
    try { this.talulaAudio.event(event); } catch { /* optional audio */ }
  }

  /** Each event owns one effect; travelling blades capture their endpoints once. */
  talulaBlade(kind, at, ex) {
    const owner = at.v;
    // S1 holds its casting pose even though its instant skill flag is already off.
    if (owner?.actor && talulaCasting(owner.actor)) return;
    if (owner?.entry?.turnToTarget && ex.interval > 0) {
      owner.atkInterval = ex.interval;
      // The sim supplies the real interval, including skill/buff changes. The
      // generic atk event only has an estimated interval and precedes this fx.
      if (owner.actor?.mode === 'attack' && owner.actor.current === owner.entry.anims?.swing?.clip
        && Math.abs(owner.actor.interval - ex.interval) > 1e-6) owner.actor.attack(ex.interval);
    }
    if (kind === 'talulaQiSlash') { spawnTalulaQi(this, at, ex); return; }
    if (kind === 'talulaSlash') {
      const current = this.talulaSlashes.find((it) => it.kind === kind && it.owner === owner && it.t < 0.04);
      if (current && (current.fiery || ex.s1)) { current.fiery = true; return; }
    }
    const rec = takeTalulaSlash(this);
    const dx = num(ex.tx, at.x + 1) - at.x, dy = num(ex.ty, at.y) - at.y;
    const distance = Math.hypot(dx, dy), dir = DIRV[ex.dir] || DIRV.RIGHT;
    const target = this._viewOf(ex.target);
    Object.assign(rec, { kind, owner, x: at.x, y: at.y, tx: num(ex.tx, at.x + dir[0]), ty: num(ex.ty, at.y + dir[1]),
      ux: distance > 0.01 ? dx / distance : dir[0], uy: distance > 0.01 ? dy / distance : dir[1],
      z: at.z + 0.45, tz: target ? (target.z || 0) + (target.hover || 0) + 0.45 : this._groundZ(num(ex.tx, at.x), num(ex.ty, at.y)) + 0.45,
      t: 0, end: kind === 'talulaSlash' ? Math.max(0.24, num(ex.interval, 1.2) * 0.15 + 0.12)
        : kind === 'talulaRingSlash' ? 0.6 / 1.3 : 0.6,
      previous: null, struck: false, edges: [], trail: [], fiery: !!ex.s1 });
    if (kind === 'talulaRingSlash') {
      prepareTalulaRange(rec, ex.rangeKeys || [], dir);
    }
    if (kind === 'talulaSlash') drawTalulaBladeTrail(this, rec, 1);
    this.talulaSlashes.push(rec);
  }

  _updateTalulaSlashes(dt) {
    const list = this.talulaSlashes;
    let write = 0;
    for (const rec of list) {
      rec.t += dt * this._ts();
      if (rec.t >= rec.end || rec.owner?.destroyed || rec.owner?.alive === false) {
        rec.g.clear(); rec.g.visible = false; rec.owner = null;
        if (rec.back) { rec.back.clear(); rec.back.visible = false; }
        this.talulaSlashFree.push(rec);
        continue;
      }
      const g = rec.g, fade = Math.min(1, (rec.end - rec.t) / 0.15);
      g.clear();
      if (rec.kind === 'talulaSlash') {
        drawTalulaBladeTrail(this, rec, fade);
      }
      else if (rec.kind === 'talulaEmpower') {
        drawTalulaIgnition(this, rec);
      }
      else if (rec.kind === 'talulaTakeoff') {
        const u = clamp(rec.t / 0.3, 0, 1), settle = clamp((rec.t - 0.46) / 0.36, 0, 1);
        const grow = u * u * (3 - 2 * u), shrink = settle * settle * (3 - 2 * settle);
        const alpha = grow * (1 - shrink) * 0.45;
        for (const side of [-1, 1]) drawTalulaCrescent(this, rec, {
          x: rec.owner.x, y: rec.owner.y, z: this._groundZ(rec.owner.x, rec.owner.y) + 0.04,
          start: side < 0 ? 0.12 * Math.PI : 1.12 * Math.PI, span: 0.76 * Math.PI,
          radius: 0.24 + grow * 0.44 - shrink * 0.22, thickness: 0.065 * grow * (1 - shrink),
          ax: 1, ay: 0, bx: 0, by: 1, alpha,
        });
      }
      else {
        // S3 圆弧剑气：从角色自身向外扩散，锐利前刃后方拖出烈焰尾气。
        drawTalulaRing(this, rec, fade);
      }
      list[write++] = rec;
    }
    list.length = write;
  }

  // ---- 公用小件 -------------------------------------------------------------------------------------------

  /** 在 (x, y) 的地面高度上画一圈从 r0 涨到 r1 的环。 */
  _tRing(x, y, r0, r1, tint, dur, tex = 'ring', mode = null) {
    const z = this._groundZ(x, y);
    this.ring(x, y, z, r0, r1, tint, dur, tex, mode);
  }

  /** 一簇向上窜的火苗（世界坐标 (x,y) 处，n 颗，scale 是体量倍数）。 */
  _tFlameUp(x, y, n, scale = 1) {
    const z = this._groundZ(x, y);
    const cam = this.ctx.cam();
    const q = this._q;
    for (let i = 0; i < n; i++) {
      const a = talulaRandom(this) * Math.PI * 2;
      const rad = talulaRandom(this) * 0.42 * scale;
      cam.project(x + Math.cos(a) * rad, y + Math.sin(a) * rad, z + 0.05, q);
      const hot = talulaRandom(this) < 0.34;
      this.particle(hot ? 'glow' : 'dot', q.x, q.y, {
        tint: hot ? FIRE_HOT : talulaRandom(this) < 0.5 ? FIRE_MID : FIRE_DEEP,
        vx: (talulaRandom(this) - 0.5) * q.s * 0.5,
        vy: -q.s * (1.1 + talulaRandom(this) * 1.3),
        drag: 1.6, g: -q.s * 0.25,
        life: 0.42 + talulaRandom(this) * 0.45,
        s0: (q.s / 48) * (0.2 + talulaRandom(this) * 0.16) * scale,
        s1: 0,
        a0: 0.95, a1: 0, fadeIn: 0.06,
      });
    }
  }

  /** 一撮飘起来的余烬（比火苗慢、比它亮）。 */
  _tEmbers(x, y, n, spread = 0.6, z0 = 0) {
    const z = this._groundZ(x, y) + z0;
    const cam = this.ctx.cam();
    const q = this._q;
    for (let i = 0; i < n; i++) {
      cam.project(x + (talulaRandom(this) - 0.5) * spread, y + (talulaRandom(this) - 0.5) * spread, z + 0.1 + talulaRandom(this) * 0.3, q);
      this.particle('spark', q.x, q.y, {
        tint: EMBER,
        vx: (talulaRandom(this) - 0.5) * q.s * 0.35,
        vy: -q.s * (0.5 + talulaRandom(this) * 0.8),
        life: 0.7 + talulaRandom(this) * 0.6,
        s0: (q.s / 64) * 0.24, s1: 0,
        a0: 1, a1: 0, fadeIn: 0.1, rot: talulaRandom(this) * Math.PI,
      });
    }
  }

  /** 一团暗烟（normal 混合，用来给火压出厚度）。 */
  _tSmoke(x, y, n = 3, z0 = 0.1, tint = ASH) {
    const z = this._groundZ(x, y) + z0;
    const cam = this.ctx.cam();
    const q = this._q;
    for (let i = 0; i < n; i++) {
      cam.project(x + (talulaRandom(this) - 0.5) * 0.5, y + (talulaRandom(this) - 0.5) * 0.5, z, q);
      this.particle('smoke', q.x, q.y, {
        add: false, tint,
        vx: (talulaRandom(this) - 0.5) * q.s * 0.25, vy: -q.s * 0.22,
        life: 0.8 + talulaRandom(this) * 0.5,
        s0: (q.s * 0.22) / 128, s1: (q.s * 0.62) / 128,
        a0: 0.3, a1: 0, rot: talulaRandom(this) * 6, spin: (talulaRandom(this) - 0.5) * 1.4,
      });
    }
  }

  // ---- S1 薪火裁决：烈焰斩击与目标爆燃 ----

  talulaS1(x, y, sx, sy, view = null, src = null) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const srcView = src != null ? this._viewOf(src) : null;
    if (srcView) this.talulaBlade('talulaSlash', {
      v: srcView, x: srcView.x, y: srcView.y, z: srcView.z || 0,
    }, { s1: true, target: view?.id, tx: x, ty: y, interval: srcView.atkInterval });
    const g = new this.P.Graphics();
    g.blendMode = this.P.BLEND_MODES.ADD;
    this.ctx.layers.fxAdd.addChild(g);
    this.talulaS1Fx.push({
      g, x, y, view,
      t: 0, end: 0.55 + 15 / 30, scale: 1.2, ember: 0, seed: talulaRandom(this) * Math.PI * 2,
    });
  }

  _updateTalulaS1(dt) {
    const list = this.talulaS1Fx;
    if (!list.length) return;
    const cam = this.ctx.cam(), p = this._p;
    let write = 0;
    for (const rec of list) {
      rec.t += dt * this._ts();
      const g = rec.g;
      g.clear();
      if (rec.t >= rec.end) {
        if (rec.sprites) for (const spr of Object.values(rec.sprites)) { try { spr.destroy(); } catch { /* gone */ } }
        g.destroy(); continue;
      }
      const v = rec.view;
      if (v && !v.destroyed && v.alive !== false) {
        rec.x = v.x; rec.y = v.y;
      }
      const body = v ? (v.z || 0) + (v.hover || 0) + (v._float || 0) + (v.lift || 0) : this._groundZ(rec.x, rec.y);
      const head = cam.project(rec.x, rec.y, body + 0.55, rec.q || (rec.q = {}));
      // 命中时立即在目标处爆燃，不再从手掌发射火线。
      const grow = clamp(rec.t / 0.1, 0, 1);
      const fade = 1 - clamp((rec.t - 0.45) / (rec.end - 0.45), 0, 1);
      // 火柱：优先 fire-column 图集（白心橙边，锚在目标地面）；缺失时退回下面的 Graphics。
      const colSpr = fade > 0 ? this._atlasSprite(rec, 'column', 'fire-column') : null;
      let columnDrawn = false;
      if (colSpr) {
        const cb = cam.project(rec.x, rec.y, body - 0.05, rec.bc || (rec.bc = {}));
        // Eight frames over 1.0 game second, followed by the final 0.05s fade.
        // Pass an explicit frame: the shared helper's legacy ms value is per-frame.
        const texture = talulaFrame('fire-column', Math.min(7, Math.floor(rec.t * 8)));
        if (texture) {
          colSpr.texture = texture;
          colSpr.anchor.set(0.5, 1);
          colSpr.position.set(cb.x, cb.y);
          colSpr.width = cb.s * 0.62 * rec.scale;
          colSpr.height = cb.s * 1.25 * rec.scale;
          colSpr.alpha = Math.max(0, fade);
          colSpr.visible = true;
          columnDrawn = true;
        }
      }
      if (!columnDrawn && fade > 0) {
        const base = cam.project(rec.x, rec.y, body - 0.05, rec.b || (rec.b = {}));
        const s = base.s * rec.scale;
        const cols = [[0.20, 0.34], [0.12, 0.42], [0.05, 0.5]];
        for (let k = 0; k < 3; k++) {
          const w0 = s * cols[k][0] * grow, h = s * cols[k][1] * grow;
          const wob = Math.sin(rec.seed + rec.t * 11 + k) * s * 0.02;
          g.beginFill([FIRE_DEEP, FIRE_MID, FIRE_HOT][k], fade * [0.5, 0.55, 0.8][k]);
          g.drawPolygon([
            base.x - w0, base.y, base.x + w0, base.y,
            base.x + w0 * 0.35 + wob, base.y - h * 0.62,
            base.x + wob * 1.6, base.y - h,
            base.x - w0 * 0.4 + wob, base.y - h * 0.58,
          ]);
          g.endFill();
        }
      }
      // 余烬：优先 embers 图集（每组三颗），未就绪才退回粒子。
      const emberSpr = rec.t > 0.2 && rec.t < 0.62 ? this._atlasSprite(rec, 'embers', 'embers') : null;
      if (emberSpr) {
        const eb = cam.project(rec.x, rec.y, body - 0.03, rec.be || (rec.be = {}));
        this._setAtlasFrame(emberSpr, 'embers', Math.max(0, rec.t - 0.2),
          eb.x, eb.y, eb.s * 0.5, eb.s * 0.5,
          (1 - clamp((rec.t - 0.2) / 0.42, 0, 1)) * 0.9, 1);
      } else if (rec.sprites?.embers) rec.sprites.embers.visible = false;
      rec.ember += dt;
      if (!emberSpr && rec.ember >= 0.055 && rec.t < 0.4) {
        rec.ember = 0;
        for (let n = 0; n < 3; n++) {
          const a = rec.seed + n * 2.1;
          this.particle('spark', head.x + Math.cos(a) * head.s * 0.12, head.y + Math.sin(a) * head.s * 0.1, {
            tint: n & 1 ? FIRE_HOT : EMBER,
            vx: Math.cos(a) * head.s * 0.18, vy: -head.s * (0.5 + talulaRandom(this) * 0.7),
            life: 0.32 + talulaRandom(this) * 0.3, s0: (head.s / 64) * 0.16, s1: 0, a0: 0.85, a1: 0, fadeIn: 0.05,
          });
        }
      }
      // 烟：火焰余势，普通混合，从目标地面向上漂散。
      const smokeSpr = rec.t > 0.25 ? this._atlasSprite(rec, 'smoke', 'smoke', 'normal') : null;
      if (smokeSpr) {
        const sb = cam.project(rec.x, rec.y, body - 0.05, rec.bs || (rec.bs = {}));
        const t5 = Math.max(0, rec.t - 0.25);
        this._setAtlasFrame(smokeSpr, 'smoke', t5,
          sb.x, sb.y - t5 * sb.s * 0.28, sb.s * 0.55, sb.s * 0.7,
          (1 - clamp(t5 / 0.5, 0, 1)) * 0.55, 1);
      }
      list[write++] = rec;
    }
    list.length = write;
  }

  /**
   * 屏幕上的一记刀弧：(fromX,fromY) → (toX,toY) 是劈砍方向，弧在终点绽开。
   * 复用 slash 贴图（月牙沿本地 −y 鼓起），把它旋到劈砍方向再拉长。
   */
  _tCrescent(toX, toY, aimX, aimY, z, tint, life = 0.3, size = 1.3) {
    const cam = this.ctx.cam();
    const a = cam.project(toX, toY, z, this._p);
    const b = cam.project(aimX, aimY, z, this._q);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const rot = ang + Math.PI / 2;
    const s = a.s;
    this.particle('slash', a.x, a.y, {
      tint, life, s0: (s / 128) * size, s1: (s / 128) * size * 1.28,
      a0: 0.95, a1: 0, rot,
    });
    this.particle('slash', a.x, a.y, {
      tint: FIRE_HOT, life: life * 0.6, s0: (s / 128) * size * 0.72, s1: (s / 128) * size * 0.94,
      a0: 0.85, a1: 0, rot,
    });
  }

  // ---- S2 炽翼掠火：一对火翼，持续整段技能 ----------------------------------------------------------------------

  /**
   * S2 开启 / 关闭。开启时建一对 Graphics 火翼挂在 `owner` 单位上（跟着它走），关闭时淡出并销毁。
   * 同一个施法者只保留一对（重复开启会先关旧的）。
   * @param {{ owner: any, on: boolean, dur: number }} o  owner = 单位 view（有 x y z 与 dir）
   */
  setWing(o) {
    const owner = o && o.owner;
    if (!owner) return;
    const key = owner.id ?? owner;
    const w = this.wings.find((it) => it.key === key);
    if (!o.on) {
      if (w) w.end = Math.min(w.end, w.t + 0.32);
      return;
    }
    if (w) { w.end = Math.max(w.end, w.t + (Number(o.dur) || 4)); return; }
    const P = this.P;
    const g = new P.Graphics();
    g.blendMode = P.BLEND_MODES.ADD;
    this.ctx.layers.groundFx.addChild(g);
    const rec = { key, owner, g, t: 0, end: Number(o.dur) || 4, seed: talulaRandom(this) * 10, ember: 0 };
    // 图集羽片：每侧 7 片，共 14 个 sprite。未就绪时全部隐藏，由 Graphics 分支顶上。
    const perSide = 7;
    const sprites = [];
    for (let i = 0; i < perSide * 2; i++) {
      const spr = new this.P.Sprite(this.P.Texture.WHITE);
      spr.anchor.set(0.5, 1);
      spr.visible = false;
      spr.blendMode = this.P.BLEND_MODES.ADD;
      this.ctx.layers.groundFx.addChild(spr);
      sprites.push(spr);
    }
    rec.sprites = sprites;
    this.wings.push(rec);
    if (this.wings.length > 6) { const old = this.wings.shift(); this._freeWing(old); }
  }

  /**
   * 屏蔽素材自带的灰色刀痕附件。
   *
   * 源定义里写了 `suppressNativeSlash: true`，但此前没有任何代码读它：配置存在、
   * 执行缺失，于是 S3 挥剑时既有新金色刀光、又有 `F_R_Weapon_E` 那片灰色扇面。
   * 附件轨道每帧恢复数值，所以必须每帧压一次。
   */
  _suppressNativeSlash() {
    const views = this.ctx.views?.();
    if (!views) return;
    for (const v of views) {
      if (!v || v.destroyed) continue;
      const cfg = v.entry?.anims?.swing?.talula;
      if (!cfg || !cfg.suppressNativeSlash) continue;
      const actor = v.actor;
      if (!actor || typeof actor.suppressSlots !== 'function') continue;
      actor.suppressSlots(TALULA_NATIVE_SLASH_SLOTS);
    }
  }

/**
   * 取一个图集 sprite（按需创建）。未就绪返回 null，调用方退回 Graphics。
   * @param {object} rec 持有者记录，sprite 挂在 rec.sprites[key] 上
   * @param {string} key 记录内的键名
   * @param {string} group 图集组名
   * @param {'add'|'normal'} blend 混合模式
   */
  _atlasSprite(rec, key, group, blend = 'add') {
    if (!rec.sprites) rec.sprites = {};
    if (!talulaFrame(group, 0)) return null;
    let spr = rec.sprites[key];
    if (!spr) {
      spr = new this.P.Sprite(this.P.Texture.WHITE);
      spr.blendMode = blend === 'normal' ? this.P.BLEND_MODES.NORMAL : this.P.BLEND_MODES.ADD;
      this.ctx.layers.fxAdd.addChild(spr);
      spr.visible = false;
      rec.sprites[key] = spr;
    }
    return spr;
  }

  /** 按已过秒数取图集帧并摆到屏幕上。 */
  _setAtlasFrame(spr, group, seconds, x, y, w, h, alpha, anchorY = 0.5) {
    const tex = talulaFrame(group, 0, seconds * 1000);
    if (!tex) { spr.visible = false; return false; }
    spr.texture = tex;
    spr.anchor.set(0.5, anchorY);
    spr.position.set(x, y);
    spr.width = w; spr.height = h;
    spr.alpha = alpha;
    spr.visible = true;
    return true;
  }

  _freeWing(w) {
    if (!w) return;
    if (w.g) { w.g.destroy(); w.g = null; }
    if (w.sprites) {
      for (const spr of w.sprites) { try { spr.destroy(); } catch { /* already gone */ } }
      w.sprites.length = 0;
      w.sprites = null;
    }
  }

  /**
   * 技能期间的范围外沿火焰：常显，与选中状态无关。
   *
   * 策划案要求「技能期间攻击范围外沿有一圈火线」，此前完全没有。这里按
   * `UnitView.rangeKeys` 的外轮廓画一圈细火线 + 稀疏火舌，随相机与地形高度走。
   * 只读视图数据，不碰任何判定；HUD 一行不动。
   */
  _updateRangeEdge(dt) {
    const cam = this.ctx.cam();
    const layer = this.ctx.layers.groundFx;
    if (!this.talulaRangeEdge) {
      const g = new this.P.Graphics();
      g.blendMode = this.P.BLEND_MODES.ADD;
      layer.addChild(g);
      this.talulaRangeEdge = g;
      this.talulaRangeClock = 0;
    }
    const g = this.talulaRangeEdge;
    g.clear();
    this.talulaRangeClock = (this.talulaRangeClock || 0) + dt;
    const t = this.talulaRangeClock;

    const views = this.ctx.views?.();
    if (!views) return;
    const q = this._q;
    for (const v of views) {
      if (!v || v.destroyed || v.alive === false) continue;
      // 只对塔露拉、且只在技能期间画
      if (!v.entry?.anims?.swing?.talula) continue;
      if (!v.skillOn) continue;
      const keys = v.rangeKeys;
      if (!Array.isArray(keys) || !keys.length) continue;

      // rangeKeys 是 `row * COLS + col`（引擎约定），列数从战场 rect 推断不可靠，
      // 直接用引擎常量，与 server/sim/constants.js 的 GEO 同源。
      const stride = GEO.COLS;

      // 只取「她自己的攻击范围」：rangeKeys 里还并了 extraRangeKeys（全场灼燃爆发的
      // 敌人作为额外目标）。不滤掉的话，S2/S3 一旦有敌人处于爆发，外沿就会绕整个战场
      // 画一圈，看起来像一条横贯地图的乱线。这里按格子距离截断。
      const centerR = Math.round(v.y), centerC = Math.round(v.x);
      const near = keys.filter((k) => {
        const r = Math.floor(k / stride), c = k % stride;
        return Math.abs(r - centerR) <= 3 && Math.abs(c - centerC) <= 3;
      });
      if (!near.length) continue;

      // 外轮廓 = 所有范围格的外边界边；逐格取四条边，被相邻格共享的边跳过。
      const set = new Set(near);
      const z = this._groundZ(v.x, v.y) + 0.06;
      const pulse = 0.55 + 0.45 * Math.sin(t * 3.1);
      for (const k of near) {
        const r = Math.floor(k / stride), c = k % stride;
        for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nr = r + dr, nc = c + dc;
          if (set.has(nr * stride + nc)) continue;
          // 这条边朝外
          const x0 = dc === 1 ? c + 0.5 : dc === -1 ? c - 0.5 : c - 0.5;
          const x1 = dc === 1 ? c + 0.5 : dc === -1 ? c - 0.5 : c + 0.5;
          const y0 = dr === 1 ? r + 0.5 : dr === -1 ? r - 0.5 : r - 0.5;
          const y1 = dr === 1 ? r + 0.5 : dr === -1 ? r - 0.5 : r + 0.5;
          const a = cam.project(x0, y0, this._groundZ(x0, y0) + 0.06, q);
          const b = cam.project(x1, y1, this._groundZ(x1, y1) + 0.06, q);
          g.lineStyle(Math.max(.7, a.s * 0.008), FIRE_MID, 0.13 * pulse);
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.lineStyle(0);
        }
      }
      // 稀疏火舌：沿外沿每隔一段冒一小簇，不铺满，避免盖住画面
      const emberStep = 3;
      for (let i = 0; i < near.length; i += emberStep) {
        const k = near[i];
        const r = Math.floor(k / stride), c = k % stride;
        const ph = t * 4.2 + i * 0.9;
        const h = 0.10 + 0.07 * Math.sin(ph);
        const p0 = cam.project(c - 0.09, r, z, q);
        const p1 = cam.project(c + 0.09, r, z, q);
        const p2 = cam.project(c + Math.sin(ph) * 0.03, r, z + h, q);
        g.beginFill(FIRE_HOT, 0.08 * pulse);
        g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.lineTo(p2.x, p2.y);
        g.closePath(); g.endFill();
      }
    }
  }

  /** 羽根使用图集原点，羽轴按源图右上方向旋转，双翼展开在角色背后。 */
  _updateWings(dt) {
    const cam = this.ctx.cam(), low = this.quality === 'low';
    for (let i = this.wings.length - 1; i >= 0; i--) {
      const w = this.wings[i], v = w.owner;
      w.t += dt * this._ts();
      const left = w.end - w.t;
      if (!w.g || left <= 0 || !v || v.destroyed || v.alive === false) {
        this._freeWing(w); this.wings.splice(i, 1); continue;
      }
      const g = w.g;
      g.clear();
      for (const spr of w.sprites || []) spr.visible = false;
      const base = cam.project(v.x, v.y,
        (v.z || 0) + (v.hover || 0) + (v._float || 0) + (v.lift || 0), {});
      if (base.s <= 0) continue;
      const s = base.s, face = v.visFacing < 0 ? -1 : 1;
      const chest = v.boneOffset?.('Chest', w.chest || (w.chest = {}));
      const backX = base.x + (chest?.x || 0) * s - face * s * 0.08;
      const backY = base.y - (chest?.up ?? 0.8) * s + s * 0.06;
      const blend = clamp(Math.min(w.t / 0.35, left / 0.32, 1), 0, 1);
      const fade = blend * blend * (3 - 2 * blend), extent = 0.4 + fade * 0.6;
      const feathers = low ? 5 : 7;
      for (const side of [-1, 1]) for (let k = 0; k < feathers; k++) {
        const u = k / (feathers - 1), outward = face * side;
        const ph = w.seed + k * 1.37 + side * 0.9;
        const wob = Math.sin(w.t * (4.2 + k * 0.35) + ph) * 0.025;
        const rootX = backX + outward * s * (0.02 + u * 0.07);
        const rootY = backY + s * u * 0.14;
        const len = (0.64 + u * 0.66 + wob) * s * extent * (side > 0 ? 1 : 0.86);
        const tilt = 0.18 + u * 0.86 + wob;
        const dx = outward * Math.sin(tilt) * len, dy = -Math.cos(tilt) * len;
        const alpha = fade * (0.38 + u * 0.14) * (side > 0 ? 1 : 0.78);
        const texture = talulaFrame('fire-feather', Math.floor((w.t + k * 0.055) * 16) % 8);
        const spr = w.sprites?.[(side > 0 ? 7 : 0) + k];
        if (texture && spr) {
          spr.texture = texture;
          // atlas-layout: root=(32,228), tip=(220,27); the source axis is diagonal.
          spr.anchor.set(32 / 256, 228 / 256);
          spr.position.set(rootX, rootY);
          const scale = len / Math.hypot(188, 201);
          spr.scale.set(outward * scale, scale);
          spr.rotation = Math.atan2(dy, dx) - Math.atan2(-201, outward * 188);
          spr.alpha = alpha;
          spr.visible = true;
        } else {
          const nx = -dy / len, ny = dx / len, width = s * (0.035 + u * 0.015);
          g.beginFill(u < 0.35 ? FIRE_MID : FIRE_HOT, alpha);
          g.moveTo(rootX, rootY);
          g.bezierCurveTo(rootX + dx * 0.35 + nx * width, rootY + dy * 0.35 + ny * width,
            rootX + dx * 0.75 + nx * width, rootY + dy * 0.75 + ny * width,
            rootX + dx, rootY + dy);
          g.bezierCurveTo(rootX + dx * 0.70 - nx * width * 0.4, rootY + dy * 0.70 - ny * width * 0.4,
            rootX + dx * 0.30 - nx * width * 0.4, rootY + dy * 0.30 - ny * width * 0.4, rootX, rootY);
          g.endFill();
        }
      }
    }
  }

  // ---- 起飞 / 落地 / 强化 ------------------------------------------------------------------------------------

  /** S2 / S3 起飞：两道小火弧在 0.3 秒内展开，再用 0.36 秒收束。 */
  talulaTakeoff(unit) {
    if (!unit) return;
    startTalulaMotion(unit, true);
    this.talulaMotionOwners.add(unit);
    this.talulaLandings = this.talulaLandings.filter((it) => it.owner !== unit);
    const rec = takeTalulaSlash(this);
    Object.assign(rec, { kind: 'talulaTakeoff', owner: unit, t: 0, end: 0.82 });
    this.ctx.layers.groundFx.addChild(rec.g);
    this.talulaSlashes.push(rec);
  }

  /** Fall first; the ground reaction starts on contact, 0.3 game seconds later. */
  talulaLand(unit) {
    if (!unit) return;
    startTalulaMotion(unit, false);
    this.talulaMotionOwners.add(unit);
    if (this.talulaLandings.some((it) => it.owner === unit)) return;
    this.talulaLandings.push({ owner: unit, t: 0 });
  }

  _updateTalulaLandings(dt) {
    let write = 0;
    for (const rec of this.talulaLandings) {
      if (rec.owner.destroyed || rec.owner.alive === false) continue;
      rec.t += dt * this._ts();
      if (rec.t >= 0.3) this._tLandImpact(rec.owner);
      else this.talulaLandings[write++] = rec;
    }
    this.talulaLandings.length = write;
  }

  _tLandImpact(unit) {
    const { x, y } = unit;
    const z = this._groundZ(x, y);
    this.ring(x, y, z, 0.15, 1.15, FIRE_HOT, 0.28, 'shock');
    this.ring(x, y, z, 0.2, 0.85, FIRE_DEEP, 0.4, 'ring');
    this._tEmbers(x, y, this.rich ? 9 : 4, 0.9);
    this._tSmoke(x, y, this.quality === 'low' ? 2 : 4);
    const cam = this.ctx.cam();
    const g = cam.project(x, y, z + 0.02, this._p);
    for (let i = 0; i < (this.quality === 'low' ? 4 : 9); i++) {
      const a = talulaRandom(this) * Math.PI * 2;
      this.particle('smoke', g.x, g.y, {
        add: false, tint: 0x6b5b4c,
        vx: Math.cos(a) * g.s * 1.1, vy: Math.sin(a) * g.s * 0.45 - g.s * 0.2,
        drag: 2.6, life: 0.55 + talulaRandom(this) * 0.3,
        s0: (g.s * 0.18) / 128, s1: (g.s * 0.5) / 128, a0: 0.34, a1: 0,
      });
    }
  }

  /** 强化火光贴着刀骨发出，保持角色中心可读。 */
  talulaEmpower(unit) {
    if (!unit) return;
    const rec = takeTalulaSlash(this);
    Object.assign(rec, { kind: 'talulaEmpower', owner: unit, t: 0, end: 0.3 });
    this.talulaSlashes.push(rec);
  }

  // ---- S3 环斩 / 焰浪 / 恶火 -----------------------------------------------------------------------------

  talulaWave(o) { setTalulaWave(this, o); }
  _freeWave(w) { freeTalulaWave(w); }
  _updateWaves(dt) { updateTalulaWaves(this, dt); }
  talulaFire(o) { setTalulaFire(this, o); }
  _updateFires(dt) { updateTalulaFires(this, dt); }

  // ---- 焚尽（天赋 2） ---------------------------------------------------------------------------------

  talulaScorch(x, y, view) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    spawnTalulaFeedback(this, 'mark', {
      x, y, z: view ? (view.z || 0) + (view.hover || 0) + (view._float || 0) : this._groundZ(x, y), v: view,
    });
  }
}


export const talulaEffects = {
  methods: FxTalula,
  kinds: {
    talulaIgnite: { a: 'custom', c: 0xff8a3d }, talulaWing: { a: 'custom', c: 0xff8a3d },
    talulaWave: { a: 'custom', c: 0xffb347 }, talulaFire: { a: 'custom', c: 0xff8a3d },
    talulaTakeoff: { a: 'custom', c: 0xffc27a }, talulaLand: { a: 'custom', c: 0xff8a3d },
    talulaEmpower: { a: 'custom', c: 0xffe9a8 },
    scorch: { a: 'custom', c: 0xff6a2a },
    talulaS1: { a: 'custom', c: FIRE_MID },
    talulaS2First: { a: 'custom', c: 0xffe9a8 },
    talulaReveal: { a: 'custom', c: 0xd8dee8 },
    talulaSlash: { a: 'custom', c: FIRE_HOT }, talulaQiSlash: { a: 'custom', c: FIRE_MID },
    talulaRingSlash: { a: 'custom', c: FIRE_HOT },
  },
  init(fx) {
    // The shared fallback adds a full-body white flare before the custom fx event.
    const sharedSkill = fx.skill;
    fx.skill = function(view, on) {
      if (view?.entry?.anims?.swing?.talula) { this._aura(view, false); return; }
      return sharedSkill.call(this, view, on);
    };
    fx.wings = []; fx.talulaWaves = []; fx.talulaFires = []; fx.talulaSlashes = []; fx.talulaSlashFree = [];
    fx.talulaQi = []; fx.talulaQiFree = []; fx.talulaFireFree = [];
    fx.talulaS1Fx = [];
    fx.talulaLandings = []; fx.talulaMotionOwners = new Set(); fx.talulaVisualSeed = 0x74616c75;
    initTalulaFeedback(fx);
    // 火效图集（art/talula/effects 的帧条）：按需加载。未就绪时各绘制处退回 Graphics 画法，
    // 所以加载失败只是「没有贴图」，不会让效果消失。
    ensureTalulaTextures(fx.P).then((n) => {
      fx.talulaTextureGroups = n;
      if (n > 0) fx.talulaSpritePool = [];
    }, () => { /* 图集可选 */ });
    fx.talulaAudio = new TalulaAudioAnchors(fx);
  },
  update(fx, dt) {
    fx._updateTalulaLandings(dt); fx._updateWings(dt); fx._updateWaves(dt); fx._updateFires(dt);
    fx._updateTalulaS1(dt);
    fx._updateTalulaSlashes(dt); updateTalulaQi(fx, dt);
    fx._updateRangeEdge(dt);
    fx._suppressNativeSlash();
    updateTalulaFeedback(fx, dt);
    try { fx.talulaAudio.update(dt); } catch { /* optional audio */ }
  },
  clear(fx) {
    clearTalulaFeedback(fx);
    try { fx.talulaAudio.clear(); } catch { /* optional audio */ }
    for (const owner of fx.talulaMotionOwners) clearTalulaMotion(owner);
    fx.talulaMotionOwners.clear(); fx.talulaLandings.length = 0; fx.talulaVisualSeed = 0x74616c75;
    for (const w of fx.wings) fx._freeWing(w);
    fx.wings.length = 0;
    for (const rec of fx.talulaS1Fx) {
      if (rec.sprites) for (const spr of Object.values(rec.sprites)) spr.destroy();
      rec.g.destroy();
    }
    fx.talulaS1Fx.length = 0;
    clearTalulaBattle(fx);
    for (const rec of [...fx.talulaSlashes, ...fx.talulaSlashFree]) { rec.g.destroy(); rec.back?.destroy(); }
    fx.talulaSlashes.length = 0;
    fx.talulaSlashFree.length = 0;
  },
  handlers: {
    talulaIgnite: () => {}, // 开技只保留音频事件，掌心聚火已取消。
    talulaWing: (fx, { at, ex }) => fx.setWing({ owner: at.v, on: ex.on !== false, dur: num(ex.dur, 4) }),
    // kit 现在带 waveId/front/speed/to：波前位置以机制报告为准，渲染侧不再自造速度。
    // 这几个字段必须原样转交，否则 setTalulaWave 里的对齐与替换逻辑全部接不到真实数据。
    talulaWave: (fx, { x, y, ex }) => fx.talulaWave({
      x: Number(x), y: Number(y), id: ex.id, axis: ex.axis, sign: num(ex.sign, 1),
      waveId: num(ex.waveId, 0), front: num(ex.front, NaN), speed: num(ex.speed, 8), to: num(ex.to, NaN),
    }),
    talulaFire: (fx, { ex }) => fx.talulaFire({
      r: num(ex.r, 0), c: num(ex.c, 0), dur: num(ex.dur, 6), expiresAt: num(ex.expiresAt, NaN),
    }),
    talulaTakeoff: (fx, { at }) => fx.talulaTakeoff(at.v || { x: at.x, y: at.y }),
    talulaLand: (fx, { at }) => fx.talulaLand(at.v || { x: at.x, y: at.y }),
    talulaEmpower: (fx, { at }) => fx.talulaEmpower(at.v || { x: at.x, y: at.y }),
    talulaS1: (fx, { x, y, at, ex }) => {
      // 蓄势的清除交给仿真：Skill.pending 被 onAttack 清掉后，field-view 的每帧投影会同步过来。
      fx.talulaS1(num(x, at.x), num(y, at.y), num(ex.sx, NaN), num(ex.sy, NaN), at.v, num(ex.src, null));
    },
    // S2 对每个目标的首次引爆：只响一次，由 kit 在真实引爆处发出。
    talulaS2First: (fx, { at, ex }) => spawnTalulaFeedback(fx, 'burst', at, ex),
    // 真实破隐的首次生效：碎镜。刷新同一状态不重发（kit 侧已判 first）。
    talulaReveal: (fx, { at, ex }) => spawnTalulaFeedback(fx, 'phys', at, ex),
    talulaHitPhysical: (fx, { at, ex }) => spawnTalulaFeedback(fx, 'phys', at, ex),
    talulaHitArts: (fx, { at, ex }) => spawnTalulaFeedback(fx, 'arts', at, ex),
    scorchBurst: (fx, { at, ex }) => {
      // Preserve other operators' area blasts (e.g. Reed's event carries its radius).
      if (Number(ex.r ?? ex.radius) > 0) return false;
      spawnTalulaFeedback(fx, 'burst', at, ex);
      return true;
    },
    scorch: (fx, { at }) => fx.talulaScorch(at.x, at.y, at.v),
    talulaSlash: (fx, { at, ex }) => fx.talulaBlade('talulaSlash', at, ex),
    talulaQiSlash: (fx, { at, ex }) => fx.talulaBlade('talulaQiSlash', at, ex),
    talulaRingSlash: (fx, { at, ex }) => fx.talulaBlade('talulaRingSlash', at, ex),
  },
};
