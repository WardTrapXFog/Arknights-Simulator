import { talulaEffects } from './talula.js';
import { vinaEffects } from './vina.js';
import { makotoEffects } from './makoto.js';
import { wangEffects } from './wang.js';
import { talulaSwingPlan, sampleTalulaMotion } from './talula-animation.js';
import { setSwingPlanner, setCastHold } from '../spine.js';
import { setMotionSampler } from '../units.js';

// One registration per custom effect module; each module owns its state and lifecycle.
export const CUSTOM_FX = Object.freeze([talulaEffects, vinaEffects, makotoEffects, wangEffects]);
export const CUSTOM_FX_KINDS = Object.freeze(Object.assign({}, ...CUSTOM_FX.map((module) => module.kinds)));
export const CUSTOM_FX_HANDLERS = Object.freeze(Object.assign({}, ...CUSTOM_FX.map((module) => module.handlers)));

// 模块自己的动画节奏与位移动画接进渲染核：渲染核只留钩子，不认识任何具体干员。
// 计划返回 null（未配置节奏表）就自动退回内置三段 timeScale。
setSwingPlanner(
  (actor, clip, duration, hit, interval) =>
    talulaSwingPlan(actor?.entry, clip, duration, hit, interval, actor?.skillIndex, actor?.skillOn),
);
// S1 的 skill off 紧随真实命中；保留已确认的 Attack_2 收势和剑路。
// wound=true 仍是预起手，不能让保持判据拦住随后真正的 attack()。
setCastHold((actor) => actor?.entry?.anims?.swing?.talula
  && actor.skillIndex === 0 && actor.mode === 'attack' && !actor.wound
  && actor.current === actor.roles.attack?.loop ? actor.attackUntil : 0);
setMotionSampler((view, dt) => sampleTalulaMotion(view, dt));
