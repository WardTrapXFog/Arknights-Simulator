# SI 架构

本文件只描述代码现在是什么。每个条目都能在对应文件里直接读到；代码改动后先改代码，再改这里。

## 1. 服务入口与三个功能模块

| 入口 | 命令 | 作用 |
|---|---|---|
| SI 沙盒（日常） | `npm start` → `server/sandbox/index.js`，默认 `3100` | 纯静态文件服务：页面、素材、`/data/`、`/shared/`、`/sim/`、`/data.js`。不建房间、不开 WebSocket、不托管对局。 |
| 上游完整服务 | `npm run start:upstream` → `server/index.js` | Stronghold-Protocol 的联机平台（大厅、房间、插件工作台）。SI 不依赖它运行。 |

双击启动链：`启动模拟器.bat` → `scripts/start-windows.bat` → `scripts/launch-windows.ps1` → `scripts/launch.mjs` → `server/sandbox/index.js`。PowerShell 将自身加入带 `KILL_ON_JOB_CLOSE` 的 Windows Job，保留非继承句柄；启动器、服务端及子进程继承该 Job，关闭窗口结束 PowerShell 时由系统一并结束。已有服务复用时明确提示关闭原启动窗口。启动提示由 `scripts/startup-message.mjs` 共用输出，TTY 下使用亮红声明、蓝青重点与彩色模块名称；不列举局域网／公网分享地址。启动器**不自动执行** `tools/setup.mjs`（`--no-setup` 是默认值，也没有相反的开关）。

服务监听时把 `/` 重定向到 `/studio/home.html`（工作区选择页），`/healthz` 返回 `{ok, mode:'sandbox'}`。

## 2. 目录即职责

```
public/
  play/              自制关卡浏览、玩家编队与开战入口
  sandbox/js/        自由沙盘（SI 自有）
  level/js/          关卡制作器（SI 自有）
  studio/            SI 的 HTML 入口与上游插件工作台脚本并存
  js/                战斗引擎的浏览器侧：渲染、音频、素材、sim 加载器
  css/ fonts/ icons/ assets/ vendor/
server/
  sandbox/index.js   SI 唯一的服务端文件
  sim/               战斗引擎（浏览器经 /sim/ 只读加载）
  http/              两套服务共用的 HTTP 层
  index.js lobby.js net.js match/ plugins/ studio/   上游联机平台
data/                `tools/build-content.mjs` 的生成物 + 上游游戏数据
shared/              引擎与页面共用的纯模块
content/             SI 的数据源：`operators/` 与 `enemies/`
tools/               生成器与素材脚本
packs/ schemas/ plugins/ test/   上游的包、模式、插件模板与测试；SI 不读取
```

`package.json` 的名称、说明、仓库地址与默认入口指向 SI；`start:upstream` 单独保留上游入口。上游目录存在以下引用，不能按 SI 页面是否加载直接判为孤儿：

| 路径 | 现有引用 |
|---|---|
| `server/match/` | `server/index.js` 导入 `createMatchHosts` 并创建对局宿主。 |
| `server/lobby.js`、`server/net.js` | `server/http/websocket.js` 导入 `Lobby`、`Network`、`SessionRegistry`，供上游入口的 `createSessionStack` 使用。 |
| `plugins/_template/` | `server/studio/gameData.js`、`server/studio/templates/` 读取模板与示例素材；不是空目录。 |
| `test/helpers/battleHarness.js` | 插件脚本测试模板保留其导入路径；它是上游开发助手，SI 不执行。 |
| `server/plugins/officialUnitBuilder.js` | SI 的 `tools/build-operator-library.mjs` 复用它生成原作满配牌库。 |

## 3. 自由沙盘 `public/sandbox/js/`

