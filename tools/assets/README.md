# 素材下载

`npm run assets` 使用本目录的 `catalog.json` 生成下载计划，并结合 `data/` 中的当前干员、敌人、召唤物与模组补充条目。`fetch-assets.mjs` 负责下载、整理 Spine 与生成 `data/assets.json`，写入前通过 `build-content.mjs` 的共用素材合并函数恢复 `content/` 中的自设立绘、模型、图标与音频配置；下载后的图片、模型、音频位于 `public/assets/`。

下载入口默认使用 `sources.mjs` 的 `DEFAULT_ASSET_SOURCE`（`mirror`），GitHub 请求优先使用 `DEFAULT_GITHUB_PROXY`（`https://gh-proxy.com/`）。连续失败会停用本次运行的镜像，再尝试原始源及可用的 jsDelivr 地址。`--asset-source=direct` 可禁用 GitHub 镜像；`SP_ASSET_SOURCE` 可修改默认策略，`SP_GITHUB_PROXY` 可指定镜像前缀，空前缀表示禁用。命令行选项优先于环境变量。

中断后重新执行会复用符合校验条件的完整文件与已有索引缓存。下载器在取得完整文件后才写入正式路径，不保存网络传输中的部分内容，未完成的单个文件需重新下载；完整立绘也以单张图片为保存单位。

`catalog.json` 保存公开源地址、已知文件大小、技能索引、召唤物归属、敌人素材标识与首领音乐关联。`source` 记录清单依据的来源和日期；音频银行、语音与敌人模型的上游索引由下载脚本在线获取并缓存在 `.cache/`，后续重复执行会复用缓存。新增角色可由运行数据补充；已有条目的下载地址、默认技能顺序和素材关联在清单中维护。

`illustrations.mjs` 按 `art/operator-illustrations.json` 的来源版本、文件名和 SHA-256 下载完整立绘，目标地址取自 `public/sandbox/js/generated-illustrations.js`。索引来自 [AKDP 图片发布包](https://github.com/3aKHP/arknights-data-pipeline/releases)，通过 HTTP Range 读取 ZIP 目录及所需图片，下载源须支持范围请求。已有图片校验一致时复用；失败项写入素材报告，重新执行素材命令可补全。

`local-enemy-spines.json` 与 `local-token-spines.json` 是可选本地模型的元数据，下载计划可在没有本地模型文件时使用这些元数据。`public/assets/custom/` 中随源码提供的素材以及 `public/assets/local/` 中的本地素材不属于下载器清理范围，`--prune` 会保留这两个目录。
