import { setTerminalState } from './terminal-shell.js';
// public/sandbox/js/main.js — 关卡模拟器（/studio/console.html 的入口）。
//
// 页面在浏览器里直接跑引擎（/sim/ 与 /data/ 都是静态挂载），不连服务器、不要工作台密钥：
//   const ds = new DataSource({ stages: { sandbox: stage } }, sim.ds)   // 自定义地图叠在官方数据之上
//   const b  = createBattleFromSpec(buildBattleSpec({...}), ds)          // 与服务器同构的一场战斗
// 局内操作直接调 battle 的方法（没有指令协议层）：
//   部署干员  battle._createAllyFromInput(ps, {chessId,row,col,dir,skillIndex}) + battle._deploy(u)
//   开技能    unit.skill.activate('manual')
//   刷敌人    battle.spawnEnemy(key, { pos | route | routeIndex, mods })
// 改图 = 改 stage.rows 的一个字符 + 重建战斗：地形、寻路（官方 SPFA 流场）、渲染读的是同一张字形表。
//
// 这一层只做编排：状态在 state 里，画面交给 hud.js（DOM）+ render/app.js（战场），部署朝向交给官方四向轮盘
// （public/js/ui/facingWheel.js，Preact 组件，直接挂进 #hud-wheel）。战斗逻辑一行没动。

import { data } from "../../js/data.js";
import { createAssets } from "../../js/assets.js";
import { loadBrowserSim } from "../../js/battle/simLoader.js";
import { html } from "../../js/ui/components.js";
import { FacingWheel } from "../../js/ui/facingWheel.js";
import { render as mountPreact } from '/vendor/preact.module.js';
import { audio, installAudio } from "../../js/audio.js";
import { playLevelBgm, stopLevelBgm, levelBgmUrl, bgmVolume } from './level-bgm.js';
import { absoluteRangeKeys } from '/sim/targeting.js';
import * as hud from './hud.js';
import { useAssets } from './asset-urls.js';
import { ROWS, COLS, TERRAIN, DEFAULT_RECT, defaultStage, paintTile, setRect, normRect, mapDigest, gatesOf, routesOf } from './battlefield.js';
import { isAvailable } from './roster.js';
import { ENEMIES, PINNED_MODS } from './spawn-catalog.js';
import { createEnemyPlacement } from './enemy-placement.js';
import { createTerrainBrush } from './terrain-brush.js';
import { TALULA, SPEEDS, MAX_SQUAD, createSandboxState, useLevelSpawns } from './state.js';
import { loadOperatorLibrary, operatorSource } from './operator-library.js';
import { createCatalog } from './operator-catalog.js';
import { createUnitModels } from './panel-models.js';
import { battle, runner, buildBattle, startRunner, unitAt, deploymentError, deployOperator, placeSandboxEnemy, removeSandboxEnemy } from './battle-session.js';
import { view, rebuildField, presentFrame, setSelectionFocus, paintBattleFeedback, displayedDp } from './field-view.js';
import { saveLocal as saveLocalState, loadLocal as loadLocalState, serializeSandbox } from './save.js';
import { openSaveManager } from './ui/save-manager.js';
import { activeSaveSlot, selectSaveSlot, quickSaveSandbox } from './save-slots.js';
import { loadSettings, applyInterfaceSettings } from './settings.js';
import { openSettings } from './ui/settings.js';
import { loadKeybinds, actionFor } from './keybinds.js';
import { createScoreboard } from './ui/scoreboard.js';
import { createHandDeployment } from '../../play/js/hand-deployment.js';

const state = createSandboxState();

let levelRun = null, resultShown = false;
let levelDeployment = null;
let exitWasPlaying = false;
const sceneSnapshot = () => serializeSandbox(state, battle);
const saveLocal = () => { if (!levelRun) saveLocalState(state, undefined, battle); };
const loadLocal = () => loadLocalState(state);
let preferences = loadSettings();

function applyPreferences(value) {
  preferences = value;
  audio.setVolumes(value);
  audio.setVoiceLang(value.voiceLang, value.voiceOverrides);
  audio.setVoiceNative(value.voiceNative);
  // 关卡自带音乐也遵守共用的背景音乐音量和静音设置。
  const vol = value.muted ? 0 : bgmVolume(value);
  const bgm = playLevelBgm(levelBgmUrl(levelRun?.document?.meta), vol);
  if (bgm) bgm.volume = vol;
  applyInterfaceSettings(value);
  view?.setSettings(value);
}

function syncSaveIndicator() {
  if (!refs) return;
  const index = activeSaveSlot();
  refs.slotLabel.textContent = index === null ? '未选' : String(index + 1).padStart(2, '0');
  refs.quickSaveBtn.title = index === null ? '保存到空槽位' : `直接覆盖 ${index + 1} 号存档位`;
}

function saveToCurrentSlot() {
  const index = quickSaveSandbox(sceneSnapshot());
  saveLocal();
  syncSaveIndicator();
  return index;
}

let sim = null, assets = null, refs = null;
let scoreboard = null;
let lastHud = 0, prevFrame = 0;

/* -------------------------------------------------------------------------------------------------------------- */
/* 干员数据                                                                                                        */
/* -------------------------------------------------------------------------------------------------------------- */

const { units, opVM, allOps, reserveSlots, squadVMs, charIdOf, rangeGridOf } = createCatalog(data, state);

/* -------------------------------------------------------------------------------------------------------------- */
/* 一场战斗                                                                                                        */
/* -------------------------------------------------------------------------------------------------------------- */

async function resetBattle({ paused = !(runner?.playing), resetSession = false } = {}) {
  if (levelRun) cancelLevelDeployment();
  if (levelRun && resetSession) {
    state.document = structuredClone(levelRun.document); resultShown = false;
  } else if (battle) {
    const snapshot = sceneSnapshot();
    state.document.operators = snapshot.operators;
    state.document.nextEnemyId = snapshot.nextEnemyId;
    state.document.session = resetSession ? null : snapshot.session;
    if (resetSession) {
      for (const unit of snapshot.operators) delete unit.runtime;
      for (const enemy of snapshot.spawns) delete enemy.runtime;
    }
    useLevelSpawns(state.document, snapshot.spawns, snapshot.levelName);
  }
  try { audio.stopSkillAmbients(); } catch { /* optional audio */ }
  buildBattle(state.document, operatorSource(sim.ds), { mode: levelRun ? 'level' : 'sandbox', moduleSelections: levelRun?.moduleSelections });
  state.ui.selectedUid = null;
  state.ui.rangeSig = -1;
  state.ui.active = null;
  state.ui.popOpen = false;
  hud.setSelMark(refs, null);
  renderHand();
  if (!await rebuildField({ canvas: refs.canvas, assets, battle, stage: state.document.stage, board: state.ui.board, settings: preferences, onTileClick, onPieceClick })) return;
  deploymentTilesSig = '';
  applyTileOnly();          // 重建战场后恢复“只认格子”的放置模式
  if (state.ui.place === 'route') paintRoute();
  if (state.ui.place === 'batch') paintBatch();
  startRunner({ speed: state.ui.speed, paused, onFrame: presentFrame });
  syncHud(true);
  if (battle.sandboxRestoreErrors.length) warn(battle.sandboxRestoreErrors.join('；'), true);
}

/* -------------------------------------------------------------------------------------------------------------- */
/* 局内操作                                                                                                        */
/* -------------------------------------------------------------------------------------------------------------- */

const warn = (text, bad = false) => { if (bad) sfx('error'); hud.toast(refs, text, bad); };

