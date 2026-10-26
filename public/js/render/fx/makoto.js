import { GEO } from '../../../../shared/constants.js';
import { TAU, fade, makePaint, stroke, fill, arc, worldStroke, groundRing, star, crescent, cue, live, feet } from './combat-shapes.js';

const COLORS = [0x7abfff, 0xe67294, 0xffebc1];
const WHITE = 0xf0faff, BLUE = 0x6cafff, DARK = 0x372947;
const own = (v) => v?.info?.spine === 'char_9902_custommakoto';

function seal(g,p,color,size=1,phase=0,alpha=1) {
  const r=p.s*.29*size, y=p.y-p.s*.48;
  arc(g,p.x,y,r,r,0,TAU,color,1.5,alpha);
  for(let i=0;i<3;i++) {
    const a=phase+i*TAU/3, x=p.x+Math.cos(a)*r, yy=y+Math.sin(a)*r;
    star(g,x,yy,r*.3,color,alpha,a);
  }
  star(g,p.x,y,r*.66,WHITE,alpha*.8,Math.PI/2);
}

function rangeEdge(fx,g,keys,color,alpha) {
  const set=new Set(keys), cols=GEO.COLS;
  for(const key of keys) {
    const y=Math.floor(key/cols), x=key%cols, z=fx._groundZ(x,y)+.035;
    const sides=[[-1,0,[[x-.5,y-.5],[x-.5,y+.5]]],[1,0,[[x+.5,y-.5],[x+.5,y+.5]]],
      [0,-1,[[x-.5,y-.5],[x+.5,y-.5]]],[0,1,[[x-.5,y+.5],[x+.5,y+.5]]]];
    for(const [dx,dy,points] of sides) if(!set.has((y+dy)*cols+x+dx)) worldStroke(fx,g,points,z,color,1.3,alpha);
  }
}

class FxMakoto {
  setMakotoScene(scene) { this.makotoScene=scene; }
  makotoCue(kind,at,ex) {
    if(kind==='hit' && ex.style==='echo') {
      const held=this.makotoHits.find(h=>h.kind==='hit' && h.style==='echo' && h.id===ex.id && h.src===ex.src && h.t===0);
      if(held) { held.count=Math.min(3,held.count+1); return; }
    }
    cue(this.makotoHits,{kind,x:at.x,y:at.y,...ex,t:0,count:1,
      dur:kind==='release' ? .65 : kind==='summon'||kind==='equipment' ? .8 : ex.style==='detonate' ? .7 : .4},this.quality==='low'?40:96);
  }
}

function drawHit(fx,paint,h) {
  const v=fx._viewOf(h.id), p=v?feet(fx,v,.12):fx.ctx.cam().project(h.x,h.y,fx._groundZ(h.x,h.y)+.12);
  const a=fade(h.t,h.dur), color=COLORS[h.persona] || BLUE, s=p.s;
  if(h.kind==='summon'||h.kind==='release'||h.kind==='equipment') {
    const r=h.kind==='release'?a*1.25:.25+(1-a)*(h.persona===2?2.2:1.2);
    groundRing(fx,paint.ground,h.x,h.y,r,color,a);
    for(let i=0;i<8;i++) {
      const angle=i*TAU/8, x=p.x+Math.cos(angle)*s*(.2+(1-a)*.8), y=p.y-s*.5+Math.sin(angle)*s*.5;
      fill(paint.ink,[[x,y-s*.12*a],[x+s*.055*a,y],[x,y+s*.12*a],[x-s*.055*a,y]],color,a);
    }
    if(h.persona===2) {
      const w=s*(.08+.3*(1-a));
      fill(paint.ink,[[p.x-w,p.y],[p.x+w,p.y],[p.x+w*.2,p.y-s*2.7],[p.x-w*.2,p.y-s*2.7]],WHITE,a*.3);
      star(paint.ink,p.x,p.y-s*.8,s*.7*a,WHITE,a);
    }
    return;
  }
  const y=p.y-s*.4;
  if(h.style==='detonate') {
    const w=s*(.12+.5*(1-a));
    fill(paint.ink,[[p.x-w,p.y],[p.x+w,p.y],[p.x+w*.25,p.y-s*1.7],[p.x-w*.25,p.y-s*1.7]],DARK,a*.85);
    stroke(paint.ink,[[p.x,p.y+s*.1],[p.x,p.y-s*1.75]],0xff9ab7,Math.max(1,s*.06*a),a);
    seal(paint.ink,p,0xf598b7,1.2+(1-a),h.t*3,a);
  } else if(h.style==='echo') {
    for(let i=0;i<h.count;i++) {
      const angle=(i-1)*.5;
      star(paint.ink,p.x+(i-1)*s*.16,y,s*(.42-i*.06)*a,WHITE,a,angle);
    }
    arc(paint.ink,p.x,y,s*.5*(1+(1-a)),s*.5*(1+(1-a)),0,TAU,COLORS[2],1,a*.7);
  } else if(h.style==='true') {
    star(paint.ink,p.x,y,s*.24*a,WHITE,a,.7);
  } else {
    const r=s*(h.style==='equipment' ? .78 : .46)*(1+(1-a)*.2);
    crescent(paint.ink,p.x,y,r,color,a,-.7,.22);
    if(h.style==='split'||h.persona===0) crescent(paint.ink,p.x,y,r*.87,0xc7a6fa,a*.8,Math.PI-.7,.16);
    star(paint.ink,p.x,y,s*.15*a,WHITE,a);
  }
}

