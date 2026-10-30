import { makeRunner } from './battle-runner.js';
import { COLS } from './battlefield.js';
import { ENEMIES } from './spawn-catalog.js';

// 战斗会话：界面与引擎之间唯一的门面。
//
// 为什么要有它：界面原来直接读引擎的 `_pending`、`_deploy`、`hand`、`players` 这些内部成员，
// 引擎一换，几十处就得跟着改。这里把它们收成一组有名字的能力——建场、推进、部署、撤退、
// 查询、观测、存档——外部只认这一套。
//
// 规矩：
//   * 门面内部可以碰引擎私有成员；门面外的 public/sandbox/js/ 不允许出现 `battle._`，
//     由 tools/check-session-boundary.mjs 守着。
//   * 门面只转发、不改规则。任何玩法判断都不写在这里——那是 kit 和调用方的事。
//   * 引擎由这里选择；单位投影与规则兼容放在对应适配器，界面继续使用门面。
//
// 用法：`import { session } from './session.js'`，然后 `session.time()`、`session.allies()`。
// 统一前缀让"我在跨边界"一眼可见，也避免和界面自己的同名变量撞车。

/** 当前会话的引擎实例；没有对局时为 null。 */
let engine = null;
/** 当前会话的推进器。 */
let driver = null;
let opening = 0;

/** 当前引擎实例（只给调试钩子与过渡调用点；规则代码一律走下面的门面）。 */
function rawEngine() { return engine; }

/** 建一场战斗。`document` 是沙盒/关卡的当前文档，`baseSource` 是数据源。 */
function open(document, baseSource, opts = {}) {
  close();
  if (!globalThis.location || new URLSearchParams(globalThis.location.search).get('engine') !== 'legacy') {
    const generation=opening;
    return Promise.all([import('./aue/runtime.js'),import('./aue/battle.js')]).then(async ([runtime,adapter])=>{
      const next=await adapter.prepareBattle({...document,spawns:opts.spawns ?? spawnsOf(document)},baseSource,await runtime.loadAueRuntime(),opts);
      if(generation!==opening){next.close();throw Error('AUE 建场已被下一次会话替代');}
      engine=next;return engine;
    });
  }
  const generation=opening;
  return import('./legacy-session.js').then(({createEngine})=>{
    if(generation!==opening)throw Error('建场已被下一次会话替代');
    engine=createEngine(document,baseSource,{...opts,spawns:opts.spawns ?? spawnsOf(document)});return engine;
  });
}

/** 关掉当前会话。 */
function close() {
  opening++;
  try { driver?.pause(); engine?.sandboxScore?.stop(); engine?.close?.(); } catch { /* 已经没了 */ }
  engine = null; driver = null;
}

// ---------------------------------------------------------------------------------------------------
// 建场（原 battle-session.js 的 buildBattle 主体，逐行搬过来，行为不变）
// ---------------------------------------------------------------------------------------------------

function spawnsOf(document) {
  return document.spawns ?? document.waves.map((w) => ({ time: w.at, enemyKey: ENEMIES[w.enemyIndex]?.key,
    routeIndex: w.gate, count: w.count, mods: spawnMods(w), pos: w.pos, interval: w.interval ?? 0 }));
}

/** 出生队列里的倍率：是否移动只由“原地放 / 画路线”决定。 */
function spawnMods(w) {
  const mods = { ...(ENEMIES[w.enemyIndex]?.mods || {}) };
  delete mods.speedMul;
  return Object.keys(mods).length ? mods : null;
}

// ---------------------------------------------------------------------------------------------------
// 门面
// ---------------------------------------------------------------------------------------------------

