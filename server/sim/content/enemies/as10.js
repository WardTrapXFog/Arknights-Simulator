// server/sim/content/enemies/as10.js — 螺旋桨（未许之地 AS09 炙烤 / AS10 焦香）的【螺旋桨的热浪】。
//
// PRTS 原文（天赋【静态刚体】）：
//   "使半径2.0范围内（除炙烤螺旋桨/焦香螺旋桨以外）的所有我方单位和敌方单位（无视目标可选性）获得【螺旋桨的热浪】：
//    每秒检测一次，若效果来源未受沉默影响，对效果持有者造成攻击力10%的灼燃损伤（同名效果不叠加）"
//
// 三条实现要点：
//   1. 范围是半径 2.0 的圆，**我方和敌方都吃**（唯一排除的是同类螺旋桨）。
//   2. 每秒结算一次；来源被沉默时该秒不结算。
//   3. 「同名效果不叠加」：同一单位上只保留一份 ab:as10_heat 标记，后到的只刷新计时。
//
// 数据里没有这条天赋的黑板值（官方表只有 abilityList 文本），
// 因此 2.0 / 10% / 1 秒按 PRTS 原文写成本文件常量。

import { elem } from './helpers.js';

/** 热浪半径（PRTS 原文 2.0）。 */
const HEAT_RADIUS = 2.0;
/** 每秒造成的灼燃损伤 = 自身攻击力 × 该比例（PRTS 原文 10%）。 */
const HEAT_SCALE = 0.1;
/** 结算周期：每秒一次。 */
const HEAT_EVERY = 1;
/** 挂在受热单位身上的标记 key（同名不叠加）。 */
const HEAT_KEY = 'ab:as10_heat';

/** 同类螺旋桨（炙烤 AS09 / 焦香 AS10）不吃热浪，也不互相叠加。 */
const SCREWS = new Set(['enemy_10150_nsheat', 'enemy_10150_nsheat_2']);
const isScrew = (u) => !!u && SCREWS.has(u.defId ?? u.def?.id);

/**
 * 【螺旋桨的热浪】: every second, damage each other ally / enemy within 2.0 tiles for 10 % of this enemy's ATK as
 * 灼燃损伤. The buff is only a visible marker; the damage comes from this tick, so a silenced source stops damaging.
 */
export default function kitPropellerHeat(ab) {
  return [{
    sil: true,
    iv: HEAT_EVERY,
    tick(b, e) {
      if (!e.alive) return;
      const atk = e.s.atk * HEAT_SCALE;
      if (!(atk > 0)) return;
      for (const u of b.alliesInRadius(e.x, e.y, HEAT_RADIUS)) {
        if (!u.alive || u.hidden || isScrew(u)) continue;
        b.addBuff(u, { key: HEAT_KEY, duration: HEAT_EVERY + 0.35, refresh: 'replace', visible: true, source: e });
        elem(b, e, u, 'burn', atk, { ignoreSelect: true, tags: ['as10heat'] });
      }
      for (const o of b.enemiesInRadius(e.x, e.y, HEAT_RADIUS)) {
        if (o === e || !o.alive || o.hidden || isScrew(o)) continue;
        b.addBuff(o, { key: HEAT_KEY, duration: HEAT_EVERY + 0.35, refresh: 'replace', visible: true, source: e });
        elem(b, e, o, 'burn', atk, { ignoreSelect: true, tags: ['as10heat'] });
      }
    },
  }];
}