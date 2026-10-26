// public/sandbox/js/keybinds.js — 局内可改键的快捷键表（controller 与设置面板共用，避免循环导入）。
const KEY = 'arksim-sandbox-keybinds-v1';

/** 四个动作与它们的中文名。 */
export const KEY_ACTIONS = Object.freeze([
  ['speed', '切换倍速'],
  ['step', '步进一帧'],
  ['skill', '快速放技能（鼠标所指）'],
  ['retreat', '快速撤退（鼠标所指）'],
]);

/** 默认键位：Tab 切倍速、F 步进、Q 技能、E 撤退。 */
export const DEFAULT_KEYS = Object.freeze({ speed: 'Tab', step: 'F', skill: 'Q', retreat: 'E' });

let keybinds = { ...DEFAULT_KEYS };

/** 键名归一：单个字符一律小写（`e.key` 按 F 给的是 'f'，默认值写成 'F' 会永远匹配不上）。 */
export const normalizeKey = (key) => (typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key);

export function loadKeybinds() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    keybinds = { ...DEFAULT_KEYS };
    // 顺手归一：老存档里可能存着 'F' / 'Q' 这种大写（写默认值时的坑），读回来就能用
    for (const [action] of KEY_ACTIONS) if (typeof saved[action] === 'string' && saved[action]) keybinds[action] = normalizeKey(saved[action]);
  } catch { keybinds = { ...DEFAULT_KEYS }; }
  return keybinds;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(keybinds)); } catch { /* 忽略 */ }
}

export function getKeybinds() { return { ...keybinds }; }

/** 动作 → 键（键已归一，比较时不会再踩大小写）。 */
export function actionFor(key, binds = getKeybinds()) {
  const want = normalizeKey(key);
  for (const action of Object.keys(binds)) if (normalizeKey(binds[action]) === want) return action;
  return null;
}

/** 绑定一个动作：'' 解绑；同一个键只留给最后一个动作。 */
export function setKeybind(action, key) {
  if (!KEY_ACTIONS.some(([a]) => a === action)) return getKeybinds();
  if (key === '') delete keybinds[action];
  else {
    const k = normalizeKey(key);
    for (const other of Object.keys(keybinds)) if (other !== action && normalizeKey(keybinds[other]) === k) delete keybinds[other];
    keybinds[action] = k;
  }
  persist();
  return getKeybinds();
}

/** 键名 → 面板上显示的文字。 */
export function keyLabel(key) {
  if (!key) return '未设置';
  if (key === ' ') return '空格';
  if (key.length === 1) return key.toUpperCase();
  return key;
}