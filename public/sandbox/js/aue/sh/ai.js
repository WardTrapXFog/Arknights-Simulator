export { effectiveProfile, acquireTargets } from '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/packages/content/src/compat/sh/ai.js';
export { chainHealNext, performAttack } from '/sim/ai.js';
export const attackCountdown = (value, dt) => Math.max(0, Math.round(value * 30) - Math.round(dt * 30)) / 30;
