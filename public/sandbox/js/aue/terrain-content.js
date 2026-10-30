import { Grid } from '/sim/grid.js';
import { ROWS, COLS } from '/sim/constants.js';
import { DEFAULT_DEPLOY_LIMIT, DEFAULT_LIFE_LIMIT } from '/shared/level.js';

const ordinaryTiles = new Set(['tile_forbidden', 'tile_road', 'tile_floor', 'tile_wall', 'tile_fence_bound', 'tile_start', 'tile_end']);
function limit(value, fallback, max, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) throw Error(`${name}应为 1–${max} 的整数`);
  return value;
}

/** Explicit terrain projection, never a complete battle-content converter. */
export function createTerrainContent(document) {
  const stage = document.stage;
  if (!stage || !Array.isArray(stage.rows) || !stage.rect) throw Error('关卡缺少 stage.rows 或 stage.rect');
  const rect = stage.rect;
  if (![rect.r0, rect.r1, rect.c0, rect.c1].every(Number.isInteger)
    || rect.r0 < 0 || rect.r1 >= ROWS || rect.c0 < 0 || rect.c1 >= COLS || rect.r0 > rect.r1 || rect.c0 > rect.c1) throw Error('关卡战场范围无效');
  if (stage.devices?.length || stage.blockEdges?.length || stage.teleports?.length) throw Error('此入口尚未接入装置、封锁边或传送点，不能按普通地形代入');
  const grid = new Grid(stage, rect), unsupported = new Set();
  const tiles = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => {
    const t = grid.tile(r, c), inside = grid.inRect(r, c);
    if (inside && (!ordinaryTiles.has(t.key) || t.terrain || (t.special && !['start', 'end'].includes(t.special)))) unsupported.add(t.key);
    return { key: t.key, height: t.height === 'HIGH' ? 'HIGHLAND' : 'LOWLAND',
      buildable: inside ? t.build : 'NONE', passable: inside ? t.pass : 'NONE', side: 'A', goal: inside && t.special === 'end' ? 'A' : '' };
  }));
  if (unsupported.size) throw Error(`存在尚未适配的地形机制：${[...unsupported].join('、')}`);
  const options = { maxLifePoint: limit(document.meta?.lifeLimit, DEFAULT_LIFE_LIMIT, 999, '目标生命上限'),
    characterLimit: limit(document.meta?.deployLimit, DEFAULT_DEPLOY_LIMIT, 13, '部署上限'),
    initialCost: 10, maxCost: 99, costIncreaseTime: 1, moveMultiplier: 1 };
  const content = { level: { id: document.id || stage.id || 'si-trial', name: document.name || stage.name || '未命名关卡',
    width: COLS, height: ROWS, tiles, options, routes: [], waves: [] }, operators: {}, enemies: {}, devices: {}, decks: [[]] };
  // Preserve counts separately so a terrain-only world cannot be mistaken for migrated content.
  return { content, scope: { mode: 'terrain-world', spawns: document.spawns?.length ?? 0,
    waves: document.waves?.length ?? 0, operators: document.operators?.length ?? 0, squad: document.squad?.length ?? 0,
    routes: stage.routes?.length ?? 0 } };
}
