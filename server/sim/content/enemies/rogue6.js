// server/sim/content/enemies/rogue6.js — 集成战略「黑流树海」(rogue_6) 八个敌人的 kits 分片。
//
// 来源关卡：ISW-NO 圆石技艺（ro6_n_3_7 / ro6_e_3_7）。数值在 content/enemies/*.json（tools/build-content.mjs 写入
// data/enemies.json），能力在本文件。机制依据全部取 PRTS 敌人页「天赋与能力」栏（2026-10-25 读取），不读官方短描述。
//
//   SI8 游击队传令兵组长 · 在场时强化在场其他敌人的攻击力 +10%、防御力 +100（talentBb strength.atk / strength.def）。
//   TO17 炫目刀技厨师 · 半径 2.5 内其他「地面」敌人的攻击速度 +50、法术抗性 +25（AuraAttributeUp.*）。
//   TO02 入戏太深的孩童 · 初始模式防御力 +500；浮空解除 / 退出失衡 / 被“美食的奴隶”砸中时，永久解除该增益。
//   TO15 “美食的奴隶” · 初始模式防御力 +1200、法术抗性 +40、移动速度 200%；浮空解除或退出失衡时永久解除增益，
//       对半径 1.75 内其他敌人造成 1000 真实伤害，并砸中同半径内的「入戏太深的孩童」；此后连续 5 秒未浮空且未失衡，
//       再过 1 秒回到初始模式。瘫痪期间自缚、不可阻挡。
//   BF0 空值体 · 出场召唤一名【伪装体】（关卡覆盖为 enemy_10229_agactr_2），自身无敌/不可阻挡/孤立并消失；
//       伪装体一受伤即退场，本体传送到它的位置、继承剩余路径、现身。
//   BF2 聆风猎手 · 未被阻挡且无闪现冷却时，受到伤害 → 闪现到伤害来源周围最近的可行地块，并进入 30 秒闪现冷却。
//   BF4 猎犬proto · 仅攻击自己阻挡的单位；普通攻击附加攻击力 30% 的狂躁损伤；【持续撕咬】15/40：传送到目标格中心
//       锁定 10 秒，每秒 100% 攻击力法术伤害 + 30% 攻击力狂躁损伤，结束时传送回原位。
//   TO08 “大披风” · 飞行单位，进入目标点不扣生命（数据行为）；本关没有 <浮空信件>，夺取分支不触发 → STATS_ONLY。
//
// 已知近似：
//   * 猎犬proto 撕咬的「物理与法术命中率降至 20%」用一个与撕咬同寿的命中率减益落地（引擎按当前快照取值）。
//   * “美食的奴隶”瘫瘴后「无法被阻挡」用 unblockable 落地，回到初始模式时移除。
//
// 狂躁损伤是引擎的第六个元素（constants.js ELEMENT.angers，PRTS 元素 id 5 `ANGER`）：累计满 1000 → 15 秒爆发冷却，
// 期间攻击速度 +50、每秒受一次随自身出手次数增长的无来源真实伤害（100 起、每次 +50、上限 600）。客户端会画出狂躁槽。

import { T, hurt, auraBuff, spawnChildren, targetsNear } from './helpers.js';
import { skill } from './archetypes.js';
import { sortAllyTargets } from '../../targeting.js';

