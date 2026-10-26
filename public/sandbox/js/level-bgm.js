// public/sandbox/js/level-bgm.js — 关卡自带作战音乐（关卡 JSON 的 meta.bgm）。
//
// 为什么单独一个模块：public/js/audio.js 的 BGM 是从 data/assets.json 的 audio 段按 key 取的（lobby/prep/combat/
// boss…），关卡音乐是用户自备、放在 content/music 下的文件，走 /music/<文件名>，和那套 key 不是一回事。
//
// 循环：OGG 里带 LOOPSTART / LOOPLENGTH（Vorbis comment，采样数；tools/music-loop.mjs 写入）。浏览器不认这两个标签，
// 所以这里自己用 Range 拉文件头解析它们，再交给 Web Audio 的 AudioBufferSourceNode.loopStart / loopEnd ——
// 这才是真正的无缝循环；<audio loop> 只能整段重放，接缝在曲头。
// 没有标签的文件（老 mp3、别的曲子）退回 <audio loop> 整段循环，不会因此不出声。

let ctx = null;          // 懒建的 AudioContext（和 audio.js 共用同一个更好，但它是私有的，这里单开一个 BGM 上下文）
let gain = null;
let source = null;       // AudioBufferSourceNode 或 HTMLAudioElement
let currentUrl = null;
let volume = 0.5;

/** 从 OGG 头部读 LOOPSTART / LOOPLENGTH；读不到返回 null。只拉前 64KB，够覆盖 comment header。 */
async function readLoopTags(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
    if (!res.ok && res.status !== 206) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder('latin1').decode(buf);
    // Vorbis comment 就是明文的 KEY=VALUE 序列，直接扫即可（不依赖 ogg 页结构）
    const start = /LOOPSTART=(\d+)/i.exec(text);
    const length = /LOOPLENGTH=(\d+)/i.exec(text);
    if (!start) return null;
    return { loopStart: Number(start[1]), loopLength: length ? Number(length[1]) : null };
  } catch { return null; }
}

function audioCtx() {
  if (ctx) return ctx;
  const C = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  return ctx;
}

/** 解码整首（OGG 通常几 MB，解码一次几十毫秒到一两百毫秒）。 */
async function decode(url) {
  const ac = audioCtx();
  if (!ac) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  return ac.decodeAudioData(bytes);
}

function stopSource() {
  if (!source) return;
  try {
    if (source instanceof AudioBufferSourceNode) source.stop();
    else { source.pause(); source.removeAttribute('src'); source.load(); }
  } catch { /* 已经停了 */ }
  source = null;
}

/** 当前在放的曲子 URL（没有就是 null）。 */
export function currentLevelBgm() { return currentUrl; }

/**
 * 播放一首关卡音乐（带循环点就无缝循环）。
 * @param {string|null|undefined} url 已 URL 编码好的地址，例如 /music/battle-1.ogg
 * @param {number} vol 0..1
 */
export function playLevelBgm(url, vol = 0.5) {
  volume = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 0.5));
  if (!url) { stopLevelBgm(); return null; }
  const ac = audioCtx();
  if (ac?.state === 'suspended') void ac.resume().catch(() => {});
  if (url === currentUrl) {
    if (gain) gain.gain.value = volume;
    if (source instanceof HTMLAudioElement) source.volume = volume;
    return source;
  }
  stopLevelBgm();
  currentUrl = url;
  void start(url);
  return null;   // 异步起播，返回 null 表示「已受理」
}

async function start(url) {
  const tags = /\.[a-z0-9]+(\?|$)/i.test(url) ? await readLoopTags(url) : null;
  const ac = audioCtx();
  if (!ac) return;
  // 浏览器要求用户手势后才能出声；没有手势时 resume() 会被拒绝，下一次点击时 applyPreferences 会重试
  if (ac.state === 'suspended') { try { await ac.resume(); } catch { /* 等下一次手势 */ } }
  if (currentUrl !== url) return;   // 期间换歌了
  const buffer = await decode(url).catch(() => null);
  if (currentUrl !== url) return;
  if (buffer) {
    const node = ac.createBufferSource();
    node.buffer = buffer;
    if (tags?.loopStart != null) {
      const rate = buffer.sampleRate;
      node.loop = true;
      node.loopStart = tags.loopStart / rate;
      // LOOPLENGTH 是循环段长度；若缺失就循环到曲尾
      node.loopEnd = tags.loopLength != null ? (tags.loopStart + tags.loopLength) / rate : buffer.duration;
      if (!(node.loopEnd > node.loopStart)) node.loop = false;
    } else {
      node.loop = true;   // 没标签：整段循环
    }
    node.connect(gain);
    node.start();
    source = node;
    return;
  }
  // 解码失败（编码不支持等）→ 退回 <audio>，整段循环
  const el = new Audio(url);
  el.loop = true;
  el.volume = volume;
  el.addEventListener('error', () => { if (source === el) { source = null; currentUrl = null; } }, { once: true });
  el.play().catch(() => {});
  source = el;
}

/** 停掉并释放。 */
export function stopLevelBgm() {
  currentUrl = null;
  stopSource();
}

/** 音乐音量（0..1）。 */
export function bgmVolume(preferences) {
  const v = Number(preferences?.bgm);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

/** 关卡 meta.bgm（文件名）→ /music/ 地址；没填就是 null。 */
export function levelBgmUrl(meta) {
  const name = typeof meta?.bgm === 'string' ? meta.bgm.trim() : '';
  return name ? `/music/${encodeURIComponent(name)}` : null;
}