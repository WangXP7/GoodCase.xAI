# 《檐下 · UNDER THE EAVES》· 技术架构文档

| 项 | 内容 |
|---|---|
| **任务 ID** | PH3-TECH-001 |
| **文档编号** | PH3-ARCH-EAVES-001 |
| **阶段** | Phase 3 · 技术搭建 |
| **作者** | 程基岩（Cheng Jiyan）· 技术总监 / 主程 |
| **版本** | v1.0 |
| **状态** | 已提议（Proposed）· 待主理人 / 文策渊 / 林绘澄会签 |
| **上游** | `production/PH2-rulings-EAVES.md`（裁决令 v1.0 · 9 项）<br>`docs/architecture/PH1-3d-feasibility.md`（本人 Phase 1，判定 CONCERNS）<br>`design/gdd/PH2-systems-gdd-EAVES.md`（1601 行 · 3 个 P0 系统）<br>`design/gdd/PH2b-systems-gdd-EAVES.md`（2301 行 · 5 个 P1/P2 系统）<br>`design/art-bible/PH1-art-bible-EAVES.md`（林绘澄 v1.0）<br>`design/ux/PH4-ux-spec-EAVES.md` |
| **配套 ADR** | `docs/architecture/ADR/ADR-101` ~ `ADR-107` |

> ⚠️ **本文所有性能数字的性质**：除显式标注「实测」外，均为**架构核算值**（依据 Phase 1 可行性评估、Three.js 渲染管线成本模型、以及 GDD 给出的资产预算推导）。**它们是可验收的硬预算，不是目标值**；Phase 3 的 Spike 原型必须逐项实测回填，偏差 > 20% 的项须立项修订。

---

## 1. 结论先行

### 1.1 九项裁决的落实核对（逐条）

| 裁决 | 要求 | 落实位置 | 状态 |
|---|---|---|---|
| **RUL-1** | 4 套 lightmap（晨/午/昏/夜）+ 0.8s 交叉淡入；季节/天气一律不走 lightmap；超预算 60% 降为 **2 套（昼/夜）+ LUT** | §6 全章；ADR-103 | ✅ **核算结论：占 16.7%，不触发降级，按 4 套执行**（§6.5） |
| **RUL-2** | 猫 ≤20k 面（验收按观感，可上探 30k）；移动/桌面共用；A 档视口内总和 ≤48k（移动）/ ≤100k（桌面） | §10.2 面数分配表；§6.6 | ✅ 落实。**A 档核算 43k（移动）/ 60k（桌面）**，余量 5k / 40k |
| **RUL-3** | 命名《檐下 · UNDER THE EAVES》 | §11.1 命名规范；存档 schema 名 | ✅ |
| **RUL-4** | 三段式时间模型（锚定 ×12 / 离线 1:1 / 单次会话 ≤6 游戏小时） | §3.3 时间系统；ADR-104 | ✅ |
| **RUL-5** | AFF 暖机模型（`warmth` 门控 + 地板） | §5.1 五维系统 | ✅（数值规则归策划，此处只定义**结算时机与持久化字段**） |
| **RUL-6** | 拒绝率 20% + 双级保底 | §8.3 三态判定 | ✅ |
| **RUL-8** 🚨 | **同步写入 + 双槽 + CRC32，三条同时做，不可削减任何一条** | §4.2–§4.5；ADR-102 | ⚠️ **我做了加强，并提出一处必须澄清的技术事实**（见下 §1.2） |
| **RUL-9** | 全局 RNG 种子化 + 逻辑固定步长（与渲染帧率解耦）；MVP 不做回放 | §3.4 固定步长；§4.6 RNG；ADR-104 | ✅ |
| **RUL-7** | ADR 从 ADR-101 起编号，与《潮线》001–006 隔离 | ADR 目录 | ✅ |

### 1.2 🚨 对 RUL-8 的一处必须澄清（请主理人注意）

策划与主理人的原文是「**同步写入**」+「**IndexedDB 双槽**」。这两句在当前 Web 平台下存在**技术冲突**，我必须现在说清楚，否则实现者会踩坑：

> **IndexedDB 没有任何同步 API。`IDBObjectStore.put()` 只是"同步发起"一个异步事务，事务完成是异步的。**
>
> **Web 平台唯一真正的同步持久化 API 是 `localStorage.setItem()`。**

因此 RUL-8 的「同步写入」在架构上落地为 **4 层防护**，比裁决原文的 3 条更厚，但**没有削减任何一条**：

| # | 层 | API | 同步性 | 作用 |
|---|---|---|---|---|
| 1 | **紧急槽** | `localStorage.setItem('eaves:emergency', json)` | ✅ **真同步**（阻塞至落盘） | 覆盖"页面被 kill、IDB 事务来不及完成"的最坏情况 |
| 2 | **主存储双槽** | IndexedDB `slotA` / `slotB` 交替 | ⚠️ 同步发起，异步完成 | 主存档，容量大、结构化、可存 Blob |
| 3 | **完整性校验** | CRC32（查表法） | ✅ 同步计算 | 读时验证，坏槽自动回退另一槽 |
| 4 | **迁移函数链** | 纯函数 `v(n) → v(n+1)` | ✅ 同步执行 | 版本演进，**5 项情感资产逐字节保留** |

**第 1 层是我新增的**，理由是：IDB 事务在 iOS Safari 冻结场景下**通常**会完成（事务在独立线程执行），但在 **内存 kill** 场景下不会。8 KB 的存档主体放进 localStorage（容量 5 MB，占用 0.16%）是完全可行的，代价是 `setItem` 的同步阻塞（中端移动 8 KB ≈ **0.15–0.4 ms**，Safari 带 fsync 时可能到 1–2 ms，仍在 16.6 ms 帧预算内）。

**这不是削弱 RUL-8，是把"同步写入"这四个字在工程上真正兑现。** 若主理人认为第 1 层超出裁决范围，我接受删除，但风险 T-1 等级要从 🟠 升回 🔴。

### 1.3 最重要的 5 个判断

1. **RUL-1 的降级路径不触发。4 套 2048² lightmap 在中端移动端占纹理预算 16.7%（16.0 MiB / 96 MiB），降级阈值是 60%（57.6 MiB）。** 按 4 套执行。降级预案仍完整保留（§6.6），因为它会在两个明确条件下触发：KTX2 能力缺失回退到未压缩 RGBA8（66.7%）、或分辨率上探到 4096²（66.7%）。
2. **分层 tick 的 CPU 成本是 0.012 ms/帧，占帧预算 0.07%。** 策划的开销担忧不成立（TECH-1）。真正的成本不在 tick 频率，而在**离线结算不能复用 tick**——30 天离线若按 1 Hz 逐 tick 跑需要 260 万次，必须走闭合解（§9.2）。
3. **`simulation/` 层禁止 import three。** 这不是洁癖，是 RUL-9 的前提：只有逻辑层零渲染依赖，固定步长 + 种子化 RNG 才可能在 Vitest 里 headless 跑确定性测试，将来加回放才不必返工。
4. **0.8s crossfade 必须用 shader 注入实现，不能用"两个 mesh 叠加"。** 后者要给每个 A 档物件加 1 个 draw call 与一份 alpha blend 开销，在移动端不可接受。shader 注入方案只编译 **1 个 program 变体**，稳态下把 B sampler 指向 1×1 白纹理实现零额外成本（§6.4）。
5. **日记快照必须在离线结算阶段预生成，不能等玩家翻开相册才渲染。** 策划估的 10–40 ms 偏高（瓶颈在 `readPixels` 而非渲染），但即便压到 3–5 ms/张，5 张叠在一次交互响应里也会被玩家读成"翻日记卡"（TECH-3）。

---

## 2. 架构总览

### 2.1 分层图

```
┌──────────────────────────────────────────────────────────────────────────┐
│  UI 层  ui/                  DOM 覆盖层 · 不持有任何游戏状态               │
│  HUD / 日记 / 相册 / 设置 / 异常恢复提示                                    │
│  只能：读 snapshot 只读视图 + 发「意图事件」                                │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ 意图事件（Intent）
┌───────────────────────────────▼──────────────────────────────────────────┐
│  交互层  input/               Pointer Events → 手势 → 动词 → Raycast       │
│  15 动词解析器 / 冷却与预算 / 猫身代理热盒 / 物件 faceIndex→objectId        │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ 动词 Intent
┌───────────────────────────────▼──────────────────────────────────────────┐
│  表现层  presentation/        sim 状态 → Three.js 对象（单向，只读）        │
│  CatView(骨骼+8morph+shader) / RoomView / TraceView / AnimationBridge      │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ 渲染指令
┌───────────────────────────────▼──────────────────────────────────────────┐
│  渲染层  render/              Three.js r172 · 正交 · 光照 · 后处理 · 截图   │
│  LightmapManager(4套+crossfade) / SunRig / LUT / PostComposer / Capturer   │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  模拟层  simulation/          ★ 纯逻辑 · 禁止 import three · headless 可测 │
│  time/ cat/ world/ interaction/ journal/                                  │
│  输入：Intent + dt(固定) + rng流     输出：状态变更事件                     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ 只读 snapshot
┌───────────────────────────────▼──────────────────────────────────────────┐
│  持久化层  persistence/        codec / crc32 / idb / dual-slot / migrations│
│  ★ 只依赖数据契约，不依赖 simulation 的任何具体模块                        │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  核心层  core/                零热路径分配 · 无业务语义                     │
│  固定步长累加器 / 分层 tick 调度器 / 事件总线 / 类型 / crc32 / 数学         │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  平台层  platform/            浏览器能力的事实来源                          │
│  能力探测矩阵 / 设备分档 / 真实+单调时钟 / PCG32 / 生命周期事件             │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块清单与职责

| 层 | 模块 | 职责 | 关键约束 |
|---|---|---|---|
| **platform** | `capability.ts` | WebGL2 / KTX2 / ASTC / ETC2 / `OES_texture_half_float_linear` 能力矩阵 | 一次性探测，结果冻结 |
| | `device-tier.ts` | H/M/L 三档分级 + 1s benchmark + 用户手动覆盖 | 见 ADR-106 |
| | `clock.ts` | 真实时钟（`Date`）、单调时钟（`performance`）、双时间戳 | 防作弊第一道防线（GDD §5.7 ①②） |
| | `rng.ts` | PCG32 + 四路独立流（`core`/`journal`/`genesis`/`cosmetic`） | RUL-9；见 §4.6 |
| | `lifecycle.ts` | `visibilitychange` / `pagehide` / `freeze` / `resume` / `webglcontextlost` | **RUL-8 的触发源**，见 §4.2 |
| **core** | `fixed-step.ts` | 固定步长累加器，**逻辑步长 1/30 s**，最大追帧 5 步 | RUL-9；见 §3.4 |
| | `tick-scheduler.ts` | 在固定步长时间轴上调度分层 tick | TECH-1；见 §3.2 |
| | `event-bus.ts` | 类型安全发布订阅 | **禁止在热路径分配对象** |
| | `math/` | `clamp` / `lerp` / `smoothstep` / `crc32`（查表） | 纯函数 |
| **simulation** | `time/game-clock.ts` | 三段式时间（锚定 / ×12 / 离线 1:1 / 6h 上限） | RUL-4 |
| | `time/slot-table.ts` | **`timeSlot`（4 档，随季节漂移）与 `circadianBand`（5 档，固定钟点）双枚举** | GDD R-3 修订，**程序不得复用同一枚举** |
| | `cat/personality.ts` | 5 维 + `warmth` + `SEC_cap` + 三条调制公式 | RUL-5 |
| | `cat/needs.ts` | 4 需求 + `ENE_max` / `ENE_rec` | — |
| | `cat/behavior-arbiter.ts` | `U(b)` 评分 → `sharp` 锐化 → `surprise` 混合 → 加权抽取 | **零分配**（预分配 `Float32Array(16)`） |
| | `cat/state-machine.ts` | 15 状态 HFSM，**无终止态**，强连通 | GDD §3.4 硬要求 |
| | `cat/offline-settler.ts` | 离线闭合解 + ENE 粗粒度模拟 | §9.2 |
| | `world/anchors.ts` / `weather.ts` / `season.ts` / `daily-difference.ts` | 锚点偏好 / 马尔可夫天气 / 昼长与季节过渡 / 今日不同 | GDD PH2b §1–§3 |
| | `interaction/tri-state.ts` | `P_accept` / `P_reject` / `P_none` + 双级保底 | RUL-6 |
| | `journal/generator.ts` | T0–T6 分档 + 三层模板拼接 + 去重 | GDD §5.6.2 |
| **persistence** | `codec.ts` | 序列化 / 反序列化 / schema 头 / 字段白名单 | 见 §4.3 |
| | `crc32.ts` | 查表 CRC32，8 KB ≈ 0.03–0.08 ms | RUL-8 第 3 条 |
| | `idb.ts` | **常驻连接**（进入时打开，永不 close）+ 事务封装 | **回调内禁止 `await openDB()`** |
| | `dual-slot.ts` | A/B 交替 + localStorage 紧急槽 | RUL-8 第 1、2 条 |
| | `migrations/` | 迁移函数链 + 逐版本迁移文件 | TECH-4；见 §4.5 |
| | `verify.ts` | 读取校验 → 副槽回退 → 紧急槽回退 → 异常恢复路径 | GDD §6.8 |
| | `session-lock.ts` | 多标签页仲裁（10s 心跳 / 30s 超时） | GDD §6.7；采纳 R-5（静默重读档，不重载） |
| **render** | `renderer.ts` | `WebGLRenderer` + 能力配置 + `contextlost` 恢复 | ADR-101 |
| | `camera.ts` | 正交相机 + 3 档 zoom（远 6.0m / 中 4.0m / 近 2.4m）+ 阻尼 0.1 | **禁用自由 zoom**（美术 §5.5） |
| | `lighting/lightmap-manager.ts` | 4 套加载 / 驻留置换 / 0.8s crossfade 驱动 | **RUL-1 核心**，见 §6 |
| | `lighting/sun-rig.ts` | 主光 direction/color/intensity 插值 + 季节/天气修正 | RUL-1 ③ |
| | `lighting/lut.ts` | 色彩分级参数（12 组季节×天气组合） | RUL-1 ③ |
| | `shaders/lightmap-crossfade.glsl` | `onBeforeCompile` 注入双 sampler | §6.4 |
| | `post/composer.ts` | tilt-shift（1/4 降采样）+ 色彩分级 + vignette | §7.5 |
| | `capture/offscreen-capture.ts` | 512² 日记快照 | TECH-3 |
| | `capture/screenshot.ts` | 主画面截图（WebP） | §8.5 |
| **presentation** | `cat-view.ts` | 8 morph + 骨骼 + shader uniform 的目标值应用 | §5.4 |
| | `animation/mixer-bridge.ts` | `AnimationMixer` + 12 姿态参数化 | GDD §8 |
| | `animation/procedural.ts` | 呼吸 / 尾巴 8 节 / 耳朵 3×2 / 胡须 12 根 | — |
| | `room-view.ts` / `trace-view.ts` | 房间与家具 / 痕迹（猫毛、压痕、日历） | 美术 §5.3 |
| **input** | `pointer.ts` / `gesture.ts` / `raycast.ts` / `verb-resolver.ts` | 输入归一化 / 手势 / 检测 / 15 动词 | §8.1–§8.2 |

### 2.3 依赖方向（硬规则，CI 静态检查）

```
platform  →  core  →  simulation  →  presentation  →  render
                         ↑                ↑               ↑
                    persistence      （只读 snapshot）  （渲染指令）
                         ↑
                        ui  →  Intent（不读 simulation 内部）
                       input → core（事件）
