# 资料来源与 MCP

## 来源与用途

| 来源 | 用途 |
|---|---|
| [PRTS.Wiki](https://prts.wiki/) | 干员与召唤物的机制备注、特例与操作规则 |
| [tomimi.dev](https://tomimi.dev/) | 对照具体页面、配装和模拟条件 |
| [PRTS-MCP](https://github.com/3aKHP/prts-mcp) | 查询 Wiki 页面、干员、敌人、关卡与立绘 |
| [Arknights Data Pipeline](https://github.com/3aKHP/arknights-data-pipeline) | 获取有版本标识的数值表、关卡、剧情和图片发布包 |

PRTS-MCP 的结果可能来自 PRTS 或 AKDP，同源结果不算独立证据。机制先读备注，数值结合原始表与实际配装；剧情摘要不作为战斗规则依据。引用或导入时记录来源版本，不用官设结果覆盖已确认的自设定义。

## 安装与客户端连接

Windows 可使用 [PRTS-MCP 3.1.2 的发行包](https://github.com/3aKHP/prts-mcp/releases/tag/v3.1.2)，保留包内 `bin/` 与 `data/` 结构。将客户端的执行命令指向 `bin/prts-mcp.exe`，环境变量设为 `PRTS_TRANSPORT=stdio`，避免使用默认的 HTTP 服务模式；可用 `PRTS_MCP_CACHE_DIR` 指定缓存目录。

在支持 MCP 的客户端中登记 stdio 连接、执行命令及上述环境变量，修改后重新加载客户端配置。查询数据和图片按服务的网络与缓存策略获取。

## 查询入口

配置服务器名为 `prts` 时，Codex 中的工具以 `mcp__prts__` 为前缀。

| 问题 | 工具与参数 |
|---|---|
| 基本资料与天赋 | `get_operator_basic_info(name, action="basic")` |
| 技能各等级参数 | `get_operator_basic_info(name, action="skills")` |
| 指定阶段与等级属性 | `get_operator_basic_info(name, action="stats", phase=…, level=…)` |
| Wiki 备注 | `prts_page(page_title, action="sections")` 定位小节，再用 `read` 读取 |
| 敌人 | `get_enemy_info(name, stage_id?)` |
| 关卡与敌方情报 | `get_stage_info(stage_id)`、`get_stage_enemies(stage_id)` |
| 立绘与变体 | `operator_artwork(operator_name, action="list" / "get")` |
| Wiki 检索 | `search_prts(query)` |
| 结构化数据检索 | `search(scope, pattern)` |

`get_enemy_info` 的首参为 `name`；`prts_page` 和 `operator_artwork` 均需显式传 `action`。Wiki 检索与结构化表检索用途不同，不能互相替代。

集成战略关卡可改用 PRTS 关卡词条与对应的官方关卡 JSON，关卡清单从主题表定位。查询干员时对应精英阶段、等级、潜能、技能与模组；召唤物还需读取主人及召唤物各自的备注。

来源代码、Wiki 文本、游戏数据和图片分别遵循各自许可。立绘发布包不等于完整的 Spine、技能特效或音频素材包。
