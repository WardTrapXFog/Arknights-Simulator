# SI 架构

## 1. 服务入口与三个功能模块

| 入口 | 命令 | 作用 |
|---|---|---|
| SI 沙盒（日常） | `npm start` → `server/sandbox/index.js`，默认 `3100` | 纯静态文件服务：页面、素材、`/data/`、`/shared/`、`/sim/`、`/data.js`。不建房间、不开 WebSocket、不托管对局。 |

双击启动链：`启动模拟器.bat` → `scripts/start-windows.bat` → `scripts/launch-windows.ps1` → `scripts/launch.mjs` → `server/sandbox/index.js`。PowerShell 将自身加入带 `KILL_ON_JOB_CLOSE` 的 Windows Job，保留非继承句柄；启动器、服务端及子进程继承该 Job，关闭窗口结束 PowerShell 时由系统一并结束。已有服务复用时明确提示关闭原启动窗口。启动提示由 `scripts/startup-message.mjs` 共用输出，TTY 下使用亮红声明、蓝青重点与彩色模块名称；不列举局域网／公网分享地址。`scripts/start-windows.bat` 检查 Node.js，并在缺少任一运行依赖时自动运行 `npm ci`，失败则回退 `npm install`；前端库由安装后的 `postinstall` 准备。后续 JS 启动器不执行 `tools/setup.mjs`，整条双击链不自动下载官方素材或提取本地客户端。`--debug`（或环境变量 `SI_DEBUG=1`）开启浏览器交互日志：服务端向页面回 `/api/debug`，前端经 `/api/log` 把导航、点击与模块耗时打回启动窗口。

服务监听时把 `/` 重定向到 `/studio/home.html`（工作区选择页），`/healthz` 返回 `{ok, mode:'sandbox'}`。

## 2. 目录即职责

```
public/
  play/              自制关卡浏览、玩家编队与开战入口
  sandbox/js/        自由沙盒（SI 自有）
  level/js/          关卡制作器（SI 自有）
  studio/            三模块 HTML 入口与共用样式
  js/                战斗引擎的浏览器侧：渲染、音频、素材、sim 加载器
  css/ fonts/ icons/ assets/ vendor/
server/
  sandbox/index.js   SI 唯一的服务端文件
  sim/               战斗引擎（浏览器经 /sim/ 只读加载）
  http/              SI 静态服务的配置、响应、压缩与安全策略
data/                `tools/build-content.mjs` 的生成物 + 上游游戏数据
shared/              引擎与页面共用的纯模块
content/             内容定义、关卡文件与背景音乐
tools/               内部数据维护与素材脚本
```

`server/sandbox/index.js` 是唯一服务入口，负责本机静态文件、关卡库与音乐列表接口；战斗模拟在浏览器中执行。`public/index.html` 将首页地址导向主菜单。

`session.js` 默认装载 `public/sandbox/js/aue/`，由一个 AUE 世界执行战斗，适配器提供现有手牌、单位投影、表现事件和计分接口。`battle-data.js` 复用页面数据缓存，默认加载链不导入旧 Battle 或脚本／特质安装器。明确带 `?engine=legacy` 时才延迟装载 `legacy-session.js` 和旧引擎，供既有内容对照；新增原生干员使用 AUE 路径。

`tools/prepare-aue-trial.mjs` 只在维护时读取固定上游 Git 对象并生成 `engine/aue-runtime.json.gz`。包内包含运行导入闭包、逐文件哈希与上游许可；服务启动时由 `tools/aue-runtime.mjs` 在本地展开到忽略的 `public/vendor/aue-trial/`，同一包复用缓存，玩家不需要上游仓库或网络下载。版本由 `aue/version.js` 固定。

牌库保留原有 202 个原作／补位槽位及三名自设，另由 `tools/build-aue-roster.mjs` 生成 259 个原生槽位及配装定义，总计 464 个。原有干员继续使用本地 kit，新槽位使用 AUE 原生技能、职业和天赋数据；同名自设与原作身份独立。敌人优先原生能力，项目新增能力及原生未覆盖部分使用已登记的本地敌人／领袖能力，按单位选择，避免双重安装。当前 259 条敌人均已接入；有限运行检查与用户试玩的区别见 [运行记录](AUE试接运行记录.md)，成果与维护方式见 [引擎迁移成果与维护](引擎迁移成果与维护.md)。

