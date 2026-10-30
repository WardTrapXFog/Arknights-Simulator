import { createTerrainContent } from './terrain-content.js';
import { DataSource, flattenBlackboard } from '/sim/simdata.js';
import { levelSpawns } from '/shared/level.js';
import { routesOf } from '../battlefield.js';
import { OFFICIAL_IDS } from '../generated-library.js';
import { genericKit } from '/sim/content/generic.js';
import { usesLocalEnemy } from './enemies.js';
import { nativeLoadout } from './native-operators.js';

export function selectKit(kit,def) {
  const id=def.skill?.id;
  if(id && Object.hasOwn(kit.skills || {},id))return {...kit,skill:kit.skills[id]};
  if(!def.diyFor && !def.standInFor && def.loadout?.skillIsDefault!==false)return kit;
  const generic=genericKit(def.skill?.bb ?? {},def.raw,def), own=kit.install, install=generic.install;
  return {...kit,skill:generic.skill,skillSource:'generic',install(b,u){own?.(b,u);install?.(b,u);}};
}

const spNames = { time: 'INCREASE_WITH_TIME', attack: 'INCREASE_WHEN_ATTACK', hurt: 'INCREASE_WHEN_TAKEN_DAMAGE', none: 'ON_DEPLOY' };
export function skillDefinition(s, runtime) {
  if (!s) return null;
  const result=runtime.skillDefs.skillDefOf(s.id, { skillType: s.skillType, durationType: s.durationType, duration: s.duration,
    description: s.description, rangeId: null, spData: { spType: spNames[s.spType], spCost: s.spCost, initSp: s.initSp, maxChargeTime: s.maxCharges },
    blackboard: Object.entries(s.bb).filter(([,v]) => typeof v === 'number').map(([key,value]) => ({ key,value })) });
  return {...result,...(s.rangeGrid?{range:s.rangeGrid.map(([row,col])=>({row,col}))}:{})};
}
export function operatorDefinition(d,runtime) {
  const result=runtime.traits.withTrait({ name:d.name,char:d.charId,profession:d.profession,branch:d.subProf,position:d.position,
    ...d.stats,baseAttackTime:d.stats.bat,redeploy:d.stats.respawnTime,hpRegen:d.stats.hpRecoveryPerSec,traitBb:d.traitBb,
    range:(d.rangeGrid || [[0,0]]).map(([row,col])=>({row,col})),skill:skillDefinition(d.skill,runtime) });
  return d.dmgType?{...result,dmgType:d.dmgType}:result;
}
function point(p, name) {
  if (!Array.isArray(p) || p.length < 2 || !p.every(Number.isFinite)) throw Error(`${name}坐标无效`);
  return { row: p[0], col: p[1] };
}
function routeOf(input) {
  if (!input?.end) throw Error('无终点／钉住的路线需要独立出生处理，不能当作到蓝门路线');
  const origin=point(input.start,'起点'),start={row:Math.round(origin.row),col:Math.round(origin.col)};
  return { start, spawnOffset:{x:origin.col-start.col,y:origin.row-start.row}, end: point(input.end, '终点'), motion: input.motion || 'WALK',
    allowDiagonal: input.allowDiagonal !== false, checkpoints: (input.checkpoints || []).map(cp => {
      if (cp.type === 'WAIT') return { type: 'WAIT_FOR_SECONDS', time: cp.time || 0, row: 0, col: 0 };
      if (cp.type === 'DISAPPEAR') return { type: 'DISAPPEAR', time: cp.time || 0, row: 0, col: 0 };
      if (cp.type === 'APPEAR') return { type: 'APPEAR_AT_POS', ...point(cp.pos, '出现点'), time: 0 };
      if (!['MOVE', 'PATROL_MOVE'].includes(cp.type)) throw Error(`路线节点尚未适配：${cp.type}`);
      return { type: cp.type, ...point(cp.pos, '移动点'), time: 0 };
    }) };
}
export function nativeEnemy(raw, mods, runtime) {
  const s = raw.stats, mul = key => mods?.[key] ?? 1;
  const talents = {};
  for (const [key, value] of Object.entries(raw.talents?.bb || {})) {
    const dot = key.indexOf('.');
    if (dot < 0) throw Error(`${raw.name} 的天赋键未分组：${key}`);
    (talents[key.slice(0, dot)] ??= {})[key.slice(dot + 1)] = value;
  }
  let def = { name: raw.name, maxHp: s.maxHp * mul('hpMul'), atk: s.atk * mul('atkMul'), def: s.def * mul('defMul'), res: s.res * mul('resMul'),
    moveSpeed: s.moveSpeed * mul('speedMul'), baseAttackTime: s.bat, hpRegen:s.hpRecoveryPerSec, aspd: s.aspd, blockCnt: s.blockCnt, rangeRadius: s.rangeRadius,
    applyWay: raw.applyWay, motion: s.motion, dmgType: s.dmgType, levelType: raw.rank, lifePointReduce: s.lpr ?? 1,
    massLevel: s.massLevel, tauntLevel: s.tauntLevel, immune: Object.entries(s.immunities || {}).filter(([,v])=>v).map(([k])=>({frozen:'freeze',levitate:'levitate'}[k] || k)),
    // The local -1 timer sentinel is unused by attack/SP skills. Native timers
    // are always nonnegative; SP retains the actual attack-trigger condition.
    talents, skills: (raw.skills || []).map(s => ({ key: s.prefabKey, cooldown: Math.max(0,s.cooldown || 0), initCooldown: Math.max(0,s.initCooldown || 0), sp: s.spCost, bb: s.bb ?? flattenBlackboard(s.blackboard) })),
    tags: raw.tags || [], ...(raw.attackAnim ? { attack: { duration: raw.attackAnim.dur, hit: raw.attackAnim.hit } } : {}) };
  def = runtime.foes.withFoeExtras(raw.key, def);
  const uncovered = runtime.foes.uncoveredAbilities([def]);
  if (usesLocalEnemy(raw,uncovered.length>0)) return { ...def, talents: {}, skills: [], localCompatibility:true };
  if (uncovered.length) throw Error(`${raw.name} 有尚未覆盖的敌人能力：${uncovered.join('、')}`);
  // Do not invoke withoutIncomplete(): missing numeric parameters must be an error, not a lost ability.
  return def;
}
export function registerSpawn(content,meta,ds,runtime,spawn) {
  const key=spawn.enemyKey,raw=ds.rawEnemy(key);
  if(!raw)throw Error(`敌人数据缺失：${key}`);
  const routes=meta.document.stage.routes?.length?meta.document.stage.routes:routesOf(meta.document.stage);
  let input=typeof spawn.route==='string'?routes.find(r=>r.id===spawn.route):spawn.route;
  const pinned=!!spawn.pos && !input?.end && spawn.routeIndex==null;
  input ??= pinned?{start:spawn.pos,end:spawn.pos,checkpoints:[]}:routes[spawn.routeIndex ?? 0];
  if(!input)throw Error('出生缺少路线或位置');
  if(spawn.pos)input={...input,start:spawn.pos};
  if(!input.end && pinned)input={...input,end:input.start};
  const alias=`si:enemy:${Object.keys(meta.enemies).length}`,def=nativeEnemy(raw,pinned?{...spawn.mods,speedMul:0}:spawn.mods,runtime);
  const index=content.level.routes.length;
  content.level.routes.push(routeOf(input));content.enemies[alias]=def;
  meta.enemies[alias]={raw,spawn,route:input,pinned,local:!!def.localCompatibility};
  return {type:'SPAWN',key:alias,route:index,count:spawn.count ?? 1,preDelay:spawn.time ?? 0,interval:spawn.interval ?? 0,unharmful:def.lifePointReduce===0};
}

