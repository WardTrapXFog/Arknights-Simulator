# 资料来源与 MCP

## 来源与用途

| 来源 | 用途 |
|---|---|
| [PRTS.Wiki](https://prts.wiki/) | 干员、召唤物的机制备注、特例与操作规则。 |
| [tomimi.dev](https://tomimi.dev/) | 与 PRTS、客户端数据并列参照，采用内容须对应具体页面和实际配装。 |
| [PRTS-MCP](https://github.com/3aKHP/prts-mcp) | 将 Wiki 页面、结构化干员属性、技能等级、敌人、关卡、剧情与立绘检索接入客户端。 |
| [Arknights Data Pipeline](https://github.com/3aKHP/arknights-data-pipeline) | 获取客户端数值表、关卡、剧情和干员图片的版本化发布数据。 |

PRTS-MCP 是查询层，部分查询读取 PRTS，部分查询读取 AKDP。不能把这几路同源结果当作独立的交叉证据。游戏内短描述用于定位效果，机制实现仍需备注、原始参数与实机依据；官方客户端原始表格继续用于确定数值和标识。

AKDP 的 `data-*` Release 提供 `zh_CN-excel.zip`（数值表）、`zh_CN-levels.zip`（关卡）、`zh_CN.zip`（表格和剧情等）、`zh_CN.sqlite.gz` 与 `manifest.json`；图片另走 `images-*` 发布。剧情摘要包含 LLM 生成内容，不作为战斗规则依据。查询和导入时记录源版本及干员配装，不自动替换现有自设数据。

## 本机接入

PRTS-MCP 使用 Windows x64 原生发行版 [3.1.2](https://github.com/3aKHP/prts-mcp/releases/tag/v3.1.2)，安装在**项目外的共用工具目录**（与本仓库同级，发行包解压即可，保留 `bin/` 与 `data/` 结构），运行数据缓存放在同一个工具目录下。

放在项目外是有意的：它 574MB、与项目源码无关，而且不止本项目要用（同机的其它 agent 客户端也能指向同一份）。**它不属于这份仓库**——别人 clone 之后如果想让自己的 agent 接 PRTS，按本文档自己装一份即可。安装与缓存均不进入 Git；源码记录不包含个人客户端配置或凭据。

可执行文件是发行包里的 `bin/prts-mcp.exe`；必须设环境变量 `PRTS_TRANSPORT=stdio`，否则它会去占用 3000 端口的 Streamable HTTP。

Codex 在用户配置 `~/.codex/config.toml` 的 `[mcp_servers.prts]` 中登记本地 stdio 命令。DSH 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 中用 **insert 补丁**新增一个 `mcp-prts` 条目，使用 `@deepseek-ai/dsh-mcp-client`，服务器名同为 `prts`。

补丁文件的语义是「按 `id` 覆盖已存在的条目」，不是「追加插件」：直接写 `- id: xxx / name: ...` 只会去改一个已经由 bundle 提供的条目，找不到就静默跳过（stderr 打一行 `patch: entry "xxx" not found`，界面上看不到）。新增插件必须用 `insert`：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: mcp-prts
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: prts
        transport: stdio
        command: '<工具目录>\prts-mcp-3.1.2\bin\prts-mcp.exe'
        args: []
        env:
          PRTS_TRANSPORT: stdio
          PRTS_MCP_CACHE_DIR: '<工具目录>\mcp-runtime\prts-mcp'
```

`@deepseek-ai/dsh-mcp-client` 没有声明 `dsh.bundle`，因此不能写进 `package.json` 的 `dsh.profile.bundles`；`insert` 是唯一的登记方式。改完 patch 后配置会热重载，客户端会自行拉起 `prts-mcp.exe`（可用 `Get-Process prts-mcp` 的父进程确认是 `DeepSeek Harness.exe`）。

```toml
# ~/.codex/config.toml
[mcp_servers.prts]
args = []
command = '<工具目录>\prts-mcp-3.1.2\bin\prts-mcp.exe'
startup_timeout_sec = 90

[mcp_servers.prts.env]
PRTS_TRANSPORT = "stdio"
PRTS_MCP_CACHE_DIR = '<工具目录>\mcp-runtime\prts-mcp'
```

两个客户端分别按需启动 stdio 子进程，不绑定 HTTP 端口。使用 JSON 数据后端与发行包内置备用数据；启动时检查数据更新，不做周期轮询。立绘保留按需联网获取模式，不同步全量图片包。服务器缓存目录通过子进程环境指定，不改变系统环境变量。

## 查询入口

PRTS-MCP 3.1.2 共 24 个工具。DSH 与 Codex 都按 `<服务器名>__<工具名>` 暴露，因此模型看到的名字是 `mcp__prts__get_enemy_info`（Codex 同形）；下表写裸工具名，加前缀才是可调用的名字。

| 问题 | 工具与实参 |
|---|---|
| 干员基本资料、可见天赋 | `get_operator_basic_info(name, action="basic")` |
| 技能各等级和专精效果 | `get_operator_basic_info(name, action="skills")` |
| 指定精英阶段、等级的属性 | `get_operator_basic_info(name, action="stats", phase=…, level=…)` |
| PRTS 词条与备注 | `search_prts(query)`、`prts_page(page_title, action)` |
| 敌人基础资料或关卡属性 | `get_enemy_info(name, stage_id?)`、`get_stage_enemies(stage_id)` |
| 关卡详情 | `get_stage_info(stage_id)` |
| 精二立绘、时装与图片变体 | `operator_artwork(operator_name, action)` |
| 跨表按名检索 | `search(scope, pattern)`，`scope` 取 operators／enemies／stages／items／building_skills／skills |

实参形态（3.1.2 实测，写错会直接回 `Input validation error`）：

- `get_enemy_info` 的第一个参数叫 `name`，不是 `enemy_id`；中文名可用，例如 `name="游击队传令兵组长"`，返回里带 `enemy_1080_sotidp_2` 这样的 ID。
- `prts_page` 的 `action` 是必填，取 `read`／`sections`／`categories`／`links`／`template`；查「备注」先 `action="sections"` 拿小节号，再按需 `read`。
- `operator_artwork` 的 `action` 是必填，取 `list`／`get`。
- `search_prts` 用于 Wiki 全文/标题检索，`search` 用于结构化表按名匹配，两者不能互相替代。

干员名称、阶段、等级、技能、潜能与模组必须对应本次实现的配装；不同星级的满级上限不能一律写成 90。召唤物的部署、朝向、退场与冷却规则仍查召唤物及主人页面的备注。当前会话尚未加载 MCP 时可直接使用对应网页和 Release。

## 已验证范围与限制

- 本机探测（3.1.2，stdio）握手成功，`serverInfo` 为 `PRTS_Wiki_Assistant 3.1.2`，`tools/list` 返回 24 个工具；`get_enemy_info`、`get_operator_basic_info`、`prts_page(action="sections")` 均返回正文。
- **集成战略关卡不在结构化关卡表里。** `list_stages` 的 `type` 只有 MAIN／ACTIVITY／SUB／DAILY／CAMPAIGN／CLIMB_TOWER／SPECIAL_STORY／GUIDE，共 3643 关；`get_stage_info("ro6_e_3_7")` 与 `search(scope="stages", pattern="圆石技艺")` 都查不到 ISW-NO 圆石技艺。ISW 关卡改走 `prts_page(page_title="ISW-NO 圆石技艺")` 与该关的 `level_rogue6_3-7.json`（`zh_CN/gamedata/levels/obt/roguelike/ro6/`）。
- 安装包本身（84 MB 的 `prts-mcp-3.1.2-windows-x64.zip`）与运行缓存都在 `.cache/` 下，均已忽略，不进 Git。
- 两处配置都在客户端**下一次加载**时生效；本会话的 DSH 进程已启动，工具不会在本轮出现。

仓库代码按其 MIT 许可使用；Wiki 文本、游戏数据和美术仍按各自授权使用，见两个仓库的 `NOTICE`。立绘数据不包含对全部 Spine、技能特效与音频的完整替代。
