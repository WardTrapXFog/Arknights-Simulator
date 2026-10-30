import { ensureInstalled, KITS, STATS_ONLY } from '/sim/content/enemies.js';
import { ROGUE6_KITS, ROGUE6_STATS_ONLY } from '/sim/content/enemies/rogue6.js';
import { BOSS_KITS, install as installBosses } from '/sim/content/bosses.js';
const custom=new Set([...Object.keys(ROGUE6_KITS),...Object.keys(ROGUE6_STATS_ONLY),'enemy_10150_nsheat','enemy_10150_nsheat_2']);
export function usesLocalEnemy(raw,incomplete=false) {
  const key=raw.effectRef ?? raw.key;
  return custom.has(key) || (incomplete && (Object.hasOwn(KITS,key) || Object.hasOwn(STATS_ONLY,key) || Object.hasOwn(BOSS_KITS,key)));
}
export function installLocalEnemies(b) {
  // Native enemies never receive a second set of local ability handlers.
  ensureInstalled(b,{accept:enemy=>!!enemy.mem.siLocalEnemy});
  installBosses(b,{accept:enemy=>!!enemy.mem.siLocalEnemy});
}
