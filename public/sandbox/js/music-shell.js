import { loadSettings } from './settings.js';
import { setMenuAudio, unlockMenuAudio, loadMenuMusic } from './menu-audio.js';
import { stopLevelBgm } from './level-bgm.js';

// 工作区页面可以独立导航；局外音源由本窗口持有，跨页时不重建。
let section = 'home', active = true, moving = false, finishNavigation = null;
const workspace = document.querySelector('iframe');
function workspaceUrl(url) {
  const next = new URL(url, location.href);
  return next.origin === location.origin && /^\/studio\/(home|console|play|level)\.html$/.test(next.pathname) ? next : null;
}
window.arksimMenuAudio = {
  setMenuAudio(value, nextSection, enabled) { section = nextSection; active = enabled; setMenuAudio(value, section, active); },
  unlockMenuAudio,
  loadMenuMusic,
  navigate(url, direction, reduced) {
    const next = workspaceUrl(url);
    if (!next || moving) return;
    const target = next.pathname + next.search + next.hash;
    if (reduced || !document.startViewTransition) { workspace.src = target; return; }
    moving = true;
    document.documentElement.dataset.transition = direction ? 'slide' : 'fade';
    document.documentElement.style.setProperty('--enter-x', `${direction * 100}%`);
    document.documentElement.style.setProperty('--exit-x', `${-direction * 100}%`);
    const transition = document.startViewTransition(() => new Promise((resolve) => {
      finishNavigation = resolve;
      workspace.src = target;
    }));
    void transition.finished.catch(() => {}).finally(() => { moving = false; delete document.documentElement.dataset.transition; });
  },
  ready() { finishNavigation?.(); finishNavigation = null; },
  syncLocation(url, title) {
    const next = workspaceUrl(url);
    if (!next) return;
    history.replaceState(null, '', next.pathname + next.search + next.hash);
    document.title = title;
  },
};
setMenuAudio(loadSettings(), section, active);
void loadMenuMusic();
workspace.src = /^\/studio\/(home|console|play|level)\.html$/.test(location.pathname)
  ? location.pathname + location.search + location.hash : '/studio/home.html';
window.addEventListener('storage', (event) => { if (event.key === 'arksim-sandbox-settings-v1') setMenuAudio(loadSettings(), section, active); });
window.addEventListener('pagehide', stopLevelBgm);
