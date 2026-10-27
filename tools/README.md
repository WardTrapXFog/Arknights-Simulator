# 维护工具

本目录保存源码维护、数据整理与素材处理脚本，供维护者按改动范围使用。角色的数据、战斗机制与表现分别由对应源码维护。

## 同步内容定义

```bash
npm run content
```

`build-content.mjs` 读取 `content/operators/index.json` 与 `content/enemies/index.json` 登记的定义，将记录合入 `data/chess.json`、`data/assets.json`、`data/backups.json` 和 `data/enemies.json`，并写出沙盒名单 `public/sandbox/js/generated-ops.js` 与机制登记表 `server/sim/content/kits/custom-catalog.js`。

维护时可通过 `node tools/build-content.mjs --operator <id>` 限定本次合入的干员定义，`<id>` 取自干员索引的 `id` 字段。该参数不限制敌人定义的合入；沙盒名单和机制登记表也仍按完整干员索引生成。

脚本处理已有定义和登记，不生成 kit 的技能逻辑或专属表现代码。数据、机制文件与素材引用的变更需分别维护；文件职责见[架构](../docs/ARCHITECTURE.md)和[机制模块](../server/sim/content/kits/README.md)。

## 更新原作满配牌库

```bash
node tools/build-operator-library.mjs
```

脚本读取官方属性、技能、范围与模组表，以及当前已接入的棋子、补位记录和 kit，将原作干员归并为满配牌库，写出 `data/operator-library.json` 和 `public/sandbox/js/generated-library.js`。数据表优先读取 `data/gamedata/`，回退 `.cache/gamedata/excel/`；表的用途见[官方数据表说明](../data/gamedata/README.md)。

此脚本保留现有自设定义，并将原作牌库写入独立文件；运行时由页面加载这份牌库覆盖对应的原作记录。

## 更新敌人选择目录

```bash
node tools/build-enemy-library.mjs
```

脚本结合 `data/enemies.json`、敌人机制登记与投放预设，生成 `public/sandbox/js/enemy-library.js`，供自由沙盒与关卡制作器列出敌人。它更新选择目录，不实现新的敌人行为。

## 素材与音乐

[素材下载说明](assets/README.md)介绍 `npm run assets` 的目录、下载策略和中断恢复方式；[背景音乐说明](../content/music/README.md)介绍项目使用的 OGG 曲目及循环标签。

素材导入与客户端提取的前提、命令及写入位置见[可选素材补全](../README.md#可选素材补全)。`import-assets.mjs` 只复制素材与兼容索引；`setup.mjs --local --game` 使用项目内的 Python 环境提取美术和当前牌库使用的官方特效，客户端目录必须明确指定。启动器的 `assets/readiness.mjs` 只统计现有文件，不安装或提取素材。
