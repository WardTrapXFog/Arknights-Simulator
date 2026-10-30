import { COLS } from '../constants.js';
import { canDeployOn } from '../../../shared/deployment.js';

const live = (u) => u?.alive && u.deployed && !u.removed;
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const UNIQUE = /kalts_mon3tr|phatom_twin|bgsnow_subbow|mlyss_wtrman|jesca2_jckshd|slent2_protrb|monstr_prosts/;
const OCCUPIES = /kalts_mon3tr|phatom_twin|bgsnow_subbow|mgllan_drone|ling_soul|radian_tower/;
const TACTICAL = /vigil_wolf|mlyss_wtrman|closur_ourbase/;
const TRAPS = /doroth_recttp|wang_stone/;
const EYE = /svash2_eagle/;
const ANCHOR = /kalts2_mtship/;
const COORD = /angel2_target/;
const REUSABLE = /skadi2_dedant|ray_sndbst|weedy_cannon/;
const ORDER = ['WARRIOR', 'SNIPER', 'TANK', 'MEDIC', 'SUPPORT', 'CASTER', 'SPECIAL', 'TOKEN', 'DEVICE', 'PIONEER'];
// Player-observed deployment contracts; never infer this from profession or attack range.
const NO_FACING = new Set([
  'token_10064_wang_stone1', 'token_10025_doroth_recttp', 'token_10031_swire2_gdtrap',
  'token_10034_ray_sndbst', 'token_10066_closur_ourbase', 'token_10050_monstr_prosts',
  'token_10017_skadi2_dedant', 'token_10057_svash2_eagle1', 'token_10057_svash2_eagle2', 'token_10057_svash2_eagle3',
  'token_10054_phatm2_encdool', 'token_10004_otter_motter', 'token_10001_deepcl_tentac',
  'token_10005_mgllan_drone1', 'token_10005_mgllan_drone2', 'token_10032_jesca2_jckshd', 'token_10030_mlyss_wtrman',
  'token_10000_silent_healrb', 'token_10006_vodfox_doll', 'token_10003_cgbird_bird',
  'token_10029_slent2_protrb', 'token_10028_vigil_wolf',
]);
const DIRECTIONAL = new Set([
  'token_10002_kalts_mon3tr', 'token_10007_phatom_twin', 'token_10009_weedy_cannon',
  'token_10041_cathy_catsld', 'token_10056_angel2_target', 'token_10068_kalts2_mtship',
  'token_10020_ling_soul1', 'token_10020_ling_soul2', 'token_10020_ling_soul3',
  'token_10005_mgllan_drone3', 'token_10026_bgsnow_subbow',
  'token_10027_ironmn_pile1', 'token_10027_ironmn_pile2', 'token_10027_ironmn_pile3',
  'token_10051_radian_tower1', 'token_10052_radian_tower2', 'token_10053_radian_tower3',
  'token_10059_nasti_nstdef', 'token_10060_nasti_nstchr', 'token_10061_nasti_nstbld',
  'token_10069_mcnist_mcgraf', 'token_10070_aphris_pc', 'token_10010_folivo_car',
]);

