import { fade, makePaint, stroke, fill, worldStroke, groundRing, cue } from './combat-shapes.js';
import { UnitView } from '../units.js';

const GOLD = 0xe7c47d, WHITE = 0xfff8dd, COLS = 21;
const STONE = 'token_10064_wang_stone1';

class FxWang {
  setWangScene(scene) { this.wangScene = scene; }
  wangCue(kind, at, extra) {
    cue(this.wangHits, { kind, x: at.x, y: at.y, ...extra, dur: kind === 'land' ? .5 : .62 }, 120);
  }
}

function updateStoneModels(fx, scene, dt) {
  const live = new Set(), cam = fx.ctx.cam();
  for (const actor of scene.actors) for (const n of actor.nodes) {
    if (!n.follower) continue;
    const key = `${actor.view.id}:${n.seq}`;
    live.add(key);
    let model = fx.wangModels.get(key);
    if (!model) {
      // A render-only view: the follower stays a node in Wang's kit, never a battle unit or deployment.
      model = new UnitView(actor.view.ctx, { id: `wang-follower:${key}`, defId: STONE, spine: STONE,
        kind: 'token', side: 'ally', x: n.c, y: n.r, maxHp: 1 });
      model.hasDir = false;
      model._showFacing = false;
      model.z = model.zTarget = fx._groundZ(n.c, n.r);
      model.onDeploy();
      fx.wangModels.set(key, model);
    }
    model.lift = Math.max(0, 1 - (scene.time - n.born) / .18) * .9;
    model.update(dt, cam, fx.time);
    model.hud.visible = false;
  }
  for (const [key, model] of fx.wangModels) if (!live.has(key)) {
    model.destroy();
    fx.wangModels.delete(key);
  }
}

function range(fx, paint, keys, alpha) {
  if (!keys?.length) return;
  const set = new Set(keys);
  for (const key of keys) {
    const x = key % COLS, y = Math.floor(key / COLS), z = fx._groundZ(x, y) + .035;
    for (const [dx, dy, a, b] of [
      [0, 1, [-.5,.5], [.5,.5]], [1, 0, [.5,.5], [.5,-.5]],
      [0, -1, [.5,-.5], [-.5,-.5]], [-1, 0, [-.5,-.5], [-.5,.5]],
    ]) {
      if (x + dx >= 0 && x + dx < COLS && set.has(key + dx + dy * COLS)) continue;
      worldStroke(fx, paint.ground, [[x+a[0],y+a[1]],[x+b[0],y+b[1]]], z, GOLD, 1.4, alpha);
    }
  }
}

function drawCue(fx, paint, hit) {
  const a = fade(hit.t, hit.dur), z = fx._groundZ(hit.x, hit.y) + .035;
  if (hit.kind === 'land') {
    groundRing(fx, paint.ground, hit.x, hit.y, .2 + (1-a)*.36, GOLD, a * .8);
    const cam = fx.ctx.cam(), p = cam.project(hit.x, hit.y, z), q = cam.project(hit.x, hit.y, z + a * .65);
    stroke(paint.ink, [[p.x,p.y],[q.x,q.y]], WHITE, 2, a * .65);
    return;
  }
  // Tiles come from the damaging node itself, including S2's activated axes and S3's cross.
  for (const [x,y] of hit.tiles || []) {
    const zz = fx._groundZ(x,y) + .04;
    const cam = fx.ctx.cam();
    fill(paint.ground, [[-.43,-.43],[.43,-.43],[.43,.43],[-.43,.43]]
      .map(([dx,dy]) => { const p=cam.project(x+dx,y+dy,zz); return [p.x,p.y]; }), GOLD, a*a*.22);
    if (x !== hit.x || y !== hit.y) worldStroke(fx,paint.ground,[[hit.x,hit.y],[x,y]],zz,WHITE,2,a*.6);
  }
  groundRing(fx,paint.ground,hit.x,hit.y,.15+(1-a)*.75,GOLD,a);
  const cam=fx.ctx.cam(), p=cam.project(hit.x,hit.y,z), q=cam.project(hit.x,hit.y,z+.8*a);
  stroke(paint.ink,[[p.x,p.y],[q.x,q.y]],GOLD,8*a,a*.5);
  stroke(paint.ink,[[p.x,p.y],[q.x,q.y]],WHITE,2,a);
}

export const wangEffects = {
  methods: FxWang,
  kinds: { wangStoneLand: { a:'custom', c:GOLD, pt:true }, wangStoneBurst: { a:'custom', c:GOLD, pt:true } },
  init(fx) { fx.wangScene={actors:[],time:0}; fx.wangHits=[]; fx.wangPaint=null; fx.wangModels=new Map(); },
  update(fx,dt) {
    const scene=fx.wangScene;
    updateStoneModels(fx,scene,dt);
    if (!scene.actors.length && !fx.wangHits.length) {
      fx.wangPaint?.ground.clear(); fx.wangPaint?.ink.clear(); return;
    }
    const paint=fx.wangPaint ||= makePaint(fx);
    paint.ground.clear(); paint.ink.clear();
    const active=scene.actors.filter((a)=>a.range?.length).length;
    for (const actor of scene.actors) {
      range(fx,paint,actor.range,.32/Math.sqrt(Math.max(1,active)));
      const occupied=new Map(actor.nodes.map((n)=>[`${n.c},${n.r}`,n]));
      for (const n of actor.nodes) {
        if (!n.act) continue;
        groundRing(fx,paint.ground,n.c,n.r,.28,GOLD,.65);
        for (const [dx,dy] of [[1,0],[0,1]]) {
          if (!occupied.has(`${n.c+dx},${n.r+dy}`)) continue;
          worldStroke(fx,paint.ground,[[n.c,n.r],[n.c+dx,n.r+dy]],fx._groundZ(n.c,n.r)+.035,GOLD,1.5,.55);
        }
      }
    }
    let write=0;
    for (const hit of fx.wangHits) {
      hit.t+=dt;
      if (hit.t>=hit.dur) continue;
      drawCue(fx,paint,hit); fx.wangHits[write++]=hit;
    }
    fx.wangHits.length=write;
  },
  clear(fx) {
    for (const model of fx.wangModels.values()) model.destroy();
    fx.wangModels.clear();
    fx.wangPaint?.ground.destroy(); fx.wangPaint?.ink.destroy();
    fx.wangPaint=null; fx.wangScene={actors:[],time:0}; fx.wangHits.length=0;
  },
  handlers: {
    wangStoneLand:(fx,{at,ex})=>fx.wangCue('land',at,ex),
    wangStoneBurst:(fx,{at,ex})=>fx.wangCue('burst',at,ex),
  },
};
