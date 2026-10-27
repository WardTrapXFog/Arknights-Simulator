import { buildBattleSpec, createBattleFromSpec } from '/sim/spec.js';
import { DataSource } from '/sim/simdata.js';
import { makeRunner } from './battle-runner.js';
import { COLS, normRect, routesOf } from './battlefield.js';
import { ENEMIES } from './spawn-catalog.js';
import { useLevelSpawns } from './state.js';
import { createDamageScore } from './damage-score.js';
import { DEFAULT_DEPLOY_LIMIT, DEFAULT_LIFE_LIMIT } from '../../../shared/level.js';

export let battle = null;
export let runner = null;

export function buildBattle(document, baseSource, opts = {}) {
  runner?.pause();
  battle?.sandboxScore?.stop();
  const stage = document.stage, stageId = stage.id ?? 'sandbox';
  const ds = new DataSource({ stages: { [stageId]: stage } }, baseSource);
  const spec = buildBattleSpec({
    battleId: 'sandbox', fieldId: 'sandbox', kind: 'normal', seed: 20261021,
    stageId, timeLimit: null, rect: normRect(stage.rect),
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, coords: 'field', units: opts.mode === 'level'
      ? document.squad.map((chessId, i) => ({ chessId, uid: i + 1, row: 0, col: 0, skillIndex: document.skillSelections[chessId], moduleId: opts.moduleSelections?.[chessId] })) : [] }],
    // 关卡制作器直接给引擎格式的 spawns；沙盒仍按波次表映射。
    // `document.spawns` 是从制作器带进来的出生表（钉住 / 自定义路线原样保留），存在时优先。
    spawns: opts.spawns ?? spawnsOf(document),
    routes: stage.routes ?? routesOf(stage),
    flags: { dpInit: opts.mode === 'level' ? 10 : 30, dpPerSec: 1, dpMax: 99, startOpCooldown: 0, manualOnly: true,
      manualDeployment: true, siLevel: opts.mode === 'level',
      // 关卡可在 meta.deployLimit 指定部署上限（官方集成战略关卡是 6）；未写时沿用 8。
      deployLimit: Math.max(1, Math.min(13, Number(document.meta?.deployLimit) || DEFAULT_DEPLOY_LIMIT)),
      lifeLimit: Math.max(1, Math.min(999, Number(document.meta?.lifeLimit) || DEFAULT_LIFE_LIMIT)),
      // 集成战略主题（meta.theme，如 rogue_6）：内容层的特勤模组据此决定局内部分是否生效。
      siTheme: document.meta?.theme ?? null, ...(opts.flags || {}) },
  });
  const b = createBattleFromSpec(spec, ds, { quiet: true });
  b.siLevel = opts.mode === 'level';
  b.siReadyAt = new Map();
  b.autoFinish = b.siLevel;
  // 自由沙盒没有回合截止时间；不改变共用引擎与关卡编辑器的限时规则。
  b.timeLimit = Infinity;
  b._checkEnd = () => {
    if (!b.siLevel || b.finished) return;
    if (b.leakedCount >= b.flags.lifeLimit) { b.forceEnd('forced'); return; }
    if (!b._pending.length && !b.enemies.some((e) => e.alive) && b.started && !b._hasPendingEnemySchedules()) b._finish('cleared');
  };
  b.__uid = Math.max(0, ...b.allyUnits.map((u) => u.uid || 0), ...(document.operators || []).map((o) => o.uid));
  const remove = b._remove.bind(b);
  b._remove = (unit, reason, killer, permanent, dying) => {
    return remove(unit, reason, killer, b.siLevel ? permanent : true, dying);
  };
  if (document.session) {
    b.time = Math.max(0, Number(document.session.time) || 0);
    b.tickCount = Math.round(b.time * 30);
  }
  // 只重建存档列出的在场单位，血量与技力在部署后恢复。
  b.start();
  const errors = [];
  const restoredOperators = [];
  for (const input of (document.operators || []).filter((o) => !o.tokenId)) {
    const unit = b._createAllyFromInput(b.players[0], { ...input, kind: 'chess' });
    if (unit) b.hand?.prepare(unit);
    if (!unit || !b._deploy(unit)) errors.push(`行${input.row} 列${input.col}的干员无法部署`);
    else restoredOperators.push([unit, input.runtime]);
  }
  for (const input of (document.operators || []).filter((o) => o.tokenId)) {
    if (!b.allyUnits.some((u) => u.kind === 'op' && u.uid === input.ownerUid) && input.owner?.chessId) {
      const owner = b._createAllyFromInput(b.players[0], { ...input.owner, kind: 'chess', uid: input.ownerUid, row: 0, col: 0 });
      if (owner) { b.hand.prepare(owner); b._setupUnit(owner); }
    }
    const r = [...b.hand.records.values()].find((r) => r.tokenId === input.tokenId && r.owner.uid === input.ownerUid);
    const t = r?.units.find((u) => !u.alive);
    if (!t) { errors.push(`召唤物 ${input.tokenId} 的所属干员不在存档中`); continue; }
    t.dir = input.dir; t.homeR = input.row; t.homeC = input.col;
    if (b._deploy(t, { tile: [input.row, input.col] })) restoredOperators.push([t, input.runtime]);
  }
  b._processSpawns();
  for (const [unit, runtime] of restoredOperators) restoreRuntime(unit, runtime);
  for (const enemy of b.enemies) {
    restoreRuntime(enemy, document.spawns?.find((s) => s.tag === enemy.tag)?.runtime);
  }
  if (document.session) {
    b.players[0].dp = Math.max(b.players[0].dpFloor || 0, Math.min(b.flags.dpMax, Number(document.session.dp) || 0));
    b.killed = Math.max(0, Number(document.session.killed) || 0);
    b.leakedCount = Math.max(0, Number(document.session.leaked) || 0);
    b.total = Math.max(b.total, b.killed + b.leakedCount + b.enemies.length);
  }
  b.sandboxRestoreErrors = errors;
  b.sandboxScore = createDamageScore(b, document.session?.score);
  battle = b;
  return b;
}