/** 本体手动部署规则。PRTS：待部署区、部署费用、分支特性信息及各召唤物条目的备注。 */
export function installDeploymentHand(battle) {
  const strict = !!battle.flags.siLevel;
  const records = new Map(), byUnit = new Map(), owners = new Set();
  let uid = Math.max(0, ...battle.allyUnits.map((u) => number(u.uid))), sequence = 0;
  const policy = (id) => EYE.test(id) ? 'eye' : COORD.test(id) ? 'coordinate' : ANCHOR.test(id) ? 'skill'
    : /aphris_pc/.test(id) ? 'queue' : TACTICAL.test(id) ? 'tactical' : UNIQUE.test(id) ? 'unique' : REUSABLE.test(id) ? 'reusable' : 'stock';

  function stock(record) {
    const m = record.owner?.mem;
    if (m?.summonDeck) return m.summonDeck.held;
    if (m?.wang) return m.wang.stock;
    if (m?.craftsman) return m.craftsman.stock;
    if (m?.phantomStock != null) return m.phantomStock;
    if (record.owner?.trait.doroth) return record.owner.trait.doroth.stock;
    if (m?.summonStock && record.tokenId in m.summonStock) return m.summonStock[record.tokenId];
    return record.stock;
  }
  function setStock(record, value) {
    const m = record.owner?.mem, n = Math.max(0, value);
    if (m?.summonDeck) m.summonDeck.held = Math.min(m.summonDeck.cap, n);
    else if (m?.wang) m.wang.stock = Math.min(record.cap, n);
    else if (m?.craftsman) m.craftsman.stock = Math.min(m.craftsman.cap, n);
    else if (m?.phantomStock != null) m.phantomStock = Math.min(record.cap, n);
    else if (record.owner?.trait.doroth) record.owner.trait.doroth.stock = Math.min(record.owner.trait.doroth.limit, n);
    else if (m?.summonStock && record.tokenId in m.summonStock) m.summonStock[record.tokenId] = Math.min(record.cap, n);
    else record.stock = Math.min(record.cap, n);
  }
  function addOperator(unit) {
    if (byUnit.has(unit)) return byUnit.get(unit);
    const r = { id: unit.defId, unit, units: [unit], owner: null, kind: 'op', order: sequence++, deployments: 0, costDelta: 0, costEffects: new Map(), pending: null };
    records.set(r.id, r); byUnit.set(unit, r); unit.respawnAt = 0;
    return r;
  }
  function prepare(owner) {
    if (owners.has(owner)) return;
    uid = Math.max(uid, number(owner.uid), number(battle.__uid));
    owners.add(owner);
    for (const tokenId of owner.def.tokens || []) {
      const def = battle.data.getToken(tokenId, owner.defId, owner.def.loadout);
      if (!def || (!def.raw.placeable && !EYE.test(tokenId) && !COORD.test(tokenId))) continue;
      const selected = owner.def.skill?.overrideTokenKey;
      const src = def.sources || [];
      if (!src.includes('talent') && !src.includes('skill') && selected !== tokenId) continue;
      if (selected && tokenId !== selected && !src.includes('talent')) continue;
      const raw = def.raw.variants?.[owner.def.tokenOwner || owner.defId] || Object.values(def.raw.variants || {})[0] || def.raw;
      const mod = raw.byModule?.[owner.def.loadout?.moduleId];
      const stats = { ...raw.stats, ...mod?.stats };
      const limit = Math.max(1, number(stats.deployLimit, number(def.raw.deployLimit, 1)));
      const cap = Math.max(limit, number(stats.deckStack), number(def.count, 1));
      const kind = policy(tokenId);
      const r = { id: `token:${owner.uid}:${tokenId}`, kind: 'token', tokenId, owner, def, units: [], order: sequence++,
        policy: kind, limit, cap, stock: 0, readyAt: 0, queue: [], charge: Math.max(1, number(def.count, 1)),
        skillOnly: !src.includes('talent') && (src.includes('skill') || ANCHOR.test(tokenId)), costEffects: new Map() };
      records.set(r.id, r);
      for (let i = 0; i < Math.max(limit, cap) + (kind === 'queue' ? 2 : 0); i++) {
        const t = battle._makeAlly(owner.player, def, 'token', 0, 0, { uid: ++uid, ownerUnit: owner, dir: owner.dir });
        t.deferDeploy = true; t.mem.handCard = r.id; t.mem.docked = r.skillOnly;
        r.units.push(t); byUnit.set(t, r);
      }
      battle.__uid = Math.max(number(battle.__uid), uid);
    }
  }
  const deployedCount = () => battle.allyUnits.reduce((n, u) => n + (live(u) ? occupation(u) : 0), 0);
  function occupation(unit) {
    if (unit.mem?.ignoreDeployLimit) return 0;
    if (unit.kind === 'op') return unit.def.skill?.id === 'skchr_nearl2_2' || /不受部署数量限制/.test(unit.def.trait) ? 0 : 1;
    if (unit.ownerUnit && /首个召唤物.*不消耗部署位/.test(unit.ownerUnit.def.raw.trait?.moduleDesc || '')) {
      const first = battle.allyUnits.filter((t) => t.ownerUnit === unit.ownerUnit && live(t)).sort((a, b) => a.deploySeq - b.deploySeq)[0];
      if (!first || first === unit) return 0;
    }
    if (/ling_soul3a/.test(unit.defId)) return 2;
    return unit.kind === 'token' && OCCUPIES.test(unit.defId) ? 1 : 0;
  }
  function cost(record) {
    if (!record) return 0;
    if (record.kind === 'op' && live(battle.hand.copyTarget) && battle.hand.copyTarget.skill?.active) return 0;
    if (record.pending) return 0;
    const u = record.unit || record.units[0];
    if (record.policy === 'tactical') return 0;
    if (record.policy === 'eye') return number(u.base.cost);
    const multiplier = strict && record.kind === 'op' ? Math.min(2, 1 + record.deployments * .5) : 1;
    let delta = number(record.costDelta);
    for (const e of record.costEffects.values()) delta += e.delta;
    const ctx = { unit: u, delta: 0, baseDelta: 0 };
    if (record.kind === 'op') battle.emit('handCost', ctx);
    delta += ctx.delta;
    return Math.max(0, Math.floor((u.base.cost + ctx.baseDelta) * multiplier + delta));
  }
  function status(record) {
    if (!record) return '没有这张部署卡';
    if (!strict) return record.owner && !live(record.owner) ? '所属干员未在场上' : null;
    const u = record.unit;
    if (record.kind === 'op') {
      if (live(u)) return '干员已在场上';
      if (u.removed) return '干员已离开本次作战';
      if (live(battle.hand.copyTarget) && battle.hand.copyTarget.skill?.active) return null;
      if (record.pending) return live(record.pending.owner) ? null : '等待思衡托返回战场';
      if (u.respawnAt > battle.time + 1e-9) return `再部署 ${Math.ceil(u.respawnAt - battle.time)} 秒`;
    } else {
      if (!live(record.owner)) return '所属干员未在场上';
      if (record.policy === 'eye' && !(record.owner.skill?.id === 'skchr_svash2_3' && record.owner.skill.active)) return '三技能期间可部署';
      if (['unique', 'coordinate'].includes(record.policy) && record.units.some(live)) return '召唤物已在场上';
      if (record.policy === 'tactical' && record.units.some((t) => live(t) || t.mem.closurTac || t.mem.tacticalPoint)) return '战术点已放置';
      if (record.policy !== 'eye' && stock(record) < 1) return '库存耗尽';
      if (record.readyAt > battle.time + 1e-9) return `部署冷却 ${Math.ceil(record.readyAt - battle.time)} 秒`;
      const deployed = battle.allyUnits.filter((t) => t.ownerUnit === record.owner && t.defId === record.tokenId && live(t) && !t.mem.isClone).length;
      if (deployed >= (record.owner.trait.doroth?.limit || record.limit)) return '召唤物在场数量已达上限';
    }
    if (strict && !battle.canSpendDp((record.unit || record.owner).ownerId, cost(record))) return '部署费用不足';
    return null;
  }
  function error(id, row, col, { ignoreCooldown = false, ignoreCost = false, replace = null } = {}) {
    const r = records.get(id);
    if (!r) return '没有这张部署卡';
    if (battle.finished) return '作战已结束';
    if (!ignoreCooldown) {
      const why = status(r);
      if (why && !(ignoreCost && why === '部署费用不足')) return why;
    }
    const u = r.unit || r.units[0], key = row * COLS + col;
    if (r.kind === 'op' && live(battle.hand.copyTarget) && battle.hand.copyTarget.skill?.active) {
      return row === battle.hand.copyTarget.tileR && col === battle.hand.copyTarget.tileC ? null : '将干员拖到流形所在格进行复制';
    }
    const on = r.owner?.rangeKeySet?.has(key);
    if (r.pending && (!live(r.pending.owner) || !r.pending.owner.rangeKeySet?.has(key))) return '只能放在思衡托当前攻击范围内';
    if (r.policy === 'eye') {
      const ally = battle._occ[key];
      return live(ally) && ally.kind === 'op' && ally !== r.owner && !ally.mem.svashCoop ? null : '请选择尚未协同的其他干员所在地块';
    }
    if ((r.policy === 'tactical' || r.policy === 'coordinate' || r.def?.raw.ownerRange) && !on) return '只能部署在所属干员攻击范围内';
    if (ANCHOR.test(r.tokenId) && on) return '锚点须部署在思衡托攻击范围外';
    if (TRAPS.test(r.tokenId) && battle.enemies.some((e) => e.alive && !e.removed && !e.isFlying && Math.round(e.y) === row && Math.round(e.x) === col)
      && !(r.owner.skill?.id === 'skchr_wang_3' && r.owner.skill.active && on)) return '陷阱不能放在地面敌人所在格';
    const canStand = battle.canDeployUnit ? battle.canDeployUnit(u, row, col) : canDeployOn(battle.grid, u.def, row, col);
    if (!canStand) return '这个地形不能部署该单位';
    const occupied = battle._occ[key];
    if (live(occupied) && occupied !== replace) return '这一格已有我方单位';
    if (strict && deployedCount() - (replace ? occupation(replace) : 0) + occupation(u) > number(battle.flags.deployLimit, 8)) return '剩余部署位不足';
    return null;
  }
  function deploy(id, row, col, dir, options = {}) {
    const r = records.get(id), why = error(id, row, col, options);
    if (why) return { error: why };
    if (r.kind === 'op' && live(battle.hand.copyTarget) && battle.hand.copyTarget.skill?.active) {
      const target = battle.hand.copyTarget;
      target.dir = dir;
      target.mem.copyFrom(r.unit);
      target.skill.end('copied');
      return { unit: target, uid: target.uid, cost: 0, transient: true };
    }
    let u = r.unit || r.units.find((t) => !live(t));
    if (!u && !strict) {
      u = battle._makeAlly(r.owner.player, r.def, 'token', row, col, { uid: ++uid, ownerUnit: r.owner, dir });
      u.mem.handCard = r.id; r.units.push(u); byUnit.set(u, r);
      battle._setupUnit(u, r.units[0].kit);
      battle.__uid = Math.max(number(battle.__uid), uid);
    }
    if (!u) return { error: '没有可用的召唤物' };
    const paid = strict && !options.ignoreCost ? cost(r) : 0;
    const count = r.kind === 'token' ? stock(r) : 0;
    if (r.policy === 'eye') {
      const target = battle._occ[row * COLS + col];
      if (strict) battle.players[0].dp -= paid;
      r.owner.mem.svashCoopTarget = target;
      target.mem.svashCoop = r.owner;
      battle.emit('handEye', { owner: r.owner, target });
      r.readyAt = battle.time + u.base.respawnTime;
      if (strict) battle.addDp(r.owner.ownerId, paid);
      return { unit: target, uid: target.uid, cost: paid, transient: true };
    }
    const previous = { dir: u.dir, homeR: u.homeR, homeC: u.homeC };
    u.dir = dir; u.homeR = row; u.homeC = col; u.removed = false; u.mem.deployCostPaid = paid;
    if (strict) battle.players[0].dp -= paid;
    // Reserve inventory before deploy hooks; those hooks may grant new stock or end an ammo skill.
    if (strict && r.kind === 'token') setStock(r, count - 1);
    if (!battle._deploy(u, { tile: [row, col] })) {
      Object.assign(u, previous);
      if (strict && r.kind === 'token') setStock(r, count);
      if (strict) battle.addDp(u.ownerId, paid);
      return { error: '部署失败，费用已返还' };
    }
    if (r.kind === 'op') { r.deployments++; r.pending = null; }
    else {
      if (r.policy === 'tactical') r.owner.trait.reinforcement = u;
      if (!['unique', 'tactical', 'queue'].includes(r.policy)) r.readyAt = battle.time + u.base.respawnTime;
    }
    battle.emit('handDeploy', { unit: u, record: r });
    return { unit: u, uid: u.uid, cost: paid };
  }
  function markPending(unit, owner) {
    const r = byUnit.get(unit);
    if (r) r.pending = { owner };
  }
  function clearPending(owner) { for (const r of records.values()) if (r.pending?.owner === owner) r.pending = null; }
  function effects(unit, key, delta, until = 'leave') {
    byUnit.get(unit)?.costEffects.set(key, { delta, until });
  }
  function cards() {
    const visible = [...records.values()].filter((r) => {
      if (r.kind === 'op') return !live(r.unit) && !r.unit.removed;
      if (!live(r.owner)) return false;
      if (['unique', 'coordinate', 'reusable'].includes(r.policy) && r.units.some(live)) return false;
      if (r.policy === 'tactical' && r.units.some((t) => live(t) || t.mem.closurTac || t.mem.tacticalPoint)) return false;
      return true;
    });
    const eyeOwner = visible.find((r) => r.policy === 'eye')?.owner;
    const sortCost = (r) => eyeOwner ? cost(r) : r.unit?.def.stats.cost ?? r.def.stats.cost;
    visible.sort((a, b) => sortCost(a) - sortCost(b) || (eyeOwner && a.policy === 'eye' ? 1 : eyeOwner && b.policy === 'eye' ? -1 : 0)
      || ORDER.indexOf((a.unit || a.units[0]).def.profession) - ORDER.indexOf((b.unit || b.units[0]).def.profession)
      || a.id.localeCompare(b.id));
    return visible.map((r) => {
      const u = r.unit || r.units[0], reason = status(r);
      const copying = r.kind === 'op' && live(battle.hand.copyTarget) && battle.hand.copyTarget.skill?.active;
      const remaining = r.pending || copying ? 0 : Math.max(0, (r.kind === 'op' ? u.respawnAt : r.readyAt) - battle.time);
      const cooldownTotal = r.kind === 'op' ? u.respawnAt - u.deathAt : u.base.respawnTime;
      return { id: r.id, chessId: u.defId, name: u.name, charId: u.def.charId, cost: cost(r), rarity: u.def.rarity,
        profession: u.def.profession, prof: r.owner ? `召唤物 · ${r.owner.name}` : u.def.subProf, skills: [],
        token: r.kind === 'token', tokenId: r.tokenId,
        stock: r.kind === 'token' ? strict ? stock(r) : '∞' : null, cooldown: strict ? remaining : 0,
        cooldownTotal: Math.max(remaining, number(cooldownTotal)),
        disabled: !!reason, reason, pending: !!r.pending || !!copying,
        marker: r.pending ? '待投放' : copying ? '复制到流形' : [...owners].some((o) => live(o) && o.mem.deliveryCandidate === u) ? '投递目标'
          : u.mem.svashCasts ? `斩击 ×${u.mem.svashCasts}` : u.mem.svashShield ? '部署获屏障' : r.costEffects.size ? '费用变化' : '' };
    });
  }

  // Deployment confirmation is a per-token contract, independent of range shape and subclass.
  function requiresFacing(id) {
    const r = records.get(id);
    if (!r || r.kind === 'op') return true; // Includes deploying a hand operator onto Flowing Shape to copy it.
    if (DIRECTIONAL.has(r.tokenId)) return true;
    return !NO_FACING.has(r.tokenId);
  }
  battle.hand = { records, byUnit, prepare, addOperator, cost, status, error, deploy, cards, stock, setStock, markPending, clearPending, requiresFacing,
    effects, occupation, deployedCount, record: (id) => records.get(id), unitRecord: (u) => byUnit.get(u),
    waiting: (ownerId) => [...records.values()].filter((r) => r.kind === 'op' && r.unit.ownerId === ownerId && !live(r.unit) && !r.unit.removed).map((r) => r.unit) };
  for (const op of battle.allyUnits.slice()) if (op.kind === 'op') {
    if (strict) { addOperator(op); op.deferDeploy = true; }
    prepare(op);
  }

  const remove = battle._remove.bind(battle);
  battle._remove = (u, reason, killer, permanent, dying) => {
    const r = byUnit.get(u), paid = number(u.mem.deployCostPaid);
    if (strict && r?.kind === 'op') permanent = false;
    remove(u, reason, killer, permanent, dying);
    if (r?.kind === 'op') {
      for (const [key, effect] of r.costEffects) if (effect.until === 'leave') r.costEffects.delete(key);
      if (strict && reason === 'retreat') {
        const sub = u.def.subProf;
        const moduleRate = u.def.traitBb?.withdraw_cost_recover_ratio
          ?? u.def.talents.find((t) => t.bb?.withdraw_cost_recover_ratio != null)?.bb.withdraw_cost_recover_ratio;
        const rate = number(moduleRate, sub === 'charger' ? 1 : sub === 'merchant' ? 0 : .5);
        battle.addDp(u.ownerId, Math.floor(Math.min(paid * rate, moduleRate != null ? paid : u.def.stats.cost)), u);
      }
    } else if (r) {
      u.removed = false;
      if (r.policy === 'reusable') setStock(r, 1);
      if (r.policy === 'unique' || r.policy === 'coordinate') { r.readyAt = battle.time + u.base.respawnTime; setStock(r, 1); }
      if (r.policy === 'queue') r.queue.push(Math.max(battle.time, r.queue.at(-1) || 0) + u.base.respawnTime);
      // stock 策略（结构性原理、狼群、海嗣…这一类「有独立再部署时间」的召唤物）：离场就是把这张卡还回待部署区，
      // 计时结束玩家自己再放。不在这里加 setStock，库存就会在第一次部署后永远少一张，看起来就是「死了就没了」。
      if (r.policy === 'stock' && !permanent) {
        r.readyAt = battle.time + u.base.respawnTime;
        setStock(r, Math.min(r.cap, stock(r) + 1));
      }
    }
    if (strict && u.kind === 'op') battle.siReadyAt?.set(u.defId, u.respawnAt);
  };
  if (strict) {
    battle._checkRedeploys = () => {};
    battle.downOn = () => null;
    battle.onOwnBoard = (_ps, r, c) => battle.grid.inRect(r, c);
    battle.isReservedTile = (r, c) => !battle.grid.inRect(r, c) || live(battle._occ[r * COLS + c]);
  }
  const redeploy = battle.redeploy.bind(battle);
  battle.redeploy = (unit, options = {}) => {
    const r = byUnit.get(unit);
    if (r?.kind === 'token' && !options.tile && r.policy !== 'tactical') return false;
    return redeploy(unit, options);
  };
  battle.on('deploy', ({ unit: u, move }) => {
    if (u.kind !== 'op' || move) return;
    const own = byUnit.get(u);
    if (own) for (const [key, effect] of own.costEffects) if (effect.until === 'deploy') own.costEffects.delete(key);
    for (const r of records.values()) if (r.owner === u) {
      if (r.policy === 'eye') r.stock = 1;
      else if (r.policy === 'unique' || r.policy === 'coordinate' || r.policy === 'tactical') { setStock(r, 1); r.readyAt = 0; }
      else if (!r.skillOnly && !u.mem.summonDeck && !u.mem.wang && !u.mem.craftsman && !u.trait.doroth && u.mem.phantomStock == null) setStock(r, stock(r) + r.charge);
    }
  }, { priority: -1000 });
  battle.on('tick', () => {
    for (const r of records.values()) {
      while (r.queue?.length && r.queue[0] <= battle.time + 1e-9) { r.queue.shift(); setStock(r, stock(r) + 1); }
      if (r.policy === 'queue') r.readyAt = stock(r) > 0 ? 0 : r.queue[0] || 0;
    }
  });
  battle.on('death', ({ unit: u }) => {
    if (u.kind !== 'op') return;
    // PRTS 医疗探机：已部署的无人机不会因赫默退场而退场；幻影同样独立存续。
    for (const r of records.values()) if (r.owner === u && !/cgbird_bird|silent_healrb/.test(r.tokenId)) {
      for (const t of battle.allyUnits.filter((t) => t.ownerUnit === u && t.defId === r.tokenId)) {
        t.mem.closurTac = null; t.mem.tacticalPoint = null;
        if (live(t)) battle.retreat(t, { reason: 'owner' });
      }
    }
  }, { priority: -200 });
}
