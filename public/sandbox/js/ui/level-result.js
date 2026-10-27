import { scoreTableMarkup } from './scoreboard.js';
import { esc } from './html.js';
import { groundPlaneTransform } from '../ground-plane.js';
import { loadLevels, listLevels, lastLevelsError, saveLevel } from '../../../level/js/level-store.js';

/** 仅消费结算时的快照；延迟和入场动效不参与战斗推进。 */
export function createLevelResult({ battle, run, canvas, getView, reduceMotion, onRetry }) {
  const success = battle.reason === 'cleared' && battle.leakedCount < battle.flags.lifeLimit;
  const report = { killed: battle.killed, leaked: battle.leakedCount, time: battle.time,
    life: Math.max(0, battle.flags.lifeLimit - battle.leakedCount), lifeLimit: battle.flags.lifeLimit,
    score: structuredClone(battle.sandboxScore.read()) };
  const born = performance.now();
  const delay = reduceMotion ? 120 : 450, holdUntil = reduceMotion ? 620 : 1900, finishAt = reduceMotion ? 720 : 2150;
  const layer = document.createElement('div');
  layer.className = `operation-complete${reduceMotion ? ' is-reduced' : ''}`;
  layer.tabIndex = -1;
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-label', `模拟完成，${success ? '作战成功' : '作战失败'}`);
  layer.innerHTML = `<div class="operation-complete__anchor"><div class="operation-complete__plane">
    <div class="operation-complete__band"><div class="operation-complete__content">
      <div class="operation-complete__logo"><img src="/assets/ui/settle/operator_rhodes.png" alt="" aria-hidden="true"><span aria-hidden="true">RI</span><small>RHODES ISLAND</small></div>
      <div class="operation-complete__title"><strong>模拟完成</strong><span>SIMULATION COMPLETE</span><small>${success ? '作战成功' : '作战失败'}</small></div>
    </div></div></div></div>`;
  const logo = layer.querySelector('img');
  logo.addEventListener('load', () => logo.parentElement.classList.add('is-loaded'));
  logo.addEventListener('error', () => logo.remove());
  layer.addEventListener('keydown', (event) => { event.preventDefault(); event.stopPropagation(); });
  document.body.append(layer); layer.focus({ preventScroll: true });
  const anchor = layer.firstElementChild, plane = anchor.firstElementChild;
  let dialog = null, destroyed = false;

  function openReport() {
    layer.remove();
    dialog = document.createElement('dialog');
    dialog.className = 'saves operation-result';
    dialog.setAttribute('aria-labelledby', 'operation-result-title');
    dialog.dataset.outcome = success ? 'success' : 'failure';
    dialog.innerHTML = `<header class="saves__head"><div><span class="operation-result__eyebrow">SIMULATION REPORT</span><h2 id="operation-result-title">${success ? '作战成功' : '作战失败'}</h2></div><span class="operation-result__mark">模拟完成</span></header>
      <div class="operation-result__layout"><section class="operation-result__summary"><h3>${esc(run.levelName)}</h3>
      <dl class="operation-result__stats"><div><dt>歼灭</dt><dd>${report.killed}</dd></div><div><dt>漏敌</dt><dd>${report.leaked}</dd></div><div><dt>用时</dt><dd>${Math.floor(report.time / 60)}:${String(Math.floor(report.time % 60)).padStart(2, '0')}</dd></div><div><dt>目标生命</dt><dd>${report.life} / ${report.lifeLimit}</dd></div></dl>
      <div class="operation-result__actions"><button class="menu__button menu__button--primary" data-result="retry">再次作战</button><button class="menu__button" data-result="squad">重新编队</button><button class="menu__button" data-result="edit">前往关卡编辑器</button><button class="menu__button" data-result="back">返回关卡列表</button></div><p class="saves__status" role="status"></p></section>
      <section class="operation-result__score" aria-label="结算时火力计分板"><h3>火力计分板</h3>${scoreTableMarkup(report.score.rows)}</section></div>`;
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-result]');
      if (!button || button.disabled) return;
      const action = button.dataset.result;
      if (action === 'retry') { destroy(); onRetry(); }
      else if (action === 'squad') location.assign(`/studio/play.html?level=${encodeURIComponent(run.levelId)}&squad=1`);
      else if (action === 'back') location.assign('/studio/play.html');
      else if (action === 'edit') {
        button.disabled = true;
        try {
          await loadLevels();
          if (destroyed) return;
          if (lastLevelsError()) throw new Error(lastLevelsError());
          if (!listLevels().some((level) => level.id === run.levelId)) await saveLevel(run.level, {}, { wait: true });
          if (!destroyed) location.assign(`/studio/level.html?level=${encodeURIComponent(run.levelId)}`);
        } catch (error) {
          if (!destroyed) { button.disabled = false; dialog.querySelector('[role="status"]').textContent = error.message; }
        }
      }
    });
    document.body.append(dialog); dialog.showModal();
  }

  function paint(now) {
    if (destroyed || dialog) return;
    const elapsed = now - born;
    if (elapsed >= finishAt) { openReport(); return; }
    layer.classList.toggle('is-visible', elapsed >= delay);
    layer.classList.toggle('is-leaving', elapsed >= holdUntil);
    const box = canvas.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height * .46;
    anchor.style.left = `${x}px`; anchor.style.top = `${y}px`;
    layer.style.setProperty('--complete-width', `${Math.min(1100, box.width * .86)}px`);
    const view = getView();
    if (view) plane.style.transform = groundPlaneTransform(view, canvas, x, y);
  }

  function destroy() {
    destroyed = true; layer.remove();
    if (dialog?.open) dialog.close();
    dialog?.remove();
    window.removeEventListener('pagehide', destroy);
  }
  window.addEventListener('pagehide', destroy, { once: true });
  return { paint, destroy };
}
