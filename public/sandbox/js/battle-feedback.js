import { COLS } from './battlefield.js';
import { absoluteRangeKeys } from '/sim/targeting.js';

// Presentation only: the battle owns DP, projectile collisions and all skill state.
export function createBattleFeedback({ view, battle, canvas }) {
  const layer = document.createElement('canvas');
  layer.className = 'battle-feedback';
  canvas.parentElement.append(layer);
  const ctx = layer.getContext('2d');
  const gains = [], shots = [], edges = new Map(), pulses = new Map();
  const drawnEdges = new Set();
  let rangeOpacity = 1;
  let lastPaint = -Infinity;
  const point = (x, y, z = .08) => {
    const p = view.debug.cam.project(x, y, z), box = canvas.getBoundingClientRect();
    return { x: p.x + box.left, y: p.y + box.top };
  };
  function ingest(events) {
    const now = performance.now();
    for (const [id, until] of pulses) if (until <= battle.time) pulses.delete(id);
    for (const e of events) {
      if (e[0] === 'skill' && e[2]) pulses.set(e[1], battle.time + .65);
      if (e[0] !== 'fx') continue;
      if (e[1] === 'dpGain') gains.push({ x: e[2], y: e[3], n: e[4].n, born: now });
      if (e[1] === 'danzen') shots.push({ x: e[2], y: e[3], ...e[4], born: battle.time });
    }
  }
  function boundary(keys) {
    const signature = keys.join(',');
    let result = edges.get(signature);
    if (result) return result;
    const set = new Set(keys);
    result = [];
    for (const k of keys) {
      const r = Math.floor(k / COLS), c = k % COLS;
      // tileScreen corners: top-left, top-right, bottom-right, bottom-left.
      if (!set.has(k + COLS)) result.push([r, c, 0, 1]);
      if (c === COLS - 1 || !set.has(k + 1)) result.push([r, c, 1, 2]);
      if (!set.has(k - COLS)) result.push([r, c, 2, 3]);
      if (c === 0 || !set.has(k - 1)) result.push([r, c, 3, 0]);
    }
    if (edges.size > 128) edges.clear();
    edges.set(signature, result);
    return result;
  }
  function glow(keys, color, now) {
    if (!keys?.length) return;
    ctx.beginPath();
    for (const [r, c, a, b] of boundary(keys)) {
      const p = view.tileScreen(r, c)?.poly;
      if (!p) continue;
      const endpoints = [p[a], p[b]].map(([x, y]) => `${Math.round(x * 10)},${Math.round(y * 10)}`).sort();
      const edge = endpoints.join(':');
      if (drawnEdges.has(edge)) continue;
      drawnEdges.add(edge);
      ctx.moveTo(...p[a]); ctx.lineTo(...p[b]);
    }
    ctx.strokeStyle = color; ctx.shadowColor = color;
    ctx.globalAlpha = .12 * rangeOpacity;
    ctx.lineWidth = 2.5; ctx.shadowBlur = 3; ctx.stroke();
    ctx.globalAlpha = .3 * rangeOpacity; ctx.lineWidth = .9; ctx.shadowBlur = 0; ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  function paint(now) {
    if (now - lastPaint < 1000 / 30) return;
    lastPaint = now;
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) {
      layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    drawnEdges.clear();
    const activeCount = battle.allyUnits.filter((u) => u.alive && u.deployed && u.skill?.active && u.skill.kind !== 'passive').length;
    rangeOpacity = 1 / Math.sqrt(Math.max(1, activeCount));
    for (const u of battle.allyUnits) {
      if (!u.alive || !u.deployed || u.hidden) continue;
      if (u.skill?.kind !== 'passive' && (u.skill?.active || (pulses.get(u.id) || 0) > battle.time)) {
        const color = u.def.charId === 'char_1045_svash2' ? '#b9edff' : '#ffbf70';
        // Custom operators already draw their own range edge in their dedicated VFX module.
        if (!['char_1503_talula', 'char_9901_vina', 'char_9902_custommakoto', 'char_2027_wang'].includes(u.def.charId)) glow(u.rangeKeys, color, now);
        const p = view.tileScreen(u.tileR, u.tileC);
        if (p) {
          ctx.fillStyle = color; ctx.globalAlpha = .65; ctx.shadowColor = color; ctx.shadowBlur = 3;
          ctx.save(); ctx.translate(p.x, p.y - Math.min(85, p.s * 1.1)); ctx.rotate(Math.PI / 4);
          ctx.fillRect(-3, -3, 6, 6); ctx.restore(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        }
      }
      if (u.kind === 'token' && u.ownerUnit?.skill?.active && u.ownerUnit.skill.kind !== 'passive') {
        glow(u.rangeKeys, u.defId.includes('closur_ourbase') ? '#7ef5dc' : '#ffcf8c', now);
      }
      if (u.mem.svashCoop?.skill?.active) {
        const owner = u.mem.svashCoop;
        // The cooperative reveal uses the same skill grid, rotated around this ally.
        glow(absoluteRangeKeys(owner.skill.spec.targeting?.rangeGrid || owner.rangeGrid, u.tileR, u.tileC, u.dir), '#b9edff', now);
      }
    }
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i], t = (battle.time - s.born) / s.duration;
      if (t >= 1) { shots.splice(i, 1); continue; }
      const p = point(s.x + s.dx * t, s.y + s.dy * t, .35);
      const tail = point(s.x + s.dx * Math.max(0, t - .36), s.y + s.dy * Math.max(0, t - .36), .35);
      ctx.strokeStyle = '#ddfaff'; ctx.shadowColor = '#71cfff'; ctx.shadowBlur = 15; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.lineWidth = 2; ctx.stroke(); ctx.shadowBlur = 0;
    }
    for (const p of battle.projectiles.list) {
      if (p.visual !== 'nitro') continue;
      const pos = point(p.x, p.y, .4);
      ctx.fillStyle = '#e5fcff'; ctx.shadowColor = '#6dcdff'; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.ellipse(pos.x, pos.y, 13, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    const dp = document.querySelector('.hud__dp')?.getBoundingClientRect();
    for (let i = gains.length - 1; i >= 0; i--) {
      const g = gains[i], t = (now - g.born) / 620;
      if (t >= 1) { gains.splice(i, 1); continue; }
      const p = point(g.x, g.y, .9), end = dp ? { x: dp.left + dp.width * .5, y: dp.top + dp.height * .35 } : p;
      const travel = Math.max(0, (t - .22) / .78), eased = travel * travel;
      const x = p.x + (end.x - p.x) * eased, y = p.y - 22 * Math.sin(t * Math.PI) + (end.y - p.y) * eased;
      ctx.globalAlpha = Math.min(1, (1 - t) * 5); ctx.fillStyle = '#e4ff91'; ctx.shadowColor = '#b8ff54'; ctx.shadowBlur = 12;
      ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`+${Number(g.n.toFixed(2))}`, x, y);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
  }
  return { ingest, paint,
    displayedDp: () => Math.max(battle.players[0].dpFloor || 0, battle.players[0].dp - gains.filter((g) => performance.now() - g.born < 620).reduce((n, g) => n + g.n, 0)),
    destroy: () => layer.remove(),
  };
}
