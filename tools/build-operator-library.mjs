// SI 独立满配牌库；只读取官方表与现有接入记录，不改上游棋子档位。
import fs from 'node:fs';
import { createOfficialUnitBuilders } from '../server/plugins/officialUnitBuilder.js';
import { composeUnitRecord } from '../shared/standIn.js';
import { isDiyModule } from '../shared/diy.js';
import { KITS } from '../server/sim/content/kits/index.js';
const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const write = (path, value) => fs.writeFileSync(new URL(`../${path}`, import.meta.url), value);

/**
 * 官方表的位置：优先 `data/gamedata/`（随仓库发布，clone 就能用），回退 `.cache/gamedata/excel/`
 * （老环境或刚跑过解包脚本的位置）。缺表时给出可执行的下一步，而不是一句 ENOENT。
 */
const tableDir = (() => {
  const candidates = ['data/gamedata', '.cache/gamedata/excel'];
  for (const dir of candidates) {
    try { if (fs.existsSync(new URL(`../${dir}/character_table.json`, import.meta.url))) return dir; } catch { /* 试下一个 */ }
  }
  throw new Error('缺少官方数据表：data/gamedata/ 下应有 character_table.json 等 5 个表。'
    + '请从 Kengxxiao/ArknightsGameData 的 zh_CN/gamedata/excel/ 取得，或运行 npm run assets 后重试。');
})();
const table = (name) => read(`${tableDir}/${name}.json`);
const tables = { charTable: table('character_table'), skillTable: table('skill_table'),
  rangeTable: table('range_table'), uniequip: table('uniequip_table'), battleEquip: table('battle_equip_table'),
  ac: {}, research: {}, potRank: 5 };
const builder = createOfficialUnitBuilders();
const chess = read('data/chess.json'), backups = read('data/backups.json'), baseTokens = read('data/tokens.json');
const customIndex = read('content/operators/index.json');
const customChars = new Set(customIndex.map((e) => read(`content/operators/${e.file}`).charId));
const byChar = new Map();
for (const record of Object.values(chess)) {
  if (!record.charId || record.isDiy || customChars.has(record.charId)) continue;
  if (!byChar.has(record.charId) || record.isGolden) byChar.set(record.charId, record);
}
for (const [charId, unit] of Object.entries(backups.units)) {
  if (!customChars.has(charId) && !byChar.has(charId) && KITS[charId]) byChar.set(charId, { charId, name: unit.name, chessId: `si_${charId}`, baseId: `si_${charId}`, assets: unit.assets, bonds: [] });
}
const operators = {}, aliases = {}, tokens = {};
for (const [charId, source] of byChar) {
  const char = tables.charTable[charId];
  if (!char?.phases?.length) throw Error(`官方角色表缺少 ${charId}`);
  const phase = char.phases.length - 1, level = char.phases[phase].maxLevel;
  const skillLevel = Math.max(1, ...(char.skills || []).map((s) => tables.skillTable[s.skillId]?.levels?.length || 1));
  const status = { phase, level, skillLevel, equipLevel: phase === 2 ? 3 : 0 };
  const head = builder.buildUnitHead(tables, charId), form = builder.buildUnitForm(tables, charId, status);
  // 官方满信赖加成独立于等级、潜能与模组；在基础属性上只加一次。
  const attrs = builder.withPotential(char, builder.interpolateAttrs(char, phase, level), 5, charId);
  for (const [key, value] of Object.entries(char.favorKeyFrames?.at(-1)?.data || {})) if (typeof value === 'number' && typeof attrs[key] === 'number') attrs[key] += value;
  form.stats = builder.statsFrom(attrs, {});
  form.modules = (form.modules || []).filter(isDiyModule);
  const moduleId = form.modules.find((m) => m.uniEquipId === source.module?.id)?.uniEquipId || form.modules[0]?.uniEquipId || null;
  const id = source.baseId || source.chessId;
  const identity = { ...source, chessId: id, baseId: id, goldenId: id, isGolden: true, isDiy: false, isHidden: false, visible: true,
    chessType: 'PRESET', status, upgradeNum: 0, upgradeChessId: null, garrisonIds: [] };
  const skillIndex = form.skills.some((s) => s.index === source.skill?.index) ? source.skill.index : form.skills[0]?.index ?? 0;
  const record = composeUnitRecord(identity, head, form, { skillIndex, moduleId });
  record.kitRef = KITS[charId] ? charId : (source.baseId || source.chessId);
  if (!KITS[record.kitRef]) delete record.kitRef;
  record.assets = { ...record.assets, ...source.assets };
  record.training = { potential: 6, trust: 200, phase, level, skillLevel, equipLevel: status.equipLevel };
  operators[id] = record;
  for (const old of Object.values(chess)) if (old.charId === charId && !old.isDiy) aliases[old.chessId] = id;
  for (const tokenId of form.tokens) {
    const character = tables.charTable[tokenId], sourceToken = baseTokens[tokenId] || backups.tokens?.[tokenId];
    if (!character?.phases?.length || !sourceToken) continue;
    const p = Math.min(phase, character.phases.length - 1);
    const tokenForm = builder.buildUnitForm(tables, tokenId, { phase: p, level: Math.min(level, character.phases[p].maxLevel), skillLevel, equipLevel: 0 });
    const token = tokens[tokenId] ||= structuredClone(sourceToken);
    const original = sourceToken.variants?.[source.chessId] || sourceToken.variants?.[source.baseId] || Object.values(sourceToken.variants || {})[0] || sourceToken;
    const variant = { ...structuredClone(original), stats: tokenForm.stats, trait: tokenForm.trait, talents: tokenForm.talents,
      rangeGrid: tokenForm.rangeGrid, rangeId: tokenForm.rangeId, immunities: tokenForm.immunities };
    // 所有模组分支从同一满级召唤物底板出发，保留既有召唤来源与技能分支。
    if (variant.byModule) for (const v of Object.values(variant.byModule)) v.stats = { ...tokenForm.stats };
    token.variants ||= {}; token.variants[id] = variant;
  }
}
const result = { version: 1, source: 'Kengxxiao/ArknightsGameData zh_CN', operators, aliases, tokens };
write('data/operator-library.json', JSON.stringify(result));
write('public/sandbox/js/generated-library.js', `// tools/build-operator-library.mjs 生成。\nexport const OFFICIAL_IDS = ${JSON.stringify(Object.keys(operators))};\nexport const OPERATOR_ALIASES = ${JSON.stringify(aliases)};\n`);
console.log(`已生成 ${Object.keys(operators).length} 名满配干员`);