/** 入戏太深的孩童 初始模式防御力。PRTS 写 +500；数据 talentBb DefUp.def 是 600。两者冲突，按 PRTS 取 500。 */
const PORC_DEF = 500;
/** 传令兵组长光环的刷新间隔（buff 时长 = iv + 0.1）。 */
const SOTIDP_AURA_IV = 0.25;
/** “美食的奴隶”回到初始模式：连续 5 秒安分 → 再过 1 秒。 */
const AGBALL_STEADY = 5, AGBALL_DELAY = 1;
/** 聆风猎手【追猎】的闪现冷却。 */
const SHKRBT_BLINK_CD = 30;
/** 猎犬proto【持续撕咬】持续时间与结算间隔：数据 Jump.blackboard 的 duration 10 与 PRTS「每秒」结算。 */
const SHSDGO_BITE_DURATION = 10, SHSDGO_BITE_INTERVAL = 1;
/** 命中率减益（最终降至 20%）的持续时长：PRTS「持续1.5秒…该减益不叠加」，数据 attack@hit_interval 1.5。 */
const SHSDGO_HITDOWN = 1.5;
/** 撕咬的可触发半径：数据 rangeRadius（猎犬proto 2.0，PRTS 攻击半径同值）；没有半径的就只咬贴身的。 */
const biteRadius = (e) => (e.base.rangeRadius > 0 ? e.base.rangeRadius : 1);
/**
 * 记一次狂躁损伤：走引擎的元素槽（满 1000 自动爆发为 ELEMENT.angers 的效果）。狂躁只对我方角色类单位有意义，
 * 其余目标按官方「其他单位：无效果」直接丢弃，不浪费结算。
 */
function rampageHit(b, src, tgt, amount) {
  if (!(amount > 0) || !tgt || !tgt.alive || tgt.side !== 'ally' || !tgt.elem) return 0;
  return b.dealDamage(src, tgt, { element: 'angers', amount, mul: 1, type: 'element' });
}

// ---------------------------------------------------------------------------------------------------------------
// kits

/** PRTS：传令兵强化全场敌人（包括自身），不同来源分别提供增益。 */
function kitSotidp(ab) {
  const atk = T(ab, 'strength.atk') ?? 0, def = T(ab, 'strength.def') ?? 0;
  if (!atk && !def) return [];
  return [{
    iv: SOTIDP_AURA_IV,
    spawn(b, e, a) { a.tick(b, e); },
    tick(b, e) {
      for (const o of b.enemies) {
        if (!o.alive) continue;
        b.addBuff(o, { key: `ab:sotidp:${e.id}`, source: e, duration: SOTIDP_AURA_IV + .1,
          refresh: 'replace', mods: { atkPct: atk, defFlat: def } });
      }
    },
    death(_c, b, e) { for (const o of b.enemies) b.removeBuff(o, `ab:sotidp:${e.id}`); },
  }];
}

/** PRTS：半径内所有地面敌人生效，包括自身；多名厨师的增益可叠加。 */
function kitAgactr(ab) {
  const r = T(ab, 'AuraAttributeUp.range_radius') ?? 2.5;
  const aspd = T(ab, 'AuraAttributeUp.attack_speed') ?? 0;
  const resFlat = T(ab, 'AuraAttributeUp.magic_resistance') ?? 0;
  const defFlat = T(ab, 'AuraAttributeUp.def') ?? 0;
  if (!aspd && !resFlat && !defFlat) return [];
  return [{
    iv: SOTIDP_AURA_IV,
    spawn(b, e, a) { a.tick(b, e); },
    tick(b, e) {
      for (const o of b.enemiesInRadius(e.x, e.y, r)) {
        if (!o.alive || o.motion === 'FLY') continue;
        b.addBuff(o, { key: `ab:agactr:${e.id}`, source: e, duration: SOTIDP_AURA_IV + .1,
          refresh: 'replace', mods: { aspd, resFlat, defFlat } });
      }
    },
    death(_c, b, e) { for (const o of b.enemies) b.removeBuff(o, `ab:agactr:${e.id}`); },
  }];
}

/**
 * 入戏太深的孩童：初始模式防御力 +500，面具掉了永久解除。
 * 触发：浮空解除、退出失衡、被“美食的奴隶”砸中（由 agball 的 kit 调用 breakMask）。
 * 浮空解除与退出失衡都不能靠 statusApplied（那是施加时，不是解除时），所以按帧比较上一帧的状态做边沿检测。
 */
