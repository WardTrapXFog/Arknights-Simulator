import { SLOT_COUNT, listSaveSlots, writeSaveSlot, deleteSaveSlot, copySaveSlot, newSandbox } from '../save-slots.js';
import { mapDigest } from '../battlefield.js';
import { esc } from './html.js';
import { levelThumbnail } from '../../../../shared/level-preview.js';
import { newStage } from '../battlefield.js';

/** 入口与战场共用的六槽存档管理。 */
export function openSaveManager({ current, onLoad, onClose, onSaved, onNew, host = null } = {}) {
  if (!host && document.querySelector('.saves[open]')) return;
  const dialog = host || document.createElement('dialog');
  const close = () => host ? onClose?.() : dialog.close();
  dialog.className = 'saves';
  dialog.setAttribute('aria-labelledby', 'saves-title');
  let selected = 0;
  let slots = [];
  let message = '';
  let bad = false;

  function render() {
    let failed = false;
    try { slots = listSaveSlots(); }
    catch (e) { slots = []; message = e.message; bad = failed = true; }
    const slot = slots[selected];
    const readable = slot && !slot.damaged;
    const cards = slots.map((item, i) => {
      const digest = item && !item.damaged ? mapDigest(item.save.stage) : null;
      const date = item ? new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
      return `<button type="button" class="saves__slot${i === selected ? ' is-on' : ''}" data-slot="${i}" aria-pressed="${i === selected}">
        <span class="saves__number">0${i + 1}</span><span class="saves__slotbody"><b>${esc(item?.name || '空存档位')}</b>
        <small>${item ? esc(item.damaged ? '数据损坏 · 可覆盖或删除' : `${digest.cells} 格 · 已部署 ${item.save.operators?.length || 0} · 敌人 ${(item.save.spawns || item.save.waves || []).reduce((n, s) => n + (s.count ?? 1), 0)}`) : '可新建存档'}</small>
        <time>${esc(date)}</time></span><span class="saves__mark">${item ? '●' : '＋'}</span></button>`;
    }).join('');
    dialog.innerHTML = `<header class="saves__head"><div><span class="menu__eyebrow">LOCAL ARCHIVE / 0${SLOT_COUNT}</span><h2 id="saves-title">本地存档</h2></div>
      <button type="button" class="menu__button" data-save="close" aria-label="关闭存档窗口">关闭 ×</button></header>
      ${onNew ? '<button type="button" class="menu__button menu__button--primary" data-save="new">＋ 新建空白沙盒</button>' : ''}
      <p class="saves__intro">保存此刻在场的干员、敌人、当前位置、血量、技力和地图，载入后暂停。</p>
      <div class="saves__layout"><div class="saves__list">${cards}</div><section class="saves__detail">
      <span class="menu__eyebrow">ARCHIVE / 0${selected + 1}</span><h3>${esc(slot?.name || '新建沙盒存档')}</h3>
      ${readable && slot.save.format !== 3 ? `<p class="saves__note">${slot.save.format === 2 ? '旧格式按原有布置清单载入；重新保存后只记录当前现场。' : '早期存档未记录场上单位，可重新布置后覆盖保存。'}</p>` : ''}
      <label class="saves__label">存档名称<input id="save-name" maxlength="40" value="${esc(slot?.name || `沙盒 ${selected + 1}`)}" ${failed ? 'disabled' : ''}></label>
      <button type="button" class="menu__button menu__button--primary" data-save="load" ${readable ? '' : 'disabled'}>载入此存档 →</button>
      <button type="button" class="menu__button" data-save="write" ${failed ? 'disabled' : ''}>${slot ? current ? '覆盖此存档' : '保存名称' : current ? '保存当前沙盒' : '新建存档'}</button>
      ${readable ? `<label class="saves__label">复制到<select id="save-target">${slots.map((item, i) => i === selected ? '' : `<option value="${i}">0${i + 1} · ${esc(item?.name || '空存档位')}</option>`).join('')}</select></label>
      <button type="button" class="menu__button" data-save="copy">复制存档</button>` : ''}
      <button type="button" class="menu__button menu__button--danger" data-save="delete" ${slot ? '' : 'disabled'}>删除此存档</button>
      <p class="saves__note">${current ? '只保存此刻仍在场的单位，已退场、死亡或尚未出现的单位不进入新存档。' : '新建使用 8 × 17 空白沙盘。'}进行中的技能、异常状态与弹道不恢复。清除网站数据会删除存档。</p>
      </section></div><p class="saves__status${bad ? ' is-bad' : ''}" role="status">${esc(message)}</p>`;
    if (host) {
      const list = dialog.querySelector('.saves__list').outerHTML;
      const detail = dialog.querySelector('.saves__detail').outerHTML;
      const status = dialog.querySelector('.saves__status').outerHTML;
      dialog.innerHTML = `<div class="sandbox-archive"><section class="sandbox-archive__preview"><span class="menu__eyebrow">SANDBOX / ARCHIVE 0${selected + 1}</span><h1>${esc(slot?.name || '空白沙盒')}</h1><img src="${esc(levelThumbnail(readable ? slot.save.stage : newStage()))}" alt="所选沙盒地图预览"><p>${readable ? `已部署 ${slot.save.operators?.length || 0} 名干员 · ${mapDigest(slot.save.stage).cells} 格战场` : slot?.damaged ? '这个存档无法读取，可选择其他存档或新建沙盒。' : '选择一个存档继续演练，或创建新的空白沙盒。'}</p></section><section class="sandbox-archive__manage"><header class="saves__head"><h2 id="saves-title">本地存档</h2><button type="button" class="menu__button" data-save="new">＋ 新建空白沙盒</button></header>${list}${detail}${status}</section></div>`;
      const actions = dialog.querySelector('.saves__detail');
      for (const button of actions.querySelectorAll('button')) button.classList.add('saves__action');
    }
  }

  dialog.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-slot]');
    if (card) { selected = Number(card.dataset.slot); message = ''; bad = false; render(); return; }
    const btn = e.target.closest('[data-save]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.save;
    if (action === 'close') { close(); return; }
    try {
      if (action === 'new') { await onNew?.(newSandbox()); close(); return; }
      // 每次操作前重新读取，使用当前槽位内容。
      slots = listSaveSlots();
      const slot = slots[selected];
      if (action === 'load') {
        if (current && !window.confirm('载入此现场并暂停？当前未保存到槽位的修改将被替换。')) return;
        if (!slot || slot.damaged) throw new Error('这个存档无法载入。');
        await onLoad?.(slot.save, selected);
        close();
        return;
      }
      if (action === 'write') {
        if (slot && current && !window.confirm(`覆盖「${slot.name}」？`)) return;
        writeSaveSlot(selected, current ? current() : slot && !slot.damaged ? slot.save : newSandbox(), dialog.querySelector('#save-name').value);
        onSaved?.(selected);
        message = `已保存到 0${selected + 1} 号存档位`;
      }
      if (action === 'delete') {
        if (!slot || !window.confirm(`删除「${slot.name}」？此操作无法撤销。`)) return;
        deleteSaveSlot(selected);
        message = `已清空 0${selected + 1} 号存档位`;
      }
      if (action === 'copy') {
        const to = Number(dialog.querySelector('#save-target').value);
        if (slots[to] && !window.confirm(`覆盖目标存档「${slots[to].name}」？`)) return;
        copySaveSlot(selected, to);
        selected = to;
        message = `已复制到 0${to + 1} 号存档位`;
      }
      bad = false;
    } catch (e) { message = e?.message || String(e); bad = true; }
    render();
  });
  if (!host) {
    dialog.addEventListener('close', () => { dialog.remove(); onClose?.(); }, { once: true });
    document.body.append(dialog);
  }
  render();
  if (!host) dialog.showModal();
}
