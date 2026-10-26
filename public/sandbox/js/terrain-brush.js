// public/sandbox/js/terrain-brush.js — 改地形：单格上色与按住拖着连续刷。
//
// 「改地形」在沙盒里是一条独立的编辑通道：它只改 stage.rows 的一个字符，然后让战斗重建
// （地形、寻路、渲染读同一张字形表）。这里不碰手牌、详情面板或投放状态。
//
// 拖拽实现不依赖渲染层事件：按下时把 19×21 每格的四角屏幕坐标缓存起来（拖拽期间镜头不动），
// 之后每次 pointermove 在缓存里做一次「点是否落在格子里」，命中新格子才刷。

export function createTerrainBrush(host, deps) {
  const { ROWS, COLS, paintTile } = deps;
  const state = host.state;
  const warn = host.warn;

  let drag = null;
  let rebuildTimer = 0;

  /** 刷一格；地形真的变了才存档并安排重建（改地图要重算寻路，做 450ms 防抖）。 */
  function paintAt(row, col) {
    const s = state();
    const next = paintTile(s.document.stage, row, col, s.ui.brush);
    if (next === s.document.stage) return;
    s.document.stage = next;
    host.saveLocal();
    host.renderDrawer(true);
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      host.resetBattle().catch((e) => warn(String(e?.message || e), true));
    }, 450);
  }

  const inPoly = (poly, x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  function hitTile(x, y) {
    if (!drag) return null;
    let best = null, bestD = Infinity;
    for (const [key, poly] of drag.polys) {
      if (!inPoly(poly, x, y)) continue;
      const cx = (poly[0][0] + poly[2][0]) / 2, cy = (poly[0][1] + poly[2][1]) / 2;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bestD) { bestD = d; best = key; }
    }
    return best;
  }

  function moveDrag(e) {
    const key = hitTile(e.clientX, e.clientY);
    if (key == null || key === drag.last) return;
    const prev = drag.last;
    drag.last = key;
    const r1 = Math.floor(key / COLS), c1 = key % COLS;
    if (prev < 0) { paintAt(r1, c1); return; }
    // 鼠标走得快时两个采样点中间会跳格：用 Bresenham 把中间那些格子补上，拖出来的线才连得上
    let r0 = Math.floor(prev / COLS), c0 = prev % COLS;
    const dx = Math.abs(c1 - c0), sx = c0 < c1 ? 1 : -1;
    const dy = -Math.abs(r1 - r0), sy = r0 < r1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < ROWS * COLS; guard++) {
      paintAt(r0, c0);
      if (r0 === r1 && c0 === c1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; c0 += sx; }
      if (e2 <= dx) { err += dx; r0 += sy; }
    }
  }

  /** 装上拖拽：笔刷工具生效时按下即开始，抬起结束。 */
  function attach(canvas, onOtherDrag) {
    canvas.addEventListener('pointerdown', (e) => {
      if (onOtherDrag?.start?.(e)) return;
      const s = state();
      const view = host.view();
      if (s.ui.tool?.kind !== 'paint' || !view || e.button !== 0) return;
      const polys = new Map();
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const p = view.tileScreen(r, c);
          if (p?.poly?.length === 4) polys.set(r * COLS + c, p.poly);
        }
      }
      drag = { polys, last: -1 };
      moveDrag(e);
    }, { capture: true });
    window.addEventListener('pointermove', (e) => {
      if (drag) moveDrag(e);
      onOtherDrag?.move?.(e);
    });
    const end = (e) => {
      drag = null;
      onOtherDrag?.end?.(e);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  return { paintAt, attach, get dragging() { return !!drag; } };
}