function messiah(fx,paint,actor,desired) {
  const v=actor.view, p=feet(fx,v), id=v.id;
  desired.add(id);
  let rec=fx.makotoFigures.get(id);
  if(!rec) {
    const texture=fx.P.Texture.from('/assets/custom/char_9902_custommakoto/messiah.svg');
    const sp=new fx.P.Sprite(texture);
    sp.anchor.set(.5,.95); fx.ctx.layers.fxNormal.addChild(sp);
    rec={sp,out:0,p:null}; fx.makotoFigures.set(id,rec);
  }
  rec.out=0; rec.p={x:p.x,y:p.y,s:p.s};
  const sp=rec.sp, pulse=Math.sin(fx.makotoTime*1.6);
  sp.position.set(p.x,p.y-p.s*(.38+.025*pulse));
  const h=p.s*(2.4+.025*pulse);
  sp.width=h*.8; sp.height=h; sp.alpha=.8;
  sp.visible=!!sp.texture.baseTexture.valid;
  if(!sp.visible) {
    // The same white-gold silhouette remains visible while the SVG texture is loading.
    stroke(paint.ink,[[p.x,p.y-p.s*.5],[p.x,p.y-p.s*1.9]],WHITE,p.s*.16,.8);
    for(const sign of [-1,1]) for(let i=0;i<3;i++) stroke(paint.ink,[[p.x,p.y-p.s*(1.6-i*.15)],[p.x+sign*p.s*(.8-i*.12),p.y-p.s*(2.1-i*.5)]],COLORS[2],p.s*.08,.55);
  }
  arc(paint.ink,p.x,p.y-p.s*2.1,p.s*.48,p.s*.48,0,TAU,COLORS[2],1.5,.45);
  rangeEdge(fx,paint.ground,actor.range,COLORS[2],.14+.025*pulse);
  groundRing(fx,paint.ground,v.x,v.y,.72,WHITE,.55,fx.makotoTime*.1);
}

