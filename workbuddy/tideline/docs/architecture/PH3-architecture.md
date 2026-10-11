# 《潮线 TIDELINE》· 技术架构文档

| 项 | 内容 |
|---|---|
| **文档编号** | PH3-ARCH-001 |
| **阶段** | Phase 3 · 技术搭建（**提前并行启动**） |
| **作者** | 程基岩（Cheng Jiyan）· 技术负责人 / 工程主管 |
| **版本** | v1.0 |
| **状态** | 已提议（Proposed）· 待主理人 / 用户 / 林绘澄 / 文策渊会签 |
| **上游** | `PHASE1-SUMMARY.md`<br>`design/archive/tideline/PH1-concept-doc.md`<br>`design/archive/tideline/PH1-art-bible.md` v1.4<br>`design/gdd/PH1-R1-numerical-sandbox.md` |
| **配套** | `ADR/ADR-001`～`ADR-006`、`PH3-blocking-resolutions.md` |

> ⚠️ **文档路径勘误（重要）**：主理人派单给出的路径 `design/gdd/PH1-concept-doc.md` 与 `design/art-bible/PH1-art-bible.md` **指向的是另一个项目《檐下 · UNDER THE EAVES》**（3D 高模等距养猫游戏）。《潮线》的真实文档位于 `design/archive/tideline/` 下的同名文件。**本架构文档全部基于 `design/archive/tideline/` 的 v1.4 美术圣经与概念文档。** 请团队后续引用时统一使用归档路径，或把 《檐下》 文件移出 `design/` 根目录以免持续误引。

---

## 1. 结论先行

### 1.1 六项阻塞项裁决一览

| # | 阻塞项 | 裁决 | 详 |
|---|---|---|---|
| 1 | 基准分辨率 | ✅ **采纳 1440×864**，并补出 **ART_SCALE = 2（艺术网格 720×432）** | §5 / ADR-002 |
| 2 | 渲染方案 | ✅ **WebGL2 + 自研薄渲染层**，否决 Canvas2D；**HUD/菜单走 DOM** | §6 / ADR-001 |
| 3 | 搁浅碰撞与沙滩边界 | ✅ 四层水体由**海床剖面导出的水深**定义；三段式搁浅状态机（含新增预警态） | §10 / ADR-003 |
| 4 | 抖动图案 | ✅ **Bayer 8×8 + GPU 片元着色器**，屏幕锚定于艺术网格（**不预烘焙贴片**） | §11 / ADR-004 |
| 5 | 呼吸式脉动 | ✅ 单一 `breath()` 时间函数 + **CI + lint + 运行时审计**三重强制 + **相位错开** | §11 / ADR-004 |
| 6 | 中央特效调度器 | ✅ **三段式管线**（准入 → 互斥仲裁 → 降级补偿）+ **192 例正交性自动化测试** | §12 / ADR-004 |

### 1.2 我主动增加的两条 ADR

| ADR | 内容 | 为什么必须现在定 |
|---|---|---|
| **ADR-005** | 索引色纹理 + 调色板 LUT | 决定 ADR-001 能否兑现价值。不做它，色闪与色盲模式会变成**两套需手工同步的资产** |
| **ADR-006** | 无物理引擎 + 固定步长 + 确定性 + 无后端持久化 | 解决 §9.6「渲染插值」与 §6.7「禁止亚像素插值」的**直接冲突** |

### 1.3 三句最重要的判断

1. **本作的视觉身份就是渲染器。** 硬边像素、有序抖动、整屏调色板切换——三件最独特的事全是渲染层行为。放弃渲染层控制权等于放弃视觉身份控制权。这是选 WebGL 自研而非引擎的根本理由。
2. **安全红线不能依赖人去记。** §9.9.5 的验收清单里"代码搜索 `Math.sin(2 * Math.PI * f` 核验 f 值"是一条**人工**检查。我把 2Hz 上限、禁用硬 on/off、5 开关正交不死区**全部变成 CI 里的自动化断言**（192 例测试）。
3. **`p_beach` 不应是一个概率。** R1 沙盘里的"搁浅风险 0.15→0.03"在本架构下是三个**可观测、可调、可练**的旋钮。这把沙盘里的一个抽象参数变成了真实的技巧轴（ADR-003 §6.1）。

---

## 2. 技术栈选型

### 2.1 总表

| 层 | 选型 | 版本 | 体积（gzip） | 理由 |
|---|---|---|---|---|
| **语言** | **TypeScript** | 5.x, `strict: true` | — | 大型状态机 + 数据驱动配置，无类型是灾难 |
| **构建** | **Vite** | 5.x | — | 原生 ESM、HMR 快、配置简单、产物体积优 |
| **渲染** | **WebGL2 + 自研薄渲染层** | — | **~0**（自研计入业务） | ADR-001 |
| **UI** | **原生 DOM + CSS** | — | ~0 | ADR-001 §2.3 |
| **测试** | **Vitest** | 2.x | — | 与 Vite 同源，零额外配置 |
| **Lint** | **ESLint + typescript-eslint** | 8.x | — | 自定义规则承载安全红线（ADR-004） |
| **包管理** | **pnpm** | 9.x | — | 磁盘与安装速度 |
| **存档** | **localStorage** | — | — | 无后端（ADR-006） |
| **音频** | **Web Audio API**（薄封装） | — | ~0 | 接口层见 §14；音效资产归阮和鸣 |
| **目标** | ES2022 · 最近 2 个大版本浏览器 + iOS Safari 16+ | — | — | 不支持 IE / 老旧安卓 WebView |

### 2.2 明确**不**引入的东西

| 不引入 | 理由 |
|---|---|
| 物理引擎（Matter / Planck / Box2D） | ADR-006 §2.1 |
| 2D 引擎（PixiJS / Phaser / Kaplay） | ADR-001 §2.2（保留为 Spike 失败回退） |
| 状态管理库（Redux / Zustand） | §8：本作状态是一个 `World` + 一个场景状态机 + 一个 `RunState` 对象，引入库只会增加"绕过它"的诱惑 |
| ECS 框架（bitECS / miniplex） | 实体 ≤120、组件固定，手写稠密数组更快更可控。ECS 框架的收益在实体上千时才显现 |
| 补间库（GSAP / Tween.js） | §6.7 明确禁止位移缓动；剩余的缩放/旋转缓动是 20 行代码 |
| 任何运行时依赖 | 首屏 JS 预算 ≤250 KB，全部留给业务代码 |

### 2.3 首屏预算分配

| 项 | 预算 |
|---|---|
| 业务 JS（含自研渲染层） | ≤ 180 KB gzip |
| CSS | ≤ 15 KB gzip |
| HTML + 引导 | ≤ 5 KB gzip |
| 字体（Press Start 2P + Noto Sans SC 子集） | ≤ 110 KB |
| **首屏 JS+CSS 合计** | **≤ 200 KB gzip** |
| 图集（2 × 1024×1024 索引色 PNG-8） | ≤ 800 KB |
| **首屏总计** | **≤ 1.5 MB** |