/** Build from SI records. No match schema, network session or official training replaces project content. */
export async function createBattleContent(document, source, runtime, { mode = 'level', moduleSelections = {}, attachBridge } = {}) {
  const { content } = createTerrainContent(document);
  const ds = new DataSource({}, source), meta = { operators: {}, enemies: {}, entries: {}, document, mode };
  content.level.options.initialCost = mode === 'level' ? 10 : 30;
  content.level.options.moveMultiplier = 1;
  const routes = document.stage.routes?.length ? document.stage.routes : routesOf(document.stage);
  // Editor files use enemy/at; live SI documents already use enemyKey/time. Never concatenate both sources.
  const inputs = document.spawns != null
    ? (document.spawns.some(s => s.enemy != null) ? levelSpawns(document) : document.spawns)
    : (document.waves?.length ? (() => { throw Error('沙盒旧波次应先经 SI spawnsOf 转换'); })() : []);
  const actions = [];
  for (let i = 0; i < inputs.length; i++) {
    actions.push(registerSpawn(content,meta,ds,runtime,inputs[i]));
  }
  content.level.waves = actions.length ? [{ preDelay: 0, postDelay: 0, maxWait: -1, fragments: [{ preDelay: 0, actions }] }] : [];
  const savedOperators=(document.operators || []).filter(o=>!o.tokenId);
  if(mode!=='level')for(const token of (document.operators || []).filter(o=>o.tokenId)){
    if(!savedOperators.some(o=>o.uid===token.ownerUid) && token.owner?.chessId)savedOperators.push({...token.owner,uid:token.ownerUid,row:0,col:0,detached:true});
  }
  const picks = mode === 'level' ? document.squad || [] : savedOperators.map(o => o.chessId);
  meta.factories=new Map();
  if(mode!=='level') {
    const records=new Map(OFFICIAL_IDS.map(id=>[id,source.rawChess(id)]));
    for(const id of document.squad || [])records.set(id,source.rawChess(id));
    await Promise.all([...records].map(async ([id,r])=>{if(r && !r.aueNative)meta.factories.set(id,await runtime.factory(r));}));
  }
  for (let i = 0; i < picks.length; i++) {
    const chessId = picks[i], saved = mode === 'level' ? null : savedOperators[i];
    const d = ds.getChess(chessId, { skillIndex: saved?.skillIndex ?? document.skillSelections?.[chessId], moduleId: saved?.moduleId ?? moduleSelections[chessId] });
    if (!d) throw Error(`干员数据缺失：${chessId}`);
    const key = `si:op:${i}`, built=nativeLoadout(d);
    if(built){content.operators[key]=built.operator;content.decks[0].push(key);meta.operators[key]={chessId,def:d,uid:saved?.uid ?? i+1,saved,native:built};continue;}
    const original = await runtime.factory(d.raw), native = operatorDefinition(d,runtime);
    const entry = { def:d,tokens:{},factory:(...args)=>selectKit(original(...args),d) };
    content.operators[key] = runtime.kits.withKitTrait(native, entry, content.level);
    content.decks[0].push(key); meta.operators[key] = { chessId, def: d, uid: saved?.uid ?? i + 1, saved };
    meta.entries[key] = entry;
  }
  // Two passes: reserve all persistent pieces and SI hand units before installing
  // content. This prevents the first operator's install from observing a half-built deck.
  const deferred=Object.fromEntries(Object.entries(meta.entries).map(([k,e])=>[k,{...e,factory:()=>({})}]));
  const kb = runtime.kits.kitsBehaviors(deferred, b => {
    for(const [key,info] of Object.entries(meta.operators))if(info.native){
      const unit=new runtime.wrappers.ShUnit(b,{kind:'op',key,ownerId:0,def:info.def,pieceId:runtime.sim.reserveIds(b.w,1)});
      b.pieces.set(`0|${key}`,unit);
    }
    attachBridge(b,meta);
    for(const [key,entry] of Object.entries(meta.entries)) {
      const u=b.pieces.get(`0|${key}`);
      const kit=b.safe(()=>entry.factory(entry.def.skill?.bb ?? {},entry.def.raw,entry.def),'kit',u);
      b._setupUnit(u,kit);
    }
    for(const unit of b.pieces.values())if(unit.kind==='token' && !unit._siKitInstalled)b._setupUnit(unit);
    runtime.tokens.install(b);
  });
  const specBehavior=Object.values(kb.skills)[0];
  if(specBehavior)for(const e of Object.values(meta.entries))for(const s of e.def.raw.skills || [])kb.skills[s.skillId || s.id]=specBehavior;
  const originalWorld=kb.world;
  kb.world=(w,c)=>{w.frame=Math.max(0,Math.round((document.session?.time || 0)*30));originalWorld(w,c);};
  content.behaviors = { ...kb, skills:{...runtime.skillDefs.skillBehaviors,...kb.skills}, foes: runtime.foes.foeBehaviors };
  return { content, meta, ds };
}
