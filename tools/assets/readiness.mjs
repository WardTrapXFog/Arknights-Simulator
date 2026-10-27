// Read-only startup inventory. Never downloads assets or discovers a game client.
import { checkNode, checkDeps, checkVendor, checkData, checkAssets, checkLocal, c, mark, padDisplay } from '../setup.mjs';

export function printReadiness(log = console.log) {
  const node = checkNode(), deps = checkDeps(), vendor = checkVendor(), data = checkData();
  const assets = checkAssets(), local = checkLocal();
  const row = (state, label, detail = '') => log(`${mark[state]} ${padDisplay(label, 29)} ${detail}`);
  log(c.cyan('\nARK/SIM · 启动准备'));
  row(node.ok ? 'ok' : 'err', 'Node.js', `v${node.version}（需要 22 或以上）`);
  row(deps.ok ? 'ok' : 'err', '依赖 node_modules', deps.ok ? '已准备' : `缺少 ${deps.missing.join('、')}；请重新双击启动脚本安装依赖`);
  row(vendor.ok ? 'ok' : 'err', '前端库 public/vendor', vendor.ok ? '已准备' : '不完整；运行 npm run vendor');
  row(data.ok ? 'ok' : 'err', '游戏数据 data/*.json', data.ok ? '已准备' : `请从同版本源码恢复：${[...data.missing, ...data.broken].join('、')}`);
  row(assets.ok ? 'ok' : 'warn', '美术/音频 public/assets', assets.manifest
    ? `清单引用 ${assets.total} 个文件，实际可用 ${assets.total - assets.missing}${assets.missing ? `，缺少 ${assets.missing}；npm run assets 可补全网络素材` : ''}`
    : '素材清单缺失；请恢复源码中的 data/assets.json，再运行 npm run assets');
  row(local.actualFiles && !local.missingFiles ? 'ok' : 'warn', '本地补充美术（可选）', local.actualFiles
    ? `实际可用 ${local.actualFiles}/${local.listedFiles} 项；${local.board3d ? '官方棋盘贴图已准备' : '官方棋盘贴图未齐备'}`
    : '未导入；使用基础地块与替代模型');
  row(local.fx.state === 'ok' ? 'ok' : 'warn', '官方特效（可选）', local.fx.detail);
  if (!assets.ok || !local.actualFiles || local.fx.state !== 'ok') log(c.dim('  素材补全方式见 README「获取官方素材」；缺少可选素材不阻止核心功能启动。'));
  log('');
  return node.ok && deps.ok && vendor.ok && data.ok;
}
