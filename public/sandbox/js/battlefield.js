// public/studio/js/sandbox/map.js — 沙盒地图（19 行 × 21 列，行 0 在最下方）。
// 字形直接写进 stage.rows：模拟器（server/sim/grid.js DEFAULT_LEGEND）与渲染器（public/js/render/style.js GLYPH）
// 读的是同一张表，所以改一个字符，地形、寻路、渲染三处一起变，地图不需要 legend。
//
// 哪些格子「算数」由战场范围决定（stage.rect → battle.rect，默认 GEO.NORMAL_RECT = 行 9–12、列 0–10）：
//   * rect 之内：字形决定能不能站人（build）与能不能走（pass）；
//   * rect 之外：引擎直接当不可部署，画面上是背景板。
// 所以「加格子」有两条路，编辑器的「战场范围」和地形笔刷各管一条：
//   1. 把 rect 撑大 —— 行/列范围变大，原来只是背景的格子变成真战场；
//   2. 在 rect 内把 # / X 刷成地面 —— 地面（r）可站可走，空地（f）可走不可站，高台（h）只收远程。

export const ROWS = 19;
export const COLS = 21;

/** 默认战场范围（与引擎 GEO.NORMAL_RECT 一致）。 */
export const DEFAULT_RECT = Object.freeze({ r0: 9, r1: 12, c0: 0, c1: 10 });

/**
 * 地形笔刷。g = 写进 rows 的字符，ico / cls 只给工具箱的图块按钮用。
 * build：能否部署（ALL 都可 / RANGED 只收远程 / NONE 不行）；pass：敌人能否通过（ALL / FLY 只有飞行 / NONE）。
 */
export const TERRAIN = Object.freeze([
  { g: 'r', label: '地面', ico: '▦', cls: 'terr--r', hint: '可部署（近战/远程都行），敌人可通行 —— 想要新格子就刷它' },
  { g: 'f', label: '空地', ico: '▤', cls: 'terr--f', hint: '敌人可通行，但站不了人（原作的 floor）' },
  { g: 'h', label: '高台', ico: '⌷', cls: 'terr--h', hint: '只有远程能部署；地面敌人不能通行' },
  { g: 'X', label: '围墙', ico: '▨', cls: 'terr--X', hint: '不可部署，敌人也过不去（实心墙）' },
  { g: '#', label: '挖空', ico: '▢', cls: 'terr--0', hint: '背景洞：不可部署，地面敌人不走（飞行例外）—— 删格子用它' },
  { g: 'S', label: '红门', ico: '▼', cls: 'terr--S', hint: '敌人出生点，从这里出发走向蓝门' },
  { g: 'E', label: '蓝门', ico: '▲', cls: 'terr--E', hint: '敌人目标点，走到这里算漏怪' },
]);

const BLANK = '#'.repeat(COLS);
const WALL = 'X'.repeat(COLS);

/** 默认沙盒地图：右侧两道红门，左侧两道蓝门，中间一条通路，两处高台。 */
export function defaultStage() {
  const rows = Array.from({ length: ROWS }, () => BLANK);
  rows[8] = WALL;
  rows[9] = '##ErrrrrrrS##########';
  rows[10] = '##hrrrrrrrf##########';
  rows[11] = '##hrrrrrrrf##########';
  rows[12] = '##ErrrrrrrS##########';
  rows[13] = WALL;
  return { id: 'sandbox', name: '沙盒', rows, rect: { ...DEFAULT_RECT }, devices: [] };
}

/** 自由沙盒的新地图：保留原空白战场的 8×17 可编辑范围。 */
export function newStage() {
  const rect = { r0: 7, r1: 14, c0: 2, c1: 18 };
  const rows = Array.from({ length: ROWS }, () => BLANK);
  for (let r = rect.r0; r <= rect.r1; r++) rows[r] = '##' + 'r'.repeat(17) + '##';
  rows[11] = '##E' + 'r'.repeat(15) + 'S##';
  return { id: 'sandbox', name: '自由沙盒', rows, rect, devices: [] };
}

