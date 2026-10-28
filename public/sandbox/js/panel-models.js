import { PROF_CN } from './state.js';
import { COLS } from './battlefield.js';

function visibleTalents(record) {
  const found = new Map();
  for (const t of record?.talents || []) {
    const name = String(t?.name || '').trim(), desc = String(t?.description ?? t?.desc ?? '').trim();
    if (t?.hidden || Number(t?.index) < 0 || !name || !desc) continue;
    const index = Number.isInteger(t.index) ? t.index : found.size;
    found.set(index, { index, name, desc, richDesc: t.descRaw || desc });
  }
  return [...found.values()].sort((a, b) => a.index - b.index);
}

function skillInfoOf(rec) {
  if (!rec) return null;
  return { name: String(rec.name || ''), desc: String(rec.desc || rec.description || rec.descRaw || ''),
    richDesc: rec.descRaw || rec.desc || rec.description || '', skillId: rec.id || rec.skillId,
    spType: rec.spType || '', auto: String(rec.skillType || rec.type || '').toUpperCase() === 'AUTO',
    duration: Number(rec.duration), passive: String(rec.skillType || rec.type || '').toUpperCase() === 'PASSIVE' };
}

export function createUnitModels({ state, units, charIdOf, selectedUnit, now, canSpend, getHandRecord, getRangeKeys }) {
function unitVM() {
  const u = selectedUnit();
  if (!u || !u.alive || !u.deployed) return null;
  const sk = u.skill;
  const cost = sk && !sk.noSkill ? sk.spCost : 0;
  const ready = !!(sk && sk.ready);
  // 原始当前配装记录保留 hidden/index；隐藏模组条目只供机制使用。
  const rec = units()[u.defId];
  const base = u.def.raw || rec || u.def;
  const raw = u.kind === 'token' ? { ...base, ...base.variants?.[u.ownerUnit?.defId] } : base;
  const talents = visibleTalents(raw);
  const skIndex = Number(sk?.def?.index) || 0;
  const skRec = u.kind === 'token' ? u.def.skill : raw.skills?.[skIndex] || rec?.skills?.[skIndex] || raw.skill;
  const mk = u.mem.customMakoto || null;
  // 特性文案：simdata 归一化后 `def.trait` **是字符串**（server/sim/simdata.js:207 把 rec.trait.desc 拍平了），
  // 只有原始 chess.json 里的 rec.trait 才是 {desc, descRaw} 对象。两种形态都要认，
  // 之前只取 .desc 导致归一化后的字符串被忽略，面板显示「该干员没有特性说明」。
  const traitOf = (v) => (typeof v === 'string' ? v : String(v?.desc || v?.descRaw || ''));
  const traitDesc = traitOf(u.def?.trait) || traitOf(rec?.trait);
  return {
    uid: u.uid ?? `unit:${u.id}`,
    tokenId: u.kind === 'token' ? u.defId : null,
    name: u.name ?? u.defId,
    charId: charIdOf(u),
    prof: u.kind === 'token' ? `召唤物${u.ownerUnit ? ` · ${u.ownerUnit.name}` : ''}` : String(u.def?.subProfessionName || PROF_CN[u.def?.profession] || u.def?.profession || ''),
    profession: u.def.profession,
    level: raw.status?.level || rec?.status?.level || u.ownerUnit?.def.raw?.status?.level || null,
    rangeGrid: (getRangeKeys?.(u, state.ui.rangeMode) || u.rangeKeys || []).map((k) => [Math.floor(k / COLS) - u.tileR, k % COLS - u.tileC]),
    hp: u.hp, maxHp: u.s.maxHp,
    atk: u.s.atk, def: u.s.def, res: u.s.res, block: u.s.blockCnt,
    talents,
    traitDesc,
    traitRich: raw.trait?.descRaw || traitDesc,
    // 范围按钮当前在哪个视图（面板据此亮灭）
    rangeMode: state.ui.rangeMode,
    skillInfo: skillInfoOf(skRec),
    skill: sk && !sk.noSkill ? {
      name: String(sk.name || sk.def?.name || '技能'),
      skillId: String(sk.def?.id || sk.def?.skillId || sk.def?.iconId || ''),
      index: skIndex,
      sp: sk.sp,
      cost,
      ready,
      charges: sk.charges,
      maxCharges: sk.maxCharges,
      active: !!sk.active,
      ammoLeft: sk.ammoLeft,
      ammoMax: sk.ammoMax,
      // 技能页要标注触发方式（本体在技能名下面写「自动回复 / 手动触发」）
      spType: String(sk.def?.spType || sk.spType || ''),
      auto: String(sk.def?.skillType || sk.def?.type || sk.skillType || '').toUpperCase() === 'AUTO',
      left: Number(sk.timeLeft) || 0,
      dur: Number(sk.duration) || 0,
      frac: ready ? 1 : (cost > 0 ? Math.min(1, sk.sp / cost) : 0),
    } : null,
    alt: mk ? `面具：${mk.names[mk.index]} · 切换 10 费` : null,
    equipment: mk ? `装备应变 · ${mk.index === 0 ? 3 : mk.index === 1 ? 8 : 50}费` : null,
    // 切换面具的冷却剩余（秒）与费用是否够：两个都要显示，否则玩家点了没反应只能瞎猜
    altCd: mk ? Math.max(0, (Number(mk.switchAt) || 0) - now()) : 0,
    altPoor: mk ? !canSpend(u.ownerId, 10) : false,
    personaIndex: mk?.index,
  };
}

/**
 * 只拿着手牌、还没落地时的面板内容：面板一样要能看到天赋与技能说明（用户明确要求「无论手牌还是已经放置的干员」）。
 * 和场上干员共用同一块面板与同一个选中框，只是没有生命 / 技力 / 撤退可谈，这几项留空由 hud 那边略过。
 */
function handVM() {
  const id = state.ui.active;
  if (!id) return null;
  const rec = getHandRecord?.(id) || units()[id];
  if (!rec) return null;
  const skRec = Array.isArray(rec.skills) ? rec.skills[Math.min(state.ui.skillIndex, rec.skills.length - 1)] : null;
  const talents = visibleTalents(rec);
  return {
    hand: true,
    uid: `hand:${id}`,
    // 手牌没有范围键，这个字段只为让模板里的 ${u.rangeMode === 'skill'} 有个确定值
    rangeMode: 'attack',
    name: String(rec.name || id),
    charId: String(rec.charId || ''),
    tokenId: rec.tokenId || null,
    prof: rec.tokenId ? '召唤物' : String(rec.subProfessionName || PROF_CN[rec.profession] || rec.profession || ''),
    profession: rec.profession,
    level: rec.status?.level || null,
    rangeGrid: rec.rangeGrid || [],
    // 待部署状态展示所带配装的完整面板。
    hp: Number(rec.stats?.maxHp) || 0, maxHp: Number(rec.stats?.maxHp) || 0,
    atk: Number(rec.stats?.atk) || 0,
    def: Number(rec.stats?.def) || 0,
    res: Number(rec.stats?.res) || 0,
    block: Number(rec.stats?.blockCnt) || 0,
    talents,
    traitDesc: typeof rec.trait === 'string' ? rec.trait : String(rec.trait?.desc || rec.trait?.descRaw || ''),
    traitRich: rec.trait?.descRaw,
    skillInfo: skillInfoOf(skRec),
    skill: null,
    alt: null,
  };
}


return { unitVM, handVM };
}
