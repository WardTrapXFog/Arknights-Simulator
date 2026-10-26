// 沙盒投放目录：保留旧存档使用的下标，再追加共用敌人库。
import { ENEMY_LIBRARY } from './enemy-library.js';
// 全部是 data/enemies.json 里真实存在的 key：机制由 server/sim/content/enemies/* 按 key 匹配，刷出来就是真机制。
// mods 是 spawnEnemy 的倍率（hpMul / atkMul / defMul / resMul）；**不再用 speedMul 做“木桩”**——
// 敌人是否移动只由投放方式决定（原地放 = 钉住，画路线 = 沿路线走），倍率不该和移动语义打架。
// tags 为演示标签；工具箱按共用目录的 rank 分档，引擎不读取筛选字段。

/** 原地放置时钉住用的倍率；只有“放原地”这条路径会用到它。 */
export const PINNED_MODS = Object.freeze({ speedMul: 0 });

const DUMMY_MODS = Object.freeze({ hpMul: 20, atkMul: 0, defMul: 0, resMul: 0 });

// 只固定生命与攻防；移动由投放方式决定。
const mechanismDummy = (key, name, baseHp, tags, note) => ({
  key, name: `200万血${name}木桩`, short: `${name}木桩`, dummy: true,
  tags: ['dummy', 'showcase', ...tags],
  note: `200 万血 · 保留原攻击、防御、法抗；${note}`,
  mods: { hpMul: 2000000 / baseHp },
});

/**
 * @typedef {{ key: string, name: string, short?: string, note: string, tags?: string[],
 *   mods?: object, dummy?: boolean }} EnemyPick
 */

