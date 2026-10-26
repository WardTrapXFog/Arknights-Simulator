// 维娜·维多利亚（自设领主）；数据与美术来自 AKF，与官设术战者独立。
import { num, talentBb, skillRec, batMod, holdProtect, alliesInGridOf, enemiesInGrid, up } from '../shared/tier1.js';

const NINE = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,0],[0,1],[1,-1],[1,0],[1,1]];
const S1 = 'skchr_vina_1', S2 = 'skchr_vina_2', S3 = 'skchr_vina_3';

export default {
  char_9901_vina: (bb, chess) => {
    const b1 = skillRec(chess, S1).bb, b2 = skillRec(chess, S2).bb, b3 = skillRec(chess, S3).bb;
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), seen = new WeakSet();
    return {
      trait: { maxTargets: 2 },
      skills: {
        [S1]: { kind: 'instant', attack: { onHit({ battle, unit }) {
          for (const e of enemiesInGrid(battle, unit, null, { n: num(b1.targets, 5) })) {
            battle.applyStrongest(e, 'vina:trueVulnerable', { duration: num(b1.debuff), value: num(b1.vulnerable), mods: v => ({ trueTakenMul: 1 + v }), source: unit });
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(b1.scale), type: 'true', isSkill: true, tags: ['skill', 'vinaS1'] });
          }
          battle.fx('vinaCleave', { x: unit.x, y: unit.y, id: unit.id, dir: unit.dir });
        } } },
        [S2]: { kind: 'toggle', onStart({ battle, unit }) {
          battle.fx('vinaStance', { x: unit.x, y: unit.y, id: unit.id });
        }, mods: { atkPct: num(b2.atk), batPct: batMod(num(b2.bat_add), chess) },
          targeting: { maxTargets: num(b2.targets, 3), rangeGrid: skillRec(chess, S2).rangeGrid } },
        [S3]: { kind: 'instant', onStart({ battle, unit }) {
          // 剑刃按朝向贯穿地图，宽三格；不受 AKF 编辑器七格显示边界限制。
          const dirs = { RIGHT: [0,1], LEFT: [0,-1], UP: [1,0], DOWN: [-1,0] }, d = dirs[unit.dir] || dirs.RIGHT;
          const length = d[1] ? (d[1] > 0 ? battle.rect.c1 - unit.x : unit.x - battle.rect.c0)
            : (d[0] > 0 ? battle.rect.r1 - unit.y : unit.y - battle.rect.r0);
          battle.fx('vinaRoyalBlade', { x: unit.x, y: unit.y, id: unit.id, dir: unit.dir, length: length + .5 });
          for (const e of battle.enemies) {
            if (!e.alive || e.hidden || !e.deployed) continue;
            const dr = e.y - unit.y, dc = e.x - unit.x, forward = dr * d[0] + dc * d[1], side = dr * d[1] - dc * d[0];
            if (forward < -0.5 || Math.abs(side) > 1.5) continue;
            battle.applyStatus(e, 'fragile', { duration: num(b3.debuff), value: num(b3.vulnerable), source: unit });
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(b3.scale), type: 'true', isSkill: true, tags: ['skill', 'vinaS3'] });
            if (e.alive) battle.applyStatus(e, 'fear', { duration: num(b3.fear), source: unit });
          }
        } },
      },
      install(battle, unit) {
        battle.on('tick', () => {
          if (!up(unit)) return;
          const allies = alliesInGridOf(battle, unit, NINE), enemies = battle.unitsInGrid(unit, NINE, { side: 'enemy' });
          for (const a of allies) holdProtect(battle, a, num(t0.protect), 0.08, unit);
          if (allies.some(a => a !== unit) && enemies.some(e => e.alive)) battle.addBuff(unit, { key: 'vina:glory', mods: { atkPct: num(t0.atk) }, duration: 0.08, refresh: 'replace' });
          if (unit.def.skill.id === S2) for (const a of allies) battle.applyStrongest(a, 'custom:spAura', {
            duration: 0.08, value: num(b2.sp_aura), mods: v => ({ spRecoveryFlat: v }), source: unit,
          });
        }, { owner: unit });
        battle.on('hit', ctx => {
          if (ctx.source !== unit || ctx.target?.side !== 'enemy' || !up(unit)) return;
          if (!seen.has(ctx.target)) ctx.dmg.mul *= num(t1.first_scale, 1);
        }, { owner: unit });
        battle.on('damaged', ctx => {
          if (ctx.source !== unit || ctx.target?.side !== 'enemy' || !(ctx.amount > 0) || !up(unit)) return;
          const e = ctx.target;
          if (!seen.has(e)) {
            seen.add(e);
            if (e.alive) {
              battle.applyStatus(e, 'tremble', { duration: num(t1.tremble), source: unit });
              if (e.findBuff('tremble')) battle.fx('vinaTremble', { x: e.x, y: e.y, id: e.id, dur: num(t1.tremble) });
            }
          }
          const tags = ctx.dmg?.tags || [];
          if (ctx.dmg?.isAttack || tags.includes('vinaS1') || tags.includes('vinaS3') || tags.includes('vinaModule')) {
            battle.fx('vinaStrike', { x: e.x, y: e.y, id: e.id, src: unit.id,
              style: tags.includes('vinaS3') ? 's3' : tags.includes('vinaS1') ? 's1' : tags.includes('vinaModule') ? 'arts' : 'attack' });
          }
          if (ctx.dmg?.isAttack && !ctx.dmg?.tags?.includes('vinaModule') && num(chess.trait?.bb?.extra_arts) > 0 && e.alive) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(chess.trait.bb.extra_arts), type: 'arts', tags: ['talent', 'vinaModule'] });
          }
        }, { owner: unit });
      },
    };
  },
};