## 3. 自由沙盒 `public/sandbox/js/`

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
| `settings.js` `ui/settings.js` | 复用上游 `sanitizeSettings` 的全局偏好存储与设置窗口；局外不显示战斗快捷键配置；通过 AudioManager、`view.setSettings` 和文字／动效属性即时生效。`interface-text.css` 在四个入口中统一消费 `data-text`，按小／中／大／特大放大菜单、设置、牌库、详情与计分文字，保持地图和布局根尺寸。 |
| `debug-log.js` | 局外交互日志：`debugLog`／`debugTimer` 写 console 并批量 POST `/api/log`，开关来自 `/api/debug` 或 localStorage。 |
| `session.js` | 界面与引擎之间唯一的会话门面：建场、推进、部署／撤退／刷怪命令、时间与单位查询、事件观测、存档读数。引擎私有成员只允许在这里出现；`tools/check-session-boundary.mjs` 守着这条线。 |
| `battle-session.js` | 沙盒专属的对局操作：组装 `BattleSpec` 交给会话、部署判定、出生表与手动敌人的持久化放置／删除、runner 启动。 |
| `damage-score.js` `ui/scoreboard.js` | 沙盒伤害计分与右侧六项面板。前者监听 `damaged` 回调累计四种对敌伤害、用固定 150 桶记录近 5 秒；后者每 200 毫秒刷新数字、占比与短促反馈。 |
| `battle-runner.js` | 固定步长推进战斗并产出快照/事件（沙盒与关卡游玩共用）。 |
| `field-view.js` | 战场视图的创建、销毁、快照推送、事件推送、音频接入、选中镜头与表现层接线。 |
| `battle-feedback.js` | 独立 Canvas 表现层：技能范围外沿、开技标记、丹增与液氮弹道、产费数字飞向费用栏及显示延迟。只读取战斗状态与事件，按 30 Hz 绘制。 |
| `battlefield.js` | 地图字形、地形笔刷、战场范围、红蓝门与地图体检。 |
| `spawn-catalog.js` | 旧投放预设与倍率保留原下标，再追加 `enemy-library.js` 中尚未列出的正常敌人。按全部、木桩、普通、精英、领袖筛选；保留 8 个机制木桩与耐久变体。 |
| `operator-catalog.js` `roster.js` `generated-ops.js` | 手牌与选人器：三名自设 + 独立生成的 202 名原作满配干员。普通/进阶别名归一，按职业筛选。`generated-ops.js` 由内容同步脚本写出。 |
| `panel-models.js` | 左侧详情面板与场上技能操作的数据模型。 |
| `asset-urls.js` `generated-illustrations.js` | HUD 图片入口与 205 名干员完整立绘的地址、尺寸、透明边界登记；详情按边界自适应缩放。登记表生成器为 `tools/import-operator-illustrations.py`，素材来源记录在 `art/operator-illustrations.json`；`npm run assets` 通过 `tools/assets/illustrations.mjs` 按该登记表下载正式图片。 |
| `hud.js` `ui/` | HUD 公共接口与各区块：`shell`（壳）`hand`（手牌）`detail`（详情）`toolbox`（工具箱）`picker`（选人器）`icons` `html`（小工具）。 |

`public/studio/home.html` 是自由沙盒 / 游玩自制关卡 / 关卡制作器的三入口菜单；菜单和存档窗口的样式在 `public/sandbox/menu.css`，也由它提供共用的扫描线和静态噪点变量。`public/studio/sandbox.css` 保留 HUD 布局，`public/sandbox/hud-theme.css` 定义炭灰面板、琥珀状态、青绿交互、警报红、小圆角、倒角与菱形控件。状态栏直接使用原有 `public/assets/ui/hudPanel/bg_battle.png` 八边形长条底板。扫描线与噪点只用于面板和菜单，不覆盖战场画布；打开与点击动画走 CSS 分段关键帧，系统减少动态效果设置会关闭动画。`controller.js` 的 `onSaves` 打开窗口前暂停 runner，关闭后按此前播放状态恢复；`pagehide` 保存当前编辑内容。

