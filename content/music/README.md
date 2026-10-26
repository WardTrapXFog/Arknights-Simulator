# 作战音乐

本目录仅将 `.ogg` 文件随源码分发。使用 Git 克隆或下载 GitHub 源码 ZIP，即可获得随仓库提供的 OGG 音乐，无需另行下载。

`.mp3` 及其他源文件仅保留在本地，不提交 Git，也不能通过服务端 `/music/` 获取。关卡编辑器的音乐列表与局外音乐接口只列出 OGG。新增曲目需先转换为 OGG；循环标记由 `tools/music-loop.mjs` 写入。

原始音频放在 `original/`，整个目录不入库、不提供下载，包括其中的 OGG。同一首的分段命名为 `曲名_intro.mp3` 与 `曲名_loop.mp3`，也支持 WAV、FLAC 等音频；文件名前的数字序号不参与配对。例如 `840. m_sys_void_intro.mp3` 与 `841. m_sys_void_loop.mp3` 对应《生命流》。

运行 `node tools/music-loop.mjs` 自动配对并合成到本目录：完整 intro 播放一次，随后完整 loop 无限循环。不重新裁剪或淡化分段，OGG 内只存一份 intro 和一份 loop，通过 `LOOPSTART`、`LOOPLENGTH` 和 `LOOPSAMPLERATE` 标记循环范围，无需制作超长重复音频。

音频版权归各自权利人所有，不适用代码的 GPL 许可证。文件名保留曲名与作者署名，仅用于本项目的个人非商业体验。
