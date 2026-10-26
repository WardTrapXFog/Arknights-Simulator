// server/sim/content/kits/ops/chess_char_5_14-svash2.js — 凛御银灰 (char_1045_svash2) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { ENEMY_COLLIDER_RADIUS } from '../../../constants.js';
import { hitRect, bodyInRange } from '../../../body.js';
import { hypot } from '../../../detmath.js';
import { absoluteRangeKeys, tileKeyOf } from '../../../targeting.js';
import {
  AURA_IV, AURA_DUR, num, on, talent, talentRec, skillGrid, mods, inFaction, isOp, lazySkills, instantKind,
  skillRange, whileOn, enemiesInGrid,
} from '../shared/tier5.js';

const isKjerag = (u) => inFaction(u, 'kjeragShip', ['kjerag']);

const segmentDistance = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
};
function touchesDanzen(enemy, a, b) {
  const rect = hitRect(enemy);
  if (!rect) return segmentDistance(enemy, a, b) <= .8 + ENEMY_COLLIDER_RADIUS;
  let lo = 0, hi = 1;
  for (const [start, end, min, max] of [[a.x, b.x, rect.x0, rect.x1], [a.y, b.y, rect.y0, rect.y1]]) {
    const delta = end - start;
    if (!delta) { if (start < min || start > max) { hi = -1; break; } }
    else {
      const t0 = (min - start) / delta, t1 = (max - start) / delta;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    }
  }
  if (lo <= hi) return true;
  const distanceToRect = (p) => hypot(Math.max(rect.x0 - p.x, 0, p.x - rect.x1), Math.max(rect.y0 - p.y, 0, p.y - rect.y1));
  if (Math.min(distanceToRect(a), distanceToRect(b)) <= .8) return true;
  return [[rect.x0, rect.y0], [rect.x0, rect.y1], [rect.x1, rect.y0], [rect.x1, rect.y1]]
    .some(([x, y]) => segmentDistance({ x, y }, a, b) <= .8);
}

