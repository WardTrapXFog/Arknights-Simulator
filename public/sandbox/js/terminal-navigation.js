// Register before the first paint so a direct page load keeps its content hidden until the module is ready.
//
// 工作区页面现在几乎总在 music-shell 的 iframe 里打开，跨文档切换动画由宿主窗口（music-shell.js）统一负责：
// 子文档如果自己也起一份 View Transition，就会和宿主的快照互相打架，只能靠 skipTransition 收场，既没有动画
// 又白白多花一帧时间。所以：被宿主框住时直接跳过子文档的过渡；单独打开某个 /studio/*.html 时仍用下面的
// 跨文档过渡做左右滑动。
(() => {
  const root = document.documentElement;
  const pages = ['/studio/console.html', '/studio/play.html', '/studio/level.html'];
  const framed = window.frameElement?.name === 'simulator-workspace';
  const reduced = () => framed || root.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (pages.includes(location.pathname)) root.dataset.terminalPending = '';
  // Apply the saved palette before a new document can paint its default colors.
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('arksim-sandbox-settings-v1') || '{}') || {}; } catch { /* Use the default palette. */ }
  root.dataset.menuTheme = typeof saved.menuTheme === 'string' ? saved.menuTheme : 'graphite';
  let incoming = null;
  try {
    incoming = JSON.parse(sessionStorage.getItem('arksim-terminal-navigation') || 'null');
    sessionStorage.removeItem('arksim-terminal-navigation');
    sessionStorage.removeItem('arksim-terminal-slide');
  } catch { /* Direct entry has no navigation marker. */ }
  function direction(from, to) {
    const a = pages.indexOf(from), b = pages.indexOf(to);
    return a >= 0 && b >= 0 ? Math.sign(b - a) : 0;
  }
  function prepare(value) {
    if (!value || reduced()) return false;
    root.dataset.terminalNavigation = 'slide';
    root.style.setProperty('--terminal-enter-x', `${value * 100}%`);
    root.style.setProperty('--terminal-exit-x', `${-value * 100}%`);
    return true;
  }
  if (incoming?.to === location.pathname) prepare(incoming.direction);
  // pageswap/pagereveal 给出的 View Transition 在 skipTransition() 时以 AbortError 结束 ready 与 finished，
  // 不接住就是两条未处理的 rejection；这里统一吞掉。
  const settle = (transition) => {
    void transition.ready.catch(() => {});
    void transition.finished.catch(() => {});
    return transition;
  };
  window.addEventListener('pageswap', (event) => {
    if (!event.viewTransition) return;
    // 被宿主框住时子文档不做过渡；直接结束它，动画统一由宿主窗口播放。
    if (framed) { settle(event.viewTransition).skipTransition(); return; }
    const to = event.activation?.entry?.url;
    const value = to ? direction(location.pathname, new URL(to).pathname) : 0;
    if (!prepare(value)) settle(event.viewTransition).skipTransition();
  });
  window.addEventListener('pagereveal', (event) => {
    if (!event.viewTransition) return;
    const from = window.navigation?.activation?.from?.url;
    const value = from ? direction(new URL(from).pathname, location.pathname) : incoming?.direction;
    if (!prepare(value)) event.viewTransition.skipTransition();
    // skipTransition() 会以 AbortError 结束 finished；不接住就会变成一条未处理的 rejection。
    void event.viewTransition.finished.catch(() => {}).finally(() => { delete root.dataset.terminalNavigation; });
  });
})();
