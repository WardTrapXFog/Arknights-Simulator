// public/js/render/fx/talula-textures.js — 把 art/talula/effects 的 SVG 帧条变成可取的纹理帧。
//
// T2 交付的每组图是一张横向帧条 SVG（frame-00 … frame-NN 从左到右），
// atlas-layout.json 给出每组帧数与单帧尺寸。这里做三件事：
//   1. 把 SVG 用 <img> 载入，画到一张 canvas 上（浏览器自己栅格化，不需要构建期转换）；
//   2. 按帧矩形切出 texture；
//   3. 提供 frame(group, index) 的同步查询，未就绪时返回 null，调用方退回 Graphics 画法。
//
// 全部按需加载：只在塔露拉真的出现在场上时才发请求。

const BASE = '/assets/custom/op_talulah/fx/';

/**
 * 与 art/talula/effects/atlas-layout.json 的 groups 一致。
 *
 * `ms` 是**每帧**时长（不是整条帧条的总时长），必须等于 1000 / 该组的 fps：
 * 只有按时间取帧的三组（`ground-tongues`、`embers`、`smoke`）读它，其余组由
 * 调用方按自己的 fps 直接给帧号。此前这三组填的是「整条帧条的总时长」，
 * 于是每个动画都慢 5–7 倍，短命的效果（0.4–0.6 秒）根本走不出第一帧。
 */
const GROUPS = Object.freeze({
  'flame-crescent': { file: 'flame-crescent.svg', frames: 8, w: 256, h: 256, loop: true, ms: 42 },
  'fire-feather': { file: 'fire-feather.svg', frames: 8, w: 256, h: 256, loop: true, ms: 63 },
  'wall-body': { file: 'wall-body.svg', frames: 8, w: 192, h: 320, loop: true, ms: 63 },
  'wall-crest': { file: 'wall-crest.svg', frames: 8, w: 256, h: 192, loop: true, ms: 63 },
  'ground-tongues': { file: 'ground-tongues.svg', frames: 8, w: 192, h: 192, loop: true, ms: 83 },
  'hit-slash': { file: 'hit-slash.svg', frames: 6, w: 192, h: 192, loop: false, ms: 17 },
  'delayed-burst': { file: 'delayed-burst.svg', frames: 8, w: 256, h: 256, loop: false, ms: 42 },
  'fire-column': { file: 'fire-column.svg', frames: 8, w: 192, h: 384, loop: false, ms: 63 },
  embers: { file: 'embers.svg', frames: 6, w: 96, h: 96, loop: false, ms: 100 },
  smoke: { file: 'smoke.svg', frames: 8, w: 192, h: 256, loop: false, ms: 83 },
});

/** 每组的状态：{ P, textures[], ready } */
const state = new Map();
let started = false;

/**
 * 载入一组。PIXI 的 Texture 需要 baseTexture，所以用 canvas 承载栅格化结果。
 * @returns {Promise<boolean>}
 */
function loadGroup(P, id) {
  const cfg = GROUPS[id];
  if (!cfg) return Promise.resolve(false);
  const rec = { P, textures: [], ready: false };
  state.set(id, rec);

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        // SVG 的固有尺寸就是帧条总宽；按单帧尺寸切。
        const totalW = cfg.w * cfg.frames;
        const totalH = cfg.h;
        const canvas = document.createElement('canvas');
        canvas.width = totalW;
        canvas.height = totalH;
        const c2d = canvas.getContext('2d');
        c2d.imageSmoothingEnabled = true;
        c2d.drawImage(img, 0, 0, totalW, totalH);

        const base = P.BaseTexture.from(canvas, { resolution: 1 });
        for (let i = 0; i < cfg.frames; i++) {
          rec.textures.push(new P.Texture(base, new P.Rectangle(i * cfg.w, 0, cfg.w, cfg.h)));
        }
        rec.ready = true;
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => resolve(false);
    img.src = BASE + cfg.file;
  });
}

/** 开始加载全部组（幂等）。返回 Promise<number>：成功载入的组数。 */
export function ensureTalulaTextures(P) {
  if (started) return Promise.resolve(0);
  started = true;
  const ids = Object.keys(GROUPS);
  return Promise.all(ids.map((id) => loadGroup(P, id))).then((rs) => rs.filter(Boolean).length);
}

/** 某组的帧数（未加载也能查）。 */
export function talulaFrameCount(id) {
  return GROUPS[id]?.frames ?? 0;
}

/** 该组是否循环。 */
export function talulaGroupLoops(id) {
  return !!GROUPS[id]?.loop;
}

/**
 * 取一帧纹理。
 * @param {string} id 组名
 * @param {number} index 帧序号
 * @param {number} [timeMs] 给了就按时间循环取帧
 * @returns {import('pixi.js').Texture|null} 未就绪返回 null
 */
export function talulaFrame(id, index = 0, timeMs = null) {
  const rec = state.get(id);
  if (!rec || !rec.ready || !rec.textures.length) return null;
  const cfg = GROUPS[id];
  let i = index;
  if (timeMs != null) {
    const per = cfg.ms;
    const raw = cfg.loop ? Math.floor(timeMs / per) : Math.floor(timeMs / per);
    i = cfg.loop ? raw % cfg.frames : Math.min(cfg.frames - 1, raw);
  }
  return rec.textures[Math.max(0, Math.min(cfg.frames - 1, i))] || null;
}

/** 释放所有纹理（换场/销毁时调用）。 */
export function disposeTalulaTextures() {
  for (const rec of state.values()) {
    for (const t of rec.textures) { try { t.destroy(false); } catch { /* ignore */ } }
    rec.textures.length = 0;
    rec.ready = false;
  }
  state.clear();
  started = false;
}

/** 已就绪的组数，用于诊断。 */
export function talulaTexturesReady() {
  let n = 0;
  for (const rec of state.values()) if (rec.ready) n += 1;
  return n;
}