---

## 3. 整体架构

### 3.1 分层与依赖方向

```
┌─────────────────────────────────────────────────────────────────┐
│ L4  App         引导装配 · 主循环 · 质量档自适应 · 遥测 · 屏幕流转 │
└───────────────────────────────┬─────────────────────────────────┘
                                │ 依赖 ↓
┌───────────────────────────────▼─────────────────────────────────┐
│ L3  Presentation  场景/图层 · 相机 · HUD(DOM) · 屏幕(Title/Pause │
│                   /Results/Options) · 质量档执行                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ 依赖 ↓
┌───────────────────────────────▼─────────────────────────────────┐
│ L2  Gameplay     移动 · ALARM/敌人AI · 捕食携带 · 冲浪COMBO       │
│                  · 经济升级 · 关卡/区域 · 碰撞 · 搁浅              │
└───────────────────────────────┬─────────────────────────────────┘
                                │ 依赖 ↓
┌───────────────────────────────▼─────────────────────────────────┐
│ L1  Core         渲染器 · 输入 · 音频总线 · 资源加载 · 调色板LUT   │
│                  · FX Dispatcher · breath() · 时钟 · 对象池 · RNG │
└───────────────────────────────┬─────────────────────────────────┘
                                │ 依赖 ↓
┌───────────────────────────────▼─────────────────────────────────┐
│ L0  Foundation   数学 · 事件总线 · 日志 · 常量 · 存档 · 平台探测   │
└─────────────────────────────────────────────────────────────────┘
```

**依赖铁律**：

1. **只能向下依赖。** L2 不得 import L3；L1 不得 import L2。
2. **跨层通信只有两条路**：向下用接口调用，向上用**事件总线**。
3. **gameplay（L2）禁止直接触发任何屏幕级特效**，只能发领域事件给 FX Dispatcher（ADR-004 §6.6）。
4. **渲染层（L1）不知道"鲨鱼"是什么**，它只认识精灵、批、图层。

> 第 4 条由 lint 强制：`src/core/render/**` 中禁止出现 `shark` / `alarm` / `combo` 等业务词。

### 3.2 目录结构（预览，Phase 3 实现阶段落地）

```
src/
  core/                     L1
    render/                 渲染器（WebGL2 薄封装）
      gl-context.ts         上下文 + 丢失恢复
      batcher.ts            四边形批处理器
      pipeline.ts           双 RT 管线 + CRT 后期
      shaders/              sprite / dither / crt / dither-tex
      constants.ts          DESIGN_W/H · ART_SCALE · RT 尺寸
    fx/                     FX Dispatcher
      dispatcher.ts         三段式管线
      fx-table.ts           数据驱动特效表
      compensation.ts       补偿表
      audit.ts              开发期审计
    anim/
      breath.ts             唯一脉动时间源
      easing.ts             仅用于缩放/旋转/镜头
    input/                  输入源 → Intent
    audio/                  AudioBus（薄封装）
    palette/                索引色 LUT
    sim/                    ADR-006：固定步长、时钟、RNG、对象池
    assets/                 图集加载
  gameplay/                 L2
    shark/  alarm/  prey/  enemy/  surf/  economy/  level/
    collision/              层矩阵 + AABB + 扫掠
    stranding/              搁浅状态机（ADR-003）
  presentation/             L3
    camera.ts  scene/  hud/  screens/
  app/                      L4
    main.ts  loop.ts  quality.ts  telemetry.ts
  foundation/               L0
tools/
  build-atlas.mjs           索引色图集构建（ADR-005）
  check-palette.mjs         配色纪律门禁（ADR-005）
tests/
  fx-dispatcher.orthogonality.test.ts   192 例
  stranding.test.ts  breath.test.ts  determinism.test.ts
```

---

## 4. 主循环

```ts
// src/app/loop.ts
function frame(now: number) {
  // ① 时间推进（含顿帧 timeScale）
  let frameTime = Math.min((now - last) / 1000, MAX_FRAME_TIME);
  accumulator += frameTime * clock.timeScale;

  // ② 固定步长逻辑（确定性）——ADR-006
  while (accumulator >= FIXED_DT) {
    input.poll();              // 输入采集：顿帧期间照常，不丢失
    world.step(FIXED_DT);      // 所有 gameplay 系统
    accumulator -= FIXED_DT;
  }

  // ③ FX 求值（每渲染帧一次，不每逻辑帧）
  fxDispatcher.evaluate();

  // ④ 渲染
  renderer.render(world, camera, alpha);

  // ⑤ 质量档自适应（滑动窗口）
  quality.sample(frameTime);

  requestAnimationFrame(frame);
}
```

**执行顺序是有意为之**：输入 → 逻辑 → FX → 渲染 → 自适应。FX 在渲染前最后一刻求值，保证"同帧内多个事件"能被一次性仲裁（ADR-004 §6.3 的抢占规则依赖这一点）。

---

## 5. 坐标系统与分辨率

> 完整推导见 **ADR-002**。本节只列实现者需要记住的结论。

### 5.1 三层空间

| 空间 | 尺寸 | 单位 | 用途 |
|---|---|---|---|
| **DESIGN** | 1440 × 864 | 设计 px | 所有设计数值、物理量、布局的唯一坐标空间 |
| **ART GRID** | 720 × 432 | 艺术 px | 精灵/粒子/UI 的绘制网格；`ART_SCALE = 2` |
| **COMPOSITE** | 1440 × 864 | 设计 px | CRT 后期与真 alpha 层（暗角/遮罩） |

### 5.2 必须记住的五条

1. `snapArt(v) = Math.round(v / 2) * 2` —— 所有**位置**在渲染前吸附（§6.7 硬约束）。
2. **扫描线在 ART GRID 上绘制**，永远不参与非整数缩放 → 永久免疫摩尔纹。
3. **降级时绝不改变 ART_SCALE**，只改变 CRT 档位、DPR 上限、粒子预算（ADR-002 §2.5）。
4. 1440×864 是**精确 5:3**。16:9 屏幕必有左右黑边（1080p 下各 60px）。**美术按 5:3 构图。**
5. `PX_PER_M = 32`：巡游 6 m/s = 192 设计 px/s；冲刺 14 m/s = 448 设计 px/s。

```ts
// src/core/render/constants.ts —— 唯一真源
export const DESIGN_W   = 1440, DESIGN_H = 864;
export const ART_SCALE  = 2;
export const RT_WORLD_W = 720,  RT_WORLD_H = 432;
export const SAFE_MARGIN = 48;              // §9.4 安全区
export const WATER_BASE_Y = 105;            // 水面基准线（设计 px）
export const PX_PER_M   = 32;
export const snapArt    = (v: number) => Math.round(v / ART_SCALE) * ART_SCALE;
```

---

## 6. 渲染管线

> 选型论证见 **ADR-001**；索引色 LUT 见 **ADR-005**；抖动见 **ADR-004**。