```

| # | 规则 | 检查方式 |
|---|---|---|
| **D-1** | **`simulation/` 禁止出现 `import ... from 'three'`** | ESLint `no-restricted-imports`，**CI 阻断** |
| **D-2** | `presentation/` 对 `simulation` **只读**，禁止写状态（写必须经 Intent） | TypeScript `Readonly<T>` 类型约束 |
| **D-3** | `persistence/` 禁止 import `simulation/` 的任何具体模块，只依赖 `persistence/contract.ts` | ESLint `import/no-restricted-paths` |
| **D-4** | `ui/` 禁止持有游戏状态（只允许持有"当前翻到第几张卡片"这类纯 UI 本地态） | Code review + 约定：UI 组件禁止接收可变状态对象 |
| **D-5** | `render/` 禁止 import `simulation/`；`render` 与 `simulation` 之间必须经 `presentation` 中转 | ESLint |
| **D-6** | **禁止反向依赖**（下层 import 上层）：`core` 不得 import `simulation`，`platform` 不得 import `core` | ESLint |
| **D-7** | **禁止跨层平级 import**：`cat/` 不得 import `journal/`，`weather/` 不得 import `cat/` | ESLint |
| **D-8** | 层间通信**只允许**经 `core/event-bus.ts` 或显式 Intent 对象；禁止直接函数调用穿透两层以上 | Code review |

---

## 3. 运行时架构

### 3.1 主循环

```ts
function frame(nowMs: number) {
  requestAnimationFrame(frame);

  // ── ① 逻辑：固定步长，与渲染帧率完全解耦（RUL-9 / ADR-104）─────────
  let frameMs = clock.tick(nowMs);              // 真实 dt，clamp 到 [0, 250ms]
  accumulator += frameMs * timeScale;           // 会话内 ×12（RUL-4）
  let steps = 0;
  while (accumulator >= STEP_MS && steps < MAX_CATCHUP) {
    simulation.step(STEP_SECONDS);              // 固定 dt = 1/30 s
    tickScheduler.advance(STEP_SECONDS);        // 分层 tick 在此被调度（§3.2）
    accumulator -= STEP_MS;
    steps++;
  }
  if (steps === MAX_CATCHUP) accumulator = 0;   // 防 spiral of death

  // ── ② 表现：用 alpha 插值，读 simulation 只读视图 ──────────────────
  const alpha = accumulator / STEP_MS;
  presentation.update(alpha, frameMs);          // 骨骼/morph/相机/程序化动画

  // ── ③ 渲染 ─────────────────────────────────────────────────────────
  lightmapManager.update(frameMs);              // 0.8s crossfade 用真实秒驱动
  sunRig.update();                              // 主光每帧插值
  renderer.render(scene, camera);               // → RT → post → screen
}
```

**关键参数**

| 参数 | 值 | 理由 |
|---|---|---|
| `STEP_SECONDS` | **1/30 s**（33.33 ms） | 最快的 tick 层是 4 Hz（0.25 s），1/30 足够；且移动端 30 fps 档下每帧恰好 1 步，零抖动 |
| `MAX_CATCHUP` | **5 步** | 追帧上限 166 ms，超出直接丢弃（宁可慢放不要雪崩） |
| `frameMs` clamp | **[0, 250 ms]** | 覆盖"切后台 3 小时回来"这类 dt 爆炸（GDD E3-1：后台按离线处理，不靠追帧） |
| 渲染插值 | `alpha = accumulator / STEP_MS` | 仅用于**连续量**（位移、相机、尾巴骨骼）；**离散量**（状态、morph 目标）不插值 |

### 3.2 分层 tick 架构（**TECH-1 答复**）

**结论：策划提出的分层频率完全可接受，每帧摊销成本 0.012 ms（帧预算的 0.07%）。三层保护全部保留，我仅做 3 处修正。**

#### 3.2.1 权威 tick 表（合并 GDD §3.5 与 §5.3.1，落实 R-8 修订建议）

> 采纳 GDD PH2b §9 的 **R-8**：tick 表此前分散在 §3.5 与 §5.3.1 两处，本节为**唯一权威表**。

| 层 | 周期 | 频率 | 内容 | 单次核算 | 每帧摊销 @60fps |
|---|---|---|---|---|---|
| **微表情** `micro` | 0.25 s | **4 Hz** | 耳/尾/瞳/胡须**目标值**更新（不直接设值，走缓动） | 0.10 ms | 0.0067 ms |
| **生理需求** `needs` | 1.0 s | **1 Hz** | HNG/ENE/HYD/TOI 按 `dt × TIME_SCALE` 累加 | 0.02 ms | 0.0003 ms |
| **行为决策** `behavior` | 2.0 s | **0.5 Hz** | 11 候选项 × `U(b)` + 归一化 + 锐化 + 抽取 | 0.60 ms | 0.0050 ms |
| **性格结算** `personality` | **60 s** | **1/60 Hz** | 5 维落账、`warmth` 累计、`AFF_peak` 单调更新 | 0.05 ms | 0.000014 ms |
| ~~光照色温~~ | — | — | **不占 tick 槽**（见修正 ②） | — | — |
| **自动存档** `autosave` | 30 s | 1/30 Hz | 增量覆写 | 0.6 ms | 0.0003 ms |
| | | | **合计** | | **≈ 0.012 ms/帧** |
| | | | 对照：全部每帧执行 | 0.77 ms | **0.77 ms/帧（4.64%）** |

> **分层 tick 相比"全部每帧"节省 98.4% 的模拟层 CPU 开销。** 相比一个 16.6 ms 的帧预算，模拟层的全部开销是 **0.07%**。

#### 3.2.2 与渲染帧率的解耦（策划问的第二点）

**完全解耦。** 机制：

1. tick 不由帧驱动，而由 **固定步长时间轴**（`simTime`）驱动。每个 tick 层持有 `nextDueAt`，调度逻辑是：
   ```ts
   while (nextDueAt <= simTime) { run(); nextDueAt += period; }
   ```
2. 因此**渲染跑 60 / 30 / 20 fps，逻辑结果完全一致**（在相同 Intent 序列下）。这正是 RUL-9 要求的确定性前提。
3. 反过来，模拟层也**不会**因为渲染掉帧而"补跑"出不同的结果——追帧有 `MAX_CATCHUP = 5` 上限，超出部分直接丢弃时间（宁可慢放，不要雪崩）。
4. 表现层用 `alpha` 插值把"1/30 s 的离散逻辑"还原成"连续的视觉"，玩家看到的猫是平滑的。

#### 3.2.3 我对策划方案的 3 处修正

| # | 策划原方案 | 我的修正 | 理由 |
|---|---|---|---|
| **①** | 「性格 1/60 Hz」 | 措辞改为 **「周期 60 s（= 1/60 Hz）」**，代码中常量命名为 `PERSONALITY_PERIOD_S = 60` | `1/60 Hz` 极易被实现者误读为 **60 Hz**（即每帧跑一次）。这是最危险的一类歧义，必须消除 |
| **②** | 「光照色温 每 5 游戏分钟」占一个 tick 层 | **移出 tick 表**，改为 **游戏分钟整数边界事件**驱动（`gameMinute` 变化时检查是否跨 5 分钟边界） | 它本来就是 `time` 模块的派生行为，占一个 tick 槽会引入"两层调度器对不齐"的隐患；改事件驱动后成本降到 ~0 |
| **③** | tick 表用于在线推进 | **离线结算禁止复用 tick 表**（见 §9.2） | 30 天离线 × 86400 s ÷ 1 s = **260 万次**需求 tick，在中端移动需 ~52 秒。必须走**解析闭合解** |

> 📌 **修正 ③ 是架构级的，请策划注意**：GDD §5.6 的离线回填规则（需求推进、warmth 衰减、AFF 触地板）在数学上都是**线性 + clamp**，可以 O(1) 闭式求解，结果与逐 tick 积分**等价**（误差 < 0.01 点）。唯一必须逐段模拟的是 `ENE`（睡眠恢复是非线性的分段函数），我用 **15 游戏分钟步长**的粗粒度模拟，30 天 = 2880 步 ≈ **58 ms**，分 4 帧执行。

#### 3.2.4 零分配约束（性能硬规则）

`behavior-arbiter.ts` 是唯一单次开销 > 0.1 ms 的 tick 层（0.5 Hz × 0.6 ms）。规则：

- 候选项权重数组预分配为 `Float32Array(16)`（11 候选项 + 余量），**每 tick 覆写，不 new**
- `Math.pow(x, 1.60)` 11 次 ≈ 0.005 ms，可接受；若实测超标则换 `x*x*Math.sqrt(x)` 近似（1.5 次幂，误差 < 3%，分布影响可忽略——需策划确认）
- 状态转移事件对象走**对象池**（每秒最多 0.5 个，其实无所谓，但保持一致）

### 3.3 时间系统（RUL-4 落地）

#### 3.3.1 三段式时间模型

```
① 进入时刻锚定：  gameMinutes₀ = 本地真实时刻（含时区）
                  → 保住"我晚上打开，屋里就是晚上"

② 会话内加速：    gameMinutes += dt_real × TIME_SCALE     ⚙ TIME_SCALE = 12
                  → 5 分钟会话 = 1 游戏小时

③ 离线推进：      1:1，离线 8 小时 = 游戏内 8 小时
                  → "我睡了一觉，它也睡了一觉"
```

**附加约束（RUL-4 ④⑤）**

| 约束 | 实现 |
|---|---|
| **单次会话最多推进 6 游戏小时** | `sessionAdvancedGameHours` 累加；达 6 后 `timeScale` 回落 1.0（**不是停止**，是降速） |
| **设置项「时间流速：真实 / 加速」，默认加速** | `settings.timeScale` ∈ {1, 12}，改设置不丢进度、不重置猫（G-M4） |
| **离线不受设置影响** | 离线恒为 1:1（GDD E-M6） |

#### 3.3.2 两个时钟的分离

| 时钟 | 来源 | 用途 | 是否受 ×12 影响 |
|---|---|---|---|
| **真实时钟** `realMs` | `performance.now()`（单调，不受系统时间影响） | 帧驱动、动画缓动、0.8s crossfade、冷却计时、自动存档间隔 | ❌ |
| **游戏时钟** `gameMinutes` | 由 `realMs × timeScale` 积分 | 时段判定、需求衰减、昼夜节律、离线结算 | ✅ |

> ⚠️ **0.8s crossfade 用真实秒**（RUL-1 原文「0.8s」是墙钟时间）。在 ×12 下它等于 9.6 游戏分钟，而过渡窗是 45 游戏分钟 = 225 真实秒 → **crossfade 占过渡窗的 0.36%**。这与 GDD PH2b §3.4.2 的图示完全一致。

#### 3.3.3 防作弊（GDD §5.7 落地）

| # | 手段 | 实现 |
|---|---|---|
| ① | 单调时钟优先 | `performance.now()` 累计在线时长，不依赖 `Date` |
| ② | 双时间戳 | 存 `savedAtEpoch`（`Date.now()`）与 `monotonicMs`（`performance.timeOrigin + performance.now()`），**取较大者**作为"现在" |
| ③ | 回拨检测 | `now < lastSavedAt` → **冻结本次离线结算**（不回滚存档、不产生日记、不推进需求），仅 `console.info`，**不弹任何提示**（GDD E3-2） |
| ④ | 前进 clamp | `now − lastSavedAt > 30 天` → clamp 到 30 天（T6 封顶） |
| ⑤ | 时区偏移记录 | 存 `tzOffsetMin`；本次偏移不同 → 保守按 **T1** 处理 |
| ⑥ | 校验和 | CRC32（§4.4） |
| ⑦ | 明确不做 | 不加密、不混淆、不防 DevTools |

### 3.4 固定步长与确定性（RUL-9 / ADR-104）

| 要素 | 方案 |
|---|---|
| **固定步长** | 1/30 s + 累加器 + `MAX_CATCHUP = 5`（§3.1） |
| **RNG** | **PCG32**（不用 `Math.random()`），四路独立流，见 §4.6 |
| **确定性边界** | 相同 `(初始存档, rngState, Intent 序列, dt 序列)` → 相同终态 |
| **MVP 不实现回放** | 但上述两项使回放成为"增量功能"而非"重写"（ADR-104 §6） |
| **非确定性豁免** | `cosmetic` RNG 流（微表情抖动、猫毛位置、灰尘）**不持久化**——它不影响任何可存档状态，回放时可不复现 |

---

## 4. 数据架构

### 4.1 IndexedDB Schema

```
DB 名：eaves           版本：1（schema 版本独立，见 §4.5）
┌─────────────────────────────────────────────────────────────────┐
│ store: "save"        keyPath: "slot"                             │
│   { slot: "slotA" | "slotB" | "slotArchive",                    │
│     seq: number,          // 单调递增，决定下次写哪个槽            │
│     writtenAt: number,    // Date.now()                          │
│     bodyBytes: number,    // 预校验长度                            │
│     crc32: number,        // CRC32(body)                          │
│     schema: number,       // 存档数据契约版本                      │
│     body: Uint8Array }    // UTF-8 编码的紧凑 JSON                │
├─────────────────────────────────────────────────────────────────┤
│ store: "blobs"       keyPath: "id"     ★ 独立于存档主体            │
│   { id: "cap_0007" | "jrn_0042",                                │
│     kind: "screenshot" | "journalSnapshot",                     │
│     mime: "image/webp", bytes: Blob, createdAt, refCount }      │
├─────────────────────────────────────────────────────────────────┤
│ store: "meta"        keyPath: "key"                              │
│   { key: "sessionLock", value: {tabId, acquiredAt, heartbeatAt} }│
│   { key: "settings",   value: {...} }   // 设置单独存，改设置不重写存档 │
└─────────────────────────────────────────────────────────────────┘
```

**为什么截图/日记快照放独立 store**：GDD §6.5 明确「截图不计入 `integrity` 校验——一张坏图不得导致整个存档判坏」。物理分离是最干净的实现。

### 4.2 存档写入流程（**RUL-8 三条硬要求的落地**）

#### 4.2.1 常驻的"待写入快照对象"（关键前置设计）

```ts
// 每次 tick 结束后增量更新，永不重新装配
class SnapshotAssembler {
  private pending: SaveBody = {...};       // 常驻内存，始终是可序列化状态

