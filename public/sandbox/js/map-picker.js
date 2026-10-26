import { SLOT_COUNT, listSaveSlots, newSandbox, activateSave, selectSaveSlot } from './save-slots.js';
import { openSaveManager } from './ui/save-manager.js';
import { setTerminalState, terminalTransition, terminalReady } from './terminal-shell.js';

let entering = false;
async function enter(save, index = null) {
  if (entering) return;
  activateSave(save); selectSaveSlot(index); entering = true;
  await terminalTransition(async () => {
    setTerminalState('battle');
    document.getElementById('start')?.remove();
    const app = document.getElementById('app');
    if (app) app.innerHTML = '<div class="st-boot">正在载入自由沙盒…</div>';
    await import('./boot.js');
  });
}
function showError(error) {
  entering = false;
  const status = document.getElementById('start-status');
  if (status) status.textContent = error?.message || String(error);
  else document.getElementById('app').textContent = `载入失败：${error?.message || error}`;
}
function boot() {
  const root = document.getElementById('start');
  if (!root) return;
  root.className = 'sandbox-entry';
  root.innerHTML = '<main id="sandbox-archive"></main><p class="menu__status" id="start-status" role="status"></p>';
  setTerminalState('menu');
  const params = new URLSearchParams(location.search);
  const level = params.get('level');
  if (level) { location.replace(`/studio/play.html?level=${encodeURIComponent(level)}`); return; }
  try {
    listSaveSlots();
    if (params.has('new')) {
      history.replaceState(null, '', location.pathname);
      enter(newSandbox()).catch(showError); return;
    }
    const slot = params.get('slot');
    if (slot !== null) {
      history.replaceState(null, '', location.pathname);
      const index = Number(slot), saved = Number.isInteger(index) && index >= 0 && index < SLOT_COUNT ? listSaveSlots()[index] : null;
      if (!saved || saved.damaged) throw Error('这个存档无法载入，请重新选择。');
      enter(saved.save, index).catch(showError); return;
    }
  } catch (error) { showError(error); }
  openSaveManager({ host: root.querySelector('#sandbox-archive'), onLoad: enter, onNew: (save) => enter(save) });
}
try { boot(); } finally { terminalReady(); }
