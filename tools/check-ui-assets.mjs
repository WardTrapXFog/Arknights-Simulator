#!/usr/bin/env node
// tools/check-ui-assets.mjs —— UI 素材清单的守卫。
//
// 三档名单在 tools/assets/ui-groups.mjs：
//   UI_GROUPS     确定要用（代码里有引用点）
//   MAYBE_GROUPS  可能要用（项目还没引用，但属于三个核心功能会碰的界面，体积小，留着）
//   LEGACY_GROUPS 确定不用（只服务于已删除的联机功能）
// plan.mjs 的闸门放行前两档，拦下第三档。
//
// 本脚本反着核对，防止清单又悄悄涨回去：
//   · 清单里出现三档都没写的分组 → 报错（plan.mjs 会照旧下载它）；
//   · UI_GROUPS 写了、清单里没有 → 报错（拼错或素材源改名）；
//   · UI_GROUPS 标了在用的分组在代码里找不到引用 → 报错（谎报）；
//   · plan.mjs 的闸门被绕过 → 报错。
//
// 用法：
//   node tools/check-ui-assets.mjs          只核对（不一致时以 1 退出）
//   node tools/check-ui-assets.mjs --list   打印各分组的文件数、体积与档位

import fs from 'node:fs';
import path from 'node:path';
import { UI_GROUPS, MAYBE_GROUPS, LEGACY_GROUPS, KEEP_GROUPS, uiAssetAllowed } from './assets/ui-groups.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSET_UI = path.join(ROOT, 'public', 'assets', 'ui');

/** 剥掉注释：注释里的英文单词（"settle/round_info_boss_icon"）不算引用。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      let quote = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) { if (ch === quote && line[i - 1] !== '\\') quote = null; continue; }
        if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
        if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

function siteText() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'assets') walk(abs); continue; }
      if (/\.(js|css|html)$/.test(e.name)) out.push(stripComments(fs.readFileSync(abs, 'utf8')));
    }
  };
  walk(path.join(ROOT, 'public'));
  return out.join('\n');
}

/** 本地磁盘上各分组的文件数与字节数（清单未必与磁盘同步）。 */
function diskSize() {
  const out = {};
  if (!fs.existsSync(ASSET_UI)) return out;
  for (const g of fs.readdirSync(ASSET_UI)) {
    const dir = path.join(ASSET_UI, g);
    if (!fs.statSync(dir).isDirectory()) continue;
    let files = 0, bytes = 0;
    for (const f of fs.readdirSync(dir)) {
      const st = fs.statSync(path.join(dir, f));
      if (st.isFile()) { files++; bytes += st.size; }
    }
    out[g] = { files, bytes };
  }
  return out;
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
    const disk = diskSize();
    console.log(`data/assets.json 的 ui 共 ${total} 项，${Object.keys(counts).length} 个分组`);
    console.log(`本地 public/assets/ui 共 ${Object.values(disk).reduce((n, d) => n + d.files, 0)} 个文件，` +
      `${(Object.values(disk).reduce((n, d) => n + d.bytes, 0) / 1048576).toFixed(1)}MB\n`);
    const rows = Object.keys(counts).map((g) => {
      const tier = UI_GROUPS[g] ? '用' : MAYBE_GROUPS[g] ? '留' : LEGACY_GROUPS[g] ? '删' : '?';
      const note = UI_GROUPS[g] ?? MAYBE_GROUPS[g] ?? LEGACY_GROUPS[g] ?? '（未登记）';
      const d = disk[g];
      return [tier, g, String(counts[g]), d ? `${(d.bytes / 1024).toFixed(0)}KB` : '—', note];
    }).sort((a, b) => a[0].localeCompare(b[0]) || b[1].localeCompare(a[1]));
    for (const [tier, g, n, kb, note] of rows) console.log(`  [${tier}] ${g.padEnd(18)} ${n.padStart(3)} 项 ${kb.padStart(8)}  ${note}`);
    const keepBytes = Object.keys(counts).filter((g) => KEEP_GROUPS[g]).reduce((n, g) => n + (disk[g]?.bytes || 0), 0);
    const dropBytes = Object.keys(counts).filter((g) => !KEEP_GROUPS[g]).reduce((n, g) => n + (disk[g]?.bytes || 0), 0);
    console.log(`\n保留 ${(keepBytes / 1048576).toFixed(1)}MB，可删 ${(dropBytes / 1048576).toFixed(1)}MB。`);
    process.exit(0);
  }

  const blob = siteText();
  const problems = [];
  for(const key of Object.keys(manifest.ui || {})){
    const slash=key.lastIndexOf('/');
    if(!uiAssetAllowed(key.slice(0,slash),key.slice(slash+1)))problems.push(`不再使用的 UI 素材仍在索引：${key}`);
  }
  for (const g of Object.keys(counts)) {
    if (!KEEP_GROUPS[g] && !LEGACY_GROUPS[g]) problems.push(`ui 分组「${g}」三档名单都没有（plan.mjs 会照旧下载它）`);
  }
  for (const g of Object.keys(KEEP_GROUPS)) {
    if (!Object.hasOwn(counts, g)) problems.push(`名单里的「${g}」在 data/assets.json 里不存在（拼错，或素材源已改名）`);
  }
  for (const g of Object.keys(UI_GROUPS)) {
    // 两种引用形态：`group/key` 字面量，或 artUrls('<group>', key) 这样按分组取。
    const byLiteral = new RegExp(`(^|[^a-zA-Z0-9_])${g}/`).test(blob);
    const byArtUrls = blob.includes(`artUrls('${g}'`) || blob.includes(`artUrls("${g}"`);
    if (!byLiteral && !byArtUrls) problems.push(`UI_GROUPS 标了在用的「${g}」在代码里找不到引用（${UI_GROUPS[g]}）`);
  }
  const planSrc = fs.readFileSync(path.join(ROOT, 'tools', 'assets', 'plan.mjs'), 'utf8');
  if (!/uiAllowed\(group\)/.test(planSrc)) problems.push('tools/assets/plan.mjs 的 addUi 没有经过 KEEP_GROUPS 闸门（uiAllowed）');
  if (!/uiAllowed\('statistics'\)/.test(planSrc)) problems.push("tools/assets/plan.mjs 的 statistics 分支没有经过 KEEP_GROUPS 闸门（uiAllowed('statistics')）");

  if (problems.length) {
    console.error(`UI 素材清单检查失败（${problems.length} 条）：`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  const stale = Object.keys(counts).filter((g) => LEGACY_GROUPS[g]);
  console.log(`UI 素材清单检查通过：${total} 项素材；` +
    `确定要用 ${Object.keys(UI_GROUPS).length} 组、可能要用 ${Object.keys(MAYBE_GROUPS).length} 组、确定不用 ${Object.keys(LEGACY_GROUPS).length} 组。`);
  if (stale.length) {
    console.log(`  ${stale.length} 个确定不用的分组仍在 data/assets.json 里（${stale.sort().join(', ')}）；`);
    console.log('  下一次 `npm run assets` 会按新名单重建清单，`--prune` 会顺手删掉本地文件。');
  }
}

main();
