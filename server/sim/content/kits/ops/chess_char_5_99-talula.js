// server/sim/content/kits/ops/chess_char_5_99-talula.js — 塔露拉（自设干员 char_1503_talula）kit，tier 5。
// 棋子记录：data/chess.json chess_char_5_99_talula_a（tools/register-talulah.mjs 写入）。
// 分支：本源近卫（PRTS 聆音 → 特性「能够阻挡两个敌人，可以造成元素伤害」，分支特性「可以且优先攻击自身阻挡的单位（即使目标
// 处于攻击范围外或为飞行单位）」，精英 0/1/2 范围 1-1，阻挡 2，法抗 10）。数值口径：+X% 走 atkPct；「提升至 X%」是攻击力倍率，
// 在 'hit' 钩子里乘 dmg.amount（减防之前，PRTS 游戏数据基础 基本伤害 = 攻击力 × 攻击力倍率）；「造成的伤害提升 X%」乘 dmg.mul。
// 「优先攻击自身阻挡的单位」不需要写代码：引擎对每个干员都是这个规则（targeting.js sortEnemyTargets 阻挡优先 + ai.js
// acquireTargets 用 blockedTargets 补进范围外的阻挡目标）。
//
// 本份实现（AKF 塔露拉.AKF 的 SkillNDes / AbilityData 原文，括号内为潜能加成，棋子记录按潜能 6 满潜写入）：
//   天赋 1 来自乌萨斯：攻击力 +21%（18+3）；攻击时额外造成 40%（35+5）法术伤害与 25%（20+5）元素伤害；20% 概率当次
//     攻击力提升至 170%（160+10）——每次攻击掷一次，不是每个受击目标各掷一次；隐匿失效（自身攻击范围内 + 全场灼燃爆发中）。
//   天赋 2 焚尽冻原：开启技能时起飞（S2/S3，瞬时技能起飞没有意义；起飞按 ba.liftoff 放走地面阻挡、改为阻挡飞行敌人）；30% 对空庇护（受到的空中单位伤害 ×0.7）；免疫敌方的
//     灼燃损伤（元素损伤槽）；对「焚尽」状态敌人伤害 ×1.25；塔露拉在场时敌人灼燃爆发获得 5 秒焚尽（防御 -35%、法抗 -20、
//     每秒 15% 攻击力法术 + 10% 攻击力元素伤害、停顿、失去特殊能力）。
//   S1 薪火裁决（自动回复 自动触发 3SP，瞬时）：下一次攻击附带 120% 攻击力灼燃损伤 + 230% 攻击力元素伤害（目标已处于
//     灼燃爆发则 460%）。
//   S2 炽翼掠火（18/22，20 秒）：范围 15 格 3×5，攻击间隔 -0.2s，攻击力 +110%，最多 4 个目标；对每个敌人的首次攻击直接
//     引爆其灼燃损伤；攻击附带「造成伤害 40%」的灼燃损伤；攻击灼燃爆发中的敌人时伤害类型变元素伤害且攻击力提升至 135%。
//   S3 恶火重燃（40/45，30 秒）：范围 19 格菱形，攻击间隔 +0.8s，攻击力 +30%，攻击范围内全体，攻击力提升至 380%；每次
//     攻击放出一道从身后地图边界向身前席卷全场的【焰浪】（8 格/秒，全图宽度）：触碰到的地面敌人受 120% 攻击力法术伤害 +
//     700 点灼燃损伤，首次触碰立刻引爆；被焰浪影响的敌人灼燃冷却恢复速度 +100%（剩余爆发冷却减半）；引爆的敌人所在
//     地块留下【恶火】：每秒 15% 攻击力法术 + 10% 攻击力元素伤害，持续到技能结束后 5 秒。
//
// fx 种类（battle.fx）：firewall {axis, dir, dur} 焰浪火墙（render/fx/simfx.js 'wall'）· yanyouFlame 恶火地块 ·
//   ignite 焚尽 · scorchBurst 通用爆裂（其他干员的范围爆炸仍用它）· talulaS1 一技能命中（沿剑路的烈焰刀光 + 目标火柱）。

import { COLS } from '../../../constants.js';
import { bodyInKeys, bodyInRange } from '../../../body.js';
import { elementBurst } from '../../../damage.js';
import { canTargetEnemy } from '../../../targeting.js';
import {
  num, on, talent, batPct, mods, selectedId, lazySkills, skillRange, elementHit, whileOn,
} from '../shared/tier5.js';
import { onHitBy, onHitOn } from '../shared/tier1.js';

