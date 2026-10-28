#!/usr/bin/env node
// tools/check-session-boundary.mjs —— 会话边界的守卫。
//
// 背景：界面原来直接读引擎的 `_pending`、`_deploy`、`hand`、`players` 等内部成员，
// 引擎一换就要改几十处。现在这些访问统一收进 public/sandbox/js/session.js 的门面里，
// 这个脚本替人守着那条线：**门面外不许出现对引擎实例的私有访问**。
//
// 检查两类东西（都在 public/sandbox/js/ 下，session.js 与 battle-session.js 自身除外）：
//   1. `battle._xxx` / `battle.hand` / `battle.players` / `battle.allyUnits` / `battle.enemies`
//      这类引擎内部成员读取；
//   2. 从 './battle-session.js' 导入 `battle` / `runner` 这两个过渡出口。
//
// 用法：node tools/check-session-boundary.mjs     有违规时以 1 退出

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'public', 'sandbox', 'js');
/** 门面自己当然可以碰引擎；battle-session.js 是过渡出口，暂时豁免。 */
const EXEMPT = new Set(['session.js', 'battle-session.js']);

/** 引擎内部成员：出现在 `battle.` 后面就是越界。 */
const ENGINE_MEMBERS = ['_pending', '_deploy', '_occ', '_remove', '_checkEnd', '_createAllyFromInput', '_setupUnit',
  '_processSpawns', '_queueSpawn', 'hand', 'players', 'allyUnits', 'enemies'];

const PRIVATE = new RegExp(`(?:battle|b)\\??\\.(${ENGINE_MEMBERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`);
const LEGACY_IMPORT = /import\s*\{[^}]*\b(battle|runner)\b[^}]*\}\s*from\s*['"]\.\/battle-session\.js['"]/;

const problems = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(abs); continue; }
    if (!entry.name.endsWith('.js')) continue;
    if (EXEMPT.has(path.relative(DIR, abs).replaceAll('\\', '/'))) continue;
    const rel = path.relative(ROOT, abs).replaceAll('\\', '/');
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // 注释行不算：它们描述的是历史或契约，不是访问。
      const code = line.replace(/\/\/.*$/, '');
      if (!code.trim()) return;
      const m = PRIVATE.exec(code);
      if (m) problems.push(`${rel}:${i + 1} 直接读引擎成员 \`${m[0]}\`，请改用 session 门面`);
      if (LEGACY_IMPORT.test(code)) problems.push(`${rel}:${i + 1} 从 battle-session.js 导入 battle/runner，请改用 session`);
    });
  }
}

walk(DIR);

if (problems.length) {
  console.error(`会话边界检查失败（${problems.length} 处）：`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('会话边界检查通过：门面外没有直接访问引擎内部成员。');
