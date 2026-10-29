#!/usr/bin/env node
// Audit static import contracts against the pinned AUE bridge, without loading kits.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';

const ROOT = path.resolve(import.meta.dirname, '..');
const AUE = path.resolve(ROOT, '../Arknights-Universal-Engine');
const PIN = 'b25523619c981cb1380928ffe96b0fcd67263e74';
const input = process.argv[2] || path.join(ROOT, '.agent-runs/aue-operator-paths.json');
const report = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
const actual = execFileSync('git', ['-C', AUE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actual !== PIN || report.baseline.aue !== PIN) throw Error('证据索引和 AUE 必须使用同一个固定提交。');
const read = file => fs.readFileSync(file, 'utf8');
const cache = new Map();
function tree(file) {
  if (!cache.has(file)) cache.set(file, parse(read(file), { ecmaVersion: 'latest', sourceType: 'module', locations: true }));
  return cache.get(file);
}
const key = n => n?.name ?? n?.value;
const unwrap = n => n?.type === 'CallExpression' && n.callee?.object?.name === 'Object' && n.callee.property?.name === 'freeze' ? n.arguments[0] : n;
const compat = path.join(AUE, 'packages/content/src/compat');
const mappingFile = path.join(compat, 'mapping.js');
const mappingNode = tree(mappingFile).body.find(n => n.type === 'ExportNamedDeclaration'
  && n.declaration?.declarations?.some(d => d.id.name === 'MAPPING'));
const mapping = Object.fromEntries(unwrap(mappingNode.declaration.declarations.find(d => d.id.name === 'MAPPING').init)
  .properties.map(p => [key(p.key), path.resolve(compat, p.value.value)]));
const apiCache = new Map();
function bindings(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(p => bindings(p.type === 'RestElement' ? p.argument : p.value));
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindings);
  if (pattern.type === 'RestElement') return bindings(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindings(pattern.left);
  throw Error(`未知导出绑定类型：${pattern.type}`);
}
function api(file) {
  if (apiCache.has(file)) return apiCache.get(file);
  const names = new Set(), gaps = new Set();
  apiCache.set(file, { names, gaps });
  for (const n of tree(file).body) {
    if (n.type === 'ExportDefaultDeclaration') names.add('default');
    if (n.type !== 'ExportNamedDeclaration') continue;
    if (n.declaration?.id?.name) names.add(n.declaration.id.name);
    for (const d of n.declaration?.declarations || []) {
      for (const name of bindings(d.id)) {
        names.add(name);
        if (d.init?.type === 'CallExpression' && d.init.callee?.name === 'gap') gaps.add(name);
      }
    }
    for (const s of n.specifiers || []) names.add(key(s.exported));
    // Current mapped modules have explicit exports. Fail rather than infer star exports.
  }
  if (tree(file).body.some(n => n.type === 'ExportAllDeclaration')) throw Error(`须显式处理星号导出：${file}`);
  return { names, gaps };
}
const relative = p => path.relative(ROOT, p).split(path.sep).join('/');
// Literal `battle.x` references only: aliases and dynamically supplied SI extensions
// still require a call-path review. A missing name is an adaptation lead, not a failure proof.
const battleTree = tree(path.join(compat, 'battle.js'));
const battleClass = battleTree.body.flatMap(n => n.type === 'ExportNamedDeclaration' ? [n.declaration] : [n])
  .find(n => n?.type === 'ClassDeclaration' && n.id.name === 'ShBattle');
const battleMembers = new Set(battleClass.body.body.map(n => key(n.key)));
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const v of node) walk(v, fn); return; }
  fn(node);
  for (const [k, v] of Object.entries(node)) if (k !== 'loc') walk(v, fn);
}
walk(battleClass, n => {
  if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression'
    && n.left.object.type === 'ThisExpression' && !n.left.computed) battleMembers.add(key(n.left.property));
});
function memberRefs(files) {
  const refs = [];
  for (const file of files) walk(tree(path.join(ROOT, file)), n => {
    if (n.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === 'battle'
      && (!n.computed || n.property.type === 'Literal')) {
      const name = key(n.property);
      refs.push({ file, line: n.loc.start.line, name, declaredInBridge: battleMembers.has(name) });
    }
  });
  return refs;
}
function closure(start) {
  const seen = new Set(), edges = [], problems = [];
  function visit(file, chain) {
    if (seen.has(file)) return;
    seen.add(file);
    for (const n of tree(file).body) {
      if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(n.type) || !n.source) continue;
      const spec = n.source.value;
      if (!spec.startsWith('.')) {
        problems.push({ type: 'external-import', file: relative(file), line: n.loc.start.line, spec, chain });
        continue;
      }
      const target = path.resolve(path.dirname(file), spec), rel = relative(target);
      const base = { file: relative(file), line: n.loc.start.line, target: rel };
      if (Object.hasOwn(mapping, rel)) {
        const mapped = mapping[rel], surface = api(mapped);
        const imports = (n.specifiers || []).map(s => s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportSpecifier' ? key(s.imported) : '*');
        edges.push({ ...base, route: 'mapped', mapped: path.relative(AUE, mapped).split(path.sep).join('/'), imports });
        for (const name of imports) {
          if (name === '*') {
            problems.push({ ...base, type: 'namespace-import', chain });
          } else if (!surface.names.has(name)) {
            problems.push({ ...base, type: 'missing-export', name, chain });
          } else if (surface.gaps.has(name)) {
            problems.push({ ...base, type: 'declared-gap', name, chain });
          }
        }
      } else if (rel.startsWith('server/sim/content/')) {
        edges.push({ ...base, route: 'content' });
        if (!target.endsWith('.js')) problems.push({ ...base, type: 'content-resource', chain });
        else if (!fs.existsSync(target)) problems.push({ ...base, type: 'missing-content-file', chain });
        else visit(target, [...chain, rel]);
      } else {
        problems.push({ ...base, type: 'unmapped-module', chain });
      }
    }
  }
  visit(path.join(ROOT, start), [start]);
  return { files: [...seen].map(relative), edges, problems };
}
const closures = new Map();
const rows = report.rows.map(row => {
  const sources = row.localKitSources;
  const graphs = sources.map(s => {
    if (!closures.has(s.file)) closures.set(s.file, closure(s.file));
    return { entry: s.file, ...closures.get(s.file) };
  });
  return { charId: row.charId, name: row.name, mode: row.mode, graphs,
    battleMemberReferences: memberRefs([...new Set(graphs.flatMap(g => g.files))]),
    verdict: !graphs.length ? 'entry-unresolved' : graphs.some(g => g.problems.length) ? 'static-contract-obstacles' : 'static-import-contract-only' };
});
console.log(JSON.stringify({ baseline: PIN,
  battleMembers: [...battleMembers].sort(),
  scope: '静态导入闭包及命名导出契约，不证明包装语义、条件分支或战斗行为等价。命名空间导入必须另行核对。',
  rows }, null, 2));