/** 改一格地形，返回新的 stage（原对象不动，方便脏检查）。 */
export function paintTile(stage, r, c, g) {
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= ROWS || c < 0 || c >= COLS) return stage;
  const line = stage.rows[r] ?? '';
  if (line[c] === g) return stage;
  const rows = stage.rows.slice();
  rows[r] = line.slice(0, c) + g + line.slice(c + 1);
  return { ...stage, rows };
}

/** 战场范围：整数、不越界、不倒置，最小 2×2（再小地图就没地方站人了）。 */
export function normRect(rect) {
  const pick = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  };
  const r0 = pick(rect?.r0, 0, ROWS - 2, DEFAULT_RECT.r0);
  const r1 = pick(rect?.r1, r0 + 1, ROWS - 1, DEFAULT_RECT.r1);
  const c0 = pick(rect?.c0, 0, COLS - 2, DEFAULT_RECT.c0);
  const c1 = pick(rect?.c1, c0 + 1, COLS - 1, DEFAULT_RECT.c1);
  return { r0, r1, c0, c1 };
}

/** 改战场范围（不改地形），返回新的 stage。 */
export function setRect(stage, rect) {
  const next = normRect(rect);
  const cur = normRect(stage.rect);
  if (next.r0 === cur.r0 && next.r1 === cur.r1 && next.c0 === cur.c0 && next.c1 === cur.c1) return stage;
  return { ...stage, rect: next };
}

/** 全图的红门（S）与蓝门（E）坐标，行序从上到下。 */
export function gatesOf(stage) {
  const starts = [];
  const ends = [];
  for (let r = 0; r < ROWS; r++) {
    const line = stage.rows[r] ?? '';
    for (let c = 0; c < COLS; c++) {
      if (line[c] === 'S') starts.push([r, c]);
      else if (line[c] === 'E') ends.push([r, c]);
    }
  }
  return { starts, ends };
}

/**
 * 敌人路线：每道红门一条，终点是第一道蓝门。
 * 只给起点和终点——实际路径由引擎的官方 SPFA 流场现场算（server/sim/grid.js waypoints），
 * 所以改完地形重建战斗，行进路线自动重算。
 */
export function routesOf(stage) {
  const { starts, ends } = gatesOf(stage);
  if (!starts.length || !ends.length) return [];
  return starts.map(([r, c]) => ({ motion: 'WALK', start: [r, c], end: [ends[0][0], ends[0][1]], checkpoints: [] }));
}

/** 红门可读标签，例如 "红门 1 · 行9 列10"。 */
export function gateLabel(pos, i) {
  return `红门 ${i + 1} · 行${pos[0]} 列${pos[1]}`;
}

/** 引擎字形语义（server/sim/grid.js DEFAULT_LEGEND 里与编辑器相关的几个）。 */
const STAND = new Set(['r', 'h', 'b']);     // build !== NONE：能站人（h 只收远程）
const GROUND = new Set(['r', 'f', 'S', 'E']); // pass === 'ALL'：地面敌人能走

/** 地图体检：给编辑器用的诊断（战场范围里可站 / 可走的格子数、红蓝门数、以及有没有路）。 */
export function mapDigest(stage) {
  const R = normRect(stage.rect);
  let cells = 0, stand = 0, ground = 0;
  for (let r = R.r0; r <= R.r1; r++) {
    const line = stage.rows[r] ?? '';
    for (let c = R.c0; c <= R.c1; c++) {
      cells++;
      const g = line[c];
      if (STAND.has(g)) stand++;
      if (GROUND.has(g)) ground++;
    }
  }
  const { starts, ends } = gatesOf(stage);
  return { rect: R, cells, stand, ground, starts: starts.length, ends: ends.length, routed: !!(starts.length && ends.length) };
}
