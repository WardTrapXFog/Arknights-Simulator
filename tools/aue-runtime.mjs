import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { AUE_COMMIT } from '../public/sandbox/js/aue/version.js';
const root=path.resolve(import.meta.dirname,'..');
const sha=data=>createHash('sha256').update(data).digest('hex');

/** Expand the committed source bundle once per bundle revision. No network. */
export async function ensureAueRuntime() {
  const packed=await fs.readFile(path.join(root,'engine/aue-runtime.json.gz'));
  const hash=sha(packed),target=path.join(root,'public/vendor/aue-trial',AUE_COMMIT),manifestFile=path.join(target,'manifest.json');
  try{
    const known=JSON.parse(await fs.readFile(manifestFile,'utf8'));
    if(known.bundleHash===hash){
      await Promise.all([...known.files.map(row=>row.file),'kits.json'].map(file=>fs.access(path.join(target,file))));
      return;
    }
  }catch(error){if(error.code!=='ENOENT' && !(error instanceof SyntaxError))throw error;}
  const bundle=JSON.parse(gunzipSync(packed));
  if(bundle.version!==1 || bundle.commit!==AUE_COMMIT || bundle.manifest.commit!==AUE_COMMIT)throw Error('AUE 源码包与版本登记不一致');
  for(const [file,text] of Object.entries(bundle.files)){
    const output=path.resolve(target,file);
    if(!output.startsWith(target+path.sep) || file.includes('\\') || typeof text!=='string')throw Error('AUE 源码包路径无效');
    const entry=bundle.manifest.files.find(row=>row.file===file);
    if(entry && sha(text)!==entry.browserSha256)throw Error(`AUE 源码校验失败：${file}`);
    await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,text);
  }
  await fs.writeFile(manifestFile,JSON.stringify({...bundle.manifest,bundleHash:hash}));
}
