// 结城理（自设佣兵）：三套独立技力，SI 手动切换；SP 按开局携带的人格自动作战。
import { SkillRuntime } from '../../../skills.js';
import { num, talentBb, skillRec, batMod, enemiesInGrid, alliesInGridOf, up } from '../shared/tier1.js';

const IDS = ['skchr_custommakoto_1', 'skchr_custommakoto_2', 'skchr_custommakoto_3'];
const NAMES = ['俄耳甫斯', '塔纳托斯', '弥赛亚'];
const ABNORMAL = ['stun','freeze','cold','sleep','fear','tremble','bind','sluggish','silence','levitate','weaken','makoto:paralysis'];
const hasAbnormal = e => ABNORMAL.some(k => e.findBuff(k) || e.s.flags[k]);

export default {
  char_9902_custommakoto: (bb, chess) => {
    const records = IDS.map(id => skillRec(chess, id)), boards = records.map(s => s.bb);
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), sandbox = !!bb.sandbox;
    const grid = index => records[index].rangeGrid;
    const foes = (battle, unit, index) => enemiesInGrid(battle, unit, grid(index));
    const mates = (battle, unit) => alliesInGridOf(battle, unit, grid(2)).filter(a => a.kind === 'op');
    const isSees = a => a.def.charId === 'char_9902_custommakoto' || a.def.raw?.nationId === 'sees' || a.def.charId === 'char_4217_makoto';
    function spend(battle, unit, cost) {
      const ps = battle.getPlayer(unit.ownerId);
      if (!up(unit) || !ps || !battle.canSpendDp(unit.ownerId, cost)) return false;
      battle.addDp(unit.ownerId, -cost);
      const trait = chess.trait?.bb || {};
      if (num(trait.spend_atk) > 0) {
        const m = unit.mem.customMakoto;
        m.stacks = (m.stacks || []).filter(until => until > battle.time);
        for (let i = 0; i < cost && m.stacks.length < num(trait.spend_cap, 10); i++) m.stacks.push(battle.time + num(trait.spend_duration, 30));
      }
      return true;
    }
    function protection(battle, unit, duration) {
      for (const a of mates(battle, unit)) {
        a.mem.makotoSafeUntil = Math.max(a.mem.makotoSafeUntil || 0, battle.time + duration);
        if (a.mem.makotoSafeHook) continue;
        a.mem.makotoSafeHook = true;
        battle.on('fatal', ctx => { if (ctx.unit === a && battle.time < (a.mem.makotoSafeUntil || 0)) ctx.prevented = true; }, { owner: a, priority: -100 });
      }
    }
    function equipment(battle, unit) {
      const m = unit.mem.customMakoto, index = m.index, b = boards[index];
      if (!unit.skill.active || battle.time < m.equipAt || (index === 2 && m.messiahUsed)) return false;
      if (!spend(battle, unit, num(b.equipment_cost))) return false;
      m.equipAt = battle.time + 3; // 装备应变使用卫戍协议自动操作的三秒间隔，SI 同样防止误连点。
      if (index === 0) {
        for (const e of foes(battle, unit, 0)) for (const type of ['phys', 'arts']) if (e.alive) battle.dealDamage(unit, e, {
          amount: unit.s.atk * num(b.equipment_scale), type, isSkill: true, tags: ['skill','makotoEquipment'],
        });
      } else if (index === 1) {
        for (const e of foes(battle, unit, 1)) {
          // AKF 未给麻痹时间，随本次十五秒技能剩余时间；每层攻速 -15，二层触发一秒晕眩。
          const layers = num(b.paralysis, 1), duration = Math.max(0.05, unit.skill.timeLeft);
          battle.addBuff(e, { key: 'makoto:paralysis', duration, mods: { aspd: -15 * layers }, refresh: 'replace', source: unit });
          if (layers >= 2) battle.applyStatus(e, 'stun', { duration: 1, source: unit });
          battle.applyStatus(e, 'fragile', { duration, value: num(b.vulnerable), source: unit });
        }
      } else {
        m.messiahUsed = true;
        const damage = mates(battle, unit).reduce((sum, a) => sum + a.s.atk, 0) * num(b.equipment_scale);
        for (const e of foes(battle, unit, 2)) battle.dealDamage(unit, e, { amount: damage, type: 'true', isSkill: true, tags: ['skill','makotoEquipment'] });
        protection(battle, unit, unit.skill.timeLeft + 10);
      }
      battle.fx('makotoEquipment', { x: unit.x, y: unit.y, id: unit.id, persona: index });
      return true;
    }
    const specs = {
      [IDS[0]]: { kind: 'toggle', mods: { atkPct: num(boards[0].atk), batPct: batMod(num(boards[0].bat_add), chess) },
        targeting: { maxTargets: num(boards[0].targets, 3) } },
      [IDS[1]]: { kind: 'duration', mods: { atkPct: num(boards[1].atk), aspd: num(boards[1].aspd) },
        onStart({ battle, unit }) {
          unit.mem.customMakoto.record = new Map(foes(battle, unit, 1).map(e => [e, 0]));
          battle.loseHp(unit, unit.s.maxHp * num(boards[1].hp_loss), { source: unit });
        },
        onEnd({ battle, unit }) {
          const m = unit.mem.customMakoto, record = m.record; m.record = null;
          if (!record) return;
          for (const [e, amount] of record) if (e.alive) battle.dealDamage(unit, e, { amount: amount * num(boards[1].record_scale), type: 'true', isSkill: true, tags: ['skill','makotoDetonate'] });
        } },
      [IDS[2]]: { kind: 'duration', flags: { liftoff: true, noBlock: true }, targeting: { rangeGrid: grid(2) },
        onStart({ unit }) { unit.mem.customMakoto.messiahUsed = false; },
        onEnd({ battle, unit, reason }) {
          if (!['duration','death','stopped'].includes(reason) || unit.mem.customMakoto.retired) return;
          unit.mem.customMakoto.retired = true;
          // 卫戍协议（SP）保留原设定：本场战斗不能再上场。关卡模拟器不锁人 —— 沙盒里想再放一次就再放一次，
          // 所以只有非沙盒才登记这张「已退役」表（main.js 的重部署拦截读的就是它）。
          if (!sandbox) {
            battle.customRetired ||= new Set();
            battle.customRetired.add(unit.def.charId);
          }
          battle.addDp(unit.ownerId, unit.mem.deployCostPaid ?? unit.base.cost);
          if (unit.alive) battle.retreat(unit, { reason: 'retreat', permanent: true, force: true });
        } },
    };
    return { skills: specs,
      install(battle, unit) {
        if (!battle.customRetreatGuard) {
          battle.customRetreatGuard = true;
          const retreat = battle.retreat;
          // S3 装备应变的庇护期里不让「被打死式退场」发生；但玩家自己点撤退必须放行（opts.force，沙盒撤退按钮传），
          // 否则开了三技能就撤不掉人 —— 关卡模拟器里这是硬伤，不是玩法。
          battle.retreat = function(target, opts) {
            if (!opts?.force && this.time < (target?.mem.makotoSafeUntil || 0) && !target?.mem.customMakoto?.retired) return false;
            return retreat.call(this, target, opts);
          };
        }
        const initial = Math.max(0, IDS.indexOf(unit.def.skill.id));
        const banks = records.map((rec, i) => i === initial ? unit.skill : new SkillRuntime(battle, unit,
          { ...rec, id: rec.skillId, spType: 'time', maxCharges: 1 }, specs[IDS[i]], rec.bb));
        const m = unit.mem.customMakoto = { index: initial, banks, switchAt: 0, equipAt: 0, stacks: [], retired: false, messiahUsed: false, record: null };
        const persona = () => {
          battle.removeBuff(unit, 'makoto:persona');
          const mods = m.index === 0 ? { hpFlat: num(t0.orpheus_hp), defFlat: num(t0.orpheus_def) }
            : m.index === 1 ? { dmgDealtMul: 1 + num(t0.thanatos), dmgTakenMul: 1 + num(t0.thanatos) } : {};
          battle.addBuff(unit, { key: 'makoto:persona', mods, persist: true, allowDead: true });
          if (unit.alive) unit.hp = Math.min(unit.hp, unit.s.maxHp);
        };
        persona();
        battle.on('deploy', c => {
          if (c.unit !== unit) return;
          for (const bank of banks) if (bank !== unit.skill) bank.reset();
        }, { owner: unit });
        battle.on('death', c => {
          if (c.unit === unit && m.retired) { unit.removed = true; unit.respawnAt = Infinity; }
        }, { owner: unit, priority: -100 });
        m.switchPersona = index => {
          if (!sandbox || !up(unit) || m.retired || index === m.index || index < 0 || index > 2 || battle.time < m.switchAt) return false;
          if (m.index === 2 && unit.skill.active) return false; // 不能通过换面具规避救济的强制退场。
          if (!spend(battle, unit, num(t0.switch_cost, 10))) return false;
          unit.skill.end('switch');
          m.index = index; unit.skill = banks[index]; m.switchAt = battle.time + num(t0.switch_cd, 5);
          persona(); battle._refreshRange(unit);
          battle.fx('makotoSummon', { x: unit.x, y: unit.y, id: unit.id, persona: index });
          return true;
        };
        m.equipment = () => equipment(battle, unit);
        m.names = NAMES;
        battle.on('skillStart', c => {
          if (c.unit === unit) battle.fx('makotoSummon', { x: unit.x, y: unit.y, id: unit.id, persona: m.index });
        }, { owner: unit });
        battle.on('skillEnd', c => {
          if (c.unit === unit) battle.fx('makotoRelease', { x: unit.x, y: unit.y, id: unit.id, persona: m.index });
        }, { owner: unit });
        battle.on('damaged', c => {
          if (c.source !== unit || c.target?.side !== 'enemy' || !(c.amount > 0)) return;
          const tags = c.dmg?.tags || [];
          const style = tags.includes('makotoDetonate') ? 'detonate' : tags.includes('makotoEcho') ? 'echo'
            : tags.includes('makotoEquipment') ? 'equipment' : tags.includes('makotoTrue') ? 'true'
              : tags.includes('makotoSplit') ? 'split' : c.dmg?.isAttack ? 'attack' : null;
          if (style) battle.fx('makotoHit', { x: c.target.x, y: c.target.y, id: c.target.id, src: unit.id, persona: m.index, style });
        }, { owner: unit, priority: 1 });
        const lastTrue = new WeakMap();
        battle.on('hit', c => {
          if (!up(unit) || c.source !== unit || !c.dmg.isAttack || c.target?.side !== 'enemy') return;
          if (m.index === 0 && unit.skill.active && c.dmg.type === 'phys') c.dmg.amount *= num(boards[0].split);
        }, { owner: unit });
        battle.on('damaged', c => {
          if (!(c.amount > 0) || c.target?.side !== 'enemy' || c.type === 'element' || c.dmg?.tags?.includes('makotoEcho')) return;
          const e = c.target;
          if (m.record?.has(e) && !c.dmg?.tags?.includes('makotoDetonate')) m.record.set(e, m.record.get(e) + c.amount);
          if (!up(unit)) return;
          if (c.source === unit && c.dmg?.isAttack) {
            if (m.index === 0 && unit.skill.active && c.type === 'phys' && e.alive) battle.dealDamage(unit, e, {
              amount: unit.s.atk * unit.s.atkScaleMul * num(boards[0].split), type: 'arts', isSkill: true, tags: ['skill','makotoSplit'],
            });
            const attackId = c.dmg.attackId ?? battle.tickCount;
            if (lastTrue.get(e) !== attackId) {
              lastTrue.set(e, attackId);
              if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * (hasAbnormal(e) ? num(t1.abnormal_scale) : num(t1.true_scale)), type: 'true', tags: ['talent','makotoTrue'] });
            }
          }
          if (m.index === 2 && unit.skill.active && e.alive && foes(battle, unit, 2).includes(e)) {
            const b = boards[2], amount = c.amount * num(b.echo_scale);
            for (let i = 0; i < num(b.echoes); i++) {
              if (!e.alive) break;
              const dealt = battle.dealDamage(unit, e, { amount, type: 'true', isSkill: true, tags: ['skill','makotoEcho'] });
              for (const a of mates(battle, unit)) battle.heal(unit, a, dealt, { tags: ['skill','makotoEcho'] });
            }
          }
        }, { owner: unit });
        battle.on('tick', ({ dt }) => {
          if (!up(unit)) return;
          for (const bank of banks) if (bank !== unit.skill && !bank.active) bank.gainSp(unit.s.spRecovery * dt, 'time');
          m.stacks = m.stacks.filter(until => until > battle.time);
          if (m.stacks.length) battle.addBuff(unit, { key: 'makoto:spend', mods: { atkPct: m.stacks.length * num(chess.trait?.bb?.spend_atk) }, duration: 0.08, refresh: 'replace' });
          if (m.index === 2) for (const a of battle.alliesFor(unit).filter(isSees)) battle.applyStrongest(a, 'makoto:sees', {
            value: num(t0.messiah), duration: 0.08, mods: v => ({ dmgDealtMul: 1 + v, dmgTakenMul: 1 - v }), source: unit,
          });
          if (m.index === 2 && unit.skill.active) for (const a of mates(battle, unit)) battle.addBuff(a, {
            key: 'makoto:salvation', mods: { atkPct: num(boards[2].atk_aura), aspd: num(boards[2].aspd_aura) }, duration: 0.08, refresh: 'replace', source: unit,
          });
          // SP 使用开局指定人格；有目标且费用足够时自动装备应变，每三秒最多一次。
          if (!sandbox && unit.skill.active && foes(battle, unit, m.index).length) equipment(battle, unit);
        }, { owner: unit });
      },
    };
  },
};
