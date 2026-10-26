// public/js/render/fx/talula-state.js — 塔露拉一个角色生命期的**表现状态**。
//
// 这个模块只回答「画面该表现成什么样」，不回答「打中了谁、掉多少血」：
//   · 它不调 dealDamage / activate / 索敌，也不写战斗单位；
//   · 它接收的事件全部来自 kit 的真实判定位置（attackId / activationId / expiresAt 等），
//   · 它保存的字段只服务于渲染：S1 蓄势、技能态、攻击编号去重、恶火到期、低血与焚尽。
//
// 为什么需要它：原来的 talula.js 把施法窗口写成固定 1.2 秒、把恶火按地块各自计时、
// 用目标 ID + 0.35 秒窗口猜命中来源。这些都该由真实状态驱动，而不是渲染层自己计时。
//
// 生命周期：一场战斗一个实例，挂在 FxSystem 上（fx.talulaState）；清场时 dispose。

/** 低血阈值（比例）：与策划案「血量低于 30% 转白热」一致，仅影响画面。 */
const LOW_HP = 0.3;

/** 单个 unit 的表现记录。 */
function blankRecord(id) {
  return {
    id,
    // 技能
    skillIndex: -1,          // 0=S1 1=S2 2=S3，-1=无技能
    activationId: 0,         // 本次技能开启的编号（kit 给的）
    // S1：蓄势（pending）与最近一次点火
    palmCharging: false,
    palmSince: 0,            // 点火开始的渲染时钟
    palmUntil: 0,            // 由真实 pending 消耗或技能关闭决定，不是固定 1.2 秒
    // 攻击去重
    lastAttackId: -1,
    attackCount: 0,
    // 命中去重（同一次攻击的多段伤害只响一次主体反馈）
    seenAttack: new Set(),
    // S2/S3
    flying: false,
    wingOn: false,
    wingSkill: -1,
    wingSince: 0,
    // 地面恶火（真实地块 → 到期时刻），键为 `r:c`
    fire: new Map(),
    // 状态投影（由 field-view 每帧刷新）
    hpRatio: 1,
    burningPresent: false,
  };
}

export function createTalulaState() {
  /** @type {Map<number, object>} */
  const records = new Map();
  let clock = 0;

  const rec = (id) => {
    let r = records.get(id);
    if (!r) { r = blankRecord(id); records.set(id, r); }
    return r;
  };

  return {
    /** 渲染时钟（秒）。只由 update 推进，所有表现时间都从这里取。 */
    get clock() { return clock; },

    /** 每个渲染帧调用一次，推进时钟。 */
    update(dt) { clock += dt * 1000; },

    get(id) { return records.get(id) || null; },

    /** 清理一个单位（退场、阵亡、换图）。 */
    drop(id) {
      const r = records.get(id);
      if (r) { r.seenAttack.clear(); r.fire.clear(); }
      records.delete(id);
    },

    /** 清场。 */
    dispose() {
      for (const r of records.values()) { r.seenAttack.clear(); r.fire.clear(); }
      records.clear();
      clock = 0;
    },

    /**
     * 技能开启：记录 activationId 与技能槽位。
     * 由 talulaIgnite / talulaTakeoff / talulaWing 任一事件带 activationId 首次出现时调用。
     */
    beginActivation(id, { activationId = 0, skillIndex = -1 } = {}) {
      const r = rec(id);
      if (activationId && activationId !== r.activationId) {
        r.activationId = activationId;
        r.skillIndex = skillIndex;
        r.seenAttack.clear();
      }
      return r;
    },

    /** S1 点火：进入蓄势。结束时刻由 armPending/endActivation 或真实攻击决定。 */
    beginPalm(id) {
      const r = rec(id);
      r.palmCharging = true;
      r.palmSince = clock;
      r.palmUntil = Infinity;     // 等真实 pending 消耗，不再写死 1.2 秒
      return r;
    },

    /** S1 的蓄势被真实攻击消耗：这一次攻击播施法片段。 */
    consumePalm(id) {
      const r = records.get(id);
      if (!r || !r.palmCharging) return false;
      r.palmCharging = false;
      r.palmUntil = clock;
      return true;
    },

    /** 技能结束：清掉蓄势与翼。 */
    endActivation(id) {
      const r = records.get(id);
      if (!r) return;
      r.palmCharging = false;
      r.palmUntil = clock;
      r.wingOn = false;
    },

    /** 一次攻击的表现编号；同一 attackId 只认第一次，返回 true 表示这是新的一刀。 */
    takeAttack(id, attackId) {
      const r = rec(id);
      if (!Number.isFinite(attackId) || attackId <= 0) { r.attackCount += 1; return true; }
      if (r.lastAttackId === attackId) return false;
      r.lastAttackId = attackId;
      r.attackCount += 1;
      return true;
    },

    /** 起飞/落地。真实飞行状态以 LIFTOFF buff 为准，这里只镜像。 */
    setFlying(id, on) { rec(id).flying = !!on; },

    /** 火翼开关。 */
    setWing(id, on, skillIndex = -1) {
      const r = rec(id);
      r.wingOn = !!on;
      r.wingSkill = on ? skillIndex : -1;
      r.wingSince = clock;
    },

    /** 记录一块真实恶火及其公共到期时刻。幂等：同一格重复只更新到期。 */
    addFire(id, r0, c0, expiresAt) {
      const r = rec(id);
      const key = `${Math.round(r0)}:${Math.round(c0)}`;
      const prev = r.fire.get(key);
      if (prev == null || expiresAt > prev) r.fire.set(key, expiresAt);
    },

    /** 清掉已到期的恶火，返回仍在燃的格子（渲染侧按它画，不各自计时）。 */
    liveFire(id) {
      const r = records.get(id);
      if (!r) return [];
      const out = [];
      for (const [key, at] of r.fire) {
        if (at <= clock) r.fire.delete(key);
        else out.push(key);
      }
      return out;
    },

    /** 每帧从 field-view 刷新的只读状态投影。 */
    project(id, { hpRatio, burning, skillIndex } = {}) {
      const r = rec(id);
      if (Number.isFinite(hpRatio)) r.hpRatio = hpRatio;
      if (burning != null) r.burningPresent = !!burning;
      if (Number.isFinite(skillIndex)) r.skillIndex = skillIndex;
      return r;
    },

    /** 低血（画面转白热）。 */
    isLowHp(id) {
      const r = records.get(id);
      return !!r && r.hpRatio > 0 && r.hpRatio < LOW_HP;
    },
  };
}
