import { loadSettings } from './settings.js';
import { setMenuAudio, unlockMenuAudio, menuCue, loadMenuMusic } from './menu-audio.js';
import { stopLevelBgm } from './level-bgm.js';
import { debugLog, debugTimer } from './debug-log.js';

// 工作区页面可以独立导航；局外音源由本窗口持有，跨页时不重建。
//
// 导航必须“当场换 src、马上结束过渡”：过渡回调如果返回一个等待子页 terminalReady() 的 Promise，浏览器会把
// 子文档的提交压后到该 Promise 结算之后，而子页又要加载完才能 terminalReady —— 双方互等，只能由 View
// Transition 的四秒超时解开。表现就是每次切选项卡卡四秒，返回主菜单时同理；主菜单页不调用 terminalReady，
// 那次 Promise 永不结算，导航锁（moving）就一直开着，之后再点任何入口都被直接丢掉。
// 现在的顺序：捕获旧画面 → 换 src 并立即结算 → 让 260ms 的滑动动画自己跑完；子页照旧用
// html[data-terminal-pending] 把自己藏到就绪为止，所以不会看到半成品界面。
let section = 'home', active = true, moving = false, queued = null, releaseTimer = 0;
const MOVE_GUARD_MS = 1600;
const workspace = document.querySelector('iframe');

function workspaceUrl(url) {
  const next = new URL(url, location.href);
  return next.origin === location.origin && /^\/studio\/(home|console|play|level)\.html$/.test(next.pathname) ? next : null;
}

function currentTarget() {
  try {
    const { pathname, search, hash } = workspace.contentWindow?.location || {};
    return pathname ? pathname + (search || '') + (hash || '') : '';
  } catch { return ''; }
}

function release() {
  clearTimeout(releaseTimer); releaseTimer = 0;
  if (!moving) return;
  moving = false;
  const next = queued; queued = null;
  if (next) navigate(next.url, next.direction, next.reduced);
}

function setSource(target) {
  if (currentTarget() === target) { debugLog('导航', `已在目标页 ${target}，跳过`); return false; }
  debugLog('导航', `切换工作区 → ${target}`);
  workspace.src = target;
  return true;
}

function navigate(url, direction, reduced) {
  const next = workspaceUrl(url);
  if (!next) { debugLog('导航', `忽略非工作区地址 ${url}`); return; }
  const target = next.pathname + next.search + next.hash;
  if (moving) {
    // 动画期间又点了一个入口：记住最后一次，动画结束后接着走，不静默丢弃。
    queued = { url, direction, reduced };
    debugLog('导航', `过渡进行中，排队 ${target}`);
    return;
  }
  if (currentTarget() === target) { debugLog('导航', `已在目标页 ${target}`); return; }
  if (reduced || !document.startViewTransition) { setSource(target); return; }
  moving = true;
  // 兜底：任何异常都不允许把导航锁留在打开状态。
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => { debugLog('导航', '过渡超时，强制解锁'); release(); }, MOVE_GUARD_MS);
  document.documentElement.dataset.transition = direction ? 'slide' : 'fade';
  document.documentElement.style.setProperty('--enter-x', `${direction * 100}%`);
  document.documentElement.style.setProperty('--exit-x', `${-direction * 100}%`);
  const done = debugTimer('导航', `过渡 ${target}`);
  let transition;
  try {
    transition = document.startViewTransition(() => { setSource(target); });
  } catch (error) {
    debugLog('导航', `过渡失败，直接切换：${error?.message || error}`);
    document.documentElement.dataset.transition = '';
    release();
    setSource(target);
    return;
  }
  void transition.finished.catch((error) => debugLog('导航', `过渡未正常结束：${error?.name || error}`))
    .finally(() => { delete document.documentElement.dataset.transition; done(); release(); });
}

window.arksimMenuAudio = {
  setMenuAudio(value, nextSection, enabled) { section = nextSection; active = enabled; setMenuAudio(value, section, active); },
  unlockMenuAudio,
  // 交互音效也走这一份：子页每导航一次就是新文档，音效缓冲与上下文留在这里才不会重复加载与堆积。
  menuCue,
  loadMenuMusic,
  navigate,
  // 子页就绪通知：过渡已不再等它，这里只留作日志与排错线索。
  ready() { debugLog('导航', `子页就绪 ${currentTarget()}`); },
  syncLocation(url, title) {
    const next = workspaceUrl(url);
    if (!next) return;
    history.replaceState(null, '', next.pathname + next.search + next.hash);
    document.title = title;
    debugLog('导航', `同步地址 ${next.pathname}${next.search || ''}「${title}」`);
  },
};
setMenuAudio(loadSettings(), section, active);
void loadMenuMusic();
// 过渡由 transition.finished 释放；load 只作日志线索（子页自己用 terminalPending 藏到就绪）。
workspace.addEventListener('load', () => debugLog('导航', `工作区已载入 ${currentTarget()}`));
workspace.src = /^\/studio\/(home|console|play|level)\.html$/.test(location.pathname)
  ? location.pathname + location.search + location.hash : '/studio/home.html';
window.addEventListener('storage', (event) => { if (event.key === 'arksim-sandbox-settings-v1') setMenuAudio(loadSettings(), section, active); });
window.addEventListener('pagehide', stopLevelBgm);
