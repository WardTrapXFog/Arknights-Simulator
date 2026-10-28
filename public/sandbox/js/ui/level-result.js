import { scoreTableMarkup } from './scoreboard.js';
import { esc } from './html.js';
import { groundPlaneTransform } from '../ground-plane.js';
import { loadLevels, listLevels, lastLevelsError, saveLevel, uniqueName, nameTaken } from '../../../level/js/level-store.js';
import { fadeOutLevelBgm } from '../level-bgm.js';

/** 仅消费结算时的快照；延迟和入场动效不参与战斗推进。 */
export function createLevelResult({ battle, run, canvas, getView, preferences, reduceMotion, onRetry }) {
  const success = battle.reason === 'cleared' && battle.leakedCount < battle.flags.lifeLimit;
  const report = { killed: battle.killed, leaked: battle.leakedCount, time: battle.time,
    life: Math.max(0, battle.flags.lifeLimit - battle.leakedCount), lifeLimit: battle.flags.lifeLimit,
    score: structuredClone(battle.sandboxScore.read()) };
  const born = performance.now();
  const delay = reduceMotion ? 120 : 450;
  let begun = false, cueDone = false, fallbackAt = Infinity, exitAt = null, cue = null;
  fadeOutLevelBgm();
  const layer = document.createElement('div');
  layer.className = `operation-complete${success ? '' : ' operation-failure'}${reduceMotion ? ' is-reduced' : ''}`;
  layer.tabIndex = -1;
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-label', success ? '模拟完成，作战成功' : '作战失败，等待提示后点击继续');
  layer.innerHTML = `<div class="operation-complete__anchor"><div class="operation-complete__plane">
    <div class="operation-complete__band"><div class="operation-complete__content">
      ${success ? '<div class="operation-complete__logo"><img src="/icons/app.svg" alt="ARK/SIM"></div>' : '<div class="operation-failure__signal" aria-hidden="true">×</div>'}
      <div class="operation-complete__title"><strong data-title="${success ? '模拟完成' : '作战失败'}">${success ? '模拟完成' : '作战失败'}</strong><span>${success ? 'SIMULATION COMPLETE' : 'OPERATION FAILED'}</span><small>${success ? '作战成功' : '目标生命耗尽'}</small></div>
    </div></div></div></div>${success ? '' : '<div class="operation-failure__scan" aria-hidden="true"></div><p class="operation-failure__continue">点击任意处继续</p>'}`;
  const continueReport = () => { if (!success && cueDone && !destroyed && !dialog) openReport(); };
  layer.addEventListener('click', continueReport);
  layer.addEventListener('keydown', (event) => {
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Enter' || event.key === ' ') continueReport();
  });
  document.body.append(layer); layer.focus({ preventScroll: true });
  const anchor = layer.firstElementChild, plane = anchor.firstElementChild;
  let dialog = null, destroyed = false;

  function finishCue() { cueDone = true; layer.classList.add('is-ready'); }
  function startCue() {
    begun = true; layer.classList.add('is-visible');
    cue = new Audio(`/assets/custom/ui/settlement/${success ? 'mission-accomplished' : 'mission-failed'}.wav`);
    cue.volume = preferences.muted ? 0 : preferences.sfx;
    cue.addEventListener('ended', finishCue, { once: true });
    const unavailable = () => { if (!destroyed && !cueDone && fallbackAt === Infinity) fallbackAt = performance.now() + (success ? 2289 : 2293); };
    cue.addEventListener('error', unavailable, { once: true });
    void cue.play().catch(unavailable);
  }

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
          if (!listLevels().some((level) => level.id === run.levelId)) {
            // 临时玩过、库里没有的关卡：存进库时若名字已被别的关卡占着，就换上原名 2、原名 3……，
            // 不能覆盖别人的文件。
            const level = structuredClone(run.level);
            if (nameTaken(level.name)) level.name = uniqueName(level.name);
            await saveLevel(level, {}, { wait: true });
          }
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
    if (!begun && elapsed >= delay) startCue();
    if (!cueDone && now >= fallbackAt) finishCue();
    if (success && cueDone) {
      if (exitAt === null) { exitAt = now + (reduceMotion ? 80 : 240); layer.classList.add('is-leaving'); }
      if (now >= exitAt) { openReport(); return; }
    }
    const box = canvas.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height * .46;
    anchor.style.left = `${x}px`; anchor.style.top = `${y}px`;
    layer.style.setProperty('--complete-width', `${Math.min(1100, box.width * .86)}px`);
    const view = getView();
    if (view) plane.style.transform = groundPlaneTransform(view, canvas, x, y);
  }

  function destroy() {
    destroyed = true; layer.remove();
    if (cue) { cue.pause(); cue.removeAttribute('src'); cue.load(); cue = null; }
    if (dialog?.open) dialog.close();
    dialog?.remove();
    window.removeEventListener('pagehide', destroy);
  }
  window.addEventListener('pagehide', destroy, { once: true });
  return { paint, destroy };
}
