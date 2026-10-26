const SVG = {
  skull: "<path d='M12 2a8.5 8.5 0 0 0-5 15.4V21h3v-2h1v2h2v-2h1v2h3v-3.6A8.5 8.5 0 0 0 12 2zM8.5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'/>",
  // 镂空骷髅（Tab「刷敌人」）：一条 evenodd 路径，眼窝 / 鼻腔是挖空的洞，下颌底边本身走成两个向上的齿缝，
  // 底下的玻璃底板会透上来，所以看着是「透过骷髅看见后面的墙」而不是一块实心色块。
  skullHollow: "<path fill-rule='evenodd' d='M12 2.6c-4.7 0-8.5 3.4-8.5 7.9 0 2.6 1.3 4.3 2.7 5.3.6.4.9 1 .9 1.7v2.7c0 .83.67 1.5 1.5 1.5h.9v-2.1h1.7v2.1h1.6v-2.1h1.7v2.1h.9c.83 0 1.5-.67 1.5-1.5v-2.7c0-.7.3-1.3.9-1.7 1.4-1 2.7-2.7 2.7-5.3 0-4.5-3.8-7.9-8.5-7.9zM8.9 8.85a2.05 2.05 0 1 0 0 4.1 2.05 2.05 0 0 0 0-4.1zM15.1 8.85a2.05 2.05 0 1 0 0 4.1 2.05 2.05 0 0 0 0-4.1zM12 13.1l1.3 2.5h-2.6z'/>",
  clock: "<path d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5.2v5.1l3.6 2.1-.9 1.6-4.7-2.7V7.2z'/>",
  pause: "<path d='M7 4h4v16H7zM13 4h4v16h-4z'/>",
  play: "<path d='M8 4l12 8-12 8z'/>",
  step: "<path d='M6 4l9 8-9 8zM17 4h2v16h-2z'/>",
  step1s: "<path d='M4 4l8 8-8 8zM13 4l8 8-8 8z'/>",
  reset: "<path d='M12 5V1.6L6.6 6 12 10.4V7a5 5 0 1 1-5 5H4a8 8 0 1 0 8-7z'/>",
  // 攻击范围：3×3 的实心小格（对应本体的「攻击范围」按钮图标）。
  // 用 9 个独立方块、块间留 1 单位缝，缩小到 .14rem 也还认得出是「一片格子」而不是一团色块。
  rangeGrid: [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) =>
    `<rect x='${2.5 + c * 6.6}' y='${2.5 + r * 6.6}' width='5.4' height='5.4' rx='.6'/>`)).join(''),
};

export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SVG[name] || ''}</svg>`;

// 线框图标（工具箱的 Tab）：比 emoji 稳，颜色跟着 currentColor 走
// 三个 Tab 的语义要对得上「点进去干什么」，别按英文单词直译：
//   刷敌人 = 骷髅（暗红镂空，见下方 CSS 的 .dr__tab--enemy）；排波次 = 一波接一波推进的箭头；
//   改地形 = 等轴立方体（就是地图上那一个个格子）。
const STROKE = {
  // 三连向右箭头：一批接一批压上来（原来画的是海浪，wave 直译，读不出「波次」）
  waveRanks: "<path d='M4 7.6 8 12l-4 4.4'/><path d='M10 7.6 14 12l-4 4.4'/><path d='M16 7.6 20 12l-4 4.4'/>",
  // 等轴立方体：顶面菱形 + 三条竖棱 + 底边
  cube: "<path d='M12 3.1 20.2 7.8 12 12.5 3.8 7.8z'/><path d='M3.8 7.8v8.4L12 20.9l8.2-4.7V7.8'/><path d='M12 12.5v8.4'/>",
  // 眼睛加斜杠（隐藏）。UI 规范：只要是「关掉可见性」，就别用字母占位。
  eyeOff: "<path d='M2.6 12c2.1-3.9 5.4-6 9.4-6s7.3 2.1 9.4 6c-2.1 3.9-5.4 6-9.4 6s-7.3-2.1-9.4-6z'/><path d='M12 9.1a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8z'/><path d='M4.2 4.2 19.8 19.8'/>",
  // 出门箭头（面板上的「撤退」）：一个开口的门框 + 向外的箭头，读作「离场」，不是「删除」
  leave: "<path d='M14.5 4.2h4.3a1 1 0 0 1 1 1v13.6a1 1 0 0 1-1 1h-4.3'/><path d='M4.2 12h10.2'/><path d='M10.6 8.2 14.4 12l-3.8 3.8'/>",
};
export const iconStroke = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STROKE[name] || ''}</svg>`;

/** 攻击范围按钮里的 3×3 网格（实心，和本体那个按钮一致）。 */
export const rangeGridIcon = () => icon('rangeGrid');

