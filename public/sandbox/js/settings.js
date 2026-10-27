import { sanitizeSettings } from '../../js/ui/gameLogic/settings.js';

const KEY = 'arksim-sandbox-settings-v1';
const defaults = { sfx: .7, voice: .8, bgm: .5, officialFx: 'lite' };
export const DEFAULT_MENU_MUSIC = '生命流.ogg';
const menuMusic = (value) => typeof value === 'string' && /^[^/\\]+\.ogg$/i.test(value) ? value : DEFAULT_MENU_MUSIC;
export const MENU_THEMES = Object.freeze([
  { id: 'signal', name: '青磁信号', detail: '青绿操作色 · 深灰与浅灰面板' },
  { id: 'optical', name: '冰蓝光学', detail: '冰蓝操作色 · 深蓝与浅灰面板' },
  { id: 'graphite', name: '琥珀档案', detail: '琥珀操作色 · 炭黑与暖灰面板' },
]);
const menuTheme = (value) => MENU_THEMES.some((theme) => theme.id === value) ? value : 'graphite';

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* use defaults */ }
  // 背景音乐不再强制为 0：关卡 JSON 可以在 meta.bgm 指定自己的作战曲（public/sandbox/js/level-bgm.js），
  // 没指定曲子的沙盒/关卡依旧静音。音量仍是设置里的 bgm。
  return { ...sanitizeSettings({ ...defaults, ...saved }), reduceMotion: saved.reduceMotion === true, menuBgm: saved.menuBgm !== false, menuBgmTrack: menuMusic(saved.menuBgmTrack), menuTheme: menuTheme(saved.menuTheme) };
}

export function saveSettings(settings) {
  const next = { ...sanitizeSettings({ ...settings }), reduceMotion: settings.reduceMotion === true, menuBgm: settings.menuBgm !== false, menuBgmTrack: menuMusic(settings.menuBgmTrack), menuTheme: menuTheme(settings.menuTheme) };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function applyInterfaceSettings(settings) {
  document.documentElement.dataset.text = settings.textSize;
  document.documentElement.dataset.motion = settings.reduceMotion ? 'reduce' : 'normal';
  document.documentElement.dataset.menuTheme = menuTheme(settings.menuTheme);
}
