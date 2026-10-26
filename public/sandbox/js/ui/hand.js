import { esc } from './html.js';
import { avatar, tokenIcon, skillIcon, rarityStars, rarityColor, professionIcon } from '../asset-urls.js';
import { isDiy } from '../roster.js';

/** 自设干员在界面上带「（自设）」后缀，和官方同名干员区分开。 */
export const displayName = (o) => {
  const name = o?.name ?? '';
  const id = o?.chessId || o?.id || '';
  return isDiy(id) || isDiy(o?.defId) ? `${name}（自设）` : name;
};

export function renderHand(refs, squad, sel, act) {
  const sig = squad.map((o) => o.id).join('|') + `#${sel.active}#${sel.skillIndex}#${sel.pop ? 1 : 0}`;
  const updateState = () => {
    const cards = refs.hand.querySelectorAll('.ocard');
    squad.forEach((o, i) => {
      const el = cards[i];
      if (!el) return;
      el.classList.toggle('is-unavailable', !!o.disabled);
      el.classList.toggle('is-pending', !!o.pending);
      el.classList.toggle('is-cooling', o.cooldown > 0);
      el.setAttribute('aria-disabled', o.disabled ? 'true' : 'false');
      el.title = [displayName(o), `${o.cost} 费`, o.reason].filter(Boolean).join(' · ');
      el.querySelector('.ocard__cost').textContent = o.cost;
      el.querySelector('.ocard__state').textContent = o.cooldown > 0 ? '' : o.marker || (o.disabled ? o.reason === '部署费用不足' ? '费用不足' : o.reason : '');
      const cooldown = el.querySelector('.ocard__cooldown');
      cooldown.hidden = !(o.cooldown > 0);
      if (o.cooldown > 0) {
        const fraction = Math.min(1, o.cooldown / Math.max(o.cooldown, o.cooldownTotal || o.cooldown));
        cooldown.querySelector('.ocard__clock-ring').style.strokeDashoffset = String(1 - fraction);
        cooldown.querySelector('text').textContent = (Math.ceil(o.cooldown * 10) / 10).toFixed(1);
        cooldown.setAttribute('aria-label', `再部署剩余 ${o.cooldown.toFixed(1)} 秒`);
      }
      el.querySelector('.ocard__stock').textContent = o.token ? `×${o.stock}` : '';
    });
  };
  if (sig === refs._handSig) { updateState(); return; }
  refs._handSig = sig;
  act._ops = act._ops || [];
  refs.hand.classList.toggle('hand--tight', squad.length > 9);
  refs.hand.style.setProperty('--hand-count', String(Math.max(1, squad.length))); 

  const cards = squad.map((o) => {
    const on = o.id === sel.active;
    const skills = (o.skills || []).map((sk, i) => {
      const url = skillIcon(sk.skillId);
      const onS = on && i === sel.skillIndex;
      return `<button class="oskill${onS ? ' is-on' : ''}" data-act="skill" data-s="${i}" type="button">
        ${url ? `<img src="${esc(url)}" alt="" loading="lazy" />` : `<i class="oskill__ph">S${i + 1}</i>`}
        <b class="oskill__n">S${i + 1}</b>
        <span class="oskill__tip">S${i + 1} · ${esc(sk.name || '—')}</span>
      </button>`;
    }).join('');

    const profIcon = professionIcon(o.profession);
    return `<div class="ocard${o.token ? ' is-token' : ''}${on ? ' is-on' : ''}${on && sel.pop ? ' is-pop' : ''}" data-act="card" data-id="${esc(o.id)}" role="button" tabindex="0"
        title="${esc(displayName(o))} · ${esc(o.prof)} · ${o.cost} 费">
      <button class="ocard__del" type="button" data-act="card-remove" data-id="${esc(o.id)}" title="移出手牌（可再点 ＋ 加回来）" aria-label="移出 ${esc(displayName(o))}">✕</button>
      ${profIcon ? `<i class="ocard__prof" style="background-image:url(${profIcon})" title="${esc(o.prof || o.profession)}"></i>` : ''}
      <div class="ocard__box">
        <img class="ocard__ava" src="${esc(o.token ? tokenIcon(o.tokenId || o.charId) : avatar(o.charId))}" alt="${esc(displayName(o))}" loading="lazy" />
        <i class="ocard__shade"></i>
        <i class="ocard__stars" style="color:${rarityColor(o.rarity)};-webkit-mask-image:url(${rarityStars(o.rarity)});mask-image:url(${rarityStars(o.rarity)})"></i>
        <b class="ocard__cost">${o.cost}</b>
        <span class="ocard__name">${esc(displayName(o))}</span>
        <span class="ocard__state"></span><span class="ocard__stock"></span>
        <div class="ocard__cooldown" hidden>
          <svg viewBox="0 0 100 100" role="img">
            <circle class="ocard__clock-track" cx="50" cy="50" r="34" />
            <circle class="ocard__clock-ring" cx="50" cy="50" r="34" pathLength="1" />
            <text x="50" y="50" dy=".35em" text-anchor="middle"></text>
          </svg>
        </div>
      </div>
      ${skills ? `<div class="oskills">${skills}</div>` : ''}
    </div>`;
  }).join('');

  refs.hand.innerHTML = `<div class="hand__scroll">${cards}</div><button class="hand__more" data-act="picker-open" title="从牌库加入干员">＋</button>`;
  updateState();
}

/* -------------------------------------------------------------------------------------------------------------- */
/* 选中干员面板                                                                                                     */
/* -------------------------------------------------------------------------------------------------------------- */

