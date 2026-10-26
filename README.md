# Arknights Simulator · 关卡模拟器

基于 [Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 战斗引擎的单机模拟器，分为自由沙盒、游玩自制关卡、关卡制作器三个模块，不含大厅、房间或联机。

## 声明

本项目是**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方**没有任何关联**，也未获得其授权或认可。

《明日方舟》及其角色、美术、音频、文本等内容的著作权归鹰角网络所有。本项目不主张对这些素材的任何权利，仓库中也不分发官方美术资源（见「获取官方素材」）。

代码部分以 **GPL-3.0-or-later** 发布，继承自上游；详见 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md) 与 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

本同人项目完全免费，仅供学习交流与个人非商业使用，禁止售卖游戏整合包或收费运营。获取地址为本 GitHub 仓库，不设付费授权、激活或解锁；谨防冒名收费。代码许可与游戏素材的使用范围分别以 `LICENSE` 和 `NOTICE.md` 为准。

## 与上游的关系

战斗引擎、渲染层与大部分干员数据来自 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)（《明日方舟》限时玩法「卫戍协议：盟约」的非官方复刻）。本项目在该引擎之上做了单机化改造：

- 去掉大厅、房间与联机，只保留单机三模块；
- 作战规则按单机关卡重写（再部署、漏怪判负、关卡自带部署上限与作战音乐）；
- 新增关卡制作器与关卡 JSON 格式；
- 新增三名自设干员与若干自制敌人。

**干员覆盖**：上游实现的是卫戍协议玩法，只做进去了其中一部分干员，并非全图鉴。**联动干员因版权原因没有收录**（怪物猎人、彩虹六号、罗小黑等）。牌库中缺少某位干员属于已知情况，不是 bug。

## 获取官方素材

仓库**不包含**官方美术与音频（`public/assets/char/`、`public/assets/audio/` 等），这些内容由脚本从社区转储下载到本地：

```bash
npm install          # 顺带 vendor 前端库（postinstall）
npm run assets       # 下载官方素材，约 300MB，需要能访问 GitHub / jsDelivr
npm start            # 或双击 启动模拟器.bat
```

素材缺失时页面不会崩溃：拿不到图的位置显示灰底剪影占位，其余功能照常。所以可以先 `npm start` 看看，再决定要不要下素材。

`public/assets/custom/`（自设干员、自制敌人、塔露拉特效）随仓库提供，不需要额外下载。

`content/music/` 中的 OGG 作战音乐随源码提供，Git 克隆或下载源码 ZIP 即可获得；MP3 等源文件不入库，服务端也不开放下载。音乐版权归各自权利人所有，不适用代码的 GPL 许可证。

## 启动

需要 Node.js 22 或以上。双击 `启动模拟器.bat`，或运行 `npm start`，打开 `http://localhost:3100`。

双击启动时，关闭启动窗口会结束本次启动的服务端及其子进程。若提示服务端已在另一窗口运行，请关闭原启动窗口停止服务。使用 `npm start` 时仍按 Ctrl+C 停止。

开始菜单 `/studio/home.html` 提供三个入口：

- 自由沙盒 `/studio/console.html`：进入本地存档管理，继续现场或新建 8×17 空白地图。
- 游玩自制关卡 `/studio/play.html`：选择或导入关卡，查看简图及敌方情报，编队后作战。
- 关卡制作器 `/studio/level.html`：编辑地形、路线及独立出生，保存、导出或打开试玩。

## 自设干员

三名自设干员（塔露拉、维娜·维多利亚、结城理）为本项目原创，界面上标注「（自设）」以区别于官方同名干员。他们与官设版本可以同时上场。结城理由于上游项目未还原故暂未加入本项目。

## 自由沙盒

自由放置干员、刷敌人、编辑地形、测试技能与伤害。六槽存档支持新建、命名、覆盖、删除与复制；快存直接覆盖当前槽位。敌人列表与关卡编辑器共用目录，按全部、木桩、普通、精英、领袖筛选，并保留机制木桩和耐久变体。放置操作为「选手牌 → 点格子 → 选方向」，卡片上的 × 把干员移回牌库，＋ 打开牌库，职业筛选和名称搜索可快速找人。

牌库包括 202 名已接入原作干员，以及塔露拉、自设维娜、自设结城理。每名原作干员只有一张满配卡，不区分普通/进阶；官设维娜与自设维娜可以同时选择。原作采用最高精英化与等级、满潜、满信赖、最高技能等级及三级常规模组，默认模组优先沿用原棋子所选模组。三位自设沿用内容源的数值。手牌最多 13 张，10–13 张自动收紧卡片宽度。自由沙盒可以重复部署同名干员、强制开技能，不受回合限时约束。