### 6.1 双 RT 管线

```
┌─ RT_WORLD · 720×432（ART GRID，NEAREST）────────────────────┐
│ Pass 1  L1 天空层     视差 0.05   云 / 太阳(ALARM 指示)       │
│ Pass 2  L2 海面层     视差 0.15   波浪线 / 折射 / 水面杂物     │
│ Pass 3  L3 浅海层     视差 0.35   光柱 / 鱼群 / 珊瑚剪影       │
│ Pass 4  L4 主玩法层   视差 1.0    鲨鱼 / NPC / 敌人 / 收集物   │
│ Pass 5  粒子层                    ≤400，索引色 + 抖动 discard  │
│ Pass 6  L5 前景层     视差 1.6    气泡 / 漂浮颗粒              │
│ Pass 7  ★ CRT-A：扫描线 + 噪点                                │
│         └ 在 ART GRID 上做 → 锁死网格，永不产生摩尔纹           │
└────────────────────────────┬────────────────────────────────┘
                             │ ×2 整数 NEAREST 放大
┌─ RT_POST · 1440×864 ───────▼────────────────────────────────┐
│ Pass 8   真 alpha 层：暗角 / 遮罩 / 危险染红（唯一用真 alpha） │
│ Pass 9   ★ CRT-B：桶形弯曲 + 色差 + 荧光余晖                  │
│          └ 需连续坐标，必须在高分辨率做                        │
└────────────────────────────┬────────────────────────────────┘
                             │ fit + NEAREST + letterbox(#0A0E17)
                             ▼
                  Display（DPR 感知）
                             ▲
                  DOM 覆盖层（HUD / 屏幕）+ CSS 扫描线暗角层
```

**扫描线分在 PASS 7（ART GRID）而不是 PASS 9（COMPOSITE）** —— 这是整条管线里收益最高的一条几何决策，理由见 ADR-002 §2.4。

### 6.2 批处理器

| 项 | 规格 |
|---|---|
| 图元 | 纹理四边形（2 三角形 / 6 索引） |
| 顶点属性 | `position(vec2)` `uv(vec2)` `paletteIndex(float)` `density(float)` |
| 容量 | 预分配 **2048 个四边形**（顶点缓冲 2 MB，启动时一次性分配） |
| 分批条件 | ① 纹理不同 ② **混合模式不同** |
| 混合模式 | 只有 `NORMAL` 与 `ADD` 两种（§7.4）→ **同帧最多 2 个批** |
| 提交 | 每帧 1 次 `bufferSubData` + 1–2 次 `drawElements` |

**为什么同帧最多 2 个批**：§7.4 规定"光效类 ADD，粒子类 SOURCE_OVER"。只有两种混合模式，按桶排序后就是 2 个批。**这是"不引入引擎"仍能保持高性能的关键。**

### 6.3 绘制顺序与批合的冲突处理

§5.2 定义了 6 个视差层。**绝不能对精灵做逐个 z 排序**——那会把批合打碎成上百个 draw call。

**规则**：层（Layer）是**绘制桶**，不是排序键。

```
for (const layer of LAYERS)          // 固定顺序：L1→L2→L3→L4→粒子→L5
  for (const bucket of [NORMAL, ADD])
    batch.flush(layer, bucket);
```

层内不排序（同层精灵的相互遮挡由资产出图顺序与关卡摆放决定）。**若将来需要层内动态排序，必须显式引入"排序标记"，且只允许 ≤3 档（前/中/后），否则批合会退化。**

### 6.4 粒子系统

| 项 | 规格 |
|---|---|
| 存储 | **SoA 结构体数组**（`Float32Array` × N），非对象数组 |
| 容量 | 预分配 **512**（§9.3），启动时一次分配，**运行时零 `new`** |
| 回收 | 标记位 + 批量清理，**禁止 `splice`**（§9.3） |
| 形状 | 2–5 设计 px 硬边方块（**最小 1 艺术 px**，ADR-002 §2.3） |
| 淡出 | 抖动密度 `pow(life, 0.75)`，GPU discard（ADR-004） |
| 运动 | 位置每帧更新，渲染时 `snapArt` |
| 碰撞 | **不参与** |

### 6.5 上下文丢失恢复（P0）

移动端切后台会丢 WebGL 上下文，不处理就是黑屏。

- 监听 `webglcontextlost`（`preventDefault()`）与 `webglcontextrestored`
- 恢复流程：重建所有 GL 资源（着色器、纹理、RT、VBO）**从 CPU 侧数据重新上传**
- **资产 CPU 侧副本必须常驻内存**（索引图集的 `Uint8Array`），否则无法重建
- 测试：dev 面板提供"强制丢失上下文"按钮

---

## 7. 模块划分与依赖

### 7.1 Core（L1）模块清单

| 模块 | 职责 | 关键接口 |
|---|---|---|
| `render/gl-context` | 上下文、扩展探测、丢失恢复 | `GLContext` |
| `render/batcher` | 四边形批合 | `Batcher.push(quad)` / `.flush()` |
| `render/pipeline` | 双 RT、CRT 后期、质量档 | `Pipeline.render()` |
| `render/camera` | 视差、夹取、顿帧聚焦 | `Camera.worldToScreen()` |
| `palette/palette` | 索引色 LUT 管理 | `Palette.bind(name)` |
| `fx/dispatcher` | 三段式仲裁（ADR-004） | `FxDispatcher.request(id)` |
| `anim/breath` | 唯一脉动时间源 | `breath(spec, t)` |
| `input/*` | 输入源 → Intent | `InputSource` / `Intent` |
| `audio/bus` | 音频总线（薄封装） | `AudioBus.play(id, opts)` |
| `sim/clock` | 三种时间源 | `clock.scaled/unscaled/wall` |
| `sim/rng` | `mulberry32` 种子随机 | `rng.next()` |
| `sim/pool` | 对象池 | `Pool.acquire()/release()` |
| `assets/loader` | 图集 + JSON + 音频 | `Assets.load(manifest)` |

### 7.2 Gameplay（L2）系统清单与执行顺序

固定步长内**顺序执行**（顺序本身就是设计的一部分）：

| # | 系统 | 职责 | 依赖 |
|---|---|---|---|
| 1 | `InputSystem` | Intent → 鲨鱼控制量 | — |
| 2 | `MovementSystem` | 游动、冲刺、体力、S 波 | 1 |
| 3 | `ZoneSystem` | 区域归属（`ZONE_LUT` 查表）、冲浪模式、BANK | 2 |
| 4 | `StrandingSystem` | 搁浅状态机（ADR-003） | 2, 3 |
| 5 | `CollisionSystem` | 层矩阵 + AABB + 扫掠 | 2, 3 |
| 6 | `PreySystem` | 游客 AI、咬合判定、携带 | 5 |
| 7 | `AlarmSystem` | ALARM 增减、敌人分级生成 | 3, 6 |
| 8 | `EnemySystem` | 4 级敌人 AI（状态机 + 转向行为） | 5, 7 |
| 9 | `SurfSystem` | 收集、COMBO 窗口与倍率 | 3, 5 |
| 10 | `EconomySystem` | 双货币、结算 | 6, 9 |
| 11 | `EventFlush` | 把本帧领域事件推给 EventBus | all |

