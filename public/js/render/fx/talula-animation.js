// Talula-only motion and clip timing, measured in game seconds.
//
// 本文件是「素材怎么切」的唯一实现，依据 art/talula/animation-spec.json 与
// art/talula/素材动作实测.md。要点：
//   · 四档命中相位不同，不能共用一个 hitPhase：
//       普攻 / S2  40/70 ≈ 0.571429（Attack_2 第 40 帧）
//       S1         30/60 = 0.5     （Skill_1 第 30 帧）
//       S3         77/110 = 0.7    （Skill_2 第 77 帧）
//   · S1 的强化由真实 pending 消耗决定，不再用 1.2 秒标记。
//   · 每档有独立的起手/收势关键帧表（spec 的 attackProfiles）。
//   · 素材没有呼吸、展翼、起落骨骼；这些交给外层变换与特效，不伪造骨骼动作。

const TAU = Math.PI * 2;
const PHASES = [0, 0.625, 0.25, 0.875, 0.5, 0.125, 0.75, 0.375];
const motion = new WeakMap();
const sat = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const t = sat(v); return t * t * (3 - 2 * t); };

/**
 * 四档攻击档案。`hitFrame` / `frames` 来自实测；`windUp`/`recover` 是
 * 起手与收势在归一化进度上的源帧映射（spec.attackProfiles）。
 */
const PROFILES = Object.freeze({
  normal: {
    clip: 'Attack_2', frames: 70, hitFrame: 40,
    hitPhase: 40 / 70,
    recoverSeconds: 0.54,
    windUp: [[0, 0], [0.25, 16], [0.60, 37], [0.72, 39], [1, 40]],
    recover: [[0, 40], [0.18, 42], [0.32, 44], [0.65, 55], [1, 70]],
  },
  // S2 用 Attack_1：Boss 未被阻挡时的远程攻击（掌心前送）。
  // 关键帧取自实测：0–13 抬左手、13–29 收拢、30 张开前送（OnAttack）、33–60 回收。
  s2: {
    clip: 'Attack_1', frames: 60, hitFrame: 30,
    hitPhase: 0.5,
    recoverSeconds: 0.48,
    windUp: [[0, 0], [0.25, 7], [0.60, 28], [0.80, 29], [1, 30]],
    recover: [[0, 30], [0.20, 33], [0.35, 38], [0.70, 50], [1, 60]],
  },
  s3: {
    clip: 'Skill_2', frames: 110, hitFrame: 77,
    hitPhase: 77 / 110,
    recoverSeconds: 0.70,
    // S3 的 0–72 帧是长蓄势，会被提前量压得很短；表仍按原相位映射。
    windUp: [[0, 0], [0.20, 32], [0.45, 45], [0.60, 72], [0.78, 75], [1, 77]],
    recover: [[0, 77], [0.13, 79], [0.23, 80], [0.49, 95], [1, 110]],
  },
});

/** 当前是 S3 / S2 / 普攻 / S1 的哪一档。 */
export function talulaProfileKey(skillIndex, skillOn) {
  if (!skillOn) return 'normal';
  if (Number(skillIndex) === 2) return 's3';
  if (Number(skillIndex) === 1) return 's2';
  // S1 是强化普攻：动作仍是 Attack_2，命中相位与收势跟普攻同档。
  return 'normal';
}

/** 档位表（只读），供其它模块查命中相位与片段名。 */
export function talulaProfile(skillIndex, skillOn) {
  return PROFILES[talulaProfileKey(skillIndex, skillOn)];
}

/**
 * 在归一化进度 u 上按关键帧表取源帧号。
 *
 * **返回的是帧号，不是秒。** spine.js 的 swingTime() 把这些数字直接当
 * trackTime 用，所以必须除以 30 才能交给播放器；早期版本漏了这一步，
 * 普攻/S2 的预起手会跳到几十秒的位置（落在动画末尾），真实攻击到来时
 * 短暂校准到 1.333 秒又被下一次更新跳走，完整挥剑只剩瞬间的姿态变化。
 */
const FPS = 30;

/**
 * 剑真正在扫的那一段（源帧），收势回弹不算。
 *
 * 数值取自 `art/talula/animation-spec.json` 的 `attackProfiles[*].bladeWindowFrames30`
 * （`Attack_2` 39–44、`Skill_2` 75–80）；S2 已改用 `Attack_1`，那份规格里的 `s2`
 * 还是旧的 `Attack_2`，所以 s2 取 `Attack_1` 的分段「张掌前送 29–33 帧」。
 * 刀光采样（`talula-slash.js`）与 S1 的烈焰刀身都读这里，不再各自写一个字面量。
 */
const SWEEP_FRAMES = Object.freeze({
  normal: [39, 44],
  s2: [29, 33],
  s3: [75, 80],
});

/** 扫掠区间，单位**秒**（源帧 ÷ 30，与 `trackTime` 同轴）。 */
export function talulaSweep(profileKey) {
  const [from, to] = SWEEP_FRAMES[profileKey] || SWEEP_FRAMES.normal;
  return { from: from / FPS, to: to / FPS };
}

function frameAt(table, u) {
  const p = sat(u);
  for (let i = 1; i < table.length; i++) {
    const [p1, f1] = table[i];
    if (p <= p1) {
      const [p0, f0] = table[i - 1];
      const k = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
      return f0 + (f1 - f0) * k;
    }
  }
  return table[table.length - 1][1];
}

function phaseOf(view) {
  let h = 0;
  for (const c of String(view.id ?? 'talula')) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return PHASES[h % PHASES.length] * TAU;
}

