// public/studio/js/sandbox/ui/common.js — HUD 小工具（从 hud.js 抽出，供 ui 内各模块共用）。
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const fmtTime = (t) => {
  const s = Math.max(0, Math.floor(Number(t) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
