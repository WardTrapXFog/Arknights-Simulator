// Render-event audio anchors. The host supplies its existing AudioManager through fx.ctx.audio.
export class TalulaAudioAnchors {
  constructor(fx) {
    this.fx = fx;
    this.clock = 0;
    this.loops = new Map();
    this.casts = new Map();
    this.impacts = new Map();
    this.lastHit = new Map();
    this.pending = [];
  }

  bank(id) {
    const audio = this.fx.ctx.audio;
    if (!audio) return null;
    const view = this.fx._viewOf(id);
    const def = view?.info?.spine || audio.units?.get(id)?.def || view?.info?.defId;
    const bank = audio.getManifest?.()?.audio?.sfx?.units?.[def];
    return bank?.talula?.renderAnchors ? { audio, bank, view } : null;
  }

  slot(info) { return info.view?.skillIndex ?? info.view?.actor?.skillIndex ?? null; }

  play(info, url, id, anchor, gain = 0.55) {
    if (typeof url !== 'string' || !url) return;
    info.audio._playUnitUrl(url, `talula:${id}:${anchor}`, gain);
  }

  stopLoop(id) {
    const info = this.bank(id), rec = this.loops.get(id);
    (info?.audio || rec?.audio)?._stopSkillAmbient(id, rec?.fadeOut ?? 0.18);
    this.loops.delete(id);
  }

  loop(id, info) {
    const slot = this.slot(info), url = info.bank.skillLoops?.[slot];
    const old = this.loops.get(id);
    if (typeof url !== 'string' || !url) { this.stopLoop(id); return; }
    if (old && old.slot === slot && old.url === url) return;
    this.stopLoop(id);
    const cfg = info.bank.talula;
    this.loops.set(id, {
      slot, url, audio: info.audio, fadeOut: cfg.fadeOut ?? 0.18,
      gain: Number(cfg.loopGainBySlot?.[slot] ?? cfg.loopGain) || 0.32,
      rate: Number(cfg.loopRateBySlot?.[slot] ?? 1) || 1,
    });
    this.ensureLoop(id, info);
  }

  ensureLoop(id, info) {
    const rec = this.loops.get(id), audio = info.audio;
    if (!rec) return;
    const muted = audio.volumes?.muted || !(audio.volumes?.sfx > 0) || this.fx.ctx.timeScale?.() === 0;
    if (muted) { audio._stopSkillAmbient(id, 0.03); return; }
    const cfg = info.bank.talula;
    audio._startSkillAmbient(id, rec.url, {
      slot: rec.slot, fadeIn: cfg.fadeIn ?? 0.12,
      gain: rec.gain ?? cfg.loopGain ?? 0.32,
      rate: rec.rate ?? 1,
    });
  }

  hit(id, strike) {
    const info = this.bank(strike.source);
    if (!info || strike.done) return;
    strike.done = true;
    // One audible contact per actor and short time window, even for a screen-wide hit.
    const now = info.audio.ctx?.currentTime ?? this.clock;
    if (now - (this.lastHit.get(strike.source) ?? -Infinity) < 0.045) return;
    this.lastHit.set(strike.source, now);
    this.play(info, strike.slot == null ? info.bank.hit : info.bank.hits?.[strike.slot] ?? info.bank.hit,
      strike.source, 'hit', 0.5);
  }

  event(e) {
    const kind = e[0], id = e[1];
    if (kind === 'dmg') {
      const strike = this.impacts.get(id);
      if (strike && this.clock - strike.at < 0.35 && ['phys', 'arts', 'true'].includes(e[3]) && Number(e[2]) > 0) this.hit(id, strike);
      return;
    }
    if (kind === 'fx') {
      const ex = e[4] || {}, info = this.bank(ex.id);
      if (!info) return;
      if (e[1] === 'talulaIgnite') this.casts.set(ex.id, this.clock + 1.5);
      const anchor = info.bank.talula.anchors?.[e[1]];
      if (!anchor) return;
      this.pending = this.pending.filter((v) => v.id !== ex.id);
      // Null URLs are intentional empty asset slots, never requests for a made-up file.
      if (typeof anchor.url !== 'string' || !anchor.url) return;
      const delay = Math.max(0, anchor.delay || 0);
      if (!delay) this.play(info, anchor.url, ex.id, e[1], 0.65);
      else this.pending.push({ id: ex.id, url: anchor.url, at: this.clock + delay, name: e[1] });
      return;
    }
    const info = this.bank(id);
    if (!info) {
      if (kind === 'atk') this.impacts.delete(e[2]);
      return;
    }
    if (kind === 'skill') {
      if (e[2]) {
        if (this.slot(info) === 0) this.casts.set(id, this.clock + 1.5);
        this.loop(id, info);
      } else this.stopLoop(id);
    } else if (kind === 'atk') {
      const slot = this.casts.has(id) ? 0
        : (info.view?.actor?.skillOn ?? info.view?.statuses?.has('skill')) ? this.slot(info) : null;
      this.casts.delete(id);
      if (this.impacts.size >= 256) this.impacts.delete(this.impacts.keys().next().value);
      this.impacts.set(e[2], { source: id, slot, at: this.clock, done: false });
      this.play(info, slot == null ? info.bank.attack : info.bank.attacks?.[slot] ?? info.bank.attack, id, 'attack');
    } else if (kind === 'die' || kind === 'leak') {
      this.stopLoop(id); this.casts.delete(id); this.lastHit.delete(id);
      this.pending = this.pending.filter((v) => v.id !== id);
    } else if (kind === 'cast' && info.view?.actor?.skillOn) this.loop(id, info);
  }

  update(dt) {
    this.clock += dt * this.fx._ts();
    for (const [id, until] of this.casts) if (until <= this.clock) this.casts.delete(id);
    for (const [id, strike] of this.impacts) if (this.clock - strike.at >= 0.35) this.impacts.delete(id);
    for (const [id] of this.loops) {
      const info = this.bank(id), v = info?.view;
      if (!info || !v || v.alive === false || !(v.actor?.skillOn ?? v.statuses?.has('skill'))) {
        this.stopLoop(id); continue;
      }
      this.loop(id, info);
      this.ensureLoop(id, info);
    }
    let write = 0;
    for (const cue of this.pending) {
      const info = this.bank(cue.id);
      if (!info?.view || info.view.alive === false) continue;
      if (cue.at <= this.clock) this.play(info, cue.url, cue.id, cue.name, 0.65);
      else this.pending[write++] = cue;
    }
    this.pending.length = write;
  }

  clear() {
    for (const [id] of this.loops) this.stopLoop(id);
    this.casts.clear(); this.impacts.clear(); this.lastHit.clear(); this.pending.length = 0; this.clock = 0;
  }
}
