import { AUE_COMMIT } from './version.js';
export { AUE_COMMIT };
const base = `/vendor/aue-trial/${AUE_COMMIT}/`;
let pending = null;

/** Load the pinned engine once, when a battle is first opened. */
export function loadAueRuntime() {
  if (!pending) pending = load().catch(error => { pending = null; throw error; });
  return pending;
}
async function load() {
  const response = await fetch(base + 'manifest.json', { cache: 'no-store' });
  if (!response.ok) throw Error('本地引擎缓存缺失，请关闭启动窗口后重新启动模拟器。');
  const manifest = await response.json();
  if (manifest.version !== 1 || manifest.commit !== AUE_COMMIT || manifest.entry !== 'packages/sim/src/index.js'
    || manifest.scope !== 'battle-trial') throw Error('AUE 实验源码版本不匹配，请重新准备。');
  const sim = await import(base + manifest.entry);
  const [traits, kits, grid, skillDefs, foes, commands, units, legacySkill, wrappers, specs, spawner] = await Promise.all([
    'traits.js', 'compat/kits.js', 'compat/grid.js', 'skills.js', 'foes.js',
  ].map(file => import(base + 'packages/content/src/' + file)).concat([
    import(base + 'packages/sim/src/commands.js'), import(base + 'packages/sim/src/units.js'), import(base + 'packages/content/src/compat/skill.js'), import(base+'packages/content/src/compat/unit.js'), import(base+'packages/content/src/compat/specs.js'), import(base+'packages/sim/src/spawn.js'),
  ]));
  const registryResponse = await fetch(base + manifest.kits, { cache: 'no-store' });
  if (!registryResponse.ok) throw Error('本地 kit 登记缺失，请重新准备源码');
  const registry = await registryResponse.json();
  const tokens=await grid.loadUnderGrid(()=>import(base+'local/server/sim/content/tokens.js'));
  async function factory(record) {
    const key = record.kitRef || (registry[record.charId] ? record.charId : record.baseId || record.chessId);
    const file = registry[key];
    if (!file) throw Error(`未登记本地 kit：${record.name} (${key})`);
    const mod = await grid.loadUnderGrid(() => import(base + file));
    const fn = mod.default?.[key];
    if (typeof fn !== 'function') throw Error(`本地 kit 未导出工厂：${key}`);
    return fn;
  }
  return { sim, manifest, traits, kits, grid, skillDefs, foes, commands, units, legacySkill, wrappers, specs, spawner, factory, tokens };
}
