import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';
import { gunzipSync } from 'node:zlib';
const root=path.resolve(import.meta.dirname,'..');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024}).toString();
const previous=git('ls-tree','-r','--long','-z','HEAD').split('\0').filter(Boolean).map(row=>{const match=row.match(/^\d+ \w+ [a-f0-9]+\s+(\d+)\t([\s\S]+)$/);return match?{file:match[2],bytes:Number(match[1])}:null;}).filter(Boolean);
const current=[];
for(const file of git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean)){
  try{current.push({file,bytes:(await fs.stat(path.join(root,file))).size});}catch(e){if(e.code!=='ENOENT')throw e;}
}
const summarize=list=>({files:list.length,bytes:list.reduce((n,row)=>n+row.bytes,0)});
const mounts={'/sim/':'server/sim/','/shared/':'shared/','/sandbox/':'public/sandbox/','/vendor/':'public/vendor/'};
async function graph(entry){
  const visited=new Set();
  async function visit(file){
    if(visited.has(file) || !file.endsWith('.js'))return;visited.add(file);
    const text=await fs.readFile(path.join(root,file),'utf8');
    const ast=parse(text,{ecmaVersion:'latest',sourceType:'module'});
    for(const node of ast.body){
      const spec=node.source?.value;if(typeof spec!=='string')continue;
      let next=spec.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),spec)):null;
      for(const [prefix,dir] of Object.entries(mounts))if(spec.startsWith(prefix))next=dir+spec.slice(prefix.length);
      if(next)await visit(next);
    }
  }
  await visit(entry);return {modules:visited.size,loadsOldBattle:visited.has('server/sim/Battle.js')};
}
const packed=await fs.readFile(path.join(root,'engine/aue-runtime.json.gz')),bundle=JSON.parse(gunzipSync(packed));
const report={baseline:git('rev-parse','--short','HEAD').trim(),before:summarize(previous),after:summarize(current),
  retainedKernel:summarize(current.filter(row=>row.file.startsWith('server/sim/') && !row.file.startsWith('server/sim/content/'))),
  sourceBundle:{files:Object.keys(bundle.files).length,packedBytes:packed.length,sourceBytes:Object.values(bundle.files).reduce((n,text)=>n+Buffer.byteLength(text),0)},
  sessionStatic:await graph('public/sandbox/js/session.js'),aueAdapterStatic:await graph('public/sandbox/js/aue/battle.js'),legacyStatic:await graph('public/sandbox/js/legacy-session.js')};
await fs.mkdir(path.join(root,'.agent-runs'),{recursive:true});
await fs.writeFile(path.join(root,'.agent-runs/engine-footprint.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
