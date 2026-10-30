// Read-only startup inventory. Never downloads assets or discovers a game client.
import { checkNode, checkDeps, checkVendor, checkData, checkAssets, checkLocal, c, mark, padDisplay } from '../setup.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { AUE_COMMIT } from '../../public/sandbox/js/aue/version.js';
import { DIY_IDS, AVAILABLE_IDS } from '../../public/sandbox/js/roster.js';
import { OFFICIAL_IDS } from '../../public/sandbox/js/generated-library.js';
import { AUE_IDS } from '../../public/sandbox/js/generated-aue-library.js';

const root=path.resolve(import.meta.dirname,'../..');
function engineState(){
  const bundle=path.join(root,'engine/aue-runtime.json.gz');
  if(!fs.existsSync(bundle))return {ok:false,detail:'缺少随源码提供的运行包；请恢复同版本 engine/aue-runtime.json.gz'};
  try{
    const target=path.join(root,'public/vendor/aue-trial',AUE_COMMIT);
    const manifest=JSON.parse(fs.readFileSync(path.join(target,'manifest.json'),'utf8'));
    const files=[...manifest.files.map(row=>row.file),'kits.json'];
    const available=files.filter(file=>fs.existsSync(path.join(target,file))).length;
    const ok=manifest.commit===AUE_COMMIT && available===files.length;
    return {ok,detail:`${AUE_COMMIT.slice(0,7)} · 本地运行文件 ${available}/${files.length}${ok?'，已展开':'；缓存不完整，请关闭窗口后重新启动'}`};
  }catch{return {ok:false,detail:'运行缓存尚未准备；请关闭窗口后重新启动，启动器会从源码包本地展开'};}
}
function rosterState(){
  try{
    const library=JSON.parse(fs.readFileSync(path.join(root,'data/operator-library.json'),'utf8'));
    const aue=JSON.parse(fs.readFileSync(path.join(root,'data/aue-operators.json'),'utf8'));
    const chess=JSON.parse(fs.readFileSync(path.join(root,'data/chess.json'),'utf8'));
    const all={...(chess.units || chess),...library.operators,...aue.operators};
    const missing=AVAILABLE_IDS.filter(id=>!all[id]);
    return {ok:!missing.length && aue.commit===AUE_COMMIT,detail:`${AVAILABLE_IDS.length} 个槽位（原有 ${OFFICIAL_IDS.length}、自设 ${DIY_IDS.length}、AUE 新增 ${AUE_IDS.length}）${missing.length?`；缺少 ${missing.length} 项定义`:aue.commit!==AUE_COMMIT?'；牌库版本与引擎不一致':''}`};
  }catch{return {ok:false,detail:'牌库数据缺失或损坏；请恢复同版本 data/operator-library.json、data/aue-operators.json 与 data/chess.json'};}
}

export function printReadiness(log = console.log) {
  const node = checkNode(), deps = checkDeps(), vendor = checkVendor(), data = checkData();
  const assets = checkAssets(), local = checkLocal();
  const engine=engineState(),roster=rosterState();
  const row = (state, label, detail = '') => log(`${mark[state]} ${padDisplay(label, 29)} ${detail}`);
  log(c.cyan('\nARK/SIM · 启动准备'));
  row(node.ok ? 'ok' : 'err', 'Node.js', `v${node.version}（需要 22 或以上）`);
  row(deps.ok ? 'ok' : 'err', '依赖 node_modules', deps.ok ? '已准备' : `缺少 ${deps.missing.join('、')}；请重新双击启动脚本安装依赖`);
  row(vendor.ok ? 'ok' : 'err', '前端库 public/vendor', vendor.ok ? '已准备' : '不完整；运行 npm run vendor');
  row(data.ok ? 'ok' : 'err', '游戏数据 data/*.json', data.ok ? '已准备' : `请从同版本源码恢复：${[...data.missing, ...data.broken].join('、')}`);
  row(engine.ok?'ok':'err','战斗引擎 AUE（默认）',engine.detail);
  row(roster.ok?'ok':'err','干员牌库',roster.detail);
  row(assets.ok ? 'ok' : 'warn', '美术/音频 public/assets', assets.manifest
    ? `清单引用 ${assets.total} 个文件，实际可用 ${assets.total - assets.missing}${assets.missing ? `，缺少 ${assets.missing}；npm run assets 可补全网络素材` : ''}`
    : '素材清单缺失；请恢复源码中的 data/assets.json，再运行 npm run assets');
  row(local.actualFiles && !local.missingFiles ? 'ok' : 'warn', '本地补充美术（可选）', local.actualFiles
    ? `实际可用 ${local.actualFiles}/${local.listedFiles} 项；战场使用项目地块模型`
    : '未导入；使用基础地块与替代模型');
  row(local.fx.state === 'ok' ? 'ok' : 'warn', '官方特效（可选）', local.fx.detail);
  if (!assets.ok || !local.actualFiles || local.fx.state !== 'ok') log(c.dim('  素材补全方式见 README「获取官方素材」；缺少可选素材不阻止核心功能启动。'));
  log('');
  return node.ok && deps.ok && vendor.ok && data.ok && engine.ok && roster.ok;
}
