// tools/music-loop.mjs —— 把 content/music 里的作战曲转成「自带循环点」的 OGG。
//
// 循环点写进 Vorbis comment 的 LOOPSTART / LOOPLENGTH（采样数，游戏音频的通用做法），这样一首歌只做一次，
// 关卡只管选文件名；以后换关卡、换机器都不用再配「怎么循环」。播放端（public/sandbox/js/level-bgm.js）
// 用 Range 读文件头自己解析这两个标签。
//
// 用法：
//   node tools/music-loop.mjs                 按下面的 LOOPS 表转换（已存在的 .ogg 会被覆盖）
//                                             并合成 original/ 中同名的 *_intro + *_loop
//   node tools/music-loop.mjs --probe        只打印现有 ogg 的循环标签
//
// 来源（用户 2026-10-26 自己听出来的衔接点；声纹/自动识别做不到这件事）：
//   树海晕动症      0:26 接曲尾
//   居民们的狂欢节   0:17 11帧（24fps）接曲尾 = 17.458333s
//   Reconquista    0:12 12帧（24fps）接曲尾 = 12.5s
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MUSIC = path.join(ROOT, 'content', 'music');
const ORIGINAL = path.join(MUSIC, 'original');
const PAIR_TITLES = { m_sys_void: '生命流' };

/** ffmpeg 装了但不在 PATH 时的兜底位置（winget 安装的布局）。 */
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_BIN,
  'ffmpeg',
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg'),
].filter(Boolean);

/** 帧 → 秒：24fps。 */
const frames = (sec, f = 0) => sec + f / 24;

/** 每首曲子的循环起点（秒）。终点一律是曲尾，所以 LOOPLENGTH = 总采样数 − LOOPSTART。 */
const LOOPS = [
  { file: 'battle-1-树海晕动症 - 无玄_Dives.mp3', start: frames(26) },
  { file: 'battle-2-居民们的狂欢节 - 无玄_Dives.mp3', start: frames(17, 11) },
  { file: 'battle-3-Reconquista - 无玄_Dives.mp3', start: frames(12, 12) },
];

const which = (() => {
  for (const bin of FFMPEG_CANDIDATES) {
    const exe = bin.endsWith('ffmpeg') ? `${bin}.exe` : bin;
    try { execFileSync(exe, ['-version'], { stdio: 'ignore' }); return bin; } catch { /* 试下一个 */ }
  }
  throw new Error('找不到 ffmpeg：装一个，或用 FFMPEG_BIN 指定路径');
})();
const probe = which.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe'));

const run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 8 << 20 });
const durationOf = (file) => Number(run(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).trim());

function tagsOf(file) {
  // OGG 里 Vorbis comment 挂在 stream 上；用 json 输出，别用 default=nw=1（重复键会被吞掉）
  const out = run(probe, ['-v', 'error', '-show_entries', 'stream_tags', '-of', 'json', file]);
  let parsed;
  try { parsed = JSON.parse(out); } catch { return {}; }
  const map = {};
  for (const s of parsed.streams || []) for (const [k, v] of Object.entries(s.tags || {})) map[k.toUpperCase()] = v;
  return map;
}

if (process.argv.includes('--probe')) {
  for (const f of fs.readdirSync(MUSIC).filter((n) => n.toLowerCase().endsWith('.ogg'))) {
    const t = tagsOf(path.join(MUSIC, f));
    console.log(`${f}  LOOPSTART=${t.LOOPSTART ?? '-'}  LOOPLENGTH=${t.LOOPLENGTH ?? '-'}`);
  }
  process.exit(0);
}

// 原始分段已经由使用者确定边界；解码成统一 PCM 后只编码一次，循环点精确到采样。
const pairs = new Map();
for (const name of fs.existsSync(ORIGINAL) ? fs.readdirSync(ORIGINAL) : []) {
  if (!/\.(mp3|wav|flac|m4a|aac|aif|aiff|opus|wma)$/i.test(name)) continue;
  const stem = path.basename(name, path.extname(name)).replace(/^\d+\.\s*/, '');
  const match = /^(.*?)[_\s.-]+(intro|loop)$/i.exec(stem);
  if (!match || !match[1]) continue;
  const key = match[1].toLowerCase();
  const pair = pairs.get(key) || { title: match[1] };
  const role = match[2].toLowerCase();
  if (pair[role]) throw new Error(`${match[1]} 有重复的 ${role} 源文件，请只保留一份`);
  pair[role] = path.join(ORIGINAL, name);
  pairs.set(key, pair);
}
for (const [key, pair] of pairs) {
  if (!pair.intro || !pair.loop) { console.log(`跳过（intro / loop 尚未配齐）：${pair.title}`); continue; }
  const info = JSON.parse(run(probe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', pair.intro])).streams[0];
  const rate = Number(info.sample_rate), channels = info.channels;
  const decode = (file) => execFileSync(which, ['-v', 'error', '-i', file, '-map', '0:a:0', '-vn',
    '-ar', String(rate), '-ac', String(channels), '-f', 'f32le', 'pipe:1'], { maxBuffer: 256 << 20 });
  const intro = decode(pair.intro), loop = decode(pair.loop);
  const loopStart = intro.length / (channels * 4), loopLength = loop.length / (channels * 4);
  const title = PAIR_TITLES[key] || pair.title;
  const dst = path.join(MUSIC, `${title}.ogg`);
  execFileSync(which, ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(rate), '-ac', String(channels), '-i', 'pipe:0',
    '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', '6', '-metadata', `TITLE=${title}`,
    '-metadata', `LOOPSTART=${loopStart}`, '-metadata', `LOOPLENGTH=${loopLength}`,
    '-metadata', `LOOPSAMPLERATE=${rate}`, dst], { input: Buffer.concat([intro, loop]), maxBuffer: 8 << 20 });
  console.log(`${title}.ogg · intro ${(loopStart / rate).toFixed(3)} 秒 → loop ${(loopLength / rate).toFixed(3)} 秒循环`);
}

for (const { file, start } of LOOPS) {
  const src = fs.existsSync(path.join(ORIGINAL, file)) ? path.join(ORIGINAL, file) : path.join(MUSIC, file);
  if (!fs.existsSync(src)) { console.log(`跳过（没有这个文件）：${file}`); continue; }
  const dst = path.join(MUSIC, file.replace(/\.mp3$/i, '.ogg'));
  const total = durationOf(src);
  const rate = 44100;
  const loopStart = Math.round(start * rate);
  const loopLength = Math.round(total * rate) - loopStart;
  // -q:a 6 ≈ 192kbps Vorbis，够用；-map_metadata -1 去掉 mp3 的 ID3，避免带进奇怪字段
  run(which, ['-y', '-v', 'error', '-i', src, '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', '6',
    '-metadata', `LOOPSTART=${loopStart}`, '-metadata', `LOOPLENGTH=${loopLength}`, '-metadata', `LOOPSAMPLERATE=${rate}`, dst]);
  const t = tagsOf(dst);
  console.log(`${path.basename(dst)}
  时长 ${total.toFixed(3)}s · 循环起点 ${start.toFixed(3)}s
  LOOPSTART=${t.LOOPSTART}  LOOPLENGTH=${t.LOOPLENGTH}  → 循环段 ${(Number(t.LOOPLENGTH) / rate).toFixed(3)}s`);
}
