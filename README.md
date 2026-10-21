# GoodCase.xAI

**AI 编程好案例画廊** —— 同一套工作环境下，由 AI Agent 独立完成的成品案例集。

在线浏览：**https://wangxp7.github.io/GoodCase.xAI/**

## 收录内容

按产出时使用的 AI 工具命名空间分组：

| 命名空间 | 内容 |
|---|---|
| `zcode/` | ZCode 产出：WebGL/GLSL 3D 场景、霓虹小游戏、鹈鹕骑车 SVG 系列、密室 3D 游戏、诺奖化学科普交互页、星际水族箱、后室游戏等 |
| `workbuddy/` | WorkBuddy 产出：Minecraft 克隆（零依赖单文件 WebGL2，全程序化生成）、Buckshot Roulette 网页复刻、Eaves 数值沙盘、Tideline 潮汐游戏、tidewater-fish 网页版、火箭发射模拟（含完整 GDD 设计文档工程）、Token 消耗看板、断裂桥梁列车坠水物理仿真（XPBD 桁架渐进坍塌 + 浮力进水沉没，零依赖单文件 Canvas）、NEXUS BREACH（MCP 驱动引擎的 Three.js 第一人称射击，AI 通过 19 个 MCP 工具在线生成关卡 / 调光照 / 自动试玩并截图回看，附 Hy4 preview 与 UE5 MCP 调研笔记）、月面运输 LUNAR CARGO（实时 3D 月球车货运任务：低重力驾驶、碰撞甩货与三站配送，Three.js r160 全程序化生成）；余烬深渊 Emberfall（Three.js 球形开放世界动作 RPG：可朝任意方向持续探索、四类生态区、四档装备掉落与区域霸主，Vite 构建产物）、贾维斯 J.A.R.V.I.S. 赛博朋克 HUD 控制台（零依赖单文件全屏科幻主控界面）、企鹅生存·冰原漂流挑战（Three.js 3D 生存小游戏，漂移浮冰间捕鱼与躲避海豹）、太阳系八大行星 3D 交互模型（9 页 Three.js 科普交互）、蛇人幸存者（俯视角纯割草 Roguelite：蛇人战士黑暗废墟 10 分钟生存，尾击/毒瓶/诅咒/召集四技能状态连锁，升级三选一与精英敌潮，单文件 + vendored Three.js r160）、复古胶片单反 1970s Film SLR（全程序化 bpy 建模的 35mm 单反：银顶黑皮机身、五棱镜铭牌、滚花对焦环与三层镜片组，Eevee 摄影棚出图，零外部模型 / 贴图 / HDRI，附 1280 行建模脚本与 .blend 工程）等 |
| `codex/` | Codex 产出：星门纪元深空放置游戏、MIMIC 潜色行动、AIR COURT Vision Pro 空间篮球挑战；Attention Residuals 注意力残差交互科普（逐层动画、权重调节、分块实验，单文件离线运行）；2066 决战世界杯（Three.js + Ammo.js + PixiJS，3D 五人制足球对战）；羊债必须清（3D 肥羊砸罐、磁吸拾币、账单构筑与在线游玩）；墨迹 Ink Trace V2（中日笔顺、毛笔提按、临摹与导出，单文件离线运行）；ASTRA 科幻飞船驾驶舱 HUD（飞行、导航、战术、工程四模式，雷达扫描、能源分配与跃迁模拟，离线可用）；MOMENT 即刻互动拍立得（WebGL2 三维机身、吐纸显影、胶片曝光调整与 PNG 导出）；Night Street 黄金时刻街景（纯代码程序化城市，MIT 开源参考复刻与 Pages 适配） |
| `trae/` | Trae 产出：AURORA-9 火箭入轨全流程模拟、GLSL 霓虹轨道海报 |

每个案例目录内含可独立运行的 `index.html`（直接打开即用）与相应的设计文档 / 源码 / 测试脚本。

## 结构

