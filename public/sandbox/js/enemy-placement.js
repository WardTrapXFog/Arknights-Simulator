// public/sandbox/js/enemy-placement.js — 刷敌人的全部操作：投放方式、点地放置、画路线、删除。
//
// 这里只处理「敌人怎么进场」：四种互斥的投放方式、路线草稿转成引擎 checkpoints、
// 批量选择的命中判定。视图与抽屉由调用方通过 `host` 注入，本模块不 import HUD。
//
// 投放方式的语义（唯一来源）：
//   点地放置 = 选中敌人后点地板，就地钉住（speedMul 0，不移动、只攻击）。
//   画路线   = 选中敌人后点起点、中继、终点；落点后沿路线行进。
// 红门只是普通格子：想从红门出发，就画路线时把起点点在红门上。

/** 终点停在原地时用的等待时长（远大于一局的时长，等于“停下”）。 */
export const STOP_AT_END = 99999;

/**
 * @param {object} host 由 controller 注入的运行时依赖
 * @param {() => object} host.state 沙盒状态
 * @param {() => boolean} host.alive 会话是否活着（原来叫 battle，返回引擎实例）
 * @param {() => object} host.view 当前战场视图
 * @param {(msg: string, bad?: boolean) => void} host.warn
 * @param {() => void} host.renderDrawer
 * @param {() => void} host.renderHand
 * @param {() => void} host.syncHud
 * @param {(name: string, opts?: object) => void} host.sfx
 * @param {(name: string, opts?: object) => void} host.sfxBattle
 * @param {object} deps 纯数据依赖
 */