`terminal-shell.js` 与 `terminal.css` 统一主菜单和三个二级入口的导航、设置、上浮粒子与按键立体反馈。主菜单开屏只在当前标签页会话首次进入时播放；常驻宿主页通过同文档 View Transition 保持旧工作区图像并左右滑动；不使用宿主页的独立入口保留 `terminal-navigation.js` 的跨文档切换。主菜单在首次开屏结束后依次浮现标题、三个入口与页脚；返回主菜单时只播放内容入场。三个二级入口共用同一深色背景，制作器的顶部工具区使用对应半透明底色。实际关卡编辑工具关闭这些交互音效与动效，页面角落保留全局设置和音乐开关。顶层工作区请求由服务端加载 `music-shell.html`，内层页面保留各自的导航和生命周期；`music-shell.js` 持有跨页共用的局外播放器，`menu-audio.js` 将局外状态和选曲转交给它。曲目与关卡编辑器共用 `/api/music`，默认《生命流》，选择写入 `arksim-sandbox-settings-v1.menuBgmTrack`。`level-bgm.js` 保留暂停音源和最多两首解码缓存，开关、静音及音量调整不重新加载；局内外切换和换曲重新起播。使用见[背景音乐](../content/music/README.md)。文字选择与链接、图片拖拽在页面层禁用，输入框仍可编辑。

宿主页的 View Transition 更新回调只更换 iframe 的 `src` 并立即返回，260 毫秒滑动动画由宿主播放；`moving` 锁在动画结束后释放，并设 1600 毫秒兜底计时。回调不等待子页的 `terminalReady()`，避免导航提交与子页加载互相等待。子页通过 `html[data-terminal-pending]` 隐藏未就绪内容；被宿主框住时跳过自己的 View Transition。交互音效与 BGM 的 AudioContext 只存在于宿主窗口，子页通过 `menu-audio.js` 转发调用。

`debug-log.js` 提供局外交互日志：`debugLog` 写一行 console 并批量 POST 到 `/api/log`，`debugTimer` 记录一段耗时，`describeNode` 描述被点击的元素。开关由 `/api/debug`（服务端 `SI_DEBUG=1`，启动器 `--debug`）或 localStorage 的 `arksim-debug=1/0` 决定；关闭时不发请求。服务端 `/api/log` 只在 `SI_DEBUG` 开启时把收到的行打到启动窗口，文字以 `[浏览器 时间]` 前缀与本机日志区分。

`menu-layout.css` 为局外页面提供共用的光学布局：错位倒角三入口、浅灰选中面、深色列表与实色核心操作。青磁信号、冰蓝光学、琥珀档案共用布局，仅切换配色；保留 `signal`／`optical`／`graphite` 三个主题 ID 及默认 `graphite`，已有选择继续有效。全局设置即时写入 `arksim-sandbox-settings-v1.menuTheme`，head 中的 `terminal-navigation.js` 在首次绘制前恢复配色。该样式覆盖存档入口、选关、编队、关卡库与相应弹窗；编队保留原有选人、技能模组、职业筛选及 Auto。关卡库使用已生成的 `thumbnail` 展示预览，并按图文卡片尺寸计算分页。主要操作使用主题高亮色，次要操作使用深色表面，危险操作保留红色。新布局限于 `data-terminal-mode="menu"`，共用导航与带 `sandbox-settings--global` 的全局设置可以从编辑器打开；实际编辑工作区和战斗 HUD 继续使用原有样式，`menu-themes.css` 保留这些区域既有的配色规则。导航、加载、音乐与战斗数据流不变。

工具箱只有刷敌人与改地形两页。保存、快存和地形重建都先从实际 battle 读取存活、已部署、血量大于零的干员与敌人；不以历史布置清单决定新存档中的单位。敌人从当前位置沿剩余路线恢复，仍通过唯一的 `document.spawns` 进入引擎。重建按保存顺序部署干员，再处理现场敌人、恢复血量／技力／攻击冷却与演练时间／费用。进行中的技能、异常状态与弹道不作为完整帧恢复。旧格式无法反推其保存时已经退场的单位。

