import { SAVE_KEY, DEFAULT_SQUAD } from './state.js';
import { ROWS, COLS, newStage, normRect } from './battlefield.js';

export const SLOT_COUNT = 6;
const SLOTS_KEY = 'arksim-sandbox-slots-v1';
const ACTIVE_KEY = 'arksim-sandbox-active-slot';

export function activeSaveSlot() {
  const raw = globalThis.sessionStorage.getItem(ACTIVE_KEY);
  const index = raw === null ? null : Number(raw);
  return Number.isInteger(index) && index >= 0 && index < SLOT_COUNT ? index : null;
}

export function selectSaveSlot(index) {
  if (index === null) globalThis.sessionStorage.removeItem(ACTIVE_KEY);
  else { checkIndex(index); globalThis.sessionStorage.setItem(ACTIVE_KEY, String(index)); }
}

/** 快存和换图共用；无绑定槽位时使用空槽，满槽时由用户选择。 */
export function quickSaveSandbox(save) {
  const slots = listSaveSlots();
  let index = activeSaveSlot();
  if (index === null || !slots[index]) index = slots.findIndex((s) => !s);
  if (index < 0) throw new Error('存档位已满，请先在管理存档中选择一个槽位保存。');
  writeSaveSlot(index, save, slots[index]?.name || `沙盒 ${index + 1}`);
  selectSaveSlot(index);
  return index;
}

function validSave(save) {
  return Array.isArray(save?.stage?.rows) && save.stage.rows.length === ROWS
    && save.stage.rows.every((row) => typeof row === 'string' && row.length === COLS);
}

export function newSandbox() {
  const stage = newStage();
  return { format: 3, stage: { ...stage, rect: normRect(stage.rect) }, waves: [], spawns: null,
    levelName: null, squad: DEFAULT_SQUAD.slice(), operators: [], skillSelections: {}, nextEnemyId: 1,
    session: null, settings: { board: '3d', speed: 1, payDp: false } };
}

function readSlots(storage) {
  const raw = storage.getItem(SLOTS_KEY);
  if (raw) {
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.slots)) throw new Error('存档库格式无法读取，原始存档已保留。');
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const slot = data.slots[i];
      return slot ? { ...slot, damaged: !validSave(slot.save) } : null;
    });
  }
  const slots = Array(SLOT_COUNT).fill(null);
  const legacy = storage.getItem(SAVE_KEY);
  if (legacy) {
    let save;
    try { save = JSON.parse(legacy); } catch { throw new Error('上次存档无法读取，原始存档已保留。'); }
    if (!validSave(save)) throw new Error('上次存档的地图不完整，原始存档已保留。');
    slots[0] = { name: '上次的沙盒', updatedAt: Date.now(), save };
  }
  writeSlots(slots, storage);
  return slots;
}

function writeSlots(slots, storage) {
  try { storage.setItem(SLOTS_KEY, JSON.stringify({ version: 1, slots })); }
  catch { throw new Error('本地存储不可用或空间不足，未能写入存档。'); }
}

function checkIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) throw new Error(`请选择 1–${SLOT_COUNT} 号存档位。`);
}

export function listSaveSlots(storage = globalThis.localStorage) { return readSlots(storage); }

export function writeSaveSlot(index, save, name, storage = globalThis.localStorage) {
  checkIndex(index);
  if (!validSave(save)) throw new Error('地图数据不完整，未能保存。');
  const slots = readSlots(storage);
  slots[index] = { name: String(name || `沙盒 ${index + 1}`).trim().slice(0, 40) || `沙盒 ${index + 1}`,
    updatedAt: Date.now(), save: JSON.parse(JSON.stringify(save)) };
  writeSlots(slots, storage);
}

export function deleteSaveSlot(index, storage = globalThis.localStorage) {
  checkIndex(index);
  const slots = readSlots(storage);
  slots[index] = null;
  writeSlots(slots, storage);
  if (activeSaveSlot() === index) selectSaveSlot(null);
}

export function copySaveSlot(from, to, storage = globalThis.localStorage) {
  checkIndex(from);
  checkIndex(to);
  if (from === to) throw new Error('请选择另一个存档位。');
  const source = readSlots(storage)[from];
  if (!source || source.damaged) throw new Error('这个存档无法复制。');
  writeSaveSlot(to, source.save, `${source.name} · 副本`, storage);
}

export function activateSave(save, storage = globalThis.localStorage) {
  if (!validSave(save)) throw new Error('这个存档无法载入。');
  try { storage.setItem(SAVE_KEY, JSON.stringify(save)); }
  catch { throw new Error('无法写入本地存储，未能载入地图。'); }
}
