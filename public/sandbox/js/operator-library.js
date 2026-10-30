import { DataSource } from '/sim/simdata.js';
export const PROFESSIONS = [
  ['', '全部'], ['PIONEER', '先锋'], ['WARRIOR', '近卫'], ['SNIPER', '狙击'], ['MEDIC', '医疗'],
  ['CASTER', '术师'], ['SPECIAL', '特种'], ['TANK', '重装'], ['SUPPORT', '辅助'],
];
let library = null;
export async function loadOperatorLibrary(data) {
  if (!library) {
    const responses=await Promise.all(['/data/operator-library.json','/data/aue-operators.json'].map(url=>fetch(url)));
    if (responses.some(r=>!r.ok)) throw new Error('满配干员牌库载入失败');
    const [local,native]=await Promise.all(responses.map(r=>r.json()));
    const tokens={...native.tokens};
    for(const [id,record] of Object.entries(local.tokens))tokens[id]={...tokens[id],...record,variants:{...tokens[id]?.variants,...record.variants}};
    library={...local,operators:{...native.operators,...local.operators},tokens};
  }
  Object.assign(data.getRaw('chess'), library.operators);
  return library;
}
export function operatorSource(base) {
  return new DataSource({ chess: library.operators, tokens: { ...base.raw.tokens, ...library.tokens } }, base);
}