  onNeedsUpdated(n)    { this.pending.cat.needs = n; }
  onStateEntered(s)    { this.pending.cat.state = s; }
  // ... 其余 12 个 on* 钩子
}
```

> 🚨 **没有这个设计，RUL-8 不可能兑现。** 如果在 `visibilitychange` 回调里才去各系统搜集状态，光遍历与序列化就要 3–8 ms，且极易因为某个系统正处于中间态而写出脏数据。**回调内只允许做 3 件事：序列化、CRC32、发起写。**

#### 4.2.2 三种写入时机的处理

| 时机 | 类型 | 处理 | 预算 |
|---|---|---|---|
| 每 30 s | 增量 | `serialize → crc32 → idb.put(slot)` （异步事务，不阻塞） | < 2 ms |
| 互动成功/拒绝后、截图后、家具摆放后、离线结算后 | 关键事件 | 同上 + **同步写 localStorage 紧急槽** | < 3 ms |
| **`visibilitychange → hidden`** | **强制** | **见下 §4.2.3** | **< 2 ms** |
| `pagehide` | 双保险 | 同 `visibilitychange`（`beforeunload` 在 iOS 不可靠，不用） | < 2 ms |

#### 4.2.3 `visibilitychange → hidden` 的同步写入（**RUL-8 / TECH-2 核心**）

```ts
// platform/lifecycle.ts —— 注册时 { capture: true }，且不 await 任何东西
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;

  // ✅ ① 序列化：同步，8 KB JSON + TextEncoder ≈ 0.25 ms
  const body = assembler.serialize();              // Uint8Array

  // ✅ ② CRC32：同步，查表法，8192 次循环 ≈ 0.05 ms
  const crc = crc32(body);

  // ✅ ③ 真同步落盘：localStorage（唯一同步持久化 API）
  //    8 KB ≈ 0.15–0.4 ms（Safari 带 fsync 可能到 1–2 ms）
  try { localStorage.setItem(EMERGENCY_KEY, pack(body, crc)); } catch {}

  // ✅ ④ 主存储双槽：同步发起（事务异步完成，但已排入 IDB 队列）
  //    DB 连接常驻打开，此处绝不 await openDB()
  const slot = (lastGoodSeq & 1) ? 'slotA' : 'slotB';   // 交替，避开"上次成功"的槽
  idb.put('save', { slot, seq: lastGoodSeq + 1, body, crc32: crc,
                    schema: TARGET_SCHEMA, writtenAt: Date.now() });

  // ⛔ 以下全部禁止出现在这个回调里：
  //    await / .then() / setTimeout() / requestIdleCallback() / 任何异步编码
}, { capture: true });
```

**四条不可削减的硬规则**（写入 ADR-102，CI 可静态检查）

| # | 规则 | 检查方式 |
|---|---|---|
| **W-1** | `visibilitychange` 回调中**禁止出现 `await`、`.then()`、`setTimeout`、`requestIdleCallback`** | ESLint `no-restricted-syntax` + 人工 code review |
| **W-2** | **IndexedDB 连接必须常驻打开**（进入时 open 一次，永不 close）。回调内禁止 `await openDB()` | 断言 `idb.db !== null` |
| **W-3** | **写入槽位交替**：`slot = (lastGoodSeq & 1) ? A : B`，**绝不覆盖上一次成功写入的槽** | 单元测试 |
| **W-4** | **必须先写 localStorage 紧急槽，再写 IndexedDB**。顺序不可颠倒 | 单元测试 |

#### 4.2.4 双槽为什么能防"写一半崩溃"

- 交替写入保证：任何时刻，**至少有一个槽是上一次完整写入的结果**
- `seq` 单调递增，读档时取 `seq` 较大且 CRC 通过的那个
- 写入过程中崩溃 → 目标槽的 `seq` 虽已占位但 CRC 失败 → 自动回退另一槽
- 迁移后的旧版本存档写入 `slotArchive`，保留 7 天（GDD §6.4.2 ④），超时后覆盖

### 4.3 存档结构（`SaveBody`，扩展 GDD §5.5.1）

```jsonc
{
  "schema": 3,                          // 数据契约版本（与 ADR 版本无关）
  "crc32": 2749163520,                  // CRC32(本对象除 crc32 外的紧凑 JSON)
  "savedAtEpoch": 1785311643000,        // Date.now()
  "monotonicMs": 4128700,               // performance.timeOrigin + performance.now()
  "timezone": "Asia/Shanghai",
  "tzOffsetMin": 480,
  "dateKey": "2026-08-30",              // 04:00 分界（GDD PH2b §1.9）

  "rng": { "core": [3912847, 1029384],  // PCG32 状态（2×uint32/流）
           "journal": [882736, 5529101],
           "genesis": [1023, 88472] },  // ★ cosmetic 流不持久化

  "cat": {
    "id": "cat_01", "name": "团子",
    "genes": { "indBase": 71, "vitBase": 52, "secCap": 63,
               "coatSeed": 88371, "irisSeed": 2 },
    "personality": { "aff": 63.4, "ind": 71.0, "cur": 44.2,
                     "sec": 58.1, "vit": 55.3,
                     "affPeak": 63.4, "warmth": 80.0 },
    "needs": { "hng": 72, "ene": 40, "hyd": 65, "toi": 88, "cln": 100 },
    "state": "SLEEP_LIGHT",
    "stateEnteredAtGameMin": 1180,      // ★ 改存游戏分钟（不存 epoch），跨时钟一致
    "anchorId": "windowsill_sun",
    "position": [1.24, 0.42, -0.63],
    "facing": 138,
    "repertoire": ["slow_blink"],       // ★ 情感资产，迁移逐字节保留
    "recentBehaviors": [ /* 8 条 */ ]
  },

  "environment": {
    "timeOfDayGameMin": 1180,
    "lightmapSlot": "noon",
    "crossfadeDone": true,
    "furniture":     [ { "id":"sofa_main", "p":[0,0,0], "r":0 } ],
    "interactables": [ { "id":"cat_bowl", "filled":true, "freshness":0.62 } ],
    "traces": { "furOnRug": 14, "sofaDent": 3, "bookPage": 42, "calendarDay": 213 },
    "discoveredAnchors": ["windowsill_sun","sofa_corner","washer_top"],
    "season": "late_spring", "seasonTransition": null,
    "weather": "sunny", "weatherTomorrow": "sunny",
    "dailyDifference": { "dateKey":"2026-08-30", "tier":1, "slotId":"S01",
                         "variantId":"leaf_on_sill", "catNotices":true,
                         "catReaction":"EXPLORE", "permanent":true },
    "dailyDifferenceHistory": [ /* 10 条 */ ]
  },

  "journal": {
    "pendingSince": 1785228000000,
    "unreadCount": 2,
    "entries": [ /* 30 条上限 */ ]
  },

  "stats": {
    "totalSessions": 41, "totalOnlineSec": 18400,
    "firstSeen": 1784000000000, "lastSeen": 1785311643000,
    "screenshots": 7,
    "lastSeenSlots": ["night","night","night","night","night","night","night"]
  },

  "settings": { "audio":false, "colorblind":false, "reduceMotion":false,
                "quality":"auto", "timeScale":12, "hemisphere":"auto" }
}
```

**我对 GDD §5.5.1 的两处修正**

| # | 位置 | 修正 | 理由 |
|---|---|---|---|
| **S-1** | `stateEnteredAt: 1785311500000`（epoch） | 改为 **`stateEnteredAtGameMin`**（游戏分钟 0–1439） | epoch 与 `monotonicMs` 是两个时基，混存会让"我已经睡了多久"在时区切换/改系统时间后算错。游戏分钟是自洽的 |
| **S-2** | `integrity: "a3f9c1b2"`（十六进制字符串） | 改为 **`crc32: number` + `bodyBytes: number`** | 数字字段省 8 字节且免去字符串解析；`bodyBytes` 让长度校验可以先于 CRC 快速失败 |

### 4.4 CRC32（RUL-8 第 3 条）

| 项 | 规格 |
|---|---|
| 算法 | CRC-32/ISO-HDLC（多项式 `0xEDB88320`，与 zlib 同），查表法（`Uint32Array(256)`） |
| 覆盖范围 | `SaveBody` 除 `crc32` 字段外的紧凑 JSON 的 UTF-8 字节 |
| 成本 | 8 KB → 8192 次查表 ≈ **0.03–0.08 ms**（中端移动） |
| 校验时机 | 每次读档；**不覆盖** blob store（GDD §6.5 硬规则） |
| 失败处置 | 主槽 CRC 失败 → 试副槽 → 试 localStorage 紧急槽 → **全部失败才**进异常恢复路径（UX 路径 C），**绝不静默重置** |

### 4.5 迁移函数链（**TECH-4 答复 · 下半**）

```ts
// persistence/migrations/index.ts
type Migration = { from: number; to: number; fn: (b: any) => any };

const MIGRATIONS: Migration[] = [
  { from: 1, to: 2, fn: migrateV1toV2 },
  { from: 2, to: 3, fn: migrateV2toV3 },
  // 新增版本只在此追加，不修改既有条目
];
export const TARGET_SCHEMA = 3;

export function migrate(body: any): any {
  let v = body.schema ?? 1;
  while (v < TARGET_SCHEMA) {
    const m = MIGRATIONS.find(m => m.from === v);
    if (!m) throw new MigrationGapError(v);
    body = m.fn(body);
    v = m.to;
  }
  return body;
}
```

**五条硬规则**（GDD §6.4.2 + 我的可自动化加强）

| # | 规则 |  enforcement |
|---|---|---|
| **M-1** | 单调递增，函数命名为 `migrateV{n}toV{n+1}` | 文件命名约定 |
| **M-2** | **只增字段，不删字段**；废弃字段保留满 2 个版本后才可移除 | Code review |
| **M-3** | 迁移前先 CRC 校验；**校验失败的存档不迁移**，保留原样走异常恢复 | 代码断言 |
| **M-4** | 迁移成功后旧版存档写入 `slotArchive`，保留 **7 天** | 单元测试 |
| **M-5** | **★ 5 项情感资产逐字节保留**：`cat.name` / `cat.genes` / `discoveredAnchors` / `cat.repertoire` / blob store 全部截图与日记快照 | **自动化快照测试**：构造 v2 存档 → 迁移 → 断言这 5 项的 `JSON.stringify` 完全相等。**CI 阻断** |

> **M-5 是我把 GDD 的"硬规则"变成"可自动化断言"的一步。** GDD §6.4.2 写了这条规则但没有验证手段；我给每个新版本迁移加一个 `*.emotional-assets.spec.ts`，这让"丢猫"从"靠人记住"变成"CI 会红"。

**迁移的同步性**：迁移在读档时**同步**完成。8 KB JSON + 5 个迁移函数 ≈ **< 2 ms**。不能异步——否则玩家会看到半初始化状态。

### 4.6 全局 RNG 种子化（RUL-9 第 1 条）

| 流 | 用途 | 是否持久化 | 为什么 |
|---|---|---|---|
| `rng.core` | 行为决策抽取、三态判定、保底触发 | ✅ | 决定可观测状态 |
| `rng.journal` | 离线日记的行为/地点/评论抽取 | ✅ | 决定可观测内容 |
| `rng.genesis` | 猫的基因生成（一次性） | ✅ | 猫生下来就定了 |
| `rng.cosmetic` | 微表情抖动、猫毛位置、灰尘漂浮 | ❌ **不持久化** | 不影响任何可存档状态；不持久化可省 8 字节/存档并让回放更宽松 |

**算法**：PCG32（2×uint32 状态，~40 LOC）。不用 `Math.random()`（不可种子化）。不用 `Mulberry32`（周期 2³²，长线养成下 90 天约 10⁶ 次抽取，虽未触周期但余量不足；PCG32 周期 2⁶⁴）。

**CI 强制**：ESLint `no-restricted-properties` 禁止业务代码出现 `Math.random`（`debug/` 目录豁免）。

### 4.7 内存态与持久态的边界

| 数据 | 内存态 | 持久态 | 说明 |
|---|---|---|---|
| 5 维性格 / 4 需求 | ✅ 可变 | ✅ | 唯一的真相来源 |
| `warmth` / `AFF_peak` | ✅ | ✅ | RUL-5 |
| `rng.cosmetic` | ✅ | ❌ | 不持久化 |
| 当前 slot / crossfade 进度 | ✅ | 部分（`lightmapSlot` + `crossfadeDone`） | 进入时若在中点则不播淡入（GDD E-L1） |
| 日记快照 Blob | 弱引用缓存（最近 5 张） | ✅（`blobs` store） | 相册翻页时才加载 |
| 截图 Blob | 弱引用缓存 | ✅（`blobs` store） | **系统永不自动删除**（G-M3，代码审查项） |
| 场景图 / Three.js 对象 | ✅ | ❌ | 从存档重建 |
| 动画 mixer 内部状态 | ✅ | ❌ | 重建时从 `state` + `stateEnteredAtGameMin` 推算 |
| **"玩家是否发现"类字段** | ❌ | ❌ | **GDD PH2b §1.9 明确禁止**：`discovered` / `foundBy` / `viewedAt` / `foundCount` / `streak` 一个都不许存在 |

---

## 5. 猫的模拟层

### 5.1 五维性格系统

> **本章只定义数据结构、结算时机与持久化契约。数值规则（增长率、衰减、调制公式）全部以 GDD §3.3 为准，我不复制也不修改。**

| 维度 | 字段 | 结算时机 | 持久化 |
|---|---|---|---|
| `AFF` 亲密度 | `cat.personality.aff` | 性格结算 tick（60 s）+ 互动后即时 | ✅ |
| `AFF_peak` 历史峰值 | `affPeak` | 同上（单调递增） | ✅ |
| `warmth` 记忆温度 | `warmth` | 同上 + 离线结算 | ✅ |
| `IND` 独立度 | `ind` | 基因锁定，±0.5/月漂移，clamp 在初值 ±8 | ✅ |
| `CUR` 好奇心 | `cur` | 性格结算 tick | ✅ |
| `SEC` 安全感 | `sec` | 同上，`SEC_cap` 基因锁定 | ✅ |
| `VIT` 活力 | `vit` | 性格结算 tick | ✅ |
| 4 需求 | `needs.{hng,ene,hyd,toi}` | 需求 tick（1 Hz） | ✅ |

**派生量（不持久化，每次读取时计算）**

| 量 | 公式 | 计算频率 |
|---|---|---|
| `ENE_max` | `60 + VIT × 0.4` | 需求 tick |
| `ENE_rec` | `(2.0 + VIT×0.04) × (0.6 + VIT/125)` 点/分 | 需求 tick |
| `CUR_eff` | `CUR × (0.4 + 0.6 × SEC/100)` | 行为决策 tick |
| `AFF_eff` | `AFF × (0.5 + 0.5×SEC/100) × (1.15 − IND/250)` | 行为决策 tick、三态判定 |

**硬约束（GDD §3.6 的程序侧落实）**

| GDD 编号 | 约束 | 实现 |
|---|---|---|
| E1-2 | 仲裁顺序固定不并列：HIDE > 生理驱动 > 性格加权 | `behavior-arbiter` 的优先级常量，单元测试断言 |
| E1-6 | 所有 U 值 < 0.05 → fallback REST + `console.warn` | 断言分支，测试覆盖 |
| E1-7 | 互斥需求优先级 **ENE > HNG > HYD > TOI** | 常量表，测试覆盖 |
| E1-8 | SEC=10 时启用「静默陪伴」+1.5/分钟 | 状态机分支，测试覆盖 |
| §3.4 | **状态机无终止态，强连通，HIDE/SLEEP_DEEP 必有出口** | **属性测试（property test）**：从任意状态随机走 10⁴ 步，断言强连通且无吸收态 |

### 5.2 状态机

**15 状态 / 6 域的自写轻量 HFSM**（不引入 XState，理由见 Phase 1 Q4：bundle 大、Actor 模型过重，本作只需 currentState + 加权转移，约 500 LOC）。

```ts
type CatState =
  | 'BOOT' | 'WARMUP'                                    // 启动域
  | 'SLEEP_DEEP' | 'SLEEP_LIGHT' | 'REST'                // 睡眠/清醒域
  | 'EAT' | 'DRINK'                                      // 清醒域
  | 'EXPLORE' | 'PLAY' | 'WATCH_WINDOW' | 'GROOM'        // 清醒域
  | 'HIDE'                                               // 退缩域（最高优先级）
  | 'SEEK_ATTENTION' | 'PETTED'                          // 社交域（presence 门控）
  | 'ALERT' | 'REJECT' | 'TRANSIT';                      // 瞬时域
```

**转移优先级**（GDD §3.4 表）

| 优先级 | 转移 | 可打断 |
|---|---|---|
| **最高** | 任意 → `HIDE`（`SEC<30` / 惊吓 / 连续 2 次强制互动） | 是（含 `PETTED`） |
| 高 | 任意 → `ALERT`（噪声事件） | 是 |
| 正常 | 其余全部 | `TRANSIT` 不可打断（除非 HIDE） |

**最小驻留保护**（防抖动）：驻留时长 × 0.4（GDD §3.5）。实现为 `state.minDwellGameMin` 与 `stateEnteredAtGameMin` 的差值比较，**用游戏分钟而非真实秒**——这样 ×12 加速下驻留仍在游戏时间上正确。

### 5.3 行为仲裁

```
U(b) = Base(b) × P(b) × D(b) × C(b) × H(b) × N(b)
raw(b)   = U(b) / Σ U
sharp(b) = raw(b)^1.60 / Σ raw^1.60
p(b)     = 0.92 × sharp(b) + 0.08/|候选|
按 p(b) 加权抽取（rng.core）
```

**实现约束**：候选项权重存 `Float32Array(16)`，每 tick 覆写不分配（§3.2.4）。`C(b)` 昼夜节律修正查 **`circadianBand`（5 档固定钟点）**，**不查 `timeSlot`（4 档随季节漂移）**——这是 GDD R-3 修订的核心，程序侧必须以两个独立枚举实现。

### 5.4 表现层映射：8 morph + 骨骼 + shader

#### 5.4.1 三条通道的分工（落实 GDD §7 附录 B）

| 通道 | 承载内容 | 更新频率 | 成本 |
|---|---|---|---|
| **8 morph targets** | `m_Ear_Back_Flat` / `m_Ear_Forward` / `m_Eye_Squint` / `m_Eye_Wide` / `m_Mouth_Open` / `m_Mouth_Flehmen` / `m_Brow_Knit` / `m_Face_Squash` | 微表情 tick（4 Hz）更新**目标值**，渲染帧上缓动 | 见下 |
| **骨骼** | 尾巴 8 节链 / 耳朵 3 节 ×2 / 胡须 12 根 / 头颈躯干 | 渲染帧（程序化呼吸/摆动）+ 动画 clip | 见下 |
| **shader uniform** | `pupil_dilate`（`= base + emotion + light`）、SSS 强度、rim light | 渲染帧 | ~0（纯 uniform 写入） |

#### 5.4.2 8 morph 的内存核算（落实 B-1：关闭 morph normals）

```
猫：20,000 tris → 约 11,000 vertices
Three.js morph texture：DataArrayTexture，每顶点 1 texel (RGBA16F = 8 B)，每 morph 1 layer

  开 normals：8 morph × 2 属性 × 11,000 × 8 B = 1.41 MB
  关 normals：8 morph × 1 属性 × 11,000 × 8 B = 0.70 MB
  → B-1 直接省下 0.70 MB 显存
