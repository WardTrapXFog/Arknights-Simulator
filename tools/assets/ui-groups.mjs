// SI 的 UI 素材白名单：三档，分开表达「确定要用」「可能要用」「确定不用」。
//
// 为什么需要它：tools/assets/plan.mjs 原来对 catalog.autochessUi 全量建叶子，没有任何过滤，
// 于是官方联机界面（商店面板、回合开始对话框、结算图、阵营徽标……）的整套素材都被下载下来，
// 而 SI 只用到其中很小一部分。实测 public/assets/ui 落盘 38.7MB，其中约三分之一没有引用。
//
// 三档的判据，写清楚是为了下次有人改这份名单时不用重新推一遍：
//
//   UI_GROUPS        确定要用。判据是**代码里找得到引用点**：模块图可达的 .js、CSS 硬路径、
//                    或按名取用的 artUrls()/uiUrl()。每条都写明引用位置，check-ui-assets.mjs
//                    会反向核对——标了在用却找不到引用的，直接报错。
//   MAYBE_GROUPS     可能要用。判据是**项目自己还没用，但属于三个核心功能将来会碰的东西**：
//                    干员详情要加强、道具栏、效果选择面板这类玩家可见的界面。体积小，留着；
//                    一旦真用上，把它挪进 UI_GROUPS 即可。
//   LEGACY_GROUPS    确定不用。判据是**只服务于已被删除的联机功能**：大厅、房间、匹配、商店、
//                    回合开始/结算对话、羁绊、乐队、奖章。项目里这些界面文件已经不存在
//                    （AGENTS.md 记「联机服务、匹配、大厅、插件工作台与模板已移除」），
//                    留着就是纯重量。settle 与 loading 两组合计 9.2MB，占了大头。
//
// 「没引用」不等于「该删」——这正是要分三档的原因。判据不是引用扫描，而是「这个素材服务于哪个功能」。

/** 确定要用：代码里有引用点。改这里之前请先在源码里确认。 */
export const UI_GROUPS = Object.freeze({
  battle: '战场底图与阴影（render/app.js sprite_shadow）',
  battleUi: '战斗 HUD：血条滑杆、技能就绪、倍速暂停（sandbox.css 硬路径 + UI_EXTRAS）',
  buffIcon: 'Buff／队伍／选项图标（ui/assetUrls.js buffIcon）',
  charRaritySprite: '星级条底板（sandbox/asset-urls.js rarityStars）',
  enemyTypeIcon: '敌人阵营图标（ui/assetUrls.js enemyTypeIcon）',
  entry: '入场背景（render/app.js bg_mountains_tiled + UI_EXTRAS）',
  garrisonTypeIcon: '驻防类型图标（ui/assetUrls.js garrisonTypeIcon）',
  guide: '玩法说明 19 页（ui/guide.js artUrls("guide")）',
  hudPanel: 'HUD 底板与生命图标（sandbox.css 硬路径）',
  modeIcon: '难度徽记（ui/components.js modeIcon）',
  shopCard: '等级徽记（ui/components.js shopCard）',
  skillIcon: '技能图标与空位（assets.js skillIcon/empty）',
  titleIcon: '评语图标（ui/assetUrls.js titleIcon）',
});

/**
 * 可能要用：项目还没引用，但属于三个核心功能会碰的界面元素，体积小，留着。
 * 真用上时把它挪进 UI_GROUPS（并补上引用点），check-ui-assets.mjs 会重新核对。
 */
export const MAYBE_GROUPS = Object.freeze({
  elite: '精英化图标（干员详情将来展示练度时会用到，9KB）',
  eliteLarge: '大号精英化图标（干员详情大图，124KB）',
  rarity: '稀有度星星（比 charRaritySprite 更旧的一套，42KB）',
  rarityYellow: '黄色稀有度星星（12KB）',
  itemRarity: '道具稀有度边框（若做道具栏会用，228KB）',
  effectChoose: '战斗效果选择面板（若做局内效果选择会用，515KB）',
  prepReady: '准备阶段底板（若做开战前准备界面会用，9KB）',
});

/**
 * 确定不用：只服务于已被删除的联机功能（大厅／房间／匹配／商店／羁绊／乐队／奖章／结算对话）。
 * 这些界面文件在项目里已经不存在，素材留着是纯重量。
 */
export const LEGACY_GROUPS = Object.freeze({
  settle: '联机结算界面（screens/settle.js 已删，5.6MB，占最大头）',
  loading: '联机加载插图（arts loadingIllust，3.6MB）',
  statistics: '联机统计模板（statsTemplate，SI 无对应界面）',
  shopPanel: '联机商店面板',
  bandChoose: '联机乐队选择',
  campLogo: '联机阵营徽标（arts campLogo，1.0MB）',
  roundStartDialog: '联机回合开始对话框',
  chessLevelSprite: '联机棋子等级贴图',
  shopLevelSprite: '联机商店等级贴图',
  bondBoardIcon: '联机羁绊棋盘图标',
  charEliteSprite: '联机精英化贴图',
  equipSlot: '联机装备槽',
  equipReplace: '联机装备替换对话框（UI_EXTRAS）',
  bondDetail: '联机羁绊详情（UI_EXTRAS）',
  stageInfo: '联机关卡信息界面（UI_EXTRAS）',
  medalIcon: '联机奖章',
  prepareBkg: '联机准备背景',
  hudBondItem: '联机 HUD 羁绊条目',
  modeChoice: '联机模式选择（UI_EXTRAS）',
  battleReady: '联机开战准备（UI_EXTRAS）',
  emoticon: '联机表情（EMOTE_CATALOG，SI 无表情入口）',
});

/** 真正要下载的分组：确定要用 + 可能要用。 */
export const KEEP_GROUPS = Object.freeze({ ...UI_GROUPS, ...MAYBE_GROUPS });