export const session = Object.freeze({
  backend: () => engine?.backend || 'legacy',
  // ---- 建场 / 推进 ----
  /** 当前引擎实例（调试与过渡出口，业务代码不要用）。 */
  rawEngine,
  /** 建一场战斗（会先关掉上一场）。返回建好的引擎实例，只给门面内部与旧调用点用。 */
  open,
  /** 关掉当前会话。 */
  close,
  /** 起推进器（每次进战斗一次）。 */
  attachDriver(options) { driver = makeRunner(engine, options); return driver; },
  /** 推进器。没有会话时为 null。 */
  driver: () => driver,
  /** 推进一帧。 */
  step: () => engine?.step(),
  /** 推进器是否在播放。 */
  playing: () => !!driver?.playing,

  // ---- 查询 ----
  /** 有没有正在进行的会话。 */
  alive: () => !!engine,
  /** 游戏时间（秒）。 */
  time: () => engine?.time ?? 0,
  /** 对局是否结束。 */
  finished: () => !!engine?.finished,
  /** 是不是清场通关（结束原因为 cleared）。 */
  cleared: () => engine?.reason === 'cleared',
  /** 结束原因（cleared / forced / timeout …）。 */
  reason: () => engine?.reason ?? null,
  /** 这一场是不是严格关卡（而不是自由沙盒）。 */
  isLevel: () => !!engine?.siLevel,
  /** 己方全部单位（含还没上场的牌）。 */
  allies: () => engine?.allyUnits ?? [],
  /** 场上敌人。 */
  enemies: () => engine?.enemies ?? [],
  /**
   * 全部单位（双方 + 装置），渲染投影用的那份列表。
   * 返回的是引擎单位对象本身：它们是数据，界面可以读字段，但不许调私方法。
   */
  allUnits: () => engine?.units ?? [],
  /** 某个范围键集合里能命中的敌人（自设表现的封印范围用）。 */
  enemiesInKeys: (keys, by, profile) => engine?.enemiesInKeys?.(keys, by, profile) ?? [],
  /** 正在飞的弹道。 */
  projectiles: () => engine?.projectiles?.list ?? [],
  /** 玩家 1 的账户（费用与回复率）。 */
  account: () => engine?.players?.[0] ?? null,
  /** 当前费用。 */
  cost: () => engine?.players?.[0]?.dp ?? 0,
  /** 手牌。 */
  hand: () => engine?.hand ?? null,
  /** 手牌里某张牌。 */
  handRecord: (id) => engine?.hand?.record(id) ?? null,
  /** 这张牌是不是还要玩家选朝向。 */
  handRequiresFacing: (id) => !!engine?.hand?.requiresFacing?.(id),
  /** 这张牌的部署状态说明。 */
  handStatus: (record) => engine?.hand?.status?.(record) ?? '',
  /** 已占用的部署位。 */
  deployedCount: () => engine?.hand?.deployedCount?.() ?? 0,
  /** 手牌卡片列表。 */
  handCards: () => engine?.hand?.cards?.() ?? [],
  /** 火力计分板。 */
  score: () => engine?.sandboxScore ?? null,
  /** 地形格（寻路、可行走判断用）。 */
  grid: () => engine?.grid ?? null,
  /** 战场区域。 */
  rect: () => engine?.rect ?? null,
  /** 对局规则开关（部署上限、生命上限、主题、费用回复等）。 */
  flags: () => engine?.flags ?? {},
  /** 这一格上的单位。 */
  unitAt: (row, col) => engine?._occ?.[row * COLS + col] || null,
  /** 战况：歼灭、漏怪、总数、剩余生命。 */
  tally() {
    if (!engine) return { killed: 0, leaked: 0, total: 0, life: 0, time: 0, finished: false };
    const killed = engine.killed || 0, leaked = engine.leakedCount || 0;
    return { killed, leaked, total: Math.max(engine.total || 0, killed + leaked + engine.enemies.length),
      life: engine.life ?? Math.max(0, (engine.flags?.lifeLimit ?? 0) - leaked), time: engine.time || 0, finished: !!engine.finished };
  },
  /** 存档恢复时被跳过的单位（读不出位置的用来提示）。 */
  restoreErrors: () => engine?.sandboxRestoreErrors ?? [],
  /** 场况元信息（渲染器要的单位列表、区域）。 */
  fieldMeta: () => engine?.fieldMeta?.() ?? null,
  /** 引擎内容表（查“这个干员有什么技能”一类问题）。 */
  content: () => engine?.data ?? null,

  // ---- 观测 ----
  /** 登记引擎事件钩子（计分、反馈用）。 */
  on: (name, fn, opts) => engine?.on?.(name, fn, opts),
  off: (handle) => engine?.off?.(handle),
  /** 取走累积的事件。 */
  events: () => engine?.drainEvents?.() ?? [],
  /** 单位快照。 */
  snapshot: () => engine?.snapshot?.() ?? null,

  // ---- 命令 ----
  /** 强制结束（超时、撤退后清场等）。 */
  forceEnd: (reason) => engine?.forceEnd?.(reason),
  /** 能不能付出这么多费。 */
  canSpend: (ownerId, amount) => !!engine?.canSpendDp?.(ownerId, amount),
  /**
   * 造一个己方单位（不落场）。`input` 形如 { chessId, row, col, dir, skillIndex, uid }。
   * 返回单位或 null。
   */
  makeAlly(input) {
    if (!engine) return null;
    const uid = input.uid ?? ++engine.__uid;
    const unit = engine._createAllyFromInput(engine.players[0], { ...input, uid, kind: 'chess' });
    if (unit) engine.hand?.prepare(unit);
    return unit;
  },
  /** 把一个已经造好的单位落到场上。 */
  deployUnit: (unit) => !!engine?._deploy?.(unit),
  /** 撤退一个单位。 */
  retreat: (unit, options = {}) => engine?.retreat?.(unit, options),
  /** 直接击杀一个单位（沙盒的"删除敌人"）。 */
  kill: (unit) => engine?.kill?.(unit, null),
  /** 发一个表现事件（沙盒删除敌人时的"命中上限"提示）。 */
  fx: (kind, params) => engine?.fx?.(kind, params),
  /** 刷一个敌人（沙盒手动放置）。 */
  spawnEnemy: (key, input) => engine?.spawnEnemy?.(key, input) ?? null,
  /** 往出生队列里塞一条，并按时间排好。 */
  queueSpawn(spawn) {
    if (!engine) return null;
    const enemy = engine._queueSpawn(spawn, false);
    engine._pending.sort((a, b) => a.time - b.time || a.seq - b.seq);
    return enemy;
  },
  /** 退出再部署冷却还剩几秒（严格关卡用；自由沙盒没有冷却）。 */
  redeployWait(chessId) {
    const readyAt = engine?.siReadyAt?.get(chessId) || 0;
    return Math.max(0, readyAt - (engine?.time ?? 0));
  },
  /** 出生队列里还有多少条没出来。 */
  pendingSpawns: () => engine?._pending ?? [],
});
