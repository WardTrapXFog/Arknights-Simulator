import { DataSource, setSimData } from '/sim/simdata.js';

/** Reuse the page's cached data. No old Battle, match scripts or trait installer. */
export async function loadBattleData(data) {
  if(new URLSearchParams(globalThis.location?.search).get('engine')==='legacy'){
    return (await import('../../js/battle/simLoader.js')).loadBrowserSim();
  }
  const names=['chess','enemies','tokens','stages','waves','bonds','items','garrisons','bands','effects','backups'];
  await data.loadAll(...names);
  const raw=Object.fromEntries(names.map(name=>[name,data.getRaw(name)]));
  setSimData(raw);
  return {raw,ds:new DataSource(raw)};
}