| 文件 | 职责 |
|---|---|
| `map-picker.js` | 直接展示左侧地图预览与右侧六槽管理，新建地图在其中；新图使用 `battlefield.newStage()` 的 8×17 空白沙盘，选中后才 `import('./boot.js')`。`?slot=0…5` 用于载入槽位后重进，旧 `?level=` 转到独立游玩入口。 |
| `boot.js` | 启动：挂载 HUD、装音频、载数据、读存档，然后交给 `controller.js`。 |
| `controller.js` | 操作编排：点格子、部署、技能、撤退、主循环，以及各职责模块的接线。 |
| `enemy-placement.js` | 刷敌人：四种投放方式、点地放置、路线草稿与校验、单个/批量删除。 |
| `terrain-brush.js` | 改地形：单格上色、防抖重建、按住拖着连续刷。 |
| `state.js` | 全部可变状态的形状，以及出生数据的唯一规则 `useLevelSpawns` / `useSandboxWaves`。 |
| `save.js` | `localStorage[arksim-sandbox-v3]` 的当前编辑内容读写与 `serializeSandbox`；`format:3` 从实际战场提取当前在场单位、当前位置、血量、技力、冷却、剩余路线、时间与费用，不保存历史或未出生单位。兼容旧存档。 |
| `save-slots.js` | 六槽库、旧档迁入、新建／写入／删除／复制／激活、当前槽位 sessionStorage 标记与无确认快存。未绑定时使用空槽，满槽时要求选择。 |
| `ui/save-manager.js` | 入口使用内嵌预览与六槽管理，战场使用原生 dialog；共用操作确认、命名、复制目标与错误反馈。 |
| `settings.js` `ui/settings.js` | 复用上游 `sanitizeSettings` 的全局偏好存储与设置窗口；局外不显示战斗快捷键配置；通过 AudioManager、`view.setSettings` 和文字／动效属性即时生效。 |
| `battle-session.js` | 组装 `BattleSpec`、按部署顺序恢复干员布置、部署判定、出生队列、手动敌人的持久化放置／删除与 runner 启动。 |
| `damage-score.js` `ui/scoreboard.js` | 沙盒伤害计分与右侧六项面板。前者监听 `damaged` 回调累计四种对敌伤害、用固定 150 桶记录近 5 秒；后者每 200 毫秒刷新数字、占比与短促反馈。 |
| `battle-runner.js` | 固定步长推进战斗并产出快照/事件（沙盒与关卡游玩共用）。 |
| `field-view.js` | 战场视图的创建、销毁、快照推送、事件推送、音频接入、选中镜头与表现层接线。 |
| `battle-feedback.js` | 独立 Canvas 表现层：技能范围外沿、开技标记、丹增与液氮弹道、产费数字飞向费用栏及显示延迟。只读取战斗状态与事件，按 30 Hz 绘制。 |
| `battlefield.js` | 19×21 地图字形、地形笔刷、战场范围、红蓝门、地图体检。 |
| `spawn-catalog.js` | 旧投放预设与倍率保留原下标，再追加 `enemy-library.js` 中尚未列出的正常敌人。按全部、木桩、普通、精英、领袖筛选；保留 8 个机制木桩与耐久变体。 |
| `operator-catalog.js` `roster.js` `generated-ops.js` | 手牌与选人器：三名自设 + 独立生成的 202 名原作满配干员。普通/进阶别名归一，按职业筛选。`generated-ops.js` 仍由自设生成器写出。 |
| `panel-models.js` | 左侧详情面板与场上技能操作的数据模型。 |
| `asset-urls.js` `generated-illustrations.js` | HUD 图片入口与 205 名干员完整立绘的地址、尺寸、透明边界登记；详情按边界自适应缩放。生成器为 `tools/import-operator-illustrations.py`，素材来源记录在 `art/operator-illustrations.json`。 |
| `asset-urls.js` | 素材地址适配。 |
| `hud.js` `ui/` | HUD 公共接口与各区块：`shell`（壳）`hand`（手牌）`detail`（详情）`toolbox`（工具箱）`picker`（选人器）`icons` `html`（小工具）。 |

