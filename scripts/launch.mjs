#!/usr/bin/env node
// SI launcher: start the local file server and open the workspace menu.
// node scripts/launch.mjs [--port 3100] [--host ::] [--no-open] [--no-setup]
// Dependencies and assets are not rebuilt or downloaded automatically.
// If the SI server already owns this port, reuse it and show its local URL.
// Ctrl+C stops a server started by this launcher.

import { spawn, spawnSync } from 'node:child_process';
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
const { parseTestModeEnv, testModeGate, unrecognizedTestMode } = await import('../server/testMode.js');

/** The values --scripts takes: off, or a mode server/plugins/policy.js reads from SP_PLUGIN_SCRIPTS. */
export const SCRIPT_MODES = Object.freeze(['off', 'sandbox', 'trusted', 'trusted-force']);
/** The values --test-mode takes. `1` is the local/LAN switch; `force` is the public-listener override. */
export const TEST_MODE_FLAGS = Object.freeze(['off', '1', 'force']);

export function parseArgs(argv) {
  const o = { port: Number(process.env.PORT) || 3100, host: process.env.HOST || '::', open: !/^(1|true|yes)$/i.test(process.env.SP_NO_BROWSER || ''), setup: false, setupArgs: [], help: false, scripts: undefined, testMode: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--port') o.port = Number(val()) || o.port;
    else if (k === '--host') o.host = val() || o.host;
    else if (a === '--no-open') o.open = false;
    else if (a === '--no-setup') o.setup = false;
    else if (k === '--scripts') o.scripts = val() ?? '';
    else if (k === '--test-mode') o.testMode = v !== undefined ? v : argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : '1';
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--game') o.setupArgs.push(a, argv[++i] ?? '');
    else o.setupArgs.push(a);
  }
  return o;
}

/** The server's environment: PORT / HOST, SP_PLUGIN_SCRIPTS from --scripts, SP_TEST_MODE from --test-mode (off removes an inherited one). */
export function serverEnv(o, base = process.env) {
  const env = { ...base, PORT: String(o.port), HOST: o.host };
  if (o.scripts === 'off') delete env.SP_PLUGIN_SCRIPTS;
  else if (o.scripts) env.SP_PLUGIN_SCRIPTS = o.scripts;
  if (o.testMode === 'off') delete env.SP_TEST_MODE;
  else if (o.testMode) env.SP_TEST_MODE = o.testMode;
  return env;
}

function openBrowser(url) {
  return openInBrowser(url) !== null;
}

/**
 * Chinese startup hint for a refused `1` or an unrecognised SP_TEST_MODE. `interfaces` is a test snapshot.
 * @param {{ host?: string }} o @param {NodeJS.ProcessEnv} env @param {{ warn?: (s: string) => void }} [log]
 * @param {object} [interfaces]
 */
export function warnTestMode(o, env, log = console, interfaces) {
  const raw = env && env.SP_TEST_MODE;
  const unknown = unrecognizedTestMode(raw);
  if (unknown) { log.warn?.(unknown); return; }
  const mode = parseTestModeEnv(raw);
  if (mode === 'off') return;
  const gate = testModeGate(mode, o && o.host, interfaces);
  if (gate.warn && mode === 'local') log.warn?.(gate.warn);
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
  if (o.scripts !== undefined && !SCRIPT_MODES.includes(o.scripts)) {
    console.error(`${mark.err} --scripts 只接受 ${SCRIPT_MODES.join(' / ')}（插件脚本模式，docs/PLUGINS.md §13） · --scripts takes ${SCRIPT_MODES.join(' / ')}`);
    return 2;
  }
  if (o.testMode !== undefined && !TEST_MODE_FLAGS.includes(o.testMode)) {
    console.error(`${mark.err} --test-mode 只接受 ${TEST_MODE_FLAGS.join(' / ')}（测试房间，docs/DEPLOY.md） · --test-mode takes ${TEST_MODE_FLAGS.join(' / ')}`);
    return 2;
  }
  const localUrl = `http://localhost:${o.port}`;

  const before = await probePort(o.port, o.host);
  if (before.state === 'ours') {
    console.log(startupMessage(localUrl, { reused: true }));
    if (o.scripts !== undefined) console.log(c.warn(`  --scripts ${o.scripts} 不会改变正在运行的服务器：先停止它（关掉它的窗口），再重新启动。`));
    if (o.testMode !== undefined) console.log(c.warn(`  --test-mode ${o.testMode} 不会改变正在运行的服务器：先停止它（关掉它的窗口），再重新启动。`));
    if (fs.existsSync(path.join(ROOT, UPDATE_FILE))) {
      console.log(c.warn(`  解压过的更新包还没有应用：正在运行的仍是旧版本。先停止它（关掉它的窗口；开机自启用 install-service-windows.ps1 -Restart），再重新启动即可。`));
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

  if (o.setup) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'setup.mjs'), '--quiet', ...o.setupArgs], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) { console.error(`${mark.err} 准备步骤失败（见上方）。`); return r.status || 1; }
  }

  const env = serverEnv(o);
  warnTestMode(o, env);
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
