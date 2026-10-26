# 官方数据表

这里放的是构建与演练需要的**结构化数据**（不是美术素材）。分两类：

## 一、构建牌库/干员用（`npm run content` 直接读）

来自 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) 的 `zh_CN/gamedata/excel/`：

| 文件 | 用途 |
|---|---|
| `character_table.json` | 干员/装置基础表：职业、属性、天赋、技能引用 |
| `skill_table.json` | 技能各等级参数与描述 |
| `range_table.json` | 攻击范围格子的模板 |
| `uniequip_table.json` | 模组（含特勤证章）定义 |
| `battle_equip_table.json` | 模组对特性/天赋的改写（含 `validInMapTag`） |

脚本优先读这里，读不到再回退 `.cache/gamedata/excel/`。

## 二、查证敌人与集成战略用（写 content 时对照）

来自客户端解包（`zh_CN/gamedata/levels/enemydata/` 与 `zh_CN/gamedata/excel/`），经社区的客户端数据镜像取得：

| 文件 | 用途 |
|---|---|
| `enemy_database.json` | 敌人全量数据：各等级属性、天赋、技能、抗性、碰撞箱 |
| `enemy_handbook_table.json` | 敌人图鉴：编号、描述、种族 |
| `roguelike_topic_table.json` | 集成战略主题表：难度档位、关卡、藏品、分队 |

这三份不是运行必需的——游戏跑的是 `data/enemies.json`（由 `content/enemies/` 构建）。留着是为了新增/核对敌人时不必重新解包：`content/enemies/*.json` 的数值来源就是 `enemy_database.json` 的 level 0 条目。

## 版权

数据版权归鹰角网络所有，仅用于非商业的同人模拟器。上游版本变化时，重新获取同名文件覆盖即可。