function onTileClick(tile) {
  const tool = state.ui.tool;
  if (tool?.kind === 'paint') { paintAt(tile.row, tile.col); return; }
  // 投放模式优先：这一击只认格子
  if (state.ui.place === 'route') { routeTileClick(tile.row, tile.col); return; }
  if (state.ui.place === 'delete') { deleteEnemyAt(tile.row, tile.col); return; }
  if (state.ui.place === 'batch') { toggleBatchAt(tile.row, tile.col); return; }
  if (state.ui.place === 'tile') { placeEnemyAt(tile.row, tile.col); return; }
  // 拿着手牌 / 手上有待放的东西：格子优先，先问朝向（敌格也能落干员）
  if (state.ui.active && !levelRun) { openWheel(tile.row, tile.col); return; }
  // 点到已经部署的己方单位：当作选中，不要弹轮盘
  const occ = unitAt(tile.row, tile.col);
  if (occ && occ.alive && occ.deployed && occ.side === 'ally') { onPieceClick({ unitId: occ.id, uid: occ.uid }); return; }
  // 点到空地：先取消选中。只有在手牌上拿着一个干员时才问朝向；否则就只是「点了一下空地」，
  // 什么都不该发生 —— 别把上一张放完的牌当成还选着，又弹一次朝向轮盘。
  if (state.ui.selectedUid != null || state.ui.active) clearSelection();
  sfx('click');
}

function onPieceClick(hit) {
  // 正在放置（拿着手牌 / 开着投放方式）时，点任何棋子都应当落到它脚下那一格。
  // 敌人会把地块盖住：如果这一击被棋子吃掉，鼠标就永远点不到「格子」，干员也就放不下去。
  if ((!levelRun && state.ui.active) || state.ui.place) {
    const row = hit?.unit?.tileR ?? null;
    let occ = null;
    if (hit?.uid != null) occ = battle?.allyUnits.find((x) => x.uid === hit.uid) ?? null;
    const e = occ || (hit?.unitId != null ? battle?.enemies.find((x) => x.id === hit.unitId) : null);
    const r = occ ? occ.tileR : (e ? e.tileR : row);
    const c = occ ? occ.tileC : (e ? e.tileC : hit?.unit?.tileC ?? null);
    if (r != null && c != null) { onTileClick({ row: r, col: c }); return; }
    return;
  }
  // 没在放置时点到「没有 uid 的棋子」= 点到了敌人。敌人和干员可以叠在同一格，
  // 而敌人往往画在上层先接住这一击：把这一击折算给站在同格的干员，否则那个干员永远选不中、技能也开不了。
  let u = hit?.unitId != null ? battle?.allyUnits.find((x) => x.id === hit.unitId) : null;
  if (!u && hit?.uid != null) u = battle?.allyUnits.find((x) => x.uid === hit.uid);
  if (!u) {
    const e = hit?.unitId != null ? battle?.enemies.find((x) => x.id === hit.unitId) : null;
    const occ = e ? unitAt(e.tileR, e.tileC) : null;
    if (occ && occ.alive && occ.deployed) u = occ;
  }
  if (!u) { clearSelection(); return; }
  // 再点一次已选中的干员 = 取消选中（和点空地、再点手牌同一个语义：同一个开关按两下就归位）
  if (state.ui.selectedUid === selectionId(u)) {
    const name = u.name ?? u.defId;
    clearSelection();
    sfx('drop');
    warn(`已取消选中「${name}」`);
    return;
  }
  selectUnit(u);
  sfx('pick');
  warn(`已选中「${u.name ?? u.defId}」 · 左侧查看详情，场上按钮可撤退、开技能与切换范围`);
}

/* ---- 放置：手牌 → 格子 → 官方四向轮盘 → 落地 ---- */

let wheelProps = null;
const WheelHost = () => (wheelProps ? html`<${FacingWheel} ...${wheelProps} />` : null);
const paintWheel = () => mountPreact(html`<${WheelHost} />`, refs.wheelHost);

function closeWheel() { levelDeployment?.cancel(); wheelProps = null; paintWheel(); }

function cancelLevelDeployment() {
  closeWheel();
  state.ui.active = null;
  state.ui.popOpen = false;
  applyTileOnly();
  renderHand();
}

function selectLevelCard(id) {
  const def = deploymentRecord(id);
  if (!def) return;
  clearSelection();
  state.ui.active = id;
  state.ui.popOpen = false;
  state.ui.skillIndex = Math.min(state.document.skillSelections[id] ?? 0, Math.max(0, (def.skills?.length || 1) - 1));
  applyTileOnly();
  renderHand();
  if (!def.tokenId) audio.voice(def.assets?.voice || def.charId, 'select');
}

function setupLevelDeployment() {
  levelDeployment = createHandDeployment({
    hand: refs.hand, canvas: refs.canvas,
    getView: () => view,
    getRect: () => battle.rect,
    getCard: (id) => { const def = deploymentRecord(id); return { name: def?.name || id, charId: def?.charId || units()[id]?.charId, tokenId: def?.tokenId }; },
    getError: (id, row, col) => battle.finished ? '作战已结束' : deploymentError(deploymentRecord(id), row, col, true),
    onSelect: (id) => { selectLevelCard(id); sfx('pick'); },
    onInspect: (id) => actions.onCard(id),
    onDrop: openWheel,
    onCancel: cancelLevelDeployment,
    onInvalid: (error) => warn(error, true),
  });
}

function deploymentRecord(id) {
  const card = battle?.hand?.record(id);
  if (card) {
    const unit = card.unit || card.units[0], def = unit.def;
    return { ...def.raw, name: def.name, charId: def.charId, tokenId: card.tokenId, rangeGrid: def.rangeGrid, stats: def.stats,
      handCardId: card.id, chessId: unit.defId, trait: def.trait,
      skills: card.kind === 'token' ? def.skill ? [def.skill] : [] : def.raw.skills || [] };
  }
  if (!levelRun || !battle) return units()[id];
  return battle.data.getChess(id, { skillIndex: state.document.skillSelections[id], moduleId: levelRun.moduleSelections[id] })?.raw || units()[id];
}

function openWheel(row, col) {
  if (!battle || !state.ui.active || (levelRun && battle.finished)) return false;
  const id = state.ui.active;
  const def = deploymentRecord(id);
  const error = deploymentError(def, row, col, state.ui.payDp);
  if (error) { warn(error, true); return false; }
  if (battle.hand?.record(id) && !battle.hand.requiresFacing(id)) {
    const owner = battle.hand.record(id).owner;
    deployOp(row, col, owner?.dir || 'RIGHT');
    if (levelRun) cancelLevelDeployment();
    return true;
  }

  state.ui.selectedUid = null;
  state.ui.popOpen = false;
  renderHand();
  wheelProps = {
    view, row, col,
    grid: def.rangeGrid || rangeGridOf(id),
    name: String(def.name || id),
    onCommit: (dir) => { closeWheel(); deployOp(row, col, dir); if (levelRun) cancelLevelDeployment(); },
    onCancel: () => { if (levelRun) cancelLevelDeployment(); else closeWheel(); },
  };
  paintWheel();
  warn(levelRun ? '按住中心向外拖动选择朝向，松手部署 · 拖回中心或 Esc 取消' : '滑动/点方向选朝向，松手落地（Esc 取消）');
  return true;
}

