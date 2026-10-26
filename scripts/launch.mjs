#!/usr/bin/env node
// SI launcher: start the local file server and open the workspace menu.
// node scripts/launch.mjs [--port 3100] [--host ::] [--no-open] [--no-setup]
// Dependencies and assets are not rebuilt or downloaded automatically.
// If the SI server already owns this port, reuse it and show its local URL.
// Ctrl+C stops a server started by this launcher.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
// 打开浏览器只有一份实现（走 shell 关联 = 默认浏览器，且不会把浏览器拉成提权）
import { openBrowser as openInBrowser } from './open-browser.mjs';
import { startupMessage } from './startup-message.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`Node.js ${process.versions.node} 太旧，需要 22 或更高（22 / 24 LTS）：https://nodejs.org/zh-cn/download`);
  process.exit(1);
}

const { c, mark } = await import('../tools/setup.mjs');
const { probePort } = await import('../tools/doctor.mjs');
const { applyPendingUpdate, UPDATE_FILE } = await import('../server/update.js');

export function parseArgs(argv) {
  const o = { port: Number(process.env.PORT) || 3100, host: process.env.HOST || '::', open: !/^(1|true|yes)$/i.test(process.env.SP_NO_BROWSER || ''), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--port') o.port = Number(val()) || o.port;
    else if (k === '--host') o.host = val() || o.host;
    else if (a === '--no-open') o.open = false;
    else if (a === '--no-setup') continue;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`不支持的启动参数：${a}。素材下载与本地提取请使用 npm run setup。`);
  }
  return o;
}

/** 单机服务只读取监听地址，启动器不启用插件或联机测试房间。 */
export function serverEnv(o, base = process.env) {
  const env = { ...base, PORT: String(o.port), HOST: o.host };
  return env;
}

function openBrowser(url) {
  return openInBrowser(url) !== null;
}

async function waitHealthy(port, child, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && child.exitCode === null) {
    const p = await probePort(port);
    if (p.state === 'ours') return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    const end = src.findIndex((l, i) => i > 0 && !l.startsWith('//'));
    console.log(src.slice(1, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const localUrl = `http://localhost:${o.port}`;

  const before = await probePort(o.port, o.host);
  if (before.state === 'ours') {
    console.log(startupMessage(localUrl, { reused: true }));
    if (fs.existsSync(path.join(ROOT, UPDATE_FILE))) {
      console.log(c.warn('  解压过的更新包还没有应用：正在运行的仍是旧版本。先关闭原启动窗口，再重新启动即可。'));
    }
    if (o.open) openBrowser(localUrl);
    return 0;
  }
  if (before.state !== 'free') {
    console.error(`${mark.err} 端口 ${o.port} 被其他程序占用或无权限（${before.code || before.state}）。`);
    console.error(`  换一个端口：${IS_WIN ? 'scripts\\start-windows.bat --port 3001' : 'scripts/start.sh --port 3001'}`);
    return 1;
  }

  // before setup: setup and the server then see the new version's files (its message explains a refusal)
  if (applyPendingUpdate(ROOT).state === 'failed') return 1;

  const env = serverEnv(o);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'sandbox', 'index.js')], { cwd: ROOT, env, stdio: 'inherit' });
  const forward = (sig) => { if (child.exitCode === null) { try { child.kill(sig); } catch { /* gone */ } } };
  // SIGINT reaches the server straight from the terminal (same process group / console); forwarding it too would make
  // the server's second-signal path force-exit. Other signals (service managers, `kill`) are forwarded.
  process.on('SIGINT', () => {});
  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGBREAK']) { try { process.on(sig, () => forward(sig === 'SIGBREAK' ? 'SIGTERM' : sig)); } catch { /* unsupported here */ } }

  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(code ?? (signal ? 0 : 1))));
  if (await waitHealthy(o.port, child)) {
    if (o.open && !openBrowser(localUrl)) console.log(c.dim(`（未能自动打开浏览器，请手动访问 ${localUrl}）`));
  }
  return exited;
}

// Same convention as tools/setup.mjs: the helpers above are importable, but only running this file starts anything.
// Without the guard, importing launch.mjs would fall through to main() in the background and bind a port.
function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
}
