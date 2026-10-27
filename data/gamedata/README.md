# 官方数据表

这里放的是构建与演练需要的**结构化数据**（不是美术素材）。分两类：

## 一、构建原作满配牌库

来自 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) 的 `zh_CN/gamedata/excel/`：

| 文件 | 用途 |
|---|---|
| `character_table.json` | 干员/装置基础表：职业、属性、天赋、技能引用 |
| `skill_table.json` | 技能各等级参数与描述 |
| `range_table.json` | 攻击范围格子的模板 |
| `uniequip_table.json` | 模组（含特勤证章）定义 |
| `battle_equip_table.json` | 模组对特性/天赋的改写（含 `validInMapTag`） |

`tools/build-operator-library.mjs` 优先读取这里的五张表，回退 `.cache/gamedata/excel/`。`npm run content` 则读取 `content/` 中的现有定义并合入运行数据，不直接读取这些官方表。具体用法见[维护工具](../../tools/README.md)。

## 二、查证敌人与集成战略用（写 content 时对照）

来自客户端解包（`zh_CN/gamedata/levels/enemydata/` 与 `zh_CN/gamedata/excel/`），经社区的客户端数据镜像取得：

| 文件 | 用途 |
|---|---|
| `enemy_database.json` | 敌人全量数据：各等级属性、天赋、技能、抗性、碰撞箱 |
| `enemy_handbook_table.json` | 敌人图鉴：编号、描述、种族 |
| `roguelike_topic_table.json` | 集成战略主题表：难度档位、关卡、藏品、分队 |

运行时使用已发布的 `data/enemies.json`，`content/enemies/` 中登记的定义向其中补充或覆盖对应条目。这三张原始表供维护时查询敌人属性、图鉴和集成战略规则；各条目的实现仍需结合具体等级与机制备注。

## 版权

数据版权归鹰角网络所有，仅用于非商业的同人模拟器。上游版本变化时，重新获取同名文件覆盖即可。
