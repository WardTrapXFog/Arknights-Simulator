// 生成沙盒与编辑器共用敌人目录，不改动战斗数据与旧投放预设。
import { readFile, writeFile } from 'node:fs/promises';
import { KITS, STATS_ONLY } from '../server/sim/content/enemies.js';
import { BOSS_KEYS } from '../server/sim/content/bosses.js';
import { ENEMY_PRESETS } from '../public/sandbox/js/spawn-catalog.js';

const enemies = JSON.parse(await readFile(new URL('../data/enemies.json', import.meta.url), 'utf8'));
const officialKeys = new Set([...Object.keys(KITS), ...Object.keys(STATS_ONLY), ...BOSS_KEYS]);
const normal = new Map(ENEMY_PRESETS.filter((e) => !e.dummy && !e.name.includes('耐久')).map((e) => [e.key, e]));
const library = { official: [], statsOnly: [], toy: [] };
for (const [key, e] of Object.entries(enemies)) {
  const pick = normal.get(key);
  const record = { key, name: e.name || pick?.name || key, short: pick?.short || e.name || key,
    rank: e.rank || 'NORMAL', fly: !!e.isFlyEnemy || e.stats?.motion === 'FLY', ranged: e.applyWay === 'RANGED',
    note: officialKeys.has(key) ? (pick?.note || '已登记战斗机制或基础数值行为') : '特性未实现，只按基础数值行动' };
  library[officialKeys.has(key) ? 'official' : 'statsOnly'].push(record);
}
library.toy = ENEMY_PRESETS.filter((e) => e.dummy || e.name.includes('耐久')).map((e) => ({ ...e }));
const output = '// 编辑器与沙盒共用的敌人分层目录；来源：tools/build-enemy-library.mjs。\n'
  + `export const ENEMY_LIBRARY = ${JSON.stringify(library, null, 2)};\n`
  + 'export const LIBRARY_KEYS = new Set([...ENEMY_LIBRARY.official, ...ENEMY_LIBRARY.statsOnly].map((e) => e.key));\n';
await writeFile(new URL('../public/sandbox/js/enemy-library.js', import.meta.url), output);
