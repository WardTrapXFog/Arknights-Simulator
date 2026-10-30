import { Grid } from '/sim/grid.js';
import { COLS, ROWS } from '/sim/constants.js';
import { unitInfo, unitTuple } from '/sim/snapshot.js';
import { installDeploymentHand } from '/sim/battle/deployment-hand.js';
import { createDamageScore } from '../damage-score.js';
import { createBattleContent, operatorDefinition, registerSpawn, selectKit } from './content.js';
import { setGameData } from './sh/data.js';
import { getSimData } from '/sim/simdata.js';
import { resolveProfile } from '/sim/professions.js';
import { pushTiles } from '/sim/battle/displacement.js';
import { ELEMENT } from '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/packages/content/src/compat/mods.js';
import { BattleSummons } from '/sim/battle/summons.js';
import { normalizeToken } from '/sim/simdata.js';
import { normDir } from '/sim/dir.js';
import { installLocalEnemies } from './enemies.js';
import { nativeLoadout } from './native-operators.js';
import { canDeployOn } from '/shared/deployment.js';
import { installEconomy } from './economy.js';
import { appendReadouts } from './snapshot.js';

/** One AUE world, projected to the existing SI session/renderer contract. */
export async function prepareBattle(document, source, runtime, opts = {}) {
  let bridge;
  const feed = [], deathQueue = [], manual = new Set(), known = new Set(), spawnState = new Map(),pending=[];
  let additional=0;
  let killed = document.session?.killed || 0, leaked = document.session?.leaked || 0, started = false, forced = null;
  let ds;
  const { sim } = runtime;
  function enrich(u, info) {
    if (u.__si) return u;
    u.__si = true; u.uid = info?.uid ?? sim.reserveIds(u.b.w, 1); u.player = bridge.players[0];
    u.respawnAt = 0; u.homeR = info?.saved?.row ?? 0; u.homeC = info?.saved?.col ?? 0;
    u.deathAt = -Infinity; u.lastAttackAt = -Infinity; u.aggroSeq = u.id;
    u.skillAnimUntil = -Infinity; u.mem.deployCostPaid = 0; u._aueKey = u.defId;
    if (info) u.defId = info.chessId;
    u.nativeTokenDefs=info?.native?.tokens || {};
    let dir = info?.saved?.dir ?? 'RIGHT', removed = false, rangeOverride;
    const baseChanges={};
    const baseView=new Proxy({}, {
      get:(_target,key)=>u.u?.base?.[key] ?? baseChanges[key] ?? u.def?.stats?.[key],
      set:(_target,key,value)=>{baseChanges[key]=value;if(u.u)u.u.base[key]=value;return true;},
      ownKeys:()=>[...new Set([...Object.keys(u.def?.stats || {}),...Object.keys(u.u?.base || {}),...Object.keys(baseChanges)])],
      getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true}),
    });
    u.baseChanges=baseChanges;
    Object.defineProperties(u, {
      base: { configurable: true, get: () => baseView },
      dir: { configurable: true, get: () => u.u?.dir ?? dir, set: value => { dir = value; if (u.u) u.u.dir = value; } },
      removed: { configurable: true, get: () => removed, set: value => { removed = !!value; } },
      moving: { get: () => !!u.u && u.side === 'enemy' && !u.u.blockedBy && !u.u.hidden && u.u.path.length > 0 },
      facing: { get: () => u.dir === 'LEFT' ? -1 : 1 },
      motion: { get: () => u.u?.base.motion ?? u.def?.motion ?? 'WALK' },
      route:{get:()=>{
        const raw=u.u,r=raw && bridge.c.level.routes[raw.route];
        return r?{legs:raw.base.moveSpeed===0?[]:sim.routes.legsOf(r).map(l=>l.t==='wait'?{...l,time:l.frames/30}:l),legIdx:raw.leg,waitLeft:raw.wait/30,native:{route:raw.route,leg:raw.leg,path:raw.path.slice(),wait:raw.wait}}:null;
      },set:route=>{if(u.u && route?.native){u.u.route=route.native.route;u.u.leg=route.native.leg;u.u.path=route.native.path.slice();u.u.wait=route.native.wait;}}},
      elem:{get:()=>u.u?Object.fromEntries(Object.entries(ELEMENT).map(([name,key])=>[name,(u.s.maxEp || 1000)-(u.u.ep[key] ?? u.s.maxEp ?? 1000)])):null},
      rangeGrid:{configurable:true,get:()=>rangeOverride===undefined?(u.u?.range?.map(p=>[p.row,p.col]) ?? u.def?.raw?.rangeGrid ?? u.def?.rangeGrid ?? null):rangeOverride,
        set:value=>{rangeOverride=value;if(u.u)sim.setRange(u.u,Array.isArray(value)?value.map(([row,col])=>({row,col})):null);}},
    });
    u.applyStoredRange=()=>{if(rangeOverride!==undefined)sim.setRange(u.u,Array.isArray(rangeOverride)?rangeOverride.map(([row,col])=>({row,col})):null);};
    let profile=resolveProfile(u.def,u.kit?.trait);
    const nativeFunnel=bridge.c.operators[u._aueKey]?.trait?.funnel;
    Object.defineProperty(u,'profile',{configurable:true,get:()=>profile,set:next=>{
      profile=next;
      const definition=bridge.c.operators[u._aueKey];
      if(u.kind==='token' && !u.ownerUnit?.nativeTokenDefs[u.defId] && definition){
        definition.trait={...definition.trait,noAttack:!!next.noAttack,heal:!!next.heal,
          antiAir:!!next.canHitFly,targets:next.maxTargets ?? 1,hits:next.hits ?? 1};
        if(['phys','arts','true'].includes(next.dmgType))definition.dmgType=next.dmgType;
      }
      if(nativeFunnel && bridge.c.operators[u._aueKey])bridge.c.operators[u._aueKey].trait={...bridge.c.operators[u._aueKey].trait,
        funnel:next.funnelMul===null?null:nativeFunnel};
    }});
    if (u.skill) {
      let selected=u.skill;
      const initial=selected;
      Object.defineProperty(initial,'st',{configurable:true,get:()=>initial._state || (selected===initial?u.u?.skill:null)});
      const definition=bridge.c.operators[u._aueKey]?.skill ?? null;
      Object.defineProperty(u.skill, 'def', { configurable: true, get: () => definition });
      Object.defineProperty(u.skill, 'spTotal', { get: () => u.skill.sp });
      u.skill.setSpTotal = amount => { u.skill.sp = amount; };
      Object.defineProperty(u.skill,'pending',{configurable:true,get:()=>!!u.skill.st?.armed,set:value=>{if(u.skill.st)u.skill.st.armed=!!value;}});
      u.skill.addAmmo=n=>{if(u.skill.active && u.skill.kind==='ammo' && Number.isFinite(n))u.skill.ammoLeft+=n;};
      u.skill.addCharge=(n=1)=>{u.skill.charges=Math.max(0,Math.min(u.skill.maxCharges,u.skill.charges+n));};
      u.skill.extend=n=>{if(u.skill.active && Number.isFinite(n))u.skill.timeLeft+=n;};
      initial.reset=()=>{initial._state=sim.skills.makeSkillState(initial.def);};
      Object.defineProperty(u,'skill',{configurable:true,get:()=>selected,set:bank=>{
        if(u.u && selected===initial)initial._state=u.u.skill;
        selected=bank;
        if(u.u)u.u.skill=bank.st;
        bridge.c.operators[u._aueKey].skill=bank.def;
      }});
    }
    return u;
  }
  function attach(b, meta) {
    if (b.__si) { for (const u of b.pieces.values()) { enrich(u, meta.operators[u._aueKey || u.defId]); if(b.hand && u.kind==='op' && b.siLevel)b.hand.addOperator(u); } return; }
    bridge = b; b.__si = true; b.__runtime=runtime;b.flags = { siLevel: opts.mode === 'level', siTheme: document.meta?.theme ?? null,
      deployLimit: b.c.level.options.characterLimit, lifeLimit: b.c.level.options.maxLifePoint, dpMax: 99, dpPerSec: 1 };
    b.siLevel = b.flags.siLevel; b.siReadyAt = new Map(); b.customRetired = new Set(); b.rect = { ...document.stage.rect };
    b.grid = new Grid(document.stage, b.rect); b.data = ds; b.__uid = 0;b.opts={};b.routes=document.stage.routes || [];
    const player = { playerId: 0, id: 0, mirror: false, dpFloor: 0 };
    Object.defineProperty(player, 'dp', { get: () => b.w.players[0].cost, set: n => { b.w.players[0].cost = Number(n); } });
    Object.defineProperty(player,'units',{get:()=>b.allyUnits});
    b.players = [player]; b.getPlayer = id => id === 0 ? player : null;
    installEconomy(b,sim);
    b._safe = b.safe; b._ev=tuple=>feed.push(tuple);
    const after=b.after.bind(b);
    b.after=(seconds,fn,o={})=>{const timer=after(seconds,fn,o);timer.holdsBattle=!!o.holdsBattle;return timer;};
    b._handlerError=(label,unit,error)=>{throw Error(`${label} ${unit.name}: ${error.message}`);};
    b.spawnEnemy=(...args)=>api.spawnEnemy(...args);
    b._attackSeq=0;
    b._unblock=u=>{if(u.u)sim.blocking.release(u.u);};
    b._setHidden=(u,value)=>{if(u.u){u.u.hidden=!!value;if(value)sim.blocking.release(u.u);}};
    const emit=b.emit.bind(b);
    b.emit=(name,ctx)=>emit(name,name==='attack'?{...ctx,attacker:ctx.attacker?.u ?? ctx.attacker,targets:ctx.targets.map(u=>u.u ?? u)}:ctx);
    b._refreshRange=b.refreshRange.bind(b);
    const giveBuff=b.giveBuff.bind(b);
    b.giveBuff=(unit,spec)=>{
      const previous=spec.refresh==='keep'?unit.findBuff(spec.key):null;
      giveBuff(unit,spec);
      if(previous)return;
      const buff=unit.findBuff(spec.key)?.buff;
      if(!buff)return;
      if(Number.isFinite(spec.shield))sim.damage.setShield(unit.u,buff,spec.shield);
      if(Number.isFinite(spec.shieldHits))sim.damage.setShieldHits(unit.u,buff,spec.shieldHits);
    };
    if(!Object.getOwnPropertyDescriptor(runtime.wrappers.ShBuff.prototype,'shieldHits'))Object.defineProperty(runtime.wrappers.ShBuff.prototype,'shieldHits',{
      get(){return this.buff.shieldHits;},set(value){sim.damage.setShieldHits(this.holder,this.buff,value);},
    });
    b.fx = (kind,params={}) => {const {x=0,y=0,...extra}=params;feed.push(['fx',kind,x,y,extra]);};
    b.aliveEnemies=()=>b.enemies.filter(u=>u.alive);
    b.lowestHpAllyInRange=u=>b.injuredAlliesInKeys(u.rangeKeys,u)[0] ?? null;
    b.reduceElement=(u,amount,element=null)=>{
      if(!u?.alive || sim.elements.bursting(u.u) || !(amount>0))return 0;
      const maximum=sim.attrs.statsOf(u.u).maxEp;let restored=0;
      for(const key of element?[ELEMENT[element]]:Object.keys(u.u.ep))if(Object.hasOwn(u.u.ep,key)){
        const gain=Math.min(amount,maximum-u.u.ep[key]);u.u.ep[key]+=gain;restored+=gain;if(u.u.ep[key]>=maximum)delete u.u.ep[key];
      }
      return restored;
    };
    b.pushDistance=(u,force,{effect=false}={})=>u?.alive && !u.isBoss && !u.s.flags.noDisplace && !u.def?.staticBody?pushTiles(sim.displacement.forceLevel(u.u,force),effect):0;
    const applyStatus=b.applyStatus.bind(b);
    b.applyStatus=(u,key,o={})=>key==='reveal'?(b.addBuff(u,{key:'si:reveal',duration:o.duration,flags:{unstealth:true},source:o.source}),true):applyStatus(u,key,o);
    b.pull=(u,force,o={})=>u?.u && sim.displacement.pull(b.w,b.c,u.u,force,{to:o.to,by:o.center || o.to})?1:0;
    b.pullToFront=(enemy,u,force)=>{const [dr,dc]=u.fwd;return b.pull(enemy,force,{to:{x:u.x+dc*0.5,y:u.y+dr*0.5},center:u});};
    const heal=b.heal.bind(b);
    b.heal=(source,target,amount,o)=>{const actual=heal(source,target,amount,o);if(actual>=0.5)feed.push(['heal',target.id,Math.round(actual)]);return actual;};
    b.onOwnBoard = (_ps,r,c) => b.grid.inRect(r,c);
    b.mapTile = (ps,r,c) => [r,c];
    Object.defineProperty(b, '_occ', { get: () => {
      const out = []; for (const u of b.allyUnits) if (u.alive) out[u.tileR * COLS + u.tileC] = u; return out;
    } });
    const originalUnit = b.unitOf.bind(b);
    b.unitOf = raw => {
      const piece=raw.kind===sim.KIND.OPERATOR?b.pieces.get(`${raw.owner}|${raw.key}`):null;
      const u = enrich(piece || originalUnit(raw), meta.operators[raw.key]);
      if (raw.kind === sim.KIND.ENEMY) {
        const detail = meta.enemies[raw.key];
        if (detail) { u.defId = detail.raw.key; u.def = ds.getEnemy(u.defId); u.tag = detail.spawn.tag; u.mods = detail.spawn.mods; u.mem.siLocalEnemy=detail.local; }
      }
      return u;
    };
    for (const u of b.pieces.values()) enrich(u, meta.operators[u.defId]);
    b._setupUnit = (u,kit) => {
      if(!kit && u.kind==='token' && !u.ownerUnit?.nativeTokenDefs[u.defId]){
        kit=runtime.tokens.kits[u.defId]?.(u.def.skill?.bb || {},u.def.raw,u.def);
      }
      if (u.kit === kit && kit) return;
      if(u._siKitInstalled && !kit)return;
      u._siKitInstalled=true;
      u.kit = kit;
      u.profile=resolveProfile(u.def,kit?.trait);
      if (u.skill) u.skill.spec = kit?.skills?.[u.def.skill?.id] ?? kit?.skill ?? null;
      const flags={};
      if(u.def.untargetable)flags.untargetable=true;
      if(u.def.abnormal?.includes('healFree'))flags.noHeal=true;
      if(u.def.abnormal?.includes('isolated')){flags.isolated=true;flags.noHeal=true;}
      if(Object.keys(flags).length)b.addBuff(u,{key:'si:innate',flags,persist:true,allowDead:true});
      kit?.trait?.install?.(b,u); for (const t of kit?.talents || []) t.install?.(b,u); kit?.install?.(b,u);
    };
    b.kill = (u) => { if (u?.u) sim.damage.setHp(u.u, 0); };
    b._remove = (u, reason = 'retreat', killer = null, permanent = false) => {
      if (!u?.u) return;
      const raw = u.u, present = b.w.units.includes(raw);
      u.deathAt = b.time; u.respawnAt = b.time + u.base.respawnTime; u.removed = permanent;
      if (present) {
        manual.add(raw); sim.deck.leaveField(b.w,b.c,raw,false);
        b.w.units.splice(b.w.units.indexOf(raw),1); sim.blocking.releaseAll(b.w,raw.id);
        sim.bus.emit(b.w,'death',{unit:raw,reason,killer:killer?.u ?? null}); manual.delete(raw);
        feed.push(['die',u.id]);
      }
    };
    b.retreat = (u,o={}) => b._remove(u,o.reason || 'retreat',null,!!o.permanent);
    b.redeploy = (u,o={}) => { const tile=o.tile || [u.homeR,u.homeC]; return b._deploy(u,{tile}); };
    b._deploy = (u,o={}) => {
      const [r,c] = o.tile || [u.homeR,u.homeC];
      if (u.alive || !b.canDeployUnit(u,r,c) || b._occ[r*COLS+c]?.alive) return false;
      if(u.kind==='token' && !u._siKitInstalled)b._setupUnit(u);
      const raw = runtime.units.makeOperator(b.w,b.c,{key:u._aueKey,owner:0,row:r,col:c,dir:sim.DIR[u.dir],id:u.pieceId,paid:u.mem.deployCostPaid});
      const nativeToken=!!u.ownerUnit?.nativeTokenDefs[u.defId];
      if(nativeToken && u.ownerUnit.u){
        raw.summoner=u.ownerUnit.u.id;
        const life=b.c.operators[u._aueKey].summon?.life;
        if(life>0)raw.expires=b.w.frame+Math.round(life*30);
      }
      Object.assign(raw.base,u.baseChanges);
      u.u=raw;u.applyStoredRange();if(u.skill)u.skill._state=raw.skill; u.removed=false;u.aggroSeq=++b.__deploymentSeq; b.w.units.push(raw); b.w.players[0].deployed.push(raw.key);
      feed.push(['spawn',unitInfo(u)],['deploy',u.id]); known.add(raw.id);
      runtime.commands.arrive(b.w,b.c,raw);
      // Native bind does not apply piece buffs to raw summons. Local summons keep
      // their existing hand/kit lifecycle instead of entering native dismissal.
      if(nativeToken){u.deploySeq++;for(const spec of u.persist)b.giveBuff(u,spec);}
      return true;
    };
    b.canDeployUnit=(u,row,col)=>canDeployOn(b.grid,u.def,row,col) || runtime.commands.fits(b.c,b.c.operators[u._aueKey],row,col);
    b._makeAlly = (player,def,kind,row,col,input={}) => {
      const key=`si:token:${sim.reserveIds(b.w,1)}`;
      const native=nativeLoadout(def);
      b.c.operators[key]=native?.operator || input.ownerUnit?.nativeTokenDefs[def.id] || operatorDefinition(def,runtime);
      if(input.ownerUnit)b.c.operators[key]={...b.c.operators[key],summoner:input.ownerUnit._aueKey};
      if(kind==='token' && !input.ownerUnit?.nativeTokenDefs[def.id]){
        b.c.operators[key]={...b.c.operators[key],branch:'si:token'};
        b.c.behaviors.traits['si:token']=runtime.specs.KIT_TRAIT_BEHAVIOR;
      }
      const u=new runtime.wrappers.ShUnit(b,{kind,key,ownerId:0,def,ownerUnit:input.ownerUnit,pieceId:sim.reserveIds(b.w,1)});
      b.pieces.set(`0|${key}`,u);enrich(u,{chessId:def.id,uid:input.uid,saved:{row,col,dir:input.dir},native});
      if(def.skill && !native && !input.ownerUnit?.nativeTokenDefs[def.id])b.c.behaviors.skills[def.skill.id]=runtime.specs.SPEC_BEHAVIOR;
      return u;
    };
    b.tokenDef=(id,owner)=>ds.getToken(id,owner?.defId,owner?.def?.loadout);
    b.producesToken=BattleSummons.prototype.producesToken.bind(b);
    b.spawnToken=(owner,id,row,col,o={})=>{
      const holder=owner && typeof owner==='object'?owner:null;
      const original=o.def?normalizeToken(id,o.def):b.tokenDef(id,holder);
      if(!original)throw Error(`召唤物数据缺失：${id}`);
      if(!o.def && !o.anySource && holder?.def?.loadout?.skillIsDefault===false && !b.producesToken(holder,id,original))return null;
      if(!Number.isInteger(row) || !Number.isInteger(col) || !b.grid.inRect(row,col) || b._occ[row*COLS+col]?.alive)return null;
      const def={...original,stats:{...original.stats}};
      for(const [key,value] of Object.entries(o.stats || {}))if(Number.isFinite(value))def.stats[key]=value;
      const unit=b._makeAlly(holder?.player || b.getPlayer(owner),def,'token',row,col,{ownerUnit:holder,dir:normDir(o.dir ?? o.facing ?? holder?.dir ?? 'RIGHT')});
      b._setupUnit(unit,o.kit ?? null);
      if(o.untargetable)b.addBuff(unit,{key:'trait:untargetable',flags:{untargetable:true},persist:true,allowDead:true});
      if(!b._deploy(unit)){unit.removed=true;b.offOwner(unit);return null;}
      if(Number.isFinite(Number(o.hp)))unit.hp=Math.max(1,Math.min(unit.maxHp,Number(o.hp)));
      if(Number(o.duration)>0)b.after(Number(o.duration),()=>{if(unit.alive)b.retreat(unit,{reason:'expired',permanent:true});},{owner:unit});
      return unit;
    };
    sim.bus.on(b.w,'beforeAttack',({attacker}) => { b.unitOf(attacker).lastAttackAt=b.time; });
    b.on('skillStart',({unit})=>feed.push(['skill',unit.id,1]));
    b.on('skillEnd',({unit})=>feed.push(['skill',unit.id,0]));
    sim.bus.on(b.w,'burstStart',({target,element})=>b.fx('burst',{x:target.x,y:target.y,id:target.id,element:{SANITY:'neural',WATER:'erosion',FIRE:'burn',DARK:'apoptosis',ANGER:'angers'}[element]}));
    sim.bus.on(b.w,'damaged',ctx => {
      const source = ctx.credit || ctx.source;
      if (source && ctx.target.kind === sim.KIND.ENEMY) b.unitOf(source).stats.dmg += ctx.amount;
      feed.push(['dmg',ctx.target.id,Math.round(ctx.amount),ctx.type]);
    },{priority:Infinity});
    sim.bus.on(b.w,'death',ctx => {
      if (!manual.has(ctx.unit)) deathQueue.push(ctx);
      if (ctx.unit.kind === sim.KIND.ENEMY && ctx.reason !== 'goal') killed++;
    });
    b.__deploymentSeq=0;
    installDeploymentHand(b);
    installLocalEnemies(b);
    b.on('enemySpawn',({enemy})=>{
      const detail=meta.enemies[enemy.u.key],saved=detail?.spawn.runtime;
      if(detail?.raw.hitArea)enemy.u.hitArea=sim.body.normHitArea(detail.raw.hitArea);
      if(detail?.raw.staticBody)b.addBuff(enemy,{key:'si:staticBody',flags:{staticBody:true}});
      if(detail?.pinned)enemy.u.ab['@held']=b.w.frame;
      if(Number.isFinite(saved?.hp))enemy.hp=Math.max(1,Math.min(enemy.maxHp,saved.hp));
      if(Number.isFinite(saved?.atkCd))enemy.atkCd=saved.atkCd;
    });
  }
  const built = await createBattleContent(document,source,runtime,{...opts,attachBridge:attach});
  ds = built.ds;
  const gameData={...(getSimData() || {})};
  for(const layer of [source.fallback?.raw,source.raw,ds.raw])for(const [key,value] of Object.entries(layer || {})){
    if(value && typeof value==='object')gameData[key]={...gameData[key],...value};
  }
  setGameData(gameData);
  const world = sim.createWorld(built.content,{seed:20261021,players:1});
  if(bridge.errors.length)throw Error(bridge.errors.map(e=>`${e.label} ${e.who}: ${e.message}`).join('\n'));
  // Empty decks still need the SI bridge, which is invoked by kitsWorld's seen callback.
  bridge.data=ds;
  for (const u of bridge.pieces.values()) {
    const info=built.meta.operators[u._aueKey];
    if (info) bridge.hand.prepare(u);
  }
  const score=createDamageScore({now:()=>bridge.time,allies:()=>bridge.allyUnits,on:(...a)=>bridge.on(...a),off:h=>bridge.off(h)},document.session?.score);
  function sync() {
    for (const raw of world.units) {
      const u=bridge.unitOf(raw);
      spawnState.set(raw.id,raw);
      if (!known.has(u.id)) { known.add(u.id); feed.push(['spawn',unitInfo(u)]); }
    }
    for (const ctx of deathQueue.splice(0)) {
      const u=bridge.unitOf(ctx.unit);
      if (u.side==='ally') bridge._remove(u,ctx.reason || 'death',ctx.killer ? bridge.unitOf(ctx.killer):null,false);
      feed.push(['die',u.id]);
    }
    for (const event of world.events) {
      if(event.type==='goal') { leaked++; feed.push(['leak',event.id,spawnState.get(event.id)?.base.lifeCost ?? 1]); }
      if(event.type==='attack') {const u=bridge.unitById(event.id);feed.push(['atk',event.id,event.target,u?.profile.projectile || 'none']);}
      if(event.type==='heal')feed.push(['heal',event.target,Math.round(event.amount)]);
    }
  }
  const api={
    backend:'aue', world, content:built.content, meta:built.meta,
    get time(){return bridge.time;}, get finished(){return forced!=null || (opts.mode==='level' && (world.result===0 || (world.result===1 && !pending.length && !bridge.enemies.some(u=>u.alive) && !world.bus?.timers.some(t=>!t.cancelled && t.holdsBattle))));},
    get reason(){return forced || (world.result===1?'cleared':world.result===0?'forced':null);},
    start(){started=true;}, step(){
      if(api.finished)return;
      if(world.result===1)world.result=-1;
      while(pending.length && pending[0].time<=api.time){const s=pending.shift();runtime.spawner.spawnEnemy(world,built.content,s.action,world.frame,-1);}
      // Native movement has a 0.1 lower bound. Use its per-frame held-placement
      // marker for pinned sandbox units; they can still attack, block and slide.
      for(const u of world.units)if(built.meta.enemies[u.key]?.pinned)u.ab['@held']=world.frame;
      sim.step(world,built.content,[]);sync();
    },
    forceEnd(reason='forced'){forced=reason;},
    get allyUnits(){return bridge.allyUnits;},get enemies(){return bridge.enemies;},get units(){return world.units.map(u=>bridge.unitOf(u));},
    get players(){return bridge.players;},get hand(){return bridge.hand;}, get grid(){return bridge.grid;}, get rect(){return bridge.rect;},
    get flags(){return bridge.flags;},get data(){return ds;},get _occ(){return bridge._occ;},get siLevel(){return opts.mode==='level';},get projectiles(){return bridge.projectiles;},
    get killed(){return killed;},get leakedCount(){return leaked;},get total(){return additional+built.content.level.waves.flatMap(w=>w.fragments.flatMap(f=>f.actions)).reduce((n,a)=>n+a.count,0);},
    get siReadyAt(){return bridge.siReadyAt;}, sandboxScore:score, sandboxRestoreErrors:[],
    get life(){return Math.max(0,world.players[0].life);},get __uid(){return bridge.__uid;},set __uid(value){bridge.__uid=value;},get _pending(){return pending;},
    on:(...a)=>bridge.on(...a),off:h=>bridge.off(h),canSpendDp:(...a)=>bridge.canSpendDp(...a),retreat:(...a)=>bridge.retreat(...a),kill:(...a)=>bridge.kill(...a),fx:(...a)=>bridge.fx(...a),
    _deploy:(...a)=>bridge._deploy(...a),enemiesInKeys:(...a)=>bridge.enemiesInKeys(...a),
    _createAllyFromInput(player,input){
      const def=ds.getChess(input.chessId,{skillIndex:input.skillIndex,moduleId:input.moduleId});
      const factory=built.meta.factories.get(input.chessId);
      if(!def || (!factory && !def.raw.aueNative))throw Error(`干员未预载：${input.chessId}`);
      const u=bridge._makeAlly(player,def,'op',input.row,input.col,{uid:input.uid,dir:input.dir});
      built.content.decks[0].push(u._aueKey);
      if(def.raw.aueNative){bridge.hand.prepare(u);return u;}
      if(def.subProf)built.content.behaviors.traits[def.subProf]=runtime.specs.KIT_TRAIT_BEHAVIOR;
      const kit=selectKit(factory({...def.skill?.bb,sandbox:opts.mode!=='level'},def.raw,def),def);
      bridge.hand.prepare(u);bridge._setupUnit(u,kit);return u;
    },
    spawnEnemy(key,input={}){
      const action=registerSpawn(built.content,built.meta,ds,runtime,{...input,enemyKey:key});additional++;
      const raw=runtime.spawner.spawnEnemy(world,built.content,action,world.frame,-1);sync();return bridge.unitOf(raw);
    },
    _queueSpawn(input){
      const action=registerSpawn(built.content,built.meta,ds,runtime,input);
      for(let i=0;i<action.count;i++)pending.push({action,time:(input.time || 0)+i*action.interval,seq:additional++});
      pending.sort((a,b)=>a.time-b.time || a.seq-b.seq);return pending.at(-1);
    },
    snapshot(){const units=api.units.filter(u=>!u.hidden);return appendReadouts({fieldId:'sandbox',t:api.time,units:units.map(u=>unitTuple(u,api.time)),dp:Math.floor(bridge.players[0].dp),killed,total:api.total,resolved:killed+leaked},units);},
    drainEvents(){return feed.splice(0);},
    fieldMeta(){return {fieldId:'sandbox',kind:'normal',rect:bridge.rect,stageId:document.stage.id,units:api.units.map(unitInfo),players:[{playerId:0,side:'L',mirror:false}],flags:bridge.flags};},
    close(){score.stop();feed.length=0;},
  };
  function restore(u,saved){if(Number.isFinite(saved.runtime?.hp))u.hp=Math.max(1,Math.min(u.maxHp,saved.runtime.hp));if(Number.isFinite(saved.runtime?.sp))u.skill?.setSpTotal(saved.runtime.sp);if(Number.isFinite(saved.runtime?.atkCd))u.atkCd=saved.runtime.atkCd;}
  for(const u of bridge.allyUnits){const saved=built.meta.operators[u._aueKey]?.saved;if(saved && !saved.detached){u.homeR=saved.row;u.homeC=saved.col;if(!bridge._deploy(u))throw Error(`无法恢复干员 ${u.name}`);restore(u,saved);}}
  for(const saved of (document.operators || []).filter(o=>o.tokenId)){
    const record=[...bridge.hand.records.values()].find(r=>r.tokenId===saved.tokenId && r.owner.uid===saved.ownerUid);
    const u=record?.units.find(u=>!u.alive);
    if(!u)throw Error(`无法恢复召唤物：${saved.tokenId}，持有者 ${saved.ownerUid}`);
    u.uid=saved.uid;u.homeR=saved.row;u.homeC=saved.col;u.dir=saved.dir;
    if(!bridge._deploy(u))throw Error(`无法恢复召唤物位置：${saved.tokenId}`);restore(u,saved);
  }
  bridge.__uid=Math.max(0,...bridge.allyUnits.map(u=>u.uid || 0));
  if(document.session){bridge.players[0].dp=Math.max(bridge.players[0].dpFloor,Math.min(99,document.session.dp ?? bridge.players[0].dp));}
  api.start(); return api;
}