// PRTS 变革已至备注：丹增，半径 0.8、速度 10、寿命 0.3 秒；本体与协同使用同一弹道。
function danzen(battle, unit, origin, grid, bb, attackId = ++battle._attackSeq) {
  const keys = new Set(absoluteRangeKeys(grid, origin.tileR, origin.tileC, origin.dir));
  const selectable = (e) => e.alive && e.deployed && !e.hidden && !e.s.flags.untargetable && !e.s.flags.sleep;
  const foes = battle.enemies.filter((e) => selectable(e) && keys.has(tileKeyOf(e))).sort((a, b) => a.id - b.id);
  const target = foes[0];
  const dx = target ? target.x - origin.x : 0, dy = target ? target.y - origin.y : 0;
  const distance = hypot(dx, dy);
  const vx = distance > .1 ? dx / distance : origin.fwd[1];
  const vy = distance > .1 ? dy / distance : origin.fwd[0];
  const hit = new Set();
  const amount = unit.s.atk * unit.s.atkScaleMul * num(bb.bird_atk_scale, 1);
  battle._ev(['atk', origin.id, target?.id ?? origin.id, 'none']);
  battle.fx('danzen', { x: origin.x, y: origin.y, dx: vx * 3, dy: vy * 3, id: unit.id, duration: .3 });
  battle.addProjectile({ from: origin, source: unit, velocity: { x: vx * 10, y: vy * 10 }, maxAge: .3,
    onStep({ from, x, y }) {
      for (const e of battle.enemies) {
        if (hit.has(e) || !selectable(e)) continue;
        if (!touchesDanzen(e, from, { x, y })) continue;
        hit.add(e);
        battle.dealDamage(unit, e, { amount, type: 'phys', isAttack: true, isSkill: true, isProjectile: true, attackId, tags: ['skill', 'svash2'] });
        if (e.alive) battle.applyStatus(e, 'fragile', { duration: 2, value: num(bb.damage_scale, 1) - 1, source: unit });
      }
    },
  });
}

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 凛御银灰 — S2 御敌的锋锐 (2 charges; PRTS 备注 "可对空"): the 6 front-most enemies in the skill range take 260 % ATK
  // phys, cold + reveal for 4 s; the waiting (knocked-out) op nearest to 风雪之眼 by cost gets −11 redeploy cost (right
  // side guard/caster/sniper first); waiting ops left of the eye (cost < eye cost) cast the AoE with their own ATK when
  // they redeploy (≤2).
  // T1 开放性开局: ops left of the eye and himself: +4 SP at deployment, redeploy time −20 %.
  // T2 雪境先驱: Kjerag ops freeze-immune, DEF +60, 1.5 % max HP/s regen; doubled after 15 s on the field.
  // The eye follows the selected skill (its overrideTokenKey: S1 eagle1 cost 16, S2 eagle2 14, S3 eagle3 19).
  // S1 周旋的谋略 (instant): +cost DP at once; the waiting op nearest to the eye gets −[deck].cost redeploy cost (same pick
  // as S2) and a barrier of [deck].shield × his max HP when it redeploys.
  // S3 变革已至 (duration 48 s): reveal in skill range; Danzen travels in a straight line and pierces enemies,
  // using bird_atk_scale × ATK phys and 2-second 脆弱, including collisions beyond the targeting range;
  // +[start_cost] DP at once, then +[cost].cost DP every [cost].interval s; the first activation of the battle swaps the
  // base costs of the most (guard/caster/sniper first) and least expensive waiting ops. The manual hand supports
  // deploying 风雪之眼 onto an ally to transfer the cooperative attack.
  chess_char_5_14_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const grid = skillGrid(chess, def) ?? [[0, 0], [0, 1]];
    const eyeId = chess?.skill?.overrideTokenKey ?? talentRec(chess, 0)?.tokenKey ?? 'token_10057_svash2_eagle2';
    const n = Math.max(1, num(bb.max_target, 6)), maxStacks = Math.max(1, num(bb.max_stack_cnt, 2));
    const PREF = ['WARRIOR', 'CASTER', 'SNIPER'];
    /** Waiting (knocked-out) ops of his player split around the eye cost, and the one nearest to the eye (right side first). */
    const waitingArea = (battle, unit) => {
      const eye = unit.mem.eyeCost ?? 0;
      const waiting = battle.allyUnits.filter((a) => isOp(a) && a !== unit && a.ownerId === unit.ownerId && !a.alive && !a.removed);
      if (battle.siLevel) {
        const price = (a) => battle.hand.cost(battle.hand.unitRecord(a));
        const ordered = battle.hand.cards().map((c) => battle.hand.record(c.id));
        const eyeIndex = ordered.findIndex((r) => r.policy === 'eye' && r.owner === unit);
        const left = ordered.slice(0, eyeIndex).filter((r) => r.kind === 'op').map((r) => r.unit).reverse();
        const right = ordered.slice(eyeIndex + 1).filter((r) => r.kind === 'op').map((r) => r.unit);
        return { waiting, left, right, pick: right.find((a) => PREF.includes(a.def.profession)) || right[0] || left[0] || null, price };
      }
      const right = waiting.filter((a) => a.base.cost >= eye).sort((a, b) => a.base.cost - b.base.cost || a.id - b.id);
      const left = waiting.filter((a) => a.base.cost < eye).sort((a, b) => b.base.cost - a.base.cost || a.id - b.id);
      const pick = right.find((a) => PREF.includes(a.def?.profession)) ?? right[0] ?? left[0] ?? null;
      return { waiting, right, left, pick };
    };
    const cutCost = (a, v, battle) => {
      if (!a || !(v > 0)) return;
      if (battle?.siLevel) {
        const r = battle.hand.unitRecord(a), key = 'svashCut';
        battle.hand.effects(a, key, (r.costEffects.get(key)?.delta || 0) - v, 'deploy');
        return;
      }
      a.mem.svashCostBase ??= a.base.cost;
      a.base.cost = Math.max(0, a.base.cost - v);
    };
    const slash = (battle, caster, atk) => {
      // PRTS 备注: the slash ignores 隐匿 and hits flying enemies (and its reveal makes them targetable afterwards)
      for (const e of enemiesInGrid(battle, caster, grid, n, { ignoreStealth: true })) {
        battle.dealDamage(caster, e, { amount: atk * num(bb.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill', 'svash2'] });
        if (!e.alive) continue;
        battle.applyStatus(e, 'cold', { duration: num(bb.cold), source: caster });
        battle.applyStatus(e, 'reveal', { duration: num(bb.cold), source: caster });
      }
      battle.fx('aoe', { x: caster.x + caster.fwd[1] * 1.5, y: caster.y + caster.fwd[0] * 1.5, id: caster.id, r: 2, skill: 'svash2' });
    };
    return {
      skills: lazySkills({
        // (自动触发: an AUTO skill takes no 技能策略 — an AUTO DP skill fires as soon as it is ready, like 伺夜 S1)
        skchr_svash2_1: () => ({
          kind: instantKind(chess, def),
          trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb.cost));
            const { pick } = waitingArea(battle, unit);
            cutCost(pick, num(bb['svash2_s_1[deck].cost']), battle);
            if (pick) pick.mem.svashShield = unit.s.maxHp * num(bb['svash2_s_1[deck].shield']);
            battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, r: 1, skill: 'svash2Plan' });
          },
        }),
        skchr_svash2_3: () => ({
          kind: 'duration',
          targeting: skillRange(chess, def),
          attack: {
            canHitFly: true,
            resolveAttack({ battle, unit, attackId }) { danzen(battle, unit, unit, grid, bb, attackId); },
          },
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb['svash2_s_3[start_cost].cost']));
            unit.mem.svashDpAcc = 0;
            unit.mem.svashReveal = .5;
            if (!unit.mem.svashSwapped) { // 首次开启时交换…基础部署费用
              if (battle.siLevel) {
                const waiting = battle.hand.waiting(unit.ownerId).filter((a) => a !== unit);
                const price = (a) => battle.hand.cost(battle.hand.unitRecord(a));
                waiting.sort((a, b) => price(b) - price(a) || Number(PREF.includes(b.def.profession)) - Number(PREF.includes(a.def.profession)) || a.id - b.id);
                const hi = waiting[0], lo = waiting.at(-1);
                if (hi && lo && hi !== lo) {
                  battle.hand.effects(hi, `svashSwap:${unit.id}`, lo.def.stats.cost - hi.def.stats.cost);
                  battle.hand.effects(lo, `svashSwap:${unit.id}`, hi.def.stats.cost - lo.def.stats.cost);
                  unit.mem.svashSwapped = true;
                }
                return;
              }
              unit.mem.svashSwapped = true;
              const { waiting } = waitingArea(battle, unit);
              const baseCost = (a) => a.mem.svashCostBase ?? a.base.cost;
              const byCost = waiting.slice().sort((a, b) => baseCost(b) - baseCost(a) || a.id - b.id);
              const hi = byCost.find((a) => PREF.includes(a.def?.profession)) ?? byCost[0];
              const lo = byCost.filter((a) => a !== hi).pop();
              if (hi && lo && baseCost(hi) !== baseCost(lo)) {
                const ch = baseCost(hi), cl = baseCost(lo);
                for (const [a, v] of [[hi, cl], [lo, ch]]) {
                  if (a.mem.svashCostBase != null) { a.base.cost = Math.max(0, v - (a.mem.svashCostBase - a.base.cost)); a.mem.svashCostBase = v; } else a.base.cost = v;
                }
              }
            }
          },
          onTick({ battle, unit, dt }) {
            if (unit.mem.svashCoopTarget && !on(unit.mem.svashCoopTarget)) {
              unit.mem.svashCoopTarget.mem.svashCoop = null;
              unit.mem.svashCoopTarget = null;
            }
            if (battle.siLevel && on(unit.mem.svashCoopTarget)) {
              const ally = unit.mem.svashCoopTarget;
              const keys = absoluteRangeKeys(grid, ally.tileR, ally.tileC, ally.dir, 0);
              const set = new Set(keys);
              const foes = battle.enemies.filter((e) => e.alive && e.deployed && !e.hidden && !e.s.flags.untargetable && bodyInRange(e, set));
              unit.mem.svashCoopCd = Math.max(0, (unit.mem.svashCoopCd || 0) - dt);
              if (foes.length && !unit.mem.svashCoopCd) {
                danzen(battle, unit, ally, grid, bb);
                unit.mem.svashCoopCd = Math.max(.1, unit.s.interval);
              }
            }
            const iv = Math.max(0.1, num(bb['svash2_s_3[cost].interval'], 2));
            unit.mem.svashDpAcc += dt;
            while (unit.mem.svashDpAcc >= iv - 1e-9) { unit.mem.svashDpAcc -= iv; battle.addDp(unit.ownerId, num(bb['svash2_s_3[cost].cost'], 1)); } // loop-cap: interval floored before the loop
            unit.mem.svashReveal += dt;
            if (unit.mem.svashReveal < .5 - 1e-9) return;
            unit.mem.svashReveal = 0;
            for (const caster of [unit, unit.mem.svashCoopTarget].filter(on)) {
              for (const e of enemiesInGrid(battle, caster, grid, 0, { ignoreStealth: true })) battle.applyStatus(e, 'reveal', { duration: 1, source: unit });
            }
          },
          onEnd({ unit }) {
            if (unit.mem.svashCoopTarget) unit.mem.svashCoopTarget.mem.svashCoop = null;
            unit.mem.svashCoopTarget = null;
          },
        }),
      }),
      skill: {
        kind: 'charges', // DEFAULT (data): cast right before an attack on an enemy in his initial (melee) range
        onStart({ battle, unit }) {
          slash(battle, unit, unit.s.atk);
          // cost cut: nearest to the eye, right side guard/caster/sniper preferred
          let { left, pick } = waitingArea(battle, unit);
          cutCost(pick, num(bb.cost), battle);
          if (battle.siLevel) left = waitingArea(battle, unit).left;
          for (const a of left) a.mem.svashCasts = Math.min(maxStacks, num(a.mem.svashCasts) + 1);
        },
      },
      talents: [
        { install(battle, unit) { // 开放性开局
          const sp = num(t0.sp), mul = num(t0.respawn_time, 1);
          const left = (a) => isOp(a) && a.ownerId === unit.ownerId && (a === unit || (battle.siLevel
            ? battle.hand.cost(battle.hand.unitRecord(a)) <= num(unit.mem.eyeCost) : a.base.cost < num(unit.mem.eyeCost)));
          battle.on('battleStart', () => {
            if (!on(unit) || !(sp > 0)) return;
            for (const a of battle.allies(unit.ownerId)) if (left(a) && a.skill) a.skill.gainSp(sp, 'talent');
          }, { owner: unit });
          battle.on('deploy', (c) => {
            const a = c.unit;
            if (c.initial || !left(a) || !(a === unit || on(unit))) return;
            if (battle.siLevel) {
              a.mem.svashRedeploy ??= new Map();
              a.mem.svashRedeploy.set(unit.id, mul);
            }
            if (sp > 0 && a.skill) a.skill.gainSp(sp, 'talent');
          }, { owner: unit });
          battle.on('death', (c) => {
            const a = c.unit;
            if (battle.siLevel) {
              const value = a.mem.svashRedeploy?.get(unit.id);
              if (value > 0 && value < 1 && Number.isFinite(a.respawnAt)) a.respawnAt = a.deathAt + (a.respawnAt - a.deathAt) * value;
              a.mem.svashRedeploy?.delete(unit.id);
              return;
            }
            if (!left(a) || a.removed || !(a === unit || on(unit)) || !Number.isFinite(a.respawnAt) || !(mul > 0 && mul < 1)) return;
            a.respawnAt = a.deathAt + (a.respawnAt - a.deathAt) * mul;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 雪境先驱
          const defv = num(t1.def), regen = num(t1.hp_recovery_per_sec_by_max_hp_ratio), after = num(t1.interval, 15);
          whileOn(battle, unit, AURA_IV, () => {
            const m = battle.time - unit.deployedAt >= after - 1e-9 ? 2 : 1;
            for (const a of battle.allies()) {
              if (isOp(a) && isKjerag(a)) battle.addBuff(a, { key: 'svash2:snow', duration: AURA_DUR, mods: mods({ defFlat: defv * m, hpRegenRatio: regen * m }) });
            }
          });
          battle.on('beforeStatus', (c) => {
            if (c.status === 'freeze' && c.target.side === 'ally' && c.target.findBuff('svash2:snow')) c.cancel = true;
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        if (battle.siLevel) battle.on('handEye', ({ owner, target }) => {
          if (owner !== unit) return;
          for (const a of battle.allyUnits) if (a !== target && a.mem.svashCoop === unit) a.mem.svashCoop = null;
          unit.mem.svashCoopTarget = target;
          unit.mem.svashCoopCd = unit.atkCd;
        }, { owner: unit });
        const tok = battle.tokenDef(eyeId, unit); // the owner's skill variant (DESIGN §16)
        unit.mem.eyeCost = num(tok?.stats?.cost, 14);
        // waiting-area effects resolve when the op (re)deploys
        battle.on('deploy', (c) => {
          const a = c.unit;
          if (!isOp(a) || a.ownerId !== unit.ownerId) return;
          if (battle.siLevel && a !== unit && on(unit) && unit.skill?.id === 'skchr_svash2_3' && unit.skill.active && !unit.mem.svashCoopTarget) {
            unit.mem.svashCoopTarget = a;
            unit.mem.svashCoopCd = unit.atkCd;
            a.mem.svashCoop = unit;
          }
          if (!battle.siLevel && a.mem.svashCostBase != null) { a.base.cost = a.mem.svashCostBase; a.mem.svashCostBase = null; }
          if (num(a.mem.svashShield) > 0 && !c.initial) { // S1: 部署后获得…屏障
            battle.addBuff(a, { key: 'svash2:barrier', shield: a.mem.svashShield, visible: true });
            a.mem.svashShield = 0;
          }
          const casts = num(a.mem.svashCasts);
          if (casts > 0 && !c.initial) {
            a.mem.svashCasts = 0;
            for (let i = 0; i < casts; i++) {
              if (battle.siLevel) battle.after(1.1 + .5 * i, () => { if (on(a)) slash(battle, a, a.s.atk); }, { owner: a });
              else slash(battle, a, a.s.atk);
            }
          }
        }, { owner: unit });
      },
    };
  },
};
