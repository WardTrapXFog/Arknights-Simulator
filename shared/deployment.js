import { meleeOnHighGround } from './highGround.js';

/** One terrain rule for preview, hand validation and actual placement. */
export function canDeployOn(grid, def, row, col) {
  if (!grid || !def) return false;
  const position = def.position;
  const melee = grid.canStand(row, col, { ranged: false });
  const ranged = grid.canStand(row, col, { ranged: true });
  if (position === 'ALL') return melee || ranged;
  if (position === 'RANGED') return grid.tile(row, col).build !== 'MELEE' && ranged;
  const high = meleeOnHighGround(def.raw ?? def)
    || /可以放置于远程位|可以部署在远程位/.test(def.raw?.trait?.moduleDesc || '');
  return melee || (high && ranged);
}
