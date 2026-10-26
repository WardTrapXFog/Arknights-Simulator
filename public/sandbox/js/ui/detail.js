import { esc, clamp01 } from './html.js';
import { icon, iconStroke, rangeGridIcon } from './icons.js';
import { portrait, portraitFrame, skillIcon, professionIcon } from '../asset-urls.js';

function fitPortrait(refs, charId) {
  refs._portraitObserver?.disconnect();
  const host = refs.detail.querySelector('.dt__portrait'), image = host.querySelector('img');
  const frame = portraitFrame(charId);
  if (!frame) return;
  const fit = () => {
    const [left, top, width, height] = frame.bounds;
    const scale = Math.min(host.clientWidth / width, host.clientHeight / height);
    image.style.width = `${frame.width * scale}px`;
    image.style.height = `${frame.height * scale}px`;
    image.style.left = `${(host.clientWidth - width * scale) / 2 - left * scale}px`;
    image.style.top = `${-top * scale}px`;
  };
  host.classList.add('is-framed');
  refs._portraitObserver = new ResizeObserver(fit);
  refs._portraitObserver.observe(host);
  fit();
}

function description(text, plain = '') {
  const source = /\{[^}]+\}/.test(String(text || '')) ? plain : text || plain;
  let depth = 0;
  const result = String(source || '').split(/(<[@$][^>]+>|<\/>)/g).map((part) => {
    if (part === '</>') { if (!depth) return ''; depth--; return '</span>'; }
    if (/^<[@$]/.test(part)) {
      depth++;
      const kind = /ba\.rem|ba\.warning/.test(part) ? 'note' : /ba\.vup|ba\.kw|^<\$/.test(part) ? 'value' : 'effect';
      return `<span class="dt__text-${kind}">`;
    }
    return esc(part);
  }).join('');
  return result + '</span>'.repeat(depth);
}

function rangeDiagram(grid = []) {
  const cells = [[0, 0], ...grid].filter((p) => Array.isArray(p) && p.length >= 2);
  const rows = cells.map((p) => p[0]), cols = cells.map((p) => p[1]);
  const r0 = Math.min(...rows), r1 = Math.max(...rows), c0 = Math.min(...cols), c1 = Math.max(...cols);
  const size = 12;
  const tiles = grid.map(([r, c]) => `<rect x="${(c - c0) * size + 1}" y="${(r1 - r) * size + 1}" width="10" height="10" fill="currentColor"/>`).join('');
  return `<svg viewBox="0 0 ${(c1 - c0 + 1) * size} ${(r1 - r0 + 1) * size}" aria-hidden="true">${tiles}<rect x="${-c0 * size + 1}" y="${r1 * size + 1}" width="10" height="10" fill="#e5912a" stroke="#ffd58b" stroke-width="1"/></svg>`;
}

const detailTabOf = new Map();
function detailTab(u) {
  const key = String(u.uid ?? '');
  const t = detailTabOf.get(key);
  if (t) return t;
  // 没手动切过：有技能就给技能页，否则给特性页（防止技能页全空）
  return u.skillInfo || u.skill ? 'skill' : 'trait';
}
export function setDetailTab(uid, tab) {
  detailTabOf.set(String(uid), tab);
}

