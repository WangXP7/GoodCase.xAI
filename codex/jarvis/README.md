# JARVIS · Windows 动态视觉原型

[在线展示](https://wangxp7.github.io/GoodCase.xAI/codex/jarvis/) · [Windows 下载](https://github.com/WangXP7/GoodCase.xAI/releases/tag/jarvis-v0.3.0)

可执行版 v0.3.0，项目记录 v0.3.1。Windows x64 自包含动态视觉原型。

制作工具与已核实模型：Codex + GPT-5.6 Sol / GPT-6.1 Sol。模型依据为本地原始会话日志中的 turn_context.model 字段，未推测其他模型。

- 四种模式：Orbital Core、Command Deck、Ghost Overlay、Tactical Focus。
- 波浪核心、动态声纹、六态循环、本地模拟命令、独立置顶悬浮窗。
- 当前为模拟数据，尚未连接 AI、天气、语音或 Windows 操作执行器。
- 下载 ZIP 并完整解压，运行 Jarvis.VisualPrototype.exe；不要单独复制 EXE。

## 构建

安装 .NET 10 SDK，在 source 目录执行：

```powershell
dotnet restore Jarvis.VisualPrototype.csproj -p:Platform=x64
dotnet build Jarvis.VisualPrototype.csproj -c Release -p:Platform=x64 --no-restore
```

Windows 自包含 Release 输出包含运行依赖、XBF 和 PRI，必须保留完整目录。build 中脚本保留原工作区路径，换电脑时需先调整项目根目录。

## 目录

- index.html：兼容 GitHub Pages 的案例展示页。
- screenshots/：五张真实 EXE 运行截图。
- source/：WinUI 3 源码和应用资源，不含 bin/obj/SDK。
- design/：四张最终概念图和对比总览图。
- qa/：自动冒烟测试结果。
- JARVIS_PROJECT.md：版本化主记录、计划和验收报告。

Windows 二进制通过 GitHub Releases 分发，避免把运行依赖加入源码仓库。没有克隆、拉取或在本地保存原仓库内容。
