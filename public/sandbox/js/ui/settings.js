import { saveSettings, MENU_THEMES } from '../settings.js';
import { KEY_ACTIONS, getKeybinds, setKeybind, keyLabel } from '../keybinds.js';
import { loadMenuMusic } from '../menu-audio.js';

/** 键位显示：单个字符原样，其余用可读写法。 */

export function openSettings({ settings, onChange, onClose, global = false }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'saves sandbox-settings';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  let value = { ...settings };
  const toggle = (key, label) => `<label class="settings__row"><span>${label}</span><input type="checkbox" data-setting="${key}" ${value[key] ? 'checked' : ''}></label>`;
  const select = (key, label, choices) => `<label class="settings__row"><span>${label}</span><select data-setting="${key}">${choices.map(([id, name]) => `<option value="${id}" ${value[key] === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label>`;
  const volume = (key, label) => `<label class="settings__row"><span>${label}</span><input type="range" min="0" max="100" value="${Math.round(value[key] * 100)}" data-setting="${key}"><output data-volume="${key}">${Math.round(value[key] * 100)}%</output></label>`;
  const binds = getKeybinds();
  const keys = () => KEY_ACTIONS.map(([action, label]) => `<label class="settings__row"><span>${label}</span><button type="button" class="settings__key" data-keybind="${action}">${keyLabel(binds[action])}</button></label>`).join('');
  dialog.innerHTML = `<header class="saves__head"><h2 id="settings-title">${global ? '全局设置' : '局内设置'}</h2><button type="button" class="menu__button" data-close>关闭 ×</button></header>
    <div class="settings__sections">${global ? `<section class="settings__appearance"><h3>局外主题</h3><div class="settings__themes" role="radiogroup" aria-label="局外界面主题">${MENU_THEMES.map((theme) => `<label class="settings__theme" data-theme-choice="${theme.id}"><span class="settings__theme-swatch" aria-hidden="true"><i></i><i></i><i></i></span><input type="radio" name="menu-theme" data-setting="menuTheme" value="${theme.id}"${value.menuTheme === theme.id ? ' checked' : ''}><strong>${theme.name}</strong><small>${theme.detail}</small></label>`).join('')}</div></section>` : ''}<section><h3>声音</h3>${toggle('muted', '静音')}${volume('sfx', '战斗与界面音效')}${volume('voice', '干员语音')}
    ${volume('bgm', '背景音乐')}${toggle('menuBgm', '局外背景音乐')}${global ? '<div class="settings__music"><label class="settings__row"><span>局外音乐曲目</span><select data-setting="menuBgmTrack" aria-label="局外音乐曲目" disabled><option>读取曲目中…</option></select></label><button type="button" class="menu__button" data-music-refresh>刷新曲目</button></div>' : ''}${select('voiceLang', '语音语言', [['cn','中文'],['jp','日语'],['en','英语'],['kr','韩语']])}${toggle('voiceNative', '优先使用本土语言')}</section>
    <section><h3>画面与战斗信息</h3>${select('quality', '画质', [['high','高'],['medium','中'],['low','低']])}
    ${select('officialFx', '官方特效', [['off','关闭'],['lite','精简'],['full','完整'],['auto','自动']])}
    ${toggle('damageNumbers', '显示伤害数字')}${toggle('officialDamageNumbers', '使用官方伤害字形')}${toggle('ammoEnergyCount', '显示弹药与能量数量')}
    ${select('textSize', '文字大小', [['sm','小'],['md','中'],['lg','大'],['xl','特大']])}${toggle('reduceMotion', '减少界面动态效果')}</section>
    ${global ? '' : `<section><h3>快捷键</h3>${keys()}<p class="settings__hint">点一下右边再按任意键即可改绑；Esc 取消。步进一帧：没暂停会先暂停。技能与撤退作用于鼠标所指的干员。</p></section>`}</div>
    <p class="saves__status" role="status"></p>`;
  dialog.addEventListener('input', (e) => {
    const input = e.target;
    const key = input.dataset.setting;
    if (!key) return;
    const nextValue = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) / 100 : input.value;
    try {
      value = saveSettings({ ...value, [key]: nextValue });
      const output = dialog.querySelector(`[data-volume="${key}"]`);
      if (output) output.textContent = `${Math.round(value[key] * 100)}%`;
      onChange(value);
      dialog.querySelector('[role="status"]').textContent = '设置已保存';
    } catch (error) { dialog.querySelector('[role="status"]').textContent = `无法保存设置：${error.message}`; }
  });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  // 改键：点按钮进入捕获态，下一个按键绑定给它；Esc 取消
  let capturing = null;
  dialog.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-keybind]');
    if (!btn) return;
    capturing = btn.dataset.keybind;
    for (const b of dialog.querySelectorAll('[data-keybind]')) b.classList.toggle('is-capturing', b === btn);
    btn.textContent = '按下按键…';
  });
  dialog.addEventListener('keydown', (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();          // 别让这次按键传给局内快捷键
    if (e.key === 'Escape') {
      capturing = null;
      for (const b of dialog.querySelectorAll('[data-keybind]')) { b.classList.remove('is-capturing'); b.textContent = keyLabel(getKeybinds()[b.dataset.keybind]); }
      return;
    }
    const action = capturing;
    setKeybind(action, e.key);
    capturing = null;
    for (const b of dialog.querySelectorAll('[data-keybind]')) { b.classList.remove('is-capturing'); b.textContent = keyLabel(getKeybinds()[b.dataset.keybind]); }
    dialog.querySelector('[role="status"]').textContent = `快捷键已保存：${keyLabel(e.key)}`;
  }, true);
  dialog.addEventListener('close', () => { dialog.remove(); onClose?.(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  if (global) {
    const picker = dialog.querySelector('[data-setting="menuBgmTrack"]');
    const refresh = dialog.querySelector('[data-music-refresh]');
    const reloadMusic = async () => {
      refresh.disabled = true;
      const files = await loadMenuMusic();
      if (!dialog.isConnected) return;
      refresh.disabled = false;
      if (!files) {
        dialog.querySelector('[role="status"]').textContent = '无法读取音乐列表，请重试';
        return;
      }
      picker.replaceChildren();
      for (const file of files) picker.add(new Option(file.name.replace(/\.ogg$/i, ''), file.name));
      if (!files.some((file) => file.name === value.menuBgmTrack)) {
        const missing = new Option(files.length ? '所选曲目已移除，请重新选择' : '暂无可用音乐', value.menuBgmTrack);
        missing.disabled = true;
        picker.add(missing);
      }
      picker.value = value.menuBgmTrack;
      picker.disabled = !files.length;
    };
    refresh.addEventListener('click', reloadMusic);
    void reloadMusic();
  }
}