function kitAgporc() {
  return [{
    spawn(b, e, a) {
      a.broken = false;
      a.lifted = !!e.s.flags.levitate;
      a.unbalanced = b.time < (e.unbalanceUntil ?? -1) - 1e-9;
      if (PORC_DEF) b.addBuff(e, { key: 'ab:agporc:def', mods: { defFlat: PORC_DEF }, persist: true, visible: true });
    },
    breakMask(b, e, a) {
      if (a.broken) return;
      a.broken = true;
      b.removeBuff(e, 'ab:agporc:def');
      b.fx('expose', { x: e.x, y: e.y, id: e.id });
    },
    tick(b, e, a) {
      const lifted = !!e.s.flags.levitate;
      const unbal = b.time < (e.unbalanceUntil ?? -1) - 1e-9;
      const leftLevitate = a.lifted && !lifted;
      const leftUnbalance = a.unbalanced && !unbal;
      a.lifted = lifted; a.unbalanced = unbal;
      if (leftLevitate || leftUnbalance) this.breakMask(b, e, a);
    },
  }];
}

/** “美食的奴隶”：初始模式三项增益；浮空解除 / 退出失衡 → 摔一跤；连续安分 5 秒后 1 秒回到初始模式。 */
function kitAgball(ab) {
  const def = T(ab, 'DefUp.def') ?? 0;
  const res = T(ab, 'DefUp.magic_resistance') ?? 0;
  const spd = T(ab, 'DefUp.move_speed') ?? 2;
  const r = T(ab, 'FallDownDamage.range_radius') ?? 1.75;
  const dmg = T(ab, 'FallDownDamage.pure_value') ?? 0;
  const up = () => ({
    key: 'ab:agball:up', persist: true, visible: true,
    mods: { defFlat: def, resFlat: res, ...(spd > 0 ? { moveMul: spd } : {}) },
  });
  return [{
    spawn(b, e, a) {
      a.down = false; a.steady = 0;
      a.lifted = !!e.s.flags.levitate;
      a.unbalanced = b.time < (e.unbalanceUntil ?? -1) - 1e-9;
      b.addBuff(e, up());
    },
    fall(b, e, a) {
      if (a.down) return;
      a.down = true; a.steady = 0;
      b.removeBuff(e, 'ab:agball:up');
      b.addBuff(e, { key: 'ab:agball:down', persist: true, visible: true, flags: { selfBound: true, noMove: true, unblockable: true } });
      b.fx('explode', { x: e.x, y: e.y, r, kind: 'fallDown', id: e.id });
      for (const o of b.enemiesInRadius(e.x, e.y, r)) {
        if (o === e || !o.alive) continue;
        hurt(b, e, o, dmg, 'true', { ignoreSelect: true, tags: ['fallDown'] });
        // 砸中「入戏太深的孩童」：同一半径内的碰撞判定，直接扳掉面具
        const breakMask = o.mem.ab && o.mem.ab.list.map((x) => x.breakMask).find(Boolean);
        if (breakMask) breakMask.call(o.mem.ab.list.find((x) => x.breakMask), b, o, o.mem.ab.list.find((x) => x.breakMask));
      }
    },
    tick(b, e, a, dt) {
      const lifted = !!e.s.flags.levitate;
      const unbal = b.time < (e.unbalanceUntil ?? -1) - 1e-9;
      const leftLevitate = a.lifted && !lifted;
      const leftUnbalance = a.unbalanced && !unbal;
      a.lifted = lifted; a.unbalanced = unbal;
      if (!a.down) {
        if (leftLevitate || leftUnbalance) this.fall(b, e, a);
        return;
      }
      // 瘫痪中：只有「连续 5 秒未浮空且未失衡」才计时；有过新的浮空 / 失衡就清零
      a.steady = lifted || unbal ? 0 : a.steady + dt;
      if (a.steady >= AGBALL_STEADY + AGBALL_DELAY) {
        a.down = false;
        b.removeBuff(e, 'ab:agball:down');
        b.addBuff(e, up());
      }
    },
  }];
}

