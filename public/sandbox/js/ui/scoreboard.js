// 火力计分板：一个干员一行，物理 / 法术 / 元素 / 真实 / 总伤 / DPS，按总伤降序实时排。
// 数据来自 damage-score.js（口径照搬原卫戍协议的 battle/metrics.js：实际扣血、召唤物计入持有者）。
import { avatar, tokenIcon } from '../asset-urls.js';
import { displayName } from './hand.js';

const COLUMNS = ['phys', 'arts', 'elemental', 'true'];
const LABEL = { phys: '物理', arts: '法术', elemental: '元素', true: '真实' };
/** 行数上限：右侧这块地方够放这些，再多就只留前几名（不加滚动条）。 */
const MAX_ROWS = 12;
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

/** 大数字压成 万 / 亿，一列里塞得下；小于一万照常显示。 */
const compact = (value) => {
  const v = Number.isFinite(value) ? value : 0;
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(v >= 1e6 ? 0 : 1)}万`;
  return number.format(Math.round(v));
};
/** DPS 保留一位小数，同样压单位。 */
const rate = (value) => {
  const v = Number.isFinite(value) ? value : 0;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return v >= 100 ? number.format(Math.round(v)) : (Math.round(v * 10) / 10).toString();
};

export function scoreboardMarkup() {
  return `<aside class="hud__score score" id="damage-score" aria-label="伤害计分板" aria-live="off">
    <header class="score__head"><span><i aria-hidden="true">◆</i> 谁尽力，谁又在犯罪</span><button type="button" data-act="score-clear" title="只清零伤害统计，不改变战场">清零</button></header>
    <table class="score__table">
      <thead><tr><th class="score__unit">干员</th>${COLUMNS.map((key) => `<th class="score__col score__col--${key}">${LABEL[key]}</th>`).join('')}<th class="score__col score__col--total">总伤</th><th class="score__col score__col--dps">DPS</th></tr></thead>
      <tbody data-score-body></tbody>
    </table>
  </aside>`;
}

export function createScoreboard(root) {
  const body = root.querySelector('[data-score-body]');
  let lastDraw = -Infinity, signature = '';

  return {
    render(score, force = false) {
      if (!score || !body) return;
      const now = performance.now();
      // 约 5 Hz：比这更勤没有意义，还会让数字抖得看不清
      if (!force && now - lastDraw < 200) return;
      lastDraw = now;
      const rows = (score.read().rows || []).slice(0, MAX_ROWS);
      // 只在「哪几行、什么顺序、什么数字」变了的时候重建；同内容不碰 DOM
      const sig = rows.map((r) => `${r.key}:${r.types.phys},${r.types.arts},${r.types.elemental},${r.types.true},${Math.round(r.dps)}`).join('|');
      if (sig === signature) return;
      signature = sig;
      body.innerHTML = rows.map((r) => {
        const pic = r.kind === 'token' ? tokenIcon(r.defId) : avatar(r.charId || r.defId);
        return `<tr class="score__row" title="${escapeHtml(r.name)}">
        <td class="score__unit"><span class="score__identity"><img class="score__ava" src="${esc(pic)}" alt="" loading="lazy"><b>${esc(displayName({ name: r.name, defId: r.defId }))}</b></span></td>
        ${COLUMNS.map((key) => `<td class="score__col score__col--${key}">${compact(r.types[key])}</td>`).join('')}
        <td class="score__col score__col--total">${compact(r.total)}</td>
        <td class="score__col score__col--dps">${rate(r.dps)}</td>
      </tr>`;
      }).join('') || '<tr class="score__row score__row--empty"><td class="score__unit" colspan="7">暂无伤害</td></tr>';
    },
  };
}

const esc = (value) => escapeHtml(value);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));