`public/studio/home.html` 是自由沙盒 / 游玩自制关卡 / 关卡制作器的三入口菜单；菜单和存档窗口的样式在 `public/sandbox/menu.css`，也由它提供共用的扫描线和静态噪点变量。`public/studio/sandbox.css` 保留 HUD 布局，`public/sandbox/hud-theme.css` 定义炭灰面板、琥珀状态、青绿交互、警报红、小圆角、倒角与菱形控件。状态栏直接使用原有 `public/assets/ui/hudPanel/bg_battle.png` 八边形长条底板。扫描线与噪点只用于面板和菜单，不覆盖战场画布；打开与点击动画走 CSS 分段关键帧，系统减少动态效果设置会关闭动画。`controller.js` 的 `onSaves` 打开窗口前暂停 runner，关闭后按此前播放状态恢复；`pagehide` 保存当前编辑内容。

`terminal-shell.js` 与 `terminal.css` 统一主菜单和三个二级入口的导航、设置、上浮粒子与按键立体反馈。主菜单开屏只在当前标签页会话首次进入时播放；二级入口由 head 中的 `terminal-navigation.js` 接入浏览器跨文档 View Transition，等待目标页 `terminalReady()` 后再按选项卡顺序左右滑动；等待期间保持原页面图像，页面不再输出两段启动加载文字。主菜单在首次开屏结束后依次浮现标题、三个入口与页脚；返回主菜单时只播放内容入场。三个二级入口共用同一深色背景，制作器的顶部工具区使用对应半透明底色。实际关卡编辑工具关闭这些交互音效与动效，页面角落保留全局设置和音乐开关。`menu-audio.js` 通过 `/api/menu-music` 读取 `content/menu-music.json`，复用 `level-bgm.js` 播放局外音乐，进入战斗后停止。配置见[局外音乐](局外音乐.md)。文字选择与链接、图片拖拽在页面层禁用，输入框仍可编辑。

`menu-themes.css` 为局外页面提供青磁信号、钛灰光学、石墨琥珀三套配色与材质，默认石墨琥珀。全局设置的「局外主题」使用单选项即时切换，偏好写入 `arksim-sandbox-settings-v1.menuTheme`；head 中的 `terminal-navigation.js` 在首次绘制前恢复配色。主入口倒角卡片、当前选项卡加高、六槽布局与各模块控件尺寸沿用现有结构；主要操作用实色高亮，次要操作使用深色表面，危险操作保留红色。主题只作用于局外页面的控件和面板，地形色义与战斗 HUD 使用原有样式。

工具箱只有刷敌人与改地形两页。保存、快存和地形重建都先从实际 battle 读取存活、已部署、血量大于零的干员与敌人；不以历史布置清单决定新存档中的单位。敌人从当前位置沿剩余路线恢复，仍通过唯一的 `document.spawns` 进入引擎。重建按保存顺序部署干员，再处理现场敌人、恢复血量／技力／攻击冷却与演练时间／费用。进行中的技能、异常状态与弹道不作为完整帧恢复。旧格式无法反推其保存时已经退场的单位。

自由沙盒关闭 `_checkEnd` 自动结束检查。关卡游玩在 `battle-session.js` 的独立模式开启清场结算、三漏失败与再部署冷却；两种模式都不使用上游 30 分钟截止，本体手动部署通过独立开关接入共用引擎。runner 使用 `cap=Infinity`。`field-view.rebuildField` 用 `audio.setFieldUnits` 在声音解锁前登记已有单位，随后继续按事件播声。框选由 terrain-brush 的捕获阶段 pointerdown 转交 enemy-placement，并通过现有 `tileScreen` 接口命中敌人格子；选框是独立固定定位浮层。

`battle.sandboxScore` 监听结算后的 `damaged`，以 `credit || source` 判定我方对敌，按 `phys / arts / elemental / true` 记录包含过量的伤害；不读渲染伤害数字，不计元素条积累、生命流失与手动删除。DPS 是最近 150 tick 的伤害除以 5，时钟取 `battle.time`。计分不改战斗上下文，重建时移除旧钩子；四类总数及窗口桶保存到 `session.score`，缺失时从零开始。「清零」只重置计分，重置演练与新地图通过新会话清零。

`field-view.js` 同时向 `fx/vina.js`、`fx/makoto.js` 投影实际技能状态、庇护、人格索引、死亡宣告记录、伟大封印范围与救济庇护期限。两个模块由 `fx/custom.js` 注册，沿现有 `FxSystem` 生命周期更新／清理，共用 `combat-shapes.js` 的投影图形。弥赛亚的独立 SVG 投影与本体分开绘制，角色正背面均不借用官方三技能的人格换相；运行动画映射由两份内容源生成到 `data/assets.json`。

