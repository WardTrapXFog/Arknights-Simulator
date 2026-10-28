#!/usr/bin/env node
// tools/check-ui-assets.mjs —— UI 素材清单的守卫。
//
// 白名单在 tools/assets/ui-groups.mjs（UI_GROUPS「在用」/ LEGACY_GROUPS「联机遗留」）。
// 本脚本反着核对，防止清单又悄悄涨回去：
//   · 清单里出现、名单没写的分组 → 报错（plan.mjs 会照旧下载它）；
//   · 名单写了、清单里没有 → 报错（拼错或素材源改名）；
//   · 标了「在用」却在代码里找不到引用 → 报错（谎报，会把没用到的也算进刚需）。
//
// 用法：
//   node tools/check-ui-assets.mjs          只核对（不一致时以 1 退出）
//   node tools/check-ui-assets.mjs --list   打印各分组的文件数与归属

import fs from 'node:fs';
import path from 'node:path';
import { UI_GROUPS, LEGACY_GROUPS } from './assets/ui-groups.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function siteText() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'assets') walk(abs); continue; }
      if (/\.(js|css|html)$/.test(e.name)) out.push(fs.readFileSync(abs, 'utf8'));
    }
  };
  walk(path.join(ROOT, 'public'));
  return out.join('\n');
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
  const counts = {};
  for (const key of Object.keys(manifest.ui || {})) {
    const group = key.split('/')[0];
    counts[group] = (counts[group] || 0) + 1;
  }
  const total = Object.keys(manifest.ui || {}).length;

  if (process.argv.includes('--list')) {
    console.log(`data/assets.json 的 ui 共 ${total} 项，${Object.keys(counts).length} 个分组：`);
    for (const [g, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const mark = UI_GROUPS[g] ? '· 在用' : LEGACY_GROUPS[g] ? '✗ 联机遗留' : '? 未登记';
      const note = UI_GROUPS[g] ?? LEGACY_GROUPS[g] ?? '（未登记）';
      console.log(`  ${mark}  ${g.padEnd(18)} ${String(n).padStart(3)}  ${note}`);
    }
    const used = Object.keys(counts).filter((g) => UI_GROUPS[g]).length;
    console.log(`\n在用 ${used} 组，联机遗留 ${Object.keys(counts).length - used} 组。`);
    process.exit(0);
  }

  const blob = siteText();
  const problems = [];
  for (const g of Object.keys(counts)) {
    if (!UI_GROUPS[g] && !LEGACY_GROUPS[g]) problems.push(`ui 分组「${g}」既不在 UI_GROUPS 也不在 LEGACY_GROUPS（plan.mjs 会照旧下载它）`);
  }
  for (const g of Object.keys(UI_GROUPS)) {
    if (!Object.hasOwn(counts, g)) problems.push(`UI_GROUPS 里的「${g}」在 data/assets.json 里不存在（拼错，或素材源已改名）`);
  }
  // plan.mjs 的闸门必须在位：三处建叶子的入口都得走 uiAllowed。
  const planSrc = fs.readFileSync(path.join(ROOT, 'tools', 'assets', 'plan.mjs'), 'utf8');
  if (!/uiAllowed\(group\)/.test(planSrc)) problems.push('tools/assets/plan.mjs 的 addUi 没有经过 UI_GROUPS 闸门（uiAllowed）');
  if (!/uiAllowed\('statistics'\)/.test(planSrc)) problems.push("tools/assets/plan.mjs 的 statistics 分支没有经过 UI_GROUPS 闸门（uiAllowed('statistics')）");
  for (const g of Object.keys(UI_GROUPS)) {
    if (!new RegExp(`(^|[^a-zA-Z0-9_])${g}/`).test(blob)) problems.push(`UI_GROUPS 标了在用的「${g}」在代码里找不到引用（${UI_GROUPS[g]}）`);
  }

  if (problems.length) {
    console.error(`UI 素材清单检查失败（${problems.length} 条）：`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  const stale = Object.keys(counts).filter((g) => LEGACY_GROUPS[g]);
  console.log(`UI 素材清单检查通过：${total} 项素材，${Object.keys(UI_GROUPS).length} 组在用（白名单生效）。`);
  if (stale.length) {
    console.log(`  ${stale.length} 个联机遗留分组仍在 data/assets.json 里（${stale.sort().join(', ')}）；`);
    console.log('  下一次 `npm run assets` 会按新白名单重建清单，`--prune` 会顺手删掉本地文件。');
  }
}

main();
