import { sanitizeSettings } from '../../js/ui/gameLogic/settings.js';

const KEY = 'arksim-sandbox-settings-v1';
const defaults = { sfx: .7, voice: .8, bgm: .5, officialFx: 'lite' };
export const MENU_THEMES = Object.freeze([
  { id: 'signal', name: '青磁信号', detail: '青绿高亮 · 平面终端' },
  { id: 'optical', name: '钛灰光学', detail: '柔青高亮 · 轻微浮层' },
  { id: 'graphite', name: '石墨琥珀', detail: '暖金高亮 · 实色分区' },
]);
const menuTheme = (value) => MENU_THEMES.some((theme) => theme.id === value) ? value : 'graphite';

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* use defaults */ }
  // 背景音乐不再强制为 0：关卡 JSON 可以在 meta.bgm 指定自己的作战曲（public/sandbox/js/level-bgm.js），
  // 没指定曲子的沙盒/关卡依旧静音。音量仍是设置里的 bgm。
  return { ...sanitizeSettings({ ...defaults, ...saved }), reduceMotion: saved.reduceMotion === true, menuBgm: saved.menuBgm !== false, menuTheme: menuTheme(saved.menuTheme) };
}

export function saveSettings(settings) {
  const next = { ...sanitizeSettings({ ...settings }), reduceMotion: settings.reduceMotion === true, menuBgm: settings.menuBgm !== false, menuTheme: menuTheme(settings.menuTheme) };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function applyInterfaceSettings(settings) {
  document.documentElement.dataset.text = settings.textSize;
  document.documentElement.dataset.motion = settings.reduceMotion ? 'reduce' : 'normal';
  document.documentElement.dataset.menuTheme = menuTheme(settings.menuTheme);
}