SI 的 `field-view.js` 固定传入 `tierChips:false`，不创建干员血条左侧的卫戍协议阶数徽标；生命、技力与状态标记仍使用原有布局。手牌点击选中与关卡拖拽拿起共用 `AudioManager.voice(..., "select")`，按已有语音槽随机选择选中干员1／2，取消选择不播报。`record.assets.voice` 指定自设干员的原版语音身份：维娜使用 `char_1019_siege2`，结城理使用 `char_4217_makoto`；内容源的 `voiceAssets` 由 `build-content.mjs` 写入运行语音表。素材下载计划读取这些额外语音身份，只有 LINKAGE 配音的角色使用原版日语语音作为默认回退。

`field-view.js` 向 `fx/wang.js` 投影真实的棋子、跟子、激活轴及三技能范围。`wangStoneLand`、`wangStoneBurst` 由 kit 在落子和伤害结算时发出；`vfx/skills.js` 的补充绑定在同一地块播放原有官方素材，天下劫保留完整 `wang_skill_03_buff`、范围起始和范围循环；范围子特效独立读取四向朝向，不继承本体光环的双面镜像。专属模块按主人 ID 和跟子序号维护棋子模型的渲染实例，使用真实范围键绘制贴地外沿，实例不登记为战斗单位。kit 按游戏时间延迟逐枚生成跟子，每次重新选格、额外跟子成功生成后扣弹，同次序列排除已使用的相邻格；库存耗尽等待当前跟子序列完成后结算。官方特效的 `vfx/system.js` 投影矩阵与 `vfx/geom.js` billboard 基向量使用相机 roll。手牌预扣库存后才执行部署回调，完成后发出 `handDeploy`。

选中视图通过 `view.setCamera` 的 `roll` 与 `padding` 参数调整镜头；`projection.Camera` 在正投影、逆投影、THREE 相机参数与镜头插值中保持相同的旋转。`controller.js` 按单位投影更新独立 `selection-actions` 容器，并由当前相机的 roll、tilt、焦距和地块中心计算地面平面的 CSS `matrix3d`；选中框、三个按钮及技力条统一受该矩阵控制。`ui/detail.js` 共用同一组技能、范围和撤退操作，READY 时隐藏充能蒙版与旧就绪叠图。`panel-models.js` 从当前配装原始记录筛选可见天赋，保留 hidden/index 在显示筛选中的语义，提供等级、范围小图与技能元数据。范围 HUD 继续使用 `highlightTiles`；持续技能的发光外沿由 `battle-feedback.js` 单独绘制。

`server/sim/battle/economy.js` 管理费用下限、可透支判断、`dpRegen` 自然回复倍率和 `dpGain` 表现事件。`projectiles.js` 同时支持追踪目标、固定落点以及带 `velocity`／`onStep` 的逐帧直线弹道；`ai.js` 的 `resolveAttack` 允许技能替换普通攻击的结算方式，同时保留攻击计数和攻击完成回调。`deployment-hand.js` 区分无需朝向确认和需要朝向确认的 token ID，并在流形复制提交时写回选定朝向。

## 4. 关卡制作器 `public/level/js/`

| 文件 | 职责 |
|---|---|
| `app.js` | 关卡库、地形/路线/出生模式、敌人筛选、导入导出、共享撤销、自适应关卡库分页、侧栏页与二级对话框接线。只加载 enemies，不启动战斗；局外音乐与共用导航由 terminal-shell 接入。 |
| `level-store.js` | `localStorage[arksim-levels-v2]` 的读写，坏档仅跳过该关，满库写入报错。 |
| `level-model.js` | 出生创建、路线解析、带停留的累计弧长、任意时刻场况与推演长度，按编辑操作失效的寻路缓存。 |
| `terrain.js` | 原有地形笔刷、部署区拖拽、地图 JSON 导入导出，地图点击交给当前模式。 |
| `routes.js` | 持久化路线 ID/名称、引用计数、节点编辑与停留、按间隔批量投放、引用删除确认；`previewRoute()` 用 Grid 的平滑 waypoints 构造预览折线。 |
| `timeline.js` | 独立出生点、游标播放、多选/框选、拖动吸附、平移、间隔复制、缩放、全览与时间窗口前后切换，无横向滚动。 |
| `tracer.js` | 在地图 SVG 的独立图层投影场况、朝向与短名、已走/未走折线，不引入 PIXI。 |
| `workspace-layout.js` | 将一级工作区固定在可视区域，小窗口整体等比适配，尺寸变化时重排关卡库或时间轴。 |

