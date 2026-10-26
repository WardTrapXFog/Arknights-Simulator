import { levelWithPreview } from '../../../shared/level-preview.js';
// 关卡库的读写（服务端目录 content/levels/，不再是浏览器缓存）。
//
// 一个关卡 = 一个 JSON 文件。编辑器启动时 GET /api/levels 把所有关卡拉进内存（一次请求），
// 之后 listLevels 这类同步接口照旧从内存读；保存/删除则 PUT / DELETE 回目录。
// 这样既保持了界面代码的同步调用方式，又让磁盘上的文件成为唯一真源：
// 改完保存即产生 git diff，换浏览器、清缓存都不会丢。
import { MAX_LEVELS, LevelError, cloneLevel, newLevel, parseLevel, validateLevel } from "../../../shared/level.js";

/** 内存里的关卡表；boot 时由 loadLevels() 填。 */
let levels = [];
/** 关卡 id → 目录里的文件名（保存时写回原文件，避免同一关出现两份）。 */
const files = new Map();
/** 最近一次写盘失败的原因，界面用来提示。 */
let lastError = '';

const API = '/api/levels';

/** 一次请求拉齐整个关卡库。返回已通过校验的关卡数组。 */
export async function loadLevels(ctx = {}) {
  lastError = '';
  let data;
  try {
    const res = await fetch(API, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    lastError = `读取关卡目录失败：${e.message}（服务端没启动？）`;
    levels = [];
    files.clear();
    return [];
  }
  levels = [];
  files.clear();
  for (const entry of data.levels || []) {
    try {
      const lv = validateLevel(entry.level, ctx);
      levels.push(lv);
      files.set(lv.id, entry.file);
    } catch { /* 坏档跳过 */ }
  }
  levels.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return levels;
}

export function lastLevelsError() { return lastError; }

/** 读全部关卡（已通过校验的才算数，坏数据悄悄跳过，不让一个坏存档毁掉整个列表）。 */
export function listLevels() {
  return levels.slice();
}

/** 文件名：沿用已有文件名；新关卡用 id。 */
function fileNameFor(level) {
  return files.get(level.id) || `${level.id}.json`;
}

async function put(level) {
  const file = fileNameFor(level);
  try {
    const res = await fetch(`${API}/${encodeURIComponent(file)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(level),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    files.set(level.id, file);
    lastError = '';
  } catch (e) {
    lastError = `保存失败：${e.message}（改动只在内存里，刷新会丢）`;
  }
}

async function remove(level) {
  const file = files.get(level.id);
  if (!file) return;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(file)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    files.delete(level.id);
    lastError = '';
  } catch (e) {
    lastError = `删除失败：${e.message}`;
  }
}

/** 保存（同 id 覆盖，否则追加）。返回保存后的整张列表。 */
export function saveLevel(level, ctx = {}) {
  level = validateLevel(level, ctx);
  if (levels.length >= MAX_LEVELS && !levels.some((x) => x.id === level.id)) {
    throw new LevelError('levels', `关卡库最多保存 ${MAX_LEVELS} 关`);
  }
  const i = levels.findIndex((x) => x.id === level.id);
  const copy = cloneLevel(level);
  if (i >= 0) levels[i] = copy; else levels.push(copy);
  levels.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  void put(copy);
  return levels.slice();
}

export function deleteLevel(id) {
  const gone = levels.find((x) => x.id === id);
  levels = levels.filter((x) => x.id !== id);
  if (gone) void remove(gone);
  return levels.slice();
}

export function duplicateLevel(id) {
  const src = levels.find((x) => x.id === id);
  if (!src) return levels.slice();
  const copy = cloneLevel(src);
  copy.id = `lv_${Date.now().toString(36)}`;
  copy.name = `${src.name.slice(0, 37)} 副本`;
  return saveLevel(copy);
}

/** 新建一关并立刻存下，返回它。 */
export function createLevel({ name = '未命名关卡', rows, cols } = {}, ctx = {}) {
  const level = newLevel({ rows, cols });
  level.name = name;
  saveLevel(level, ctx);
  return level;
}

/** 导出成文本（给"下载 JSON"用）。 */
export const exportLevel = (level) => JSON.stringify(levelWithPreview(level), null, 2);

/** 从文本导入；校验失败抛 LevelError，界面显示 path。 */
export function importLevel(text, ctx = {}) {
  const level = parseLevel(text, ctx);
  saveLevel(level, ctx);
  return level;
}

/**
 * 从 URL 取一份关卡 JSON 文本。
 *
 * 这是「关卡放哪」这件事的解法：不用中央仓库、不用索引、不用审核——谁都能把自己的 JSON
 * 放进 gist / 自己的仓库 / 任意静态站，发个链接就行。raw.githubusercontent.com 与
 * api.github.com/gists 都带 `Access-Control-Allow-Origin: *`，浏览器可以直接 fetch。
 *
 * 只接受 http(s)；限制体积；超时 15 秒。返回文本，解析与校验交给 importLevel / parseLevel。
 */
export async function fetchLevelText(url) {
  let parsed;
  try { parsed = new URL(String(url).trim()); } catch { throw new LevelError('url', '链接格式不对'); }
  if (!/^https?:$/.test(parsed.protocol)) throw new LevelError('url', '只支持 http(s) 链接');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(parsed.href, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new LevelError('url', `服务器返回 ${res.status}`);
    const text = await res.text();
    if (text.length > 600 * 1024) throw new LevelError('url', '文件超过 600KB，不像关卡 JSON');
    return text;
  } catch (e) {
    if (e instanceof LevelError) throw e;
    if (e.name === 'AbortError') throw new LevelError('url', '请求超时（15 秒）');
    throw new LevelError('url', `取不到这个链接：${e.message}（对方站点可能没开跨域）`);
  } finally { clearTimeout(timer); }
}

/** 从 URL 直接导入并入库。 */
export async function importLevelFromUrl(url, ctx = {}) {
  return importLevel(await fetchLevelText(url), ctx);
}