// A local, repeatable visual sequence; never reads or advances the battle RNG.
export function talulaRandom(fx) {
  fx.talulaVisualSeed = (Math.imul(fx.talulaVisualSeed ?? 0x74616c75, 1664525) + 1013904223) >>> 0;
  return fx.talulaVisualSeed / 4294967296;
}

export function startTalulaMotion(view, airborne) {
  if (!view || typeof view !== 'object') return;
  const prev = motion.get(view);
  if (prev?.airborne === airborne) return;
  const height = prev?.height ?? ((view.hover || 0) + (view._float || 0));
  motion.set(view, {
    airborne, elapsed: 0, phase: prev?.phase ?? phaseOf(view),
    from: height, height, tilt: prev?.tilt || 0, fromTilt: prev?.tilt || 0,
    squash: prev?.squash ?? 1, fromSquash: prev?.squash ?? 1,
    contact: height > 0.001 || !!prev?.airborne,
  });
}

export function clearTalulaMotion(view) { motion.delete(view); }

/**
 * 高度、倾斜与落地缓冲。规格：起飞 0.35 格 / 0.35 秒上升、0.30 秒下降，
 * 悬停摆动 0.03 格、周期 1.6 秒。素材本身没有起落骨骼，这里是外层变换。
 */
export function sampleTalulaMotion(view, dt) {
  if (!view.entry?.anims?.swing?.talula) return null;
  let state = motion.get(view);
  const airborne = !!view.flying && view.alive !== false && !view.down;
  // Snapshot fallback also handles a view first seen in the middle of a skill.
  if (!state || state.airborne !== airborne) {
    startTalulaMotion(view, airborne);
    state = motion.get(view);
  }
  state.elapsed += Math.max(0, dt);
  const t = state.elapsed;
  const facing = view.dir === 'UP' ? 1 : view.visFacing < 0 ? -1 : 1;
  if (state.airborne) {
    const rise = 0.35;
    const u = sat(t / 0.35), blend = smooth(u);
    const bob = 0.03 * Math.sin(t * TAU / 1.6 + state.phase);
    state.height = state.from * (1 - blend) + (rise + bob) * blend;
    state.tilt = state.fromTilt * (1 - blend) - facing * 0.07 * Math.sin(Math.PI * u);
    state.squash = state.fromSquash + (1 - state.fromSquash) * blend;
  } else {
    const blend = smooth(t / 0.30);
    state.height = state.from * (1 - blend);
    state.tilt = state.fromTilt * (1 - blend);
    const contact = t - 0.30;
    const crouch = !state.contact || contact <= 0 || contact >= 0.18 ? 0
      : contact < 0.05 ? smooth(contact / 0.05) : 1 - smooth((contact - 0.05) / 0.13);
    state.squash = 1 + (state.fromSquash - 1) * (1 - blend) - 0.12 * crouch;
  }
  return state;
}

/**
 * 给 spine.js 的挥砍计划：按档位取命中相位与起手/收势表。
 *
 * 返回的 `segments` 是 [from,to,duration] 的姿态区间；`hitAt` 是命中在计划里的
 * 时刻。首刀提前量不足时（lead 很小），起手被压短但仍单调压到命中相位。
 */
export function talulaSwingPlan(entry, clip, duration, hit, interval, skillIndex, skillOn) {
  if (!entry?.anims?.swing?.talula || !(interval > 0)) return null;
  const profile = talulaProfile(skillIndex, skillOn);
  // 只处理本档真正的片段；其它片段（例如技能开场的 Idle）交回内置逻辑。
  if (clip !== profile.clip) return null;

  const hitAt = profile.hitPhase * interval;
  const recover = Math.min(profile.recoverSeconds, Math.max(0, interval - 0.28));
  const segments = [];
  let t = 0;
  // 起手：从命中相位倒推，压进 hitAt
  if (hitAt > 1e-4) {
    for (let i = 1; i < profile.windUp.length; i++) {
      const [p1] = profile.windUp[i];
      const dur = Math.max(1e-4, (hitAt) * (p1 - (i === 1 ? 0 : profile.windUp[i - 1][0])));
      segments.push({
        from: frameAt(profile.windUp, profile.windUp[i - 1][0]) / FPS,
        to: frameAt(profile.windUp, p1) / FPS,
        time: dur,
      });
      t += dur;
    }
  }
  // 收势
  if (recover > 1e-4) {
    for (let i = 1; i < profile.recover.length; i++) {
      const [p1] = profile.recover[i];
      const dur = Math.max(1e-4, recover * (p1 - profile.recover[i - 1][0]));
      segments.push({
        from: frameAt(profile.recover, profile.recover[i - 1][0]) / FPS,
        to: frameAt(profile.recover, p1) / FPS,
        time: dur,
      });
      t += dur;
    }
  }
  if (!segments.length) return null;
  return {
    clip, hit, hitAt, duration: interval, segments, talula: true,
    profile: talulaProfileKey(skillIndex, skillOn),
  };
}

/**
 * 施法/收技期间不画普通刀光。
 *
 * S1 已不再换成 Skill_1 播施法（`Skill_1` 是 Boss 的对单点名施法，见 docs/塔露拉表现总表.md 第一节），
 * 这条只剩 S2/S3 开技与收技时的抑制，判据回到 SpineActor 真实存在的 mode。
 */
export function talulaCasting(actor) {
  if (!actor?.entry?.anims?.swing?.talula) return false;
  return actor.mode === 'skillBegin' || actor.mode === 'skillEnd';
}