const S1_ID = 'skchr_talula_1';
const S2_ID = 'skchr_talula_2';
const S3_ID = 'skchr_talula_3';

/** 焚尽（天赋 2）的 buff key：同名取最高 + 延长（refresh 'extend'），5 秒。 */
const BURNING = 'talula:burning';
/** 起飞（天赋 2）的 buff key，技能结束由 onEnd 摘掉。 */
const LIFTOFF = 'talula:liftoff';
/** 部署后的攻击延迟：9 帧（引擎 30 帧/秒）。 */
const DEPLOY_ATTACK_DELAY = 9 / 30;
/**
 * 技能开启的施法前摇：从开技到第一刀的间隔。
 * 没有它，S2/S3 会在同一帧既开技能又出手，画面上就是「光效先炸、人还没动」。
 * 这段时间里渲染侧播 Skill_2（抬手展翼），第一刀落在这段之后。
 */
const CAST_WINDOW = 14 / 30;
/** 攻击方向 → [dRow, dCol]（UP = 行 +1，见 grid.js FOUR_WAYS）。 */
const DIRS = { RIGHT: [0, 1], LEFT: [0, -1], UP: [1, 0], DOWN: [-1, 0] };

/**
 * 表现用的技能开启编号：同一技能再次开启时自增，供渲染侧区分「这是哪一次」。
 * 只写 unit.mem 的表现字段，不参与任何判定；缺失时按 0 处理。
 */
const activationIdOf = (unit, sid) => {
  const mem = unit.mem.talulaPresentation || (unit.mem.talulaPresentation = { sid: null, n: 0 });
  if (mem.sid !== sid) { mem.sid = sid; mem.n += 1; }
  return mem.n;
};

/** 表现用的焰浪编号：每发新焰浪一个 id，替换旧焰浪时渲染侧据此结束旧实例。 */
const nextWaveId = (unit) => {
  const mem = unit.mem.talulaPresentation || (unit.mem.talulaPresentation = { sid: null, n: 0 });
  mem.wave = (mem.wave || 0) + 1;
  return mem.wave;
};

