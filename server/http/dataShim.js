// Browser-facing bridge for simulation modules that import server/data.js.
export const DATA_SHIM_JS = `// Generated browser stand-in for server/data.js.
import { getSimData } from './sim/simdata.js';
export function getData() { return getSimData() || {}; }
export function resetData() {}
`;
