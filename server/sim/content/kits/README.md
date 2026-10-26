# SI 干员机制

本目录保存共享战斗引擎使用的kit。SI的自设数据在`content/operators/`，普通属性、技能黑板、天赋与素材引用通过`tools/build-content.mjs`生成；复杂行为由本目录`ops/`中的kit实现。

| 自设干员 | 机制文件 | 登记方式 |
|---|---|---|
| 塔露拉 | `ops/chess_char_5_99-talula.js` | `CUSTOM_TIER_KITS`，按棋子标识。 |
| 维娜·维多利亚 | `ops/op-vina.js` | `CUSTOM_OPERATOR_KITS`，按角色标识。 |
| 结城理 | `ops/op-custommakoto.js` | `CUSTOM_OPERATOR_KITS`，按角色标识。 |

`custom-catalog.js`由`tools/build-content.mjs`生成，`index.js`合并上游与自设登记表。不要手改生成登记表。沙盒可用名单来自`public/studio/js/sandbox/roster.js`，与kit登记是不同职责。

kit工厂接收`(bb, chess, def)`并返回技能、天赋、特性和安装逻辑。按棋子登记的默认导出使用棋子标识作为键，自选干员的默认导出使用角色标识作为键；新增实现沿用相应现有文件的接口。先读取所调用的helper，`shared/tier*.js`中的同名函数不保证参数相同。

战斗模块同时供浏览器和Node使用，保持原生ES Module，不加入DOM或Node专属API。战斗随机数使用引擎随机源；属性增益、伤害倍率、元素损伤和元素伤害使用各自已有接口。数值读取本地定义和黑板，不在多处重新登记。

专属视觉放在`public/js/render/fx/`并由`custom.js`接入。SI通过战斗flags和技能黑板适配沙盒行为，不把SI操作同步到SP。

模块位置见`docs/ARCHITECTURE.md`。代码任务不自行增加测试或运行验证，启动排错须按用户授权范围进行。