自由沙盒关闭 `_checkEnd` 自动结束检查。关卡游玩在 `battle-session.js` 的独立模式开启清场结算、目标生命耗尽失败与再部署冷却；两种模式都不使用上游 30 分钟截止，本体手动部署通过独立开关接入共用引擎。runner 使用 `cap=Infinity`。`field-view.rebuildField` 用 `audio.setFieldUnits` 在声音解锁前登记已有单位，随后继续按事件播声。框选由 terrain-brush 的捕获阶段 pointerdown 转交 enemy-placement，并通过现有 `tileScreen` 接口命中敌人格子；选框是独立固定定位浮层。

`battle.sandboxScore` 监听结算后的 `damaged`，以 `credit || source` 判定我方对敌，按 `phys / arts / elemental / true` 记录包含过量的伤害；不读渲染伤害数字，不计元素条积累、生命流失与手动删除。DPS 是最近 150 tick 的伤害除以 5，时钟取 `battle.time`。计分表按总伤降序显示至多 13 行，实时面板和结算报告共用行模板。计分不改战斗上下文，重建时移除旧钩子；四类总数及窗口桶保存到 `session.score`，缺失时从零开始。「清零」只重置计分，重置演练与新地图通过新会话清零。

`field-view.js` 同时向 `fx/vina.js`、`fx/makoto.js` 投影实际技能状态、庇护、人格索引、死亡宣告记录、伟大封印范围与救济庇护期限。两个模块由 `fx/custom.js` 注册，沿现有 `FxSystem` 生命周期更新／清理，共用 `combat-shapes.js` 的投影图形。弥赛亚的独立 SVG 投影与本体分开绘制，角色正背面均不借用官方三技能的人格换相；运行动画映射由两份内容源生成到 `data/assets.json`。

SI 的 `field-view.js` 固定传入 `tierChips:false`，不创建干员血条左侧的卫戍协议阶数徽标；生命、技力与状态标记仍使用原有布局。手牌点击选中与关卡拖拽拿起共用 `AudioManager.voice(..., "select")`，按已有语音槽随机选择选中干员1／2，取消选择不播报。`record.assets.voice` 指定自设干员的原版语音身份：维娜使用 `char_1019_siege2`，结城理使用 `char_4217_makoto`；内容源的 `voiceAssets` 由 `build-content.mjs` 写入运行语音表。素材下载计划读取这些额外语音身份，只有 LINKAGE 配音的角色使用原版日语语音作为默认回退。

`field-view.js` 向 `fx/wang.js` 投影真实的棋子、跟子、激活轴及三技能范围。`wangStoneLand`、`wangStoneBurst` 由 kit 在落子和伤害结算时发出；`vfx/skills.js` 的补充绑定在同一地块播放原有官方素材，天下劫保留完整 `wang_skill_03_buff`、范围起始和范围循环；范围子特效独立读取四向朝向，不继承本体光环的双面镜像。专属模块按主人 ID 和跟子序号维护棋子模型的渲染实例，使用真实范围键绘制贴地外沿，实例不登记为战斗单位。kit 按游戏时间延迟逐枚生成跟子，每次重新选格、额外跟子成功生成后扣弹，同次序列排除已使用的相邻格；库存耗尽等待当前跟子序列完成后结算。官方特效的 `vfx/system.js` 投影矩阵与 `vfx/geom.js` billboard 基向量使用相机 roll。手牌预扣库存后才执行部署回调，完成后发出 `handDeploy`。

选中视图通过 `view.setCamera` 的 `roll` 与 `padding` 参数调整镜头；`projection.Camera` 在正投影、逆投影、THREE 相机参数与镜头插值中保持相同的旋转。`controller.js` 按单位投影更新独立 `selection-actions` 容器，`ground-plane.js` 由当前相机的 roll、tilt、焦距和屏幕锚点计算地面平面的 CSS `matrix3d`；选中框、三个按钮及技力条统一受该矩阵控制。`ui/detail.js` 共用同一组技能、范围和撤退操作，READY 时隐藏充能蒙版与旧就绪叠图。`panel-models.js` 从当前配装原始记录筛选可见天赋，保留 hidden/index 在显示筛选中的语义，提供等级、范围小图与技能元数据。范围 HUD 继续使用 `highlightTiles`；持续技能的发光外沿由 `battle-feedback.js` 单独绘制。