**`StrandingSystem` 排在 `CollisionSystem` 之前**：搁浅判定需要"本帧是否接触海床"，这个信息来自海床高度场查表（不依赖碰撞系统），且碰撞需要知道鲨鱼是否已搁浅以跳过部分检测。

### 7.3 关键接口（防止层间泄漏）

```ts
// gameplay 只认这个接口，不认 WebGL
export interface IRenderer {
  submit(quads: QuadView, layer: LayerId, blend: BlendMode): void;
  setCamera(x: number, y: number, zoom: number): void;
  setPalette(name: PaletteName): void;
  setPostParams(p: PostParams): void;   // 震屏/扫描线/CRT 参数
}

// gameplay 只认这个接口触发特效（ADR-004 §6.6）
export interface IFxSink {
  emit(event: DomainEvent): void;
}
```

---

## 8. 状态管理

### 8.1 四类状态，各自独立

| 状态 | 载体 | 生命周期 | 可变性 |
|---|---|---|---|
| **World**（实体与组件） | 稠密数组 + 位图 | 单局 | 仅 gameplay 系统可写 |
| **RunState**（本局数值） | 普通对象 | 单局 | 仅 gameplay 系统可写 |
| **AppState**（场景流转） | 显式状态机 | 应用 | 仅 App 层可迁移 |
| **Settings**（设置与进度） | 持久化 Store | 永久 | 仅 Options 屏幕可写 |

### 8.2 场景状态机

```
Boot → Preload → Title ⇄ Options
                   │
                   ▼
              Playing ⇄ Paused
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
    Beached    Results    (死亡)
     (子状态)        │
        └───────────┘
```

- **显式状态机，没有隐式全局标志。** 每个状态有 `enter/exit/update`，禁止散落 `if (isPaused)`。
- `Beached` 是 `Playing` 的**子状态**（不是独立场景）——因为搁浅时游戏世界仍在运行（游客围观、ALARM 飙升、太阳变脸）。

### 8.3 单向数据流

```
输入源 → Intent → gameplay 系统 → World/RunState → 渲染读取
                        │
                        └─→ 领域事件 → EventBus → FX Dispatcher / 音频 / 遥测
```

**铁律**：

1. **UI 只读 `RunState`，绝不持有、绝不修改游戏状态。**（角色规范：`ui` 不持有游戏状态）
2. 特效、音频、遥测**只订阅事件**，不轮询状态。
3. `Settings` 是唯一可被 UI 写入的状态，且写后立即持久化（ADR-006 §2.6）。

### 8.4 为什么不用状态管理库

本作的状态总量：约 120 个实体 × ~10 个字段 + 约 20 个本局数值 + 5 个设置。这是一个**中等对象的字段集合**，不是需要时间旅行调试的复杂应用。引入 Redux/Zustand 只会带来"该放 store 还是放局部"的无谓决策，以及订阅开销。

**真正需要的约束是"谁能写"，而不是"存在哪"**——这由分层规则（§3.1）与 lint 保证，库帮不上忙。

---

## 9. 输入处理

### 9.1 抽象：输入源 → Intent

```ts
export interface Intent {
  steer:   { x: number; y: number };  // −1..1，已归一化
  dash:    boolean;                   // 带 120ms 缓冲
  mash:    number;                    // 本帧有效连打次数（QTE 用）
  pause:   boolean;
}
```

| 输入源 | 转向 | 冲刺 | 挣脱（QTE） |
|---|---|---|---|
| **键盘** | WASD / 方向键 | `Space` | 连打 `Space` 或 `Enter` |
| **触屏** | 单指**相对拖拽** | 第二指点按 / 双指点按 | 任意位置连点 |
| **鼠标** | 按住拖拽 | 左键 | 左键连点 |

### 9.2 设计要点

| 要点 | 规格 |
|---|---|
| **鲨鱼永不停止** | 输入只控制"往哪"，不控制"走不走"（概念文档 §7.2：1.5 自由度） |
| **输入缓冲** | `dash` 120 ms —— 落地/出水前按下仍生效（标准手感处理） |
| **QTE 去抖** | 最小间隔 100 ms（ADR-003 §2.6），防连点器 |
| **零 hover 依赖** | 所有交互可点击完成（§7.2） |
| **排除键** | QTE 时 `Escape`/`P`/`M` 不计数，防误触退出 |
| **可重绑定** | 键盘映射可配置（可访问性） |
| **顿帧不吞输入** | 输入采集在 `timeScale=0` 期间照常（ADR-006 §2.5） |
| **触屏目标** | ≥ 44×44 px（§7.2） |
| **首次进入不请求权限** | 无地理位置、无通知、无相机（§7.2） |

### 9.3 移动端适配

| 项 | 处理 |
|---|---|
| 竖屏 | 不强制旋转（体验差），显示"建议横屏"提示条 + 可玩降级 |
| 5:3 在竖屏 | fit 极小 → 优先提示横屏 |
| 音频自动播放策略 | 浏览器要求用户手势 → **Title 页点击才能开始**，这是硬性约束，不能自动播放 |
| 上下文丢失 | 切后台 → `webglcontextlost` → 自动暂停 + 恢复重建（§6.5） |

---

## 10. 碰撞与搁浅

> 完整设计见 **ADR-003**。本节为实现摘要。

### 10.1 几何：从海床导出四层水体

```ts
waterDepth(x, t) = seabedY(x) − waterLineY(x, t)
```

| 区域 | 判据（用静态 `seabedY`） |
|---|---|
| DEEP | `depth ≥ 400` |
| SHALLOW | `120 ≤ depth < 400` |
| SURF | `0 < depth < 120` |
| BEACH | `depth ≤ 0` |

**区域归属用静态海床（稳定），接触判定用动态水面（可玩）。** 这个分离让"潮线"既是真实的物理边界，又不会让敌人在潮汐边界上反复生成/消失。

海床 = 9 点控制表 + Catmull-Rom，加载时烘焙为 `SEABED_LUT[]`（每 8 设计 px 一采样）+ `ZONE_LUT[]`（含 8 设计 px 迟滞）。

### 10.2 搁浅状态机

```ts
if (zone === BEACH && grounded && speed < V_TH) {
  strandProgress += dt * (1 - speed / V_TH);   // 越慢累积越快
} else if (zone === BEACH) {
  strandProgress -= dt * 2.0;
} else {
  strandProgress -= dt * 4.0;
}
strandProgress = clamp(strandProgress, 0, T_STRAND);   // T_STRAND = 1.2s
```

