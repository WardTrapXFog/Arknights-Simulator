#!/usr/bin/env node
// Source-only evidence index. Does not import or execute either battle engine.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';

const ROOT = path.resolve(import.meta.dirname, '..');
const PIN = 'b25523619c981cb1380928ffe96b0fcd67263e74';
const args = process.argv.slice(2);
let aue = path.resolve(ROOT, '../Arknights-Universal-Engine');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--aue') aue = path.resolve(args[++i] || '');
  else if (args[i] === '--help') {
    console.log('node tools/report-operator-paths.mjs [--aue <AUE目录>]\n向标准输出写出当前牌库的技能数据差异与源码位置；不执行战斗，不判定机制等价。');
    process.exit(0);
  } else throw Error(`未知参数：${args[i]}`);
}
const read = file => fs.readFileSync(file, 'utf8');
const json = file => JSON.parse(read(file));
const ast = file => parse(read(file), { ecmaVersion: 'latest', sourceType: 'module', locations: true });
const keyOf = n => n?.type === 'Identifier' ? n.name : n?.value;
const exported = (file, name) => {
  for (const node of ast(file).body) {
    if (node.type !== 'ExportNamedDeclaration' || node.declaration?.type !== 'VariableDeclaration') continue;
    for (const d of node.declaration.declarations) if (d.id.name === name) return d.init;
  }
  throw Error(`${path.relative(ROOT, file)} 未导出 ${name}`);
};
const lineOf = (file, needle) => {
  const n = read(file).split(/\r?\n/).findIndex(line => line.includes(needle));
  if (n < 0) throw Error(`源码入口不存在：${file} / ${needle}`);
  return n + 1;
};
const head = execFileSync('git', ['-C', aue, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== PIN) throw Error(`AUE 工作区提交 ${head} 与对账基线 ${PIN} 不一致；未生成跨版本混合报告。`);
const enabled = new Set(json(path.join(aue, 'packages/content/data/kits.json')).enabled);
const index = json(path.join(aue, 'packages/content/data/operators/index.json')).operators;
const operators = json(path.join(ROOT, 'data/operator-library.json')).operators;
const idsNode = exported(path.join(ROOT, 'public/sandbox/js/generated-library.js'), 'OFFICIAL_IDS');
if (idsNode.type !== 'ArrayExpression' || idsNode.elements.some(n => n?.type !== 'Literal' || typeof n.value !== 'string')) throw Error('OFFICIAL_IDS 不再是字符串数组。');
const ids = idsNode.elements.map(n => n.value);
const custom = json(path.join(ROOT, 'content/operators/index.json')).map(e => {
  const d = json(path.join(ROOT, 'content/operators', e.file));
  return { record: d.record, definition: `content/operators/${e.file}` };
});

// Read actual default-export property names. A char id in a comment is not a registration.
const candidates = new Map();
const dir = path.join(ROOT, 'server/sim/content/kits/ops');
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
  const full = path.join(dir, file), tree = ast(full);
  let node = tree.body.find(n => n.type === 'ExportDefaultDeclaration')?.declaration;
  // Tier-4 registries are wrapped by withDefaults; index its object, never execute the wrapper.
  if (node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'withDefaults') node = node.arguments[0];
  if (node?.type !== 'ObjectExpression') continue;
  for (const p of node.properties) {
    if (p.type !== 'Property' || p.computed) continue;
    const key = keyOf(p.key);
    if (typeof key !== 'string') continue;
    const list = candidates.get(key) || [];
    list.push({ file: `server/sim/content/kits/ops/${file}`, line: p.loc.start.line });
    candidates.set(key, list);
  }
}
const nativeEntryPoints = [
  ['packages/content/src/operators.js', 'export const operatorAt'],
  ['packages/content/src/skills.js', 'export function skillDefOf'],
  ['packages/content/src/skilltext.js', 'export function textExtra'],
  ['packages/content/src/tokens.js', 'export function tokenAt'],
  ['packages/content/src/summontext.js', 'export function grantAt'],
  ['packages/sim/src/skills.js', 'export const GENERIC'],
].map(([file, needle]) => ({ file, line: lineOf(path.join(aue, file), needle) }));
const diffsOf = (local, upstream) => Object.keys({ ...local, ...upstream }).sort().flatMap(key =>
  JSON.stringify(local[key]) === JSON.stringify(upstream[key]) ? [] : [{ key, local: local[key] ?? null, aue: upstream[key] ?? null }]);
function row(record, definition = null) {
  if (!record?.charId) throw Error('牌库记录缺少实际 charId。');
  const id = record.charId;
  const training = index[id] ? json(path.join(aue, `packages/content/data/operators/${id}.json`)) : null;
  const key = record.kitRef || (candidates.has(id) ? id : record.chessId);
  const sources = candidates.get(key) || [];
  const mode = definition ? 'custom' : enabled.has(id) ? 'enabled-kit'
    : sources.some(s => path.basename(s.file).startsWith('standin-')) ? 'standin' : 'native-default';
  const skills = (record.skills || []).map(s => {
    const sid = s.skillId || s.id, up = training?.skills.find(k => k.id === sid);
    const level = Math.max(1, s.level || record.training?.skillLevel || 10);
    const lv = up?.levels[level - 1];
    const local = { skillType: s.skillType, durationType: s.durationType, duration: s.duration,
      spType: s.spType, spCost: s.spCost, initSp: s.initSp, maxChargeTime: s.maxChargeTime, rangeId: s.rangeId };
    const remote = lv ? { skillType: lv.skillType, durationType: lv.durationType, duration: lv.duration,
      spType: lv.spData.spType, spCost: lv.spData.spCost, initSp: lv.spData.initSp, maxChargeTime: lv.spData.maxChargeTime, rangeId: lv.rangeId } : null;
    return { id: sid, name: s.name, level, presentInAue: !!lv,
      localDescription: s.descRaw ?? s.desc, aueDescription: lv?.description ?? null,
      localBlackboard: s.bb || {}, aueBlackboard: lv ? Object.fromEntries(lv.blackboard.map(e => [e.key, e.value])) : null,
      parameterDifferences: remote ? diffsOf(local, remote) : null,
      blackboardDifferences: lv ? diffsOf(s.bb || {}, Object.fromEntries(lv.blackboard.map(e => [e.key, e.value]))) : null,
      localTrigger: s.trigger ?? null, localToken: s.overrideTokenKey ?? null, aueToken: up?.token ?? null };
  });
  return { slot: record.chessId, charId: id, name: record.name, mode, definition,
    aueRecord: training ? `packages/content/data/operators/${id}.json` : null,
    localKitKey: key, localKitSources: sources, localModule: record.module ?? null,
    aueModulePresent: record.module?.id ? !!training?.modules.some(m => m.id === record.module.id) : null,
    localTalentNames: (record.talents || []).map(t => t.name).filter(Boolean),
    aueTalentNames: training ? training.talents.map(group => [...new Set(group.map(t => t.name))]) : [],
    skills };
}
const rows = [...ids.map(id => {
  if (!operators[id]) throw Error(`牌库记录缺失：${id}`);
  return row(operators[id]);
}), ...custom.map(d => row(d.record, d.definition))];
console.log(JSON.stringify({ baseline: { aue: head },
  scope: '源码与数据定位，不执行引擎；参数相同不代表行为等价，默认未启用 kit 不代表不能接入本地 kit。',
  counts: Object.fromEntries(['enabled-kit', 'native-default', 'standin', 'custom'].map(mode => [mode, rows.filter(r => r.mode === mode).length])),
  nativeEntryPoints, rows }, null, 2));