function deployOp(row, col, dir) {
  const id = state.ui.active, def = deploymentRecord(id);
  if (!def) return warn('数据里没有这个干员', true);
  const maxSkill = Math.max(0, (Array.isArray(def.skills) ? def.skills.length : 1) - 1);
  const skillIndex = Math.min(state.ui.skillIndex, maxSkill);
  const result = deployOperator({ chessId: id, row, col, dir, skillIndex, moduleId: levelRun ? levelRun.moduleSelections[id] : def.module?.id }, def, state.ui.payDp);
  if (result.error) return warn(result.error, true);
  const { uid, cost } = result;
  if (result.unit?.kind === 'op' && !result.transient) {
    state.document.operators = state.document.operators.filter((o) => o.uid !== uid && (o.row !== row || o.col !== col));
    state.document.operators.push({ uid, chessId: result.unit.defId, row, col, dir, skillIndex });
    state.document.skillSelections[id] = skillIndex;
  }
  saveLocal();
  sfxBattle('deploy', { unitKey: `deploy:${uid}` });
  // 放下之后不自动选中：手牌也一起清空，免得下一格空地又被当成「再放一个」弹出朝向轮盘。
  // 点选后显示左侧详情与场上操作按钮。
  state.ui.selectedUid = null;
  state.ui.rangeSig = -1;
  state.ui.active = null;
  state.ui.popOpen = false;
  if (view) view.highlightTiles(null, 'range');
  hud.setSelMark(refs, null);
  applyTileOnly();
  renderHand();
  syncHud(true);
  warn(`已放下 ${def.name ?? id} · ${cost} 费${state.ui.payDp ? '' : '（未扣 DP）'} · 点选查看详情与场上操作`);
}

/* ---- 音效 / 动效 ----------------------------------------------------------------------------------------------- */

/**
 * UI 音效：全部走项目自带的 public/js/audio.js（manifest 就是 data/assets.json 的 audio 段）。
 * 拿到 AudioContext 之前 audio.sfx 自己会 no-op，所以不用关心解锁时机。
 */
const sfx = (name, opts) => { try { if (name) audio.sfx(name, opts); } catch { /* ignore */ } };
const sfxBattle = (name, opts) => { try { if (name) audio.battle(name, opts); } catch { /* ignore */ } };

/** 可点按钮的动效钩子：给元素加一帧 is-tap，让 CSS 播放一次按键反馈（音效由 hud 的点击代理按 data-act 触发）。 */
function pulse(el) {
  if (!el?.classList) return;
  el.classList.remove('is-tap');
  void el.offsetWidth;              // 强制重排，动画能连着放
  el.classList.add('is-tap');
  setTimeout(() => el.classList.remove('is-tap'), 260);
}

/* ---- 技能 / 撤退 / 选中 ---- */

const selectionId = (u) => u.uid ?? `unit:${u.id}`;
function selectedUnit() {
  if (state.ui.selectedUid == null) return null;
  return battle?.allyUnits.find((x) => selectionId(x) === state.ui.selectedUid && x.alive && x.deployed && !x.removed) ?? null;
}

/** 选中场上干员：显示准确范围、左侧详情和跟随单位的操作按钮。 */
function selectUnit(u) {
  if (!u || !u.alive || !u.deployed) return clearSelection();
  state.ui.active = null;
  state.ui.selectedUid = selectionId(u);
  state.ui.popOpen = false;
  applyTileOnly();
  renderHand();
  showRange(rangeKeysOf(u, state.ui.rangeMode));
  hud.setSelMark(refs, markOf(u));
  syncHud(true);
}

function clearSelection({ keepHand = false } = {}) {
  state.ui.selectedUid = null;
  if (!keepHand) { state.ui.active = null; state.ui.popOpen = false; applyTileOnly(); }
  state.ui.rangeSig = -1;
  if (view) view.highlightTiles(null, 'range');
  hud.setSelMark(refs, null);
  syncHud(true);
}

/** 场上角框要的数据：格子中心在屏幕上的位置 + 格子边长（跟着镜头每帧刷新）。 */
function markOf(u) {
  if (!u || !u.alive || !u.deployed) return null;
  const p = view?.tileScreen?.(u.tileR, u.tileC);
  if (!p) return null;
  return { x: p.x, y: p.y, s: p.s, name: u.name ?? u.defId, uid: selectionId(u), hp: u.hp / Math.max(1, u.s.maxHp) };
}

function activateSkill() {
  const u = selectedUnit();
  if (!u?.skill || u.skill.noSkill) return warn('这个单位没有技能', true);
  if (levelRun && u.defId.includes('mlyss_wtrman') && u.ownerUnit?.skill?.active) return warn('缪尔赛思技能期间，流形不能开启复制', true);
  const text = String(u.def.skill?.description || u.def.skill?.desc || u.def.raw?.skills?.[u.skill.index]?.desc || '');
  if (u.skill.active && (/可随时停止|可主动关闭|手动停止/.test(text) || u.defId.includes('mlyss_wtrman'))) {
    u.skill.stop(); syncHud(true); return;
  }
  if (u.skill.activate('manual')) { clearSelection(); return warn(`${u.name ?? u.defId} 开技能`); }
  if (!levelRun && u.skill.activate('manual', { free: true })) { clearSelection(); return warn(`${u.name ?? u.defId} 强制开技能（忽略技力）`); }
  warn('技能开不出来（已在进行中或已失效）', true);
}

/**
 * 关卡撤退返回待部署区并计算返费与冷却；自由沙盒移除当前实例。
 */
function retreatSelected() {
  const u = selectedUnit();
  if (!u) return warn('先在战场上点一个干员再撤退', true);
  const name = u.name ?? u.defId;
  // 主动撤退不是被击倒：不播「干员被击倒」（引擎也只给 reason==='killed' 播那个音）
  // force：绕过结城理 S3 的庇护拦截（那是防暴毙，不该拦玩家手动撤退）
  const before = battle.players[0].dp;
  battle.retreat(u, { reason: 'retreat', permanent: !levelRun, force: true });
  state.document.operators = state.document.operators.filter((o) => o.uid !== u.uid);
  saveLocal();
  state.ui.selectedUid = null;
  state.ui.rangeSig = -1;
  if (view) view.highlightTiles(null, 'range');
  hud.setSelMark(refs, null);
  syncHud(true);
  renderHand();
  warn(levelRun ? `${name} 已撤退 · 返还 ${Math.floor(battle.players[0].dp - before)} 费，进入再部署冷却` : `${name} 已撤退`);
}

/** 范围签名的内容指纹：格子集合变了就重画。只比长度会漏掉「同长度不同形状」（技能换范围）的情况。 */
function rangeSigOf(u) {
  const keys = u && Array.isArray(u.rangeKeys) ? u.rangeKeys : null;
  return keys ? `${keys.length}:${keys.join(',')}` : '';
}

/**
 * 面板上「范围按钮」两种视图的定义（用户 2026-10-22 澄清，之前我理解成显示/隐藏，是错的）：
 *
 *   attack  攻击范围 —— **当前**攻击范围。技能没开时就是干员自己的基础范围；技能开了就自动变成
 *           开技能后的范围（引擎的 `rangeKeys` 本来就是这个语义：技能激活时用技能自己的 rangeGrid）。
 *           所以「开启技能后再选中干员，默认显示的就是开技能后的攻击范围」是天然成立的，
 *           不需要额外判断 —— 只要每次都从 `rangeKeys` 现取。
 *   skill   技能范围 —— 这个技能**如果开启**会给出的范围，与技能当前是否激活无关。
 *           来源：技能定义的 targeting.rangeGrid（转成绝对坐标）。没改范围的技能，两者相同。
 */
function rangeKeysOf(u, mode) {
  if (!u) return [];
  if (mode !== 'skill') return Array.isArray(u.rangeKeys) ? u.rangeKeys : [];
  // 技能范围：先看技能有没有自己的 rangeGrid；没有就退回当前范围（该技能不改范围）
  const tg = u.skill?.def?.targeting || u.skill?.spec?.targeting || null;
  const grid = tg && Array.isArray(tg.rangeGrid) ? tg.rangeGrid : null;
  if (!grid || !grid.length) return Array.isArray(u.rangeKeys) ? u.rangeKeys : [];
  const ext = (tg.noRangeExtend ? 0 : u.s.rangeExtend) + (tg.rangeExtend || 0);
  return absoluteRangeKeys(grid, u.tileR, u.tileC, u.dir, ext);
}