`server/sim/battle/economy.js` 管理费用下限、可透支判断、`dpRegen` 自然回复倍率和 `dpGain` 表现事件。`projectiles.js` 同时支持追踪目标、固定落点以及带 `velocity`／`onStep` 的逐帧直线弹道；`ai.js` 的 `resolveAttack` 允许技能替换普通攻击的结算方式，同时保留攻击计数和攻击完成回调。`deployment-hand.js` 区分无需朝向确认和需要朝向确认的 token ID，并在流形复制提交时写回选定朝向。

`render/app.js` 的图层顺序保证被部署的干员永远可见：地面美术与阴影 → 官方地面特效 → 地面／普通特效 → 敌人与地块道具（共用一份深度排序）→ 敌方血条 → 叠加与弹道特效 → 官方 over 特效 → 干员与召唤物（`allyUnits`）→ 干员 HUD（`allyBars`）→ 浮动文字。敌我各占一层、各自按 `unitDepthKey` 深度排序，因此同阵营内部仍遵守地形前后遮挡，而干员与血条、技力条、技能就绪菱形、状态图标不会被任何敌人、敌人血条或战场特效盖住。`units.js` 的 `UnitView` 按 `info.side` 选层，`DeviceView` 与地块道具留在敌人的 `units` 层。

音效有两套独立的发声额度。战斗限流器（`SfxLimiter`，8 路）管攻击／命中／技能等高频音效；部署落地音与单位退场音各自拥有独立额度（`LAND_VOICES`／`DIE_VOICES`，各 3 路），超额时最旧的一个让位并淡出，新音效不会被丢弃。退场音效因此不会在密集战斗中因额度耗尽而消失。`deathSfxUrl` 只在单位被击倒时播放，但带 `dying` 标记的强制退场（史尔特尔的余烬、斩业星熊 S3 临死模式结束）同样播放——引擎在 `die` 事件第四位写 1 标记这类退场，客户端据此放行。

## 4. 关卡制作器 `public/level/js/`

| 文件 | 职责 |
|---|---|
| `app.js` | 关卡库、地形/路线/出生模式、敌人筛选、导入导出、共享撤销、自适应关卡库分页、侧栏页与二级对话框接线。只加载 enemies，不启动战斗；局外音乐与共用导航由 terminal-shell 接入。 |
| `level-store.js` | 通过 `/api/levels` 读取、保存与删除 `content/levels/` 中的关卡文件，内存缓存供界面同步查询；坏关卡单独跳过，写盘失败反馈错误。 |
| `level-model.js` | 出生创建、路线解析、带停留的累计弧长、任意时刻场况与推演长度，按编辑操作失效的寻路缓存。 |
| `terrain.js` | 原有地形笔刷、部署区拖拽、地图 JSON 导入导出，地图点击交给当前模式。 |
| `routes.js` | 持久化路线 ID/名称、引用计数、节点编辑与停留、按间隔批量投放、引用删除确认；`previewRoute()` 用 Grid 的平滑 waypoints 构造预览折线。 |
| `timeline.js` | 独立出生点、游标播放、多选/框选、拖动吸附、平移、间隔复制、缩放、全览与时间窗口前后切换，无横向滚动。 |
| `tracer.js` | 在地图 SVG 的独立图层投影场况、朝向与短名、已走/未走折线，不引入 PIXI。 |
| `workspace-layout.js` | 将一级工作区固定在可视区域，小窗口整体等比适配，尺寸变化时重排关卡库或时间轴。 |

数据契约在 `shared/level.js`：v2、512 KB、8000 条独立出生、60 关、每线 24 个检查点，无独立路线数量上限，部署区至少 2×2。`validateLevel()` 抛带 path 的中文 `LevelError`；`levelSpawns()` 展开模板/私有路线和原地停留；`levelDuration()` 取最后出生时间加 60 秒。关卡不包含玩家阵容；旧 v2 的 squad 读入后移除。`shared/level-preview.js` 从地形生成 thumbnail 内嵌 SVG 简图，保存与导出刷新，外部提供的图片内容不直接采用。`level-model.playableUntil()` 另按实际折线长度、移速与 WAIT 算推演轴长。无终点单位停在末点，轨迹推演不处理任何战斗交互。