```

> **B-1 的价值确认**：关闭 morph normals 省 **0.70 MB**。单看这个数字不大，但它在低端机（纹理预算 64 MiB）上是 1.1%，且省掉的是 GPU 每个 morph 顶点的一次额外纹理 fetch。**采纳，无条件。**

#### 5.4.3 猫的 CPU/GPU 成本核算

| 项 | 预算 | 核算 | 备注 |
|---|---|---|---|
| 三角面 | ≤ 20,000（可上探 30k） | 20,000 | RUL-2 |
| 顶点数 | — | ≈ 11,000 | tris:verts ≈ 1.8:1 |
| 几何内存（GPU） | ≤ 1.5 MB | **0.80 MB**（pos 132 KB + nrm 132 KB + uv 88 KB + skin 264 KB + idx 120 KB @Uint16） | |
| Morph texture | ≤ 1.0 MB | **0.70 MB**（关 normals） | B-1 |
| 动画 clips（12 姿态） | ≤ 1.5 MB | **≈ 1.0 MB**（12 × ~80 KB） | 按需懒加载：首屏 4 个，P1 再 4 个，P3 余 4 个 |
| 骨骼数 | ≤ 64 | **≈ 58**（脊柱 5 + 四肢 4×4 + 尾 8 + 耳 2×3 + 胡须 12 + 头 1 + 根 1） | 移动端 GPU skinning 上限通常 128，安全 |
| Skinning | GPU | Three.js 默认 GPU skinning（`SkinnedMesh`），**CPU skinning 关闭** | |
| Draw call | 1（+1 shadow） | 1（+1 shadow pass） | 猫永远 LOD0，`frustumCulled = false` |
| 每帧 CPU 成本 | ≤ 1.0 ms | **0.35–0.60 ms**（mixer.update + morph uniform 上传 + bone texture 更新） | 60 骨骼 bone texture（RGBA32F 4×16）= 4 KB/帧上传 |

#### 5.4.4 与动画层的接口

```ts
// presentation/cat-view.ts —— 唯一的 sim → 渲染 接口
interface CatExpressionTarget {
  earBack: number; earForward: number;     // morph #1 #2
  eyeSquint: number; eyeWide: number;      // morph #3 #4
  mouthOpen: number; mouthFlehmen: number; // morph #5 #6
  browKnit: number; faceSquash: number;    // morph #7 #8
  pupilDilate: number;                     // shader uniform
  tailPose: TailPose;                      // 骨骼目标（8 节）
  earYawL / earYawR: number;               // 骨骼目标（Ear-ack 用）
  whiskerSpread: number;                   // 骨骼目标
  breathAmp: number; breathRate: number;   // 程序化
}
```

- **微表情 tick（4 Hz）只更新 `CatExpressionTarget` 的字段值**（纯数值，20 个 float 赋值，0.10 ms）
- **渲染帧**上把当前值向目标值缓动（`damp(current, target, lambda, dt)`），再写入 `morphTargetInfluences` 与骨骼
- **Ear-ack 的实现**：`earYaw` 目标值设为 15–25°，`0.4 s` 后回到 0，纯骨骼，**0 morph 成本**（GDD §4.4.1）

---

## 6. 光照管线（**RUL-1 全章落地**）

### 6.1 画面构成模型

```
最终画面
  = lightmap(slot)                                    ← 基数 4（降级后 2），索引只接受 slot 一个参数
  × 主光(direction: slot 过渡窗插值;
         color/intensity: slot × season × weather)
  × 色彩分级 LUT(season × weather)                    ← 参数化，12 组常量
  + 室内灯(实时 Point/Spot，玩家可控)
  + 窗外景物(season，4 套 C 档树)
  + 可换道具(season)
```

> ✅ **lightmap 索引 = f(slot)，基数 4，与 |season| × |weather| = 12 无关。** 这是 GDD PH2b §3.7 的守恒证明，架构上以 `LightmapManager.setSlot(slot)` 的**单参数签名**强制（A-L1 静态审查项）。

### 6.2 4 套 lightmap 的资产管理

| 项 | 规格 |
|---|---|
| 文件 | `lm_morning.ktx2` / `lm_noon.ktx2` / `lm_dusk.ktx2` / `lm_night.ktx2` |
| 分辨率 | **2048²**（恒定。4096² 需主理人重开 RUL-1，见 §6.6） |
| 编码 | **UASTC LDR 4×4 + KTX2 zstd 超压缩**；Android 兼容档回退 ETC1S |
| 单套显存 | **4.0 MiB**（UASTC→ASTC 4×4 / ETC2 EAC，8 bpp）｜ Android ETC1S 路径 **2.0 MiB** |
| 单套下载 | **0.6–1.4 MB**（zstd 后约 2.0–2.8 bpp） |
| mipmap | **关闭**（正交 3 档 zoom，采样频率恒定；省 33% 显存） |
| UV | **UV1**（第二套 UV），全场景唯一展开，不重叠 |

**加载时序**（对齐美术 §8.3，我做了修正）

| 阶段 | 原（美术 §8.3） | **修正后** | 理由 |
|---|---|---|---|
| P0（0–1 s） | 1 张 lightmap | **当前 slot 的 1 套**（0.6–1.4 MB） | 一致 |
| P1（1–3 s） | — | **+ 相邻 slot 的 1 套**（后台，0.6–1.4 MB） | crossfade 需要目标套在位 |
| P2（3–5 s） | 季节 lightmap | — | **删除**（季节不走 lightmap，RUL-1） |
| P3（5–8 s） | — | **+ 剩余 2 套**（后台预取，1.2–2.8 MB） | 覆盖"玩家改系统时间跨多时段"的异常路径 |

**驻留策略（关键优化）**

```
稳态驻留 2 套：当前 slot + 下一时段 slot          → 8.0 MiB（ASTC）
crossfade 瞬态 3 套：当前 + 目标 + 下一时段        → 12.0 MiB（持续 0.8 s）
异常路径 4 套：玩家跨多时段进入                    → 16.0 MiB（一次性，之后回落 2 套）
```

> **这个置换策略把稳态显存从 4 套降到 2 套（8.0 MiB），同时保留 4 套的完整视觉。** 异常路径（跨多时段进入）会有一次 ~30–80 ms 的贴图上传 hitch，但它只发生在"玩家改了系统时间"这种非正常场景，且此时本来就要进离线结算的遮罩。

### 6.3 0.8 s 交叉淡入的驱动逻辑（落实 GDD PH2b §3.4.2）

```
过渡窗（Transition Window）= 45 游戏分钟
  ├─ 边界 −22.5 游戏分钟：主光开始插值  ─┐
  ├─ 边界（= slot 边界，进度 0.5）：     ├─ ×12 下 = 225 真实秒 = 3.75 分钟
  └─ 边界 +22.5 游戏分钟：主光插值结束  ─┘
              │
              ▼ 进度跨过 0.5 且 crossfadeDone == false
      ┌───────────────────────────────┐
      │ lightmap 0.8 s 交叉淡入        │
      │ = lightMapMix: 0 → 1           │
      │ = smoothstep(0, 1, t / 0.8 s)  │  ← t 是真实秒
      │ 完成后：slot = to，A ← B，mix ← 0│
      └───────────────────────────────┘
```

| 边界情况 | 处理 |
|---|---|
| **E-L1** 玩家恰好在中点 ±0.5 游戏分钟进入 | **不播放淡入**，直接设 `lightMapMix = 正确的静态混合值`（按进入时的进度计算）。读到"进入就看到一次淡入"会被读成加载动画 |
| ×12 加速下跨过整个过渡窗 | 正常播放（GDD E-L2，特性不是 bug） |
| 玩家在 crossfade 进行中切后台 | `lightMapMix` 不持久化；回来时按当前进度重新判定，若已过中点则直接完成 |

### 6.4 crossfade 的 shader 实现（**关键技术决策**）

Three.js 的 `MeshStandardMaterial.lightMap` 只支持**单一 sampler**。做 crossfade 有两条路：

| 方案 | 实现 | Draw call 影响 | 判定 |
|---|---|---|---|
| **双 mesh 叠加 alpha blend** | 每个受光物件复制一份，A 用 lightmapA、B 用 lightmapB，`material.opacity = mix` | **A 档 5 件 +5，B/C 档 batch +5 = +10~12** | ❌ **否决**：移动端 draw call 从 28 涨到 ~40，且 alpha blend 在 fill rate 上是额外一整遍 overdraw |
| **`onBeforeCompile` 注入双 sampler**（✅ 采纳） | 替换 `<lights_fragment_maps>` 中的 lightmap 采样段 | **0** | ✅ |

**注入代码（要点）**

```glsl
// 注入 uniform
uniform sampler2D lightMapA;
uniform sampler2D lightMapB;
uniform float     lightMapMix;    // 0 → A, 1 → B

// 替换内置的 lightmap 采样
vec4 lmSample = mix(texture2D(lightMapA, vLightMapUv),
                    texture2D(lightMapB, vLightMapUv),
                    lightMapMix);
