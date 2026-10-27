# 素材下载

`npm run assets` 使用本目录的 `catalog.json` 生成下载计划，并结合 `data/` 中的当前干员、敌人、召唤物与模组补充条目。`fetch-assets.mjs` 负责下载、整理 Spine 与生成 `data/assets.json`，写入前通过 `build-content.mjs` 的共用素材合并函数恢复 `content/` 中的自设立绘、模型、图标与音频配置；下载后的图片、模型、音频位于 `public/assets/`。

下载入口默认使用 `sources.mjs` 的 `DEFAULT_ASSET_SOURCE`（`mirror`），可映射的 GitHub 仓库文件优先使用 [jsDelivr CDN](https://www.jsdelivr.com/documentation)，再尝试原始源；CDN 连续失败时本次运行停用 CDN。语音分支及 GitHub Release 地址使用原始源，并遵守现有的 `HTTP_PROXY`／`HTTPS_PROXY` 配置和 Node 版本要求。没有内置的通用 GitHub 转发代理；`SP_GITHUB_PROXY` 仅供用户自行指定 HTTPS 转发前缀。`--asset-source=direct` 改为原始源优先，保留 CDN 回退并禁用转发代理；`SP_ASSET_SOURCE` 可修改默认策略，命令行选项优先于环境变量。

中断后重新执行会复用符合校验条件的完整文件与已有索引缓存。下载器在取得完整文件后才写入正式路径，不保存网络传输中的部分内容，未完成的单个文件需重新下载；完整立绘也以单张图片为保存单位。

`catalog.json` 保存公开源地址、已知文件大小、技能索引、召唤物归属、敌人素材标识与首领音乐关联。`source` 记录清单依据的来源和日期；音频银行、语音与敌人模型的上游索引由下载脚本在线获取并缓存在 `.cache/`，后续重复执行会复用缓存。新增角色可由运行数据补充；已有条目的下载地址、默认技能顺序和素材关联在清单中维护。

`illustrations.mjs` 按 `art/operator-illustrations.json` 的来源版本、文件名和 SHA-256 下载完整立绘，目标地址取自 `public/sandbox/js/generated-illustrations.js`。索引来自 [AKDP 图片发布包](https://github.com/3aKHP/arknights-data-pipeline/releases)，通过 HTTP Range 读取 ZIP 目录及所需图片，下载源须支持范围请求。已有图片校验一致时复用；失败项写入素材报告，重新执行素材命令可补全。

`local-enemy-spines.json` 与 `local-token-spines.json` 是可选本地模型的元数据，下载计划可在没有本地模型文件时使用这些元数据。`public/assets/custom/` 中随源码提供的素材以及 `public/assets/local/` 中的本地素材不属于下载器清理范围，`--prune` 会保留这两个目录。
