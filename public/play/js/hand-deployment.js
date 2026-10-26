import { avatar, tokenIcon } from '../../sandbox/js/asset-urls.js';

const LEGAL = { group: 'hand-deploy-legal', color: 0x80ccff, fill: 0, line: .35 };
const HOVER = { group: 'hand-deploy-hover', color: 0xffb44c, fill: 0.42, line: 2 };

/** DOM 手牌的拖放入口；朝向确认与实际部署由战场控制器接手。 */
export function createHandDeployment({ hand, canvas, getView, getRect, getCard, getError, onSelect, onInspect, onDrop, onCancel, onInvalid }) {
  let pointer = null, ghost = null, pending = null, followFrame = 0;

  function highlight(tiles, style) { getView()?.highlightTiles(tiles, style); }

  function clear() {
    const held = pointer;
    pointer = null;
    if (held && hand.hasPointerCapture(held.pointerId)) hand.releasePointerCapture(held.pointerId);
    pending = null;
    cancelAnimationFrame(followFrame);
    followFrame = 0;
    ghost?.remove(); ghost = null;
    hand.classList.remove('is-deploy-dragging');
    highlight(null, LEGAL); highlight(null, HOVER);
  }

  function cancel() { clear(); onCancel(); }

  function overField(x, y) {
    const hit = document.elementFromPoint(x, y);
    return !!hit && canvas.contains(hit);
  }

  function contains(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function tileAt(x, y) {
    if (!overField(x, y)) return null;
    const view = getView(), rect = getRect();
    let nearest = null, distance = Infinity;
    for (let row = rect.r0; row <= rect.r1; row++) {
      for (let col = rect.c0; col <= rect.c1; col++) {
        const p = view.tileScreen(row, col);
        if (!p?.poly || !contains(p.poly, x, y)) continue;
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < distance) { distance = d; nearest = { row, col }; }
      }
    }
    return nearest;
  }

  function showLegal(id) {
    const rect = getRect(), tiles = [];
    for (let row = rect.r0; row <= rect.r1; row++) {
      for (let col = rect.c0; col <= rect.c1; col++) {
        if (!getError(id, row, col)) tiles.push([row, col]);
      }
    }
    highlight(tiles, LEGAL);
  }

  function createGhost(id) {
    const card = getCard(id);
    ghost = document.createElement('div');
    ghost.className = 'level-deploy-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img'); image.src = card.tokenId ? tokenIcon(card.tokenId) : avatar(card.charId); image.alt = '';
    const name = document.createElement('span'); name.textContent = card.name;
    ghost.append(image, name);
    document.body.append(ghost);
  }

  function positionGhost(x, y, tile, legal) {
    const p = legal && tile ? getView()?.tileScreen(tile.row, tile.col) : null;
    ghost.style.left = `${p ? p.x : x}px`;
    ghost.style.top = `${p ? p.y : y}px`;
    ghost.style.setProperty('--deploy-size', `${p ? Math.max(40, Math.min(92, p.s)) : 64}px`);
    ghost.classList.toggle('is-legal', !!legal);
  }

  function down(e) {
    const card = e.target.closest('[data-act="card"]');
    if (!card || !hand.contains(card) || pointer || e.button !== 0 || !e.isPrimary || !getView()) return;
    if (card.getAttribute('aria-disabled') === 'true') { onInspect(card.dataset.id); e.preventDefault(); return; }
    e.preventDefault(); e.stopPropagation();
    pointer = { id: card.dataset.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', dragging: false };
    hand.setPointerCapture(e.pointerId);
  }

  function move(e) {
    if (!pointer || e.pointerId !== pointer.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    if (!pointer.dragging) {
      if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) < (pointer.touch ? 10 : 6)) return;
      pointer.dragging = true;
      onSelect(pointer.id);
      createGhost(pointer.id);
      hand.classList.add('is-deploy-dragging');
      showLegal(pointer.id);
    }
    const tile = tileAt(e.clientX, e.clientY);
    const legal = tile && !getError(pointer.id, tile.row, tile.col);
    highlight(legal ? [[tile.row, tile.col]] : null, HOVER);
    positionGhost(e.clientX, e.clientY, tile, legal);
  }

  function up(e) {
    if (!pointer || e.pointerId !== pointer.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    const held = pointer;
    pointer = null;
    if (hand.hasPointerCapture(e.pointerId)) hand.releasePointerCapture(e.pointerId);
    hand.classList.remove('is-deploy-dragging');
    if (!held.dragging) { onInspect(held.id); return; }
    const tile = tileAt(e.clientX, e.clientY);
    const error = tile ? getError(held.id, tile.row, tile.col) : null;
    if (!tile || error) {
      cancel();
      if (error) onInvalid(error);
      return;
    }
    highlight(null, LEGAL);
    pending = tile;
    positionGhost(e.clientX, e.clientY, tile, true);
    ghost.classList.add('is-pending');
    if (!onDrop(tile.row, tile.col)) { cancel(); return; }
    if (!pending) return; // A directionless token was committed synchronously.
    const follow = () => {
      if (!pending) return;
      positionGhost(0, 0, pending, true);
      followFrame = requestAnimationFrame(follow);
    };
    follow();
  }

  function interrupted(e) {
    if (pointer && (!e.pointerId || e.pointerId === pointer.pointerId)) cancel();
  }
  function key(e) {
    if (e.key === 'Escape' && pointer) { e.preventDefault(); e.stopImmediatePropagation(); cancel(); }
  }
  function click(e) {
    if (e.detail && e.target.closest('[data-act="card"]')) { e.preventDefault(); e.stopPropagation(); }
  }
  function nativeDrag(e) { e.preventDefault(); }
  function leave() { if (pointer || pending) cancel(); }
  function visibility() { if (document.hidden) leave(); }

  hand.addEventListener('pointerdown', down, true);
  hand.addEventListener('click', click, true);
  hand.addEventListener('dragstart', nativeDrag);
  hand.addEventListener('lostpointercapture', interrupted);
  window.addEventListener('pointermove', move, { capture: true, passive: false });
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', interrupted, true);
  window.addEventListener('keydown', key, true);
  window.addEventListener('blur', leave);
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', visibility);

  return { cancel: clear };
}