vec3 lightMapIrradiance = lmSample.rgb * lightMapIntensity;
```

**四个必须注意的实现细节**

| # | 细节 | 为什么 |
|---|---|---|
| **C-1** | **只编译 1 个 program 变体**（A/B sampler 恒存在于 shader 中） | crossfade 只改 uniform → **零 shader 重编译**。这直接消解了风险 T-4（shader 编译卡顿） |
| **C-2** | **稳态下把 `lightMapB` 指向一张 1×1 白色纹理，`lightMapMix = 0`** | 稳态只有 1 次有效纹理采样 + 1 次 1×1 采样（近乎免费）。**稳态零额外成本** |
| **C-3** | 必须定义 `material.customProgramCacheKey` | 否则 Three.js 可能把这个 program 与其他 standard material 共享，导致 uniform 丢失 |
| **C-4** | 注入点锚定 `<lights_fragment_maps>` 这个 shader chunk 名 | Three.js r→r 升级时若该 chunk 改名会静默失效。**必须 Spike 验证 + 升级回归测试**（风险 T-5） |

**成本核算**

| 项 | 中端移动（1600×900） | 说明 |
|---|---|---|
| 稳态（B = 1×1） | **≈ 0 ms** | 1 次有效采样，与不用 crossfade 相同 |
| crossfade 进行中（0.8 s 内） | **+0.3–0.6 ms/帧** | 2 次 2048² ASTC 采样；第二次大概率 L1/L2 cache 命中 |
| 桌面（2560×1440） | **+0.8–1.5 ms/帧**（仅 crossfade 中） | |

> 0.8 s 内的 +0.3–0.6 ms 落在 16.6 ms 预算内，且此时玩家正在看光影变化，不会触发降档检测（降档检测要求连续 3 s 超标）。

### 6.5 🚨 4 套 lightmap 的显存实测核算（RUL-1 降级判据）

> **RUL-1 ② 原文**：「程基岩在 Phase 3 核算 4 套 2048² lightmap 在中端移动端的实际显存占用，**若超过预算 60% 则降为 2 套（昼/夜）+ Color Grading LUT 补足中间态**」。

#### 6.5.1 判据的明确定义

我先把判据定义清楚，否则"预算 60%"有歧义：

> **降级判据** ＝（4 套 lightmap 全部常驻 GPU 时的显存占用）÷（中端移动**纹理内存工程红线**）> 60%

**中端移动纹理内存红线 = 96 MiB**（不是 Phase 1 写的 128 MiB）。修正理由：Phase 1 的 128 MiB 是"GPU 侧纹理分配理论上限"；**工程红线必须扣除 Render Target 占用**：

| Render Target（中端移动 1600×900） | 占用 |
|---|---|
| 主 framebuffer（RGBA8 + D24S8，7 B/px） | 9.61 MiB |
| Shadow map 1024² D32 | 4.00 MiB |
| 后处理 1/4 降采样 ping-pong ×2 RGBA8 | 0.69 MiB |
| 日记离屏 RT 512² RGBA8（常驻） | 1.00 MiB |
| SMAA / 边缘缓存 | 0.50 MiB |
| **RT 合计** | **15.80 MiB** |

→ **96 MiB（纹理）+ 15.8 MiB（RT）= 111.8 MiB GPU 侧总量**，为驱动内部缓冲与 iOS 内存压力留 16 MiB 余量。**红线 = 96 MiB，降级阈值 = 57.6 MiB。**

#### 6.5.2 核算结果

| 编码路径 | 单套 | **4 套总显存** | 占 96 MiB | 是否触发降级 |
|---|---|---|---|---|
| **UASTC → ASTC 4×4（iOS 主路径）** | 4.0 MiB | **16.0 MiB** | **16.7%** | ❌ **否** |
| **UASTC → ETC2 EAC（Android 高质）** | 4.0 MiB | **16.0 MiB** | **16.7%** | ❌ **否** |
| **ETC1S → ETC1（Android 兼容路径）** | 2.0 MiB | **8.0 MiB** | **8.3%** | ❌ **否** |
| ⚠️ 未压缩 RGBA8（无 KTX2 支持回退） | 16.0 MiB | **64.0 MiB** | **66.7%** | ✅ **触发** |
| ⚠️ 4096² ASTC 4×4（若分辨率上探） | 16.0 MiB | **64.0 MiB** | **66.7%** | ✅ **触发** |
| ⚠️ 2048² RGBA8 + mipmap | 21.3 MiB | **85.3 MiB** | **88.9%** | ✅ **触发** |

#### 6.5.3 完整纹理预算表（中端移动，核算值）

| 项 | 显存 |
|---|---|
| 猫 albedo 1024² ASTC 4×4 | 1.33 MiB |
| 猫 normal 1024² ASTC 4×4 | 1.33 MiB |
| 猫 ORM/SSS mask 512² | 0.33 MiB |
| 环境 Atlas albedo 2048² ETC2 | 4.00 MiB |
| 环境 Atlas normal 2048² ASTC | 4.00 MiB |
| C 档 Atlas albedo 1024² | 1.33 MiB |
| **lightmap 稳态驻留 2 套** | **8.00 MiB** |
| lightmap crossfade 瞬态第 3 套 | 4.00 MiB |
| 3D LUT 32³ RGBA8 | 0.14 MiB |
| 窗外天空 512² equirect | 1.33 MiB |
| 痕迹/UI 图集 512² | 0.33 MiB |
| 毛发卡片 Atlas 512²（Standard） | 0.33 MiB |
| **合计（稳态）** | **26.45 MiB** |
| **最坏（4 套 lightmap 全常驻）** | **34.45 MiB（35.9%）** |
| **余量** | **69.55 MiB（72%）** |

#### 6.5.4 ✅ 结论

> ## **不触发降级。按 RUL-1 主路径执行：4 套 2048² lightmap。**
>
> 占用 **16.0 MiB / 96 MiB = 16.7%**，距 60% 阈值（57.6 MiB）有 **3.6 倍余量**。
>
> 稳态实际只驻留 2 套（**8.0 MiB = 8.3%**），因为 crossfade 只需"当前 + 目标"两套在场。
>
> **降级路径保留但不激活**，它在两个明确条件下会被触发（§6.6）。

#### 6.5.5 敏感性分析（什么情况下会触发）

| 触发条件 | 概率 | 我的处置 |
|---|---|---|
| **设备不支持 KTX2 / ASTC / ETC2**（2026 年 < 2% 设备，主要是老 Android WebView） | 低 | **回退路径强制**：lightmap 降为 **2 套 + 1024² + RGB565** = 2 × 2.0 = **4.0 MiB**。分辨率与套数同时降，所以回退路径反而不触发降级 |
| **分辨率上探到 4096²** | — | **架构硬约束拒绝**。需要改这条约束必须主理人重开 RUL-1，因为 4096² × 4 套 = 64 MiB = 66.7%，会触发 |
| **mipmap 被误开**（应关闭） | — | CI 断言 `lightmap.generateMipmaps === false` |
| 未来有人提"给每个季节加 1 套 lightmap" | — | **被 GDD PH2b §3.7.3 硬闸门拦截**（检查项 1 → 🔴 必须重新评审）。架构侧以 `setSlot(slot)` 单参数签名二次拦截 |

### 6.6 降级路径（保留但不激活）

**降级配置**：2 套（昼 / 夜）+ Color Grading LUT 补足中间态。

| 降级后的行为 | 说明 |
|---|---|
| `slot_morning` → 复用 `lm_day` | 晨与午共用昼套 |
| `slot_dusk` → 复用 `lm_day` | 昏与午共用昼套 |
| `slot_night` → `lm_night` | 夜套独立 |
| crossfade 只在 **昼↔夜** 之间发生（每 24 游戏小时 2 次，而非 4 次） | |
| LUT 补足 | `lm_day` 之上叠加「晨」与「昏」两组色彩分级参数（4 组 slot 参数，0 资产成本） |

#### 降级后的表现损失量化（主理人问的第 2 点）

| 维度 | 损失 | 量化 |
|---|---|---|
| **仍然保留** | 主光 direction/color/intensity 实时插值 | 光斑**位置与颜色仍在动**，G-L1（5 分钟看到时间在走）**仍然达成** |
| **仍然保留** | 昼夜的阴影差异 | 支柱二的核心（"光会移动"）**不倒** |
| **损失 1** | 晨/昏的**间接光软阴影形状**不再变化 | 晨（斜入 30–45°）与昏（极长投影）共用同一套烘焙 → **窗框投影的软边、灰尘光柱的入射角、地面反弹光的分布在晨与昏之间是相同的** |
| **损失 2** | 光色变化幅度变窄 | 由 LUT 补回约 60–70%（LUT 能改色温与对比，改不了光的空间分布） |
| **可察觉性** | **ΔE ≈ 6–10（CIEDE2000）**，人眼可辨阈值约 ΔE 2.3 | **能看出来，但不是"跳变"**——它被 0.8 s crossfade + 45 游戏分钟主光插值掩盖 |
| **最坏场景** | 连续在"晨 → 昏"之间横跳的玩家会发现"早晨和傍晚，屋里影子的软边是一样的" | **需要对比才能发现**。这是降级后唯一可能被玩家察觉的缺陷 |
| **对比：若降为 1 套** | 昼夜无差别 | **支柱二直接被抽空**（RUL-1 的理由）。1 套不可接受 |

> **我的判断**：降级到 2 套是**可接受的中等损失**，远小于 1 套。**RUL-1 定 2 套而非 1 套是对的**——它把损失限制在"晨昏的间接光不区分"，而保住了"昼夜有别的阴影"这一支柱二的核心。
>
> 📌 **同时确认 GDD PH2b §9 的 R-1 硬冲突**：前半段 GDD §5.4.4 写的"降级为 1 套"是错的，**以 RUL-1 的 2 套为准**。请文策渊在 v1.1 回填时同步改写 §5.4.4 的"策划侧补偿方案"表——该表是按 1 套写的（"阴影不再分四档变化"），按 2 套应改为"阴影不再区分晨/昏，但仍区分昼夜"。

### 6.7 季节与天气（一律不走 lightmap）

| 变量 | 通道 | 资产成本 | 运行时成本 |
|---|---|---|---|
| **季节色温** | 主光 `color` 偏移（春 ±0 / 夏 +200K / 秋 −100K / 冬 −300K） | 0 | 0 |
| **季节色调** | 色彩分级参数（4 组） | 0 | 0 |
| **季节窗外** | 4 套 C 档树模型（各 ~1.5k tris, ~80 KB glb） | 320 KB 总计，**按需加载当前季 1 套 + 预取下一季** | swap 时一次 ~15 ms hitch（**必须在玩家离线时执行**，GDD §3.5.4 / E-L3） |
| **季节可换道具** | ~12 件小道具（各 ≤800 tris） | ~200 KB |  negligible |
| **季节昼长** | **改变 4 个 slot 的时刻边界**（`slot-table.ts` 查表 + 7 天线性插值） | **0** | 0 |
| **天气强度/色温** | 主光 `intensity` ×(1.00/0.55/0.35)，`colorTemp` +（0/+300/+200 K） | 0 | 0 |
| **天气投影** | `weather === 'sunny'` 才开 shadow map | 0 | 阴/雨天**反而省 0.5–1.0 ms** |
| **雨天窗户** | 玻璃水珠 shader（美术 §5.3 已预算 2 人日） | 已计入 | ~0.2 ms |
| **色彩分级总组数** | 4 季 × 3 天气 = **12 组常量**，每组 8 个 float | **384 B** | 0 |

**色彩分级的实现选型**

| 方案 | 纹理成本 | 质量 | 判定 |
|---|---|---|---|
| 32³ 3D LUT | 0.14 MiB | 高（可精确匹配美术调色） | ✅ **Standard 采纳**（成本可忽略） |
| 参数化 lift/gamma/gain/sat/temp | **0** | 够用 | ✅ **MVP 采纳**（省掉美术做 LUT 的工时） |
| 256×16 2D tone curve | 0.02 MiB | 中 | 备选 |

**MVP 用参数化**（美术无需产出 LUT 资产）；Standard 若美术要求精确调色，再上 32³ 3D LUT（0.14 MiB，可忽略）。

**⚠️ 后处理顺序（修正美术 §8.5）**

```
scene render → [ACESFilmicToneMapping：Three.js 内置，在 material shader 末尾]
             → RT
             → tilt-shift（1/4 降采样模糊）
             → 色彩分级（季节/天气）   ★ 必须在 ACES 之后，否则会被 ACES 再压一遍
             → vignette
             → screen
```

---

## 7. 渲染管线

### 7.1 Three.js 版本与引入方式（ADR-101）

| 项 | 决策 |
|---|---|
| **版本** | **锁定 r172**（`three@0.172.0`） |
| **为什么不用 r160** | r160 缺 `BatchedMesh`（r159+ 才有）、morph/SSS 支持弱于 r170+ |
| **为什么不用 r18x** | r18x 处于 `WebGPURenderer` 重构期，WebGL 路径 API 不稳定；`onBeforeCompile` 的 chunk 结构可能变动 |
| **引入方式** | **importmap 固定版本 + 原生 ESM**，符合用户"少文件、零构建"偏好 |
| **构建** | **零构建可部署**：`src/` + `vendor/three/` 直接静态托管，importmap 指向本地。**Vite 仅用于 dev server（HMR）**，不参与产物 |
| **WebGL2** | **强制**。不支持 → 显示"请升级浏览器"页（2026 年 WebGL2 渗透率 > 95%） |
| **色彩** | `outputColorSpace = SRGBColorSpace`；`toneMapping = ACESFilmicToneMapping`；`toneMappingExposure = 1.0` |
| **抗锯齿** | 桌面 SMAA；移动 `antialias: false` + SMAA（iOS WebGL2 的 MSAA 实际不生效或极贵） |
| **后处理** | **不引入 `EffectComposer`**，自写 3 个 pass 的薄管线。理由：`EffectComposer` 会额外分配 2 张全分辨率 RT（中端移动 +9.6 MiB）且强制 `preserveDrawingBuffer` 友好的多 pass 复制；我们只需 1 张 1/4 分辨率 ping-pong + 1 次全屏合成 |

### 7.2 正交投影

| 项 | 规格 |
|---|---|
| 相机 | `OrthographicCamera` |
| 俯角 / 方位角 | 俯视 **30°** / 方位 **45°**（美术 §5.5） |
| 3 档 zoom | **远 = viewSize 6.0 m｜中 = 4.0 m｜近 = 2.4 m**（世界单位视口高度） |
| frustum | `left = -viewSize*aspect/2`，`right = +...`，`top = viewSize/2`，`bottom = -...` |
| 阻尼 | `lerp(current, target, 0.1)`（美术 §5.5 的"慢"） |
| 旋转限制 | 水平 360° / 垂直 ±15° |
| **禁用** | 自由 zoom（美术 §5.5）、透视投影（破坏 tilt-shift 与微缩感） |

### 7.3 资产加载与 LOD

| 阶段 | 时间 | 内容 | 累计下载（中端移动） |
|---|---|---|---|
| **P0** | 0–1 s | HTML/CSS/JS（Three core 170 KB + 业务 120 KB）、猫 LOD0 + 4 姿态、猫贴图、**当前 slot lightmap 1 套**、地板/墙 shell、字体子集 | **≈ 1.9 MB** |
| **P1** | 1–3 s | A 档 5 件（沙发/书架/茶几/窗/灯）、环境 Atlas、**相邻 slot lightmap 1 套**、猫 4 姿态 | **≈ 3.3 MB** |
| **P2** | 3–5 s | B 档 10 件（合并 batch）、C 档 Atlas、窗外天空 | **≈ 3.8 MB** |
| **P3** | 5–8 s | 剩余 B/C 档、**剩余 2 套 lightmap**、剩余 4 姿态、季节资源（按需） | **≈ 5.6 MB**（后台，无感知） |

> ⚠️ **首屏（P0+P1）核算 3.3 MB，中端移动预算 3.5 MB → 余量 0.2 MB（6%）。这是紧的。** 已列为风险 **T-13**，缓解手段：① 环境 Atlas 从 2048² 降到 1024²（−0.75 MB）② A 档拆两批（沙发/窗 P0，其余 P1）。**需要林绘澄确认 Atlas 分辨率能否降到 1024²。**

**LOD 策略**

| 档 | LOD | 切换 |
|---|---|---|
| 猫 | **不做 LOD**（情感核心，RUL-2 共用一个模型） | — |
| A 档家具 | 2 档（LOD0 100% / LOD1 30%） | 按 zoom 档：远景用 LOD1 |
| B 档 | 3 档（100% / 40% / 10%） | 按 zoom 档 |
| C 档 | 无 LOD，合并为 1–2 个 `mergeGeometries` 批次 | — |

**几何压缩**：**meshopt**（decoder ≈ 12 KB gzip）而非 Draco（≈ 180 KB gzip）。首屏预算下 meshopt 更合适（Phase 1 §4.2 已定）。

### 7.4 移动端 3 档降级（ADR-106）

| 项 | **H 高端** | **M 中端** | **L 低端** |
|---|---|---|---|
| 参考设备 | iPhone 14+ / Snap 8 Gen2+ | iPhone 11 / Snap 7 Gen1 | iPhone SE2 / Snap 6 Gen1 |
| DPR | 1.5 | 1.25 | 1.0 |
| 渲染分辨率 | 1920×1080 | 1600×900 | 1280×720 |
| 目标帧率 | 60 fps | 60（H 模式）/ 30（M 模式） | **30 fps 锁定** |
| Draw call | ≤ 80 | ≤ 60 | ≤ 45 |
| 三角面（视口内） | ≤ 220,000 | ≤ 150,000 | ≤ 100,000 |
| 动态光源 | 4 | 3（1 dir + 1 hemi + 1 point） | 2（1 dir + 1 hemi） |
| 实时阴影 | PCFSoft 1024² | Basic 1024² | **关**（blob shadow） |
| 阴影时段 | 06:00–18:00（GDD §5.4.4） | 同 | 不适用 |
| tilt-shift | 开（1/4 降采样） | 开（1/4 降采样） | **关**（仅 vignette） |
| 色彩分级 LUT | 3D LUT / 参数化 | 参数化 | 参数化 |
| AA | SMAA | SMAA | 关 |
| lightmap | 2048²，驻留 2 套 | 2048²，驻留 2 套 | **1024²，驻留 2 套** |
| 毛发卡片（Standard） | ≤ 40 张 alpha-hash | 0（法线烘焙） | 0（法线烘焙） |
| 灰尘/猫毛 VFX | 开 | 开（数量 ×0.6） | 关 |
| 纹理内存红线 | 256 MiB | **96 MiB** | **64 MiB** |
| JS 堆红线 | 120 MB | 60 MB | 45 MB |

**分档触发链**：UA + GPU 能力探测初分 → 首帧后 1 s benchmark（渲染 N 帧测中位帧时间）→ 连续 3 s 帧时间 > 1.2× 预算自动降一档 → **用户可在设置中手动覆盖**（美术 §8.4）。

> ⚠️ **`WEBGL_debug_renderer_info` 在现代浏览器中已被限制/伪造**，GPU 字符串只能作为**弱提示**，不能作为分档的唯一依据。真实依据是 **1 s benchmark**。

### 7.5 后处理成本核算

| Pass | 分辨率 | 桌面 2560×1440 | 中端 1600×900 | 低端 1280×720 |
|---|---|---|---|---|
| tilt-shift 降采样 + 模糊 H | 1/4 | 0.18 ms | 0.12 ms | 关 |
| tilt-shift 模糊 V | 1/4 | 0.18 ms | 0.12 ms | 关 |
| 合成 + 色彩分级 + vignette | 全分辨率 | 1.55 ms | 0.55 ms | 0.35 ms |
| **合计** | | **1.91 ms** | **0.79 ms** | **0.35 ms** |
| 占帧预算 | | 11.5% | 4.8% / 2.4% | 1.1% |

> ✅ **1/4 分辨率降采样模糊让 tilt-shift 在全档位都能开**（Phase 1 §4.5 结论保持有效）。桌面 1.91 ms 是唯一需要盯的项（占 16.6 ms 的 11.5%），若实测超标，第一步是把合成 pass 的 vignette 合进 tilt-shift 的上采样 pass（省一次全屏遍历）。

### 7.6 VFX 预算（对齐美术 §7，防"粒子堆砌"）

> 用户明确反感的反模式包括**粒子堆砌**。以下为硬上限：

| VFX | 粒子上限 | 实现 | 预算 |
|---|---|---|---|
| 灰尘光柱 | **≤ 120** 点精灵（不是粒子系统） | 单个 `Points` + shader 漂移 | 0.15 ms |
| 猫毛飘落 | **≤ 24** 条 Line | 复用痕迹系统 | 0.03 ms |
| 窗玻璃水珠 | **0 粒子**，纯 shader normal 动画 | shader | 0.20 ms |
| 台灯光晕 | **0 粒子**，billboard + radial gradient 纹理 | 1 quad | 0.02 ms |
| **系统总上限** | **任何时刻屏幕内粒子 ≤ 150** | — | **≤ 0.4 ms** |

---

## 8. 互动与反馈系统

### 8.1 可交互物件的检测

| 目标 | 检测方式 | 成本 |
|---|---|---|
| **猫身** | **4 个低模代理体**（头球 / 身胶囊 / 尾根球 / 腹球）作 raycast 目标，**不用 20k mesh** | **0.05 ms** |
| **B/C 档物件** | 已合并成 batch mesh → raycast 返回 `faceIndex` → **按面区间二分查找** `objectId`（合并时记录每件的 [startFace, endFace]） | **0.08 ms** |
| **A 档家具** | 独立 mesh，直接 raycast | 0.05 ms |
| **节流** | `pointermove` 节流：**桌面 60 Hz**（hover 反馈）/ **移动端 30 Hz** | — |

> **faceIndex → objectId 用区间二分而非映射表**：40 件 × ~2000 面 = 80,000 项映射表要 160 KB；区间二分只需 40 个区间（320 B），O(log 40) ≈ 6 次比较。**零额外内存且更快。**

### 8.2 输入 → 动词

```
PointerEvent → gesture.ts（长按 0.4s/1.2s、拖拽、双击、双指捏合/拖拽）
             → raycast（命中类型 + 目标 id）
             → verb-resolver.ts（15 动词判定）
             → 冷却/预算检查（L1 硬冷却 / L2 软饱和 / 全局 12 次每分钟）
             → Intent 事件 → simulation
