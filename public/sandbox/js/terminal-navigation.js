// Register before the first paint so cross-document transitions retain the outgoing page during data loading.
(() => {
  const root = document.documentElement;
  const pages = ['/studio/console.html', '/studio/play.html', '/studio/level.html'];
  const reduced = () => root.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  window.addEventListener('pageswap', (event) => {
    if (!event.viewTransition) return;
    const to = event.activation?.entry?.url;
    const value = to ? direction(location.pathname, new URL(to).pathname) : 0;
    if (!prepare(value)) event.viewTransition.skipTransition();
  });
  window.addEventListener('pagereveal', (event) => {
    if (!event.viewTransition) return;
    const from = window.navigation?.activation?.from?.url;
    const value = from ? direction(new URL(from).pathname, location.pathname) : incoming?.direction;
    if (!prepare(value)) event.viewTransition.skipTransition();
    event.viewTransition.finished.finally(() => { delete root.dataset.terminalNavigation; });
  });
})();