右侧火力计分板显示物理、法术、元素、真实、总伤害和近 5 秒 DPS；每 200 毫秒更新，按游戏时间统计。存档只保留存活在场单位、位置、血量、技力、冷却、剩余路线、费用与统计，载入后暂停；不恢复进行中的技能、异常状态与弹道。

地形可以导出 JSON，再从制作器的「从沙盒导入」导入；干员、敌人现场和伤害统计不转换成关卡。

## 游玩自制关卡

从关卡列表选择一关，右侧可查看地形简图与本关会出现的独特敌人，不显示数量。支持文件或粘贴 JSON 导入，可选择只在本次页面游玩或存入关卡库。

点「开始作战」进入编队界面，按全部、先锋、近卫、狙击、医疗、术师、特种、重装、辅助筛选，配合搜索、排序、快速编队、技能选择与模组选择完成最多 13 人的阵容。四套本地编队可以命名、保存和切换。点「开始战斗」正式载入地图。

作战使用独立页面内的出战配置，不激活或覆盖自由沙盒存档。局内保留暂停、倍速、单帧、设置、技能操作与伤害面板，关闭刷怪、改图、换牌和强制开技能。部署扣费，同一干员只允许一人在场，撤退/被击倒后需等待再部署时间；基地生命为 3。清空敌人及出生队列后结算，漏敌达到 3 时失败。结算可再次作战、重新编队或返回列表。

## 关卡制作器

关卡只决定地形、路线、敌人和出生时间，不设作者阵容或关卡手牌限制。路线模板可复用，批量投放展开为独立出生；时间轴支持拖动、多选、框选、间隔复制和撤销。SVG 推演显示敌人位置、朝向与已走/未走路线，不运行战斗。

一级界面无需滚动：侧栏切换当前工具/关卡信息，地图随可用空间缩放，关卡库自动分页；长名单、导入文本、备注与完整错误信息放在二级菜单。时间轴默认全览，缩放后用前后按钮切换时间段。保存或导出的 JSON 自动包含地形简图。「试玩」会先保存当前修改，再新开游玩关卡页面，由玩家编队。

本地存储：自由沙盒当前现场 `arksim-sandbox-v3`、六槽库 `arksim-sandbox-slots-v1`、关卡库 `arksim-levels-v2`、玩家编队 `arksim-player-teams-v1`。清除网站数据会清除这些本地内容。v1 关卡库不读取、不迁移；旧 v2 中的作者阵容读取后不再采用，重新导出时移除。

## 内容维护

自设干员的完整定义在 `content/operators/`，由 `index.json` 登记；自设敌人在 `content/enemies/`。改完运行：

```
npm run content                            # 全部
node tools/build-content.mjs --operator talula   # 只更新塔露拉
```

生成器写出 `data/{chess,assets,backups,enemies}.json`、`public/sandbox/js/generated-ops.js`、`server/sim/content/kits/custom-catalog.js`。

原作满配牌库由 `tools/build-operator-library.mjs` 读取 `.cache/gamedata/excel/` 的 character/skill/range/uniequip/battle_equip 官方表，以及当前已接入的棋子与补位/甄选记录生成；复用 `server/plugins/officialUnitBuilder.js`，写出 `data/operator-library.json` 和 `public/sandbox/js/generated-library.js`，不覆盖 `data/chess.json` 的卫戍协议档位。更新官方数据后可重新运行该生成器。

复杂战斗机制在 `server/sim/content/kits/ops/`，塔露拉专属特效由 `public/js/render/fx/custom.js` 登记。

## 代码在哪

SI 自有代码与上游引擎分开维护：

- `public/sandbox/js/` 自由沙盘，`public/play/` 关卡游玩与编队，`public/level/js/` 关卡制作器，`server/sandbox/index.js` 唯一的 SI 服务端，`content/` + `tools/build-content.mjs` 数据源与生成器。
- `public/js/render/` 与 `server/sim/` 是引擎与渲染（战斗、寻路、绘制）。
- `public/studio/`（插件工作台页面）、`server/{match,plugins,studio}/`、`packs/`、`schemas/`、`plugins/`、`test/` 属于上游联机平台，SI 运行时不加载它们。
- `data/` 是生成物与上游游戏数据，不要手改；改 `content/` 再跑生成器。

细节见[架构](docs/ARCHITECTURE.md)，文档索引见[docs/](docs/README.md)。

## 许可

代码许可证见 `LICENSE`，原作素材约束见 `NOTICE.md`，第三方声明见 `THIRD-PARTY-NOTICES.md`。