数据契约在 `shared/level.js`：v2、512 KB、8000 条独立出生、60 关、每线 24 个检查点，无独立路线数量上限，部署区至少 2×2。`validateLevel()` 抛带 path 的中文 `LevelError`；`levelSpawns()` 展开模板/私有路线和原地停留；`levelDuration()` 取最后出生时间加 60 秒。关卡不包含玩家阵容；旧 v2 的 squad 读入后移除。`shared/level-preview.js` 从地形生成 thumbnail 内嵌 SVG 简图，保存与导出刷新，外部提供的图片内容不直接采用。`level-model.playableUntil()` 另按实际折线长度、移速与 WAIT 算推演轴长。无终点单位停在末点，轨迹推演不处理任何战斗交互。

`tools/build-enemy-library.mjs` 读取敌人数据、KITS/STATS_ONLY/BOSS_KEYS 和 `ENEMY_PRESETS`，生成 `public/sandbox/js/enemy-library.js` 的正式/仅数值/玩具分层。`LIBRARY_KEYS` 用于关卡校验；编辑器只列正常敌人，沙盒将共用目录追加到旧投放预设后。筛选等级取共用目录的 `rank`，木桩独立分档。

关卡战斗左上角使用「退出战斗」下拉确认，红色「确认」返回关卡列表；展开时暂停，收起时恢复此前播放状态。沙盒保留原来的开始菜单入口。`/api/music`、`/api/menu-music` 与 `/music/` 仅提供 OGG，MP3 等源文件不对外提供；OGG 随源码分发，音乐使用范围见 `content/music/README.md`。

一级界面不滚动：`level.css` 用固定视口网格安排工具栏、地图、单页侧栏与时间轴；地图按容器宽高缩放，路线/节点通过原生单行下拉选择。敌人、导入、备注及完整错误信息仅在二级对话框或展开菜单中滚动。关卡库按窗口可容纳的行列分页，时间轴默认全长适配，放大后用前后按钮切换时间窗口。

试玩调用保存与完整关卡校验，再新开 `/studio/play.html?level=<id>`；玩家在该页选关和编队。C 批入口已依照三模块分工接入；v1 关卡库与既有沙盒现场存档保持独立。

## 4.1 独立游玩与玩家编队 `public/play/`

`server/sim/battle/deployment-hand.js` 在 Battle 的 `manualDeployment` 开关下安装手动部署规则，`siLevel` 区分关卡约束和自由沙盒。编队成员由 BattleSpec.players.units 提前建立，召唤物池在安装内容前按主人技能、模组及 token sources 建立。关卡成员复用实例，不再以永久移除加新建实例模拟再部署。`battle.hand` 负责记录、卡片投影、库存、费用、部署检查、部署位、待投放和流形复制；原 kit 继续提供伤害、属性、召唤物效果及库存补充。默认未开启这些开关的对局沿用原引擎行为。

`battle-session.js` 为关卡传入 10 初始 DP、99 DP 上限、每秒回复 1 和 8 个部署位。手牌部署、落点预览及朝向确认共用 `battle.hand.error`，扣费只发生在正式部署。再部署费用按 1、1.5、2 倍计算，费用效果保存在卡片记录；撤退返费区分倍率与上限。召唤物的部署后冷却、唯一单位离场冷却和中继器队列各自计时，库存适配现有 summonDeck、craftsman、wang、doroth、phantomStock 和 summonStock。

