/** 列表以每秒 108 个 CSS 像素向下滚动；手动滚动或到达底部时关闭。 */
export function createAutoScroll(list, button, onChange = () => {}) {
  let enabled = false, frame = 0, previous = 0, position = 0, applied = 0;

  function setEnabled(value) {
    cancelAnimationFrame(frame); frame = 0; previous = 0;
    const end = list.scrollHeight - list.clientHeight;
    enabled = !!value && end > 1;
    if (enabled) {
      if (list.scrollTop >= end - 1) list.scrollTop = 0;
      position = applied = list.scrollTop;
      frame = requestAnimationFrame(step);
    }
    button.classList.toggle('is-on', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.title = enabled ? '停止自动滚动' : '慢速向下滚动，到底部停止';
    onChange(enabled);
  }

  function step(now) {
    if (!list.isConnected) { setEnabled(false); return; }
    if (!document.hidden && previous) {
      if (Math.abs(list.scrollTop - applied) > 1) position = list.scrollTop;
      position += 108 * Math.min((now - previous) / 1000, .1);
      list.scrollTop = position;
      applied = list.scrollTop;
      if (applied >= list.scrollHeight - list.clientHeight - 1) { setEnabled(false); return; }
    }
    previous = now;
    frame = requestAnimationFrame(step);
  }

  const toggle = () => setEnabled(!enabled);
  const stop = () => setEnabled(false);
  button.addEventListener('click', toggle);
  list.addEventListener('wheel', stop, { passive: true });
  list.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('pagehide', stop);
  setEnabled(false);
  return {
    setEnabled,
    destroy() {
      stop();
      button.removeEventListener('click', toggle);
      list.removeEventListener('wheel', stop);
      list.removeEventListener('touchstart', stop);
      window.removeEventListener('pagehide', stop);
    },
  };
}
