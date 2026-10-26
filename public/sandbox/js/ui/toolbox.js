import { esc } from './html.js';
import { ENEMIES, ENEMY_FILTERS } from '../spawn-catalog.js';
import { TERRAIN } from '../battlefield.js';
import { enemyIcon } from '../asset-urls.js';

export function renderDrawer(refs, m, act) {
  refs.drawer.classList.toggle('is-open', !!m.drawerOpen);
  for (const b of refs.drTabs.querySelectorAll('.dr__tab')) b.classList.toggle('is-on', m.drawerOpen && b.dataset.tab === m.tab);
  if (!m.drawerOpen) return;

  const sig = JSON.stringify([m.tab, m.enemy, m.brush, m.rect, m.digest, m.mapJson,
    m.place, m.placeCont, m.route, m.routePop, m.batchSel]);
  if (sig === refs._drawerSig) return;
  refs._drawerSig = sig;

  if (m.tab === 'enemy') refs.drInner.innerHTML = enemyTab(m);
  else refs.drInner.innerHTML = terrainTab(m);
}

const PLACE_MODES = [
  { id: 'tile', label: '点地放置', ico: '📍', hint: '选中敌人后点地图任意格：就地钉住，不移动、只攻击' },
  { id: 'route', label: '画路线', ico: '🧭', hint: '选中敌人后点起点、中继、终点；可设停留' },
  { id: 'delete', label: '删除敌人', ico: '🗑', hint: '点一个敌人立刻删除' },
  { id: 'batch', label: '批量删除', ico: '▣', hint: '框选或点选敌人后点确定' },
];

function enemyTab(m) {
  const list = ENEMIES.map((e, i) => ({ ...e, i })).filter((e) => {
    if (m.enemy.filter === 'all') return true;        // 「全部」就是全部：木桩也在网格里选，不再单设上方快捷卡。
    if (m.enemy.filter === 'dummy') return !!e.dummy;
    if (e.dummy) return false;
    return ({ NORMAL: 'normal', ELITE: 'elite', BOSS: 'boss' })[e.rank] === m.enemy.filter;
  });
  const route = m.route ? routePanel(m) : '';
  const batch = m.place === 'batch'
    ? `<div class="dr__row"><button class="dbtn dbtn--pri" data-act="batch-confirm">确定删除（${m.batchSel.length}）</button>
        <button class="dbtn" data-act="batch-cancel">取消</button></div>`
    : '';

  /* 布局：投放方式 → 筛选片 → 敌人网格（独立滚动）→ 底部路线 / 删除栏 */
  return `
  <div class="dr__head">刷敌人 <small>${list.length} 只</small></div>
  <div class="placegrid">
    ${PLACE_MODES.map((p) => `<button class="place${m.place === p.id ? ' is-on' : ''}" data-act="place" data-m="${p.id}" title="${esc(p.hint)}">
      <i>${p.ico}</i><span>${p.label}</span></button>`).join('')}
  </div>
  <div class="chips">
    ${ENEMY_FILTERS.map((f) => `<button class="chip${m.enemy.filter === f.id ? ' is-on' : ''}" data-act="filter" data-f="${f.id}">${f.label}</button>`).join('')}
    <label class="cont"><input type="checkbox" data-act="place-cont"${m.placeCont ? ' checked' : ''} />连续放置</label>
  </div>
  <div class="egrid-wrap">
    <div class="egrid">
      ${list.map((e) => `<button class="ecard${e.i === m.enemy.index ? ' is-on' : ''}${e.dummy ? ' is-dummy' : ''}"
          data-act="enemy" data-i="${e.i}" title="${esc(e.name)} · ${esc(e.note)}">
        <img src="${esc(enemyIcon(e.key) || '')}" alt="" loading="lazy" />
        <span>${esc(e.short || e.name)}</span>
      </button>`).join('')}
    </div>
  </div>
  <div class="dr__foot">
    ${route}
    ${batch}
    <p class="dr__hint">当前：${esc(ENEMIES[m.enemy.index]?.name || '')} —— ${esc(ENEMIES[m.enemy.index]?.note || '')}</p>
  </div>`;
}