/** 空值体：本体无敌/不可阻挡/孤立并消失，用一名【伪装体】占位；伪装体一受伤，本体接管它的位置与路径。 */
function kitShdopl(ab) {
  const disguise = T(ab, 'summon.enemy_key') ?? null;
  return [{
    spawn(b, e, a) {
      a.shown = false; a.fake = null;
      if (!disguise || !b.data.getEnemy(disguise)) return;
      const [c] = spawnChildren(b, e, disguise, 1, { countInTotal: false, tag: 'decoy' });
      if (!c) return;
      a.fake = c;
      c.mem.decoyOf = e;
      b.addBuff(e, {
        key: 'ab:shdopl:hide', persist: true, allowDead: true,
        flags: { invulnerable: true, untargetable: true, unblockable: true, isolated: true, noBlock: true, noHeal: true },
      });
      b._setHidden(e, true);
    },
    reveal(b, e, a, from) {
      if (a.shown) return;
      a.shown = true;
      b.removeBuff(e, 'ab:shdopl:hide');
      b._setHidden(e, false);
      if (from) {
        e.x = from.x; e.y = from.y;
        if (from.route) e.route = from.route;
      }
    },
    tick(b, e, a) {
      const f = a.fake;
      if (a.shown || !f || !e.alive) return;
      if (!f.alive || f.hp < f.s.maxHp - 1e-9) {
        this.reveal(b, e, a, f);
        if (f.alive) b.kill(f, null);
      }
    },
    // 兜底：伪装状态下本体不可选，真被直接选中就当场现身
    hitIn(c, b, e, a) { this.reveal(b, e, a, null); },
  }];
}

/** 聆风猎手：【追猎】——没被阻挡、没有闪现冷却时，挨打就闪到伤害来源周围最近的可行地块。 */
function kitShkrbt() {
  return [{
    spawn(b, e, a) { a.blinkAt = -Infinity; },
    hitIn(c, b, e, a) {
      const s = c.source;
      if (!s || s.side !== 'ally' || !s.alive) return;
      if (e.blockedBy || b.time < a.blinkAt) return;
      const sr = Math.round(s.y), sc = Math.round(s.x);
      // 目标周围（含本格）最近的可通行地块，行优先平手
      let best = null, bestD = Infinity;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = sr + dr, cc = sc + dc;
          if (!b.grid.walkable(r, cc)) continue;
          const d = Math.hypot(r - e.y, cc - e.x);
          if (d < bestD - 1e-9) { bestD = d; best = [r, cc]; }
        }
      }
      if (!best) return;
      a.blinkAt = b.time + SHKRBT_BLINK_CD;
      const from = { x: e.x, y: e.y };
      e.x = best[1]; e.y = best[0];
      b.fx('blink', { id: e.id, fx: from.x, fy: from.y, x: e.x, y: e.y });
    },
  }];
}