/** 把一组格子 key 画成范围高亮。 */
function paintRange(keys) {
  if (!view) return;
  view.highlightTiles(keys.map((k) => [Math.floor(k / COLS), k % COLS]), 'range');
}

function showRange(keys) {
  if (!view) return;
  state.ui.rangeSig = `${keys.length}:${keys.join(',')}`;
  paintRange(keys);
}

const DEPLOYABLE = { group: 'deployment-tiles', color: 0x80ccff, fill: .19, line: .24 };
let deploymentTilesSig = '';
function showDeploymentTiles() {
  if (!view) return;
  const id = state.ui.active, tiles = [], def = id && deploymentRecord(id);
  if (def && !state.ui.place && !state.ui.tool) {
    const rect = battle.rect;
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) {
      if (!deploymentError(def, r, c, false, { placementOnly: true })) tiles.push([r, c]);
    }
  }
  const sig = `${id || ''}:${tiles.map(([r, c]) => r * COLS + c).join(',')}`;
  if (sig === deploymentTilesSig) return;
  deploymentTilesSig = sig;
  view.highlightTiles(tiles, DEPLOYABLE);
}

/** 收起范围高亮。 */
function hideRange() {
  if (!view) return;
  state.ui.rangeSig = -1;
  view.highlightTiles([], 'range');
}

/* ---- 刷敌人：实现在 enemy-placement.js，这里只做接线 ---- */

let placement = null;

/** 投放相关的全部操作都在 placement 上，本文件只提供它需要的运行时依赖。 */
function setupEnemyPlacement() {
  placement = createEnemyPlacement(
    {
      state: () => state,
      battle: () => battle,
      view: () => view,
      warn,
      renderDrawer,
      renderHand,
      syncHud,
      sfx,
      sfxBattle,
      placeEnemy: (key, options) => placeSandboxEnemy(state.document, key, options),
      removeEnemy: (enemy) => removeSandboxEnemy(state.document, enemy),
      saveLocal,
    },
    { ENEMIES, PINNED_MODS, gatesOf },
  );
  return placement;
}

const setPlace = (mode) => placement.setPlace(mode);
const applyTileOnly = () => levelRun ? view?.setTileOnly?.(false) : placement?.applyTileOnly();
const syncPlaceUi = () => placement?.syncPlaceUi();
const placeEnemyAt = (row, col) => placement.placeEnemyAt(row, col);
const buildRoute = () => placement.buildRoute();
const routeTileClick = (row, col) => placement.routeTileClick(row, col);
const spawnRouteEnemy = () => placement.spawnRouteEnemy();
const firstBlockedSegment = (route) => placement.firstBlockedSegment(route);
const paintRoute = () => placement?.paintRoute();
const toggleBatchAt = (row, col) => placement.toggleBatchAt(row, col);
const startBatchDrag = (e) => placement.startBatchDrag(e);
const moveBatchDrag = (e) => placement.moveBatchDrag(e);
const endBatchDrag = (e) => placement.endBatchDrag(e);
const enemiesInScreenRect = (x0, y0, x1, y1) => placement.enemiesInScreenRect(x0, y0, x1, y1);
const enemyAt = (row, col) => placement.enemyAt(row, col);
const deleteEnemyAt = (row, col) => placement.deleteEnemyAt(row, col);
const killEnemy = (e) => placement.killEnemy(e);
const paintBatch = () => placement?.paintBatch();
const clearBatch = () => placement.clearBatch();

/* ---- 旧波次存档仍可读取；手动刷怪写入唯一出生表。 ---- */

/* -------------------------------------------------------------------------------------------------------------- */
/* 地图                                                                                                            */
/* -------------------------------------------------------------------------------------------------------------- */

let brush = null;

/** 改地形的实现在 terrain-brush.js；本文件只负责把它接到画布与投放拖拽上。 */
function setupTerrainBrush() {
  brush = createTerrainBrush(
    {
      state: () => state,
      view: () => view,
      warn,
      saveLocal,
      renderDrawer,
      resetBattle,
    },
    { ROWS, COLS, paintTile },
  );
  brush.attach(refs.canvas, {
    start: (e) => {
      if (state.ui.place !== 'batch') return false;
      placement.startBatchDrag(e);
      return true;
    },
    move: (e) => { if (placement?.batchDrag) placement.moveBatchDrag(e); },
    end: (e) => { if (placement?.batchDrag) placement.endBatchDrag(e); },
  });
  return brush;
}

const paintAt = (row, col) => brush?.paintAt(row, col);


/* -------------------------------------------------------------------------------------------------------------- */
/* 存档                                                                                                            */
/* -------------------------------------------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------------------------------------------- */
/* HUD 同步                                                                                                        */
/* -------------------------------------------------------------------------------------------------------------- */

const { unitVM, handVM } = createUnitModels({ state, units, charIdOf, selectedUnit, getBattle: () => battle, getHandRecord: deploymentRecord, getRangeKeys: rangeKeysOf });

function syncHud(force = false) {
  if (!battle || !refs) return;
  scoreboard?.render(battle.sandboxScore, force);
  const now = performance.now();
  if (!force && now - lastHud < 80) return;
  lastHud = now;
  renderHand();
  if (levelRun) {
    const slots = refs.hud.querySelector('.hud__dp');
    slots.dataset.slots = `部署位 ${battle.hand.deployedCount()} / ${battle.flags.deployLimit}`;
  }
  const account = battle.players[0];
  const dpHud = refs.hud.querySelector('.hud__dp');
  dpHud.classList.toggle('is-debt', account.dp < 0);
  dpHud.title = `部署费用 · 下限 ${account.dpFloor || 0} · 自然回复 ${Number(((account.dpNaturalRate ?? battle.flags.dpPerSec) * (account.dp < 0 ? .5 : 1)).toFixed(3))} 点/秒`;

  // 沙盒里随手刷出来的敌人不计入引擎的 total（那只统计关卡排程的），所以分母取「出现过的总数」，
  // 免得手刷时永远是 0/0。
  const killed = battle.killed;
  const total = Math.max(battle.total, killed + (battle.leakedCount || 0) + battle.enemies.length);

  hud.setStats(refs, {
    kill: killed,
    total,
    life: 3 - (battle.leakedCount || 0),
    time: battle.time,
    dp: displayedDp(),
    playing: !!runner?.playing,
    speed: state.ui.speed,
    board: state.ui.board,
    pay: state.ui.payDp,
  });

  // 场上选中优先；没选中人但手上拿着牌 → 同一块面板显示这张牌的天赋/技能
  const vm = unitVM() || handVM();
  hud.renderDetail(refs, vm);
  setSelectionFocus(!!vm);
  showDeploymentTiles();
  hud.setSelMark(refs, vm ? markOf(selectedUnit()) : null);   // 角框只标场上的人

  // 范围高亮：按当前视图（攻击 / 技能）取格子集合，签名变了就重画。
  // 技能开了以后 `rangeKeys` 自动变成开技能后的范围，所以「攻击范围」这一档天然跟随技能状态。
  const u = selectedUnit();
  if (!u) {
    if (state.ui.rangeSig !== -1) hideRange();
  } else {
    const keys = rangeKeysOf(u, state.ui.rangeMode);
    const sig = keys.length ? `${keys.length}:${keys.join(',')}` : '';
    if (sig && sig !== state.ui.rangeSig) showRange(keys);
    else if (!sig && state.ui.rangeSig !== -1) hideRange();
  }
}

