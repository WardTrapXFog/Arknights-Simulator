#!/usr/bin/env node
// Import material files from an explicitly supplied, unpacked project package.
// The source is read-only; runtime data, scripts and custom assets are not copied.
import { lstat, readdir, mkdir, copyFile, readFile, writeFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { EXPECTED_FX } from './local-extract/expected.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'public/assets');
const allowed = new Set(['.png', '.webp', '.jpg', '.jpeg', '.json', '.atlas', '.skel', '.mp3', '.ogg', '.wav', '.bin', '.obj', '.mtl']);
const within = (base, file) => file === base || file.startsWith(base + path.sep);

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('用法：npm run assets:import -- --from "已解压的整合包根目录"\n只导入 public/assets 下的官方素材及本地美术/特效索引；保留已有非空文件，不覆盖自设素材。');
    return;
  }
  if (args.length !== 2 || args[0] !== '--from' || !args[1]) throw Error('请用 --from 明确指定已解压整合包的根目录（其中应有 public/assets）。');
  const sourceRoot = path.resolve(args[1]);
  const source = path.join(sourceRoot, 'public/assets');
  if (within(source, target) || within(target, source)) throw Error('来源素材目录不能与当前项目素材目录重叠。');
  for (const file of [sourceRoot, path.join(sourceRoot, 'public'), source]) {
    const info = await lstat(file);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('来源必须是实际目录，不能是目录链接。');
  }
  let copied = 0, kept = 0;
  async function walk(dir, rel = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !rel && entry.name.toLowerCase() === 'custom') continue;
      const next = path.join(rel, entry.name), from = path.join(dir, entry.name), to = path.join(target, next);
      if (!within(target, to)) throw Error('素材路径超出项目目录。');
      // Existing target links must never redirect a write outside the project.
      try {
        const current = await lstat(to);
        if (current.isSymbolicLink()) throw Error(`目标包含链接，停止导入：${next}`);
        if (entry.isFile() && current.isFile() && current.size > 0) { kept++; continue; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (entry.isDirectory()) { await mkdir(to, { recursive: true }); await walk(from, next); }
      else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase()) && (await lstat(from)).size > 0) {
        await mkdir(path.dirname(to), { recursive: true });
        // Empty placeholders may be replaced; nonempty material files are retained above.
        const temp = `${to}.${randomUUID()}.tmp`;
        await copyFile(from, temp, constants.COPYFILE_FICLONE);
        await rename(temp, to);
        copied++;
      }
    }
  }
  for (const dir of [path.join(root, 'public'), target, path.join(root, 'data')]) {
    try { if ((await lstat(dir)).isSymbolicLink()) throw Error('项目目标目录不能是目录链接。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(target, { recursive: true });
  await walk(source);
  for (const name of ['local-assets.json', 'local-fx.json']) {
    let doc;
    try {
      const sourceFile = path.join(sourceRoot, 'data', name);
      if ((await lstat(path.join(sourceRoot, 'data'))).isSymbolicLink() || (await lstat(sourceFile)).isSymbolicLink()) throw Error('来源索引不能是链接。');
      doc = JSON.parse(await readFile(sourceFile, 'utf8'));
    } catch (error) {
      console.log(`[索引] ${name} 未导入：${error.code === 'ENOENT' ? '来源未提供' : error.message}`);
      continue;
    }
    if (!doc.groups || typeof doc.groups !== 'object') throw Error(`${name} 缺少有效的素材分组。`);
    if (name === 'local-fx.json' && (doc.format !== 'fx-manifest' || doc.version !== EXPECTED_FX.manifestVersion || doc.groups.fx?.index?.version !== EXPECTED_FX.indexVersion)) {
      console.log(`[索引] ${name} 版本不兼容，保留当前索引；需要按本项目格式重新提取。`);
      continue;
    }
    let entries = 0, missing = 0;
    for (const records of Object.values(doc.groups)) for (const record of Object.values(records || {})) {
      if (typeof record?.path !== 'string' || !record.path.startsWith('/assets/local/')) { missing++; continue; }
      const file = path.resolve(root, 'public', '.' + record.path);
      if (!within(path.join(target, 'local'), file)) throw Error(`${name} 包含越界路径。`);
      entries++;
      try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || !info.size) missing++; }
      catch { missing++; }
    }
    if (!entries || missing) {
      console.log(`[索引] ${name} 有 ${missing} 项缺失或无效，保留当前索引；已复制的文件仍可保留。`);
      continue;
    }
    // Prefer the complete source catalog after its files have been copied.
    doc.count = entries;
    doc.source = 'Imported material package';
    delete doc.client;
    const file = path.join(root, 'data', name), temp = `${file}.${randomUUID()}.tmp`;
    try { if ((await lstat(file)).isSymbolicLink()) throw Error('目标索引不能是链接。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(temp, JSON.stringify(doc, null, 2) + '\n');
    await rename(temp, file);
    console.log(`[索引] ${name}：${entries} 项`);
  }
  console.log(`素材导入完成：新增/补全 ${copied} 个，保留已有 ${kept} 个。网络素材仍可用 npm run assets 补全。`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