/** 路线栏：起点状态 + 点列表 + 停留 / 结束 / 删除小面板 + 撤销 / 完成 / 取消。 */
function routePanel(m) {
  const rt = m.route;
  const pts = rt.points || [];
  const rows = pts.map((p, i) => {
    const on = m.routePop === i;
    const wait = p.wait > 0 ? `<em>停留 ${p.wait}s</em>` : '';
    return `<button class="rtpt${on ? ' is-on' : ''}" data-act="route-wait" data-i="${i}" title="再点一次这个点可以设停留 / 结束 / 删除">
      <b>${i + 1}</b><span>行${p.r} 列${p.c}</span>${wait}</button>`;
  }).join('');
  const pop = m.routePop != null && pts[m.routePop]
    ? `<div class="rtpop">
        <div class="rtpop__row"><label>停留</label><input id="rt-wait" type="number" min="0" max="600" step="1" value="${pts[m.routePop].wait || 0}" /><span>秒</span>
          <button class="dbtn dbtn--pri" data-act="route-wait">应用</button></div>
        <div class="dr__row"><button class="dbtn" data-act="route-end">结束路线</button><button class="dbtn dbtn--red" data-act="route-del">删除这个点</button></div>
      </div>`
    : '';
  const startTxt = rt.start ? `行${rt.start.r} 列${rt.start.c}` : '未指定（点地图任意格）';
  return `
    <div class="rtpanel">
      <div class="rtpanel__head"><b>起点</b><span>${startTxt}</span>
        <b>终点</b><span>${rt.end ? `行${rt.end.r} 列${rt.end.c}` : '最后一点（原地停留）'}</span></div>
      <div class="rtpts">${rows || '<span class="dr__hint">还没点中继点：点地图加入</span>'}</div>
      ${pop}
      <div class="dr__row">
        <button class="dbtn" data-act="route-undo">撤销</button>
        <button class="dbtn" data-act="route-start-clear">清除起点</button>
        <button class="dbtn dbtn--pri" data-act="route-done">完成</button>
        <button class="dbtn" data-act="route-cancel">取消</button>
      </div>
    </div>`;
}

function terrainTab(m) {
  const R = m.rect || { r0: 9, r1: 12, c0: 0, c1: 10 };
  const d = m.digest || { cells: 0, stand: 0, ground: 0, starts: 0, ends: 0, routed: false };
  const box = (id, v, max) => `<input id="${id}" type="number" min="0" max="${max}" step="1" value="${v}" title="0–${max}" />`;
  return `
  <div class="dr__head">改地形</div>
  <div class="terrgrid">
    ${TERRAIN.map((t) => `<button class="terr ${t.cls}${m.brush === t.g ? ' is-on' : ''}" data-act="brush" data-g="${t.g}" title="${esc(t.hint)}"><i>${t.ico}</i>${t.label}</button>`).join('')}
  </div>
  <p class="dr__hint">选一种图块后点地图任意格（改完 0.45 秒自动重建对局：敌人路线是引擎现场算的流场，地形一变就重算）。
  <b>想要更多格子</b>：把下面「战场范围」撑大，再在范围里刷「地面」。</p>

  <div class="dr__head" style="margin-top:.04rem">战场范围 <small>（行 0–18 · 列 0–20）</small></div>
  <div class="rcgrid">
    <label>行起${box('rc-r0', R.r0, 18)}</label>
    <label>行止${box('rc-r1', R.r1, 18)}</label>
    <label>列起${box('rc-c0', R.c0, 20)}</label>
    <label>列止${box('rc-c1', R.c1, 20)}</label>
    <button class="dbtn dbtn--pri" data-act="rect-apply" title="应用范围并重建对局">应用</button>
  </div>
  <p class="dr__hint">战场范围 = 引擎真正认的棋盘（rect）。当前 <b>${R.r1 - R.r0 + 1} 行 × ${R.c1 - R.c0 + 1} 列 = ${d.cells} 格</b>，
  能站人 ${d.stand} 格 / 地面敌人能走 ${d.ground} 格；红门 ${d.starts} 道、蓝门 ${d.ends} 道${d.routed ? '' : '（<b>没有路线</b>：至少各要一道）'}。</p>

  <div class="dr__row">
    <button class="dbtn" data-act="map-reset">恢复 8×17 空白沙盘</button>
  </div>
  <div class="dr__row">
    <button class="dbtn dbtn--blue" data-act="map-export">导出地图</button>
    <button class="dbtn" data-act="map-import">用框内地图替换</button>
  </div>
  <textarea class="dr__json" id="map-json" spellcheck="false" placeholder="地图 JSON：{ &quot;rows&quot;: [ 19 行 × 21 字符 ], &quot;rect&quot;: { &quot;r0&quot;:9, &quot;r1&quot;:12, &quot;c0&quot;:0, &quot;c1&quot;:10 } }">${esc(m.mapJson || '')}</textarea>`;
}
