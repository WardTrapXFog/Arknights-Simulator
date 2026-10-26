import { levelWithPreview } from './level-preview.js';
// 关卡工程的唯一数据契约，与自由沙盒的现场存档分开。
export const LEVEL_VERSION = 2;
export const LEVEL_BYTES = 512 * 1024;
export const MAX_SPAWNS = 8000;
export const MAX_SQUAD = 13;
export const MAX_ROUTE_POINTS = 24;
export const MAX_LEVELS = 60;
export const LEVELS_KEY = 'arksim-levels-v2';
export class LevelError extends Error {
  constructor(path, reason) { super(`${path}: ${reason}`); this.name = 'LevelError'; this.path = path; this.reason = reason; }
}
const fail = (p, r) => { throw new LevelError(p, r); };
function object(o, p) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail(p, '须为对象');
  for (const k of Object.keys(o)) if (['__proto__', 'prototype', 'constructor'].includes(k)) fail(`${p}.${k}`, '不允许的字段');
  return o;
}
function keys(o, allowed, p) { object(o, p); for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${p}.${k}`, '不支持此字段'); }
function num(v, p, min, max, integer = false) {
  if (typeof v !== 'number' || !Number.isFinite(v) || (integer && !Number.isInteger(v))) fail(p, integer ? '须为整数' : '须为有限数值');
  if (v < min || v > max) fail(p, `须在 ${min}–${max} 之间`);
}
function str(v, p, max = 80) { if (typeof v !== 'string' || v.length > max) fail(p, `须为不超过 ${max} 字的文本`); }
function array(v, p) { if (!Array.isArray(v)) fail(p, '须为数组'); return v; }
function tile(v, p, rows, cols) {
  if (!Array.isArray(v) || v.length !== 2) fail(p, '须为 [行, 列]');
  num(v[0], `${p}.0`, 0, rows - 1, true); num(v[1], `${p}.1`, 0, cols - 1, true);
}
function id(v, p) { str(v, p, 24); if (!/^[a-z0-9_-]{1,24}$/.test(v)) fail(p, '只允许 1–24 位小写字母、数字、下划线与短横线'); }
export const TILES = Object.freeze({ r: '地面：可部署、敌人可走', f: '空地：敌人可走、站不了人', h: '高台：只有远程能部署', X: '围墙：不可部署、敌人不通', '#': '挖空：背景洞', S: '红门：敌人出生点', E: '蓝门：敌人目标点' });
export function blankRows(rows = 19, cols = 21, rect = null) {
  const R = rect ?? { r0: 6, r1: 12, c0: 2, c1: 18 }, out = Array.from({ length: rows }, () => '#'.repeat(cols));
  for (let r = R.r0; r <= R.r1; r++) {
    const line = Array(cols).fill('#'); for (let c = R.c0; c <= R.c1; c++) line[c] = 'r';
    if (r === Math.round((R.r0 + R.r1) / 2)) { line[R.c0] = 'E'; line[R.c1] = 'S'; }
    out[r] = line.join('');
  }
  return out;
}
export function newLevel({ rows = 19, cols = 21 } = {}) {
  const rect = { r0: Math.min(6, rows - 2), r1: Math.min(12, rows - 1), c0: Math.min(2, cols - 2), c1: Math.min(18, cols - 1) };
  return { v: 2, id: `lv_${Date.now().toString(36)}`, name: '未命名关卡', meta: { difficulty: 1, tags: [], note: '' }, stage: { rows: blankRows(rows, cols, rect), rect, routes: [] }, spawns: [] };
}
function validateRoute(r, p, rows, cols, template = false) {
  keys(r, ['id', 'name', 'motion', 'start', 'end', 'checkpoints'], p);
  if (template || r.id != null) id(r.id, `${p}.id`);
  if (template || r.name != null) str(r.name, `${p}.name`, 16);
  if (!['WALK', 'FLY'].includes(r.motion)) fail(`${p}.motion`, '须为 WALK 或 FLY');
  tile(r.start, `${p}.start`, rows, cols); if (r.end != null) tile(r.end, `${p}.end`, rows, cols);
  const cps = array(r.checkpoints, `${p}.checkpoints`);
  if (cps.length > MAX_ROUTE_POINTS) fail(`${p}.checkpoints`, `检查点不能超过 ${MAX_ROUTE_POINTS} 个（含停留）`);
  cps.forEach((cp, j) => {
    const q = `${p}.checkpoints.${j}`; keys(cp, ['type', 'pos', 'time'], q);
    if (!['MOVE', 'WAIT'].includes(cp.type)) fail(`${q}.type`, '须为 MOVE 或 WAIT');
    tile(cp.pos, `${q}.pos`, rows, cols);
    if (cp.type === 'WAIT') num(cp.time, `${q}.time`, 0, 99999);
    else if (cp.time != null && cp.time !== 0) fail(`${q}.time`, 'MOVE 的停留时间须为 0');
  });
}
/** 失败抛出中文路径与原因；不迁移 v1，不修改输入。 */
export function validateLevel(input, ctx = {}) {
  object(input, 'level');
  if (input.v !== LEVEL_VERSION) fail('level.v', input.v === 1 ? '这是 v1 旧关卡，本版不再支持' : '须为版本 2');
  keys(input, ['v', 'id', 'name', 'meta', 'stage', 'spawns', 'thumbnail', 'squad'], 'level');
  str(input.id, 'level.id', 40); if (!input.id) fail('level.id', '不能为空');
  str(input.name, 'level.name', 40); if (!input.name.trim()) fail('level.name', '不能为空');
  const meta = input.meta; keys(meta, ['difficulty', 'tags', 'note', 'deployLimit', 'theme', 'bgm', 'author'], 'level.meta');
  num(meta.difficulty ?? 1, 'level.meta.difficulty', 0, 5, true);
  array(meta.tags ?? [], 'level.meta.tags').forEach((v, i) => str(v, `level.meta.tags.${i}`, 40)); str(meta.note ?? '', 'level.meta.note', 400);
  // 署名：关卡作者（可选）。协作时用来标明这关是谁做的——不参与任何玩法计算。
  if (meta.author != null) str(meta.author, 'level.meta.author', 40);
  // 作战音乐：content/music 下的文件名（可含中文与空格），空 = 不播放。播放时由客户端拼成 /music/<encodeURIComponent(name)>。
  if (meta.bgm != null) str(meta.bgm, 'level.meta.bgm', 120);
  // 部署上限：不填则沿用战斗默认（8）。集成战略关卡按官方写 6，或由作者自定。
  if (meta.deployLimit != null) num(meta.deployLimit, 'level.meta.deployLimit', 1, 13, true);
  // 主题（集成战略剧本标识，如 rogue_6）：战斗把它交给内容层作 `flags.siTheme`，特勤模组据此决定局内部分是否生效。
  if (meta.theme != null) { str(meta.theme, 'level.meta.theme', 32); if (!/^[a-z0-9_]*$/.test(meta.theme)) fail('level.meta.theme', '只允许小写字母、数字与下划线'); }
  const rows = ctx.rows ?? 19, cols = ctx.cols ?? 21, stage = input.stage;
  keys(stage, ['rows', 'rect', 'routes'], 'level.stage');
  if (array(stage.rows, 'level.stage.rows').length !== rows) fail('level.stage.rows', `须为 ${rows} 行`);
  stage.rows.forEach((s, i) => { if (typeof s !== 'string' || s.length !== cols || /[^rfhX#SE]/.test(s)) fail(`level.stage.rows.${i}`, `须为 ${cols} 个合法地形字符`); });
  const R = stage.rect; keys(R, ['r0', 'r1', 'c0', 'c1'], 'level.stage.rect');
  num(R.r0, 'level.stage.rect.r0', 0, rows - 2, true); num(R.r1, 'level.stage.rect.r1', R.r0 + 1, rows - 1, true);
  num(R.c0, 'level.stage.rect.c0', 0, cols - 2, true); num(R.c1, 'level.stage.rect.c1', R.c0 + 1, cols - 1, true);
  const routeIds = new Set();
  array(stage.routes, 'level.stage.routes').forEach((r, i) => {
    const p = `level.stage.routes.${i}`; validateRoute(r, p, rows, cols, true);
    if (routeIds.has(r.id)) fail(`${p}.id`, '路线标识重复'); routeIds.add(r.id);
  });
  const spawns = array(input.spawns, 'level.spawns');
  if (spawns.length > MAX_SPAWNS) fail('level.spawns', `这一关有 ${spawns.length} 条出生，超过 ${MAX_SPAWNS} 条的硬顶`);
  const enemyKeys = ctx.enemyKeys ? new Set(ctx.enemyKeys) : null, seen = new Set();
  spawns.forEach((s, i) => {
    const p = `level.spawns.${i}`; keys(s, ['id', 'at', 'enemy', 'route', 'pos', 'note', 'mods'], p);
    id(s.id, `${p}.id`); if (seen.has(s.id)) fail(`${p}.id`, '出生标识重复'); seen.add(s.id);
    num(s.at, `${p}.at`, 0, 3600); str(s.enemy, `${p}.enemy`, 80);
    if (!s.enemy || (enemyKeys && !enemyKeys.has(s.enemy))) fail(`${p}.enemy`, '敌人不在可用目录中');
    if (typeof s.route === 'string') { if (!routeIds.has(s.route)) fail(`${p}.route`, '引用的路线不存在'); }
    else if (s.route != null) validateRoute(s.route, `${p}.route`, rows, cols);
    else tile(s.pos, `${p}.pos`, rows, cols);
    if (s.pos != null) tile(s.pos, `${p}.pos`, rows, cols);
    if (s.note != null) str(s.note, `${p}.note`, 400);
    if (s.mods != null) { object(s.mods, `${p}.mods`); for (const [k, v] of Object.entries(s.mods)) num(v, `${p}.mods.${k}`, 0, Number.MAX_VALUE); }
  });
  // 旧 v2 文件中的 squad 不再参与关卡规则，读入后移除。
  if (new TextEncoder().encode(JSON.stringify(input)).length > LEVEL_BYTES) fail('level', '关卡文件不能超过 512 KB');
  return levelWithPreview(input);
}
export function parseLevel(text, ctx = {}) {
  if (typeof text !== 'string') fail('level', '须为 JSON 文本');
  if (new TextEncoder().encode(text).length > LEVEL_BYTES) fail('level', '关卡文件不能超过 512 KB');
  let value; try { value = JSON.parse(text); } catch { fail('level', 'JSON 格式错误'); }
  return validateLevel(value, ctx);
}
export const cloneLevel = (v) => JSON.parse(JSON.stringify(v));
export const spawnsInOrder = (level) => (level?.spawns || []).slice().sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
export function levelSpawns(level) {
  const routes = new Map(level.stage.routes.map((r) => [r.id, r]));
  const expand = (r) => cloneLevel({ motion: r.motion, start: r.start, end: r.end ?? null, checkpoints: r.checkpoints });
  return spawnsInOrder(level).map((s) => {
    const route = typeof s.route === 'string' ? routes.get(s.route) : s.route;
    return { time: s.at, enemyKey: s.enemy, count: 1, interval: 0, ...(s.mods ? { mods: cloneLevel(s.mods) } : {}),
      ...(route ? { route: expand(route) } : { pos: s.pos.slice(), route: { motion: 'WALK', start: s.pos.slice(), end: null, checkpoints: [{ type: 'WAIT', pos: s.pos.slice(), time: 99999 }] } }) };
  });
}
export const levelDuration = (level, extra = 60) => Math.ceil((level.spawns || []).reduce((m, s) => Math.max(m, s.at), 0) + extra);
