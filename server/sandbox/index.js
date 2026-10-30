import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ROOT, listenAddress, bindCandidates, makeLogger } from '../http/config.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from '../http/common.js';
import { CompressCache, serveFile } from '../http/files.js';
import { DATA_SHIM_JS } from '../http/dataShim.js';
import { siteCsp } from '../http/csp.js';
import { APP_VERSION, PROTOCOL_VERSION } from '../../shared/constants.js';
import { startupMessage } from '../../scripts/startup-message.mjs';

/** SI serves files; battle simulation and editing run in the browser. */
export async function startSandboxServer(opts = {}) {
  await (await import('../../tools/aue-runtime.mjs')).ensureAueRuntime();
  const { port, host } = listenAddress({ ...opts, port: opts.port ?? Number(process.env.PORT || 3100) });
  const log = opts.log || makeLogger(!!opts.quiet), cache = new CompressCache();
  // 调试日志：启动器传 --debug 时打开，浏览器端经 /api/debug 读取，交互日志经 /api/log 回到本窗口。
  const debug = opts.debug ?? /^(1|true|yes)$/i.test(process.env.SI_DEBUG || '');
  const publicDir = path.join(ROOT, 'public'), csp = siteCsp(publicDir), startedAt = Date.now();
  const mounts = { data: path.join(ROOT, 'data'), shared: path.join(ROOT, 'shared'), sim: path.join(ROOT, 'server/sim'),
    // 作战音乐只发布 OGG；MP3 等源文件保留在本地。
    music: path.join(ROOT, 'content', 'music') };
  const MUSIC_EXT = new Set(['.ogg']);

  /* --------------------------------------------------------------------------------------------------------- */
  /* 关卡库：content/levels/*.json 是唯一真源（编辑器不再用浏览器缓存）                                          */
  /* --------------------------------------------------------------------------------------------------------- */
  const levelsDir = path.join(ROOT, 'content', 'levels');
  /** 文件名合法性：不含路径分隔符与保留字符、以 .json 结尾、不超过 80 字（中文名允许）。 */
  const LEVEL_FILE = /^[^\\/:*?"<>|\u0000-\u001f]{1,80}\.json$/;
  const MAX_LEVEL_BYTES = 600 * 1024;
  const resolveLevel = (name) => {
    if (typeof name !== 'string' || !LEVEL_FILE.test(name) || name === 'manifest.json') return null;
    const abs = path.join(levelsDir, name);
    return abs.startsWith(levelsDir + path.sep) ? abs : null;
  };
  /** 文件是否存在（关卡写入前的重名检查）。 */
  const exists = async (abs) => { try { await fs.access(abs); return true; } catch { return false; } };
  /** 写接口的错误：客户端要读 message，所以走 JSON 而不是通用错误页。 */
  const denyWrite = (req, res, status, message) => sendJson(req, res, status, { ok: false, error: message });
  /** 目录里的关卡文件（按名字排序，跳过隐藏文件与关卡库登记表 manifest.json）。 */
  async function levelNames() {
    try {
      const names = await fs.readdir(levelsDir);
      return names.filter((n) => LEVEL_FILE.test(n) && !n.startsWith('.') && n !== 'manifest.json').sort((a, b) => a.localeCompare(b, 'zh'));
    } catch { return []; }
  }
  async function readLevels() {
    const out = [];
    for (const file of await levelNames()) {
      try {
        const text = await fs.readFile(path.join(levelsDir, file), 'utf8');
        out.push({ file, level: JSON.parse(text) });
      } catch { /* 坏档跳过，不让一个坏文件毁掉整张列表 */ }
    }
    return out;
  }
  /** 读请求体（有上限，防误传大文件）。 */
  function readBody(req, cap) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > cap) { reject(new Error('too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  /** /api/music：仅列 OGG，保留 LOOPSTART/LOOPLENGTH 循环标记。 */
  async function musicFiles() {
    let names = [];
    try { names = await fs.readdir(mounts.music); } catch { return []; }
    const usable = names.filter((n) => !n.startsWith('.') && MUSIC_EXT.has(path.extname(n).toLowerCase()));
    return usable
      .sort((a, b) => a.localeCompare(b, 'zh')).map((n) => ({ name: n, url: `/music/${encodeURIComponent(n)}` }));
  }

  /**
   * 浏览器交互日志（/api/log）：浏览器端把每个文档的日志行整批发回来，统一在启动窗口里按时间顺序打出来。
   * 未开启调试时照常收下并丢弃，避免浏览器端为了判断开关而多跑一条请求路径。
   */
  function debugLines(body) {
    if (!debug) return;
    let lines;
    try { lines = JSON.parse(body)?.lines; } catch { return; }
    if (!Array.isArray(lines)) return;
    const at = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    for (const line of lines.slice(0, 80)) {
      if (typeof line === 'string') log.info(`[浏览器 ${at}] ${line.slice(0, 600)}`);
    }
  }

  async function handle(req, res) {
    setSecurityHeaders(res);
    res.setHeader('Content-Security-Policy', csp);
    if (!req.url || req.url.length > 4096) return sendError(req, res, 414, '请求地址过长');
    const parts = splitUrl(req.url);
    if (!parts) return sendError(req, res, 400, '请求地址无效');
    // 关卡库是唯一允许写入的接口（编辑器保存/删除）；调试日志另有一个只进不出的 /api/log。
    const levelPath = parts.rawPath.startsWith('/api/levels') ? parts.rawPath.slice('/api/levels'.length) : null;
    const isLevelWrite = levelPath != null && (req.method === 'PUT' || req.method === 'DELETE' || req.method === 'POST');
    if (parts.rawPath === '/api/log' && req.method === 'POST') {
      let body = '';
      try { body = await readBody(req, 64 * 1024); } catch { return sendJson(req, res, 413, { ok: false }); }
      debugLines(body);
      return sendJson(req, res, 200, { ok: true });
    }
    if (!isLevelWrite && req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return sendError(req, res, 405, '仅支持读取'); }
    if (parts.rawPath === '/') { res.writeHead(302, { Location: '/studio/home.html', 'Cache-Control': 'no-store' }); res.end(); return; }
    if (parts.rawPath === '/healthz') return sendJson(req, res, 200, { ok: true, mode: 'sandbox', app: APP_VERSION, version: PROTOCOL_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
    if (parts.rawPath === '/api/debug') return sendJson(req, res, 200, { debug });
    if (parts.rawPath === '/api/music') return sendJson(req, res, 200, { files: await musicFiles() });
    if (parts.rawPath === '/api/levels') return sendJson(req, res, 200, { levels: await readLevels() });
    if (levelPath != null && levelPath !== '/') {
      const file = decodeURIComponent(levelPath.replace(/^\//, ''));
      const abs = resolveLevel(file);
      if (!abs) return sendError(req, res, 400, '关卡文件名无效');
      if (req.method === 'PUT' || req.method === 'POST') {
        let body;
        try { body = await readBody(req, MAX_LEVEL_BYTES); } catch { return sendError(req, res, 413, '关卡文件过大'); }
        let level;
        try { level = JSON.parse(body); } catch { return sendError(req, res, 400, '不是合法 JSON'); }
        if (!level || level.v !== 2 || typeof level.id !== 'string' || typeof level.name !== 'string' || !level.stage) {
          return sendError(req, res, 400, '不是 v2 关卡');
        }
        await fs.mkdir(levelsDir, { recursive: true });
        // 改名：?from=旧文件名。先把旧文件搬到新名字（rename 是原子的），再把新内容写进去，
        // 这样改名不会出现「写新 + 删旧」中间失败留下的两份或零份。
        const from = new URLSearchParams(parts.query).get('from');
        if (from && from !== file) {
          const oldAbs = resolveLevel(from);
          if (!oldAbs) return denyWrite(req, res, 400, '原关卡文件名无效');
          if (await exists(abs)) return denyWrite(req, res, 409, '已经有同名的关卡文件了');
          try { await fs.rename(oldAbs, abs); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        } else if (await exists(abs)) {
          // 名字没变、也不是改名：目标文件属于另一关（id 不同）就是覆盖别人的关卡，拒绝。
          let current = null;
          try { current = JSON.parse(await fs.readFile(abs, 'utf8')); } catch { /* 坏档，按可覆盖处理 */ }
          if (current && current.id !== level.id) return denyWrite(req, res, 409, '这个名字已被另一张关卡占用');
        }
        // 先写临时文件再改名：中途失败不会留下半个关卡
        const tmp = `${abs}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(level, null, 1), 'utf8');
        await fs.rename(tmp, abs);
        return sendJson(req, res, 200, { ok: true, file });
      }
      if (req.method === 'DELETE') {
        try { await fs.unlink(abs); } catch { /* 本来就没有 */ }
        return sendJson(req, res, 200, { ok: true });
      }
      return sendJson(req, res, 200, { file, level: JSON.parse(await fs.readFile(abs, 'utf8')) });
    }
    if (parts.rawPath === '/data.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : DATA_SHIM_JS); return; }
    let pathname;
    try { pathname = decodeURIComponent(parts.rawPath); } catch { return sendError(req, res, 400, '请求地址无效'); }
    pathname = pathname.replace(/^\/(assets|fonts)\/~[0-9a-f]{8,64}\//, '/$1/');
    const media = pathname.startsWith('/media/');
    if (media) pathname = '/assets/audio/' + pathname.slice('/media/'.length).replace(/^~[0-9a-f]{8,64}\//, '');
    const segments = pathname.split('/').slice(1);
    if (segments.some((s) => !s || s.startsWith('.') || s.includes('\\') || s.includes(':') || s.includes('\0'))) return sendError(req, res, 404, '文件不存在');
    const mountName = Object.hasOwn(mounts, segments[0]) ? segments[0] : 'public';
    const root = mountName === 'public' ? publicDir : mounts[mountName];
    const relative = mountName === 'public' ? segments : segments.slice(1);
    if (mountName === 'music' && relative[0]?.toLowerCase() === 'original') return sendError(req, res, 404, '文件不存在');
    if (mountName === 'music' && !MUSIC_EXT.has(path.extname(pathname).toLowerCase())) return sendError(req, res, 404, '文件不存在');
    if ((mountName === 'sim' && (path.extname(pathname) !== '.js' || /nodedata\.js$/i.test(pathname))) || (mountName === 'data' && path.extname(pathname) !== '.json')) return sendError(req, res, 404, '文件不存在');
    const musicShell = mountName === 'public' && req.headers['sec-fetch-dest'] === 'document'
      && /^\/studio\/(home|console|play|level)\.html$/.test(pathname);
    const candidate = path.join(root, ...(musicShell ? ['studio', 'music-shell.html'] : relative));
    const files = media && !path.extname(candidate) ? [candidate + '.mp3', candidate + '.ogg'] : [candidate];
    for (const file of files) {
      try {
        const real = await fs.realpath(file), rel = path.relative(await fs.realpath(root), real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
        if (mountName === 'music' && rel.split(path.sep)[0].toLowerCase() === 'original') continue;
        if (mountName === 'music' && !MUSIC_EXT.has(path.extname(real).toLowerCase())) continue;
        const stat = await fs.stat(real);
        if (!stat.isFile()) continue;
        await serveFile(req, res, real, stat, mountName, segments, parts.query, cache, log, { cacheControl: 'no-cache' });
        return;
      } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e; }
    }
    sendError(req, res, 404, '文件不存在');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) sendError(req, res, 500, '文件读取失败'); else res.destroy(); });
  });
  const candidates = bindCandidates(host);
  for (let i = 0; i < candidates.length; i++) {
    try {
      await new Promise((resolve, reject) => { const onError = (e) => { server.off('listening', onListen); reject(e); }; const onListen = () => { server.off('error', onError); resolve(); }; server.once('error', onError); server.once('listening', onListen); server.listen(port, candidates[i]); });
      break;
    } catch (e) { if (i === candidates.length - 1 || e.code !== 'EAFNOSUPPORT') throw e; }
  }
  const address = server.address(), url = `http://localhost:${address.port}`;
  log.info(startupMessage(url));
  return { server, port: address.port, url, close: () => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startSandboxServer().then((app) => {
    const stop = () => { app.server.closeAllConnections(); app.close().then(() => process.exit(0)); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }).catch((e) => { console.error(`关卡模拟器启动失败：${e.code || e.message}`); process.exitCode = 1; });
}
