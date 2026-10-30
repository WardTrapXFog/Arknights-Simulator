#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
const ROOT=path.resolve(import.meta.dirname,'..');
const mounts={'/sim/':'server/sim/','/shared/':'shared/','/vendor/':'public/vendor/','/sandbox/':'public/sandbox/'};
registerHooks({resolve(spec,ctx,next){for(const [prefix,dir] of Object.entries(mounts))if(spec.startsWith(prefix))return next(pathToFileURL(path.join(ROOT,dir,spec.slice(prefix.length))).href,ctx);return next(spec,ctx);}});
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,opts)=>{
  if(typeof url==='string' && url.startsWith('/vendor/')){
    try{return new Response(await fs.readFile(path.join(ROOT,'public',url.slice(1))),{headers:{'Content-Type':'application/json'}});}
    catch(e){if(e.code==='ENOENT')return new Response('',{status:404});throw e;}
  }
  return originalFetch(url,opts);
};
const {getData}=await import('../server/data.js');
const {DataSource}=await import('../server/sim/simdata.js');
const {loadAueRuntime}=await import('../public/sandbox/js/aue/runtime.js');
const {prepareBattle}=await import('../public/sandbox/js/aue/battle.js');
const base=getData({log:{info(){},warn(){},error(){}}});
const library=JSON.parse(await fs.readFile(path.join(ROOT,'data/operator-library.json'),'utf8'));
const extension=JSON.parse(await fs.readFile(path.join(ROOT,'data/aue-operators.json'),'utf8'));
Object.assign(library.operators,extension.operators);
for(const [key,record] of Object.entries(extension.tokens))library.tokens[key]={...record,...library.tokens[key],variants:{...record.variants,...library.tokens[key]?.variants}};
const data={...base,chess:{...base.chess,...library.operators},tokens:{...base.tokens,...library.tokens}};
const ds=new DataSource(data), runtime=await loadAueRuntime();
const stage={id:'aue-exercise',rows:Array.from({length:19},(_,r)=>r===9?'##ErrrrrrrS##########':'#'.repeat(21)),rect:{r0:9,r1:9,c0:2,c1:10},routes:[{id:'r',start:[9,10],end:[9,2],motion:'WALK',checkpoints:[]}]};
const pick=Object.values(library.operators).find(r=>r.charId==='char_290_vigna').chessId;
const document={stage,squad:[pick],operators:[],skillSelections:{},spawns:[{time:2,enemyKey:'enemy_1007_slime',routeIndex:0,count:1}],meta:{lifeLimit:3,deployLimit:13}};
const battle=await prepareBattle(document,ds,runtime,{mode:'level'});
const deployed=battle.hand.deploy(pick,9,7,'RIGHT');
assert.equal(deployed.error,undefined,deployed.error);
for(let i=0;i<1800&&!battle.finished;i++)battle.step();
assert.equal(battle.reason,'cleared');
assert.equal(battle.killed,1);
assert.ok(battle.sandboxScore.read().total>0,'实际伤害必须进入火力计分');
console.log(JSON.stringify({scenario:'basic-battle',backend:battle.backend,reason:battle.reason,killed:battle.killed,score:battle.sandboxScore.read().total,events:battle.drainEvents().length}));
battle.close();
if(process.argv.includes('--roster')){
  const results=[];
  for(const record of Object.values(library.operators)){
    try{const b=await prepareBattle({...document,squad:[record.chessId],spawns:[]},ds,runtime,{mode:'level'});b.close();results.push({name:record.name,ok:true});}
    catch(e){results.push({name:record.name,error:e.message});}
  }
  const custom=Object.values(base.chess).filter(r=>['char_1503_talula','char_9901_vina','char_9902_custommakoto'].includes(r.charId));
  for(const record of custom){try{const b=await prepareBattle({...document,squad:[record.chessId],spawns:[]},ds,runtime,{mode:'level'});b.close();results.push({name:record.name,ok:true});}catch(e){results.push({name:record.name,error:e.message});}}
  await fs.mkdir(path.join(ROOT,'.agent-runs'),{recursive:true});
  await fs.writeFile(path.join(ROOT,'.agent-runs/aue-runtime-roster.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({scenario:'roster-construction',total:results.length,ok:results.filter(r=>r.ok).length,failures:results.filter(r=>!r.ok)}));
}
if(process.argv.includes('--combat-roster') || process.argv.includes('--skills')){
  const results=[];
  const records=[...Object.values(library.operators),...Object.values(base.chess).filter(r=>['char_1503_talula','char_9901_vina','char_9902_custommakoto'].includes(r.charId))];
  for(const record of records){
   const indices=process.argv.includes('--skills')?(record.skills || []).map((_,i)=>i):[undefined];
   for(const index of indices){
    let b;
    try{
      b=await prepareBattle({...document,squad:[record.chessId],skillSelections:index==null?{}:{[record.chessId]:index},meta:{lifeLimit:999,deployLimit:13},spawns:[{time:0,enemyKey:'enemy_1007_slime',routeIndex:0,count:5,interval:2,mods:{hpMul:50,atkMul:0}}]},ds,runtime,{mode:'level'});
      b.players[0].dp=99;
      const result=b.hand.deploy(record.chessId,9,7,'RIGHT');
      if(result.error)throw Error(result.error);
      const unit=result.unit;
      unit.skill?.setSpTotal(unit.skill.spCost);
      if(unit.skill?.ready)unit.skill.activate('manual');
      for(let i=0;i<180;i++)b.step();
      results.push({name:record.name,index,ok:true,score:b.sandboxScore.read().total});
    }catch(e){results.push({name:record.name,index,error:e.message});}
    finally{b?.close();}
   }
  }
  await fs.writeFile(path.join(ROOT,process.argv.includes('--skills')?'.agent-runs/aue-runtime-skills.json':'.agent-runs/aue-runtime-combat.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({scenario:'roster-combat',total:results.length,ok:results.filter(r=>r.ok).length,failures:results.filter(r=>!r.ok)}));
}
if(process.argv.includes('--contracts')){
  const rows=Array.from({length:19},(_,r)=>r>=8 && r<=11?'##'+'r'.repeat(9)+'#'.repeat(10):'#'.repeat(21));
  const wide={...stage,rows,rect:{r0:8,r1:11,c0:2,c1:10}};
  const ids=Object.keys(library.operators).slice(0,13);
  let b=await prepareBattle({...document,stage:wide,squad:ids,spawns:[]},ds,runtime,{mode:'level'});
  for(let i=0;i<13;i++)assert.equal(b.hand.deploy(ids[i],8+Math.floor(i/9),2+i%9,'RIGHT',{ignoreCost:true}).error,undefined);
  assert.equal(b.hand.deployedCount(),13);b.close();console.log('13人编队与部署位：通过');
  const empty={...document,stage:wide,squad:[pick],operators:[],spawns:[]};
  b=await prepareBattle(empty,ds,runtime,{mode:'sandbox'});
  const a=b._createAllyFromInput(b.players[0],{chessId:pick,row:9,col:4,dir:'RIGHT',uid:1});assert.ok(b._deploy(a));
  const c=b._createAllyFromInput(b.players[0],{chessId:pick,row:9,col:5,dir:'LEFT',uid:2});assert.ok(b._deploy(c));
  assert.notEqual(a.id,c.id);assert.notEqual(a._aueKey,c._aueKey);
  const spawned=b.spawnEnemy('enemy_1007_slime',{pos:[9,8],mods:{atkMul:0,hpMul:100}});
  if(process.argv.includes('--debug'))console.log('spawn',spawned.u,b.content.enemies);
  b.step();if(process.argv.includes('--debug'))console.log('after',b.world.events,b.world.units);assert.equal(b.enemies.length,1);assert.equal(b.enemies[0].x,8);b.close();console.log('沙盒重复干员与原地刷怪：通过');
  b=await prepareBattle(document,ds,runtime,{mode:'level'});const first=b.hand.deploy(pick,9,7,'RIGHT');
  b.retreat(first.unit,{reason:'retreat'});assert.ok(b.hand.status(b.hand.record(pick)).includes('再部署'));assert.equal(b.hand.deployedCount(),0);b.close();console.log('撤退、回手与冷却：通过');
  const saved={...empty,operators:[{chessId:pick,uid:11,row:9,col:4,dir:'LEFT',runtime:{hp:100,sp:3,atkCd:0.5}}],session:{time:20,dp:42,killed:2,leaked:1}};
  b=await prepareBattle(saved,ds,runtime,{mode:'sandbox'});assert.equal(b.time,20);assert.equal(b.players[0].dp,42);assert.equal(b.allyUnits[0].hp,100);assert.equal(b.allyUnits[0].atkCd,0.5);assert.equal(b.allyUnits[0].uid,11);b.close();console.log('旧格式现场重建：通过');
  const wang=Object.values(library.operators).find(r=>r.charId==='char_2027_wang').chessId;
  b=await prepareBattle({...empty,squad:[wang],skillSelections:{[wang]:2}},ds,runtime,{mode:'level'});b.players[0].dp=99;
  const w=b.hand.deploy(wang,9,4,'RIGHT');assert.equal(w.error,undefined);
  // Begin with an exhausted held stock, so S3 grants stock without filling the
  // adjacent test tiles with overflow followers before manual deployment.
  const held=[...b.hand.records.values()].find(r=>r.tokenId==='token_10064_wang_stone1');b.hand.setStock(held,0);
  w.unit.skill.setSpTotal(w.unit.skill.spCost);assert.ok(w.unit.skill.activate('manual'));
  const overflow=w.unit.mem.wang.followers.length;
  const stone=b.hand.cards().find(r=>r.tokenId==='token_10064_wang_stone1');assert.ok(stone,'棋子必须进入手牌');
  assert.equal(b.hand.deploy(stone.id,9,6,'RIGHT').error,undefined);
  if(process.argv.includes('--debug'))console.log('wang-before',{overflow,active:w.unit.skill.active,ammo:w.unit.skill.ammoLeft,stock:w.unit.mem.wang.stock,pending:w.unit.mem.wang.pending,stone:b.hand.record(stone.id).units.find(u=>u.alive)?.mem,followers:w.unit.mem.wang.followers});
  for(let i=0;i<40;i++)b.step();
  if(process.argv.includes('--debug'))console.log('wang-after',{active:w.unit.skill.active,ammo:w.unit.skill.ammoLeft,stock:w.unit.mem.wang.stock,pending:w.unit.mem.wang.pending,followers:w.unit.mem.wang.followers});
  assert.equal(w.unit.mem.wang.followers.length,overflow+4,'必须在开技溢出棋子之外落下一枚常规与三枚额外跟子');assert.ok(b.drainEvents().some(e=>e[0]==='fx' && e[1]==='wangStoneLand' && e.length===5));b.close();console.log('望三技能手牌、延迟四跟子与表现事件：通过');
  const makoto=Object.values(base.chess).find(r=>r.charId==='char_9902_custommakoto').chessId;
  b=await prepareBattle({...empty,squad:[makoto]},ds,runtime,{mode:'sandbox'});
  const actor=b._createAllyFromInput(b.players[0],{chessId:makoto,row:9,col:4,dir:'RIGHT',uid:1});assert.ok(b._deploy(actor));b.players[0].dp=99;
  const persona=actor.mem.customMakoto;assert.equal(persona.banks.length,3);assert.ok(persona.switchPersona(1));
  assert.notEqual(persona.banks[0].st,persona.banks[1].st);
  for(let i=0;i<151;i++)b.step();assert.ok(persona.banks[0].sp>0);assert.ok(persona.switchPersona(2));b.close();console.log('结城理独立技力与人格切换：通过');
  b=await prepareBattle({...empty,squad:[wang],skillSelections:{[wang]:2}},ds,runtime,{mode:'level'});b.players[0].dp=99;
  const summoner=b.hand.deploy(wang,9,4,'RIGHT').unit;
  const follower=summoner.b.spawnToken(summoner,'token_10064_wang_stone1',9,6,{stats:{maxHp:1234},hp:321,duration:0.1});
  assert.ok(follower);assert.equal(follower.hp,321);assert.equal(follower.maxHp,1234);assert.equal(follower.ownerUnit,summoner);
  for(let i=0;i<5;i++)b.step();assert.equal(follower.alive,false);b.close();console.log('动态召唤物、持有者、独立属性与定时离场：通过');
  const raw=data.enemies.enemy_1007_slime;
  for(const cost of [0,3]){
    const key=`exercise_life_${cost}`;
    const lifeSource=new DataSource({...data,enemies:{...data.enemies,[key]:{...raw,key,stats:{...raw.stats,lpr:cost}}}});
    b=await prepareBattle({...document,squad:[],spawns:[{time:0,enemyKey:key,routeIndex:0,count:1}]},lifeSource,runtime,{mode:'level'});
    for(let i=0;i<1800 && !b.finished;i++)b.step();
    assert.equal(b.leakedCount,1);assert.equal(b.life,cost===0?3:0);assert.equal(b.reason,cost===0?'cleared':'forced');b.close();
  }
  console.log('不扣生命漏怪与生命耗尽失败分支：通过');
  const added=Object.values(extension.operators).find(r=>r.profession==='CASTER');
  b=await prepareBattle({...empty,squad:[added.chessId]},ds,runtime,{mode:'sandbox'});
  const native=b._createAllyFromInput(b.players[0],{chessId:added.chessId,row:9,col:4,dir:'RIGHT',uid:1});
  assert.ok(b._deploy(native));assert.equal(native.def.charId,added.charId);b.step();b.close();
  console.log('新增原生干员加入沙盒编队与投放：通过');
}
if(process.argv.includes('--enemies')){
  const {nativeEnemy}=await import('../public/sandbox/js/aue/content.js');
  const results=Object.entries(data.enemies).map(([key,raw])=>{try{nativeEnemy(raw,{},runtime);return {key,name:raw.name,ok:true};}catch(e){return {key,name:raw.name,error:e.message};}});
  await fs.writeFile(path.join(ROOT,'.agent-runs/aue-enemy-content.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({scenario:'enemy-content',total:results.length,ok:results.filter(r=>r.ok).length,failures:results.filter(r=>!r.ok)}));
}
if(process.argv.includes('--local-enemies') || process.argv.includes('--enemy-combat')){
  let entries=process.argv.includes('--enemy-combat')?Object.values(data.enemies):JSON.parse(await fs.readFile(path.join(ROOT,'content/enemies/index.json'),'utf8'));
  const selectedKey=process.argv[process.argv.indexOf('--enemy-key')+1];
  if(process.argv.includes('--enemy-key'))entries=entries.filter(r=>r.key===selectedKey);
  const rows=Array.from({length:19},(_,r)=>r>=8 && r<=11?'##'+'r'.repeat(9)+'#'.repeat(10):'#'.repeat(21));
  const results=[];
  for(const {key,name} of entries){
    let b;
    try{
      b=await prepareBattle({...document,stage:{...stage,rows,rect:{r0:8,r1:11,c0:2,c1:10}},spawns:[]},ds,runtime,{mode:'sandbox'});
      const actor=b._createAllyFromInput(b.players[0],{chessId:pick,row:9,col:6,dir:'RIGHT',uid:1});b._deploy(actor);
      b.spawnEnemy(key,{pos:[9,7],mods:{hpMul:100,atkMul:.01}});
      for(let i=0;i<1000;i++)b.step();
      results.push({key,name,ok:true});
    }catch(e){results.push({key,name,error:e.message,stack:e.stack});}finally{b?.close();}
  }
  await fs.writeFile(path.join(ROOT,process.argv.includes('--enemy-combat')?'.agent-runs/aue-enemy-combat.json':'.agent-runs/aue-local-enemies.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({scenario:'local-enemies',total:results.length,ok:results.filter(r=>r.ok).length,failures:results.filter(r=>!r.ok)}));
}
if(process.argv.includes('--http')){
  const {startSandboxServer}=await import('../server/sandbox/index.js');
  const logs=[],app=await startSandboxServer({port:0,host:'127.0.0.1',debug:true,log:{info:s=>logs.push(s),warn(){},error(){}}});
  try{
    for(const file of ['/healthz','/dev/aue-trial.html','/dev/aue-trial.js','/sandbox/js/aue/runtime.js','/sandbox/js/aue/battle.js',
      '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/manifest.json','/studio/play.html?engine=aue']){
      const response=await originalFetch(`http://127.0.0.1:${app.port}${file}`);
      assert.equal(response.status,200,file);if(file.endsWith('.js'))assert.match(response.headers.get('content-type'),/javascript/);await response.arrayBuffer();
    }
    const response=await originalFetch(`http://127.0.0.1:${app.port}/api/log`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lines:['[AUE试接] HTTP逻辑检查']})});
    assert.equal(response.status,200);await response.arrayBuffer();assert.ok(logs.some(s=>s.includes('HTTP逻辑检查')));
    console.log('独立入口、模块HTTP/MIME、正式入口与调试日志：通过');
  }finally{app.server.closeAllConnections();await app.close();}
}
if(process.argv.includes('--session')){
  const {session}=await import('../public/sandbox/js/session.js');
  for(const backend of ['aue','legacy']){
    globalThis.location={search:`?engine=${backend}`};
    await session.open(document,ds,{mode:'level'});
    assert.equal(session.backend(),backend);
    assert.equal(session.hand().deploy(pick,9,7,'RIGHT').error,undefined);
    for(let i=0;i<1800 && !session.finished();i++)session.step();
    assert.ok(session.cleared());session.close();
  }
  delete globalThis.location;console.log('正式会话选择与旧引擎显式回退：通过');
}
