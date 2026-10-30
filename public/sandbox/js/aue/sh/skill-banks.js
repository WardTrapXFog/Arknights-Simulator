import { ShSkill } from '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/packages/content/src/compat/skill.js';
import { skills } from '/vendor/aue-trial/b25523619c981cb1380928ffe96b0fcd67263e74/packages/sim/src/index.js';
import { skillDefinition } from '../content.js';
// Each persona owns a native skill state. Selecting a bank binds that state to
// the single native unit; the inactive banks gain SP without running another sim.
export class SkillRuntime extends ShSkill {
  constructor(battle,unit,definition,spec,bb) {
    super(unit,spec);this._bb=bb;
    this._def=skillDefinition({...definition,id:definition.id,bb,skillType:definition.skillType || 'MANUAL'},battle.__runtime);
    this._state=skills.makeSkillState(this._def);
  }
  get def(){return this._def;}
  get st(){return this._state;}
  get bb(){return this._bb;}
  get spTotal(){return this.sp;}
  setSpTotal(value){this.sp=value;}
  reset(){this._state=skills.makeSkillState(this._def);}
}
