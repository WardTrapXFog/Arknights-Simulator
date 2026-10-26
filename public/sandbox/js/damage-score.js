// Read-only accounting of settled allied damage, per operator. The five-second window has a fixed size.
//
// 口径照搬 public/js/battle/metrics.js（原卫戍协议的作战统计）：
//   * 伤害取「伤害来源自身 stats.dmg 的增量」而不是事件里的 amount —— 那是实际打进去的血量（含过量、含 DoT、
//     不含元素条积累），一次结算只加一次，不会因为多段事件重复计；
//   * 召唤物计入其持有者（operatorOf 顺着 ownerUnit 往上找），所以「结构性原理」的伤害算在机械师头上；
//   * 类型桶用事件里的 type，四种之外一律记「真实」。
// DPS 用最近 5 秒（游戏时间）的结算量 ÷ 5：暂停时 time 不走，窗口自然冻结。
const TYPES = ['phys', 'arts', 'elemental', 'true'];
const HZ = 30;
const WINDOW = HZ * 5;
const positive = (value) => Number.isFinite(value) && value > 0 ? value : 0;

/** 伤害来源 → 面板上那一行所属的干员（召唤物 / 替身都算持有者的）。 */
function operatorOf(source) {
  const seen = new Set();
  let u = source;
  while (u && u.kind === 'token' && u.ownerUnit && !seen.has(u)) { seen.add(u); u = u.ownerUnit; }
  return u && u.side === 'ally' && (u.kind === 'op' || u.kind === 'token') ? u : null;
}

export function createDamageScore(battle, saved) {
  const types = Object.fromEntries(TYPES.map((type) => [type, positive(saved?.types?.[type])]));
  // 全局窗口（面板不再显示，但存档里的 total / 快照还用它，别丢）
  const amounts = new Float64Array(WINDOW);
  const marks = new Float64Array(WINDOW).fill(-1);
  const tick = () => Math.floor(battle.time * HZ + 1e-6);
  const current = tick();
  for (const [at, amount] of saved?.recent || []) {
    if (!Number.isInteger(at) || at < 0 || at > current || current - at >= WINDOW) continue;
    marks[at % WINDOW] = at;
    amounts[at % WINDOW] = positive(amount);
  }

  /** 每个干员一行；召唤物归到持有者那一行。 */
  const rows = new Map();
  const rowOf = (source) => {
    const op = operatorOf(source);
    if (!op) return null;
    const key = op.uid != null ? `uid:${op.uid}` : `unit:${op.id}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key, name: op.name || op.def?.name || op.defId, defId: op.defId, charId: op.def?.charId || op.def?.raw?.charId || op.defId, kind: op.kind,
        types: Object.fromEntries(TYPES.map((type) => [type, 0])), total: 0,
        win: new Float64Array(WINDOW), marks: new Float64Array(WINDOW).fill(-1),
      };
      const savedRow = saved?.rows?.find((r) => r.key === key);
      if (savedRow) {
        for (const type of TYPES) row.types[type] = positive(savedRow.types?.[type]);
        row.total = positive(savedRow.total);
      }
      rows.set(key, row);
    }
    return row;
  };
  for (const u of battle.allyUnits || []) rowOf(u);

  // stats.dmg 的增量：每个单位一份上一帧读数
  const seenDmg = new WeakMap();
  for (const u of battle.allyUnits || []) seenDmg.set(u, positive(u.stats?.dmg));

  const hook = battle.on('damaged', ({ source, credit, target, type }) => {
    const src = credit || source;
    if (!src || src.side !== 'ally' || target?.side !== 'enemy') return;
    const total = positive(src.stats?.dmg);
    const delta = positive(total - (seenDmg.get(src) || 0));
    seenDmg.set(src, total);
    if (!delta) return;
    const bucket = TYPES.includes(type) ? type : 'true';
    types[bucket] += delta;
    const at = tick(), index = at % WINDOW;
    if (marks[index] !== at) { marks[index] = at; amounts[index] = 0; }
    amounts[index] += delta;
    const row = rowOf(src);
    if (!row) return;
    row.types[bucket] += delta;
    row.total += delta;
    if (row.marks[index] !== at) { row.marks[index] = at; row.win[index] = 0; }
    row.win[index] += delta;
  }, { priority: Number.MAX_VALUE });

  return {
    read() {
      const at = tick();
      let recent = 0;
      for (let i = 0; i < WINDOW; i++) {
        if (marks[i] <= at && at - marks[i] < WINDOW) recent += amounts[i];
      }
      const list = [];
      for (const row of rows.values()) {
        let recentRow = 0;
        for (let i = 0; i < WINDOW; i++) {
          if (row.marks[i] <= at && at - row.marks[i] < WINDOW) recentRow += row.win[i];
        }
        list.push({ key: row.key, name: row.name, defId: row.defId, charId: row.charId, kind: row.kind, types: { ...row.types }, total: row.total, dps: recentRow / 5 });
      }
      // 总伤降序：谁尽力谁犯罪一眼就看出来
      list.sort((a, b) => b.total - a.total);
      return { types, total: types.phys + types.arts + types.elemental + types.true, dps: recent / 5, rows: list };
    },
    snapshot() {
      const at = tick(), recent = [];
      for (let i = 0; i < WINDOW; i++) {
        if (amounts[i] > 0 && marks[i] <= at && at - marks[i] < WINDOW) recent.push([marks[i], amounts[i]]);
      }
      const list = [...rows.values()].map((row) => ({ key: row.key, name: row.name, defId: row.defId, charId: row.charId, kind: row.kind, types: { ...row.types }, total: row.total }));
      return { types: { ...types }, recent, rows: list };
    },
    clear() {
      for (const type of TYPES) types[type] = 0;
      amounts.fill(0); marks.fill(-1);
      rows.clear();
      for (const u of battle.allyUnits || []) { seenDmg.set(u, positive(u.stats?.dmg)); rowOf(u); }
    },
    stop() { battle.off(hook); },
  };
}