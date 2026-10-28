import { data } from "../../js/data.js";
import { createFieldView } from "../../js/render/app.js";
import { audio } from "../../js/audio.js";
import { ROWS, COLS } from './battlefield.js';
import { createBattleFeedback } from './battle-feedback.js';
import { session } from './session.js';

export let view = null;
let generation = 0;
/** 渲染投影用的单位列表来源（由 rebuildField 设为会话门面的取值函数）。 */
let source = null;
let feedback = null, cameraRect = null, focusOn = false;
let focusSize = '';

export function setSelectionFocus(on) {
  const sizeKey = `${innerWidth}:${innerHeight}`;
  if (!view || focusOn === on && focusSize === sizeKey) return;
  focusOn = on;
  focusSize = sizeKey;
  const box = document.getElementById('hud-canvas').getBoundingClientRect();
  const padding = camPadding('normal', box);
  view.setCamera('normal', { rect: cameraRect, fit: true, tilt: 30, roll: on ? -5 : 0,
    fitRoll: 0, offsetX: on ? Math.min(box.width * .1, 150) : 0, padding, ms: 220 });
}

export function paintBattleFeedback(now) { feedback?.paint(now); }
export function displayedDp() { return feedback ? feedback.displayedDp() : session.cost(); }

/**
 * 攻击前摇的提前量（游戏秒）。引擎在 atkCd 归零的那一帧就把伤害结算掉，动画要在这之前起手，
 * 刀锋扫到目标的那一瞬才会正好压上伤害数字。插值缓冲为了跟手只留 0.034 秒，靠它做未来事件预读
 * 来不及；本地战斗的倒计时本身是可见的，所以这里直接读一次，按仿真帧提前起手。
 */
const WIND_LEAD = 0.28;

/** Ask the renderer to start every imminent attack's clip now. The actor ignores repeats. */
function windUpAttacks() {
  if (!view || !source) return;
  const views = view.debug?.views;
  if (!views) return;
  for (const u of source.units) {
    // 敌人也在这个列表里（spawns.js 两边都推），它们的挥击由引擎自己的 wind 提前量管，这里只管我方。
    if (!u.alive || !u.canAct || u.side === 'enemy') continue;
    const cd = u.atkCd;
    if (!(cd > 0 && cd <= WIND_LEAD)) continue;
    const v = views.get(u.id);
    if (v && !v.destroyed && typeof v.windUp === 'function') v.windUp(cd, 'atk');
  }
}

function camPadding(kind, sz) {
  return { top: Math.min(96, sz.height * 0.10), bottom: Math.min(148, sz.height * 0.15),
    left: Math.min(92, sz.width * 0.055), right: Math.min(104, sz.width * 0.06) };
}

/**
 * 镜头该框住的范围：地图实际占用的格子（非 `#`）与部署区的并集。
 *
 * 只给部署区（session.rect()）是不够的——那是「能站人的区域」，红门/蓝门/敌人路线常常在它外面。
 * 自制关卡的地图有大有小，按部署区取景的结果就是敌人从画面外走进来、走到画面外消失。
 */
function stageBounds(stage, rect) {
  const r = rect && typeof rect === 'object' ? rect : { r0: 0, r1: ROWS - 1, c0: 0, c1: COLS - 1 };
  let r0 = r.r0, r1 = r.r1, c0 = r.c0, c1 = r.c1;
  const rows = Array.isArray(stage?.rows) ? stage.rows : null;
  if (rows) {
    for (let y = 0; y < rows.length && y < ROWS; y++) {
      const line = typeof rows[y] === 'string' ? rows[y] : '';
      for (let x = 0; x < line.length && x < COLS; x++) {
        if (line[x] === '#' || line[x] === ' ') continue;
        if (y < r0) r0 = y;
        if (y > r1) r1 = y;
        if (x < c0) c0 = x;
        if (x > c1) c1 = x;
      }
    }
  }
  return { r0: Math.max(0, r0), r1: Math.min(ROWS - 1, r1), c0: Math.max(0, c0), c1: Math.min(COLS - 1, c1) };
}