制作器「关卡信息」提供关卡名、难度星级、部署上限（1–13，缺省 8）、目标生命上限（1–999，缺省 3）、作战音乐等控件，并只读显示关卡 id。星级只用于展示，范围 0–10；主题字段 `meta.theme` 由关卡 JSON 提供并进入特勤模组判断，制作器尚无主题规则面板。缺省上限只在界面和战斗读取时取值，不批量改写旧关卡文件。

关卡身份：`name` 就是磁盘文件名（`content/levels/<name>.json`），编辑器里改名即改文件名，保存走服务端一次 `rename`（`PUT /api/levels/<新名>?from=<旧名>`，目标已存在时返回 409），不做「写新 + 删旧」；`id` 是英文半角指纹 `lv_<时间 base36>_<6 位随机>`，创建、另存为、复制时生成，之后不随保存改变，只用于 URL 参数与内存查找。读入时以文件名为准（`loadLevels` 用文件名主干覆盖 `name`），因此手动在资源管理器改名不会留下第二份真相。编辑器「另存为」写新文件并换新 id；导入撞 id 时选覆盖或另存为新关，名字撞了自动让成「原名 2」。`manifest.json` 是关卡库登记表，不参与读取。


UI 素材清单按 `tools/assets/ui-groups.mjs` 的 `UI_GROUPS` 白名单生成：`plan.mjs` 的 `addUi` 与 statistics 分支都过 `uiAllowed`，`catalog.autochessUi` 里没进白名单的分组（官方联机界面的商店、结算、徽标等）不再下载。`npm run ui`（`tools/check-ui-assets.mjs`）核对三件事：清单里出现名单外分组、名单写了清单里没有、标了在用却在代码里找不到引用，并检查 `plan.mjs` 的闸门是否在位。

`tools/build-enemy-library.mjs` 读取敌人数据、KITS/STATS_ONLY/BOSS_KEYS 和 `ENEMY_PRESETS`，生成 `public/sandbox/js/enemy-library.js` 的正式/仅数值/玩具分层。`LIBRARY_KEYS` 用于关卡校验；编辑器只列正常敌人，沙盒将共用目录追加到旧投放预设后。筛选等级取共用目录的 `rank`，木桩独立分档。

关卡战斗左上角使用「退出战斗」下拉确认，红色「确认」返回关卡列表；展开时暂停，收起时恢复此前播放状态。沙盒保留原来的开始菜单入口。`/api/music` 提供局外设置与关卡编辑器共用的音乐列表，`/music/` 提供 OGG 文件；播放器按文件的源采样率换算循环秒数。音乐使用范围见 `content/music/README.md`。

一级界面不滚动：`level.css` 用固定视口网格安排工具栏、地图、单页侧栏与时间轴；地图按容器宽高缩放，路线/节点通过原生单行下拉选择。敌人、导入、备注及完整错误信息仅在二级对话框或展开菜单中滚动。关卡库按窗口可容纳的行列分页，时间轴默认全长适配，放大后用前后按钮切换时间窗口。

试玩调用保存与完整关卡校验，再新开 `/studio/play.html?level=<id>`；玩家在该页选关和编队。关卡文件与沙盒存档分别保存。

## 4.1 独立游玩与玩家编队 `public/play/`

`server/sim/battle/deployment-hand.js` 在 Battle 的 `manualDeployment` 开关下安装手动部署规则，`siLevel` 区分关卡约束和自由沙盒。编队成员由 BattleSpec.players.units 提前建立，召唤物池在安装内容前按主人技能、模组及 token sources 建立。关卡成员复用实例，不再以永久移除加新建实例模拟再部署。`battle.hand` 负责记录、卡片投影、库存、费用、部署检查、部署位、待投放和流形复制；原 kit 继续提供伤害、属性、召唤物效果及库存补充。默认未开启这些开关的对局沿用原引擎行为。

`battle-session.js` 为关卡传入 10 初始 DP、99 DP 上限、每秒回复 1 和 部署位上限（`meta.deployLimit`，缺省 8）与目标生命上限（`meta.lifeLimit`，缺省 3）。手牌部署、落点预览及朝向确认共用 `battle.hand.error`，扣费只发生在正式部署。再部署费用按 1、1.5、2 倍计算，费用效果保存在卡片记录；撤退返费区分倍率与上限。召唤物的部署后冷却、唯一单位离场冷却和中继器队列各自计时，库存适配现有 summonDeck、craftsman、wang、doroth、phantomStock 和 summonStock。

