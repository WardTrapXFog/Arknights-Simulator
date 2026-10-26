import { icon, iconStroke } from './icons.js';
import { renderPicker } from './picker.js';
import { scoreboardMarkup } from './scoreboard.js';

function shell() {
  return `
<div class="hud" id="hud">
  <div class="hud__canvas" id="hud-canvas"></div>
  <div class="hud__pause" id="hud-pause" aria-hidden="true"><b>PAUSE</b><span>--- 暂停中 ---</span></div>

  <nav class="hud__workspace" aria-label="沙盒菜单">
    <button class="workspace__brand" data-act="home" title="返回三个功能模块的开始菜单">←<span>开始菜单</span></button>
    <details class="workspace__exit" id="battle-exit" hidden>
      <summary class="workspace__brand" title="退出本次作战">←<span>退出战斗</span></summary>
      <div class="workspace__exit-panel">
        <p>退出本次战斗，返回关卡列表？</p>
        <button type="button" data-act="home-confirm">确认</button>
      </div>
    </details>
    <button class="workspace__maps" data-act="new-map" title="自动保存当前现场后直接新建地图">新建地图</button>
    <button class="workspace__save" data-act="saves">管理存档 <span id="active-save-slot">未选</span></button>
    <button class="workspace__quick" id="btn-quick-save" data-act="quick-save" title="快速保存">快存</button>
  </nav>

  <div class="hud__top" role="status" aria-live="off">
    <div class="plate__stat" title="歼灭数（已解决 / 本局排入的总数）">
      <span class="ico">${icon('skull')}</span><span class="plate__readout"><small>歼灭数</small><b id="st-kill">0/0</b></span>
    </div>
    <div class="plate__stat" title="基地生命值：漏 3 只就守不住了（沙盒按 3 条命折算）">
      <span class="ico ico--img" role="img" aria-label="基地生命"></span><span class="plate__readout"><small>基地生命</small><b id="st-life">3</b></span>
    </div>
    <div class="plate__stat" title="作战时间">
      <span class="ico">${icon('clock')}</span><span class="plate__readout"><small>作战时间</small><b id="st-time">00:00</b></span>
    </div>
  </div>

  <div class="hud__caps">
    <div class="caps">
      <button class="cap cap--play" id="btn-play" data-act="play" title="播放 / 暂停（空格）">${icon('pause')}</button>
      <button class="cap" id="btn-speed" data-act="speed" title="倍速：1× / 2× / 4×">1×</button>
      <button class="cap" id="btn-frame" data-act="frame" title="步进一帧">${icon('step')}</button>
      <button class="cap cap--settings" data-act="settings" title="声音、画质与界面设置">设置</button>
    </div>
    <div class="caps caps--sub">
      <button class="cap" id="btn-board" data-act="board" title="画面：3D / 2D">3D</button>
      <button class="cap" id="btn-pay" data-act="pay" title="部署是否扣除 DP">扣费</button>
    </div>
  </div>

  <div class="hud__danger"><button type="button" data-act="reset" title="重置演练，不清空地图；操作前需确认">${icon('reset')}<span>重置演练</span></button></div>

  ${scoreboardMarkup()}

  <div class="hud__dock" id="dock">
    <div class="hud__dp" title="DP：部署费用，自然回复 1 点/秒">
      <i class="dp__icon"></i>
      <div class="dp__stack">
        <b class="dp__num" id="st-dp">30</b>
        <i class="dp__bar"><i id="st-dpfill"></i></i>
      </div>
    </div>
    <div class="hud__hand" id="hand"></div>
  </div>

  <div class="hud__detail" id="detail" aria-live="off"></div>
  <div class="selection-actions" id="selection-actions" hidden></div>

  <aside class="hud__drawer" id="drawer">
    <div class="dr__tabs" id="dr-tabs">
      <button class="dr__tab dr__tab--enemy" data-act="tab" data-tab="enemy" title="刷敌人">${icon('skullHollow', 'icon--fill')}<span>敌人</span></button>
      <button class="dr__tab" data-act="tab" data-tab="terrain" title="改地形">${iconStroke('cube')}<span>地形</span></button>
    </div>
    <div class="dr__panel"><div class="dr__inner" id="dr-inner"></div></div>
  </aside>

  <div class="hud__msg" id="msg"></div>

  <div class="hud__picker" id="picker" role="dialog" aria-label="选择干员">
    <div class="pk">
      <div class="pk__head">
        <h2>加入手牌</h2>
        <input id="pk-search" type="search" placeholder="按名字筛选…" autocomplete="off" />
        <button class="dbtn" data-act="picker-close" style="flex:none">关闭</button>
      </div>
      <div class="pk__grid" id="pk-grid"></div>
    </div>
  </div>

  <div class="hud__spot" id="selspot"></div>
  <div class="hud__sel" id="selmark" aria-hidden="true"><b class="sel__name" data-k="selname"></b></div>

  <div id="hud-wheel" style="position:fixed;inset:0;z-index:70;pointer-events:none"></div>
</div>`;
}

