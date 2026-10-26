// 沙盒当前编辑内容的序列化与本地读写。
import { SAVE_KEY, MAX_SQUAD, SPEEDS, useLevelSpawns, useSandboxWaves } from './state.js';
import { ROWS, COLS, DEFAULT_RECT, defaultStage, normRect, gatesOf } from './battlefield.js';
import { isAvailable, canonicalOperatorId } from './roster.js';
import { ENEMIES } from './spawn-catalog.js';

const unitRuntime = (unit) => ({ hp: unit.hp, sp: unit.skill?.spTotal, atkCd: unit.atkCd });

function remainingRoute(enemy) {
  const route = enemy.route;
  const legs = (route?.legs || []).slice(route?.legIdx || 0);
  const checkpoints = [];
  let end = null;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.t === 'move' && leg.final) end = [leg.r, leg.c];
    else if (leg.t === 'move') checkpoints.push({ type: 'MOVE', pos: [leg.r, leg.c] });
    else if (leg.t === 'wait') checkpoints.push({ type: 'WAIT', time: i === 0 ? (route.waitLeft ?? leg.time) : leg.time });
    else if (leg.t === 'disappear') checkpoints.push({ type: 'DISAPPEAR' });
    else if (leg.t === 'appear') checkpoints.push({ type: 'APPEAR', pos: [leg.r, leg.c] });
  }
  return { motion: enemy.motion, start: [enemy.y, enemy.x], end, checkpoints };
}

export function serializeSandbox(state, battle = null) {
  const operators = battle ? battle.allyUnits.filter((u) => u.alive && u.deployed && u.hp > 0 && (u.kind === 'op' || (u.kind === 'token' && u.mem.handCard)))
    .sort((a, b) => a.deploySeq - b.deploySeq).map((u) => ({
      uid: u.uid, chessId: u.defId, row: u.tileR, col: u.tileC, dir: u.dir,
      ...(u.kind === 'token' ? { tokenId: u.defId, ownerUid: u.ownerUnit.uid,
        owner: { chessId: u.ownerUnit.defId, skillIndex: u.ownerUnit.def.loadout?.skillIndex, moduleId: u.ownerUnit.def.loadout?.moduleId } } : {}),
      skillIndex: u.mem.customMakoto?.index ?? u.skill?.index ?? u.def?.skill?.index ?? 0, runtime: unitRuntime(u),
    })) : state.document.operators;
  const enemies = battle?.enemies.filter((e) => e.alive && e.deployed && e.hp > 0);
  const spawns = enemies ? enemies.map((e, i) => ({
    enemyKey: e.defId, pos: [e.y, e.x], route: remainingRoute(e), mods: e.mods,
    time: 0, count: 1, tag: `sandbox:enemy:${i + 1}`, runtime: unitRuntime(e),
  })) : state.document.spawns;
  return {
    format: 3,
    stage: { ...state.document.stage, rect: normRect(state.document.stage.rect) },
    waves: battle ? [] : state.document.waves, squad: state.document.squad,
    spawns: spawns ?? null, levelName: state.document.levelName ?? null,
    operators: operators.map((o) => ({ ...o })),
    skillSelections: { ...state.document.skillSelections }, nextEnemyId: enemies ? enemies.length + 1 : state.document.nextEnemyId,
    session: battle ? { time: battle.time, dp: battle.players[0].dp, killed: battle.killed, leaked: battle.leakedCount,
      score: battle.sandboxScore?.snapshot() } : state.document.session,
    settings: { board: state.ui.board, speed: state.ui.speed, payDp: state.ui.payDp },
  };
}

export function saveLocal(state, storage = globalThis.localStorage, battle = null) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(serializeSandbox(state, battle)));
  } catch { /* ignore */ }
}

