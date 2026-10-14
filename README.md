# GoodCase.xAI

**AI 编程好案例画廊** —— 同一套工作环境下，由 AI Agent 独立完成的成品案例集。

在线浏览：**https://wangxp7.github.io/GoodCase.xAI/**

## 收录内容

按产出时使用的 AI 工具命名空间分组：

| 命名空间 | 内容 |
|---|---|
| `zcode/` | ZCode 产出：WebGL/GLSL 3D 场景、霓虹小游戏、鹈鹕骑车 SVG 系列、密室 3D 游戏、诺奖化学科普交互页、星际水族箱、后室游戏等 |
| `workbuddy/` | WorkBuddy 产出：Minecraft 克隆（零依赖单文件 WebGL2，全程序化生成）、Buckshot Roulette 网页复刻、Eaves 数值沙盘、Tideline 潮汐游戏、tidewater-fish 网页版、火箭发射模拟（含完整 GDD 设计文档工程）、Token 消耗看板、断裂桥梁列车坠水物理仿真（XPBD 桁架渐进坍塌 + 浮力进水沉没，零依赖单文件 Canvas）、NEXUS BREACH（MCP 驱动引擎的 Three.js 第一人称射击，AI 通过 19 个 MCP 工具在线生成关卡 / 调光照 / 自动试玩并截图回看，附 Hy4 preview 与 UE5 MCP 调研笔记）、月面运输 LUNAR CARGO（实时 3D 月球车货运任务：低重力驾驶、碰撞甩货与三站配送，Three.js r160 全程序化生成）等 |
| `codex/` | Codex 产出：星门纪元深空放置游戏、MIMIC 潜色行动、AIR COURT Vision Pro 空间篮球挑战；Attention Residuals 注意力残差交互科普（逐层动画、权重调节、分块实验，单文件离线运行）；2066 决战世界杯（Three.js + Ammo.js + PixiJS，3D 五人制足球对战）；羊债必须清（3D 肥羊砸罐、磁吸拾币、账单构筑与在线游玩）；墨迹 Ink Trace V2（中日笔顺、毛笔提按、临摹与导出，单文件离线运行）；ASTRA 科幻飞船驾驶舱 HUD（飞行、导航、战术、工程四模式，雷达扫描、能源分配与跃迁模拟，离线可用）；MOMENT 即刻互动拍立得（WebGL2 三维机身、吐纸显影、胶片曝光调整与 PNG 导出） |
| `trae/` | Trae 产出：AURORA-9 火箭入轨全流程模拟、GLSL 霓虹轨道海报 |

每个案例目录内含可独立运行的 `index.html`（直接打开即用）与相应的设计文档 / 源码 / 测试脚本。

## 结构

```
index.html            ← 画廊首页(自动生成, 43 个案例入口)
codex/  zcode/  workbuddy/  trae/  codex/
```

案例持续补充中。所有页面均为纯静态实现，可直接在浏览器中运行。
