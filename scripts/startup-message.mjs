const REPOSITORY = 'https://github.com/WardTrapXFog/Arknights-Simulator';
const MODULES = '自由沙盒 × 游玩自制关卡 × 关卡制作器';

export function startupMessage(url, { reused = false } = {}) {
  const color = !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
  const ink = (code, text) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
  const palette = [94, 96, 92, 93, 91, 95, 94, 96];
  const modules = [...MODULES].map((letter, i) => ink(palette[Math.floor(i / 3) % palette.length], letter)).join('');
  const shutdown = reused
    ? '服务端已在另一窗口运行；请关闭原启动窗口停止服务。'
    : process.env.SI_WINDOW_JOB === '1'
      ? '关闭本窗口即会关闭本次启动的服务端，不用担心进程残留（届时浏览器将无法访问）。'
      : '按 Ctrl + C 停止服务器（届时浏览器将无法访问）。';
  return [
    ink(91, `本项目开源于 GitHub 公开仓库：${REPOSITORY}`),
    ink(91, '本同人项目完全免费，仅供学习交流与个人非商业使用，禁止售卖游戏整合包或收费运营。'),
    ink(91, '如有人以官方名义收费，请勿付款，谨防受骗！代码与游戏素材的许可范围见 LICENSE、NOTICE.md。'),
    '',
    ink(94, reused ? '关卡模拟器 项目正在运行' : '关卡模拟器 项目已启动'),
    '',
    `请按住 Ctrl 点击此链接打开浏览器（可能需要权限）访问：${ink(96, url)}`,
    '',
    `这是一个明日方舟的关卡模拟器项目：${modules}`,
    '',
    ink(96, '欢迎体验！'),
    '',
    ink(94, shutdown),
  ].join('\n');
}
