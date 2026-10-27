import { MAX_SQUAD } from '../../sandbox/js/state.js';
import { canonicalOperatorId, isAvailable } from '../../sandbox/js/roster.js';
const KEY = 'arksim-player-teams-v1';
export const TEAM_SLOT_COUNT = 8;
export function cleanTeam(team = {}) {
  return { name: String(team.name || '出战编队').slice(0, 24),
    ids: [...new Set((team.ids || []).map(canonicalOperatorId))].filter(isAvailable).slice(0, MAX_SQUAD),
    skills: { ...(team.skills || {}) }, modules: { ...(team.modules || {}) } };
}
export function readTeams() {
  let saved; try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* 新建编队 */ }
  return Array.from({ length: TEAM_SLOT_COUNT }, (_, i) => cleanTeam(saved?.[i] || { name: `编队 ${i + 1}` }));
}
export function writeTeam(index, team) {
  const teams = readTeams(); teams[index] = cleanTeam(team);
  localStorage.setItem(KEY, JSON.stringify(teams)); return teams;
}
