import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUE_COMMIT } from '../public/sandbox/js/aue/version.js';
const root=path.resolve(import.meta.dirname,'..');
const pin=AUE_COMMIT;
const base=path.join(root,'public/vendor/aue-trial',pin,'packages/content');
const {ROSTER,loadTraining,operatorAt}=await import(pathToFileURL(path.join(base,'src/operators.js')));
const {recordOf,tokenRecordOf}=await import(pathToFileURL(path.join(base,'src/compat/records.js')));
const {TOKENS,loadToken,tokenAt}=await import(pathToFileURL(path.join(base,'src/tokens.js')));
const existing=JSON.parse(await fs.readFile(path.join(root,'data/operator-library.json'),'utf8'));
// A self-designed identity never suppresses its distinct official counterpart.
const known=new Set(Object.values(existing.operators).map(r=>r.charId));
const operators={},tokens={};
for(const id of Object.keys(ROSTER)){
  if(known.has(id))continue;
  const t=await loadTraining(id),elite=t.phases.length-1;
  const build={elite,level:t.phases[elite].maxLevel,potential:6,trust:200,skill:t.skills.findIndex(Boolean),skillLevel:10,module:t.modules.length?0:-1,moduleLevel:3};
  const rec=recordOf(id,t,build);delete rec.diyFor;
  rec.aueNative=true;rec.aueBuild=build;rec.isGolden=true;rec.visible=true;rec.chessType='PRESET';
  rec.assets={spine:id,avatar:id,voice:id};rec.training={phase:elite,level:build.level,potential:6,trust:200,skillLevel:10,equipLevel:build.module<0?0:3};
  for(const skill of rec.skills){skill.name=t.skills[skill.index]?.name || skill.skillId;skill.isDefault=skill.index===build.skill;}
  rec.tokens=[...new Set([...(t.tokens || []),...rec.tokens,...t.skills.map(s=>s?.token).filter(Boolean)])].filter(key=>TOKENS[key]);
  const trainingTokens=Object.fromEntries(await Promise.all(rec.tokens.map(async key=>[key,await loadToken(key)])));
  rec.aueDefinitions={};
  for(const module of [-1,...t.modules.map((_,i)=>i)])for(const skill of rec.skills.length?rec.skills.map(s=>s.index):[-1]){
    const loadout={...build,module,skill},key=`${module<0?'none':t.modules[module].id}:${skill}`;
    rec.aueDefinitions[key]={operator:{...operatorAt(t,loadout),char:id},tokens:Object.fromEntries(rec.tokens.map(key=>[key,{...tokenAt(trainingTokens[key],key,t,loadout),char:key}]))};
  }
  operators[rec.chessId]=rec;
  for(const key of rec.tokens){
    const token=await loadToken(key),r=tokenRecordOf(key,token,t,build);
    const item=tokens[key] ||= {...r,placeable:true,variants:{}};
    item.variants[rec.chessId]={...r,bySkill:{},byModule:{}};
    for(const skill of rec.skills)item.variants[rec.chessId].bySkill[skill.index]=tokenRecordOf(key,token,t,{...build,skill:skill.index});
    for(let i=0;i<t.modules.length;i++)item.variants[rec.chessId].byModule[t.modules[i].id]=tokenRecordOf(key,token,t,{...build,module:i});
  }
}
await fs.writeFile(path.join(root,'data/aue-operators.json'),JSON.stringify({version:1,commit:pin,operators,tokens}));
await fs.writeFile(path.join(root,'public/sandbox/js/generated-aue-library.js'),`// tools/build-aue-roster.mjs 生成。\nexport const AUE_IDS=${JSON.stringify(Object.keys(operators))};\n`);
console.log(`AUE ${Object.keys(ROSTER).length} 个数据身份：保留 ${known.size} 个既有身份，补充 ${Object.keys(operators).length} 个。`);