```

**边缘情况的 CSS 硬要求**（GDD E2-6）：
```css
canvas { user-select: none; -webkit-touch-callout: none; touch-action: none; }
```

### 8.3 三态反应的表现层

| 输出 | 表现 | 通道 | UI 反馈 |
|---|---|---|---|
| **接受** | 姿态 + morph + 尾巴骨骼 | `CatView.applyOutcome('accept', verb)` | **无**（A2-2 硬约束） |
| **拒绝 R1–R6** | GDD §4.4 的 6 级姿态/morph/尾组合表 | `CatView.applyOutcome('reject', level)` | **无** |
| **无反应** | 70% Ear-ack（骨骼耳转 15–25° / 0.4 s）+ 30% 完全静止 | 骨骼 | **无** |
| **输入被吞（冷却/预算）** | **必给物件层反馈**（物件微动 2° 回弹） | `RoomView.nudge(objectId)` | **无** |

> 🚨 **A2-2 是硬约束**：6 级拒绝**不使用任何弹窗、toast、红闪、数值提示**。实现上以 `CatView` 单一入口强制——代码审查项：**`ui/` 目录禁止订阅 `interaction.result` 事件**。

### 8.4 拒绝级别的升级规则

GDD §4.4：「同一会话内，拒绝级别**只升不降**（除非猫切换大状态）」。实现：`session.rejectLevelFloor`，切换大状态时重置。起始级别受 SEC 调制（低 SEC 从 R4 起步，高 SEC 从 R1 起步）。

### 8.5 截图功能

| 项 | 规格 |
|---|---|
| 触发 | 双击 / `S` 键 / 相机按钮 |
| 实现 | **在 render 之后的同一 rAF tick 内**调用 `renderer.domElement.toBlob('image/webp', 0.82)`，**中间不能有 `await`** |
| **`preserveDrawingBuffer`** | **禁用**（每帧复制 framebuffer，移动端带宽杀手，Phase 1 Q6 已定） |
| 主线程成本 | **~1 ms 同步部分**（WebP 编码在浏览器内部异步线程，25–60 ms 不阻塞主线程） |
| 连拍保护 | 点击后 **0.3 s** 禁用第二次输入（UX §7.2 / E-M2） |
| 格式 | **WebP q0.82**（1600×900 ≈ **90–150 KB**），**不是 PNG** |
| 存储 | `blobs` store，**上限 20 张**，**系统永不自动删除**（G-M3，代码审查项） |
| 水印 | 手写体「檐下」+ 猫名，在 `toBlob` 前用 2D canvas 叠加（或 WebGL 内绘制后截），默认开、可关 |

**我对 GDD §6.4.1 的修正**：用 **WebP 而非 PNG**。20 张截图 = **1.8–3.0 MB**（vs PNG 3.6 MB）。90 天存档总量核算 **≈ 3.4 MB / 预算 5 MB**（见 §9.5）。

---

## 9. 离线结算

### 9.1 进入流程

```
进入
 ├─ ① 尝试获取 sessionLock（IDB meta store）
 │     └─ 失败 → 只读模式（不跑 tick，每 10 s 检查锁）
 ├─ ② 读档：主槽 → CRC 校验 → 副槽 → localStorage 紧急槽 → 异常恢复路径
 ├─ ③ 迁移：schema < TARGET → 迁移链（同步，< 2 ms）
 ├─ ④ 时间判定：双时间戳取较大者 → 回拨？跨时区？> 30 天 clamp？
 ├─ ⑤ 离线结算（分帧，见 §9.2）
 ├─ ⑥ 应用痕迹（猫毛 / 压痕 / 日历 / 水碗）
 ├─ ⑦ 写入存档（关键事件）
 └─ ⑧ 进入 playable（HUD 全隐，无提示 —— GDD §5.6.5 ①）
```

### 9.2 离线回填计算（**不可复用 tick 表**）

| 量 | 算法 | 复杂度 | 成本 |
|---|---|---|---|
| `HNG` / `HYD` / `TOI` | **闭合解**：`v' = clamp(v − rate × gameHours, 0, 100)` | O(1) | ~0 ms |
| `warmth` | 闭合解：`w' = clamp(w − 6.0 × days, 0, 100)` | O(1) | ~0 ms |
| `AFF` | 闭合解：`if (w' < 15) AFF -= 0.25 × days; AFF = max(AFF, max(10, AFF_peak×0.6))` | O(1) | ~0 ms |
| `CUR` | 闭合解：`−1.5/日`，下限 25 | O(1) | ~0 ms |
| **`ENE`** | **粗粒度模拟**（非线性：睡眠时恢复、清醒时消耗） | **15 游戏分钟步长** | 30 天 = 2880 步 ≈ **58 ms** |
| 位置 / 状态推算 | 按最终 `ENE` + 时段查锚点偏好 | O(1) | ~0 ms |
| 日记生成 | GDD §5.6.2 的 7 步算法（n ≤ 5 段） | O(n) | ~1 ms |
| **日记快照渲染** | 见 §9.3 | O(n) | 见 §9.3 |

> **ENE 为什么必须模拟**：`ENE_rec = (2.0 + VIT×0.04) × (0.6 + VIT/125)` 点/分，而猫在 30 天里会经历数百次睡/醒循环。这不是线性函数，无闭合解。**15 分钟步长**的误差 vs 1 分钟步长：< 0.5 点（对 `ENE` ∈ [0, 100] 而言可忽略）。

**分帧执行**（防 Long Task）

| 帧 | 内容 | 耗时 |
|---|---|---|
| F1 | 闭合解（需求 / warmth / AFF / CUR）+ 时间判定 | < 1 ms |
| F2–F5 | ENE 粗粒度模拟，每帧 ≤ 16 ms（30 天需 4 帧） | 58 ms 总 |
| F6 | 位置/状态推算 + 日记生成 | < 2 ms |
| F7–F9 | 日记快照，**每帧 ≤ 2 张** | 见 §9.3 |
| F10 | 应用痕迹 + 写存档 | < 3 ms |

**中端移动总计 ≈ 85–110 ms，跨 10 帧（30 fps 下 ≈ 330 ms 墙钟），在 loading → playable 过渡期内完成。** 低端移动约 150–200 ms。

### 9.3 程序化日记快照（**TECH-3 答复**）

#### 9.3.1 成本拆解（512×512，中端移动）

| 步骤 | 成本 | 说明 |
|---|---|---|
| `setRenderTarget` + 视口切换 | 0.50 ms | |
| 猫姿态设置 + `skeleton.update()` | 1.00 ms | 11,000 顶点蒙皮 1 次 |
| **场景渲染 512²**（0.26 Mpx） | **1.90 ms** | 主画面 1.44 Mpx 的 18% |
| shadow pass 512² | 0.80 ms | |
| post / LUT（512²） | 0.40 ms | |
| `toBlob` 同步部分 | 0.60 ms | 编码异步 |
| **单张合计** | **5.20 ms** | |
| 桌面（同分辨率） | **2.0–2.5 ms** | |
| 低端移动 | **7–9 ms** | |

> **策划估的 10–40 ms 偏保守，但方向对。** 真正的瓶颈**不是渲染**（1.9 ms），而是**像素回读**：
> - 若用 `renderer.readRenderTargetPixels()` → **GPU→CPU 同步停顿 8–25 ms**（512² RGBA = 1 MB 同步回读）
> - 若用 `toBlob` → 主线程只有 ~0.6 ms 同步部分

#### 9.3.2 我的实现方案（**修正策划建议**）

```ts
// render/capture/offscreen-capture.ts
async function captureJournalShot(camId: JournalCameraId): Promise<Blob> {
  // ① 相机移到预设机位（美术 ART-3 的 8–12 个机位表）
  // ② 猫摆到指定姿态（复用 MVP 12 姿态，setTime 到关键帧）
  renderer.setRenderTarget(journalRT);          // 512²
  renderer.render(scene, journalCam);
  renderer.setRenderTarget(null);

  // ③ ★ 关键：把 RT blit 到主 canvas 的 512×512 视口，然后 toBlob
  //    绝不 readRenderTargetPixels（8–25 ms 同步停顿）
  renderer.setViewport(0, 0, 512, 512);
  renderer.setScissor(0, 0, 512, 512);
  renderer.setScissorTest(true);
  blitQuad.material.map = journalRT.texture;
  renderer.render(blitScene, blitCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);

  // ④ ★ 必须在同一个 JS 任务内（不 await），否则 framebuffer 已被清空
  //    （preserveDrawingBuffer 禁用）
  return new Promise(res => renderer.domElement.toBlob(res, 'image/webp', 0.72));
}
```

**三条修正**

| # | 策划原方案 | 我的修正 | 理由 |
|---|---|---|---|
| **J-1** | 隐含"1 帧渲染 1 张" | **禁止 `readRenderTargetPixels`**，用 RT → 主 canvas blit → `toBlob` | 前者 8–25 ms 同步停顿；后者主线程只要 0.6 ms |
| **J-2** | 未指定时机 | **在离线结算的 F7–F9 帧预生成，不是玩家翻开相册时才渲染** | 翻开相册是一个交互动作，此时的卡顿会被玩家直接归因于"翻日记卡"。预生成时玩家正在看场景/重逢反应，完全无感 |
| **J-3** | 未指定格式 | **WebP q0.72，512² ≈ 45 KB**；更旧的条目降 256²（≈ 18 KB） | PNG 512² ≈ 150–220 KB，30 条 = 4.5–6.6 MB，**直接超 5 MB 存档预算** |

#### 9.3.3 是否需分帧（策划问的核心）

> ## **需要。5 张不能一帧做完。**

| 场景 | 一次性 5 张 | 分 3 帧（2/2/1） |
|---|---|---|
| 中端移动（30 fps，33.3 ms 预算） | 26 ms + 正常帧 12 ms = **38 ms → 掉 1 帧** | 每帧 ≤ 10.4 ms + 12 ms = **22.4 ms → 不掉帧** |
| 低端移动（30 fps） | 40 ms + 20 ms = **60 ms → 掉 1 帧（且是 Long Task）** | 每帧 ≤ 16 ms + 20 ms = **36 ms → 轻微掉帧** |
| 桌面（60 fps，16.6 ms 预算） | 12.5 ms + 8 ms = **20.5 ms → 掉 1 帧** | 每帧 ≤ 5 ms + 8 ms = **13 ms → 不掉帧** |

**结论**：
1. **每帧上限 2 张**，5 张跨 3 帧完成
2. **在离线结算阶段执行**（此时有 loading → playable 的过渡，玩家预期内）
3. **只在 T2 及以上档位生成**（T0/T1 的 0–1 张可在常规帧内完成，无需分帧）
4. 生成期间**不阻塞交互**——玩家若在 F7 就想点相册，先显示已生成的卡片，未生成的用占位（纯色 + 猫剪影），补完再替换

#### 9.3.4 存储核算

| 项 | 数量 | 单张 | 合计 |
|---|---|---|---|
| 最近 12 条日记（512² WebP q0.72） | 12 | 45 KB | 0.53 MB |
| 更早 18 条（256² WebP q0.72） | 18 | 18 KB | 0.32 MB |
| **日记快照合计** | 30 | — | **0.85 MB** |
| 截图（1600×900 WebP q0.82） | 20 | 130 KB | 2.54 MB |
| 存档主体 + 日记文本 + 历史 | — | — | 0.02 MB |
| **90 天总量** | | | **≈ 3.40 MB / 预算 5 MB（68%）** ✅ |

### 9.4 重逢反应与痕迹

| 项 | 实现 |
|---|---|
| **重逢反应（WARMUP 3.0 s）** | 复用 `Walk_Standard` + `Look_Up_At_Player`（GDD §5.6.4），**0 额外姿态成本** |
| **痕迹** | 猫毛（Line 几何，≤ 24 条）/ 沙发压痕（顶点色，静态）/ 日历（纹理 swap）/ 水碗（水位 shader） |
| **呈现顺序** | 严格按 GDD §5.6.5：① 场景正常显示，HUD 全隐 ② 玩家点击猫或 5 s 无操作 → 重逢反应 ③ 痕迹已渲染 ④ 点相册物件才翻日记 ⑤ 未读提示是场景内的（小夹子/吐出一半的拍立得），**不是 UI badge** |

### 9.5 存储容量管理

| 数据 | 上限策略 |
|---|---|
| 日记条目 | 30 条，超出丢弃最旧（**文本保留，快照降级到 256² 并最终丢弃**） |
| `dailyDifferenceHistory` | 10 条滚动窗口 |
| `recentBehaviors` | 8 条滚动窗口 |
| 截图 | **20 张，系统永不自动删除**（G-M3）。满后"拍立得吐出一半又缩回"（E-M1） |
| 配额预检 | `navigator.storage.estimate()`；不足 → E-M5 路径（提示"它记不住事了" + 立即提供导出存档码） |

---

## 10. 性能预算表

### 10.1 三档总表

| 指标 | 桌面（H） | 中端移动（M） | 低端移动（L） |
|---|---|---|---|
| **目标帧率** | 60 fps | 60（H 模式）/ 30（M 模式） | **30 fps 锁定** |
| 帧预算 | 16.6 ms | 16.6 / 33.3 ms | 33.3 ms |
| **首屏下载（P0+P1）** | ≤ 4.0 MB | **≤ 3.5 MB（核算 3.3 MB）** | ≤ 3.0 MB |
| 完整包（P3 后） | ≤ 12 MB | ≤ 8 MB | ≤ 6 MB |
| **首屏时间 @4G** | ≤ 3.0 s | ≤ 5.0 s | ≤ 8.0 s |
| **纹理内存（红线）** | ≤ 256 MiB | **≤ 96 MiB** | **≤ 64 MiB** |
| Render Target | ~30 MiB | ~15.8 MiB | ~10.5 MiB |
| **JS 堆（稳定态）** | ≤ 60 MB | **≤ 60 MB（核算 25 MB）** | ≤ 45 MB |
| **JS 堆（峰值，含解码）** | ≤ 120 MB | ≤ 90 MB（核算 50 MB） | ≤ 70 MB |
| **Draw call（含 shadow + post）** | ≤ 150 | **≤ 80（核算 28）** | ≤ 45 |
| **三角面（视口内）** | ≤ 450,000 | **≤ 220,000（核算 117,500）** | ≤ 100,000 |
| 动态光源 | ≤ 6 | ≤ 4（推荐 3） | ≤ 2 |
| 实时阴影 | 1 dir PCFSoft 2048² | 1 dir Basic 1024² | 关（blob） |
| DPR | ≤ 2.0 | 1.5 / 1.25 / 1.0 | 1.0 |
| 后处理 | 1.91 ms | 0.79 ms | 0.35 ms |
| **Shader 编译** | ≤ 500 ms | ≤ 1.2 s | ≤ 2.0 s |
| 粒子总数（屏幕内） | ≤ 150 | ≤ 90 | 0 |
| **存档写入（30 s 增量）** | < 1 ms | < 2 ms | < 3 ms |
| **`visibilitychange` 同步写** | < 1 ms | **< 2 ms** | < 3 ms |
| **离线结算（30 天，分帧）** | < 40 ms | **< 110 ms** | < 200 ms |
| **日记快照（单张 512²）** | 2.0–2.5 ms | **3–5 ms** | 7–9 ms |
| **截图（主画面）** | ~1 ms 主线程 | ~1 ms 主线程 | ~1.5 ms 主线程 |

### 10.2 A 档面数分配表（**RUL-2 落地**）

