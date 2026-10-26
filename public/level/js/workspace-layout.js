// 一级工作区始终占满可视区域；小窗口按完整布局等比适配。
export function createWorkspaceLayout(root, onResize) {
  let frame = 0;
  const layout = () => {
    const width = document.documentElement.clientWidth, height = window.innerHeight;
    const scale = Math.min(1, width / 960, height / 740);
    root.style.zoom = String(scale);
    root.style.width = `${width / scale}px`;
    root.style.height = `${height / scale}px`;
    root.style.setProperty('--terminal-header-space', `${94 / scale}px`);
    root.style.setProperty('--terminal-footer-space', `${64 / scale}px`);
    onResize?.();
  };
  const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  layout();
  return { resize, destroy() { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); } };
}

export function closePanel(button) { button.closest('dialog')?.close(); }
