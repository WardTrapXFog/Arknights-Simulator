#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { gzipSync } from 'node:zlib';
import { AUE_COMMIT } from '../public/sandbox/js/aue/version.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PIN = AUE_COMMIT;
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--source')) throw Error('用法：node tools/prepare-aue-trial.mjs [--source AUE目录]');
const source = path.resolve(args[1] || path.join(ROOT, '../Arknights-Universal-Engine'));
const target = path.join(ROOT, 'public/vendor/aue-trial', PIN);
async function updateAdapterUrls(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())await updateAdapterUrls(file);
    else if(entry.name.endsWith('.js')){
      const text=await fs.readFile(file,'utf8'),next=text.replace(/\/vendor\/aue-trial\/[a-f0-9]{40}\//g,`/vendor/aue-trial/${PIN}/`);
      if(next!==text)await fs.writeFile(file,next);
    }
  }
}
const packages = ['math', 'schema', 'sim', 'content'];
const git = (...a) => execFileSync('git', ['-C', source, ...a], { maxBuffer: 32 * 1024 * 1024 });
const hash = data => createHash('sha256').update(data).digest('hex');

// Read Git objects, not the checkout's files: local edits cannot masquerade as the pin.
if (git('rev-parse', `${PIN}^{commit}`).toString().trim() !== PIN) throw Error('AUE 源目录缺少固定提交。');
await updateAdapterUrls(path.join(ROOT,'public/sandbox/js/aue'));
const exports = new Map();
for (const name of packages) {
  const pkg = JSON.parse(git('show', `${PIN}:packages/${name}/package.json`).toString());
  for (const [key, dest] of Object.entries(pkg.exports)) {
    if (typeof dest !== 'string') throw Error(`不支持的包导出：${pkg.name} ${key}`);
    exports.set(pkg.name + (key === '.' ? '' : key.slice(1)), path.posix.join('packages', name, dest));
  }
}
function browserSource(file, text) {
  const edits = [], ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  function visit(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    const spec = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(n.type) ? n.source : null;
    if (spec?.type === 'Literal' && typeof spec.value === 'string' && !spec.value.startsWith('.')) {
      const dest = exports.get(spec.value);
      if (!dest) throw Error(`${file} 引用了未准备的外部模块：${spec.value}`);
      let rel = path.posix.relative(path.posix.dirname(file), dest);
      if (!rel.startsWith('.')) rel = './' + rel;
      edits.push({ start: spec.start, end: spec.end, text: JSON.stringify(rel) });
    }
    for (const v of Object.values(n)) visit(v);
  }
  visit(ast);
  for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  if(file==='packages/sim/src/elements.js') text+='\nexport { burst as siForceBurst };\nexport const siBurstBeginning = u => beginning.has(u);\n';
  // Optional host economy callbacks keep ARKSIM's account and presentation rules
  // at the native engine's existing cost phase. Without them AUE is unchanged.
  if(file==='packages/sim/src/world.js') text=text.replace('function gainCost(w, c) {',
    'function gainCost(w, c) {\n  if (c.behaviors?.cost) return c.behaviors.cost(w, c, costLocked);');
  if(file==='packages/sim/src/traits.js') text=text
    .replace('export function gainCost(w, c, seat, n) {', 'export function gainCost(w, c, seat, n, source = null) {\n  if (c.behaviors?.gainCost) return c.behaviors.gainCost(w, c, seat, n, source);')
    .replace('gainCost(w, c, op.owner, n);', 'gainCost(w, c, op.owner, n, op);')
    .replace('gainCost(w, c, op.owner, t.killCost);', 'gainCost(w, c, op.owner, t.killCost, op);');
  if(file==='packages/sim/src/deck.js') text=text.replace('Math.min(u.paid * t.refund, d.cost)));', 'Math.min(u.paid * t.refund, d.cost)), u);');
  return text;
}