/** 右栏正文：只渲染当前 Tab 的内容。 */
function detailTabBody(u, tab, talents, skillInfo, traitDesc) {
  if (tab === 'trait') {
    // 正常情况下一定拿得到（unitVM/handVM 都会从棋子记录里取 trait）。
    // 真拿不到时不要写「没有特性说明」这种话 —— 那是我们取值失败，不是干员没有特性。
    return `<p class="dt__seg-p${traitDesc ? '' : ' dt__seg-p--empty'}">${description(u.traitRich, traitDesc || '—')}</p>`;
  }
  if (tab === 'talent') {
    if (!talents.length) return `<p class="dt__seg-p dt__seg-p--empty">—</p>`;
    return talents.map((t) => `<div class="dt__seg">
      <div class="dt__seg-h"><b>${esc(t.name)}</b><i class="dt__seg-k">${['第一天赋', '第二天赋', '第三天赋'][t.index] || `天赋 ${t.index + 1}`}</i></div>
      <p class="dt__seg-p">${description(t.richDesc, t.desc)}</p>
    </div>`).join('');
  }
  // skill
  if (!skillInfo) return `<p class="dt__seg-p dt__seg-p--empty">—</p>`;
  const sk = u.skill;
  // 本体在技能名下面标注「自动回复 / 手动触发」这类触发方式；这里用技能对象上的字段拼
  const meta = [], spType = sk?.spType || skillInfo.spType;
  const recovery = { INCREASE_WITH_TIME: '自动回复', time: '自动回复', INCREASE_WHEN_ATTACK: '攻击回复', attack: '攻击回复', INCREASE_WHEN_TAKEN_DAMAGE: '受击回复', hurt: '受击回复', hit: '受击回复' }[spType];
  if (skillInfo.passive) meta.push('<i class="dt__meta--trigger">被动</i>');
  else {
    if (recovery) meta.push(`<i class="dt__meta--recovery">${recovery}</i>`);
    meta.push(`<i class="dt__meta--trigger">${(sk?.auto ?? skillInfo.auto) ? '自动触发' : '手动触发'}</i>`);
  }
  const duration = skillInfo.duration;
  if (Number.isFinite(duration) && duration > 0) meta.push(`<i class="dt__meta--duration">◷ ${duration}秒</i>`);
  else if (duration < 0 || duration === Infinity) meta.push('<i class="dt__meta--duration">持续时间无限</i>');
  return `<div class="dt__seg dt__skill-info">
    ${skillIcon(skillInfo.skillId || sk?.skillId) ? `<img class="dt__description-icon" src="${esc(skillIcon(skillInfo.skillId || sk?.skillId))}" alt="" />` : ''}
    <div class="dt__skill-copy">
    <div class="dt__seg-h"><b>${esc(skillInfo.name || '—')}</b></div>
    <div class="dt__seg-meta">${meta.join('')}</div>
    <p class="dt__seg-p">${description(skillInfo.richDesc, skillInfo.desc)}</p>
    </div>
  </div>`;
}

/**
 * @param {null | {uid,name,charId,prof,hp,maxHp,atk,def,res,block,
 *   skill:{name,skillId,sp,cost,ready,active,left,dur,frac}|null, alt?:string,
 *   talents?:Array<{index,name,desc}>, skillInfo?:{name,desc}|null}} u
 */
