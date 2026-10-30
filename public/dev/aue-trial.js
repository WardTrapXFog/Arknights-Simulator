import { loadAueRuntime } from '/sandbox/js/aue/runtime.js';
import { createTerrainContent } from '/sandbox/js/aue/terrain-content.js';

const $ = id => document.getElementById(id);
let entries = [], active = null, loading = false;
function status(message, error = false) {
  $('status').textContent = message;
  $('status').toggleAttribute('data-error', error);
}
function buttons() {
  $('open').disabled = loading || !entries.length;
  $('levels').disabled = loading || !entries.length;
  $('file').disabled = loading;
  $('step').disabled = loading || !active;
  $('close').disabled = loading || !active;
}
function draw() {
  const ctx = $('map').getContext('2d');
  ctx.clearRect(0, 0, 840, 760);
  if (!active) { $('details').textContent = '尚未建立世界'; return; }
  const { content, world, manifest, scope } = active, level = content.level;
  const cell = Math.min(840 / level.width, 760 / level.height);
  for (let r = 0; r < level.height; r++) for (let c = 0; c < level.width; c++) {
    const t = level.tiles[r][c];
    ctx.fillStyle = t.goal ? '#4ebbc9' : t.key === 'tile_start' ? '#bf6559' : t.buildable === 'RANGED' ? '#9b8960'
      : t.buildable === 'ALL' ? '#6b7d83' : t.passable === 'ALL' ? '#394c54' : '#19232b';
    ctx.fillRect(c * cell + 1, (level.height - 1 - r) * cell + 1, cell - 2, cell - 2);
  }
  $('details').textContent = [level.name, `AUE：${manifest.commit}`, `帧：${world.frame} / 秒：${(world.frame / 30).toFixed(3)}`,
    `生命：${world.players[0].life} / 部署上限：${level.options.characterLimit}`, `费用：${world.players[0].cost}`,
    '', '源文件中未接入的内容：', `出生条目 ${scope.spawns} / 沙盒波次 ${scope.waves} / 路线 ${scope.routes}`,
    `现场干员 ${scope.operators} / 编队 ${scope.squad}`, '', '此页面不保存或改写关卡与沙盒存档。'].join('\n');
}
async function open(level) {
  loading = true; active = null; draw(); buttons(); status('准备固定内核与地图内容…');
  try {
    const projection = createTerrainContent(level), { sim, manifest } = await loadAueRuntime();
    const world = sim.createWorld(projection.content, { seed: 20261021, players: 1 });
    active = { ...projection, sim, manifest, world };
    draw(); status('地图世界已建立。当前为普通地形与建场接入。');
  } catch (e) { status(e.message, true); }
  finally { loading = false; buttons(); }
}
$('open').addEventListener('click', () => open(entries[Number($('levels').value)].level));
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  try { await open(JSON.parse(await file.text())); }
  catch (e) { status(`读取关卡失败：${e.message}`, true); }
  finally { $('file').value = ''; }
});
$('step').addEventListener('click', () => {
  if (!active) return;
  try { active.sim.step(active.world, active.content, []); draw(); }
  catch (e) { active = null; buttons(); status(`帧推进失败：${e.message}`, true); }
});
$('close').addEventListener('click', () => { active = null; draw(); buttons(); status('地图世界已关闭。'); });
window.addEventListener('pagehide', () => { active = null; });
async function init() {
  try {
    const response = await fetch('/api/levels');
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.levels)) throw Error('关卡列表格式不正确');
    entries = data.levels;
    $('levels').replaceChildren(...entries.map((e, i) => {
      const option = document.createElement('option'); option.value = String(i); option.textContent = e.level.name || e.file; return option;
    }));
    if (!entries.length) status('关卡库为空，可导入关卡文件建立地图世界。');
  } catch (e) { status(`读取关卡库失败：${e.message}。也可导入本地关卡文件。`, true); }
  buttons();
}
init();