`ui/hand.js` 根据实时卡片写入库存、冷却、标记及不可用原因，状态变化原位更新；卡片增减和排序变化才重建节点。B 模式的名单由 `battle.hand.cards()` 提供，自由沙盒仍显示原 squad，并追加主人在场时可用的召唤物牌。沙盒 format:3 的 operators 可附加 tokenId/ownerUid，重建先恢复干员、创建关联池，再恢复在场召唤物。

`public/studio/play.html` 复用战场样式与资源入口，先加载 `public/play/js/app.js`：关卡库/导入 → 关卡侧栏简图与按 key 去重的敌方情报 → 玩家编队。职业筛选为全部与八职业；牌库还支持搜索、排序和快速勾选。`team-store.js` 在 `arksim-player-teams-v1` 存八个具名编队及各人的技能、模组；读取旧数据时保留前四个编队，补齐其余空槽，不更换存储键。编队上限 13 是玩家出战规则，不属于关卡文件。选关卡片采用紧凑行高与列表内滚动；未选关卡时，侧栏显示分层挑战提示与四条主题色上行丝线，减少动态效果时保持静止。编队右栏用七列两行头像保留全部十三个槽位，固定配装控件与说明翻页区，不使用纵向滚动；`description-pager.js` 用 CSS 多栏按实际宽高排页，尺寸变化时通过 ResizeObserver 重排，保留技能与模组说明全文。

`public/sandbox/js/level-run.js` 将关卡和本次玩家选择组装为 `levelRun`，通过 `bootSandbox({run})` 在同一页面加载战场。它不调用 activateSave，不写 SAVE_KEY，不选择存档槽。controller 的保存入口在关卡模式直接返回，地图/刷怪/换牌 UI 隐藏且操作入口禁用；预选的技能、模组通过部署输入送入引擎。关卡模式正常扣费，限制同名在场一人，退场记录再部署截止时间，不免费激活技能；`ui/level-result.js` 在结算时固定伤害与时间数据，并调用 `fadeOutLevelBgm()` 在 320 毫秒内淡出作战音乐。成功时短暂延迟后显示带 ARK/SIM 图标的投影横幅，灰层沿地面平面位于黑层下方；横幅出现时播放成功 WAV，收到播放结束事件后淡出并打开报告。失败使用红灰横幅与短暂故障效果，失败 WAV 结束后显示点击继续提示，再由点击或 Enter／空格打开报告。减少动态效果时关闭故障效果并缩短界面过渡，但不跳过音效。音效使用静音与 SFX 音量，文件位于 `public/assets/custom/ui/settlement/`。报告放大文字、计分表与操作按钮，支持重试、重新编队、返回列表和打开编辑器。临时导入的关卡在进入编辑器前等待写盘，已有同 ID 关卡不被出战副本覆盖。

`public/play/js/hand-deployment.js` 仅在关卡对局中绑定 DOM 手牌的 Pointer Events，通过 `tileScreen` 在当前战场范围内命中地块，展示合法格和头像预览，不使用上游拖拽器的固定部署区域。合法落点交给 controller 挂载原有 `FacingWheel`，二次拖动朝向确认后才调用 `deployOperator`；拖放和正式部署共用 `deploymentError`，待确认期间不创建引擎单位、不扣费。视图重建、切换、设置、结算及失焦清理交互。沙盒继续使用点击部署，关卡中单击手牌只选中详情，不将战场切成只认格子的放置模式。

`public/sandbox/js/operator-library.js` 将 `data/operator-library.json` 覆盖到页面的棋子目录，并用独立 DataSource 覆盖战斗棋子与满级召唤物，原始 `data/chess.json` 保留上游档位。生成器 `tools/build-operator-library.mjs` 复用 `tools/official-unit-builder.mjs`，读取官方表，将已接入棋子与有 kit 的补位/甄选干员归并为 202 名原作，生成最高等级、满潜、满信赖、最高技能和三级常规模组；默认选择原棋子模组，过滤仅其他玩法生效的模组。`generated-library.js` 提供唯一 ID 列表和普通/进阶别名；`roster.js` 合并三位自设，现有自设定义不参与原作补齐。自由沙盒旧存档的棋子别名在载入时归一，格式不变。