export default {
  chess_char_5_99_talula_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const sid = selectedId(chess, def);

    // ---- 天赋 2 的焚尽 -------------------------------------------------------------------------------------------
    /** 敌人灼燃爆发 → 5 秒焚尽：减防减法抗、持续停顿、失去特殊能力、每秒两段伤害。 */
    const applyBurning = (battle, unit, e) => {
      const dur = num(t1.burn_duration, 5);
      battle.addBuff(e, {
        key: BURNING, duration: dur, refresh: 'extend', visible: true, source: unit,
        mods: mods({ defPct: num(t1.def_down), resFlat: num(t1.res_down) }),
        flags: { silence: true },
        interval: 1,
        onTick: ({ unit: v }) => {
          if (!on(unit) || !v.alive || v.side !== 'enemy') return;
          battle.dealDamage(unit, v, { amount: unit.s.atk * num(t1.fire_scale), type: 'arts', isSkill: true, tags: ['talent', 'talulaBurning'] });
          if (v.alive) elementHit(battle, unit, v, unit.s.atk * num(t1.fire_element_scale), 'talulaBurning', 'burn');
          battle.fx('ignite', { x: v.x, y: v.y, id: v.id });
        },
      });
      battle.applyStatus(e, 'sluggish', { duration: dur, source: unit });
      // 焚尽施加瞬间：一圈向外扩的灼痕环 + 一簇短促的爆燃。
      // 原来这里发的是 'flame'（炎佑从龙嘴里喷火的持续火柱），画在敌人身上既不像「被焚尽」也看不清；
      // 'scorch' 是塔露拉的专属烙痕原型（见 fx/kinds.js 与 fx/talula.js）。
      battle.fx('scorch', { x: e.x, y: e.y, id: e.id, sourceId: unit.id, expiresAt: battle.time + dur });
    };

    // ---- S3 的恶火地块 -------------------------------------------------------------------------------------------
    /** 恶火：一块地一格，落在「被焰浪引爆的敌人当时所处的地块」上，不跟人走。 */
    const addFire = (battle, unit, r, c) => {
      if (r < 0 || r > 18 || c < 0 || c > 20) return;
      const tiles = unit.mem.fireTiles || (unit.mem.fireTiles = new Set());
      const key = r * COLS + c;
      if (tiles.has(key)) return;
      tiles.add(key);
      // 专属的【恶火】地面火斑（fx/talula.js talulaFire）。原来借的是炎佑的 'yanyouFlame'，
      // 那个原型是从龙嘴里喷出的持续火柱，画在地块上完全读不出「这里在烧」。
      // 火斑和伤害地块共用结束时间，保留技能结束后 5 秒的收尾镜头。
      const remain = Math.max(0, Number(unit.skill?.timeLeft) || 0);
      const expiresAt = battle.time + remain + num(bb.fire_after, 5);
      battle.fx('talulaFire', {
        r, c, dur: remain + num(bb.fire_after, 5),
        // 表现用：真实恶火的公共到期时刻，渲染侧按它统一熄灭，不各自计时。
        sourceId: unit.id, activationId: activationIdOf(unit, S3_ID), expiresAt,
      });
    };
    const fireTick = (battle, unit) => {
      const tiles = unit.mem.fireTiles;
      if (!tiles || !tiles.size) return;
      for (const e of battle.enemies) {
        if (!e.alive || e.hidden || e.isFlying || !bodyInKeys(e, tiles)) continue;
        battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.fire_scale), type: 'arts', isSkill: true, tags: ['skill', 'talulaFire'] });
        if (e.alive) elementHit(battle, unit, e, unit.s.atk * num(bb.fire_element_scale), 'talulaFire', 'burn');
      }
    };

    // ---- S3 的焰浪 -----------------------------------------------------------------------------------------------
    /** 一道焰浪：从身后的地图边界出发，垂直于攻击方向贯穿全图，向前推进。 */
    const launchWave = (battle, unit) => {
      const d = DIRS[unit.dir] || DIRS.RIGHT;
      const alongCol = d[1] !== 0;
      const R = battle.rect;
      const sign = alongCol ? d[1] : d[0];
      const from = alongCol ? (sign > 0 ? R.c0 : R.c1) : (sign > 0 ? R.r0 : R.r1);
      const to = alongCol ? (sign > 0 ? R.c1 : R.c0) : (sign > 0 ? R.r1 : R.r0);
      const waves = unit.mem.waves || (unit.mem.waves = []);
      // [ASSUMED] 同时只维持一道焰浪：上一道还没走完就再来一发时，旧的立刻结束（技能每 2 秒一次攻击，焰浪 2.6 秒走完全图，
      // 重叠只会让同一批敌人被同一发二次计伤；真实的官方特效是一道火墙推过去）
      waves.length = 0;
      waves.push({ id: nextWaveId(unit), axis: alongCol ? 'col' : 'row', sign, front: from, prev: from, to, hit: new Set() });
      waveFx(battle, unit, alongCol ? 'col' : 'row', from);
    };
    const waveFx = (battle, unit, axis, at) => {
      // 焰浪前端：一整条贯穿战场、向上翻卷的火线（fx/talula.js talulaWave）。
      // 原来发的是 'firewall'——那是「一排地块着火」的静态火格，看不出「从身后推过来」的方向感。
      const w = (unit.mem.waves || [])[0];
      battle.fx('talulaWave', {
        x: axis === 'col' ? at : 0, y: axis === 'col' ? 0 : at,
        id: unit.id, axis, sign: (DIRS[unit.dir] || DIRS.RIGHT)[axis === 'col' ? 1 : 0] || 1, dir: unit.dir,
        // 表现用：波前位置由机制报告，渲染侧不再自己算速度和位移。
        waveId: w?.id ?? 0, front: w?.front ?? at, speed: num(bb.wave_speed, 8), to: w?.to ?? at,
      });
    };
    /** 焰浪推进一帧：跨过的敌人（**含飞行单位**）吃 120% 法术 + 700 灼燃，首次触碰立刻引爆，引爆处留恶火。
     *  对空是焰浪与恶火的关键区别：恶火只烧地面（见 fireTick 的 `e.isFlying` 过滤），焰浪连空中的一起卷。 */
    const stepWaves = (battle, unit, dt) => {
      const waves = unit.mem.waves;
      if (!waves || !waves.length) return;
      const speed = num(bb.wave_speed, 8);
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        w.prev = w.front;
        w.front += w.sign * speed * dt;
        const lo = Math.min(w.prev, w.front) - 0.5;
        const hi = Math.max(w.prev, w.front) + 0.5;
        for (const e of battle.enemies) {
          if (!e.alive || e.hidden || w.hit.has(e.id)) continue;
          const q = w.axis === 'col' ? e.x : e.y;
          if (q < lo || q > hi) continue;
          w.hit.add(e.id);
          battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.wave_scale), type: 'arts', isSkill: true, tags: ['skill', 'talulaWave'] });
          if (!e.alive) continue;
          battle.dealDamage(unit, e, { amount: num(bb.wave_burn), type: 'element', element: 'burn', tags: ['skill', 'talulaWave'] });
          // 首次触碰：立刻引爆（elementBurst 自带 burstLocked 保护，已在冷却中的不会再爆）
          elementBurst(battle, unit, e, 'burn');
          const lock = e.findBuff('burnBurst');
          if (lock) {
            // 灼燃损伤冷却恢复速度 +100%：剩余爆发冷却按双倍速度走完
            if (Number.isFinite(lock.timeLeft)) lock.timeLeft = Math.max(0, lock.timeLeft) / (1 + num(bb.burst_cd_speed, 1));
            // 恶火落在敌人当时所处的地块上
            addFire(battle, unit, Math.round(e.y), Math.round(e.x));
          }
        }
        if (Math.round(w.front) !== Math.round(w.prev)) waveFx(battle, unit, w.axis, Math.round(w.front));
        if (w.sign > 0 ? w.front > w.to : w.front < w.to) waves.splice(i, 1);
      }
      if (!waves.length) unit.mem.waves = null;
    };

    // ---- 起飞 + 技能结束的收尾 ------------------------------------------------------------------------------------
    // 起飞（ba.liftoff）：不阻挡地面敌人、不被地面敌人选中，改为可以阻挡飞行敌人（blockFly，与蒂比/安洁莉娜同义）。
    // 天赋 1 的「优先攻击自身阻挡的单位（即使…为飞行单位）」由引擎的阻挡优先规则兑现：被阻挡的飞行敌人可被选中。
    // 起飞瞬间放走原本阻挡的地面敌人；落地时放走空中敌人。
    const takeOff = (battle, unit, duration, sid) => {
      battle.releaseBlocked(unit);
      battle.addBuff(unit, {
        key: LIFTOFF, duration: Math.max(0.1, Number(duration) || 1), visible: true,
        flags: { liftoff: true, blockFly: true }, source: unit,
      });
      battle.fx('talulaTakeoff', {
        x: unit.x, y: unit.y, id: unit.id,
        skillIndex: sid === S3_ID ? 2 : sid === S2_ID ? 1 : 0,
        activationId: sid ? activationIdOf(unit, sid) : 0,
      });
    };
    const land = (battle, unit, sid) => {
      battle.releaseBlocked(unit);
      const b = unit.findBuff(LIFTOFF);
      if (b) battle.removeBuff(unit, b);
      battle.fx('talulaLand', {
        x: unit.x, y: unit.y, id: unit.id,
        skillIndex: sid === S3_ID ? 2 : sid === S2_ID ? 1 : 0,
        activationId: sid ? activationIdOf(unit, sid) : 0,
      });
    };
    /** 火翼开关（S2 专属）：渲染层按 owner 建一对跟着她走的火翼，用 `on` 关掉。 */
    const wing = (battle, unit, on, dur, sid) => battle.fx('talulaWing', {
      x: unit.x, y: unit.y, id: unit.id, on: !!on, dur: Number(dur) || 4,
      skillIndex: sid === S3_ID ? 2 : sid === S2_ID ? 1 : 0,
      activationId: sid ? activationIdOf(unit, sid) : 0,
    });

    return {
      skills: lazySkills({
        // ---- S1 薪火裁决：下一次攻击附带灼燃损伤 + 元素伤害 ------------------------------------------------
        [S1_ID]: () => ({
          kind: 'instant',
          // 点火：技能开的一瞬间在她身上起火（原本只有命中目标时的 scorchBurst，角色本人完全没动静）
          onStart({ battle, unit }) {
            // 点火：技能开的一瞬间给音频一个锚点（talulaIgnite → talula-audio.js 的 casts）。
            // 画面不再画掌心聚火：强化命中时的火在剑路上，见 talulaS1。
            battle.fx('talulaIgnite', { x: unit.x, y: unit.y, id: unit.id, activationId: activationIdOf(unit, S1_ID) });
          },
          attack: {
            onEachHit({ battle, unit, target, attackId }) {
              if (!target || target.side !== 'enemy' || !target.alive) return;
              // 「已经灼燃损伤爆发的敌人」按命中瞬间判定（本条自己的灼燃损伤可能正是把它推到爆发的那一下）
              const bursting = !!target.findBuff('burnBurst');
              battle.dealDamage(unit, target, { amount: unit.s.atk * num(bb.burn_scale), type: 'element', element: 'burn', tags: ['skill', 'talulaS1'] });
              if (target.alive) {
                elementHit(battle, unit, target, unit.s.atk * num(bursting ? bb.element_scale_burst : bb.element_scale, 2.3), 'talulaS1', 'burn');
              }
              // 一技能的命中：目标处升起火柱，剑身上的火由渲染侧按真实剑路绘制
              // （与灼燃爆发的地面圆环区分开）。
              // bursting 是判定当时读到的值，原样带给渲染侧（不重新查询目标状态）。
              // 目前渲染层还没有按它分档——460% 那一档的火柱与普通档看起来一样。
              battle.fx('talulaS1', {
                x: target.x, y: target.y, id: target.id, sx: unit.x, sy: unit.y, src: unit.id,
                attackId: attackId ?? 0, activationId: activationIdOf(unit, S1_ID), bursting,
              });
            },
          },
        }),

        // ---- S2 炽翼掠火 ---------------------------------------------------------------------------------
        [S2_ID]: () => ({
          kind: 'duration',
          mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def, { maxTargets: Math.max(1, num(bb['attack@max_target'], 4)) }),
          attack: {
            onEachHit({ battle, unit, target, dealt, attackId }) {
              if (!target || target.side !== 'enemy' || !target.alive) return;
              if (!unit.mem.s2First) unit.mem.s2First = new Set();
              if (!unit.mem.s2First.has(target.id)) {
                unit.mem.s2First.add(target.id);
                // 对每个敌人的首次攻击直接引爆
                elementBurst(battle, unit, target, 'burn');
                // 本次技能对该目标的首爆：渲染侧据此播「一次技能只响一次」的引爆反馈（纯表现，不参与判定）
                battle.fx('talulaS2First', {
                  x: target.x, y: target.y, id: target.id, attackId: attackId ?? 0,
                  activationId: activationIdOf(unit, S2_ID), first: true,
                });
              }
              // 附带「造成伤害 40%」的灼燃损伤
              const burn = Math.max(0, Number(dealt) || 0) * num(bb.burn_from_damage);
              if (burn > 0 && target.alive) {
                battle.dealDamage(unit, target, { amount: burn, type: 'element', element: 'burn', tags: ['skill', 'talulaS2'] });
              }
              // 本次挥剑的剑气与落点绽放由单次 attack 事件绘制，不逐目标叠加旧火弧。
            },
          },
          onStart({ battle, unit }) {
            unit.mem.s2First = new Set();
            takeOff(battle, unit, 20, S2_ID);
            // 施法前摇：先抬手起飞，第一刀排在 CAST_WINDOW 之后
            unit.atkCd = Math.max(unit.atkCd, CAST_WINDOW);
            // 火翼：整段技能期间挂在她身上（时长多给一点，渲染层自己按 on/off 收尾）
            wing(battle, unit, true, 20.5, S2_ID);
          },
          onEnd({ battle, unit }) {
            unit.mem.s2First = null;
            land(battle, unit, S2_ID);
            wing(battle, unit, false, 0.3, S2_ID);
          },
        }),

        // ---- S3 恶火重燃 ---------------------------------------------------------------------------------
        [S3_ID]: () => ({
          kind: 'duration',
          mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def, { allInRange: true }),
          attack: {
            // 每次攻击（一次攻击只发一道，与命中几个目标无关）
            onHit({ battle, unit }) { launchWave(battle, unit); },
          },
          onStart({ battle, unit }) {
            unit.mem.fireUntil = Infinity;
            takeOff(battle, unit, 30, S3_ID);
            // S3 与 S2 一样会飞，必须有火翼：此前只在 S2 的 onStart/onEnd 发 wing，
            // S3 只发起飞落地，共享浮空位移不会自动生成翅膀。
            wing(battle, unit, true, 30.5, S3_ID);
            // 同 S2：抬手起飞是一段过程，第一刀不能和开技同帧
            unit.atkCd = Math.max(unit.atkCd, CAST_WINDOW);
          },
          onEnd({ battle, unit }) {
            land(battle, unit, S3_ID);
            wing(battle, unit, false, 0.3, S3_ID);
            // 恶火持续到技能结束后 5 秒
            unit.mem.fireUntil = battle.time + num(bb.fire_after, 5);
          },
        }),
      }),

      talents: [
        // ---- 天赋 1 来自乌萨斯 ---------------------------------------------------------------------------
        { install(battle, unit) {
          const atkPct = num(t0.atk);
          if (atkPct) battle.addBuff(unit, { key: 'talula:t1atk', mods: { atkPct }, persist: true, allowDead: true });
          const prob = num(t0.prob), to = num(t0.atk_to, 1.7);
          const atkScale = num(t0.atk_scale), elemScale = num(t0.element_scale);
          onHitBy(battle, unit, (c) => {
            const d = c.dmg, t = c.target;
            if (!d || !d.isAttack || d.cancel || !t || !t.alive || t.side !== 'enemy') return;
            const id = d.attackId ?? 0;
            // 「当次攻击」：一次攻击掷一次，多目标攻击的每个目标共用这一次结果
            if (unit.mem.t1AtkId !== id) { unit.mem.t1AtkId = id; unit.mem.t1Up = prob > 0 && battle.rng.chance(prob); }
            if (unit.mem.t1Up) {
              d.amount *= to;
              // 天赋 1 的强化：刀身上的火弧（原来发的是通用 'crit' 白火花，读不出「这一刀是天赋买的」）
              battle.fx('talulaEmpower', { x: unit.x, y: unit.y, id: unit.id });
            }
            battle.dealDamage(unit, t, { amount: unit.s.atk * atkScale, type: 'arts', tags: ['talent', 'talulaT1'] });
            if (t.alive) elementHit(battle, unit, t, unit.s.atk * elemScale, 'talulaT1', 'burn');
          });
          // 自身攻击范围内以及场上灼燃爆发的敌人：隐匿失效（迷彩是友方机制，敌方只有 stealth 这一面）
          whileOn(battle, unit, 0.2, () => {
            const keys = unit.rangeKeySet;
            for (const e of battle.enemies) {
              if (!e.alive || e.hidden || !e.s.flags.stealth) continue;
              if (!e.findBuff('burnBurst') && !(keys && bodyInRange(e, keys))) continue;
              // 首次破隐才发事件（刷新同一状态不重播）；只读查询，不改变施加顺序。
              const first = !e.findBuff('reveal');
              battle.applyStatus(e, 'reveal', { duration: 0.3, source: unit });
              if (first) battle.fx('talulaReveal', { x: e.x, y: e.y, id: e.id, sourceId: unit.id });
            }
          });
        } },

        // ---- 天赋 2 焚尽冻原 -----------------------------------------------------------------------------
        { install(battle, unit) {
          // 仅起飞期间对空庇护：受到空中单位的伤害 ×(1 − 30%)。
          const shield = num(t1.air_shield);
          if (shield > 0) onHitOn(battle, unit, ({ source, dmg }) => {
            if (on(unit) && unit.findBuff(LIFTOFF) && source && source.side === 'enemy' && source.isFlying) dmg.mul *= Math.max(0, 1 - shield);
          });
          // 起飞期间免疫敌方灼燃损伤；落地/离场后不拦截，元素伤害不免疫。
          battle.on('elementHit', (c) => {
            if (c.target !== unit || !c.dmg || c.dmg.element !== 'burn' || !on(unit) || !unit.findBuff(LIFTOFF)) return;
            if (c.source && c.source.side === 'enemy') c.dmg.cancel = true;
          }, { owner: unit });
          // 对焚尽状态的敌人造成的伤害提升
          const up = num(t1.dmg_up);
          if (up > 0) onHitBy(battle, unit, ({ target, dmg }) => { if (dmg && target && target.findBuff(BURNING)) dmg.mul *= 1 + up; });
          // 在场时，敌人的灼燃损伤爆发获得焚尽
          battle.on('elementBurst', (c) => {
            if (c.element !== 'burn' || !on(unit) || !c.target || c.target.side !== 'enemy' || !c.target.alive) return;
            applyBurning(battle, unit, c.target);
          }, { owner: unit });
        } },
      ],

      install(battle, unit) {
        // 起飞期间获得完整对空：攻击范围内的飞行单位全部可选，不再局限于「被自己阻挡的那几只」。
        // 做成动态属性，起飞 / 落地 / 阵亡 / 撤退都不需要额外记账 —— 只要 LIFTOFF buff 还在，canHitFly 就为真。
        const baseCanHitFly = !!unit.profile.canHitFly;
        Object.defineProperty(unit.profile, 'canHitFly', {
          configurable: true,
          enumerable: true,
          get: () => baseCanHitFly || !!unit.findBuff(LIFTOFF),
        });
        // 灼燃损伤爆发的敌人：全场范围可选（不受攻击范围限制）；飞行目标同样由上面的 canHitFly 放行。
        unit.profile.extraTargets = (b, u, profile) => b.enemies.filter((e) =>
          !!e.findBuff('burnBurst') && canTargetEnemy(u, e, profile));
        battle.on('attack', ({ attacker, targets }) => {
          if (attacker !== unit || !on(unit)) return;
          const target = targets.find((e) => e.side === 'enemy');
          if (!target) return;
          const active = unit.skill?.active;
          const kind = active && sid === S3_ID ? 'talulaRingSlash'
            : active && sid === S2_ID ? 'talulaQiSlash' : 'talulaSlash';
          const base = {
            x: unit.x, y: unit.y, id: unit.id, dir: unit.dir, interval: unit.s.interval,
            // _attackSeq 已在本帧 `++` 过，就是这一刀的攻击编号：只读，不参与判定。
            attackId: battle._attackSeq ?? 0,
            ...(kind === 'talulaRingSlash' ? { rangeKeys: unit.rangeKeys.slice() } : {}),
          };
          if (kind === 'talulaQiSlash') {
            // 剑气一条一个目标：多目标时逐条发射，渲染侧每条独立飞行（同一条不重复打同一个敌人）
            const seen = new Set();
            for (const t of targets) {
              if (!t || t.side !== 'enemy' || !t.alive || seen.has(t.id)) continue;
              seen.add(t.id);
              battle.fx(kind, { ...base, target: t.id, tx: t.x, ty: t.y });
            }
            if (!seen.size) battle.fx(kind, { ...base, target: target.id, tx: target.x, ty: target.y });
            return;
          }
          battle.fx(kind, { ...base, target: target.id, tx: target.x, ty: target.y });
        }, { owner: unit });
        // S3 的 380% 攻击力倍率（减防之前乘基本伤害）
        if (sid === S3_ID) {
          const to = num(bb.atk_to, 3.8);
          if (to !== 1) onHitBy(battle, unit, ({ dmg }) => { if (dmg.isAttack && dmg.isSkill && !dmg.cancel) dmg.amount *= to; });
        }
        // S2：攻击灼燃爆发中的敌人时伤害类型变元素伤害，攻击力提升至 135%
        if (sid === S2_ID) {
          const to = num(bb.atk_to, 1.35);
          onHitBy(battle, unit, ({ dmg, target }) => {
            if (!dmg.isAttack || !dmg.isSkill || dmg.cancel) return;
            if (!target || target.side !== 'enemy' || !target.alive || !target.findBuff('burnBurst')) return;
            dmg.type = 'elemental';
            dmg.element = 'burn';
            dmg.amount *= to;
          });
        }
        // 焰浪推进 + 恶火每秒结算（一次 tick 钩子，S3 之外是空转）
        battle.on('tick', ({ dt }) => {
          if (!on(unit)) return;
          stepWaves(battle, unit, dt);
          const tiles = unit.mem.fireTiles;
          if (!tiles || !tiles.size) return;
          if (battle.time > (unit.mem.fireUntil ?? Infinity)) { tiles.clear(); return; }
          unit.mem.fireAcc = (unit.mem.fireAcc ?? 0) + dt;
          while (unit.mem.fireAcc >= 1) { // loop-cap: one-second step
            unit.mem.fireAcc -= 1;
            fireTick(battle, unit);
          }
        }, { owner: unit });
        // 入场后延迟 9 帧再开始攻击（部署钩子晚于 _deploy 的 atkCd = 0，正好覆盖首次入场与再部署）
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit) return;
          unit.atkCd = Math.max(unit.atkCd, DEPLOY_ATTACK_DELAY);
        }, { owner: unit });
      },
    };
  },
};
