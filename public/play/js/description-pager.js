/** 按说明区域实际宽高排成横向文字页，不缩减正文或引入纵向滚动。 */
export function createDescriptionPager(host) {
  const viewport = host.querySelector('[data-description-viewport]');
  const content = host.querySelector('[data-description-pages]');
  const previous = host.querySelector('[data-description-prev]');
  const next = host.querySelector('[data-description-next]');
  const status = host.querySelector('[data-description-status]');
  let page = 0, count = 1, frame = 0, destroyed = false;

  function paint() {
    content.style.transform = `translateX(${-page * viewport.clientWidth}px)`;
    previous.disabled = page === 0;
    next.disabled = page >= count - 1;
    status.textContent = `${page + 1} / ${count}`;
  }
  function layout() {
    if (destroyed || !viewport.clientWidth || !viewport.clientHeight) return;
    content.style.setProperty('--description-width', `${viewport.clientWidth}px`);
    count = Math.max(1, Math.ceil((content.scrollWidth - 1) / viewport.clientWidth));
    page = Math.min(page, count - 1);
    paint();
  }
  const resize = () => {
    if (destroyed) return;
    cancelAnimationFrame(frame); frame = requestAnimationFrame(layout);
  };
  previous.onclick = () => { page = Math.max(0, page - 1); paint(); };
  next.onclick = () => { page = Math.min(count - 1, page + 1); paint(); };
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  document.fonts.ready.then(resize);
  resize();
  return { destroy() { destroyed = true; observer.disconnect(); cancelAnimationFrame(frame); previous.onclick = next.onclick = null; } };
}