function positionSelectionActions() {
  const panel = refs?.selectionActions, u = selectedUnit();
  if (!panel || panel.hidden || !u) return;
  const p = markOf(u);
  if (!p) return;
  const radius = Math.max(70, Math.min(128, p.s * 1.1));
  panel.style.left = `${p.x}px`;
  panel.style.top = `${p.y}px`;
  panel.style.setProperty('--selection-radius', `${radius}px`);
  // One projective plane for the frame, buttons, icons and SP strip, parallel to this tile's ground.
  const cam = view.debug.cam, rect = refs.canvas.getBoundingClientRect();
  const roll = (cam.roll || 0) * Math.PI / 180, tilt = cam.tilt * Math.PI / 180;
  const c = Math.cos(roll), s = Math.sin(roll), g = Math.sin(tilt) / cam.focal();
  const dx = p.x - rect.left - cam.cx, dy = p.y - rect.top - cam.cy;
  const a = -s * Math.cos(tilt) + dx * g, b = c * Math.cos(tilt) + dy * g;
  panel.firstElementChild.style.transform = `matrix3d(${c},${s},0,0,${a},${b},0,${-g},0,0,1,0,0,0,0,1)`;
}

function renderHand() {
  const cards = battle?.hand?.cards() || [];
  const visible = levelRun ? cards : [...squadVMs(), ...cards.filter((c) => c.token)];
  if (state.ui.active && !visible.some((c) => c.id === state.ui.active)) {
    state.ui.active = null; state.ui.popOpen = false; applyTileOnly();
  }
  hud.renderHand(refs, visible, {
    active: state.ui.active, skillIndex: state.ui.skillIndex, pop: state.ui.popOpen,
  }, actions);
}

function renderDrawer(force = false) {
  if (force) refs._drawerSig = '';
  const gates = gatesOf(state.document.stage).starts;
  hud.renderDrawer(refs, {
    tab: state.ui.tab,
    drawerOpen: state.ui.drawerOpen,
    enemy: { index: state.ui.enemyIndex, filter: state.ui.enemyFilter, gate: state.ui.gate },
    brush: state.ui.brush,
    gates,
    rect: normRect(state.document.stage.rect),
    digest: mapDigest(state.document.stage),
    place: state.ui.place,
    placeCont: state.ui.placeCont,
    route: state.ui.route,
    routePop: state.ui.routePop,
    batchSel: state.ui.batchSel,
    reserve: reserveSlots(),
    mapJson: state.ui.mapJson,
  }, actions);
}

/* -------------------------------------------------------------------------------------------------------------- */
/* 交互                                                                                                            */
/* -------------------------------------------------------------------------------------------------------------- */

/** 每种按钮一次点击配哪个音效（audio.sfx 的 ui key）。空 = 只动效不出声（例如连续步进）。 */
const TAP_SFX = {
  'home-confirm': 'confirm',
  play: 'click', speed: 'click', frame: null, reset: 'back',
  board: 'click', pay: 'click', settings: 'click', 'quick-save': 'confirm',
  card: 'pick', 'card-remove': 'back', skill: 'confirm', 'picker-open': 'click', 'picker-close': 'back', 'picker-pick': 'confirm',
  tab: 'tab', enemy: 'pick', filter: 'click',
  place: 'pick', 'place-cont': 'click',
  'route-undo': 'back', 'route-done': 'confirm', 'route-cancel': 'back',
  'route-wait': 'confirm', 'route-end': 'confirm', 'route-del': 'back',
  'batch-confirm': 'confirm', 'batch-cancel': 'back',
  brush: 'pick', 'map-reset': 'back', 'map-export': 'click', 'map-import': 'confirm', 'rect-apply': 'confirm',
  retreat: 'drop', 'unit-skill': 'confirm', 'unit-alt': 'click',
};