| 常量 | 值 |
|---|---|
| `V_TH` | 96 设计 px/s（3 m/s = 0.5× 巡游） |
| `T_STRAND` | 1.2 s |
| `T_WARN`（预警） | 0.72 s（60%） |
| QTE | 2.5 s / 6 次输入 / 最小间隔 100 ms / 无衰减 |
| QTE 期 ALARM | +8 /s |

**`STRAND_WARNING` 是我新增的状态**（ADR-003 §2.5）：在 60% 进度时给出拖沙 + 提示图标 + 音 sting，**并保留一个 0.48 s 的冲刺自救窗口**。这一条把搁浅从"随机惩罚"变成"可练的技巧"，并让 R1 沙盘的 `p_beach` 变成可建模的三个旋钮。

### 10.3 碰撞

- **AABB only**，旋转纯视觉（碰撞盒取旋转外接矩形）
- 7 个层 + 位掩码矩阵（ADR-003 §2.7）
- **扫掠 AABB 只用于 `L_SHARK` vs `L_WORLD`/`L_HAZARD`**（冲刺单帧 7.47 设计 px，对 1px 渔网必须扫掠）
- 宽阶段：暴力两两（n ≤ 120），不引入空间划分（过早优化）
- 粒子不参与碰撞

---

## 11. 抖动与呼吸式脉动

> 完整设计见 **ADR-004** 第一、二部分。

### 11.1 抖动

| 项 | 规格 |
|---|---|
| 矩阵 | **Bayer 8×8**（65 级密度，非 4×4 的 17 级） |
| 编码 | 8×8 单通道纹理（64 B），`NEAREST` + `REPEAT` |
| 实现 | **GPU 片元着色器** `discard`（不预烘焙贴片） |
| 锚定 | **屏幕空间**，除以 `ART_SCALE` 对齐艺术网格 |
| 密度 | `pow(lifeRatio, 0.75)`，作顶点属性传入，**不打断批合** |
| 适用 | 粒子、冲刺残影、光柱、水珠、泡沫线 |
| 不适用 | 暗角、遮罩（**低频平滑量**用抖动会显网格纹 → 保留真 alpha）、实体 sprite |

**为什么否定 §7.6 的"预生成 4–16 张贴片"**：那条要求在其预设的 Canvas2D 前提下正确。ADR-001 已改判为 WebGL2，GPU shader 严格满足其意图（零 CPU 逐像素开销），却在资产数（0 vs 17/272）、配色灵活性、密度分辨率（65 vs 17）上全面更优。**逃生舱（预烘焙 17 张）已设计就绪**，若 Spike 失败随时回退（ADR-004 §2.7）。

### 11.2 呼吸式脉动

```ts
export const BREATH_MAX_HZ = 2;      // 全项目唯一定义

export function breath(spec: BreathSpec, t: number): number {
  const hz = Math.min(spec.hz, BREATH_MAX_HZ);   // 硬 clamp，无法绕过
  if (opt.flash === false) return spec.hi;       // 开关关闭 → 常亮（信息保留）
  if (hz === 0) return spec.hi;                  // reduced-motion
  const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * hz * (t + phase));  // 升余弦
  return spec.lo + (spec.hi - spec.lo) * w;
}
```

| 要点 | 说明 |
|---|---|
| **波形** | 升余弦（不是 `sin`）——极值处导数为 0，读起来是"呼吸"不是"摆动" |
| **相位错开** | 4 个 channel 固定错开相位。**这是 §9.9 的缺口**：单元素 ≤2Hz 管不到"多元素同相位叠加成的全屏亮度摆动" |
| **亮度预算** | 开发期审计 `Σ(面积占比 × 调制幅度) ≤ 0.10` |
| **强制机制** | ① CI 静态检查 ② lint 规则 ③ 运行时审计 —— **三条缺一不可** |

### 11.3 使用点清单（至少 7 处，全部走 `breath()`）

QTE 圆环（§6.8.4）· ALARM 条（§6.1）· T4 威胁等级（§4.4）· 深海生物发光（§5.3.1）· 连打提示图标（§6.8.4）· 扫描线抖动（§6.6）· 张力预告（§5.4.3.1）

---

## 12. 中央特效调度器（FX Dispatcher）

> 完整设计见 **ADR-004** 第三部分。本节为架构位置与执行摘要。

### 12.1 为什么必须存在

§6.7（互斥）与 §9.9.1（五开关正交）是**两套都会阻断特效的规则**，分开放置必然产生死区：

> 玩家关闭「屏幕闪烁」→ 捕食事件 `{色闪 + 震屏 + 顿帧}`
> - 互斥规则：色闪优先级最高 → **震屏被丢弃**
> - 开关规则：**色闪不生效**
> - 结果：捕食只剩顿帧。而 §9.9.1 明确要求"不能出现无反馈的退化"。

### 12.2 三段式管线

```
Request → ① 准入（开关过滤 → 转补偿令牌）
        → ② 互斥仲裁（flash 30 > shake 20 > jitter 10；抢占时软停 2 帧）
        → ③ 降级补偿（查补偿表，递归深度 ≤2）
        → Active FX Set
```

| 集合 | 成员 |
|---|---|
| **参与互斥** | 色闪 / 震屏 / 扫描线抖动 |
| **不参与**（正交） | **顿帧**（时序层）· 缩放脉冲 · 粒子 · 飘字 · 音效 · HUD 状态 |

**顿帧白名单（受击绝不触发，§6.6 ③）由数据表达**：`hit.hitstop` **不存在于 `FX_TABLE` 中**。想加回来必须显式加一行并写理由。

### 12.3 补偿表（核心）

| 被阻断 | 一级补偿 | 二级补偿 |
|---|---|---|
| 震屏 | 顿帧 0.08s | 缩放脉冲 ×1.5 + 粒子 ×1.5 |
| 色闪 | 震屏（若可用） | 缩放脉冲 + 高对比常亮 |
| 扫描线抖动 | 扫描线保持静态 | HUD 边缘箭头 2Hz 呼吸 |
| CRT | 无（纯视觉降级） | — |
| 粒子 0% | 1px 硬边描边扩散环 | 缩放脉冲 |

### 12.4 正交性不变量（192 例自动化测试）

> 对 5 个开关的 **32 种组合** × **6 个核心事件**，每种组合下必须在 `{视觉, 时序, 音频, HUD}` 中产生 **≥1 个非零反馈**，且 **max Hz ≤ 2**。

**6 个核心事件**：`bite` · `hit` · `combo` · `rarePickup` · `beachLand` · `alarmEscalate`

一条测试同时守住 §6.7 互斥、§9.9.1 不死区、§9.9.2 的 2Hz 红线。

### 12.5 架构位置与强制

```
gameplay（L2）── 只发领域事件 ──▶ EventBus ──▶ FX Dispatcher（L1）
                                                    ├─▶ Renderer
                                                    ├─▶ Clock（顿帧）
                                                    ├─▶ Particles
                                                    └─▶ AudioBus
```

