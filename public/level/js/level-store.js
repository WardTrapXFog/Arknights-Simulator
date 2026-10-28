import { levelWithPreview } from '../../../shared/level-preview.js';
// 关卡库的读写（服务端目录 content/levels/，不再是浏览器缓存）。
//
// 一个关卡 = 一个 JSON 文件。编辑器启动时 GET /api/levels 把所有关卡拉进内存（一次请求），
// 之后 listLevels 这类同步接口照旧从内存读；保存/删除则 PUT / DELETE 回目录。
// 这样既保持了界面代码的同步调用方式，又让磁盘上的文件成为唯一真源：
// 改完保存即产生 git diff，换浏览器、清缓存都不会丢。
//
// 身份分三处，各有唯一的职责，互不覆盖：
//   文件名 = 关卡名（name），玩家在编辑器里改的就是它；改名保存时服务端做一次 rename。
//   id     = 英文半角指纹（lv_<时间>_<随机>），创建时生成，此后不随保存改变；只用于 URL 与内存查找。
import { MAX_LEVELS, LevelError, cloneLevel, newLevel, newLevelId, parseLevel, validateLevel, levelNameProblem, levelFileName } from "../../../shared/level.js";

/** 内存里的关卡表；boot 时由 loadLevels() 填。 */
let levels = [];
/** 关卡 id → 目录里的文件名。保存时写回原文件；名字变了就改名过去。 */
const files = new Map();
/** 文件名 → 关卡 id，用来挡住「两关同名」。 */
const owners = new Map();
/** 最近一次写盘失败的原因，界面用来提示。 */
let lastError = '';

const API = '/api/levels';
const stemOf = (file) => String(file).replace(/\.json$/i, '');

/** 新关卡的 id：撞上库里已有 id 就重抽（时间相同、随机后缀碰巧相同的情况）。 */
function freshId() {
  let id = newLevelId();
  for (let i = 0; i < 8 && files.has(id); i++) id = newLevelId();
  return id;
}

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
    owners.clear();
    return [];
  }
  levels = [];
  files.clear();
  owners.clear();
  const skipped = [];
  for (const entry of data.levels || []) {
    const stem = stemOf(entry.file);
    if (entry.file === 'manifest.json') continue;
    let lv;
    try {
      // 文件名是关卡名的唯一真源：文件被手动改过名，读进来就按新名字显示，
      // 不会在库里留下「显示名与文件名不一致」的第二份真相。
      lv = validateLevel({ ...entry.level, name: stem }, ctx);
    } catch (e) {
      skipped.push(`${entry.file}：${e.reason || e.message}`);
      continue;
    }
    if (files.has(lv.id)) { skipped.push(`${entry.file}：关卡 id ${lv.id} 与另一个文件重复（同一关的副本请用编辑器「另存为」，不要直接复制文件）`); continue; }
    if (owners.has(stem.toLowerCase())) { skipped.push(`${entry.file}：文件名重复`); continue; }
    levels.push(lv);
    files.set(lv.id, entry.file);
    owners.set(stem.toLowerCase(), lv.id);
  }
  if (skipped.length) lastError = `有 ${skipped.length} 个关卡文件没能读入：\n${skipped.join('\n')}`;
  levels.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return levels;
}

export function lastLevelsError() { return lastError; }

/** 读全部关卡；无效的关卡文件不会阻塞其他关卡的读取。 */
export function listLevels() {
  return levels.slice();
}

/** 关卡名（= 文件名主干）是否已被别的关卡占用。按小写比：Windows 上只差大小写的两个文件名是同一个文件。 */
export function nameTaken(name, exceptId = '') {
  const owner = owners.get(String(name).toLowerCase());
  return owner != null && owner !== exceptId;
}

/** 给一个还没被占用的名字：原名、原名 2、原名 3…… */
export function uniqueName(base, exceptId = '') {
  const root = String(base || '未命名关卡').slice(0, 34);
  if (!nameTaken(root, exceptId) && !levelNameProblem(root)) return root;
  for (let i = 2; i < 100; i++) {
    const candidate = `${root} ${i}`;
    if (!nameTaken(candidate, exceptId) && !levelNameProblem(candidate)) return candidate;
  }
  throw new LevelError('level.name', '找不到可用的关卡名');
}

