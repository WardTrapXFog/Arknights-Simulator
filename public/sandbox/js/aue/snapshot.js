import { ammoView, wolfView, negView, coinView, mysticView, chargeView } from '/sim/snapshot.js';
import { ELEMENT } from '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/packages/content/src/compat/mods.js';

/** Restore the optional renderer readouts without advancing battle state. */
export function appendReadouts(snap, units) {
  const views={ammo:ammoView,wolves:wolfView,neg:negView,coins:coinView,energy:mysticView,charges:chargeView};
  const put=(key,u,value)=>{if(value!=null)(snap[key] ||= []).push([u.id,...(Array.isArray(value)?value:[value])]);};
  for(const u of units){
    if(!u.alive || !u.deployed || u.hidden)continue;
    for(const [key,view] of Object.entries(views))put(key,u,view(u));
    const layers=u.u.buffs.reduce((sum,b)=>sum+Math.max(0,b.shieldHits || 0),0);
    if(layers>=1)put('layers',u,Math.min(999,Math.floor(layers)));
    const burst=u.u.buffs.find(b=>b.key.startsWith('burst:'));
    if(burst){
      const name=Object.keys(ELEMENT).find(name=>ELEMENT[name]===burst.key.slice(6));
      if(name)put('elem',u,[name,1,snap.t+Math.max(0,burst.left)/30,Math.max(0,burst.value)/30]);
    }else{
      let name=null,damage=0;
      for(const [key,value] of Object.entries(u.elem || {}))if(value>damage){name=key;damage=value;}
      if(name)put('elem',u,[name,Math.max(.01,Math.min(.99,Math.floor(damage/(u.s.maxEp || 1000)*100+1e-9)/100)),0,0]);
    }
  }
  return snap;
}
