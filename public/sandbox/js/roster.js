// public/studio/js/sandbox/roster.js — 牌库（手牌能放谁）。
//
// 自设名单与演示用原作干员分开维护；全体已接入原作干员从满配目录恢复，普通与进阶共用同一个身份。
// 当前接入塔露拉、自设维娜、自设结城理；新增干员继续向本表追加，不限制槽位数量，
// 手牌、选人器、存档校验都读这张表，不用改别的地方。
//
//   id      chess.json 里的棋子 id（ready 之前为 null）
//   name    选人器上显示的名字（拿不到棋子数据时也用它）
//   owner   自设版的说明（谁的二创）
//   ready   数据接好了没——没接好的槽位在手牌里不出现，在选人器里显示成「预留」

import { CUSTOM_OPS } from './generated-ops.js';
import { OFFICIAL_IDS, OPERATOR_ALIASES } from './generated-library.js';

export const DIY_OPS = CUSTOM_OPS;

/** 数据已接好的自设干员 id（手牌默认阵容、选人器、存档校验都用它）。 */
export const DIY_IDS = Object.freeze(DIY_OPS.filter((o) => o.ready && o.id).map((o) => o.id));

export const isDiy = (id) => DIY_IDS.includes(id);

/** 技能展示所需的支援：复用已有棋子、技能与素材，不另造数值。 */
export const SUPPORT_OPS = Object.freeze([
  { id: 'chess_char_3_16_a', name: '蛇屠箱', role: '拦截敌人，留出攻击窗口' },
  { id: 'chess_char_2_02_a', name: '赫默', role: '治疗，不附加攻击增益' },
  { id: 'chess_char_4_21_a', name: '白面鸮', role: '技力光环，展示技能循环' },
  { id: 'chess_char_5_03_a', name: '烛煌', role: '异路施加灼燃，展示全场天赋联动' },
]);
export const AVAILABLE_IDS = Object.freeze([...new Set([...DIY_IDS, ...OFFICIAL_IDS])]);
export const canonicalOperatorId = (id) => OPERATOR_ALIASES[id] || id;
export const isAvailable = (id) => AVAILABLE_IDS.includes(canonicalOperatorId(id));

/** 自设干员的槽位信息（面板上标「自设」用）。 */
export const slotOf = (id) => DIY_OPS.find((o) => o.id && o.id === id) || null;