**Lint 硬约束**：`src/gameplay/**` 禁止 import 除 `fx/dispatcher` 外的任何特效模块。这是**结构性保证**——只要有一处游戏逻辑能直接调用 `screenShake()`，§6.7 就形同虚设。

---

## 13. 性能预算与降级档

### 13.1 帧预算（目标 60fps = 16.67 ms）

| 阶段 | 预算 | 说明 |
|---|---|---|
| 输入 + 逻辑（固定步长） | **≤ 4.0 ms** | ≤120 实体 + 搁浅/碰撞 |
| FX 求值 | ≤ 0.5 ms | 三段式管线 |
| 世界渲染（720×432，2 批） | **≤ 3.0 ms** | 填充率仅 311k 像素 |
| CRT 后期（1440×864） | **≤ 4.0 ms** | FULL 档：弯曲 + 色差 + 余晖 + 噪点 |
| DOM HUD 合成 | ≤ 1.5 ms | 仅数据变化时更新 |
| **余量** | **≥ 3.6 ms** | 应对 GC 与浏览器抖动 |

### 13.2 资源预算

| 项 | 预算 | 出处 |
|---|---|---|
| 同屏活跃粒子 | **400**（对象池 512） | §9.3 |
| 同屏实体（不含粒子） | **120** | 本架构设定 |
| 单帧绘制调用 | **≤ 8** | 2 批 × 2 RT + 后期 |
| 顶点缓冲 | 预分配 2048 四边形（2 MB），启动一次 | 本架构设定 |
| 显存 | ≤ 64 MB（2×1MB 索引图集 + RT + VBO） | 本架构设定 |
| JS 堆 | **≤ 120 MB**，且热路径零分配 | 本架构设定 |
| 首屏 | ≤ 1.5 MB / ≤ 200 KB gzip JS | §2.3 |

### 13.3 三档质量与自动降级

| | **HIGH** | **MED** | **LOW** |
|---|---|---|---|
| DPR 上限 | 2.0 | 1.5 | 1.0 |
| CRT 后期 | FULL | LITE（扫描线 + 暗角） | **OFF（整个 RT_POST 跳过）** |
| 粒子上限 | 400 | 200 | 100 |
| 噪点 / 余晖 | 开 | 关 | 关 |
| 前景层密度 | 100% | 60% | 30% |
| RT_WORLD | 720×432 | 720×432 | 720×432（**不变**） |

**自动降级触发**（滑动窗口，带滞回防抖）：

| 信号 | 动作 |
|---|---|
| 平均帧率 < 50fps 持续 **1 s** | HIGH → MED |
| 平均帧率 < 40fps 持续 **2 s** | MED → LOW |
| 平均帧率 > 55fps 持续 **10 s** | 回升一档 |

**关键**：LOW 档跳过整个 RT_POST（124 万像素的多重采样后期）——**这是最有效的一档降级**。而 RT_WORLD 恒为 720×432，**绝不通过降低渲染分辨率来降级**（会导致像素非整数重采样，画面劣化，见 ADR-002 §2.5）。

### 13.4 热路径零分配规则

| 禁止 | 替代 |
|---|---|
| 运行时 `new` 粒子 | 对象池（§9.3） |
| 数组 `splice` | 标记位 + 批量清理（§9.3） |
| 每帧创建临时对象/数组/闭包 | 复用 scratch 对象 |
| 每帧字符串拼接（日志） | 生产构建剥离 |
| 每帧 DOM 查询 | 缓存引用，仅数据变化时写 |

**检测**：dev 面板实时显示 `performance.memory.usedJSHeapSize` 与每帧分配估算；回归测试断言"跑 90 秒堆增长 < 5 MB"。

---

## 14. 音频

> 音频设计归阮和鸣，本节只定义**技术接口与约束**。

| 项 | 规格 |
|---|---|
| API | Web Audio API（`AudioBufferSourceNode`，非 `<audio>`——需要精确时序与多音叠加） |
| 自动播放策略 | **必须用户手势后才能 `resume()`** → Title 页点击即 resume |
| 分层 | 音乐层（携带/非携带切换）+ ALARM 4 级动态层（概念文档 §8.3） |
| 接口 | `AudioBus.play(id, { volume, pan, rate })` / `.setLayer(alarmTier)` |
| 静音 | 独立开关 + `M` 键，持久化 |
| 与开关联动 | 音效**不受** 5 个视觉开关影响（正交）；但 `opt.flash = OFF` 时，原本靠视觉传达的告警**必须**有声（补偿表的第四条隐式通道） |

**资源预算**：音效 ≤ 300 KB（ogg/m4a 双格式），音乐 ≤ 1.5 MB（循环，流式）。**不计入首屏**（游戏中按需加载）。

---

## 15. 可访问性架构

### 15.1 五开关的实现位置

| 开关 | 键 | 影响面 | 关闭时的行为 |
|---|---|---|---|
| 屏幕震动 | `opt.shake` | Renderer 相机偏移 | 补偿：顿帧 + 色闪 |
| 屏幕闪烁 | `opt.flash` | `breath()` 返回 `hi`；色闪特效 | 所有脉动改为**常亮**（信息保留） |
| 扫描线抖动 | `opt.jitter` | Pipeline PASS 7 抖动参数 | 扫描线保持**静态** |
| CRT 后期 | `opt.crt` | `OFF / LITE / FULL` | OFF 时整个 RT_POST 跳过 |
| 粒子密度 | `opt.particles` | 100% / 50% / 0% | 0% 时走几何替代 |

**存储**：`localStorage['tideline.v1.settings']`，`<html>` 上的 class + CSS 变量统一下发给 DOM 层与 WebGL 层（**两者读同一份设置，不会出现"HUD 关了但世界没关"**）。

### 15.2 `prefers-reduced-motion` 自动降级

| 信号 | 自动行为 |
|---|---|
| `prefers-reduced-motion: reduce` | `opt.shake = OFF` + `opt.flash = OFF` + 扫描线静态 + 粒子 50% + `breath()` 返回 `hi` + QTE 放宽至 3 次/3.5 s |
| 帧率 < 40fps 持续 2 s | CRT → LITE/OFF，粒子 → 100 |
| 首次启动 | 一次性光敏提示，**提示本身不得闪烁**，选择持久化 |

### 15.3 多通道冗余（颜色永不作为唯一通道）

本架构在**技术上保证**的冗余通道：

| 信息 | 通道 1 | 通道 2 | 通道 3 | 通道 4 |
|---|---|---|---|---|
| ALARM | HUD 条 | 刻度形状 | 音频层 | **太阳表情（余光可读）** |
| 危险度 | 颜色 | **环境明度（§5.3.0）** | 屏幕位置 | — |
| 威胁等级 | 颜色 | 尺寸 | 频闪（2Hz 呼吸） | **锁定系绳** |
| 稀有度 | 颜色 | 尺寸 | 光晕（硬边） | 粒子量 |
| QTE 剩余时间 | 圆环颜色 | **圆环半径（几何）** | 扇形填充（几何） | — |