```
index.html            ← 画廊首页(自动生成, 63 个案例入口)
gallery.json          ← 画廊条目清单：标题 / 描述 / Agent + 模型
tools/build_gallery.py← 生成器：gallery.json + 目录结构 → 重写 index.html
trae/  workbuddy/  zcode/  codex/
```

案例持续补充中。所有页面均为纯静态实现，可直接在浏览器中运行。

## 新增案例

1. 建目录 `<命名空间>/<案例名>/`，放入 `index.html` 与 `README.md`
   （README 首行为 `# 中文标题`，紧跟一行 `> **Agent + 模型**`）。
2. 在 `gallery.json` 的 `entries` 里登记一条，可人工润色 `title` / `desc` / `agent`。
3. 运行 `python tools/build_gallery.py`。

案例总数、命名空间计数、卡片排序、卡片缩进与 `.ns` 标签格式全部由脚本负责，不需要手改，
因此不会再出现计数漂移。提交前可用 `python tools/build_gallery.py --check` 校验 `index.html`
是否与清单同步（不一致时退出码为 1）。

磁盘上存在、但没登记到 `gallery.json` 的案例目录，脚本**只列出提醒、不会自动上架**
——画廊是策展，发布应当是明确动作。想先看自动推导的效果可以加 `--with-discovery`：
它会读该案例 README 的首行标题和 `> **Agent + 模型**`，推导出卡片一并写入。

两个约定：

- `.ns` 标签统一写成 `Agent + 模型`（例如 `WorkBuddy + DeepSeek-V4.1-Flash`），
  不再附带命名空间目录名——命名空间已由分组顺序体现，重复书写只会让标签变长。
- 卡片按目录名不区分大小写排序；命名空间根目录下的独立文件按文件名排序。
  个别需要钉住位置的条目可在 `gallery.json` 里加 `"sort": "..."` 覆盖排序键。

> `zcode/gen_gallery.py` 是某个 ZCode 案例自带的、面向另一个仓库的脚本，与本仓库画廊无关，
> 请勿与 `tools/build_gallery.py` 混淆。


## JARVIS · Windows 动态视觉原型

[站点展示](https://wangxp7.github.io/GoodCase.xAI/codex/jarvis/) · [Windows 下载](https://github.com/WangXP7/GoodCase.xAI/releases/tag/jarvis-v0.3.0) · [源码](codex/jarvis/source/)

WinUI 3 原生 Windows 程序，包含四种模式、波浪核心、动态声纹和独立悬浮窗。站点提供真实运行截图；桌面程序需下载并完整解压 Windows ZIP。当前对话和遥测为本地模拟数据。


## 五款中文文字模拟游戏

| 案例 | 制作工具与模型 | 在线入口 |
|---|---|---|
| 汉末青云 | Codex + GPT-6 Astra | [开始游玩](codex/hanmo-qingyun/index.html) |
| 面壁计划 | Codex + GPT-6 Astra | [开始游玩](codex/wallfacer-plan/index.html) |
| MB围城 | Codex + GPT-6 Astra | [开始游玩](codex/mb-enclosure/index.html) |
| 红河青云 | Codex + GPT-6 Astra | [开始游玩](codex/honghe-qingyun/index.html) |
| 晚明县志 V0.1 | Codex + GPT-6 Astra | [开始游玩](codex/wanming-xianzhi/index.html) |

以上模型取自原始制作会话记录。页面可直接在线运行，也可保存单HTML离线使用；本次仅追加案例及必要的画廊入口，保留已有项目。


## 三国人物关系图 · 国风鎏金长卷

[在线查看](codex/three-kingdoms-gilded/index.html) · Codex + GPT-5 / GPT-6

514位人物、562条关系，国风鎏金人物长卷；支持搜索、关系详情、阵营跳转、缩放及高清图下载。


## 画廊界面与分类统计

首页提供主题、Agent、大模型、Agent + 大模型和打开方式五个维度，支持交叉筛选、搜索与排序。主题和模型是多标签统计，分项之和不必等于总案例数；页面提供完整核对表。

从画廊进入案例会显示左下角返回主页入口；Markdown 使用统一阅读页。维护方式见 [画廊展示层说明](tools/gallery-ui.md)。
