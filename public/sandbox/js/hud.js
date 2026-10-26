// HUD facade: public interfaces are stable; each UI section owns its markup.
import { clamp01, fmtTime } from './ui/html.js';
import { icon } from './ui/icons.js';
export { esc } from './ui/html.js';
export { mount } from './ui/shell.js';
export { renderHand } from './ui/hand.js';
export { renderDetail, setDetailTab } from './ui/detail.js';
export { renderDrawer } from './ui/toolbox.js';
export { setPicker, renderPicker } from './ui/picker.js';

export function setStats(refs, s) {
  refs.kill.textContent = `${s.kill}/${s.total}`;
  const life = Math.max(0, s.life);
  refs.life.textContent = String(life);
  refs.life.classList.toggle('is-bad', life <= 0);
  refs.time.textContent = fmtTime(s.time);
  refs.dp.textContent = String(Math.floor(s.dp));
  refs.dpFill.style.width = `${clamp01(s.dp - Math.floor(s.dp)) * 100}%`;
  // 播放键的图形只在状态翻转时重建，别每帧写 innerHTML
  const playIcon = s.playing ? 'pause' : 'play';
  if (refs._playIcon !== playIcon) { refs._playIcon = playIcon; refs.playBtn.innerHTML = icon(playIcon); }
  // 暂停遮罩：只在状态翻转时改 class（每帧写 className 会打断 CSS 过渡）
  const paused = !s.playing;
  if (refs._paused !== paused) { refs._paused = paused; refs.pause?.classList.toggle('is-on', paused); }
  refs.speedBtn.textContent = `${s.speed}×`;
  refs.speedBtn.classList.toggle('is-on', s.speed !== 1);
  refs.boardBtn.textContent = s.board === '3d' ? '3D' : '2D';
  refs.boardBtn.classList.toggle('is-on', s.board === '3d');
  refs.payBtn.classList.toggle('is-on', !!s.pay);
}

export function setPure(refs, on) { refs.hud.classList.toggle('is-pure', !!on); }

/* -------------------------------------------------------------------------------------------------------------- */
/* 场上「选中了谁」标记（金色角框 + 名字牌 + 一圈压暗）                                                              */
/* -------------------------------------------------------------------------------------------------------------- */

/**
 * 选中反馈。原项目的 game.js 里没有「选中干员时抬镜头」这种东西（镜头只有 prep / normal / boss / 敌人预览 pen
 * 四种相位预设，见 render/projection.js presetCamera），它靠的是「详情卡 + 格子底框」表达选中。
 * 沙盒没有详情卡停靠那一套，所以这里补一个更直白的三件套：金色角框 + 名字牌 + 视野压暗，位置每帧跟着镜头走。
 * @param {null | {x:number,y:number,s:number,name:string,uid:number}} m  m.x / y = 格子中心的屏幕坐标（client px）
 */
export function setSelMark(refs, m) {
  const el = refs.selMark, spot = refs.selSpot;
  if (!el || !spot) return;
  if (!m) {
    if (refs._selOn) {
      refs._selOn = false;
      el.classList.remove('is-on');
      spot.classList.remove('is-on');
    }
    return;
  }
  const x = Math.round(m.x), y = Math.round(m.y);
  const size = Math.max(26, Math.min(220, (Number(m.s) || 56) * 1.16));
  if (!refs._selOn) { refs._selOn = true; el.classList.add('is-on'); spot.classList.add('is-on'); }
  if (refs._selUid !== m.uid) {              // 换了个人：名字换掉 + 角框弹一下
    refs._selUid = m.uid;
    refs.selName.textContent = m.name || '';
    el.classList.remove('is-bump');
    void el.offsetWidth;
    el.classList.add('is-bump');
  }
  for (const t of [el, spot]) {
    t.style.setProperty('--sel-x', `${x}px`);
    t.style.setProperty('--sel-y', `${y}px`);
  }
  el.style.setProperty('--sel-size', `${size}px`);
}

let msgTimer = 0;
export function toast(refs, text, bad = false) {
  refs.msg.textContent = text;
  refs.msg.classList.toggle('is-bad', !!bad);
  refs.msg.classList.add('is-on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => refs.msg.classList.remove('is-on'), 3200);
}

/** 取波次表里的 JSON 文本框（导出/导入用）。 */
export const readJson = (refs, id) => refs.drInner.querySelector(`#${id}`)?.value ?? '';
export const writeJson = (refs, id, value) => { const el = refs.drInner.querySelector(`#${id}`); if (el) el.value = value; };
