import { loadSettings, saveSettings, applyInterfaceSettings } from './settings.js';
import { openSettings } from './ui/settings.js';
import { setMenuAudio, unlockMenuAudio, menuCue, loadMenuMusic } from './menu-audio.js';

const PAGES = [
  ['sandbox', '/studio/console.html', '自由沙盒', 'M3 4h6v6H3z M13 4h6v6h-6z M3 14h6v6H3z M13 14h6v6h-6z'],
  ['play', '/studio/play.html', '关卡游玩', 'M5 3h14v18H5z M10 8l6 4-6 4z'],
  ['editor', '/studio/level.html', '关卡编辑器', 'M3 5h12v15H3z M7 10h4 M7 14h4 M14 10l5-7 3 2-5 7-4 2z'],
];
const section = PAGES.find(([, url]) => location.pathname === url)?.[0] || 'home';
let mode = 'menu', backAction = null, leaveGuard = null, navigating = false, settings = loadSettings();
const icon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${path}"/></svg>`;
const chrome = document.createElement('div'); chrome.className = 'terminal-chrome';
chrome.innerHTML = `${section === 'home' ? '' : `<header class="terminal-header"><div class="terminal-history"><button type="button" data-terminal-back>← 返回</button><a data-terminal-link href="/studio/home.html">主菜单</a></div><nav class="terminal-tabs" aria-label="工作区">${PAGES.map(([id, url, title, path]) => `<a data-terminal-link class="terminal-tab${id === section ? ' is-current' : ''}" href="${url}"${id === section ? ' aria-current="page"' : ''}>${icon(path)}<span>${title}</span></a>`).join('')}</nav><span class="terminal-header__end" aria-hidden="true">SI / TERMINAL</span></header>`}
  <div class="terminal-options"><button type="button" data-terminal-music aria-label="切换局外背景音乐"></button><button type="button" data-terminal-settings>⚙ 全局设置</button></div>`;
document.body.append(chrome);
const particles = document.createElement('div'); particles.className = 'terminal-particles'; particles.setAttribute('aria-hidden', 'true');
particles.innerHTML = Array.from({ length: 24 }, (_, i) => `<i style="--x:${(i * 41.618) % 100}%;--delay:${-i * 2.7}s;--duration:${32 + i % 5 * 3}s;--size:${i % 4 === 0 ? 3 : 2}px"></i>`).join('');
document.body.prepend(particles);
const curtain = document.createElement('div'); curtain.className = 'terminal-curtain'; curtain.setAttribute('aria-hidden', 'true'); document.body.append(curtain);

function preferences(value) {
  settings = value; applyInterfaceSettings(value);
  document.body.dataset.terminalQuality = value.quality;
  const music = chrome.querySelector('[data-terminal-music]');
  music.textContent = value.menuBgm ? '♫ 音乐 开' : '♫ 音乐 关';
  music.setAttribute('aria-pressed', String(value.menuBgm));
  setMenuAudio(value, section, mode !== 'battle');
}

export function setTerminalState(next = 'menu', onBack = null, beforeLeave = null) {
  mode = next; backAction = onBack; leaveGuard = beforeLeave;
  document.body.dataset.terminalMode = next;
  preferences(settings);
}

export function terminalReady() {
  delete document.documentElement.dataset.terminalPending;
}

export function terminalTransition(render) {
  if (settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return render();
  curtain.classList.add('is-active');
  return new Promise((resolve, reject) => setTimeout(() => {
    try { resolve(render()); } catch (error) { reject(error); }
    requestAnimationFrame(() => curtain.classList.remove('is-active'));
  }, 140));
}

function navigate(url) {
  if (navigating) return;
  const next = new URL(url, location.href);
  if (next.pathname === location.pathname && next.search === location.search) return;
  if (leaveGuard && !leaveGuard()) return;
  navigating = true;
  const from = PAGES.findIndex(([id]) => id === section), to = PAGES.findIndex(([, path]) => path === next.pathname);
  if (from >= 0 && to >= 0 && from !== to) {
    const direction = Math.sign(to - from);
    sessionStorage.setItem('arksim-terminal-navigation', JSON.stringify({ to: next.pathname, direction }));
    location.assign(url);
  } else {
    document.body.classList.add('terminal-fade-out');
    setTimeout(() => location.assign(url), settings.reduceMotion ? 0 : 180);
  }
}

const editable = (node) => node?.closest?.('input,textarea,[contenteditable="true"]');
document.addEventListener('dragstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
document.addEventListener('pointerdown', unlockMenuAudio, { passive: true });
document.addEventListener('keydown', () => { if (mode !== 'battle') unlockMenuAudio(); }, { passive: true });
function interactive(target) {
  const node = target.closest?.('button,a[href],select');
  if (!node || node.disabled || mode === 'battle') return null;
  if (mode === 'editor' && !node.closest('.terminal-chrome')) return null;
  return node;
}
document.addEventListener('pointerover', (e) => {
  const node = interactive(e.target);
  if (node && !node.contains(e.relatedTarget)) void menuCue('hover');
});
document.addEventListener('click', (e) => {
  const node = interactive(e.target);
  if (!node) return;
  void menuCue('click');
  if (node.matches('[data-terminal-settings]')) {
    if (!document.querySelector('.sandbox-settings[open]')) openSettings({ settings, global: true, onChange: preferences });
  } else if (node.matches('[data-terminal-music]')) preferences(saveSettings({ ...settings, menuBgm: !settings.menuBgm }));
  else if (node.matches('[data-terminal-back]')) {
    if (backAction) terminalTransition(backAction);
    else navigate('/studio/home.html');
  } else if (node.matches('a[href]') && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !node.target && !node.download) {
    const url = new URL(node.href);
    if (url.origin === location.origin && /^\/studio\/(home|console|play|level)\.html$/.test(url.pathname)) { e.preventDefault(); navigate(url.href); }
  }
}, true);
window.addEventListener('storage', (e) => { if (e.key === 'arksim-sandbox-settings-v1') preferences(loadSettings()); });
window.addEventListener('pageshow', () => { navigating = false; curtain.classList.remove('is-active'); document.body.classList.remove('terminal-slide-out', 'terminal-fade-out'); });
window.addEventListener('pagehide', () => setMenuAudio(settings, section, false));
setTerminalState();
void loadMenuMusic();

const firstHome = section === 'home' && sessionStorage.getItem('arksim-terminal-intro') !== 'seen';
if (section === 'home') sessionStorage.setItem('arksim-terminal-intro', 'seen');
if (firstHome && !settings.reduceMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const intro = document.createElement('div'); intro.className = 'terminal-intro';
  intro.innerHTML = '<span class="terminal-intro__brand">ARKNIGHTS / SIMULATOR</span><i></i><i></i><div class="terminal-intro__progress"><span>00</span><small>%</small></div>';
  document.body.append(intro);
  const began = performance.now(), value = intro.querySelector('.terminal-intro__progress span');
  const step = (now) => {
    const progress = Math.min(1, (now - began) / 1050);
    intro.style.setProperty('--progress', progress); value.textContent = String(Math.floor(progress * 100)).padStart(2, '0');
    if (progress < 1) requestAnimationFrame(step);
    else {
      intro.classList.add('is-complete');
      document.body.classList.add('terminal-home-ready');
      setTimeout(() => intro.remove(), 260);
    }
  };
  requestAnimationFrame(step);
} else if (section === 'home') document.body.classList.add('terminal-home-ready');