async function put(level, previous) {
  const file = levelFileName(level);
  // 名字变了就用 ?from=旧文件名 让服务端做一次原子 rename，避免「写新 + 删旧」中间失败留下两份。
  const query = previous && previous !== file ? `?from=${encodeURIComponent(previous)}` : '';
  try {
    const res = await fetch(`${API}/${encodeURIComponent(file)}${query}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(level),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 409) throw new Error('关卡库里已经有同名的关卡了，先改个名字');
      throw new Error(body?.error || `HTTP ${res.status}`);
    }
    const previousKey = previous ? stemOf(previous).toLowerCase() : '';
    if (previous && previous !== file && owners.get(previousKey) === level.id) owners.delete(previousKey);
    files.set(level.id, file);
    owners.set(stemOf(file).toLowerCase(), level.id);
    lastError = '';
    return true;
  } catch (e) {
    lastError = `保存失败：${e.message}（改动只在内存里，刷新会丢）`;
    return false;
  }
}

async function remove(level) {
  const file = files.get(level.id);
  if (!file) return;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(file)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    files.delete(level.id);
    owners.delete(stemOf(file).toLowerCase());
    lastError = '';
  } catch (e) {
    lastError = `删除失败：${e.message}`;
  }
}

function commit(level, { wait }) {
  const copy = cloneLevel(level);
  const apply = () => {
    const i = levels.findIndex((x) => x.id === copy.id);
    if (i >= 0) levels[i] = copy; else levels.push(copy);
    levels.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  };
  const previous = files.get(copy.id);
  // 等待写盘的那条路径先落盘再改内存：改名撞车（409）时内存里不会留下一个并不存在的名字。
  if (wait) return put(copy, previous).then((ok) => { if (!ok) throw new Error(lastError); apply(); return copy; });
  apply();
  // 不等待的路径（新建、复制）写完发现失败时把内存退回去，别留一条磁盘上没有的关卡。
  void put(copy, previous).then((ok) => {
    if (ok) return;
    levels = levels.filter((x) => x.id !== copy.id);
  });
  return levels.slice();
}

/**
 * 保存（同 id 覆盖，否则追加）。名字变了就把磁盘上的文件改名过去。
 * 默认不等待写盘，返回保存后的整张列表；`wait` 为真时返回 Promise<关卡>。
 */
export function saveLevel(level, ctx = {}, { wait = false } = {}) {
  level = validateLevel(level, ctx);
  if (nameTaken(level.name, level.id)) throw new LevelError('level.name', `已经有叫「${level.name}」的关卡了`);
  if (levels.length >= MAX_LEVELS && !levels.some((x) => x.id === level.id)) {
    throw new LevelError('levels', `关卡库最多保存 ${MAX_LEVELS} 关`);
  }
  return commit(level, { wait });
}

/**
 * 另存为：拿一个新 id 和新名字写成新文件，原关卡一个字不动。
 * 返回 Promise<保存后的新关卡>，界面随后把编辑对象切到它。
 */
export async function saveLevelAs(level, ctx = {}, name) {
  const copy = cloneLevel(level);
  copy.id = freshId();
  copy.name = name;
  const saved = await saveLevel(copy, ctx, { wait: true });
  return saved;
}

export function deleteLevel(id) {
  const gone = levels.find((x) => x.id === id);
  levels = levels.filter((x) => x.id !== id);
  if (gone) void remove(gone);
  return levels.slice();
}

export function duplicateLevel(id, ctx = {}) {
  const src = levels.find((x) => x.id === id);
  if (!src) return levels.slice();
  const copy = cloneLevel(src);
  copy.id = freshId();
  copy.name = uniqueName(`${src.name} 副本`);
  return saveLevel(copy, ctx);
}

/** 新建一关并立刻存下，返回它。 */
export function createLevel({ name = '未命名关卡', rows, cols } = {}, ctx = {}) {
  const level = newLevel({ rows, cols });
  level.name = uniqueName(name);
  saveLevel(level, ctx);
  return level;
}

/** 导出成文本（给"下载 JSON"用）。 */
export const exportLevel = (level) => JSON.stringify(levelWithPreview(level), null, 2);

/**
 * 从文本导入；校验失败抛 LevelError，界面显示 path。写盘完成才返回解析后的关卡。
 * id 撞上库里已有的关卡时不报错：`mode` 为 'copy'（默认）会换一个新 id 存成另一关，
 * 为 'overwrite' 则当作同一关覆盖。名字撞了自动让开（原名 2、原名 3……），不静默覆盖别人的文件。
 */
export async function importLevel(text, ctx = {}, { mode = 'copy', name } = {}) {
  const level = parseLevel(text, ctx);
  const same = levels.find((x) => x.id === level.id) || null;
  if (same && mode !== 'overwrite') level.id = freshId();
  if (name) level.name = name;
  if (nameTaken(level.name, same && mode === 'overwrite' ? same.id : '')) level.name = uniqueName(level.name);
  return saveLevel(level, ctx, { wait: true });
}

/** 库里已有的同一关（导入时用来提示）。 */
export const findLevel = (id) => levels.find((x) => x.id === id) || null;

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
export async function importLevelFromUrl(url, ctx = {}, options = {}) {
  return importLevel(await fetchLevelText(url), ctx, options);
}