/* -------------------------------------------------------------------------------------------------------------- */
/* 挂载                                                                                                            */
/* -------------------------------------------------------------------------------------------------------------- */

/**
 * 建 HUD 壳并把所有交互接上。
 * @param {HTMLElement} root  #app
 * @param {object} act  回调表（见文件头的 data-act）
 */
export function mount(root, act) {
  root.innerHTML = shell();
  const $ = (id) => document.getElementById(id);

  const refs = {
    hud: $('hud'),
    exitMenu: $('battle-exit'),
    canvas: $('hud-canvas'),
    pause: $('hud-pause'),
    kill: $('st-kill'),
    life: $('st-life'),
    time: $('st-time'),
    dp: $('st-dp'),
    dpFill: $('st-dpfill'),
    playBtn: $('btn-play'),
    speedBtn: $('btn-speed'),
    boardBtn: $('btn-board'),
    payBtn: $('btn-pay'),
    slotLabel: $('active-save-slot'),
    quickSaveBtn: $('btn-quick-save'),
    hand: $('hand'),
    detail: $('detail'),
    selectionActions: $('selection-actions'),
    drawer: $('drawer'),
    drTabs: $('dr-tabs'),
    drInner: $('dr-inner'),
    msg: $('msg'),
    picker: $('picker'),
    pkGrid: $('pk-grid'),
    pkSearch: $('pk-search'),
    wheelHost: $('hud-wheel'),
    selMark: $('selmark'),
    selSpot: $('selspot'),
    selName: document.querySelector('#selmark .sel__name'),
    // 渲染缓存（避免每帧重建 DOM）
    _handSig: '',
    _detailUid: null,
    _drawerSig: '',
    _selOn: false,
    _selUid: null,
    _wired: false,
  };

  // ---- 一个总代理：HUD 里所有 [data-act] 的点击都从这里出去 ----
  refs.hud.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-act]');
    if (!btn || !refs.hud.contains(btn)) return;
    const a = btn.dataset.act;
    const i = btn.dataset.i == null ? null : Number(btn.dataset.i);
    act.onTap?.(btn, a);          // 按键动效 + 音效（main.js 的 actions.onTap）
    switch (a) {
      case 'home': act.onHome?.(); break;
      case 'home-confirm': act.onHomeConfirm?.(); break;
      case 'new-map': act.onNewMap?.(); break;
      case 'quick-save': act.onQuickSave?.(); break;
      case 'settings': act.onSettings?.(); break;
      case 'saves': act.onSaves?.(); break;
      case 'play': act.onPlay?.(); break;
      case 'speed': act.onSpeed?.(); break;
      case 'frame': act.onFrame?.(); break;
      case 'reset': act.onReset?.(); break;
      case 'score-clear': act.onScoreClear?.(); break;
      case 'board': act.onBoard?.(); break;
      case 'pay': act.onPay?.(); break;
      case 'card': act.onCard?.(btn.dataset.id); break;
      case 'card-remove': e.stopPropagation(); act.onCardRemove?.(btn.dataset.id); break;
      case 'skill': e.stopPropagation(); act.onSkill?.(Number(btn.dataset.s)); break;
      case 'picker-open': act.onPickerOpen?.(); break;
      case 'picker-close': act.onPickerClose?.(); break;
      case 'picker-pick': e.stopPropagation(); act.onPickerPick?.(btn.dataset.id); break;
      case 'tab': act.onTab?.(btn.dataset.tab); break;
      case 'enemy': act.onEnemy?.(i); break;
      case 'filter': act.onFilter?.(btn.dataset.f); break;
      case 'place': act.onPlace?.(btn.dataset.m); break;
      case 'place-cont': act.onPlaceCont?.(); break;
      case 'route-start-clear': act.onRouteStartClear?.(); break;
      case 'route-wait': {
        // 从点列表里选中某个点（按钮带 data-i）→ 展开小面板；面板里的「应用」不带 data-i → 提交秒数
        if (btn.dataset.i != null) act.onRoutePick?.(Number(btn.dataset.i));
        else act.onRouteWait?.(refs.drInner.querySelector('#rt-wait')?.value);
        break;
      }
      case 'route-end': act.onRouteEnd?.(); break;
      case 'route-del': act.onRouteDel?.(); break;
      case 'route-undo': act.onRouteUndo?.(); break;
      case 'route-done': act.onRouteDone?.(); break;
      case 'route-cancel': act.onRouteCancel?.(); break;
      case 'batch-confirm': act.onBatchConfirm?.(); break;
      case 'batch-cancel': act.onBatchCancel?.(); break;
      case 'delete-mode': act.onDeleteMode?.(); break;
      case 'spawn-tile': act.onPlace?.('tile'); break;
      case 'brush': act.onBrush?.(btn.dataset.g); break;
      case 'rect-apply': act.onRectApply?.(); break;
      case 'map-reset': act.onMapReset?.(); break;
      case 'map-export': act.onMapExport?.(); break;
      case 'map-import': act.onMapImport?.(); break;
      case 'retreat': act.onRetreat?.(); break;
      case 'unit-skill': act.onUnitSkill?.(); break;
      // 详情面板的「技能 / 特性 / 天赋」三栏切换（与左侧工具箱的 data-act="tab" 区分开）
      case 'dt-tab': e.stopPropagation(); act.onDetailTab?.(btn.dataset.dt); break;
      // 攻击范围 / 技能范围 切换
      case 'unit-range': e.stopPropagation(); act.onUnitRange?.(); break;
      case 'unit-alt': act.onUnitAlt?.(); break;
      case 'unit-equipment': act.onEquipment?.(); break;
      default: break;
    }
  });

  // 路线小面板的秒数是按钮里读的，没有输入框事件；这里仅保留给地图/地形输入框
  refs.drInner.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset?.act) return;
    // 路线面板的秒数在「应用」按钮里读；勾选框/数字框统一走这里
    if (t.dataset.act === 'route-wait-num') act.onRouteWaitNum?.(t.value);
  });

  refs.pkSearch.addEventListener('input', () => renderPicker(refs, act._ops || [], refs.pkSearch.value, act._reserve || []));

  let exitOpen = false;
  const syncExit = () => {
    if (exitOpen === refs.exitMenu.open) return;
    exitOpen = refs.exitMenu.open;
    act.onExitToggle?.(exitOpen);
  };
  refs.exitMenu.addEventListener('toggle', syncExit);
  document.addEventListener('pointerdown', (e) => {
    if (refs.exitMenu.open && !refs.exitMenu.contains(e.target)) { refs.exitMenu.open = false; syncExit(); }
  });

  // 空格 = 播放/暂停（输入框里不抢）；Esc 退出投放状态
  window.addEventListener('keydown', (e) => {
    if (refs.exitMenu.open) {
      if (e.key === 'Escape') { refs.exitMenu.open = false; syncExit(); refs.exitMenu.querySelector('summary').focus(); }
      if (e.key === 'Escape' || e.code === 'Space') e.preventDefault();
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.code === 'Space') { e.preventDefault(); act.onPlay?.(); }
    else if (e.key === 'Escape') { act.onEscape?.(); }
  });

  return refs;
}

/* -------------------------------------------------------------------------------------------------------------- */
/* 顶部数字 / 按钮状态                                                                                              */