| A 档件 | 移动 LOD0 | 桌面 LOD0 | 备注 |
|---|---|---|---|
| **猫** | **20,000** | **20,000** | RUL-2；移动/桌面共用（可上探 30k） |
| 沙发 | 8,000 | 14,000 | Phase 1 修正为 ≤12k，此处进一步收紧 |
| 书架 | 6,000 | 10,000 | |
| 茶几 | 3,500 | 6,000 | |
| 窗（含框） | 3,500 | 6,000 | |
| 落地灯 | 2,000 | 4,000 | |
| **合计** | **43,000** | **60,000** | |
| **RUL-2 上限** | **48,000** | **100,000** | |
| **余量** | **5,000（10.4%）** | **40,000（40%）** | |

> ⚠️ **给林绘澄**：A 档家具不能再按美术圣经 §3.1 的 30k–80k/件做。**猫独占 20k**，剩下 5 件家具只能分 28k（移动）。沙发从 Phase 1 的 12k 进一步收紧到 8k，理由是目前 5 件 A 档全在等距视口内同屏可见，没有 LOD 余量可用。

### 10.3 三角面总核算（中端移动）

| 档 | 核算 | 预算 220,000 |
|---|---|---|
| A 档（含猫） | 43,000 | |
| B 档（同屏可见 12 件 × 3k） | 36,000 | |
| C 档（合并 40 件，同屏剔除后） | 35,000 | |
| 窗外（2 树 × 1.5k + 鸟） | 3,500 | |
| **合计** | **117,500** | **53%** ✅ |

### 10.4 Draw call 核算（中端移动 M 档）

| 项 | 数量 |
|---|---|
| 猫 skinned（LOD0，无 LOD） | 1 |
| A 档家具 5 件（1 材质/件） | 5 |
| B 档合并 batch × 3（Atlas） | 3 |
| C 档合并 batch × 2（Atlas） | 2 |
| 地板 / 墙 shell | 2 |
| 窗外（天空盒 + 2 树 + 鸟 instanced） | 3 |
| 痕迹（猫毛 line / 日历 / 压痕） | 3 |
| **shadow pass casters** | 6 |
| **后处理（降采样 H + 模糊 V + 合成）** | 3 |
| **合计** | **28 / 预算 80（余量 52）** ✅ |

### 10.5 JS 堆核算（中端移动）

| 项 | 核算 |
|---|---|
| Three.js scene graph（~200 objects） | 0.4 MB |
| 几何数据（猫 + A/B/C 档） | 2.7 MB |
| 动画 clips（12 姿态） | 1.0 MB |
| 模拟层状态 | < 0.1 MB |
| 待写入快照对象 | 0.008 MB |
| 日记/痕迹 | 0.2 MB |
| KTX2 transcoder WASM（转码期） | 8.0 MB |
| meshopt decoder | 2.0 MB |
| Blob 缓存（弱引用） | 2.0 MB |
| **稳态** | **≈ 25 MB** |
| **峰值（解码期）** | **≈ 50 MB** |
| **红线** | **60 MB（稳定态）/ 90 MB（峰值）** ✅ |

---

## 11. 目录结构与命名规范

### 11.1 目录结构

```
GoodCase/
├── index.html                     # 单页入口 + importmap（three@0.172.0）
├── vendor/three/                  # Three.js 本地副本（可选，优于 CDN）
├── src/
│   ├── main.ts                    # 引导：能力探测 → 加载 → 装配 → 启动
│   ├── app/
│   │   ├── bootstrap.ts           # 手写 DI 装配根
│   │   └── config.ts              # 全局常量（TIME_SCALE / tick 周期 / slot 表）
│   ├── platform/
│   │   ├── capability.ts          # WebGL2 / KTX2 / ASTC / ETC2 能力矩阵
│   │   ├── device-tier.ts         # H/M/L 分级 + benchmark + 手动覆盖
│   │   ├── clock.ts               # 真实 / 单调 / 双时间戳
│   │   ├── rng.ts                 # PCG32 + 四路流
│   │   └── lifecycle.ts           # visibilitychange / pagehide / freeze / contextlost
│   ├── core/
│   │   ├── types.ts
│   │   ├── event-bus.ts
│   │   ├── fixed-step.ts          # 固定步长累加器
│   │   ├── tick-scheduler.ts      # 分层 tick
│   │   └── math/{clamp,lerp,easing,crc32}.ts
│   ├── simulation/                # ★ 禁止 import three
│   │   ├── time/{game-clock,slot-table,circadian}.ts
│   │   ├── cat/{personality,needs,behavior-arbiter,state-machine,offline-settler}.ts
│   │   ├── world/{anchors,weather,season,daily-difference}.ts
│   │   ├── interaction/{tri-state,verb-table,cooldown}.ts
│   │   └── journal/generator.ts
│   ├── persistence/
│   │   ├── contract.ts            # ★ 数据契约（simulation 与 persistence 的唯一接口）
│   │   ├── codec.ts / crc32.ts / idb.ts / dual-slot.ts / verify.ts / session-lock.ts
│   │   └── migrations/{index,v1-to-v2,v2-to-v3}.ts
│   ├── render/
│   │   ├── renderer.ts / camera.ts / scene-graph.ts
│   │   ├── lighting/{sun-rig,lightmap-manager,lut,indoor-light}.ts
│   │   ├── shaders/{lightmap-crossfade,cat-coat,window-rain}.glsl.ts
│   │   ├── post/{composer,tilt-shift,vignette,color-grade}.ts
│   │   └── capture/{offscreen-capture,screenshot}.ts
│   ├── presentation/
│   │   ├── cat-view.ts / room-view.ts / trace-view.ts
│   │   └── animation/{mixer-bridge,procedural}.ts
│   ├── input/
│   │   ├── pointer.ts / gesture.ts / raycast.ts / verb-resolver.ts
│   ├── ui/
│   │   ├── hud.ts / journal-ui.ts / album.ts / settings.ts / recovery.ts
│   └── debug/
│       └── dev-panel.ts           # DEV only，不进产物
├── assets/
│   ├── models/{cat,A,B,C,outside}/*.glb
│   ├── textures/{atlas,cat,vfx}/*.ktx2
│   ├── lightmap/lm_{morning,noon,dusk,night}.ktx2
│   └── fonts/*.woff2
└── tests/
    ├── unit/                      # Vitest：纯逻辑（simulation + persistence）
    ├── property/                  # 状态机强连通性 / 无吸收态
    ├── contract/                  # ★ 迁移的情感资产逐字节保留
    └── perf/                      # 性能预算回归（CI 跑 headless 逻辑层）
```

### 11.2 命名规范

| 对象 | 规范 | 示例 |
|---|---|---|
| **文件名** | `kebab-case.ts` | `lightmap-manager.ts` |
| **类/接口/类型** | `PascalCase` | `LightmapManager`, `CatExpressionTarget` |
| **函数/变量** | `camelCase` | `advanceGameClock()` |
| **常量** | `UPPER_SNAKE_CASE` | `TIME_SCALE`, `MAX_CATCHUP`, `TARGET_SCHEMA` |
| **枚举值** | `snake_case` 字符串字面量联合 | `'slot_morning'`, `'SLEEP_DEEP'`, `'sunny'` |
| **事件名** | `domain.noun.verb` | `time.slotChanged`, `cat.state.entered`, `interaction.result` |
| **资产 · 模型** | `{category}_{name}_{lod}.glb` | `A_sofa_lod0.glb` |
| **资产 · 贴图** | `{category}_{name}_{channel}.ktx2` | `cat_body_albedo.ktx2` |
| **资产 · lightmap** | `lm_{slot}.ktx2` | `lm_dusk.ktx2` |
| **IndexedDB 槽** | `slotA` / `slotB` / `slotArchive` | — |
| **状态机状态** | `UPPER_SNAKE_CASE` | `SLEEP_DEEP`, `WATCH_WINDOW` |
| **ADR** | `ADR-{1xx}-{slug}.md` | `ADR-103-lightmap-strategy.md` |

### 11.3 两条枚举的强制隔离（GDD R-3）

```ts
// simulation/time/slot-table.ts —— ★ 这两个类型不得互相赋值
export type TimeSlot      = 'slot_morning' | 'slot_noon' | 'slot_dusk' | 'slot_night';  // 4 档，随季节漂移
export type CircadianBand = 'deep_night' | 'morning' | 'noon' | 'dusk' | 'night';        // 5 档，固定钟点

// ESLint 禁止 simulation/ 内出现把 TimeSlot 当 CircadianBand 用（或反之）的赋值
```

> **理由（GDD PH2b §3.4.3）**：`timeSlot` 是光学概念（随季节/纬度漂移），`circadianBand` 是生物概念（固定钟点）。复用同一枚举会让冬季的 `slot_morning` 从 05:00 漂到 06:20 后，猫的晨间进食高峰也跟着漂——**这是错的**。CI 静态检查。

---

## 12. 风险登记

| # | 等级 | 风险 | 影响 | 缓解措施 | 验证 |
|---|---|---|---|---|---|
| **T-1** | 🔴 **P0** | **iOS Safari `visibilitychange` 冻结 / kill 导致存档丢失** | 玩家长线投入不可挽回（RUL-8 零容忍项） | 4 层防护（§4.2）：localStorage 紧急槽（真同步）+ IDB 双槽（交替）+ CRC32 + 常驻 DB 连接 + 常驻 SnapshotAssembler；W-1~W-4 硬规则 | **真机压力测试 V-M1**：iPhone 13 / SE2，各 100 次"玩 3 分钟 → 切后台 → 杀进程"，断言丢失 ≤ 30 s |
| **T-2** | 🔴 **P0** | **iOS Safari 内存 kill**（GPU + JS 接近 ~384 MB） | 白屏 / 重载，玩家以为丢档 | 纹理 ≤ 96 MiB（中端）/ 64 MiB（低端）；JS 堆峰值 ≤ 90 MB；首屏**先渲染后加载**重资源；监听 `webglcontextlost` 给优雅提示而非白屏；**只创建 1 个 WebGL context** | 真机内存 profile（Safari Web Inspector）+ 30 分钟连续压测 |
| **T-3** | 🟠 P1 | **KTX2 / ASTC / ETC2 能力碎片化** → lightmap 回退到未压缩 RGBA8（64 MiB = 66.7% 预算，触发降级且挤爆低端机） | 低端机进不去或频繁被 kill | 能力探测矩阵（ADR-106）；回退路径**强制** lightmap 降为 **2 套 + 1024² + RGB565**（4.0 MiB）；提供 WebP 二级回退 | 能力矩阵单元测试 + 3 台真机覆盖 |
| **T-4** | 🟠 P1 | **Shader 编译卡顿** | 首次进入或首次时段切换 200–800 ms 卡死 | crossfade 只编译 **1 个 program 变体**（§6.4 C-1）；`renderer.compile()` 在 loading 遮罩内预编译全部材质；**冷启动零 shader 变体切换** | 首帧耗时埋点；`performance.measure` 断言 < 1.2 s（中端） |
| **T-5** | 🟠 P1 | **0.8 s crossfade 的 `onBeforeCompile` 注入依赖 Three.js 内部 chunk 名** `<lights_fragment_maps>` | r→r 升级后 chunk 改名 → crossfade **静默失效**（画面不报错但光照不淡入） | **Spike 阶段必须验证**（在 r172 上跑通并截图留证）；升级 Three.js 时的**三项回归**：crossfade / morph / skinned shadow；`material.customProgramCacheKey` 强制隔离 | Spike 验收 + 升级 checklist |
| **T-6** | 🟠 P1 | **离线结算 + 日记快照的 Long Task**（> 50 ms 被 Chrome 标记） | 进入游戏时卡顿，LCP / INP 变差 | 分帧执行（§9.2 F1–F10，每帧 ≤ 16 ms）；快照每帧 ≤ 2 张（§9.3.3）；在 loading → playable 过渡期完成 | 30 天离线的自动化性能测试，断言单帧 ≤ 16 ms |
| **T-7** | 🟠 P1 | **多标签页 sessionLock 边界**（崩溃未释放、心跳超时误判） | 数据竞争或玩家被锁在只读模式 | IDB `meta` store 存锁；10 s 心跳 / 30 s 超时；崩溃覆盖；**采纳 R-5**：锁释放后**静默重读档重渲染，不重载页面**，提示"它还在"（可关闭） | QA 用例：两标签页 + 强杀一页 |
| **T-8** | 🟠 P1 | **猫的 morph + skinned + shadow 三重开销**在 30 fps 档抖动 | 帧时间不稳，观感"卡" | 8 morph 关 normals（B-1，省 0.70 MB）；20k 面；shadow 仅 06:00–18:00 且阴/雨天关闭；GPU skinning；`frustumCulled = false`（猫恒可见，省剔除开销） | 帧时间 P95 埋点，断言 P95 < 1.2 × 预算 |
| **T-9** | 🟠 P1 | **首屏 3.3 MB vs 3.5 MB 预算，余量仅 6%** | 4G 下首屏可能超 5 s | ① 环境 Atlas 2048² → 1024²（−0.75 MB）② A 档拆两批（沙发/窗 P0，其余 P1）③ meshopt 而非 Draco（省 168 KB decoder） | 首屏体积 CI 断言（bundlesize）+ 4G 节流实测 |
| **T-10** | 🟡 P2 | **IndexedDB 配额不足**（截图 20 张 + 日记快照 30 条 ≈ 3.4 MB，加存档共 ~3.5 MB） | 写入失败，玩家不知情 | `navigator.storage.estimate()` 预检；失败走 E-M5（"它记不住事了" + 立即提供导出存档码）；日记快照 WebP + 旧条降 256² | 配额模拟测试 |
| **T-11** | 🟡 P2 | **南半球季节推断（TECH-6）不可靠** | 12 月是夏天的玩家看到冬天 | `Intl.DateTimeFormat().resolvedOptions().timeZone` → IANA tz → 纬度查找表（离线 ~450 条，8 KB）；失败默认北半球；**设置项手动翻转** | 20 个代表性时区的单元测试 |
| **T-12** | 🟡 P2 | **时间作弊**（改系统时间刷离线收益） | 数值被刷，但只伤害玩家自己体验 | GDD §5.7 七条全部落地（双时间戳、回拨冻结、30 天 clamp、时区记录）；**明确不做加密/混淆** | 单元测试：回拨 / 前进 / 改时区三种场景 |
| **T-13** | 🟡 P2 | **Three.js 版本升级**（r172 → r18x） | API 变更导致注入失效或行为变化 | importmap 锁版本；升级需跑三项回归（见 T-5）；**不在 MVP 周期内升级** | 升级 checklist |

---

## 13. 架构评审清单（主理人门控用）

> 每一项都必须有明确的 ✅ / ❌ 判定。**任一 🔴 项未通过，Phase 3 不许进入实现阶段。**

### 13.1 🔴 阻断项（必须全绿）

| # | 验收项 | 判定方式 | 归属 |
|---|---|---|---|
| **G-A1** | **RUL-8 三条 + 1 条加强全部存在**：localStorage 紧急槽 / IDB 双槽 / CRC32 / 迁移链 | 代码审查 + 单元测试 | 程基岩 |
| **G-A2** | `visibilitychange` 回调内 **无 `await` / `.then()` / `setTimeout`** | ESLint 规则 + 人工审查 | 程基岩 |
| **G-A3** | **IDB 连接常驻打开**，回调内无 `await openDB()` | 断言 | 程基岩 |
| **G-A4** | **真机压力测试通过**：iPhone 13 + SE2，各 100 次"玩 3 分钟 → 切后台 → 杀进程"，丢失 ≤ 30 s | 真机测试报告 | 严守真 |
| **G-A5** | **`simulation/` 零 `import three`** | ESLint CI 阻断 | 程基岩 |
| **G-A6** | **lightmap 索引函数只接受 `slot` 一个参数**（A-L1） | 静态审查 | 程基岩 |
| **G-A7** | **0.8 s crossfade 的 shader 注入在 r172 上跑通**（截图留证） | Spike 验收 | 程基岩 |
| **G-A8** | **状态机强连通、无吸收态、无终止态** | 属性测试 10⁴ 步 | 程基岩 |
| **G-A9** | **迁移链的 5 项情感资产逐字节保留**（M-5） | 契约测试 CI 阻断 | 程基岩 |
| **G-A10** | **`ui/` 不订阅 `interaction.result`**（A2-2：拒绝零 UI 反馈） | 静态审查 | 程基岩 |