> **ADR-005 让冗余通道几乎免费**：色盲模式 = 换一张 1 KB 的 LUT 纹理，而不是重新导出所有美术资产。

### 15.4 DOM HUD 带来的额外收益

- 真实文本 → **屏幕阅读器可读**、浏览器缩放可用、系统字体替换可用
- 文本缩放 3 档 = 一个 CSS 变量
- 中文字体子集化（§3.2）正常工作，无需位图字体图集

**这直接把 §9.8 的可访问性等级从 Standard 推到 Comprehensive，成本接近零。**

---

## 16. 构建、CI 与测试

### 16.1 构建

| 阶段 | 工具 | 产物 |
|---|---|---|
| 资产构建 | `tools/build-atlas.mjs` | 索引色图集（灰度索引 PNG-8 + JSON）+ 还原预览图（ADR-005） |
| 配色门禁 | `tools/check-palette.mjs` | 表外颜色 → **构建失败**（落实 §2.5 与 PHASE1-SUMMARY §10.3 #1） |
| 字体子集 | `pyftsubset`（fonttools） | Press Start 2P + Noto Sans SC 子集（§3.2） |
| 打包 | Vite | 产物 + `manifest.json` |
| 产物校验 | 体积门禁脚本 | 超过 §2.3 预算 → 失败 |

### 16.2 CI（GitHub Actions）

```
push/PR → typecheck → lint（含安全红线规则）→ unit test → build → size budget → deploy(preview)
```

**lint 中的安全红线规则（自定义）**：

| 规则 | 内容 |
|---|---|
| `no-hard-blink` | `src/gameplay/**`、`src/presentation/**` 中禁止 `Math.sin/cos` 直接用于亮度（须走 `breath()`） |
| `no-raw-random` | 全局禁止 `Math.random()`（须走 `rng`）**（ADR-006 §2.4）** |
| `no-wall-clock` | `src/gameplay/**` 禁止 `Date.now()` / `performance.now()` |
| `fx-only-via-dispatcher` | `src/gameplay/**` 只能 import `fx/dispatcher` |
| `render-no-domain-words` | `src/core/render/**` 禁止出现业务词汇 |

### 16.3 测试策略

> 我负责**写测试代码**；测试执行、用例设计与 E2E 归严守真。

| 层 | 覆盖 | 关键用例 |
|---|---|---|
| **单元** | Core（L0/L1） | `breath()` 频率 clamp 与开关行为；FX Dispatcher 三段管线；`snapArt`；调色板 LUT 映射 |
| **单元** | Gameplay | 搁浅状态机（静止/慢速/快速/离区 4 种情境的精确秒数）；区域分类边界与迟滞；碰撞层矩阵 |
| **集成** | **192 例正交性** | `tests/fx-dispatcher.orthogonality.test.ts`（§12.4） |
| **集成** | **确定性** | 同种子 + 同输入序列 → 相同终局分数（ADR-006 §2.4） |
| **集成** | 质量档 | 模拟帧率下降 → 断言自动降级与回升 |
| **性能** | 回归 | 跑 90 秒断言堆增长 < 5 MB；draw call ≤ 8 |
| **E2E** | 严守真 | 浏览器端完整流程；真机低端机实测 |

**覆盖率目标**：Core 与 Gameplay ≥ 85%；Presentation 与 App ≥ 50%（UI 主要靠 E2E）。

### 16.4 Dev 调试面板（开发构建）

| 面板 | 内容 |
|---|---|
| FX | 实时显示活跃特效、被抑制的请求、补偿链 |
| Breath | 所有注册脉动元素的 `hz`、面积、亮度预算占用 |
| Dither | 实时切换密度曲线 / 锚定模式 / 矩阵大小（供林绘澄调观感） |
| Perf | 帧时间分解、draw call、堆大小、粒子数、当前质量档 |
| Strand | `strandProgress` 实时曲线 + 强制触发搁浅 |
| Palette | 实时切换调色板（基础/色闪/色盲） |
| Context | **强制丢失 WebGL 上下文**（测试恢复路径） |

---

## 17. 编码控制清单（一页规则，可立即执行）

> 这一节是给每个写代码的程序员的。**违反任何一条，PR 不予合并。**

### 17.1 视觉与像素

1. 所有**位置**渲染前必须 `snapArt()`（吸附到 2 设计 px）。**禁止亚像素位置。**
2. **位移禁止缓动**；缩放、旋转、镜头**允许** `ease-out`（§6.7）。
3. 实体 sprite **100% 不透明硬边**。禁止任何形式的半透明或抖动。
4. 淡出只能用**有序抖动**（粒子/残影/光柱/水珠/泡沫线）；**暗角与遮罩保留真 alpha**。
5. 精灵与 UI 尺寸必须落在**艺术网格整数格点**（偶数设计 px）。
6. 禁止径向渐变、模糊、alpha 羽化边缘。
7. 扫描线**只在 ART GRID 上绘制**，不得移到 COMPOSITE 或 DISPLAY。

### 17.2 安全（红线）

8. **禁止任何硬 on/off 闪烁。** 所有脉动必须走 `breath()`。
9. **禁止 `breath()` 之外的频率源。** `hz` 由函数内部 clamp 到 ≤2，无法绕过。
10. **禁止直接调用 `screenShake()` / `flash()` / `hitstop()`。** 只能发领域事件给 FX Dispatcher。
11. 受击**绝不**触发顿帧（§6.6 ③）。`FX_TABLE` 中不存在 `hit.hitstop`。
12. 光敏提示本身**不得闪烁**。

### 17.3 性能

13. 热路径**零分配**：禁止 `new`、禁止闭包、禁止临时数组。
14. 粒子用对象池（512），**禁止 `splice`**，用标记位 + 批量清理。
15. 禁止每帧生成 `CanvasPattern` / 噪声图 / 渐变。一律预生成复用（§9.6）。
16. 禁止每帧写 localStorage。
17. 禁止每帧 DOM 查询；只在数据变化时写 DOM。

### 17.4 架构

18. 只能**向下依赖**；跨层向上通信只走 EventBus。
19. `src/core/render/**` 不得出现业务词汇。
20. UI **只读** `RunState`，不得持有或修改游戏状态。
21. **禁止 `Math.random()`**，一律 `rng.next()`；确定性是硬要求。
22. `src/gameplay/**` 禁止 `Date.now()` / `performance.now()`。
23. 常量只能来自 `core/*/constants.ts`。**禁止在业务代码里硬编码数值**（所有可调数值进 `tuning.ts`，便于 playtest 调参）。

### 17.5 数据与资产

24. 所有资产颜色必须来自权威调色板 `design/art/palette.json`（构建期门禁）。
25. 特效定义只能写在 `FX_TABLE`，禁止硬编码在逻辑里。
26. 关卡地形只通过海床控制点表描述，禁止硬编码坐标。

---

## 18. 风险登记