export const makotoEffects = {
  methods: FxMakoto,
  kinds: Object.fromEntries(['makotoSummon','makotoRelease','makotoHit','makotoEquipment'].map(k=>[k,{a:'custom',c:BLUE}])),
  init(fx) {
    fx.makotoScene={actors:[],records:[],seals:[],protected:[],paralysis:[]};
    fx.makotoHits=[]; fx.makotoFigures=new Map(); fx.makotoPaint=null; fx.makotoTime=0;
    const shared=fx.skill;
    fx.skill=function(v,on) { if(own(v)) { this._aura(v,false); return; } return shared.call(this,v,on); };
  },
  update(fx,dt) {
    const scene=fx.makotoScene;
    if(!scene.actors.length && !scene.records.length && !scene.seals.length && !scene.paralysis.length
      && !scene.protected.length && !fx.makotoHits.length && !fx.makotoFigures.size) {
      fx.makotoPaint?.ground.clear(); fx.makotoPaint?.ink.clear(); return;
    }
    const paint=fx.makotoPaint ||= makePaint(fx);
    paint.ground.clear(); paint.ink.clear(); fx.makotoTime+=dt;
    const desired=new Set(), cap=fx.quality==='low'?48:128;
    for(const actor of scene.actors.slice(0,16)) {
      const {view:v,persona,active}=actor;
      if(!live(v)) continue;
      const p=feet(fx,v), color=COLORS[persona], phase=fx.makotoTime*.6;
      groundRing(fx,paint.ground,v.x,v.y,active ? .65 : .4,color,active ? .65 : .3);
      for(let i=0;i<3;i++) {
        const x=p.x+(i-1)*p.s*.16;
        fill(paint.ink,[[x,p.y+p.s*.09],[x+p.s*.04,p.y+p.s*.14],[x,p.y+p.s*.19],[x-p.s*.04,p.y+p.s*.14]],COLORS[i],i===persona ? .85 : .16);
      }
      if(!active) continue;
      if(persona===2) { messiah(fx,paint,actor,desired); continue; }
      arc(paint.ink,p.x,p.y-p.s*.4,p.s*.65,p.s*.65,phase,phase+Math.PI*1.4,color,1.5,.5);
      if(persona===0) {
        for(let i=0;i<3;i++) {
          const a=phase+i*TAU/3, x=p.x+Math.cos(a)*p.s*.55, y=p.y-p.s*.7+Math.sin(a)*p.s*.25;
          stroke(paint.ink,[[x,y],[x,y-p.s*.15],[x+p.s*.07,y-p.s*.1]],BLUE,1.5,.75);
        }
      } else {
        for(let i=0;i<8;i++) {
          const a=phase+i*TAU/8,x=p.x+Math.cos(a)*p.s*.67,y=p.y-p.s*.45+Math.sin(a)*p.s*.55;
          stroke(paint.ink,[[x-p.s*.04,y],[x,y-p.s*.06],[x+p.s*.04,y],[x,y+p.s*.06]],color,1,.6,true);
        }
      }
    }
    for(const {view:v,amount} of scene.records.slice(0,cap)) {
      if(!live(v)) continue;
      const p=feet(fx,v), charge=Math.min(1,Math.log10(1+amount)/6);
      seal(paint.ink,p,0xda779a,.75+charge*.35,fx.makotoTime*.7,.45+charge*.4);
    }
    for(const v of scene.seals.slice(0,cap)) if(live(v)) seal(paint.ink,feet(fx,v),COLORS[2],1,fx.makotoTime*.25,.65);
    for(const v of scene.paralysis.slice(0,cap)) if(live(v)) {
      const p=feet(fx,v);
      stroke(paint.ink,[[p.x-p.s*.2,p.y-p.s*.9],[p.x+p.s*.05,p.y-p.s*.6],[p.x-p.s*.05,p.y-p.s*.4],[p.x+p.s*.2,p.y-p.s*.1]],0xe4a4ec,1.7,.75);
    }
    for(const v of scene.protected.slice(0,cap)) if(live(v)) {
      const p=feet(fx,v);
      arc(paint.ink,p.x,p.y-p.s*.4,p.s*.4,p.s*.6,-Math.PI,0,COLORS[2],1.5,.6);
      star(paint.ink,p.x,p.y-p.s*.95,p.s*.13,WHITE,.8);
    }
    for(const [id,rec] of fx.makotoFigures) if(!desired.has(id)) {
      rec.out+=dt;
      rec.sp.alpha=Math.max(0,.8*(1-rec.out/.45));
      if(rec.out>=.45) { rec.sp.destroy(); fx.makotoFigures.delete(id); }
    }
    let write=0;
    for(const hit of fx.makotoHits) {
      hit.t+=dt; if(hit.t>=hit.dur) continue;
      drawHit(fx,paint,hit); fx.makotoHits[write++]=hit;
    }
    fx.makotoHits.length=write;
  },
  clear(fx) {
    fx.makotoPaint?.ground.destroy(); fx.makotoPaint?.ink.destroy(); fx.makotoPaint=null;
    for(const rec of fx.makotoFigures.values()) rec.sp.destroy();
    fx.makotoFigures.clear(); fx.makotoHits.length=0; fx.makotoTime=0;
    fx.makotoScene={actors:[],records:[],seals:[],protected:[],paralysis:[]};
  },
  handlers: {
    makotoSummon:(fx,{at,ex})=>fx.makotoCue('summon',at,ex),
    makotoRelease:(fx,{at,ex})=>fx.makotoCue('release',at,ex),
    makotoHit:(fx,{at,ex})=>fx.makotoCue('hit',at,ex),
    makotoEquipment:(fx,{at,ex})=>fx.makotoCue('equipment',at,ex),
  },
};