const actions = {
  onHome() { saveLocal(); location.assign('/studio/home.html'); },
  onHomeConfirm() {
    if (!levelRun) return;
    cancelLevelDeployment();
    location.assign('/studio/play.html');
  },
  onExitToggle(open) {
    if (open) { cancelLevelDeployment(); exitWasPlaying = !!runner?.playing; runner?.pause(); }
    else { if (exitWasPlaying && !document.hidden && !resultShown) runner?.play(); exitWasPlaying = false; }
    syncHud(true);
  },
  onNewMap() {
    if (levelRun) return;
    try { saveToCurrentSlot(); location.assign('/studio/console.html?new=1'); }
    catch (error) { warn(error.message, true); actions.onSaves(() => location.assign('/studio/console.html?new=1')); }
  },
  onQuickSave() {
    if (levelRun) return;
    try { const index = saveToCurrentSlot(); warn(`已快速保存到 ${index + 1} 号存档位`); }
    catch (error) { warn(error.message, true); actions.onSaves(); }
  },
  onSettings() {
    if (levelRun) cancelLevelDeployment(); else closeWheel();
    const playing = !!runner?.playing;
    runner?.pause(); syncHud(true);
    openSettings({ settings: preferences, onChange: applyPreferences,
      onClose: () => { if (playing) runner?.play(); syncHud(true); } });
  },
  onSaves(afterSave = null) {
    if (levelRun) return;
    closeWheel();
    const playing = !!runner?.playing;
    runner?.pause();
    syncHud(true);
    openSaveManager({
      current: sceneSnapshot,
      onLoad: (_save, index) => { location.assign(`/studio/console.html?slot=${index}`); },
      onSaved: (index) => { selectSaveSlot(index); syncSaveIndicator(); afterSave?.(); },
      onClose: () => { if (playing) runner?.play(); syncSaveIndicator(); syncHud(true); },
    });
  },
  /** hud 的点击总代理先走这里：按键动效 + 音效，然后才派发真正的动作。 */
  onTap(btn, a) {
    pulse(btn);
    sfx(TAP_SFX[a]);
  },
  onPlay() { if (!runner) return; if (runner.playing) runner.pause(); else runner.play(); syncHud(true); },
  onSpeed() {
    const i = SPEEDS.indexOf(state.ui.speed);
    state.ui.speed = SPEEDS[(i + 1) % SPEEDS.length];
    runner?.speedTo(state.ui.speed);
    saveLocal();
    syncHud(true);
  },
  onFrame() { runner?.step(1); syncHud(true); },
  /**
   * 快捷键 · 步进一帧：没暂停就先暂停再步进（否则 runner.step 会让画面继续跑）。
   * 只步进 1 个 tick（1/30 秒），和面板上的「步进」按钮同一套。
   */
  onKeyStep() {
    if (!runner) return;
    if (runner.playing) runner.pause();
    runner.step(1);
    syncHud(true);
  },
  onScoreClear() {
    battle?.sandboxScore?.clear();
    scoreboard?.render(battle?.sandboxScore, true);
    saveLocal();
    warn('伤害计分板已清零');
  },
  onReset() {
    if (!window.confirm(levelRun ? '重新开始这次作战？当前进度会清空，阵容不变。' : '重置当前演练？地图和当前在场单位保留，时间、血量、技力和费用会重新初始化。')) return;
    closeWheel();
    saveLocal();
    resetBattle({ paused: true, resetSession: true }).catch((e) => warn(String(e?.message || e), true));
  },
  onBoard() {
    if (levelRun) cancelLevelDeployment();
    state.ui.board = state.ui.board === '3d' ? '2d' : '3d';
    saveLocal();
    view?.setBoardMode(state.ui.board).catch((e) => warn(String(e?.message || e), true));
    syncHud(true);
  },
  onPay() { if (levelRun) return; state.ui.payDp = !state.ui.payDp; saveLocal(); syncHud(true); warn(state.ui.payDp ? '部署开始扣除 DP' : '部署不再扣 DP'); },

  onCard(id) {
    const rec = deploymentRecord(id);
    if (!rec) return;
    if (levelRun) {
      if (state.ui.active === id) { cancelLevelDeployment(); return; }
      selectLevelCard(id);
      warn(`选中 ${rec.name} · ${battle.hand.status(battle.hand.record(id)) || '拖动手牌到可部署格，再拖动选择朝向'}`);
      return;
    }
    if (state.ui.place) setPlace(null);      // 拿牌 = 退出投放方式
    // 同一张卡再点一下 = 取消选择（技能浮窗一起收起）。取消之后点地图任何地方都不会再弹朝向轮盘。
    if (state.ui.active === id) {
      state.ui.active = null;
      state.ui.popOpen = false;
      applyTileOnly();                     // 必须是改完 active 之后再刷：否则「只认格子」会留到下一次
      renderHand();
      warn(`已取消选择 ${rec.name}`);
      return;
    }
    state.ui.popOpen = true;          // 换一张牌：直接摊开它的技能浮窗
    state.ui.active = id;
    state.ui.tool = null;             // 从改图/放怪切回放置干员
    const maxSkill = Math.max(0, (rec.skills?.length || 1) - 1);
    state.ui.skillIndex = Math.min(state.document.skillSelections[id] ?? 0, maxSkill);
    if (state.ui.selectedUid != null) clearSelection({ keepHand: true });
    applyTileOnly();                  // 拿着牌时「只认格子」：敌人在格子上也不会把点击吃掉
    renderHand();
    if (!rec.tokenId) audio.voice(rec.assets?.voice || rec.charId, 'select');
    warn(`选中 ${rec.name} · 点地图上一格放下去（再点一次这张卡取消）`);
  },
  /** 手牌移除：只从牌组里拿掉，场上已部署的该干员不受影响；空出来的位置可以再点 ＋ 加回来。 */
  onCardRemove(id) {
    if (levelRun) return;
    const i = state.document.squad.indexOf(id);
    if (i < 0) return;
    const name = units()[id]?.name || id;
    state.document.squad.splice(i, 1);
    if (state.ui.active === id) {
      state.ui.active = null;
      state.ui.popOpen = false;
      closeWheel();
      applyTileOnly();
    }
    saveLocal();
    renderHand();
    syncHud(true);
    warn(`已移出手牌：${name}`);
  },
  onSkill(i) {
    if (levelRun) return;
    state.ui.popOpen = true;
    const maxSkill = Math.max(0, (units()[state.ui.active]?.skills?.length || 1) - 1);
    state.ui.skillIndex = Math.max(0, Math.min(i, maxSkill));
    if (state.ui.active) state.document.skillSelections[state.ui.active] = state.ui.skillIndex;
    saveLocal();
    renderHand();
    const sk = units()[state.ui.active]?.skills?.[state.ui.skillIndex];
    warn(`技能：S${state.ui.skillIndex + 1} ${sk?.name || ''}`);
  },
  onPickerOpen() {
    if (levelRun) return;
    hud.setPicker(refs, true);
    actions._ops = allOps();
    actions._reserve = reserveSlots();
    hud.renderPicker(refs, actions._ops, refs.pkSearch.value || '', actions._reserve);
  },
  onPickerClose() { hud.setPicker(refs, false); },
  onPickerPick(id) {
    if (levelRun) return;
    if (!isAvailable(id)) return warn('该干员未加入沙盒牌库', true);
    if (!state.document.squad.includes(id)) {
      if (state.document.squad.length >= MAX_SQUAD) return warn(`手牌最多 ${MAX_SQUAD} 张，先换掉一张`, true);
      state.document.squad.push(id);
    }
    state.ui.active = id;
    state.ui.skillIndex = state.document.skillSelections[id] ?? 0;
    applyTileOnly();                  // 选人器里点了一张 = 立刻进入「只认格子」的放置状态
    saveLocal();
    renderHand();
    hud.setPicker(refs, false);
    warn(`加入手牌：${units()[id]?.name || id}`);
  },

  onTab(tab) {
    if (levelRun) return;
    // 离开「刷敌人」页 = 结束投放状态，避免点击仍被格子吃掉、导致改地形刷不上
    if (state.ui.place && tab !== 'enemy') setPlace(null);
    if (state.ui.tab === tab && state.ui.drawerOpen) { state.ui.drawerOpen = false; renderDrawer(true); return; }
    state.ui.tab = tab;
    state.ui.drawerOpen = true;
    renderDrawer(true);
  },

  onEnemy(i) {
    state.ui.enemyIndex = Math.max(0, Math.min(ENEMIES.length - 1, i));
    // 选中敌人 = 进入“点地放置”（默认钉住）；想让它走路，再点「画路线」
    if (state.ui.place == null || state.ui.place === 'tile') {
      state.ui.place = 'tile';
      state.ui.route = null;
    }
    syncPlaceUi();
  },
  onFilter(f) { state.ui.enemyFilter = f; renderDrawer(true); },
  /** 投放方式（点地放置 / 画路线 / 删除单个 / 批量删除）。 */
  onPlace(mode) {
    closeWheel();
    if (state.ui.place === mode) { setPlace(null); return; }
    setPlace(mode);
  },
  onPlaceCont() {
    state.ui.placeCont = !state.ui.placeCont;
    renderDrawer(true);
    warn(state.ui.placeCont ? '连续放置：已开启（放完保持选中）' : '连续放置：已关闭（放一只就退出）');
  },
  /** 点列表里选中某个路线点（展开停留 / 结束 / 删除小面板）。 */
  onRoutePick(i) {
    const rt = state.ui.route;
    if (!rt || !rt.points[i]) return;
    state.ui.routePop = state.ui.routePop === i ? null : i;
    renderDrawer(true);
  },
  /** 路线点小面板：停留 / 结束 / 删除。 */
  onRouteWait(sec) {
    const rt = state.ui.route, i = state.ui.routePop;
    if (!rt || i == null || !rt.points[i]) return;
    const v = Math.max(0, Math.min(600, Math.round(Number(sec) || 0)));
    rt.points[i].wait = v;
    state.ui.routePop = null;
    paintRoute();
    renderDrawer(true);
    warn(v > 0 ? `第 ${i + 1} 个点：到达后停留 ${v} 秒` : `第 ${i + 1} 个点：取消停留`);
  },
  onRouteEnd() {
    const rt = state.ui.route, i = state.ui.routePop;
    if (!rt || i == null || !rt.points[i]) return;
    // 把这个点及其后的点全部收成终点：保留该点，删掉后面的中继
    rt.points.splice(i + 1);
    rt.end = null;
    state.ui.routePop = null;
    syncPlaceUi();
    warn('路线到此结束（走到该点后停住）');
  },
  onRouteDel() {
    const rt = state.ui.route, i = state.ui.routePop;
    if (!rt || i == null || !rt.points[i]) return;
    rt.points.splice(i, 1);   // 后面的点自动补位，编号整体前移
    state.ui.routePop = null;
    paintRoute();
    renderDrawer(true);
    warn('已删除该点，后面的点自动前移');
  },
  onRouteUndo() {
    const rt = state.ui.route;
    if (!rt || !rt.points.length) return warn('没有可撤销的点', true);
    rt.points.pop();
    paintRoute();
    renderDrawer(true);
  },
  onRouteDone() {
    const rt = state.ui.route;
    if (!rt || !rt.start) return warn('先点一个起点', true);
    if (!rt.end && !rt.points.length) return warn('至少点一个中继点', true);
    spawnRouteEnemy();
  },
  onRouteCancel() {
    state.ui.route = null;
    state.ui.routePop = null;
    setPlace(null);
    warn('已取消路线');
  },
  onRouteStartClear() {
    const rt = state.ui.route;
    if (!rt) return;
    rt.start = null;
    rt.points = [];
    rt.end = null;
    state.ui.routePop = null;
    paintRoute();
    renderDrawer(true);
    warn('已清除起点，请重新点起点');
  },
  /** 批量删除的确定 / 取消。 */
  onBatchConfirm() {
    const ids = new Set(state.ui.batchSel);
    let n = 0;
    for (const e of [...(battle?.enemies || [])]) if (e.alive && ids.has(e.id)) { killEnemy(e); n++; }
    clearBatch();
    setPlace(null);
    warn(`已批量删除 ${n} 只敌人`);
  },
  onBatchCancel() { clearBatch(); },
  onDeleteMode() { setPlace(state.ui.place === 'delete' ? null : 'delete'); },
  /** Esc：由内到外退出——路线小面板 → 投放方式 → 手牌选中。 */
  onEscape() {
    if (state.ui.routePop != null) { state.ui.routePop = null; renderDrawer(true); return; }
    if (state.ui.place) { setPlace(null); return; }
    if (state.ui.active) { actions.onCard(state.ui.active); return; }
    clearSelection();
  },
  onRouteWaitNum() { /* 数字框变化不立即应用，等点「应用」 */ },

  onBrush(g) {
    state.ui.brush = g;
    state.ui.tool = { kind: 'paint' };
    renderDrawer(true);
    const t = TERRAIN.find((x) => x.g === g);
    warn(`笔刷：${t?.label || g} —— 点地图刷，改完自动重建对局`);
  },
  /** 改战场范围（撑大 = 给地图加格子；缩小 = 把边缘格子退回背景）。 */
  onRect(r0, r1, c0, c1) {
    const next = setRect(state.document.stage, { r0, r1, c0, c1 });
    if (next === state.document.stage) return warn('战场范围没变');
    state.document.stage = next;
    saveLocal();
    renderDrawer(true);
    const R = state.document.stage.rect;
    warn(`战场范围：行 ${R.r0}–${R.r1} · 列 ${R.c0}–${R.c1}（${(R.r1 - R.r0 + 1) * (R.c1 - R.c0 + 1)} 格）`);
    resetBattle().catch((e) => warn(String(e?.message || e), true));
  },
  onRectApply() {
    const q = (id) => Number(refs.drInner.querySelector(`#${id}`)?.value);
    actions.onRect(q('rc-r0'), q('rc-r1'), q('rc-c0'), q('rc-c1'));
  },
  onMapReset() {
    if (!window.confirm('将当前现场保存到存档位后，清空地图并开启新的 8×17 沙盘？')) return;
    actions.onNewMap();
  },
  onMapExport() {
    state.ui.mapJson = JSON.stringify({ rows: state.document.stage.rows, rect: normRect(state.document.stage.rect) }, null, 1);
    renderDrawer(true);
    warn('地图已导出到下面的框里');
  },
  onMapImport() {
    try {
      const parsed = JSON.parse(hud.readJson(refs, 'map-json'));
      const rows = parsed?.rows;
      if (!Array.isArray(rows) || rows.length !== ROWS || !rows.every((r) => typeof r === 'string' && r.length === COLS)) {
        return warn(`地图要 ${ROWS} 行、每行 ${COLS} 个字符`, true);
      }
      state.document.stage = { ...defaultStage(), ...parsed, rows, rect: normRect(parsed?.rect ?? DEFAULT_RECT) };
      saveLocal();
      renderDrawer(true);
      resetBattle().catch((e) => warn(String(e?.message || e), true));
      warn('地图已替换');
    } catch (e) { warn(`JSON 解析失败：${e.message}`, true); }
  },

  onRetreat() { retreatSelected(); },
  onUnitSkill() { activateSkill(); },
  // 详情面板右栏「技能 / 特性 / 天赋」切换：记在 hud 模块里，然后只重绘面板
  onDetailTab(tab) {
    // 面板的 Tab 是挂在「这块面板当前展示的是谁」上的 —— 可能是场上干员（uid），
    // 也可能是手牌（uid 是 `hand:<id>`）。用 state.ui.selectedUid 会漏掉手牌那一种（它是 null）。
    const vm = unitVM() || handVM();
    if (!vm) return;
    hud.setDetailTab(vm.uid, tab);
    refs._detailUid = null;      // 强制重绘（内容随 Tab 变）
    syncHud(true);
    sfx('tab');
  },
  // 攻击范围 / 技能范围 切换（不是显示/隐藏：选中干员时始终有范围在亮）
  onUnitRange() {
    state.ui.rangeMode = state.ui.rangeMode === 'attack' ? 'skill' : 'attack';
    state.ui.rangeSig = -1;          // 强制按新视图重画
    refs._detailUid = null;       // 按钮的亮灭要跟着变
    syncHud(true);
    sfx('click');
    warn(state.ui.rangeMode === 'skill' ? '显示技能范围' : '显示攻击范围');
  },
  onUnitAlt() {
    const m = selectedUnit()?.mem.customMakoto;
    if (!m) return warn('这个干员没有可切换的形态');
    // 失败原因分开报：同居「需要10费、5秒冷却」时，冷却中的人看不出到底卡在哪一条
    const now = battle.time;
    const cd = Math.max(0, (Number(m.switchAt) || 0) - now);
    const dp = battle.players[0]?.dp ?? 0;
    if (cd > 1e-9) return warn(`面具切换冷却中，还剩 ${cd.toFixed(1)} 秒`, true);
    if (!battle.canSpendDp(selectedUnit().ownerId, 10)) return warn(`切换面具要 10 费，现在只有 ${Math.floor(dp)}`, true);
    if (m.index === 2 && selectedUnit()?.skill.active) return warn('救济进行中不能换面具（技能结束后再换）', true);
    if (m.switchPersona((m.index + 1) % 3)) { refs._detailUid = null; syncHud(true); warn(`切换至${m.names[m.index]}`); }
    else warn('切换失败（状态已变，再点一次试试）', true);
  },
  onEquipment() {
    const m = selectedUnit()?.mem.customMakoto;
    if (m?.equipment()) { syncHud(true); warn('装备应变'); }
    else warn('装备应变需要技能进行中、足够费用，且操作间隔不少于3秒', true);
  },
};