## 5. 出生数据只有一种真相

一次对局的敌人只能来自一处：关卡自带的 `document.spawns`，或沙盒按红门序号编的 `document.waves`。`state.js` 的 `useLevelSpawns` 与 `useSandboxWaves` 是仅有的两个切换口，各自清掉另一方。`session.open`（由 `battle-session.buildBattle` 调用）的顺序是 `opts.spawns → document.spawns → 波次映射`。

## 6. 内容定义与运行数据

`content/operators/` 与 `content/enemies/` 保存项目已接入的内容定义及索引。内部脚本 `tools/build-content.mjs` 将定义合入运行数据，并同步名单和机制登记：

- `data/chess.json`、`data/assets.json`、`data/backups.json`、`data/enemies.json`
- `public/sandbox/js/generated-ops.js`（沙盒名单）
- `server/sim/content/kits/custom-catalog.js`（kit 登记）

复杂机制由 `server/sim/content/kits/` 中的代码实现，角色表现由渲染和音频模块实现；数据同步脚本不代替这些实现。脚本的参数与写入范围见[维护工具](../tools/README.md)。

`npm run assets` 的公开下载目录由 `tools/assets/catalog.json` 提供，结合 `data/` 补充当前角色和敌人。下载入口默认优先 jsDelivr 可覆盖的仓库文件，失败时回退原始源；语音分支和 GitHub Release 使用原始源或用户自配代理。没有内置通用 GitHub 转发代理，`--asset-source=direct` 可改为原始源优先。上游音频、语音与模型索引缺失时在线下载并缓存。完整立绘按仓库中记录的版本和哈希从 AKDP 图片包读取；下载清单写入前调用 `build-content.mjs` 的 `applyContentAssets` 合并内容源中的自设素材与音频配置，不重建战斗数据。中断后复用校验合格的完整文件，未完成的单个文件重新下载；下载器的 `--prune` 保留 `public/assets/custom/` 与 `public/assets/local/`。Node 与浏览器的默认模拟数据均使用正式运行数据。

启动器通过 `tools/assets/readiness.mjs` 展示 Node、依赖、前端库、运行数据与素材的准备情况，本地美术和特效按实际非空文件统计。网络音效计划使用随源码提供的 `skill-modes.json`，不依赖本地特效索引。完整立绘的 Range 请求失败时回退到项目内缓存的完整 ZIP。`tools/import-assets.mjs` 从显式指定的整合包复制官方素材和兼容索引；`tools/setup.mjs --local --game` 从显式指定的客户端 AssetBundle 目录提取美术及官方特效，不自动发现客户端。

## 7. 专属表现模块

`public/js/render/fx/custom.js` 汇集各干员模块的事件处理、方法与生命周期。专属模块消费战斗状态和事件，负责角色、弹道、地面效果与声音，不推动机制结算。

塔露拉的表现分为 `talula.js` 的公共接线，以及 `talula-animation.js`、`talula-slash.js`、`talula-battle.js`、`talula-textures.js`、`talula-feedback.js` 和 `talula-audio.js` 的动作、剑路、技能特效、纹理、反馈与音频职责。维娜与结城理分别由 `vina.js` 和 `makoto.js` 接入。

通用渲染层提供姿势、挥击规划与外层位移接口；具体角色的选片、时间映射与表现条件由其专属模块决定。塔露拉的当前运行映射见 `talula-animation.js`，官方素材的片段和关键帧测量见[素材动作说明](../art/talula/素材动作实测.md)。原创火效图集的定义位于 `art/talula/effects/`，运行副本位于 `public/assets/custom/op_talulah/fx/`，由 `talula-textures.js` 切片并提供缺图回退。

## 8. 命名规则

文件名说明它做什么，不说明它属于谁：`field-view` 是战场视图，`session` 是界面与引擎之间的会话门面，`battle-session` 是沙盒这一层的对局操作，`spawn-catalog` 是能刷的敌人。共用的战斗与渲染模块保留原名，SI 页面入口、界面代码、引擎与构建工具按目录区分职责。

