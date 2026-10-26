import { playLevelBgm, stopLevelBgm, currentLevelBgm } from './level-bgm.js';
import { DEFAULT_MENU_MUSIC } from './settings.js';

const CUES = {
  hover: '/assets/audio/sfx/general/g_ui/g_ui_btn_u.mp3',
  click: '/assets/audio/sfx/general/g_ui/g_ui_btn_h.mp3',
};
let settings = {}, section = 'home', active = true, unlocked = false, tracks = [];
let ctx = null, output = null, lastCue = -Infinity, menuUrl = null;
const buffers = new Map();

export async function loadMenuMusic() {
  try {
    const response = await fetch('/api/music', { cache: 'no-store' });
    if (!response.ok) return null;
    tracks = (await response.json()).files || [];
  } catch { return null; }
  refreshMusic();
  return tracks;
}

function refreshMusic() {
  const track = tracks.find((item) => item.name === (settings.menuBgmTrack || DEFAULT_MENU_MUSIC));
  if (!active || !unlocked || !settings.menuBgm || !track || settings.muted || settings.bgm <= 0) {
    if (menuUrl && currentLevelBgm() === menuUrl) stopLevelBgm();
    menuUrl = null; return;
  }
  menuUrl = track.url;
  playLevelBgm(track.url, settings.bgm);
}

export function setMenuAudio(value, scene = section, enabled = active) {
  settings = value; section = scene; active = enabled;
  if (output && ctx) output.gain.setTargetAtTime(value.muted ? 0 : value.sfx, ctx.currentTime, .035);
  refreshMusic();
}

export function unlockMenuAudio() {
  if (!active) return;
  unlocked = true;
  if (!ctx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      ctx = new AudioContext(); output = ctx.createGain();
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2600;
      output.connect(filter); filter.connect(ctx.destination);
      output.gain.value = settings.muted ? 0 : settings.sfx;
    }
  }
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
  refreshMusic();
}

export async function menuCue(kind) {
  if (!active || !unlocked || !ctx || settings.muted || !(settings.sfx > 0)) return;
  const now = performance.now();
  if (now - lastCue < (kind === 'hover' ? 125 : 45)) return;
  lastCue = now;
  const url = CUES[kind];
  if (!url) return;
  if (!buffers.has(url)) buffers.set(url, fetch(url).then((r) => r.ok ? r.arrayBuffer() : null)
    .then((bytes) => bytes ? ctx.decodeAudioData(bytes) : null).catch(() => null));
  const buffer = await buffers.get(url);
  if (!buffer || !active || settings.muted || performance.now() - now > 350) return;
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = buffer; source.playbackRate.value = .94;
  gain.gain.value = kind === 'hover' ? .14 : .4;
  source.connect(gain); gain.connect(output); source.start();
  source.onended = () => { source.disconnect(); gain.disconnect(); };
}
