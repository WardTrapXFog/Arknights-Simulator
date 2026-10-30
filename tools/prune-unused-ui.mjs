import fs from 'node:fs/promises';
import path from 'node:path';
import { uiAssetAllowed } from './assets/ui-groups.mjs';
import { contentHash } from './assets/manifest.mjs';
const root=path.resolve(import.meta.dirname,'..'),ui=path.join(root,'public/assets/ui');
const manifestPath=path.join(root,'data/assets.json');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
const removedIndex=[];
for(const key of Object.keys(manifest.ui || {})){
  const slash=key.lastIndexOf('/');
  if(!uiAssetAllowed(key.slice(0,slash),key.slice(slash+1))){removedIndex.push(key);delete manifest.ui[key];}
}
const files=[];
async function walk(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const abs=path.join(dir,entry.name);
    if(entry.isDirectory())await walk(abs);
    else if(entry.isFile()){
      const rel=path.relative(ui,abs).replaceAll('\\','/'),slash=rel.lastIndexOf('/');
      if(!uiAssetAllowed(rel.slice(0,slash),rel.slice(slash+1).replace(/\.[^.]+$/,''))){
        const stat=await fs.stat(abs);files.push({path:rel,bytes:stat.size});
        // Every deletion is a regular file beneath the explicitly scoped UI root.
        if(!abs.startsWith(ui+path.sep))throw Error('UI 清理路径越界');
        await fs.unlink(abs);
      }
    }
  }
}
await walk(ui);
manifest.hash=contentHash(Object.fromEntries(Object.entries(manifest).filter(([k])=>!['version','hash','generator','stats'].includes(k))));
if(manifest.stats){manifest.stats.ui=Object.keys(manifest.ui || {}).length;manifest.stats.bytes=Math.max(0,(manifest.stats.bytes || 0)-files.reduce((n,f)=>n+f.bytes,0));manifest.stats.files=Math.max(0,(manifest.stats.files || 0)-files.length);}
await fs.writeFile(manifestPath,JSON.stringify(manifest)+'\n');
await fs.mkdir(path.join(root,'.agent-runs'),{recursive:true});
const report={removedIndex:removedIndex.length,removedFiles:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),entries:removedIndex,files};
await fs.writeFile(path.join(root,'.agent-runs/ui-prune.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({removedIndex:report.removedIndex,removedFiles:report.removedFiles,bytes:report.bytes}));
