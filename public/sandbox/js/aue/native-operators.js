export function nativeLoadout(def) {
  if (!def.raw.aueNative) return null;
  const module=def.loadout?.moduleId ?? def.raw.module?.id ?? 'none';
  const skill=def.loadout?.skillIndex ?? def.raw.skill?.index ?? -1;
  const result=def.raw.aueDefinitions[`${module}:${skill}`];
  if (!result) throw Error(`原生配装数据缺失：${def.name} ${module} S${skill+1}`);
  return result;
}