/** @type {ReadonlyArray<EnemyPick>} */
export const ENEMY_PRESETS = Object.freeze([
  { key: 'enemy_1007_slime', name: '源石虫', short: '源石虫', tags: ['normal'], note: '最基础的地面杂兵' },
  { key: 'enemy_1000_gopro_2', name: '猎狗pro', short: '猎狗', tags: ['normal'], note: '高速突进，容易漏' },
  { key: 'enemy_1021_bslime', name: '高能源石虫', short: '高能虫', tags: ['normal'], note: '感染 · 自爆式输出' },
  { key: 'enemy_1006_shield', name: '重装防御者', short: '重装盾', tags: ['elite'], note: '高防御，物抗测试对象' },
  { key: 'enemy_1045_hammer', name: '粉碎攻坚手', short: '攻坚手', tags: ['elite'], note: '高攻高防的重甲近战' },
  { key: 'enemy_1005_yokai_2', name: '妖怪MKII', short: '妖怪MK2', tags: ['fly'], note: '飞行 · 远程无人机' },
  { key: 'enemy_1040_bombd', name: '暴鸰', short: '暴鸰', tags: ['fly'], note: '飞行 · 投弹轰炸' },
  { key: 'enemy_1042_frostd', name: '寒霜', short: '寒霜', tags: ['fly'], note: '飞行 · 冰冷光环' },
  { key: 'enemy_1023_jmage', name: '隐形术师', short: '隐术师', tags: ['normal'], note: '隐匿 · 法术远程' },
  { key: 'enemy_1019_jshoot', name: '隐形弩手', short: '隐弩手', tags: ['normal'], note: '隐匿 · 物理远程' },
  { key: 'enemy_1026_aghost', name: '幽灵组长', short: '幽灵', tags: ['elite'], note: '幻影 · 难以阻挡' },
  { key: 'enemy_1072_dlancer', name: '萨卡兹穿刺手', short: '穿刺手', tags: ['elite'], note: '突刺 · 极高单次伤害' },
  { key: 'enemy_1062_rager_2', name: '狂暴宿主组长', short: '狂暴宿主', tags: ['elite'], note: '狂暴 · 高速高攻' },
  { key: 'enemy_1092_mdgint', name: '泥岩巨像', short: '泥岩巨像', tags: ['elite'], note: '巨型单位 · 十万血' },
  { key: 'enemy_1081_sotisd', name: '游击队盾卫', short: '盾卫', tags: ['elite'], note: '高防 · 法抗双重减伤' },
  { key: 'enemy_1001_bigbo', name: '大鲍勃', short: '大鲍勃', tags: ['elite'], note: 'BOSS 级近战' },
  { key: 'enemy_1092_mdgint', name: '训练木桩', short: '百万血木桩', tags: ['dummy'], note: '200 万血 · 零攻防 · 不还手不移动', mods: DUMMY_MODS, dummy: true },
  { key: 'enemy_1305_mhslim', name: '灼热源石虫', short: '灼热虫', tags: ['burn'], note: '远程法术攻击附带灼燃损伤' },
  { key: 'enemy_1305_mhslim_2', name: '炽焰源石虫', short: '炽焰虫', tags: ['burn'], note: '较强的灼燃攻击来源，用于免疫对照' },
  { key: 'enemy_10054_cjhot', name: '鼎沸', tags: ['burn', 'elite'], note: '周围持续法术伤害与灼燃损伤，不可对空' },
  { key: 'enemy_10034_cnvsax', name: '节日爵士乐手', short: '爵士乐手', tags: ['burn', 'elite', 'stealth'], note: '隐匿；被发现后反击，持续攻击附带灼燃' },
  // 螺旋桨的普通血量版本（2万 / 1.5万），用于看击杀过程；200 万血版本在下面的木桩组里
  { key: 'enemy_10150_nsheat_2', name: '焦香螺旋桨', short: '焦香螺旋', tags: ['burn', 'fly', 'elite'], note: '飞行 · 每秒对半径2.0内敌我造成灼燃损伤' },
  { key: 'enemy_10150_nsheat', name: '炙烤螺旋桨', short: '炙烤螺旋', tags: ['burn', 'fly', 'elite'], note: '飞行 · 焦香的弱化版，360攻' },
  { key: 'enemy_1043_zomsbr', name: '宿主士兵', tags: ['normal'], note: '持续回复生命值；不以回血停顿作为沉默判据' },
  { key: 'enemy_1061_zomshd', name: '宿主重装士兵', short: '宿主重装', tags: ['elite'], note: '高防御，持续回复生命值' },
  { key: 'enemy_1006_shield', name: '耐久重装防御者', short: '耐久重装', tags: ['showcase', 'elite'], note: '演示变体：生命×30、攻击×0；防御法抗不改', mods: { hpMul: 30, atkMul: 0 } },
  { key: 'enemy_1019_jshoot', name: '耐久隐形弩手', short: '耐久隐弩', tags: ['showcase', 'stealth'], note: '演示变体：生命×40、攻击×0；保留隐匿', mods: { hpMul: 40, atkMul: 0 } },
  { key: 'enemy_1081_sotisd', name: '耐久游击队盾卫', short: '耐久盾卫', tags: ['showcase', 'elite'], note: '演示变体：生命×8、攻击×0；防御法抗不改', mods: { hpMul: 8, atkMul: 0 } },
  { key: 'enemy_1305_mhslim_2', name: '耐久炽焰源石虫', short: '耐久炽焰虫', tags: ['showcase', 'burn'], note: '演示变体：生命×40、攻击×2；灼燃机制不改', mods: { hpMul: 40, atkMul: 2 } },
  { key: 'enemy_1005_yokai_2', name: '耐久妖怪MKII', short: '耐久无人机', tags: ['showcase', 'fly'], note: '演示变体：生命×40、攻击×3；保留空中身份', mods: { hpMul: 40, atkMul: 3 } },
  { key: 'enemy_10034_cnvsax', name: '耐久节日爵士乐手', short: '耐久乐手', tags: ['showcase', 'burn', 'stealth'], note: '演示变体：生命×12、攻击×0.25；保留隐匿与持续攻击', mods: { hpMul: 12, atkMul: 0.25 } },
  mechanismDummy('enemy_1019_jshoot', '隐匿射手', 1800, ['stealth'], '范围破隐与全场灼燃破隐'),
  mechanismDummy('enemy_1112_emppnt', '帝国炮火先兆者', 13000, ['fly', 'elite'], '飞行、延迟炮击；用于起飞阻挡和对空攻击'),
  mechanismDummy('enemy_1005_yokai_2', '妖怪MKII', 1550, ['fly'], '有来源的空中普攻，用于 30% 对空庇护'),
  mechanismDummy('enemy_1305_mhslim_2', '炽焰源石虫', 1800, ['burn'], '攻击附带灼燃损伤，用于免疫对照'),
  mechanismDummy('enemy_10034_cnvsax', '爵士乐手', 10000, ['burn', 'stealth'], '持续施法遇沉默中断，用于焚尽窗口'),
  mechanismDummy('enemy_1081_sotisd', '游击队盾卫', 15000, ['elite'], '保留高防高法抗，用于元素伤害与多目标'),
  // 焦香螺旋桨：2 万血 → 200 万血，其余（攻击、防御、法抗、速度、热浪）全部保留原值
  mechanismDummy('enemy_10150_nsheat_2', '焦香螺旋桨', 20000, ['burn', 'fly'], '不分敌我地赋予灼燃损伤；可对空，用于免疫对照'),
  // 炙烤螺旋桨：1.5 万血 → 200 万血，其余保持原值（360 攻 / 半径2.0 / 每击 36 点灼燃）
  mechanismDummy('enemy_10150_nsheat', '炙烤螺旋桨', 15000, ['burn', 'fly'], '同类低配版；持续灼燃，用于免疫对照'),
]);

const library = [...ENEMY_LIBRARY.official, ...ENEMY_LIBRARY.statsOnly];
const byKey = new Map(library.map((enemy) => [enemy.key, enemy]));
const presetKeys = new Set(ENEMY_PRESETS.filter((enemy) => !enemy.mods).map((enemy) => enemy.key));
// 旧预设的位置不变，避免 enemyIndex 型旧波次存档变成另一种敌人。
export const ENEMIES = Object.freeze([
  ...ENEMY_PRESETS.map((enemy) => ({ ...enemy, rank: byKey.get(enemy.key)?.rank || 'NORMAL' })),
  ...library.filter((enemy) => !presetKeys.has(enemy.key)),
]);

/** 工具箱顶部那行筛选片。 */
export const ENEMY_FILTERS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'dummy', label: '木桩' },
  { id: 'normal', label: '普通' },
  { id: 'elite', label: '精英' },
  { id: 'boss', label: '领袖' },
]);

/** 木桩倍率（也用于「原地放置」把普通敌人钉住）。 */
export const DUMMY = DUMMY_MODS;
