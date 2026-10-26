import { TAU, fade, direction, makePaint, stroke, fill, arc, worldStroke, groundRing, star, crescent, crown, cue, live, feet } from './combat-shapes.js';

const GOLD = 0xf3c675, WHITE = 0xfff6dc, BLUE = 0x8fb9ff;
const own = (v) => v?.info?.spine === 'char_9901_vina';

class FxVina {
  setVinaScene(scene) { this.vinaScene = scene; }
  vinaCue(kind, at, ex) {
    cue(this.vinaHits, { kind, x: at.x, y: at.y, owner: at.v, ...ex,
      dur: kind === 'royal' ? .85 : kind === 'tremble' ? Math.max(.1, Number(ex.dur) || 1) : .45 }, this.quality === 'low' ? 36 : 72);
  }
}

function drawRoyal(fx, paint, hit) {
  const [dx, dy] = direction(hit.dir), nx = -dy, ny = dx;
  const length = hit.length, z = fx._groundZ(hit.x, hit.y) + .12;
  const a = fade(hit.t, hit.dur), glow = a * a;
  const point = (forward, side) => [hit.x + dx * forward + nx * side, hit.y + dy * forward + ny * side];
  const cam = fx.ctx.cam();
  const polygon = [point(-.45, -1.5), point(length, -1.5), point(length, 1.5), point(-.45, 1.5)]
    .map(([x,y]) => { const p = cam.project(x,y,z); return [p.x,p.y]; });
  fill(paint.ground, polygon, GOLD, glow * .13);
  for (const side of [-1.5, 0, 1.5]) {
    worldStroke(fx, paint.ink, [point(-.35,side),point(length,side)], z, GOLD, 8 * glow + 1, glow * .35);
    worldStroke(fx, paint.ink, [point(-.35,side),point(length,side)], z, WHITE, 2, a);
  }
  // All of the lane lights at the actual instantaneous strike; the tail only dissipates.
  const n = Math.min(20, Math.ceil(length));
  for (let i = 0; i < n; i++) {
    const q = point((i + .5) * length / n, Math.sin(i * 2.4) * .8);
    const p = cam.project(q[0], q[1], z);
    star(paint.ink, p.x, p.y, p.s * .16 * a, WHITE, a, i);
  }
}

function drawHit(fx, paint, hit) {
  if (hit.kind === 'royal') { drawRoyal(fx, paint, hit); return; }
  const v = fx._viewOf(hit.id), src = fx._viewOf(hit.src);
  if (hit.kind === 'tremble' && !live(v)) return;
  const p = v ? feet(fx, v, .25) : fx.ctx.cam().project(hit.x, hit.y, fx._groundZ(hit.x, hit.y) + .25);
  const alpha = fade(hit.t, hit.dur), size = p.s;
  if (hit.kind === 'tremble') {
    crown(paint.ink, p.x, p.y - size * .65, size * .36, GOLD, alpha * .8);
    stroke(paint.ink, [[p.x-size*.12,p.y-size*.72],[p.x+size*.02,p.y-size*.61],[p.x-size*.04,p.y-size*.53]], WHITE, 1, alpha);
    return;
  }
  if (hit.kind === 'stance') {
    groundRing(fx, paint.ground, hit.x, hit.y, .4 + (1-alpha)*1.3, GOLD, alpha);
    crown(paint.ink,p.x,p.y-size*.8,size*.7,WHITE,alpha);
    return;
  }
  const sp = src ? feet(fx, src, .25) : p;
  const angle = src ? Math.atan2(p.y-sp.y,p.x-sp.x) : -.5;
  const strong = hit.kind === 'cleave' || hit.style === 's1' || hit.style === 's3';
  const radius = size * (strong ? .85 : .42) * (1 + (1-alpha)*.22);
  crescent(paint.ink,p.x,p.y-size*.25,radius,hit.style === 'arts' ? BLUE : GOLD,alpha,angle,.23);
  crescent(paint.ink,p.x,p.y-size*.25,radius*.96,WHITE,alpha*.9,angle,.045);
  if (strong) {
    crescent(paint.ink,p.x,p.y-size*.25,radius*.75,BLUE,alpha*.55,angle+Math.PI,.1);
    star(paint.ink,p.x,p.y-size*.24,size*.3*alpha,WHITE,alpha,.7);
  }
}