function restoreRuntime(unit, saved) {
  if (!saved) return;
  if (Number.isFinite(saved.hp)) unit.hp = Math.max(1, Math.min(unit.s.maxHp, saved.hp));
  if (Number.isFinite(saved.sp) && unit.skill && !unit.skill.noSkill) unit.skill.setSpTotal(saved.sp);
  if (Number.isFinite(saved.atkCd)) unit.atkCd = Math.max(0, saved.atkCd);
}

function spawnsOf(document) {
  return document.spawns ?? document.waves.map((w) => ({ time: w.at, enemyKey: ENEMIES[w.enemyIndex]?.key,
    routeIndex: w.gate, count: w.count, mods: spawnMods(w), pos: w.pos, interval: w.interval ?? 0 }));
}

/** 手动放置同时写入唯一出生表；与旧 waves 合并时显式切换来源。 */
export function placeSandboxEnemy(document, enemyKey, options) {
  const id = document.nextEnemyId || 1;
  const tag = `sandbox:enemy:${id}`;
  const input = { ...options, time: 0, count: 1, tag, inTotal: true };
  const enemy = battle?.spawnEnemy(enemyKey, input);
  if (!enemy) return null;
  useLevelSpawns(document, [...spawnsOf(document), { ...input, enemyKey }], document.levelName);
  document.nextEnemyId = id + 1;
  return enemy;
}

/** 显式删除才改布置；自然死亡和漏怪不删除原始出生配置。 */
export function removeSandboxEnemy(document, enemy) {
  if (!enemy?.tag?.startsWith('sandbox:enemy:') || !document.spawns) return;
  useLevelSpawns(document, document.spawns.filter((s) => s.tag !== enemy.tag), document.levelName);
}

/** 出生队列里的倍率：是否移动只由“原地放 / 画路线”决定。 */
function spawnMods(w) {
  const mods = { ...(ENEMIES[w.enemyIndex]?.mods || {}) };
  delete mods.speedMul;
  return Object.keys(mods).length ? mods : null;
}

export function startRunner({ speed, paused, onFrame }) {
  runner = makeRunner(battle, { cap: Infinity, onFrame });
  runner.speedTo(speed);
  if (!paused) runner.play();
}

export function unitAt(row, col) {
  return battle?._occ?.[row * COLS + col] || null;
}

/**
 * 干员能不能落在这一格。
 * 互放规则（模拟阻挡）：干员格不能被第二个干员占；**有敌人的格仍然可以放干员**（敌人不写占位表）。
 * 地形规则不变：`canStand` 仍然先在，空地不能站人、高台只收远程。
 */
export function deploymentError(def, row, col, payDp, { placementOnly = false } = {}) {
  if (!def) return '数据里没有这个干员';
  if (battle.hand && (battle.siLevel || def.handCardId)) return battle.hand.error(def.handCardId || def.chessId, row, col,
    { ignoreCooldown: placementOnly, ignoreCost: placementOnly });
  if (battle.siLevel) {
    if (battle.allyUnits.some((u) => u.defId === def.chessId && u.alive && u.deployed)) return '该干员已在场上';
    const remaining = (battle.siReadyAt.get(def.chessId) || 0) - battle.time;
    if (remaining > 0) return `再部署还需 ${Math.ceil(remaining)} 秒`;
  }
  if (def.position === 'RANGED' && battle.grid.tile(row, col).build === 'MELEE') return '该单位需要高台或两用地块';
  const canStand = def.position === 'ALL'
    ? battle.grid.canStand(row, col, { ranged: true }) || battle.grid.canStand(row, col, { ranged: false })
    : battle.grid.canStand(row, col, { ranged: def.position === 'RANGED' });
  if (!canStand) return '这个地形放不下该干员';
  const occ = unitAt(row, col);
  if (occ && occ.alive && occ.deployed) return '这一格已经有干员了';
  const cost = Number(def.stats?.cost) || 0, dp = battle.players[0].dp;
  if (!placementOnly && payDp && !battle.canSpendDp(battle.players[0].playerId, cost)) return `DP 不足：需要 ${cost}，现有 ${Math.floor(dp)}`;
  return null;
}

export function deployOperator(input, def, payDp) {
  if (battle.hand && (battle.siLevel || def.handCardId)) return battle.hand.deploy(def.handCardId || input.chessId, input.row, input.col, input.dir);
  const error = deploymentError(def, input.row, input.col, payDp);
  if (error) return { error };
  const ps = battle.players[0], cost = Number(def.stats?.cost) || 0, uid = ++battle.__uid;
  const u = battle._createAllyFromInput(ps, { ...input, uid, kind: 'chess' });
  if (!u) return { error: '引擎拒绝了这个干员（未知棋子或非法技能索引）' };
  battle.hand?.prepare(u);
  u.mem.deployCostPaid = payDp ? cost : 0;
  if (payDp) ps.dp -= cost;
  if (!battle._deploy(u)) {
    if (payDp) ps.dp += cost;
    return { error: '部署失败：该格不可部署' };
  }
  return { unit: u, uid, cost };
}

export function queueSpawn(spawn) {
  battle._queueSpawn(spawn, false);
  battle._pending.sort((a, b) => a.time - b.time || a.seq - b.seq);
}
