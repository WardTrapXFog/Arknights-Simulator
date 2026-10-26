import { DataSource } from '/sim/simdata.js';
export const PROFESSIONS = [
  ['', '全部'], ['PIONEER', '先锋'], ['WARRIOR', '近卫'], ['SNIPER', '狙击'], ['MEDIC', '医疗'],
  ['CASTER', '术师'], ['SPECIAL', '特种'], ['TANK', '重装'], ['SUPPORT', '辅助'],
];
let library = null;
export async function loadOperatorLibrary(data) {
  if (!library) {
    const response = await fetch('/data/operator-library.json');
    if (!response.ok) throw new Error('满配干员牌库载入失败');
    library = await response.json();
  }
  Object.assign(data.getRaw('chess'), library.operators);
  return library;
}
export function operatorSource(base) {
  return new DataSource({ chess: library.operators, tokens: { ...base.raw.tokens, ...library.tokens } }, base);
}
