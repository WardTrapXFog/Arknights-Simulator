import { levelSpawns, validateLevel } from '../../../shared/level.js';
import { normRect } from './battlefield.js';
/** 玩家阵容只属于这次出战，不写进关卡文件或自由沙盒存档。 */
export function createLevelRun(level, squad, skillSelections, moduleSelections) {
  level = validateLevel(level);
  return { levelId: level.id, levelName: level.name, moduleSelections: { ...moduleSelections }, document: {
    // meta 必须带进来：部署上限（meta.deployLimit）、集成战略主题（meta.theme → flags.siTheme，特勤模组靠它）
    // 与作战音乐（meta.bgm）都是战斗侧从 document.meta 读的。
    meta: structuredClone(level.meta ?? {}),
    stage: { ...structuredClone(level.stage), id: level.id, rect: normRect(level.stage.rect), devices: [] },
    waves: [], spawns: levelSpawns(level), levelName: level.name, squad: squad.slice(),
    skillSelections: { ...skillSelections }, operators: [], nextEnemyId: 1, session: null,
  } };
}
