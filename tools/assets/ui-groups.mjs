// SI 的 UI 素材白名单：分组名 → 一句用途。
//
// 为什么需要它：tools/assets/plan.mjs 原来对 catalog.autochessUi 全量建叶子，没有任何过滤，
// 于是官方联机界面（商店面板、回合开始对话框、结算图、阵营徽标……）的整套素材都被下载下来，
// 而 SI 只用到其中很小一部分。实测 public/assets/ui 落盘 38.7MB，其中约三分之一没有引用。
//
// 现在 plan.mjs 只按这份名单建 ui 叶子；tools/check-ui-assets.mjs 反向核对：
//   · 名单里的分组必须在代码里找得到引用（标了在用却没人用 = 谎报）；
//   · 清单里出现的分组必须在名单里（多了 = 又在偷偷下载）。
//
// UI_GROUPS    SI 真的会读到的分组。
// LEGACY_GROUPS 联机界面遗留：SI 不读，但当前清单仍在下载。
//               标出来是为了让「还没瘦身」这件事在代码里可见，而不是靠记忆。

/** SI 实际会用到的 UI 分组。改这里之前请先在源码里确认引用点。 */
export const UI_GROUPS = Object.freeze({
  battle: '战场底图与阴影（render/app.js sprite_shadow）',
  battleUi: '战斗 HUD：血条滑杆、技能就绪、倍速暂停（sandbox.css 硬路径 + UI_EXTRAS）',
  buffIcon: 'Buff／队伍／选项图标（ui/assetUrls.js buffIcon）',
  charRaritySprite: '星级条底板（sandbox/asset-urls.js 硬路径）',
  enemyTypeIcon: '敌人阵营图标（ui/assetUrls.js enemyTypeIcon）',
  emoticon: '表情素材分组（shared/constants.js emoteArtGroup 拼 `emoticon/<dir>`）',
  entry: '入场背景（render/app.js bg_mountains_tiled + UI_EXTRAS）',  garrisonTypeIcon: '驻防类型图标（ui/assetUrls.js garrisonTypeIcon）',
  guide: '玩法说明 19 页（ui/guide.js artUrls("guide")）',
  hudPanel: 'HUD 底板与生命图标（sandbox.css 硬路径）',
  modeIcon: '难度徽记（ui/components.js modeIcon）',
  shopCard: '等级徽记（ui/components.js shopCard）',
  skillIcon: '技能图标与空位（assets.js skillIcon/empty）',
  titleIcon: '评语图标（ui/assetUrls.js titleIcon）',
});

/**
 * 联机界面遗留、SI 不读，但当前清单仍在下载的分组。
 * 真要清掉得同时改这里和 plan.mjs，并跑一次 `fetch-assets --prune`；那属于独立的一次素材收尾。
 */
export const LEGACY_GROUPS = Object.freeze({
  settle: '联机结算界面（screens/settle.js 已删，CSS 只剩注释）',
  statistics: '联机统计模板（statsTemplate，SI 无对应界面）',
  shopPanel: '联机商店面板',
  bandChoose: '联机乐队选择',
  campLogo: '联机阵营徽标（arts campLogo）',
  roundStartDialog: '联机回合开始对话框',
  chessLevelSprite: '联机棋子等级贴图',
  shopLevelSprite: '联机商店等级贴图',
  bondBoardIcon: '联机羁绊棋盘图标',
  charEliteSprite: '联机精英化贴图',
  effectChoose: '联机战斗效果选择面板（UI_EXTRAS，SI 无对应界面）',
  equipSlot: '联机装备槽',
  equipReplace: '联机装备替换对话框（UI_EXTRAS）',
  bondDetail: '联机羁绊详情（UI_EXTRAS）',
  itemRarity: '联机道具稀有度边框（arts itemRarityBg）',
  stageInfo: '联机关卡信息界面（UI_EXTRAS）',
  medalIcon: '联机奖章',
  prepareBkg: '联机准备背景',
  hudBondItem: '联机 HUD 羁绊条目',
  elite: '联机精英化图标（arts eliteIcon）',
  eliteLarge: '联机大号精英图标（arts eliteIconLarge）',
  loading: '联机加载插图（arts loadingIllust）',
  modeChoice: '联机模式选择（UI_EXTRAS）',
  battleReady: '联机开战准备（UI_EXTRAS）',
  rarity: '联机稀有度星星（arts rarityStars）',
  rarityYellow: '联机黄色星星（arts rarityStarsYellow）',
  prepReady: '联机准备阶段底板（UI_EXTRAS）',
});

/** 名单里所有合法的分组名。 */
export const KNOWN_GROUPS = Object.freeze(new Set([...Object.keys(UI_GROUPS), ...Object.keys(LEGACY_GROUPS)]));