`ui/hand.js` 根据实时卡片写入库存、冷却、标记及不可用原因，状态变化原位更新；卡片增减和排序变化才重建节点。B 模式的名单由 `battle.hand.cards()` 提供，自由沙盒仍显示原 squad，并追加主人在场时可用的召唤物牌。沙盒 format:3 的 operators 可附加 tokenId/ownerUid，重建先恢复干员、创建关联池，再恢复在场召唤物。

`public/studio/play.html` 复用战场样式与资源入口，先加载 `public/play/js/app.js`：关卡库/导入 → 关卡侧栏简图与按 key 去重的敌方情报 → 玩家编队。职业筛选为全部与八职业；牌库还支持搜索、排序和快速勾选。`team-store.js` 在 `arksim-player-teams-v1` 存四个具名编队及各人的技能、模组。编队上限 13 是玩家出战规则，不属于关卡文件。

`public/sandbox/js/level-run.js` 将关卡和本次玩家选择组装为 `levelRun`，通过 `bootSandbox({run})` 在同一页面加载战场。它不调用 activateSave，不写 SAVE_KEY，不选择存档槽。controller 的保存入口在关卡模式直接返回，地图/刷怪/换牌 UI 隐藏且操作入口禁用；预选的技能、模组通过部署输入送入引擎。关卡模式正常扣费，限制同名在场一人，退场记录再部署截止时间，不免费激活技能；结算窗口支持重试和重新编队。

`public/play/js/hand-deployment.js` 仅在关卡对局中绑定 DOM 手牌的 Pointer Events，通过 `tileScreen` 在当前战场范围内命中地块，展示合法格和头像预览，不使用上游拖拽器的固定部署区域。合法落点交给 controller 挂载原有 `FacingWheel`，二次拖动朝向确认后才调用 `deployOperator`；拖放和正式部署共用 `deploymentError`，待确认期间不创建引擎单位、不扣费。视图重建、切换、设置、结算及失焦清理交互。沙盒继续使用点击部署，关卡中单击手牌只选中详情，不将战场切成只认格子的放置模式。

`public/sandbox/js/operator-library.js` 将 `data/operator-library.json` 覆盖到页面的棋子目录，并用独立 DataSource 覆盖战斗棋子与满级召唤物，原始 `data/chess.json` 保留上游档位。生成器 `tools/build-operator-library.mjs` 复用 officialUnitBuilder，读取官方表，将已接入棋子与有 kit 的补位/甄选干员归并为 202 名原作，生成最高等级、满潜、满信赖、最高技能和三级常规模组；默认选择原棋子模组，过滤仅其他玩法生效的模组。`generated-library.js` 提供唯一 ID 列表和普通/进阶别名；`roster.js` 合并三位自设，现有自设定义不参与原作补齐。自由沙盒旧存档的棋子别名在载入时归一，格式不变。

## 5. 出生数据只有一种真相

一次对局的敌人只能来自一处：关卡自带的 `document.spawns`，或沙盒按红门序号编的 `document.waves`。`state.js` 的 `useLevelSpawns` 与 `useSandboxWaves` 是仅有的两个切换口，各自清掉另一方。`battle-session.buildBattle` 的顺序是 `opts.spawns → document.spawns → 波次映射`。

## 6. 自设数据与生成物

数据源在 `content/`：`operators/index.json` 登记塔露拉、维娜、结城理；`enemies/index.json` 登记炙烤/焦香螺旋桨。`tools/build-content.mjs` 写出：

- `data/chess.json`、`data/assets.json`、`data/backups.json`、`data/enemies.json`
- `public/sandbox/js/generated-ops.js`（沙盒目录）
- `server/sim/content/kits/custom-catalog.js`（kit 登记）

只更新塔露拉：`node tools/build-content.mjs --operator talula`。

## 7. 塔露拉专属特效

`public/js/render/fx/custom.js` 汇集各模块的 `kinds`、`handlers`、方法容器与生命周期。实现在这几个文件里：