export function createEnemyPlacement(host, deps) {
  const { ENEMIES, PINNED_MODS, gatesOf, ENEMY_HIT_RADIUS = 0.6 } = deps;
  const state = host.state;
  const warn = host.warn;

  /** 渲染层的「只认格子」开关：投放方式生效时打开。 */
  function applyTileOnly() {
    try { host.view()?.setTileOnly?.(!!state().ui.place || !!state().ui.active); } catch { /* ignore */ }
  }

  /** 投放状态变化后，统一刷新渲染开关 / 抽屉 / 手牌 / 高亮。 */
  function syncPlaceUi() {
    applyTileOnly();
    paintRoute();
    paintBatch();
    host.renderDrawer(true);
    host.renderHand();
    host.syncHud(true);
  }

  /** 切换投放方式；null 表示退出。 */
  function setPlace(mode) {
    const ui = state().ui;
    const prev = ui.place;
    if (prev === 'route' && mode !== 'route') ui.route = null;
    if (prev === 'route') ui.routePop = null;
    if (prev === 'batch' && mode !== 'batch') ui.batchSel = [];
    ui.place = mode;
    ui.tool = null;
    if (mode && mode !== 'tile') ui.active = null;   // 投放时不占着手牌语义
    if (mode === 'route') ui.route = { start: null, points: [], end: null };
    syncPlaceUi();
    const hint = {
      tile: '点地图任意格放下一只敌人：就地钉住，不移动、只攻击',
      route: '画路线：先点起点（可以点红门），再点中继 / 蓝门；再点已有点可设停留或结束',
      delete: '点地图上的一个敌人，立刻删除',
      batch: '框选或逐个点选敌人，再点「确定」批量删除',
    }[mode];
    if (hint) warn(hint);
  }

  /** 点地放置：在原格刷出一只钉住的敌人（不移动，只攻击）。 */
  function placeEnemyAt(row, col) {
    const ui = state().ui;
    const pick = ENEMIES[ui.enemyIndex];
    if (!pick) return warn('先在面板里选一个敌人', true);
    const e = host.placeEnemy(pick.key, { pos: [row, col], mods: { ...(pick.mods || {}), ...PINNED_MODS } });
    if (!e) return warn('刷怪失败（这一格可能被占了）', true);
    host.saveLocal();
    host.sfxBattle('deploy', { unitKey: `spawn:${e.id}` });
    if (!ui.placeCont) {
      ui.place = null;
      syncPlaceUi();
      warn(`原地放下 ${pick.name}（连续放置关闭，已退出放置状态）`);
    } else {
      warn(`原地放下 ${pick.name} · 连续放置中，继续点地面（Esc 退出）`);
    }
  }

  /** 生成路线对象：把草稿点转成引擎的 checkpoints（MOVE + WAIT），最后收成 end 或超长 WAIT。 */
  function buildRoute() {
    const rt = state().ui.route;
    if (!rt) return null;
    const start = [rt.start.r, rt.start.c];
    const pts = rt.points;
    if (!pts.length && !rt.end) return null;
    const checkpoints = [];
    const addMove = (p, wait) => {
      checkpoints.push({ type: 'MOVE', pos: [p.r, p.c], time: 0 });
      if (wait > 0) checkpoints.push({ type: 'WAIT', pos: [p.r, p.c], time: wait });
    };
    const last = pts[pts.length - 1];
    // 有蓝门终点：所有中继点都走完，最后以蓝门收束
    if (rt.end) {
      for (const p of pts) addMove(p, p.wait || 0);
      return { motion: 'WALK', start, end: [rt.end.r, rt.end.c], checkpoints };
    }
    // 没有蓝门终点：最后一点就是终点，走到后停住（用一个足够长的 WAIT 表示）
    if (!last) return null;
    for (let i = 0; i < pts.length - 1; i++) addMove(pts[i], pts[i].wait || 0);
    addMove(last, Math.max(0, last.wait || 0));
    checkpoints.push({ type: 'WAIT', pos: [last.r, last.c], time: STOP_AT_END });
    return { motion: 'WALK', start, end: null, checkpoints };
  }

  /** 画路线：先点起点，再点中继 / 蓝门；点已有点弹小面板。红门只是普通格子。 */
  function routeTileClick(row, col) {
    const ui = state().ui;
    const rt = ui.route;
    const pick = ENEMIES[ui.enemyIndex];
    if (!rt) return warn('先用「画路线」开始', true);
    if (!rt.start) {
      rt.start = { r: row, c: col };
      paintRoute();
      host.renderDrawer(true);
      host.sfx('pick');
      return warn('起点已设：继续点中继点，或点蓝门 / 再点起点收尾');
    }
    const idx = rt.points.findIndex((p) => p.r === row && p.c === col);
    if (idx >= 0) {
      ui.routePop = ui.routePop === idx ? null : idx;
      host.renderDrawer(true);
      return;
    }
    // 再点一次起点：如果还没有中继点，就以起点为终点（原地放一只，但走的是“画路线”入口）
    if (!rt.points.length && rt.start.r === row && rt.start.c === col) {
      if (!pick) return warn('先选一个敌人', true);
      rt.end = { r: row, c: col };
      spawnRouteEnemy();
      return;
    }
    const gates = gatesOf(state().document.stage);
    const isEnd = gates.ends.some(([r, c]) => r === row && c === col);
    if (isEnd) {
      if (!pick) return warn('先选一个敌人', true);
      rt.end = { r: row, c: col };
      spawnRouteEnemy();
      return;
    }
    rt.points.push({ r: row, c: col, wait: 0 });
    paintRoute();
    host.renderDrawer(true);
    host.sfx('pick');
    warn(`中继点 ${rt.points.length} 已设（再点它可设停留 / 结束 / 删除）`);
  }

  /** 沿当前草稿路线放出一只敌人。 */
  function spawnRouteEnemy() {
    const ui = state().ui;
    const pick = ENEMIES[ui.enemyIndex];
    if (!pick) return warn('先选一个敌人', true);
    const rt = ui.route;
    const route = buildRoute();
    if (!route) return warn('路线还不完整：至少要有起点和终点', true);
    const blocked = firstBlockedSegment(route);
    if (blocked) return warn(`第 ${blocked} 段走不通：中间被墙或高台挡住`, true);
    const e = host.placeEnemy(pick.key, { route, mods: pick.mods ?? null });
    if (!e) return warn('刷怪失败（起点可能被占了）', true);
    host.saveLocal();
    host.sfxBattle('deploy', { unitKey: `spawn:${e.id}` });
    // 连续放置：保留起点与模式，方便连画同构路线；否则退出
    if (ui.placeCont) ui.route = { start: { ...rt.start }, points: [], end: null };
    else { ui.route = null; ui.place = null; }
    syncPlaceUi();
    warn(`${pick.name} 已沿自定义路线出发`);
  }

  /** 逐段检查路线是否走得通（用引擎的真实寻路，忽略阻挡物也走不通才算错）。 */
  function firstBlockedSegment(route) {
    if (!host.alive()) return null;
    const pts = [[route.start[0], route.start[1]]];
    for (const cp of route.checkpoints || []) if (cp.type === 'MOVE' && cp.pos) pts.push([cp.pos[0], cp.pos[1]]);
    if (route.end) pts.push([route.end[0], route.end[1]]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [r0, c0] = pts[i], [r1, c1] = pts[i + 1];
      try {
        const path = host.grid()?.pathBetween?.(r0, c0, r1, c1, { ignoreBlockers: true });
        if (Array.isArray(path) && path.length === 0 && (r0 !== r1 || c0 !== c1)) return i + 1;
      } catch { /* 没有这个查询就当作可走 */ }
    }
    return null;
  }

  /** 高亮当前草稿路线。 */
  function paintRoute() {
    const view = host.view();
    if (!view) return;
    const rt = state().ui.route;
    const pts = [];
    if (rt?.start) pts.push([rt.start.r, rt.start.c]);
    for (const p of rt?.points || []) pts.push([p.r, p.c]);
    if (rt?.end) pts.push([rt.end.r, rt.end.c]);
    view.highlightTiles(pts, { color: 0x6ec8ff, fill: 0.28, line: 0.8, group: 'route' });
  }

  /** 点选/取消一只敌人的批量删除标记。 */
  function toggleBatchAt(row, col) {
    const e = enemyAt(row, col);
    if (!e) return;
    const sel = state().ui.batchSel;
    const i = sel.indexOf(e.id);
    if (i >= 0) sel.splice(i, 1);
    else sel.push(e.id);
    paintBatch();
    host.renderDrawer(true);
  }

  let batchDrag = null;

  function startBatchDrag(e) {
    if (state().ui.place !== 'batch' || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const box = document.createElement('div');
    box.className = 'batch-box';
    document.body.appendChild(box);
    batchDrag = { x0: e.clientX, y0: e.clientY, box, moved: false };
  }

  function moveBatchDrag(e) {
    if (!batchDrag) return;
    const d = batchDrag;
    const x = Math.min(d.x0, e.clientX), y = Math.min(d.y0, e.clientY);
    const w = Math.abs(e.clientX - d.x0), h = Math.abs(e.clientY - d.y0);
    if (w > 3 || h > 3) d.moved = true;
    Object.assign(d.box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const view = host.view();
    const hits = enemiesInScreenRect(x, y, x + w, y + h);
    view?.highlightTiles(hits.map((en) => [Math.round(en.y), Math.round(en.x)]),
      { color: 0xffc27a, fill: 0.2, line: 0.7, group: 'batchHover' });
  }

  function endBatchDrag(e) {
    const d = batchDrag;
    if (!d) return;
    batchDrag = null;
    d.box.remove();
    if (e.type === 'pointercancel') {
      host.view()?.highlightTiles([], { group: 'batchHover' });
      return;
    }
    const x = Math.min(d.x0, e.clientX), y = Math.min(d.y0, e.clientY);
    const w = Math.abs(e.clientX - d.x0), h = Math.abs(e.clientY - d.y0);
    if (d.moved) {
      const hit = enemiesInScreenRect(x, y, x + w, y + h);
      const sel = state().ui.batchSel;
      for (const en of hit) if (!sel.includes(en.id)) sel.push(en.id);
    } else {
      const en = enemiesInScreenRect(e.clientX - 22, e.clientY - 20, e.clientX + 22, e.clientY + 54)[0];
      if (en) {
        const sel = state().ui.batchSel;
        const index = sel.indexOf(en.id);
        if (index < 0) sel.push(en.id); else sel.splice(index, 1);
      }
    }
    const view = host.view();
    view?.highlightTiles([], { color: 0xffffff, fill: 0.1, line: 0.5, group: 'batchHover' });
    paintBatch();
    host.renderDrawer(true);
  }

  /** 屏幕上那个矩形里有哪些敌人（用视图的投影换算）。 */
  function enemiesInScreenRect(x0, y0, x1, y1) {
    const view = host.view();
    if (!view || !host.alive()) return [];
    const out = [];
    for (const e of host.enemies()) {
      if (!e.alive) continue;
      const p = view.tileScreen(Math.round(e.y), Math.round(e.x));
      if (!p) continue;
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push(e);
    }
    return out;
  }

  /** 某格上的敌人（取最近的）。 */
  function enemyAt(row, col) {
    if (!host.alive()) return null;
    let best = null, bestD = ENEMY_HIT_RADIUS;
    for (const e of host.enemies()) {
      if (!e.alive) continue;
      const d = Math.hypot(e.y - row, e.x - col);
      if (d <= bestD) { best = e; bestD = d; }
    }
    return best;
  }

  function deleteEnemyAt(row, col) {
    const e = enemyAt(row, col);
    if (!e) return warn('这一格没有敌人', true);
    killEnemy(e);
  }

  /** 删除敌人：算击杀、不播死亡音（`hitCap` 是现成的“无视觉”kind，再带 consumed 让音频跳过死亡音）。 */
  function killEnemy(e) {
    if (!e || !e.alive) return false;
    const name = e.name ?? e.defId;
    // `['fx','hitCap',…,{ consumed:true }]`：渲染这一侧本来就不画（hitCap 是 a:'none'），
    // 音频这一侧把它记成“用尽”，随后 kill 产生的 die 就不再响“被击倒 / 敌人死亡”。
    try { host.fx('hitCap', { x: e.x, y: e.y, id: e.id, consumed: true }); } catch { /* ignore */ }
    host.kill(e);
    host.removeEnemy(e);
    host.saveLocal();
    warn(`已删除 ${name}`);
    return true;
  }

  function paintBatch() {
    const view = host.view();
    if (!view) return;
    const ids = new Set(state().ui.batchSel);
    const tiles = [];
    for (const e of host.enemies()) {
      if (!e.alive || !ids.has(e.id)) continue;
      tiles.push([Math.round(e.y), Math.round(e.x)]);
    }
    view.highlightTiles(tiles, { color: 0xff4a3d, fill: 0.3, line: 0.9, group: 'batch' });
    view.highlightTiles([], { color: 0xffffff, fill: 0.1, line: 0.5, group: 'batchHover' });
  }

  function clearBatch() {
    state().ui.batchSel = [];
    paintBatch();
    host.renderDrawer(true);
  }

  return {
    applyTileOnly, syncPlaceUi, setPlace,
    placeEnemyAt, routeTileClick, spawnRouteEnemy, buildRoute, firstBlockedSegment,
    paintRoute, toggleBatchAt, startBatchDrag, moveBatchDrag, endBatchDrag,
    enemiesInScreenRect, enemyAt, deleteEnemyAt, killEnemy, paintBatch, clearBatch,
    get batchDrag() { return batchDrag; },
  };
}
