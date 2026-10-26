// HUD 图片地址：data/assets.json 的登记素材与完整立绘登记表。
//   干员头像 / 立绘      assets.avatar(charId) / assets.portrait(charId, {e2})
//   技能图标             assets.skillIcon(skillId)（自设干员没注册就返回 null，由 hud.js 画占位）
//   敌人小图标           assets.enemyIcon(enemyKey)
//   HUD 底板 / 血条 / 星级 assets.ui('hudPanel/bg_battle') 等（这些在 sandbox.css 里直接写死路径，不经过这里）
// 拿不到图时返回 FD_AVATAR（一枚灰底剪影 data URI），绝不出现裂图。

import { OPERATOR_ILLUSTRATIONS } from './generated-illustrations.js';

let store = null;
export const portraitFrame = (charId) => OPERATOR_ILLUSTRATIONS[charId] || null;

export function useAssets(a) { store = a; }

const FD_AVATAR = 'data:image/svg+xml;utf8,'
  + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>"
    + "<rect width='100' height='100' fill='#1c2024'/>"
    + "<circle cx='50' cy='37' r='15' fill='#3a4046'/>"
    + "<path d='M17 100c0-18 14-31 33-31s33 13 33 31z' fill='#3a4046'/></svg>");

export const FALLBACK = FD_AVATAR;

const safe = (fn, ...a) => { try { return fn(...a) || null; } catch { return null; } };

export function avatar(charId) {
  if (!store || !charId) return FD_AVATAR;
  if (charId.startsWith('token_')) return tokenIcon(charId);
  return safe(store.avatar, charId) || safe(store.portrait, charId) || FD_AVATAR;
}

export function tokenIcon(tokenId) {
  return store ? safe(store.tokenAvatar, tokenId) || FD_AVATAR : FD_AVATAR;
}

/** 完整立绘优先，其次精二半身图。 */
export function portrait(charId) {
  if (!store || !charId) return FD_AVATAR;
  if (charId.startsWith('token_')) return tokenIcon(charId);
  if (OPERATOR_ILLUSTRATIONS[charId]) return OPERATOR_ILLUSTRATIONS[charId].url;
  const illustration = safe(store.illust, charId, { e2: true });
  if (illustration) return illustration;
  return safe(store.portrait, charId, { e2: true }) || safe(store.avatar, charId) || FD_AVATAR;
}

export function skillIcon(skillId) {
  if (!store || !skillId) return null;
  return safe(store.skillIcon, skillId);
}

export function professionIcon(profession, kind = 'icon') {
  return store ? safe(store.profIcon, profession, kind) : null;
}

export function enemyIcon(key) {
  if (!store || !key) return null;
  return safe(store.enemyIcon, key);
}

/** 星级条底板：官方 charRaritySprite/rarity_N（rarity_N 有 N+1 颗星）。 */
export function rarityStars(rarity) {
  const n = Math.max(0, Math.min(5, (Number(rarity) || 1) - 1));
  return `/assets/ui/charRaritySprite/rarity_${n}.png`;
}

/** 星级 / 阶级的颜色（对应 theme.css 的 --tier-N）。 */
export function rarityColor(rarity) {
  const r = Number(rarity) || 1;
  if (r >= 6) return '#f88000';
  if (r === 5) return '#f8bf00';
  if (r === 4) return '#b06ee8';
  if (r === 3) return '#4a9edb';
  return '#9aa4ab';
}