/* -------------------------------------------------------------------------------------------------------------- */
/* 启动                                                                                                            */
/* -------------------------------------------------------------------------------------------------------------- */

// 调试钩子（无头验证 / 手动排查都靠它，页面本身不依赖）
globalThis.__sandbox = {
  state,
  get battle() { return battle; },
  get view() { return view; },
  get runner() { return runner; },
  get refs() { return refs; },
  get audio() { return audio; },
  actions,
  deployOp, placeEnemyAt, setPlace, paintAt, resetBattle, activateSkill, retreatSelected,
  openWheel, closeWheel, selectUnit, clearSelection, allOps,
};

function showLevelResult() {
  cancelLevelDeployment();
  resultShown = true;
  const success = battle.reason === 'cleared' && battle.leakedCount < 3;
  const dialog = document.createElement('dialog'); dialog.className = 'saves operation-result';
  dialog.innerHTML = `<header class="saves__head"><h2>${success ? '作战成功' : '作战失败'}</h2></header><div class="saves__intro"><h3>${hud.esc(levelRun.levelName)}</h3><p>歼灭 ${battle.killed} · 漏敌 ${battle.leakedCount} · 用时 ${Math.floor(battle.time)} 秒</p><button class="menu__button menu__button--primary" data-result="retry">再次作战</button><button class="menu__button" data-result="squad">重新编队</button><button class="menu__button" data-result="back">返回关卡列表</button></div>`;
  dialog.oncancel = (e) => e.preventDefault();
  dialog.onclick = (e) => {
    const act = e.target.closest('[data-result]')?.dataset.result;
    if (act === 'retry') { dialog.close(); dialog.remove(); resetBattle({ paused: false, resetSession: true }).catch((e) => warn(e.message, true)); }
    if (act === 'squad') location.assign(`/studio/play.html?level=${encodeURIComponent(levelRun.levelId)}&squad=1`);
    if (act === 'back') location.assign('/studio/play.html');
  };
  document.body.append(dialog); dialog.showModal();
}

