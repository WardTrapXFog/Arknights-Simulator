#!/usr/bin/env node
// tools/check-levels.mjs —— 关卡库的「只增不改」守卫。
//
// 背景：content/levels/ 是玩家共创目录，进 Git 之后技术上谁都能改任意一关。
// 与其假装能拦住（拦不住），不如让**改动变得可见**：
//   content/levels/manifest.json 给每个关卡文件记 { id, name, author, sha256 }。
//   - 已有文件的 sha256 变了 → 报「这一关被改过」，除非作者同时重新盖章（--stamp）。
//   - 新文件没有登记      → 报「新关卡要登记」。
//   - 文件消失           → 报「这一关被删了」。
// 于是任何修改都会在 diff 里留下「内容变了 + manifest 变了」两条，评审时一眼看见。
//
// 用法：
//   node tools/check-levels.mjs         校验（CI / 提交前）
//   node tools/check-levels.mjs --stamp 重新盖章（你确实要改某一关时用）
//   node tools/check-levels.mjs --list  列出关卡与作者
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'content', 'levels');
const MANIFEST = path.join(DIR, 'manifest.json');
const args = new Set(process.argv.slice(2));
const stamp = args.has('--stamp');
const listOnly = args.has('--list');

const sha256 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).levels || {}; } catch { return {}; }
}

let files = [];
try {
  files = fs.readdirSync(DIR).filter((n) => n.endsWith('.json') && n !== 'manifest.json' && !n.startsWith('.'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const manifest = readManifest();
const next = {};
const problems = [];

for (const file of files) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8');
  let level = null;
  try { level = JSON.parse(text); } catch { problems.push(`${file}：不是合法 JSON`); continue; }
  const entry = {
    id: level.id ?? null,
    name: level.name ?? null,
    author: level.meta?.author ?? null,
    sha256: sha256(text),
  };
  next[file] = entry;

  if (listOnly) continue;
  const known = manifest[file];
  if (!known) problems.push(`${file}：新关卡，未在 manifest 登记（确认无误后跑 --stamp）`);
  else if (known.sha256 !== entry.sha256) problems.push(`${file}：内容被改过（${known.sha256} → ${entry.sha256}）。如果你就是作者、确实要改，跑 --stamp`);
}

for (const file of Object.keys(manifest)) {
  if (!files.includes(file)) problems.push(`${file}：manifest 里有，但目录里已经没有这关了`);
}

if (listOnly) {
  console.log(`content/levels/ 共 ${files.length} 关：`);
  for (const [file, e] of Object.entries(next)) console.log(`  ${e.name ?? '(无名)'}  作者 ${e.author ?? '未署名'}  [${file}]`);
  process.exit(0);
}

if (stamp) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify({ v: 1, levels: next }, null, 1) + '\n');
  console.log(`已盖章：manifest 记录 ${Object.keys(next).length} 关，保存在本机关卡库。`);
  process.exit(0);
}

if (problems.length) {
  console.error(`关卡库校验失败（${problems.length} 条）：`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`关卡库校验通过：${files.length} 关，内容与 manifest 一致。`);
