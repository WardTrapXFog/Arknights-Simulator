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
  const { port, host } = listenAddress({ ...opts, port: opts.port ?? Number(process.env.PORT || 3100) });
  const log = opts.log || makeLogger(!!opts.quiet), cache = new CompressCache();
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
    if (typeof name !== 'string' || !LEVEL_FILE.test(name)) return null;
    const abs = path.join(levelsDir, name);
    return abs.startsWith(levelsDir + path.sep) ? abs : null;
  };
  /** 目录里的关卡文件（按名字排序，跳过隐藏文件）。 */
  async function levelNames() {
    try {
      const names = await fs.readdir(levelsDir);
      return names.filter((n) => LEVEL_FILE.test(n) && !n.startsWith('.')).sort((a, b) => a.localeCompare(b, 'zh'));
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

  async function handle(req, res) {
    setSecurityHeaders(res);
    res.setHeader('Content-Security-Policy', csp);
    if (!req.url || req.url.length > 4096) return sendError(req, res, 414, '请求地址过长');
    const parts = splitUrl(req.url);
    if (!parts) return sendError(req, res, 400, '请求地址无效');
    // 关卡库是唯一允许写入的接口（编辑器保存/删除）；其余一律只读
    const levelPath = parts.rawPath.startsWith('/api/levels') ? parts.rawPath.slice('/api/levels'.length) : null;
    const isLevelWrite = levelPath != null && (req.method === 'PUT' || req.method === 'DELETE' || req.method === 'POST');
    if (!isLevelWrite && req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return sendError(req, res, 405, '仅支持读取'); }
    if (parts.rawPath === '/') { res.writeHead(302, { Location: '/studio/home.html', 'Cache-Control': 'no-store' }); res.end(); return; }
    if (parts.rawPath === '/healthz') return sendJson(req, res, 200, { ok: true, mode: 'sandbox', app: APP_VERSION, version: PROTOCOL_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
    if (parts.rawPath === '/api/music') return sendJson(req, res, 200, { files: await musicFiles() });
    if (parts.rawPath === '/api/menu-music') {
      let config = {};
      try { config = JSON.parse(await fs.readFile(path.join(ROOT, 'content', 'menu-music.json'), 'utf8')); } catch { /* No configured menu tracks. */ }
      const available = new Map((await musicFiles()).map((file) => [file.name, file.url]));
      const tracks = (Array.isArray(config.tracks) ? config.tracks : []).filter((track) => track && available.has(track.file))
        .map((track) => ({ name: String(track.name || track.file), url: available.get(track.file),
          scenes: Array.isArray(track.scenes) ? track.scenes.filter((id) => ['home', 'sandbox', 'play', 'editor'].includes(id)) : [] }));
      return sendJson(req, res, 200, { tracks });
    }
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
    if (mountName === 'music' && !MUSIC_EXT.has(path.extname(pathname).toLowerCase())) return sendError(req, res, 404, '文件不存在');
    if ((mountName === 'sim' && (path.extname(pathname) !== '.js' || /nodedata\.js$/i.test(pathname))) || (mountName === 'data' && path.extname(pathname) !== '.json')) return sendError(req, res, 404, '文件不存在');
    const candidate = path.join(root, ...relative);
    const files = media && !path.extname(candidate) ? [candidate + '.mp3', candidate + '.ogg'] : [candidate];
    for (const file of files) {
      try {
        const real = await fs.realpath(file), rel = path.relative(await fs.realpath(root), real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
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
