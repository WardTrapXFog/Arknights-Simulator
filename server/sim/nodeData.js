// server/sim/nodeData.js — the Node-only default data loader of the simulation (DESIGN §14).
//
// server/sim/** is shared with browsers (served read-only at /sim/), so every Node API lives here. simdata.js imports
// this module dynamically — and only under Node — to build its default DataSource:
//   * generated data: `server/data.js → getData()` (the committed data/*.json).
// Browsers never load this file: they inject the fetched /data/*.json with simdata.js setSimData(data).
//
// This module must not import simdata.js (simdata awaits this module at its top level; a cycle would deadlock).

const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });

/** data/*.json through the server/data.js singleton (null when unavailable). */
export async function loadGenerated() {
  try {
    const mod = await import('../data.js');
    return mod.getData({ log: QUIET });
  } catch {
    return null;
  }
}

/** Drop the server/data.js singleton, then load again (tests / hot reload after data regeneration). */
export async function reloadGenerated() {
  try {
    const mod = await import('../data.js');
    mod.resetData?.();
  } catch { /* ignore */ }
  return loadGenerated();
}