export function renderDetail(refs, u) {
  if (!u) {
    if (refs._detailUid != null) {
      refs._portraitObserver?.disconnect();
      refs._detailUid = null;
      refs.detail.classList.remove('is-on');
      refs.detail.innerHTML = '';
      refs.selectionActions.innerHTML = '';
      refs.selectionActions.hidden = true;
    }
    return;
  }
  refs.detail.classList.add('is-on');
  refs.detail.classList.toggle('has-custom-actions', !!u.alt);
  // 手牌选中没有撤退键：让第一行占满整行（见 sandbox.css .is-hand）
  refs.detail.classList.toggle('is-hand', !!u.hand);
  refs.detail.classList.toggle('is-token', !!u.tokenId);

  const detailKey = `${u.uid}:${u.personaIndex ?? ''}:${u.skill?.skillId || u.skillInfo?.skillId || ''}`;
  if (refs._detailUid !== detailKey) {
    refs._detailUid = detailKey;
    const sk = u.skill;
    const skIcon = sk ? skillIcon(sk.skillId) : null;
    const talents = Array.isArray(u.talents) ? u.talents : [];
    const skillInfo = u.skillInfo || null;
    // 特性文案由 unitVM / handVM 提供（棋子记录的 trait.desc）。这里必须取出来，
    // 否则 detailTabBody 拿不到它 —— 上一版就是漏了这一行，直接 ReferenceError 把整个 syncHud 打断，
    // 表现是「时间不走、面板不显示」。
    const traitDesc = String(u.traitDesc || '');
    // 手牌与场上共用左侧详情；场上操作另挂在地面投影平面中。
    const tab = detailTab(u);
    const body = detailTabBody(u, tab, talents, skillInfo, traitDesc);
    const profIcon = professionIcon(u.profession), profLarge = professionIcon(u.profession, 'large') || profIcon;
    refs.detail.innerHTML = `
  <div class="dt__portrait"><img src="${esc(portrait(u.charId))}" alt="${esc(u.name)}" /></div>
  <div class="dt__basic">
    <div class="dt__head">
      <div class="dt__headtext">
        ${profLarge ? `<img class="dt__profession" src="${esc(profLarge)}" alt="${esc(u.prof)}" />` : ''}
        <div class="dt__name">${esc(u.name)}</div>
        <div class="dt__level">${profIcon && !u.tokenId ? `<img src="${esc(profIcon)}" alt="" />` : `<small>${esc(u.prof)}</small>`}${u.level ? `<small>LV</small><b>${u.level}</b>` : ''}</div>
      </div>
    </div>
    <div class="dt__stats">
      <div class="dt__stat"><i>攻击力</i><b data-k="atk">0</b></div>
      <div class="dt__stat"><i>防御力</i><b data-k="def">0</b></div>
      <div class="dt__stat"><i>法术抗性</i><b data-k="res">0</b></div>
      <div class="dt__stat"><i>阻挡数</i><b data-k="block">0</b></div>
    </div>
    <${u.hand ? 'div' : 'button'} class="dt__range-preview" ${u.hand ? '' : 'data-act="unit-range"'} title="攻击范围与技能范围">
      <span data-k="range-preview">${rangeDiagram(u.rangeGrid)}</span><small data-k="range-label">${u.rangeMode === 'skill' ? '技能范围' : '攻击范围'}</small>
    </${u.hand ? 'div' : 'button'}>
    <div class="dt__hp"><i data-k="hpfill"></i><span class="dt__hp-label">生命</span><b data-k="hptext"></b></div>
    ${u.hand ? '' : `<div class="dt__basicbtns">
      <button class="dt__skill" data-act="unit-skill" title="${sk ? esc(sk.name) : '无技能'}">
        ${skIcon ? `<img src="${esc(skIcon)}" alt="" />` : `<i class="ph">S${(sk?.index ?? 0) + 1}</i>`}
        <i class="dt__charge" data-k="charge"></i>
        <i class="dt__dur" data-k="dur" style="width:0;display:none"></i>
        <span class="dt__sp" data-k="sp"></span>
      </button>
      <button class="dt__range${u.rangeMode === 'skill' ? ' is-on' : ''}" data-act="unit-range"
              title="${u.rangeMode === 'skill' ? '当前：技能范围（点击切回攻击范围）' : '当前：攻击范围（点击查看技能范围）'}"
              aria-pressed="${u.rangeMode === 'skill' ? 'true' : 'false'}">
        ${rangeGridIcon()}
      </button>
      <button class="dt__retreat" data-act="retreat" title="撤退">
        ${iconStroke('leave')}<span>撤退</span>
      </button>
    </div>`}
  </div>
  <div class="dt__right">
    <div class="dt__tabs" role="tablist">
      <button class="dt__tab${tab === 'skill' ? ' is-on' : ''}" data-act="dt-tab" data-dt="skill" role="tab">技能</button>
      <button class="dt__tab${tab === 'trait' ? ' is-on' : ''}" data-act="dt-tab" data-dt="trait" role="tab">特性</button>
      <button class="dt__tab${tab === 'talent' ? ' is-on' : ''}" data-act="dt-tab" data-dt="talent" role="tab">天赋</button>
    </div>
    <div class="dt__info">${body}</div>
  </div>
  ${u.alt ? `<div class="dt__actions"><button class="dt__alt" data-act="unit-alt" data-k="alt">
    <span data-k="alt-text">${esc(u.alt)}</span><i class="dt__cd" data-k="alt-cd" style="display:none"></i>
  </button>
  <button class="dt__alt" data-act="unit-equipment" data-k="equip">${esc(u.equipment)}</button></div>` : ''}`;
    fitPortrait(refs, u.charId);
    refs.selectionActions.replaceChildren();
    const controls = refs.detail.querySelector('.dt__basicbtns');
    if (controls) refs.selectionActions.append(controls);
    refs.selectionActions.hidden = !!u.hand;
    refs.detail.classList.remove('is-bump');
    void refs.detail.offsetWidth;
    refs.detail.classList.add('is-bump');
  }

  // 每帧只改数字
  const q = (k) => refs.detail.querySelector(`[data-k="${k}"]`) || refs.selectionActions.querySelector(`[data-k="${k}"]`);
  // 手牌选中没有血条节点；场上干员才有
  const hpFill = q('hpfill');
  if (hpFill) hpFill.style.width = `${clamp01(u.hp / Math.max(1, u.maxHp)) * 100}%`;
  const hpText = q('hptext');
  // 血条上写「当前 / 上限」：手牌还没落地时是 0/0，落地后才是真实血量
  if (hpText) hpText.textContent = u.maxHp > 0 ? `${Math.round(u.hp)} / ${Math.round(u.maxHp)}` : '待部署';
  const atkEl = q('atk'); if (atkEl) atkEl.textContent = Math.round(u.atk);
  const defEl = q('def'); if (defEl) defEl.textContent = Math.round(u.def);
  const resEl = q('res'); if (resEl) resEl.textContent = Math.round(u.res);
  // 阻挡数：上一版重排时漏了这一个，导致面板上永远是 0
  const blockEl = q('block'); if (blockEl) blockEl.textContent = Math.round(u.block ?? 0);

  const btn = refs.selectionActions.querySelector('.dt__skill');
  const charge = q('charge');
  const dur = q('dur');
  const sp = q('sp');
  const sk = u.skill;
  if (!sk) {
    if (charge) charge.style.height = '0';
    if (dur) dur.style.display = 'none';
    if (sp) sp.textContent = '—';
    btn?.classList.remove('is-ready');
  } else if (btn) {
    // 任意一层已经可用时撤掉蒙版；继续积累后续层数不覆盖技能图标。
    charge.style.height = sk.active || sk.ready ? '0' : `${clamp01(sk.frac) * 100}%`;
    charge.hidden = !!sk.active || !!sk.ready;
    btn.classList.toggle('is-ready', !!sk.ready && !sk.active);
    if (sk.active && sk.dur > 0 && Number.isFinite(sk.dur)) {
      dur.style.display = 'block';
      dur.style.width = `${clamp01(sk.left / sk.dur) * 100}%`;
    } else {
      dur.style.display = 'none';
    }
    sp.textContent = sk.active ? sk.ammoMax > 0 ? `弹药 ${sk.ammoLeft}/${sk.ammoMax}`
      : Number.isFinite(sk.left) && sk.dur > 0 ? `${sk.left.toFixed(1)}s` : '持续生效'
      : sk.ready ? `READY${sk.maxCharges > 1 ? ` ${sk.charges}` : ''}` : `${Math.floor(sk.sp)}/${sk.cost}`;
  }
  const range = refs.selectionActions.querySelector('.dt__range');
  if (range) {
    range.classList.toggle('is-on', u.rangeMode === 'skill');
    range.setAttribute('aria-pressed', String(u.rangeMode === 'skill'));
    range.title = u.rangeMode === 'skill' ? '当前技能范围，点击查看攻击范围' : '当前攻击范围，点击查看技能范围';
  }
  const rangeSig = JSON.stringify(u.rangeGrid);
  if (refs._detailRange !== rangeSig || refs._detailRangeUid !== u.uid) {
    q('range-preview').innerHTML = rangeDiagram(u.rangeGrid);
    refs._detailRange = rangeSig; refs._detailRangeUid = u.uid;
  }
  q('range-label').textContent = u.rangeMode === 'skill' ? '技能范围' : '攻击范围';

  // 面具切换冷却：按钮上直接压一层倒计时，剩几秒写得清清楚楚（原来完全没有反馈，
  // 玩家点了没反应只能猜「是不是费不够/是不是坏了」）。同时把面具名与费用改成实时值。
  const altBtn = q('alt');
  if (altBtn) {
    const cd = Math.max(0, Number(u.altCd) || 0);
    const altText = q('alt-text');
    const altCd = q('alt-cd');
    if (altText && u.alt && altText.textContent !== u.alt) altText.textContent = u.alt;
    altBtn.classList.toggle('is-cooling', cd > 0);
    altBtn.classList.toggle('is-poor', !!u.altPoor);
    if (altCd) {
      if (cd > 0) { altCd.style.display = 'block'; altCd.textContent = `${cd.toFixed(1)}s`; }
      else altCd.style.display = 'none';
    }
    altBtn.title = cd > 0 ? `面具切换冷却中，还剩 ${cd.toFixed(1)} 秒`
      : u.altPoor ? '部署费用不足 10 点'
      : '消耗 10 点部署费用，切换人格面具（切换后 5 秒冷却）';
  }
}

/* -------------------------------------------------------------------------------------------------------------- */
/* 左侧工具箱                                                                                                       */
/* -------------------------------------------------------------------------------------------------------------- */

