#!/usr/bin/env node
// tools/report-kit-drift.mjs —— 只读：把「三个仓库」对齐后，算出本项目相对 **AUE 实际运行的内容** 差在哪。
//
// 为什么不是只比 Stronghold：AUE 默认只加载其中 72 份 kit
// （packages/content/data/kits.json 的 enabled）。本工具对比这批文件的文本差异。
// 默认未启用不等于缺行为：AUE 有原生实现，应用也可额外传入本地 kit 工厂。
// 全量玩家身份与导入契约分别见 report-operator-paths.mjs、report-kit-contracts.mjs。
//
// 三方来源（全部固定提交，不自己挑版本）：
//   本项目     server/sim/content/kits/ops/
//   AUE        .cache/oracle/aue  @ b255236（v0.1.4）
//   Stronghold .cache/oracle/sp   @ b3deebda（v0.3.1，AUE kits.json 指定的那个）
//
// 用法：
//   node tools/report-kit-drift.mjs            汇总
//   node tools/report-kit-drift.mjs --detail X 单个 kit 的差异行数

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOCAL = path.join(ROOT, 'server', 'sim', 'content', 'kits', 'ops');
const SP = path.join(ROOT, '.cache', 'oracle', 'sp', 'server', 'sim', 'content', 'kits', 'ops');
const AUE = path.join(ROOT, '.cache', 'oracle', 'aue');

const sha = (t) => createHash('sha256').update(t).digest('hex');
const norm = (t) => t.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).join('\n');
const read = (dir) => {
  if (!fs.existsSync(dir)) return null;
  const m = new Map();
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) m.set(f, fs.readFileSync(path.join(dir, f), 'utf8'));
  return m;
};

const local = read(LOCAL);
const sp = read(SP);
const kitsJsonPath = path.join(AUE, 'packages', 'content', 'data', 'kits.json');
if (!sp || !fs.existsSync(kitsJsonPath)) {
  console.error('缺上游快照。需要：');
  console.error('  .cache/oracle/sp   Stronghold-Protocol @ b3deebdae4a92642c007d217a1a4573e5d3612c5');
  console.error('  .cache/oracle/aue  Arknights-Universal-Engine @ b25523619c981cb1380928ffe96b0fcd67263e74');
  process.exit(1);
}
const kits = JSON.parse(fs.readFileSync(kitsJsonPath, 'utf8'));
/** AUE 启用的 kit：charId → Stronghold 里的相对路径 */
const enabled = new Map([...kits.enabled].map((id) => [id, kits.files[id]]));
const baseName = (rel) => path.basename(rel);

/** 本项目 kit 文件 → charId */
const charIdOf = (text) => (text.match(/char_[0-9]{3,4}_[a-z0-9_]+/i) || [null])[0];

const localByChar = new Map();
for (const [file, text] of local) {
  const id = charIdOf(text);
  if (id) localByChar.set(id, { file, text });
}

const rows = { identical: [], changed: [], missingInAue: [], onlyInAue: [] };

function diffSize(a, b) {
  const A = norm(a).split('\n'), B = norm(b).split('\n');
  const setA = new Set(A), setB = new Set(B);
  return { removed: A.filter((l) => !setB.has(l)).length, added: B.filter((l) => !setA.has(l)).length };
}

for (const [id, rel] of enabled) {
  const upFile = baseName(rel);
  const upText = sp.get(upFile);
  const mine = localByChar.get(id);
  if (!mine) { rows.onlyInAue.push({ id, file: upFile }); continue; }
  if (!upText) { rows.changed.push({ id, file: mine.file, note: '上游缺该文件' }); continue; }
  const d = diffSize(mine.text, upText);
  if (sha(norm(mine.text)) === sha(norm(upText))) rows.identical.push({ id, file: mine.file });
  else rows.changed.push({ id, file: mine.file, ...d });
}

const aueIds = new Set(enabled.keys());
for (const id of localByChar.keys()) {
  if (!aueIds.has(id)) rows.missingInAue.push({ id, file: localByChar.get(id).file });
}

const args = process.argv.slice(2);
if (args.includes('--json')) {
  console.log(JSON.stringify({
    counts: { local: local.size, stronghold: sp.size, aueEnabled: enabled.size,
      identical: rows.identical.length, changed: rows.changed.length,
      missingInAue: rows.missingInAue.length, onlyInAue: rows.onlyInAue.length },
    ...rows,
  }, null, 2));
  process.exit(0);
}

const detailAt = args.indexOf('--detail');
if (detailAt >= 0) {
  const id = args[detailAt + 1];
  const mine = localByChar.get(id);
  const rel = enabled.get(id);
  if (!mine) { console.error(`本项目没有 ${id}`); process.exit(1); }
  if (!rel) { console.log(`${id}：AUE 不启用这份 kit（本项目独有）`); process.exit(0); }
  const upText = sp.get(baseName(rel));
  const d = diffSize(mine.text, upText);
  console.log(`${id}  ${mine.file}\n  相对 AUE 跑的那份：删 ${d.removed} 行、增 ${d.added} 行`);
  process.exit(0);
}

console.log(`本项目 kit ${local.size} 份 · Stronghold 快照 ${sp.size} 份 · AUE 实际启用 ${enabled.size} 份\n`);
console.log(`对 AUE 启用的那 ${enabled.size} 份：`);
console.log(`  与本项目完全一致   ${rows.identical.length} 份`);
console.log(`  本项目改过         ${rows.changed.length} 份`);
console.log(`  本项目没有         ${rows.onlyInAue.length} 份`);
console.log(`\n本项目有、AUE 不启用： ${rows.missingInAue.length} 份（迁移后这些干员没有 kit，只有引擎通用实现）`);

if (rows.changed.length) {
  console.log('\n改过的（这是迁移时必须逐项判断的名单，不是猜的）：');
  for (const c of rows.changed.sort((a, b) => (b.removed + b.added) - (a.removed + a.added))) {
    console.log(`  -${String(c.removed ?? 0).padStart(4)} +${String(c.added ?? 0).padStart(4)}  ${c.id.padEnd(22)} ${c.file}${c.note ? '  (' + c.note + ')' : ''}`);
  }
}
if (rows.onlyInAue.length) {
  console.log('\nAUE 有、本项目没有（迁移后会“多出来”的干员）：');
  console.log('  ' + rows.onlyInAue.map((r) => r.id).join(', '));
}