export function loadLocal(state, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved?.stage?.rows) && saved.stage.rows.length === ROWS
      && saved.stage.rows.every((r) => typeof r === 'string' && r.length === COLS)) {
      state.document.stage = { ...defaultStage(), ...saved.stage, rect: normRect(saved.stage.rect ?? DEFAULT_RECT) };
    }
    if (Array.isArray(saved?.waves)) {
      useSandboxWaves(state.document, saved.waves.filter((w) => w && Number.isFinite(w.at) && ENEMIES[w.enemyIndex]).slice(0, 40));
    }
    // 从关卡制作器带来的出生表：原样喂给引擎，不经过波次映射（保留钉住与自定义路线）
    if (Array.isArray(saved?.spawns)) {
      useLevelSpawns(state.document, saved.spawns.filter((s) => s && Number.isFinite(s.time) && typeof s.enemyKey === 'string'),
        typeof saved.levelName === 'string' ? saved.levelName : null);
    }
    if (Array.isArray(saved?.squad)) {
      const ok = [...new Set(saved.squad.map(canonicalOperatorId))].filter((id) => typeof id === 'string' && isAvailable(id)).slice(0, MAX_SQUAD);
      state.document.squad = ok;
    }
    state.document.operators = (Array.isArray(saved.operators) ? saved.operators : []).filter((o) => o && (isAvailable(o.chessId) || (typeof o.tokenId === 'string' && Number.isInteger(o.ownerUid)))
      && Number.isInteger(o.uid) && o.uid > 0 && Number.isInteger(o.row) && o.row >= 0 && o.row < ROWS
      && Number.isInteger(o.col) && o.col >= 0 && o.col < COLS).map((o) => ({
        uid: o.uid, chessId: canonicalOperatorId(o.chessId), row: o.row, col: o.col,
        ...(o.tokenId ? { tokenId: o.tokenId, ownerUid: o.ownerUid, owner: o.owner } : {}),
        dir: ['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(o.dir) ? o.dir : 'RIGHT',
        skillIndex: Number.isInteger(o.skillIndex) && o.skillIndex >= 0 ? o.skillIndex : 0,
        runtime: o.runtime,
      }));
    state.document.session = saved.session || null;
    state.document.skillSelections = Object.fromEntries(Object.entries(saved.skillSelections || {})
      .map(([id, index]) => [canonicalOperatorId(id), index])
      .filter(([id, index]) => isAvailable(id) && Number.isInteger(index) && index >= 0));
    const maxEnemyId = Math.max(0, ...(state.document.spawns || []).map((s) => {
      const match = /^sandbox:enemy:(\d+)$/.exec(s.tag || '');
      return match ? Number(match[1]) : 0;
    }));
    state.document.nextEnemyId = Math.max(maxEnemyId + 1, Number.isSafeInteger(saved.nextEnemyId) ? saved.nextEnemyId : 1);
    if (saved.settings?.board === '2d' || saved.settings?.board === '3d') state.ui.board = saved.settings.board;
    if (SPEEDS.includes(saved.settings?.speed)) state.ui.speed = saved.settings.speed;
    if (typeof saved.settings?.payDp === 'boolean') state.ui.payDp = saved.settings.payDp;
  } catch { /* ignore */ }
}

export function savedStage(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const rows = JSON.parse(raw)?.stage?.rows;
    if (!Array.isArray(rows) || rows.length !== ROWS) return null;
    if (!rows.every((r) => typeof r === 'string' && r.length === COLS)) return null;
    const rect = normRect(JSON.parse(raw)?.stage?.rect);
    return { ...defaultStage(), rows, rect, name: '上次的地图' };
  } catch { return null; }
}


/**
 * 换一张地形：只保留这张图自己的波次。
 *
 * 从关卡制作器带进来的 `spawns` 属于上一张图，换图时必须一并清掉，否则
 * `battle-session.buildBattle` 会继续优先读它，新地图只换了背景、敌人还是旧的。
 * 同理清掉 `levelName`，它描述的也是那一关。
 */
export function commitStage(stage, storage = globalThis.localStorage) {
  let save = {};
  try { save = JSON.parse(storage.getItem(SAVE_KEY) || '{}') || {}; } catch { save = {}; }
  const gates = Math.max(1, gatesOf(stage).starts.length);
  const waves = Array.isArray(save.waves) ? save.waves.filter((w) => w && (w.gate | 0) < gates) : [];
  const next = {
    ...save,
    stage: { ...stage, rect: normRect(stage.rect) },
    operators: [], nextEnemyId: 1, session: null,
    waves,
    spawns: null,
    levelName: null,
  };
  try { storage.setItem(SAVE_KEY, JSON.stringify(next)); } catch { /* 隐私模式下写不进也没关系：boot 会用默认图 */ }
}

/**
 * 从关卡制作器带一张关卡进沙盒：写入它的地形与出生表。
 * 出生表直接是引擎格式（`levelSpawns` 的产物），沙盒按原样喂给 `buildBattle`，
 * 所以钉住的波次、自定义路线都不会在沙盒里被重新解释一遍。
 */
export function commitLevel(level, spawns, storage = globalThis.localStorage) {
  let save = {};
  try { save = JSON.parse(storage.getItem(SAVE_KEY) || '{}') || {}; } catch { save = {}; }
  const next = {
    ...save,
    stage: { ...level.stage, rect: normRect(level.stage.rect) },
    operators: [], nextEnemyId: 1, session: null,
    // 关卡自己的波次不走沙盒的“红门序号”模型：清空 waves，改由 spawns 驱动对局。
    waves: [],
    spawns: Array.isArray(spawns) ? spawns : [],
    levelName: level.name,
  };
  try { storage.setItem(SAVE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