| 文件 | 职责 |
|---|---|
| `talula.js` | 接线与公共绘制：火翼、起飞与落地、S1 命中链、恶火、焚尽、原生刀痕抑制 |
| `talula-battle.js` | 剑气飞行、S3 圆弧剑气、焰浪火墙、地面火斑 |
| `talula-slash.js` | 刀光拖尾、月牙曲面、点火线、剑路姿态采样 |
| `talula-animation.js` | 四档时间表（片段、命中帧、扫掠区间）、位移动画、施法保持判据 |
| `talula-textures.js` | 火效图集的栅格化与按帧取图 |
| `talula-feedback.js` | 命中反馈：刀痕、延迟爆燃、破隐碎镜 |
| `talula-audio.js` | 音频锚点：事件到音效槽、循环与施法音 |

渲染核只留通用钩子：`spine.js` 的 `setSwingPlanner` / `setCastHold` / `setAttackClip`、`units.js` 的 `setMotionSampler`。塔露拉模块登记 `setSwingPlanner`（`talulaSwingPlan`）、`setMotionSampler`（`sampleTalulaMotion`）与 `setCastHold`。保持判据只认装备 S1 时已经确认的 `Attack_2`，以真实 `attackUntil` 为截止，避免同帧的技能关闭切掉收势与刀光；预起手不保持。`setAttackClip` 未登记。

她的动作节奏以 `art/talula/animation-spec.json` 为准（Codex 按 8 段官方素材逐帧实测，说明见同目录 `素材动作实测.md`）。四档命中帧不同：普攻与 S1 走 `Attack_2` 第 40 帧、S2 走 `Attack_1` 第 30 帧、S3 走 `Skill_2` 第 77 帧；表在 `talula-animation.js` 的 `PROFILES`，端点单位是**秒**（帧号已除以 30），因为 `spine.js` 的 `swingTime()` 把它直接当 `trackTime`。剑真正在扫的帧区间由同一文件的 `talulaSweep()` 给出，刀光采样与 S1 烈焰刀身都读它，没有第二份字面量。

火效来源分两层：`art/talula/effects/` 放原创 SVG 帧条（`atlas-layout.json` 描述帧数与单帧尺寸），运行副本在 `public/assets/custom/op_talulah/fx/`，由 `talula-textures.js` 在浏览器里栅格化切片。十组（`fire-feather`、`ground-tongues`、`hit-slash`、`fire-column`、`embers`、`smoke`、`flame-crescent`、`wall-body`、`wall-crest`、`delayed-burst`）都已接进绘制，每组都保留图集缺失时的 Graphics 回退；sprite 随记录复用，到期隐藏，清场时销毁。

各效果的位置：S3 圆弧剑气在 `talula-battle.js` 的 `drawTalulaRing()`（从施放位置向前扩散，半径只由范围内最远一格决定，弧面逐点贴地形高度）；剑气在 `spawnTalulaQi`/`updateTalulaQi` 与 kit 的 `talulaQiSlash` 分支；焰浪与恶火在 kit 的 `stepWaves()`/`addFire` 与 `setTalulaWave`/`setTalulaFire`；火翼在 `_updateWings`；原生灰色刀痕由 `spine.js` 的 `suppressSlots()` 每帧压掉。

S1 的 `talulaS1` 命中在 `talula.js` 创建带 `fiery` 标记的剑路刀光，由 `talula-slash.js` 扩大火焰拖痕并每帧沿剑身铺亮芯；开技不画掌心火光，命中不画火线。目标火柱宽高为原来的 1.2 倍，反馈持续 1.05 游戏秒，八帧火柱显式按 8fps 播放。S3 圆弧剑气的寿命为 `0.6/1.3` 游戏秒，扩散距离不变。火翼的图集锚点是 `(32/256, 228/256)`，按源图斜向羽轴 `(188, -201)` 算镜像与旋转，羽根挂在胸背、向两侧上方展开。

## 8. 命名规则

文件名说明它做什么，不说明它属于谁：`field-view` 是战场视图，`battle-session` 是一场战斗的会话，`spawn-catalog` 是能刷的敌人。上游代码保留原名，因为改名会切断它的内部引用；它们的位置（`public/studio/`、`server/{match,plugins,studio}/`、`packs/`、`schemas/`、`plugins/`）已经说明归属。

