import { buildBattleSpec, createBattleFromSpec } from '/sim/spec.js';
import { DataSource } from '/sim/simdata.js';
import { normRect, routesOf } from './battlefield.js';
import { createDamageScore } from './damage-score.js';
import { DEFAULT_DEPLOY_LIMIT, DEFAULT_LIFE_LIMIT } from '../../../shared/level.js';
export function createEngine(document, baseSource, opts) {
  const stage = document.stage, stageId = stage.id ?? 'sandbox';
  const ds = new DataSource({ stages: { [stageId]: stage } }, baseSource);
  const spec = buildBattleSpec({
    battleId: 'sandbox', fieldId: 'sandbox', kind: 'normal', seed: 20261021,
    stageId, timeLimit: null, rect: normRect(stage.rect),
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, coords: 'field', units: opts.mode === 'level'
      ? document.squad.map((chessId, i) => ({ chessId, uid: i + 1, row: 0, col: 0, skillIndex: document.skillSelections[chessId], moduleId: opts.moduleSelections?.[chessId] })) : [] }],
    // 关卡制作器直接给引擎格式的 spawns；沙盒仍按波次表映射。
    // `document.spawns` 是从制作器带进来的出生表（钉住 / 自定义路线原样保留），存在时优先。
    spawns: opts.spawns,
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
  b.sandboxScore = createDamageScore({
    now: () => b.time,
    allies: () => b.allyUnits,
    on: (name, fn, opts) => b.on(name, fn, opts),
    off: (hook) => b.off(hook),
  }, document.session?.score);
  return b;
}

function restoreRuntime(unit, saved) {
  if (!saved) return;
  if (Number.isFinite(saved.hp)) unit.hp = Math.max(1, Math.min(unit.s.maxHp, saved.hp));
  if (Number.isFinite(saved.sp) && unit.skill && !unit.skill.noSkill) unit.skill.setSpTotal(saved.sp);
  if (Number.isFinite(saved.atkCd)) unit.atkCd = Math.max(0, saved.atkCd);
}

