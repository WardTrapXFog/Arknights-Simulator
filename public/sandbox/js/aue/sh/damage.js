export { hasHp, isHpLoss, mitigate, periodicDamage } from '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/packages/content/src/compat/sh/damage.js';
import { elements } from '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/packages/sim/src/index.js';
import { siForceBurst, siBurstBeginning } from '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/packages/sim/src/elements.js';
import { ELEMENT } from '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/packages/content/src/compat/mods.js';
export { applyRedirectCut, redirectShare } from '/sim/damage.js';
export const burstLocked = target => !!target?.u && (elements.bursting(target.u) || siBurstBeginning(target.u));
export function elementBurst(battle,source,target,element) {
  const key=ELEMENT[element];
  if(!key || !target?.alive || burstLocked(target))return;
  siForceBurst(battle.w,target.u,key,source?.u ?? null);
}
