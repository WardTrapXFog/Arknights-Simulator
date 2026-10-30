import { BattleEconomy } from '/sim/battle/economy.js';

/** Preserve account semantics and the presentation source of nested callbacks. */
export function installEconomy(b, sim) {
  b._frameOwner = [];
  b._emitDepth = 0;
  for (const name of ['canSpendDp', 'naturalDpRate', 'addDp']) b[name] = BattleEconomy.prototype[name].bind(b);
  const safe = b.safe.bind(b);
  b.safe = (fn, label, owner) => {
    const count = b.errors.length, depth = b._emitDepth++;
    b._frameOwner[depth] = owner ?? null;
    try {
      const result = safe(fn, label, owner);
      if (b.errors.length > count) throw Error(`AUE ${label} ${owner?.name || owner?.defId || ''}: ${b.errors.at(-1).message}`);
      return result;
    } finally {
      b._frameOwner.length = depth;
      b._emitDepth = depth;
    }
  };
  b.c.behaviors.gainCost = (_w, _c, seat, amount, source) => b.addDp(seat, amount, source ? b.unitOf(source) : null);
  b.c.behaviors.cost = (world, _content, costLocked) => {
    for (const player of b.players) {
      if(costLocked(world,world.players[player.playerId])){player.dpNaturalRate=0;continue;}
      const rate = b.naturalDpRate(player.playerId) * sim.deck.costRate(b.w, b.c, player.playerId);
      player.dpNaturalRate = rate;
      const slowTime = player.dp < 0 && rate > 0 ? Math.min(b.dt, -player.dp / (rate * .5)) : 0;
      player.dp = Math.min(b.flags.dpMax, player.dp + rate * (b.dt - slowTime * .5));
    }
  };
}