### 13.2 🟠 重要项

| # | 验收项 | 判定方式 |
|---|---|---|
| **G-B1** | `timeSlot`（4）与 `circadianBand`（5）为两个独立类型，无互相赋值 | 静态审查 |
| **G-B2** | 分层 tick 表在代码中与 §3.2.1 权威表一致（含 60 s 而非 1/60 s 的命名） | 代码审查 |
| **G-B3** | 离线结算不复用 tick 表，ENE 走 15 分钟粗粒度模拟 | 代码审查 + 测试 |
| **G-B4** | 中端移动纹理内存 ≤ 96 MiB（含 4 套 lightmap 全常驻的 34.45 MiB 最坏情况） | GPU 内存 profile |
| **G-B5** | Draw call ≤ 80（中端）/ 45（低端） | WebGL Inspector 实测 |
| **G-B6** | 首屏 ≤ 3.5 MB（中端），首屏时间 ≤ 5 s @4G | bundlesize + Lighthouse |
| **G-B7** | 日记快照每帧 ≤ 2 张，且在离线结算阶段预生成 | 代码审查 + 帧时间埋点 |
| **G-B8** | 截图与日记快照均用 WebP，且不进 `crc32` 校验范围 | 代码审查 |
| **G-B9** | 粒子总数屏幕内 ≤ 150（防"粒子堆砌"） | 代码审查 + 运行时断言 |
| **G-B10** | `Math.random` 在业务代码中零出现（`debug/` 豁免） | ESLint |

### 13.3 🟡 观察项

| # | 验收项 |
|---|---|
| G-C1 | 降级路径（2 套 + LUT）的代码分支存在且可切换（虽然不激活） |
| G-C2 | 只读模式的"静默重读档、不重载页面"（R-5）已实现 |
| G-C3 | 三档降级的手动覆盖设置项生效 |
| G-C4 | `performance.measure` 埋点覆盖：shader 编译 / 首帧 / 离线结算 / 快照 / 存档写入 |

---

## 14. 策划问题答复汇总表（**TECH-1 ~ TECH-4**）

| # | 策划的问题 | 策划建议 | **我的结论** | **关键数字** | **对策划设计的影响** |
|---|---|---|---|---|---|
| **TECH-1** | 分层 tick 架构（行为 0.5Hz / 微表情 4Hz / 需求 1Hz / 性格 1/60Hz）：开销是否可接受？是否与渲染帧率解耦？ | 按上述频率分层 | ✅ **可接受，开销可忽略**。三层保护（最小驻留 / 滞后 / 不应期）全部保留。**完全解耦**（tick 由固定步长时间轴驱动，不由帧驱动）。**3 处修正见下** | **每帧摊销 0.012 ms（帧预算 0.07%）**；比"全部每帧"省 **98.4%** | ① "1/60 Hz" 必须为 **"周期 60 s"**（防误读为 60Hz）<br>② "光照色温 5 游戏分钟" 移出 tick 表，改事件驱动<br>③ **离线结算禁止复用 tick**（30 天 = 260 万次 tick，需 52 秒）→ 改闭合解 |
| **TECH-2** | `visibilitychange → hidden` 的同步写入（iOS 在回调返回后立刻冻结）。存档写入必须同步，不能 await 后再写 | 同步写入 + 双槽 + CRC32 | ⚠️ **结论成立，但必须澄清一处平台事实**：**IndexedDB 没有任何同步 API**，`put()` 只是"同步发起"。**Web 平台唯一真同步的持久化 API 是 `localStorage.setItem`**。因此落地为 **4 层**：localStorage 紧急槽（真同步）+ IDB 双槽 + CRC32 + 迁移链 | 8 KB：`serialize` 0.25 ms + `crc32` 0.05 ms + `localStorage.setItem` 0.15–0.4 ms + `idb.put` 发起 < 0.1 ms = **< 1 ms 总** | 无设计影响（纯实现层）。**但对主理人**：第 4 层（localStorage）是我新增的，若被否决，T-1 风险从 🟠 升回 🔴 |
| **TECH-3** | 程序化日记快照：离屏渲染 1 帧 512×512，复用主场景，1–5 张。单次 10–40 ms 是否可接受？是否需分帧？ | 单次 10–40 ms，问是否需要分帧 | ✅ **可行，但策划估的数字偏高，且瓶颈判断错了**。真实单张 **3–5 ms（中端移动）/ 7–9 ms（低端）**；瓶颈**不是渲染**（1.9 ms）而是**像素回读**（`readPixels` 会 8–25 ms 停顿）。**需要分帧** | 单张 **5.20 ms** 拆解（含 RT 绑定 0.5 / 姿态 1.0 / 渲染 1.9 / shadow 0.8 / post 0.4 / toBlob 0.6）；5 张一次性 = **26 ms → 掉 1 帧**；分 3 帧（2/2/1）= 每帧 ≤ 10.4 ms → **不掉帧** | ① **禁止 `readRenderTargetPixels`**，改 RT → 主 canvas blit → `toBlob`<br>② **必须在离线结算阶段预生成**，不能等玩家翻相册才渲染（否则卡顿被归因于"翻日记卡"）<br>③ 格式 **WebP q0.72**（45 KB/张），不用 PNG（150–220 KB，30 条就超 5 MB 预算） |
| **TECH-4** | 双槽写入 + CRC32 校验 + 迁移函数链（v2→v3）设计。确认 IndexedDB 双槽方案的实现成本 | 双槽 A/B 交替 + 迁移只增不删 | ✅ **方案确认，实现成本 4.25 人日**。双槽 = 同 store 两条记录 + `seq` 单调交替，**不是两个 object store**。迁移链为纯函数数组，同步执行。我把"5 项情感资产逐字节保留"升级为 **CI 自动化契约测试** | 见下方成本分解表 | 无设计影响。**对主理人**：M-5（情感资产保留）从"靠人记住"变成"CI 会红"，这是本项目唯一能防"丢猫"的自动化手段 |

### 14.1 TECH-4 实现成本分解

| 模块 | 实现 LOC | 测试 LOC | 人日 |
|---|---|---|---|
| `idb.ts`（打开 / 事务封装 / 常驻连接） | 120 | 80 | 0.5 |
| `crc32.ts`（查表 + 增量） | 60 | 40 | 0.25 |
| `codec.ts`（序列化 / 反序列化 / schema 头） | 150 | 120 | 0.75 |
| `dual-slot.ts`（A/B 交替 + localStorage 紧急槽） | 180 | 150 | 1.0 |
| `migrations/`（框架 + v1→v2→v3 示例 + 契约测试） | 200 | 200 | 1.0 |
| `verify.ts`（损坏检测 + 三级回退 + 异常恢复） | 150 | 150 | 0.75 |
| **合计** | **860** | **740** | **4.25 人日** |

> 未计入真机压力测试（V-M1，约 2 人日，归 QA）。

---

## 15. 给策划与美术的硬性约束清单

### 15.1 对美术（林绘澄）

| # | 约束 | 依据 | 违反后果 |
|---|---|---|---|
| **AR-1** | **猫 ≤ 20,000 tris**（可上探 30k，需提交削减清单）；**A 档视口内总和 ≤ 48k（移动）/ ≤ 100k（桌面）**。具体分配见 §10.2：猫 20k，沙发 8k，书架 6k，茶几 3.5k，窗 3.5k，灯 2k | RUL-2 | 移动端掉帧 |
| **AR-2** | **lightmap 恒定 2048²，4 套，UV1 唯一展开不重叠**。4096² 需主理人重开 RUL-1 | §6.5.5 | 显存 66.7%，触发降级 |
| **AR-3** | **季节与天气一律不改 lightmap**。新增效果必须过 GDD PH2b §3.7.3 硬闸门 | RUL-1 | 架构会以 `setSlot(slot)` 单参数签名二次拦截 |
| **AR-4** | **morph targets ≤ 8，且关闭 morph normals**（B-1） | §5.4.2 | 多 0.70 MB 显存 + 每顶点额外纹理 fetch |
| **AR-5** | **瞳孔走 shader uniform，不走 morph**（B-2） | GDD §7.3 | 占掉一个 morph 名额 |
| **AR-6** | **贴图最大 2048²，禁止 4096²** | Phase 1 §7.1 | 挤爆显存与带宽 |
| **AR-7** | **移动端动态光 ≤ 4，推荐 3**（1 directional + 1 hemisphere + 1 point） | §7.4 | 前向渲染下每加一盏光全材质重编译 |
| **AR-8** | **B 档必须合并 draw call**（按 Atlas 合并为 ≤ 3 个 batch）；C 档合并为 ≤ 2 个 | §10.4 | Draw call 从 28 涨到 60+ |
| **AR-9** | **移动端 DPR 由程序控制**（H 1.5 / M 1.25 / L 1.0），不接受"Retina 全分辨率" | §7.4 | Fill rate 崩溃 |
| **AR-10** | **⚠️ 待确认：环境 Atlas 能否从 2048² 降到 1024²？** | 首屏余量仅 6%（T-9） | 若不能，需砍 A 档首屏件数 |
| **AR-11** | **需交付：8–12 个日记机位表**（`{机位ID, 相机位置, 朝向, 构图说明, 适用时段, 关联地点锚}`） | ART-3 / §9.3 | 日记快照无法生成 |
| **AR-12** | **毛发：MVP 纯法线烘焙；Standard ≤ 40 张 alpha-hash 卡片（仅头尾，特写才启用）** | Phase 1 §4.1 | 200 张卡片在移动端掉到 20 fps |

### 15.2 对策划（文策渊）

| # | 约束 | 依据 |
|---|---|---|
| **DE-1** | **MVP 仅 1 只猫**；Standard 最多 3 只同屏（移动端 2 只是实际上限） | 每多 1 只 ≈ +20k tris + 1 skinned mesh + 12 clips + shadow caster |
| **DE-2** | **房间视角锁定为固定等距正交**，禁自由 zoom、禁透视、禁自由漫游 | 自由漫游需透视 + 动态遮挡剔除 + 寻路，工程量 +30–50%，且破坏微缩感 |
| **DE-3** | **移动端可见可摆家具 ≤ 30 件**，超出必须合并 batch 或仅桌面可用 | Draw call 上限 |
| **DE-4** | **季节/天气每加一种：+0 lightmap，+0.5 天 shader/uniform 工作** | RUL-1 |
| **DE-5** | **姿态库 12→24→32 的增量**：运行时 +0.3–0.6 MB/姿态；下载 +12 姿态 ≈ +1 MB（首屏，懒加载后） | §5.4.3 |
| **DE-6** | **截图有 ~1 ms 主线程停顿 + 25–60 ms 异步编码**；点击后 0.3 s 内不响应第二次；**移动端禁用连拍** | §8.5 |
| **DE-7** | **日记快照 ≤ 5 张，必须预生成**；格式 WebP；更旧条目降级到 256² | §9.3 |
| **DE-8** | **90 天存档总量 ≈ 3.4 MB / 预算 5 MB**（截图 20 张 2.54 MB + 日记快照 0.85 MB） | §9.5 |
| **DE-9** | **离线结算的"档位"必须在进入后 ~110 ms（中端）内算完**，因此日记生成算法必须是 O(n) 的模板拼接，不能是 O(离线时长) 的模拟 | §9.2 |
| **DE-10** | **`timeSlot` 与 `circadianBand` 是两个枚举，策划文档里也请保持区分**（GDD 已做对，R-3） | §11.3 |
| **DE-11** | **「今日不同」的 `dailyDifference` 数据结构不得出现任何"玩家发现记录"字段**（`discovered`/`foundBy`/`viewedAt`/`foundCount`/`streak`） | GDD PH2b §1.9；**可静态检查** |

---

## 16. 需人类判断的取舍点

> 以下 7 项技术上都有可行解，但**取舍涉及价值判断**，我不擅自决定。每项给推荐与代价。

| # | 决策点 | 选项 A | 选项 B | **我的推荐** | 代价 |
|---|---|---|---|---|---|
| **H-1** | **RUL-8 的第 4 层（localStorage 紧急槽）是否保留？** | 保留（4 层） | 严格按裁决原文 3 层（仅 IDB 双槽 + CRC32） | **保留（A）** | 多 0.5 人日 + 每次写入多 0.15–0.4 ms。**若选 B，T-1 从 🟠 升回 🔴**，因为"页面被 kill（非冻结）"场景下 IDB 事务不会完成 |
| **H-2** | **环境 Atlas 分辨率** | 2048²（画质优先，首屏 3.3 MB / 余量 6%） | 1024²（安全优先，首屏 2.55 MB / 余量 27%） | **1024²（B）** | C 档装饰物件在近景档（viewSize 2.4 m）会有可见的贴图模糊。**需林绘澄判断能否接受** |
| **H-3** | **Lightmap 编码：UASTC vs ETC1S** | UASTC→ASTC（4.0 MiB/套，无 banding） | ETC1S→ETC1（2.0 MiB/套，低频渐变可能有轻微 banding） | **UASTC（A）** | 显存翻倍（8→16 MiB），但 16.7% 仍远低于 60%。**lightmap 是低频渐变，banding 最伤画质** |
| **H-4** | **中端移动纹理红线：96 MiB vs Phase 1 的 128 MiB** | 96 MiB（扣除 15.8 MiB RT 后的工程红线） | 128 MiB（Phase 1 原值） | **96 MiB（A）** | 更保守，可能过度限制 Standard 阶段的资产。**建议 Phase 4 实测后回填** |
| **H-5** | **行为仲裁的 `pow(x, 1.60)` 是否可用近似 `x*x*sqrt(x)`（1.5 次幂）** | 精确 1.60 | 近似 1.50（省 0.004 ms/tick，误差 < 3%） | **精确 1.60（A）** | 0.004 ms 的节省不值得改数值分布；**除非实测 tick 超标**（目前 0.6 ms，远未超标） |
| **H-6** | **日记快照的保留策略** | 30 条全保留（最近 12 条 512²，更早降 256²，共 0.85 MB） | 只留最近 12 条（0.53 MB），更早的不显示照片 | **30 条全保留（A）** | 0.32 MB。**玩家的"照片"不该被系统降级**——这与 G-M3（永不自动删截图）同源 |
| **H-7** | **Spike 优先做哪一件事？** | ① lightmap crossfade 的 shader 注入（T-5） | ② iOS `visibilitychange` 真机写入可靠性（T-1） | **同时做，但 T-1 先出结果** | T-1 是 RUL-8 零容忍项，且它的结论可能影响 H-1 的决策 |

---

## 17. 下一步

| # | 事项 | 归属 | 依赖 |
|---|---|---|---|
| 1 | **Spike A**：r172 上跑通 lightmap crossfade 的 `onBeforeCompile` 注入，截图留证 | 程基岩 | — |
| 2 | **Spike B**：iOS 真机 `visibilitychange` 写入可靠性压力测试（iPhone 13 + SE2） | 程基岩 + 严守真 | — |
| 3 | 回填 H-1 ~ H-7 的拍板结果 | 游承峰 | Spike A/B |
| 4 | 确认 AR-10（Atlas 分辨率）、AR-11（日记机位表） | 林绘澄 | — |
| 5 | 用实测数字回填 §6.5（lightmap 显存）、§10（性能预算），偏差 > 20% 立项修订 | 程基岩 | Spike A |
| 6 | 输出 `ADR-101` ~ `ADR-107` 的会签版本 | 程基岩 | 3 |
| 7 | Epic → Story 拆分（每 Story 嵌 GDD 需求 ID + ADR 指引 + 验收标准） | 程基岩 | 6 |

---

*文档结束 · PH3-ARCH-EAVES-001 v1.0 · 程基岩 · 待主理人会签*