export async function rebuildField({ canvas, assets, stage, board, settings, onTileClick, onPieceClick }) {
  const seq = ++generation;
  feedback?.destroy(); feedback = null; focusOn = false; focusSize = '';
  if (view) { try { view.destroy(); } catch { /* ignore */ } view = null; }
  const next = await createFieldView(canvas, { data, assets, board, padding: camPadding, audio,
    playbackTime: () => session.time(),
    // redeployRing: false —— 单机关卡没有卫戍协议那套自动再部署，被击倒的单位不画「还有个几秒回来」的绿圈
    settings: { quality: 'high', damageNumbers: true, officialFx: 'lite', ...settings, redeployRing: false, tierChips: false } });
  if (seq !== generation) { try { next.destroy(); } catch { /* ignore */ } return false; }
  view = next;
  // 沙盒里敌人不参与点选：敌人大立绘盖在干员上，点谁都先命中干员（删除/批量删除本来就按格子找敌人）
  view.setEnemyPickable?.(false);
  // 单机没有卫戍协议那套「倒地等再部署」，人倒了就直接从画面消失，不留躺倒姿势
  view.setKnockDownShown?.(false);
  source = {
    get units() { return session.allUnits(); },
    get allyUnits() { return session.allies(); },
    get time() { return session.time(); },
    enemiesInKeys: (keys, by, profile) => session.enemiesInKeys(keys, by, profile),
  };
  view.setBoardArea([{ r0: 0, r1: ROWS - 1, c0: 0, c1: COLS - 1 }]);
  await view.setBoardMode(board);
  if (seq !== generation) return false;
  view.setStage(stage);
  const meta = session.fieldMeta();
  view.enterBattle(meta);
  // 单位初始 spawn 可能发生在声音解锁之前，音频仍需要完整的登记表。
  audio.setFieldUnits(meta.units);
  // 取景按「地图实际占用 ∪ 部署区」并且强制 fit：自制关卡的地图尺寸不固定，用官方那套半场机位
  // 会把红门/蓝门切在画面外。默认沙盒地图的包围盒与部署区本来就重合，观感不变。
  cameraRect = stageBounds(stage, session.rect());
  view.setCamera('normal', { rect: cameraRect, fit: true, instant: true });
  feedback = createBattleFeedback({ view, canvas });
  view.setLocalFeed({ on: true, speed: 1 });
  view.debug.interp.update = () => view.debug.interp.snapToNewest();
  view.on('tileClick', onTileClick);
  view.on('pieceClick', onPieceClick);
  syncSkillProjection();
  return true;
}

/**
 * 将真实技能、范围、人格、庇护、记录与封印范围单向投影给专属视效。
 * 伤害与治疗仍由 kit 决定，渲染层不添加状态或推断额外命中。
 */
function syncSkillProjection() {
  if (!view || !source) return;
  const views = view.debug?.views;
  if (!views) return;
  const vina = { actors: [], guards: [] };
  const makoto = { actors: [], records: [], seals: [], protected: [], paralysis: [] };
  const wang = { actors: [], time: source.time };
  const sealed = new Set();
  for (const u of source.units) {
    const v = views.get(u.id);
    if (!v || v.destroyed) continue;
    if (!u.alive || !u.deployed || !(u.hp > 0)) continue;
    if (u.side === 'enemy') {
      if (u.findBuff('makoto:paralysis')) makoto.paralysis.push(v);
      continue;
    }
    const on = !!(u.skill && u.skill.active);
    if (v.skillOn !== on) v.skillOn = on;
    // rangeKeys 只在技能期间有意义；平时置空，避免外沿常亮。
    const keys = on && Array.isArray(u.rangeKeys) ? u.rangeKeys : null;
    if (v.rangeKeys !== keys) v.rangeKeys = keys;
    if (u.mem.wang) {
      const nodes = u.mem.wang.followers.map((n) => ({ ...n }));
      for (const stone of source.allyUnits) {
        if (stone.ownerUnit !== u || !stone.alive || !stone.deployed || !stone.mem.wangNode) continue;
        nodes.push({ ...stone.mem.wangNode, stone: undefined, r: stone.tileR, c: stone.tileC, follower: false });
      }
      wang.actors.push({ view: v, nodes, range: on && u.skill.id === 'skchr_wang_3' ? keys : null });
    }
    if (u.def.charId === 'char_9901_vina') vina.actors.push({ view: v,
      active: on && u.def.skill.id === 'skchr_vina_2', aura: u.def.skill.id === 'skchr_vina_2', glory: !!u.findBuff('vina:glory') });
    if (u.findBuff('protect')?.source?.def?.charId === 'char_9901_vina') vina.guards.push(v);
    if ((u.mem.makotoSafeUntil || 0) > source.time) makoto.protected.push(v);
    const persona = u.mem.customMakoto;
    if (!persona) continue;
    // Persona banks change at runtime; static spawn info still names the starting bank.
    v.setSkillSlot?.(persona.index);
    v.info.skillIndex = persona.index;
    const voice = audio.units.get(u.id);
    if (voice) voice.skillIndex = persona.index;
    makoto.actors.push({ view: v, persona: persona.index, active: on, range: u.rangeKeys || [] });
    if (persona.record) for (const [enemy, amount] of persona.record) {
      const target = views.get(enemy.id);
      if (target && enemy.alive && enemy.deployed) makoto.records.push({ view: target, amount });
    }
    if (persona.index === 2 && on) for (const enemy of source.enemiesInKeys(u.rangeKeys, u, { canHitFly: true })) {
      const target = views.get(enemy.id);
      if (target && !sealed.has(enemy.id)) { sealed.add(enemy.id); makoto.seals.push(target); }
    }
  }
  view.debug.fx.setVinaScene(vina);
  view.debug.fx.setMakotoScene(makoto);
  view.debug.fx.setWangScene(wang);
}

export function presentFrame(snap, ev) {
  feedback?.ingest(ev);
  windUpAttacks();
  syncSkillProjection();
  view.pushEvents({ t: 'b.ev', fieldId: snap.fieldId, gt: snap.t, ev });
  view.pushSnapshot({ ...snap, t: 'b.snap', gt: snap.t });
  try { audio.handleBattleEvents(ev); } catch { /* optional audio */ }
}