const selected = packages.flatMap(n => [`packages/${n}/src`, `packages/${n}/data`, `packages/${n}/package.json`]);
const files = git('ls-tree', '-r', '--name-only', PIN, '--', ...selected, 'LICENSE', 'NOTICE.md').toString().trim().split('\n').filter(Boolean);
const prepared = [], manifestFile = path.join(target, 'manifest.json');
await fs.mkdir(target, { recursive: true });
// An interrupted preparation must not leave a manifest advertising a complete bundle.
await fs.rm(manifestFile, { force: true });
for (const file of files) {
  const raw = git('show', `${PIN}:${file}`);
  const data = file.endsWith('.js') ? Buffer.from(browserSource(file, raw.toString('utf8'))) : raw;
  const output = path.join(target, ...file.split('/'));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, data);
  prepared.push({ file, sourceSha256: hash(raw), browserSha256: hash(data), bytes: data.length });
}
const mappingText = git('show', `${PIN}:packages/content/src/compat/mapping.js`).toString();
const mappingDecl = parse(mappingText, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .find(n => n.declaration?.declarations?.some(d => d.id.name === 'MAPPING')).declaration.declarations[0].init.arguments[0];
const mapping = Object.fromEntries(mappingDecl.properties.map(p => [p.key.value ?? p.key.name,
  path.posix.join('packages/content/src/compat', p.value.value)]));
const overrides = {
  'server/sim/constants.js': '/sandbox/js/aue/sh/constants.js',
  'server/sim/damage.js': '/sandbox/js/aue/sh/damage.js',
  'server/sim/skills.js': '/sandbox/js/aue/sh/skill-banks.js',
  'server/sim/professions.js': '/sandbox/js/aue/sh/professions.js',
  'server/sim/ai.js': '/sandbox/js/aue/sh/ai.js',
  'server/sim/targeting.js': '/sandbox/js/aue/sh/targeting.js',
  'server/data.js': '/sandbox/js/aue/sh/data.js',
};
const visited = new Set(), registry = {};
async function localModule(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const text = await fs.readFile(path.join(ROOT, file), 'utf8');
  const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' }), edits = [];
  for (const n of ast.body) {
    if (!n.source) continue;
    if (!n.source.value.startsWith('.')) throw Error(`${file} 不支持外部内容依赖 ${n.source.value}`);
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(file), n.source.value));
    let url;
    if (overrides[dep]) url = overrides[dep];
    else if (mapping[dep]) url = `/vendor/aue-trial/${PIN}/${mapping[dep]}`;
    else {
      if (!dep.startsWith('server/sim/content/')) throw Error(`内容依赖未适配：${file} → ${dep}`);
      await localModule(dep);
    }
    if (url) edits.push({ start: n.source.start, end: n.source.end, text: JSON.stringify(url) });
  }
  let output = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, e.start) + e.text + output.slice(e.end);
  const dest = path.join(target, 'local', file);
  await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, output);
  prepared.push({ file: 'local/' + file, sourceSha256: hash(text), browserSha256: hash(output), bytes: Buffer.byteLength(output) });
  let node = ast.body.find(n => n.type === 'ExportDefaultDeclaration')?.declaration;
  if (node?.type === 'CallExpression' && node.callee.name === 'withDefaults') node = node.arguments[0];
  if (file.includes('/kits/ops/') && node?.type === 'ObjectExpression') for (const p of node.properties) {
    if (p.type === 'Property' && !p.computed) registry[p.key.name ?? p.key.value] = 'local/' + file;
  }
}
for (const file of (await fs.readdir(path.join(ROOT, 'server/sim/content/kits/ops'))).filter(f => f.endsWith('.js')).sort()) {
  await localModule('server/sim/content/kits/ops/' + file);
}
await localModule('server/sim/content/tokens.js');
await fs.writeFile(path.join(target, 'kits.json'), JSON.stringify(registry, null, 2) + '\n');
const manifest = { version: 1, repository: 'https://github.com/ArknightsDevs/Arknights-Universal-Engine', commit: PIN,
  entry: 'packages/sim/src/index.js', scope: 'battle-trial', kits: 'kits.json', files: prepared };
await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
// The distributable contains readable source, JSON data and upstream notices;
// players unpack it locally without cloning the maintainer's sibling checkout.
const available=new Map(prepared.map(row=>[row.file,row])),used=new Set();
async function include(file){
  if(used.has(file))return;
  if(!available.has(file))throw Error(`运行闭包缺少：${file}`);
  used.add(file);
  if(!file.endsWith('.js'))return;
  const sourceText=await fs.readFile(path.join(target,file),'utf8');
  const tree=parse(sourceText,{ecmaVersion:'latest',sourceType:'module'});
  const dependencies=[];
  function visit(node){
    if(!node || typeof node!=='object')return;
    if(Array.isArray(node)){node.forEach(visit);return;}
    const spec=['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)?node.source:null;
    if(spec?.type==='Literal' && typeof spec.value==='string'){
      if(spec.value.startsWith('.'))dependencies.push(path.posix.normalize(path.posix.join(path.posix.dirname(file),spec.value)));
      else if(spec.value.startsWith(`/vendor/aue-trial/${PIN}/`))dependencies.push(spec.value.slice(`/vendor/aue-trial/${PIN}/`.length));
    }
    for(const value of Object.values(node))visit(value);
  }
  visit(tree);
  for(const dependency of dependencies)await include(dependency);
}
for(const file of ['packages/sim/src/index.js','packages/content/src/traits.js','packages/content/src/compat/kits.js',
  'packages/content/src/compat/grid.js','packages/content/src/skills.js','packages/content/src/foes.js',
  'packages/sim/src/commands.js','packages/sim/src/units.js','packages/content/src/compat/skill.js',
  'packages/content/src/compat/unit.js','packages/content/src/compat/specs.js','packages/sim/src/spawn.js',
  'local/server/sim/content/tokens.js',...Object.values(registry)])await include(file);
// Adapter shims are outside the generated tree. Their explicit native imports
// are roots too; otherwise a warm maintainer cache can hide a broken cold clone.
async function adapterRoots(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())await adapterRoots(file);
    else if(entry.name.endsWith('.js')){
      const tree=parse(await fs.readFile(file,'utf8'),{ecmaVersion:'latest',sourceType:'module'});
      for(const node of tree.body){
        const value=node.source?.value,prefix=`/vendor/aue-trial/${PIN}/`;
        if(typeof value==='string' && value.startsWith(prefix))await include(value.slice(prefix.length));
      }
    }
  }
}
await adapterRoots(path.join(ROOT,'public/sandbox/js/aue'));
for(const file of ['LICENSE','NOTICE.md'])if(available.has(file))used.add(file);
const runtimeManifest={...manifest,files:prepared.filter(row=>used.has(row.file))};
const bundle={version:1,commit:PIN,manifest:runtimeManifest,files:{}};
for(const file of used)bundle.files[file]=await fs.readFile(path.join(target,file),'utf8');
bundle.files['kits.json']=await fs.readFile(path.join(target,'kits.json'),'utf8');
const output=path.join(ROOT,'engine/aue-runtime.json.gz');
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,gzipSync(JSON.stringify(bundle),{level:9}));
console.log(`运行交付闭包：${used.size} 个文件；完整训练数据只用于维护构建，不进入运行包。`);
console.log(`已准备 AUE ${PIN.slice(0, 7)}：${prepared.length} 个文件。启动现有服务后打开 /dev/aue-trial.html。`);
