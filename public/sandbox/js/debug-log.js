// public/sandbox/js/debug-log.js — 局外交互日志（启动器 --debug 时开启）。
//
// 为什么单独一个模块：游戏窗口（music-shell）和工作区 iframe 分属两个文档，各自的 console 在开发者工具里是
// 不同上下文。开启后除了 console，还会把同一批日志 POST 到服务端的 /api/log，由启动窗口按时间顺序打出来，
// 「点了一下没反应」这类问题就能直接对着窗口里的时间线看是哪一步断掉的。
//
// 开关优先级：localStorage 的 arksim-debug=1/0 > 服务端 /api/debug（来自启动参数）。开关取回之前只在内存里
// 缓冲、不写 console 也不发请求，取回后一次性补发 —— 既不丢启动阶段的记录，关闭调试时也没有任何多余请求。

const STORAGE_KEY = 'arksim-debug';
const ENDPOINT = '/api/log';
const MAX_OUTBOX = 240;
const FLUSH_DELAY = 350;
const startedAt = performance.now();

let enabled = false;
let settled = false;
let pending = [];
let outbox = [];
let flushTimer = 0;

function flush() {
  flushTimer = 0;
  if (!outbox.length) return;
  const lines = outbox.splice(0, 60);
  // keepalive：切页/关窗时也要把这批日志送出去
  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines }),
    keepalive: true,
  }).catch(() => { /* 服务端已关闭，日志只留在 console */ });
  if (outbox.length) scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_DELAY);
}

function record(line) {
  console.log(line);
  outbox.push(line);
  if (outbox.length > MAX_OUTBOX) outbox.splice(0, outbox.length - MAX_OUTBOX);
  scheduleFlush();
}

/** 当前是否输出日志（服务端状态未取回时先按开启处理，先攒着）。 */
export function debugEnabled() { return settled ? enabled : true; }

function settle(value) {
  enabled = value === true;
  settled = true;
  const buffered = pending; pending = [];
  if (!enabled) return;
  for (const line of buffered) record(line);
}

const localFlag = (() => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === null ? null : value === '1';
  } catch { return null; }
})();

if (localFlag !== null) settle(localFlag);
else void fetch('/api/debug', { cache: 'no-store' })
  .then((response) => (response.ok ? response.json() : null))
  .then((body) => settle(body?.debug === true))
  .catch(() => settle(false));

function describe(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** 写一行交互日志：debugLog('导航', 'console → play', { ms: 12 })。 */
export function debugLog(scope, ...parts) {
  if (!debugEnabled()) return;
  const line = `[SI ${((performance.now() - startedAt) / 1000).toFixed(3)}] ${scope} · ${parts.map(describe).join(' ').slice(0, 400)}`;
  if (!settled) { pending.push(line); if (pending.length > MAX_OUTBOX) pending.shift(); return; }
  if (enabled) record(line);
}

/** 量一段耗时：const done = debugTimer('启动', 'play boot'); ... done(); */
export function debugTimer(scope, label) {
  const begin = performance.now();
  debugLog(scope, `${label} 开始`);
  return () => debugLog(scope, `${label} 完成 ${(performance.now() - begin).toFixed(1)}ms`);
}

/** 元素的简短描述，用于点击日志。 */
export function describeNode(node) {
  if (!node) return '?';
  const name = node.tagName ? node.tagName.toLowerCase() : String(node);
  const attrs = [];
  for (const key of ['data-terminal-back', 'data-terminal-link', 'data-terminal-settings', 'data-terminal-music', 'data-save', 'data-action', 'data-level', 'data-slot']) {
    if (node.hasAttribute?.(key)) attrs.push(`${key}=${node.getAttribute(key) || 'y'}`);
  }
  if (node.getAttribute?.('href')) attrs.push(`href=${node.getAttribute('href')}`);
  const text = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return `${name}${attrs.length ? `[${attrs.join(' ')}]` : ''}${text ? `「${text}」` : ''}`;
}