/** 猎犬proto：普攻附带 30% 攻击力狂躁损伤 +【持续撕咬】。 */
function kitShsdgo(ab) {
  const epRatio = T(ab, 'epAttack.attack@ep_damage_ratio') ?? .3;
  const candidates = (b, e) => sortAllyTargets(e, targetsNear(b, e, biteRadius(e)).filter((u) => !u.isFlying));
  return [{
    spawn(_b, e) { e.profile.melee = true; },
    dealt(c, b, e) {
      if (epRatio > 0 && c.dmg?.isAttack && c.target?.side === 'ally') rampageHit(b, e, c.target, e.s.atk * epRatio);
    },
  }, skill(ab.sk.Jump, (b, e) => {
    const target = candidates(b, e)[0];
    if (!target) return false;
    const duration = ab.sk.Jump?.bb?.duration ?? SHSDGO_BITE_DURATION;
    const home = { x: Math.round(e.x), y: Math.round(e.y) }, deployment = target.deploySeq;
    const oldNoAttack = e.profile.noAttack, oldImmune = new Set(ab.immune || []);
    const immunities = ['stun', 'freeze', 'disarm', 'cold', 'fear', 'tremble', 'attract', 'sleep'];
    ab.biting = true; e.profile.noAttack = true;
    ab.immune = new Set([...oldImmune, ...immunities]);
    b._unblock(e); e.swing = false; e.swingTargets = null;
    b.addBuff(e, { key: 'ab:shsdgo:attached', source: e, duration,
      flags: { selfBound: true, noMove: true, unblockable: true, noDisplace: true }, visible: true });
    const from = { x: e.x, y: e.y };
    e.x = Math.round(target.x); e.y = Math.round(target.y);
    b.fx('blink', { id: e.id, fx: from.x, fy: from.y, x: e.x, y: e.y });
    let ended = false, timer = null;
    const finish = () => {
      if (ended) return;
      ended = true; timer?.cancel(); ab.biting = false;
      e.profile.noAttack = oldNoAttack;
      for (const key of immunities) if (!oldImmune.has(key)) ab.immune.delete(key);
      b.removeBuff(e, 'ab:shsdgo:attached');
      if (e.alive) {
        const previous = { x: e.x, y: e.y };
        e.x = home.x; e.y = home.y;
        b.fx('blink', { id: e.id, fx: previous.x, fy: previous.y, x: e.x, y: e.y });
      }
    };
    // The periodic attack survives interruption of the casting skill (PRTS), including loss of the source.
    timer = b.every(SHSDGO_BITE_INTERVAL, () => {
      if (!target.alive || !target.deployed || target.deploySeq !== deployment) { finish(); return; }
      e.stats.attacks++; e.lastAttackAt = b.time;
      const attackId = ++b._attackSeq;
      if (e.alive) b._ev(['atk', e.id, target.id, 'none']);
      b.dealDamage(e, target, { amount: e.s.atk, type: 'arts', isAttack: true, isSkill: false, attackId, tags: ['bite'] });
      if (target.alive) b.addBuff(target, { key: 'ab:shsdgo:hitdown', refresh: 'replace', duration: SHSDGO_HITDOWN,
        source: e, visible: true, mods: { hitRatePhys: -.8, hitRateArts: -.8 } });
      if (b.hasHook('attack')) b.emit('attack', { attacker: e, targets: [target], targetDeployments: new Map([[target, deployment]]), isSkill: false });
    });
    b.after(duration, finish);
    b.fx('telegraph', { x: target.x, y: target.y, r: .6, dur: duration, kind: 'bite', id: target.id });
    return true;
  }, { cd: ab.sk.Jump?.cd ?? 40, icd: ab.sk.Jump?.icd ?? 15,
    cond: (b, e) => !ab.biting && candidates(b, e).length > 0 })];
}

// ---------------------------------------------------------------------------------------------------------------
// KITS 分片

export const ROGUE6_KITS = Object.freeze({
  enemy_1080_sotidp: kitSotidp,
  enemy_1080_sotidp_2: kitSotidp,  // 游击队传令兵组长 · 全场攻击/防御光环
  enemy_10229_agactr_2: kitAgactr, // 炫目刀技厨师 · 周围地面敌人攻速/法抗光环
  enemy_10221_agporc_2: kitAgporc, // 入戏太深的孩童 · 防御 +500，面具碎了永久解除
  enemy_10228_agball_2: kitAgball, // “美食的奴隶” · 摔跤瘫痪、真实伤害、回到初始模式
  enemy_2133_shdopl: kitShdopl,    // 空值体 · 伪装体替身
  enemy_2135_shkrbt: kitShkrbt,    // 聆风猎手 · 挨打闪现到伤害来源身边
  enemy_2137_shsdgo: kitShsdgo,    // 猎犬proto · 狂躁损伤 + 持续撕咬
});

export const ROGUE6_STATS_ONLY = Object.freeze({
  // 飞行、进入目标点不扣生命都是数据行为；<浮空信件> 本关不存在，夺取分支无处触发。
  enemy_10224_agmess_2: '飞行与不扣生命是数据行为；本关没有 <浮空信件> 可夺取',
});
