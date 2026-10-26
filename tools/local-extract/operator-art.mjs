// 本地提取使用的 SI 牌库与 Spine 元数据读取器。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkel } from '../assets/skel.mjs';
import { resolveRoles } from '../assets/anim-roles.mjs';

const [mode, arg] = process.argv.slice(2);
if (mode === '--spine') {
  const sk = parseSkel(fs.readFileSync(arg));
  process.stdout.write(JSON.stringify({ pma: true,
    anims: resolveRoles(sk.animations, { skillIndices: [0, 1, 2], durations: sk.durations }),
    animations: sk.durations, events: sk.events, hits: sk.hits, bounds: sk.bounds }));
} else {
  const root = mode || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8')); } catch { return {}; }
  };
  const library = read('operator-library.json');
  const records = [...Object.values(read('chess.json')), ...Object.values(library.operators || {})];
  const ids = records.map((record) => record?.charId).filter((id) => /^char_[0-9]+_[a-z0-9]+$/.test(id));
  process.stdout.write(JSON.stringify([...new Set(ids)].sort()));
}