export const vinaEffects = {
  methods: FxVina,
  kinds: Object.fromEntries(['vinaStrike','vinaCleave','vinaRoyalBlade','vinaTremble','vinaStance'].map(k => [k, { a: 'custom', c: GOLD }])),
  init(fx) {
    fx.vinaScene = { actors: [], guards: [] }; fx.vinaHits = []; fx.vinaPaint = null; fx.vinaTime = 0;
    const shared = fx.skill;
    fx.skill = function(v,on) { if (own(v)) { this._aura(v,false); return; } return shared.call(this,v,on); };
  },
  update(fx, dt) {
    const scene = fx.vinaScene;
    if (!scene.actors.length && !scene.guards.length && !fx.vinaHits.length) {
      fx.vinaPaint?.ground.clear(); fx.vinaPaint?.ink.clear(); return;
    }
    const paint = fx.vinaPaint ||= makePaint(fx);
    paint.ground.clear(); paint.ink.clear(); fx.vinaTime += dt;
    for (const { view: v, active, glory, aura } of scene.actors) {
      if (!live(v)) continue;
      const p = feet(fx,v), phase = fx.vinaTime * .7;
      crown(paint.ink,p.x,p.y-p.s*.95,p.s*(glory ? .42 : .28),GOLD,glory ? .85 : .4);
      if (aura || active) {
        const r = 1.48, z = fx._groundZ(v.x,v.y)+.025;
        worldStroke(fx,paint.ground,[[v.x-r,v.y-r],[v.x+r,v.y-r],[v.x+r,v.y+r],[v.x-r,v.y+r]],z,GOLD,1,active ? .22 : .12,true);
        groundRing(fx,paint.ground,v.x,v.y,.55,GOLD,.18,phase);
      }
      if (active) {
        arc(paint.ink,p.x,p.y-p.s*.4,p.s*.57,p.s*.7,-2.6,-.6,GOLD,2,.65);
        for (let i=0;i<3;i++) star(paint.ink,p.x+Math.cos(phase+i*TAU/3)*p.s*.55,p.y-p.s*(.65+.15*Math.sin(phase+i)),p.s*.06,WHITE,.7);
      }
    }
    for (const v of scene.guards) {
      if (!live(v)) continue;
      const p=feet(fx,v);
      arc(paint.ink,p.x,p.y-p.s*.3,p.s*.38,p.s*.55,-Math.PI*.9,-Math.PI*.1,BLUE,1.3,.4);
      star(paint.ink,p.x,p.y-p.s*.82,p.s*.08,GOLD,.7);
    }
    let write=0;
    for (const hit of fx.vinaHits) {
      hit.t += dt;
      if (hit.t >= hit.dur) continue;
      drawHit(fx,paint,hit); fx.vinaHits[write++]=hit;
    }
    fx.vinaHits.length=write;
  },
  clear(fx) {
    fx.vinaPaint?.ground.destroy(); fx.vinaPaint?.ink.destroy(); fx.vinaPaint=null;
    fx.vinaScene={actors:[],guards:[]}; fx.vinaHits.length=0; fx.vinaTime=0;
  },
  handlers: {
    vinaStrike: (fx,{at,ex}) => fx.vinaCue('strike',at,ex),
    vinaCleave: (fx,{at,ex}) => fx.vinaCue('cleave',at,ex),
    vinaRoyalBlade: (fx,{at,ex}) => fx.vinaCue('royal',at,ex),
    vinaTremble: (fx,{at,ex}) => fx.vinaCue('tremble',at,ex),
    vinaStance: (fx,{at,ex}) => fx.vinaCue('stance',at,ex),
  },
};