| # | 风险 | 等级 | 缓解 | 负责人 |
|---|---|---|---|---|
| **T1** | **自研渲染层 + 索引色 LUT + 自定义 shader 三项新技术叠加，未经 spike 验证** | 🔴 高 | ADR-001 §5 的 **5 天 Spike 闸门**，3–5 项通过即转 PixiJS 备选方案 B。Spike 未过不写业务代码 | 程基岩 |
| **T2** | **林绘澄的资产若为 RGBA / 含抗锯齿或渐变，ADR-005 索引色方案崩溃** | 🔴 高 | ① Spike 内验证一张真实图集；② 降级路径：索引存 RGBA 的 R 通道（放弃显存收益，保留色闪/色盲/门禁收益） | 程基岩 + 林绘澄 |
| **T3** | **CRT 后期在中低端移动端的实际开销未知** | 🟠 中 | LOW 档直接跳过整个 RT_POST；DPR 上限 1.0；真机实测纳入 Spike 第 6 项 | 程基岩 |
| **T4** | **16:9 屏幕上的 60px 黑边不被接受** | 🟠 中 | 备选：改 1280×720（需美术全面返工，§2.6 面积配额、鲨鱼体型推导、明度阶梯全部重算）。**需用户尽早拍板** | 用户 / 林绘澄 |
| **T5** | **色闪（整屏 1–2 帧高对比切换）是全项目最高单点光敏风险** | 🟠 中 | 建议改为部分调色板切换（ADR-004 §4.6 方案 B）；无论如何必须受 `opt.flash` 控制 | 林绘澄 / 严守真 |
| **T6** | 5:3 在竖屏手机上几乎不可玩 | 🟡 低 | 提示条 + 可玩降级（§9.3）；不做强制旋转 | 程基岩 |
| **T7** | WebGL 上下文丢失处理不当 → 移动端黑屏 | 🟡 低 | §6.5 恢复路径 + CPU 侧资产副本常驻 + dev 面板强制丢失测试 | 程基岩 |
| **T8** | `p_beach` 三个旋钮的初值未经 playtest | 🟡 低 | 常量进 `tuning.ts`；MVP 可玩后立即 5–8 人小样本测试（沙盘 S4） | 文策渊 / 严守真 |
| **T9** | 高刷屏（120/144Hz）位置仍 60Hz，可能被感知为不够顺 | 🟡 低 | 方案 C：旋转/缩放/镜头插值（§2.2 ADR-006）；若反馈强烈，重新评估 | 程基岩 |
| **T10** | 未来若加在线排行榜，无反作弊能力 | 🟡 低 | **前置警告已写入 ADR-006 §2.6**：加之前必须找我评估，不要先承诺 | 主理人 |

---

## 19. 待确认项汇总

### 19.1 需用户 / 主理人拍板

| # | 事项 | 影响 |
|---|---|---|
| 1 | **ADR-001 Spike（5 天）是否批准** | 阻塞全部实现工作 |
| 2 | **方案 F 是否可接受**：砍掉 CRT 弯曲与色差 → 可改用 Canvas2D，省约 2 周 | 视觉身份 vs 工期 |
| 3 | 接受 5:3 的 60px 黑边，还是返工改 1280×720 | 若为后者，美术全面返工 |
| 4 | ADR-006 的"不做反作弊"是否接受 | 影响未来能否加排行榜 |
| 5 | 是否需要**回放功能**（确定性已具备，+200 LOC） | 对 QA 与 playtest 价值高 |

### 19.2 需林绘澄会签

| # | 事项 |
|---|---|
| 1 | 🔴 **ART_SCALE = 2**（艺术网格 720×432）——决定所有精灵绘制网格 |
| 2 | 🔴 **权威调色板 `design/art/palette.json`**（含索引编号）——ADR-005 前置 |
| 3 | 🔴 **色闪安全方案 A/B/C**（ADR-004 §4.6） |
| 4 | 🔴 **搁浅构图**：相机聚焦（方案 A）还是 QTE 圆环跟随（方案 B） |
| 5 | 抖动：屏幕锚定 vs 物体锚定；Bayer 8×8 vs 蓝噪声；密度曲线 |
| 6 | §3.3 字号表补"艺术 px"列；确认粒子 2–5 是设计 px |
| 7 | 图集图块坐标对齐偶数（艺术网格）→ 写入 §9.1 |
| 8 | HUD 走 DOM 后，CSS 扫描线/暗角覆盖层的观感验收 |

### 19.3 需文策渊确认

| # | 事项 |
|---|---|
| 1 | 🔴 **`PX_PER_M = 32`** 会签（概念文档 m/s ↔ 美术圣经 px 的换算基准） |
| 2 | 🔴 **`p_beach` 改为三个旋钮**（ADR-003 §6.1），沙盘需相应更新 |
| 3 | 手感常量初值：`T_STRAND = 1.2s` / `V_TH = 3 m/s` / `N_qte = 6` |
| 4 | 世界宽度 2160（卷轴，1.5 屏）vs 1440（单屏） |
| 5 | 海床剖面 9 点控制表初值 |
| 6 | 6 个"核心事件"清单是否完整（ADR-004 §6.5） |
| 7 | **"从深水直接冲上沙滩"在本几何下不成立**，需改为"上浮 → 冲坡"两段式 |
| 8 | 同屏实体上限 120（关卡 GDD 需遵守） |
| 9 | 冲浪路线 8 个收集物：需用**参数化曲线**（Catmull-Rom 3 控制点）而非逐点坐标 |

---

## 附录 A · 关键常量速查

```ts
// 分辨率与网格（ADR-002）
DESIGN_W = 1440   DESIGN_H = 864   ART_SCALE = 2
RT_WORLD = 720×432   RT_POST = 1440×864   SAFE_MARGIN = 48

// 单位（ADR-003）
PX_PER_M = 32     巡游 192 设计 px/s   冲刺 448 设计 px/s

// 世界（ADR-003）
WORLD_W = 2160   WATER_BASE_Y = 105
DEEP ≥400 · SHALLOW 120–400 · SURF 0–120 · BEACH ≤0（水深，设计 px）

// 搁浅（ADR-003）
V_TH = 96 设计 px/s   T_STRAND = 1.2 s   T_WARN = 0.72 s
QTE: 2.5 s / 6 次输入 / 最小间隔 100 ms / ALARM +8 per s

// 安全（ADR-004）
BREATH_MAX_HZ = 2   亮度预算 ≤ 0.10   FX 优先级 flash 30 > shake 20 > jitter 10

// 仿真（ADR-006）
FIXED_DT = 1/60   MAX_FRAME_TIME = 0.25
HITSTOP = 0.080   ENTITY_CAP = 120   PARTICLE_CAP = 400
INPUT_BUFFER = { dash: 0.120, mash: 0.200 }
```

---

*PH3-ARCH-001 v1.0 · 状态：已提议 · 待会签 · 配套 ADR-001~006 与 PH3-blocking-resolutions.md*
