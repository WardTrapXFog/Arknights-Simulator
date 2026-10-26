// public/sandbox/js/state.js — 沙盒的常量与初始状态（main.js 用这里的数据开局）。
import { defaultStage } from './battlefield.js';
import { DIY_IDS } from './roster.js';

export const SAVE_KEY = 'arksim-sandbox-v3';
export const TALULA = DIY_IDS[0] || 'chess_char_5_99_talula_a';
/** 默认仍只放塔露拉，原作支援从选择器按需加入。 */
export const DEFAULT_SQUAD = [TALULA];
export const SPEEDS = [1, 2, 4];
export const MAX_SQUAD = 13;
/** 战斗里的 def 常常只剩英文职业名，面板上换成中文。 */
export const PROF_CN = {
  WARRIOR: '近卫', SNIPER: '狙击', TANK: '重装', MEDIC: '医疗',
  SUPPORT: '辅助', CASTER: '术师', SPECIAL: '特种', PIONEER: '先锋',
};

export function createSandboxState() {
  return {
    document: { stage: defaultStage(), waves: [], spawns: null, levelName: null, squad: DEFAULT_SQUAD.slice(),
      operators: [], skillSelections: {}, nextEnemyId: 1, session: null },
    ui: {
      payDp: false, tool: null, brush: 'r', active: TALULA, skillIndex: 0, popOpen: false,
      enemyIndex: 0, enemyFilter: 'all', gate: 0, tab: 'enemy', drawerOpen: false,
      board: '3d', speed: 1, selectedUid: null, rangeSig: -1,
      rangeMode: 'attack', mapJson: '',
      // 投放方式：null | 'tile'（点地放置）| 'route'（画路线）| 'delete'（删除单个）| 'batch'（批量删除）
      place: null,
      placeCont: false,          // 连续放置：放完一只仍保持选中
      route: null,               // { start:{r,c}|null, points:[{r,c,wait}], end:{r,c}|null }
      routePop: null,            // 正在调整的路线点下标
      batchSel: [],              // 批量删除已选中的敌人 id
    },
  };
}

/**
 * 出生数据的唯一来源。
 *
 * 一次对局的敌人只有两种写法：一张关卡自带的引擎出生表（`document.spawns`），
 * 或沙盒自己按「红门序号」编的波次（`document.waves`）。两者互斥——`spawns` 存在时
 * 引擎优先读它。任何切换地图的操作都必须显式选择其中一种，不能只改一半，
 * 否则新地形会继续跑上一张图的敌人。
 */
export function useLevelSpawns(document, spawns, levelName) {
  document.spawns = Array.isArray(spawns) ? spawns : null;
  document.levelName = levelName ?? null;
  if (document.spawns) document.waves = [];
}

/** 回到沙盒自己的波次模型：让出关卡出生表。 */
export function useSandboxWaves(document, waves = []) {
  document.spawns = null;
  document.levelName = null;
  document.waves = waves;
}