function frame(now) {
  const dt = (now - prevFrame) / 1000;
  prevFrame = now;
  try {
    if (document.hidden) runner?.pause();
    else runner?.advance(dt);
  } catch (e) {
    // 战斗推进出错：记一次，但绝不让循环停掉（否则时间卡死、看起来像整个模拟器坏了）
    reportSoftError('advance', e);
  }
  try {
    syncHud(false);
    positionSelectionActions();
    paintBattleFeedback(now);
    if (levelRun && battle?.finished && !resultShown) showLevelResult();
  } catch (e) {
    // HUD / 详情面板的渲染出错，不该拖死战斗。上一版 detailTabBody 里一个未定义变量就是这样
    // 把 requestAnimationFrame 链彻底断掉的（时间不走、面板不显示）。
    reportSoftError('syncHud', e);
  }
  requestAnimationFrame(frame);
}

/**
 * 只报一次的软错误：同一个消息只打一次 console.error 并在 HUD 上提示一次，
 * 免得每帧刷屏把控制台冲爆。这样单个渲染 bug 不会表现为「整个模拟器卡死」。
 */
const _softErr = new Set();
function reportSoftError(where, e) {
  const msg = `${where}: ${e?.message || e}`;
  if (_softErr.has(msg)) return;
  _softErr.add(msg);
  console.error(`[sandbox] ${msg}`, e);
  try { hud.toast(refs, `渲染出错（${where}）：${e?.message || e}`, true); } catch { /* ignore */ }
}

async function boot({ run = null } = {}) {
  levelRun = run;
  if (!run) stopLevelBgm();   // 自由沙盒没有关卡音乐；关卡模式由 applyPreferences 起曲
  setTerminalState('battle');
  document.body.dataset.workspace = run ? 'level' : 'sandbox';
  refs = hud.mount(document.getElementById('app'), actions);
  scoreboard = createScoreboard(document.getElementById('damage-score'));
  setupEnemyPlacement();
  // 音效：manifest 就是 assets.json 的 audio 段；首次点击/触摸时 audio 自己解锁 AudioContext。
  // 音效与语音使用局内设置，沙盒不播放背景音乐。
  installAudio({
    getManifest: () => data.getRaw('assets'),
    settings: preferences,
  });
  applyPreferences(preferences);
  syncSaveIndicator();

  await data.loadAll('assets', 'stages', 'chess', 'tokens', 'enemies');
  await loadOperatorLibrary(data);
  sim = await loadBrowserSim();
  assets = createAssets();
  assets.seed(data.getRaw('assets'));
  useAssets(assets);

  if (levelRun) { state.document = structuredClone(levelRun.document); state.ui.payDp = true; }
  else loadLocal();
  window.addEventListener('pagehide', saveLocal);
  // 存档只收名单中的自设与支援干员。
  state.document.squad = state.document.squad.filter((id) => isAvailable(id));
  if (!state.document.squad.includes(state.ui.active)) state.ui.active = state.document.squad[0] || TALULA;
  if (!levelRun) setupTerrainBrush();
  renderHand();
  renderDrawer(true);

  await resetBattle();

  prevFrame = performance.now();
  requestAnimationFrame(frame);
  // 快捷键：指针位置 + 全局键盘监听（改键由设置面板调 setKeybind）
  loadKeybinds();
  refs.canvas.addEventListener('pointermove', (e) => { pointerAt = { x: e.clientX, y: e.clientY }; });
  refs.canvas.addEventListener('pointerleave', () => { pointerAt = null; });
  window.addEventListener('keydown', onGlobalKey);
  if (levelRun) {
    setupLevelDeployment();
    refs.hud.querySelector('[data-act="home"]').hidden = true;
    refs.exitMenu.hidden = false;
    refs.hud.querySelector('[data-act="reset"] span').textContent = '重新作战';
    refs.hud.querySelector('[data-act="reset"]').title = '清空本次进度并按当前阵容重新作战';
    runner.play(); warn(`${levelRun.levelName} · 拖动手牌到可部署格，再拖动选择朝向`);
  } else if (!battle.sandboxRestoreErrors.length) warn('现场已载入并暂停 · 空格继续 · 快存直接覆盖当前存档位');
}

/* -------------------------------------------------------------------------------------------------------------- */
/* 局内快捷键（可自由改键；键位存在 localStorage）                                                                    */
/* -------------------------------------------------------------------------------------------------------------- */

/**
 * 四个动作：切换倍速、步进一帧、对鼠标所指的干员快速放技能、快速撤退。
 * 键位表在 keybinds.js（设置面板里改），这里只负责「按到哪个动作」。
 */
/** 鼠标在画布上的位置（client 坐标），键盘动作打在它指到的那一格上。 */
let pointerAt = null;

/** 鼠标所指那一格上的干员（没有就返回 null）。 */
function unitUnderPointer() {
  if (!pointerAt || !view?.tileAt) return null;
  const tile = view.tileAt(pointerAt.x, pointerAt.y);
  if (!tile) return null;
  return unitAt(tile.row, tile.col);
}

/** 快速放技能：对指针下的干员开它当前装配的技能（不改变选中状态之外的战场状态）。 */
function quickSkill() {
  const u = unitUnderPointer();
  if (!u || u.side !== 'ally') return warn('鼠标指到一个干员上再按技能键', true);
  const sk = u.skill;
  if (!sk) return warn(`${u.name || u.defId} 没有技能`, true);
  if (sk.active) return warn(`${u.name || u.defId} 的技能已经在跑了`, true);
  if (sk.kind === 'passive') return warn(`${u.name || u.defId} 是被动技能`, true);
  const ok = sk.activate('manual');
  if (!ok) { warn(`${u.name || u.defId} 的技力不足或条件不满足`, true); return; }
  // 技能开出去之后把选中与右侧信息面板一起收掉：快捷键是「打完就走」，
  // 不像点按钮那样需要留在面板上继续看数值。（和 activateSkill 走同一个 clearSelection，别两套逻辑）
  clearSelection();
  warn(`${u.name || u.defId} 开技能`);
}

/** 快速撤退：指针下的干员（和自己的选中无关，鼠标指谁撤谁）。 */
function quickRetreat() {
  const u = unitUnderPointer();
  if (!u || u.side !== 'ally') return warn('鼠标指到一个干员上再按撤退键', true);
  state.ui.selectedUid = selectionId(u);
  retreatSelected();
}

function runKeyAction(action) {
  if (action === 'speed') actions.onSpeed();
  else if (action === 'step') actions.onKeyStep();
  else if (action === 'skill') quickSkill();
  else if (action === 'retreat') quickRetreat();
}

function onGlobalKey(e) {
  if (refs?.exitMenu.open) return;
  // 正在输入框里打字、或开着对话框/选择器时，快捷键让位
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key;
  const action = actionFor(key);
  if (!action) return;
  e.preventDefault();
  runKeyAction(action);
}

/** 设置面板里改键用：把一个动作绑到某个键（'' = 解绑）。 */
export { setKeybind, getKeybinds, KEY_ACTIONS, DEFAULT_KEYS } from './keybinds.js';

export { boot as bootSandbox };
