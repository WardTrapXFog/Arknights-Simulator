import { session } from './session.js';
import { ENEMIES } from './spawn-catalog.js';
import { useLevelSpawns } from './state.js';
import { canDeployOn } from '/shared/deployment.js';

// 沙盒专属的对局操作：建场、起推进器、部署判定、刷怪、出生表。
//
// 建场与推进本身在 session.js（界面与引擎之间的门面）；这里只放"沙盒玩法"这一层的函数，
// 它们全部经门面取数，不直接碰引擎内部。

/** 建一场战斗。`document` 是沙盒/关卡的当前文档，`baseSource` 是数据源。 */
export function buildBattle(document, baseSource, opts = {}) {
  return session.open(document, baseSource, opts);
}

/** 起推进器（每次进战斗一次）。 */
export function startRunner({ speed, paused, onFrame }) {
  const driver = session.attachDriver({ cap: Infinity, onFrame });
  driver.speedTo(speed);
  if (!paused) driver.play();
}

/** 这一格上的单位。 */
export const unitAt = (row, col) => session.unitAt(row, col);

/**
 * 干员能不能落在这一格。
 * 互放规则（模拟阻挡）：干员格不能被第二个干员占；**有敌人的格仍然可以放干员**（敌人不写占位表）。
 * 地形规则不变：`canStand` 仍然先在，空地不能站人、高台只收远程。
 */
export function deploymentError(def, row, col, payDp, { placementOnly = false } = {}) {
  const hand = session.hand();
  if (!def) return '数据里没有这个干员';
  if (hand && (session.isLevel() || def.handCardId)) return hand.error(def.handCardId || def.chessId, row, col,
    { ignoreCooldown: placementOnly, ignoreCost: placementOnly });
  if (session.isLevel()) {
    if (session.allies().some((u) => u.defId === def.chessId && u.alive && u.deployed)) return '该干员已在场上';
    const remaining = session.redeployWait(def.chessId);
    if (remaining > 0) return `再部署还需 ${Math.ceil(remaining)} 秒`;
  }
  const grid = session.grid();
  const canStand = canDeployOn(grid, def, row, col);
  if (!canStand) return '这个地形放不下该干员';
  const occ = unitAt(row, col);
  if (occ && occ.alive && occ.deployed) return '这一格已经有干员了';
  const cost = Number(def.stats?.cost) || 0;
  if (!placementOnly && payDp && !session.canSpend(session.account()?.playerId, cost)) return `DP 不足：需要 ${cost}，现有 ${Math.floor(session.cost())}`;
  return null;
}

export function deployOperator(input, def, payDp) {
  const hand = session.hand();
  if (hand && (session.isLevel() || def.handCardId)) return hand.deploy(def.handCardId || input.chessId, input.row, input.col, input.dir);
  const error = deploymentError(def, input.row, input.col, payDp);
  if (error) return { error };
  const cost = Number(def.stats?.cost) || 0;
  const u = session.makeAlly(input);
  if (!u) return { error: '引擎拒绝了这个干员（未知棋子或非法技能索引）' };
  const account = session.account();
  u.mem.deployCostPaid = payDp ? cost : 0;
  if (payDp) account.dp -= cost;
  if (!session.deployUnit(u)) {
    if (payDp) account.dp += cost;
    return { error: '部署失败：该格不可部署' };
  }
  return { unit: u, uid: u.uid, cost };
}

/** 手动放置同时写入唯一出生表；与旧 waves 合并时显式切换来源。 */
export function placeSandboxEnemy(document, enemyKey, options) {
  const id = document.nextEnemyId || 1;
  const tag = `sandbox:enemy:${id}`;
  const input = { ...options, time: 0, count: 1, tag, inTotal: true };
  const enemy = session.spawnEnemy(enemyKey, input);
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

/** 出生表：制作器带来的 `spawns` 优先，否则按沙盒的波次映射。 */
export function spawnsOf(document) {
  return document.spawns ?? document.waves.map((w) => ({ time: w.at, enemyKey: ENEMIES[w.enemyIndex]?.key,
    routeIndex: w.gate, count: w.count, mods: spawnMods(w), pos: w.pos, interval: w.interval ?? 0 }));
}

/** 出生队列里的倍率：是否移动只由“原地放 / 画路线”决定。 */
function spawnMods(w) {
  const mods = { ...(ENEMIES[w.enemyIndex]?.mods || {}) };
  delete mods.speedMul;
  return Object.keys(mods).length ? mods : null;
}
