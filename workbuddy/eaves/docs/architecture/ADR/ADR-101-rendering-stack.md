# ADR-101 · 渲染方案：Three.js r172 + WebGL2 强制 + 自写 3-pass 后处理

| 项 | 内容 |
|---|---|
| **编号** | ADR-101 |
| **状态** | 已提议（Proposed） |
| **日期** | 2026-08-30 |
| **决策者** | 程基岩（技术总监 / 主程） |
| **会签** | 游承峰（主理人）、林绘澄（美术） |
| **相关** | ADR-103（光照）、ADR-105（资产管线）、ADR-106（移动端降级） |
| **上游** | `PH1-3d-feasibility.md` §5、§4.5；`PH2-rulings-EAVES.md` RUL-1 |

---

## 1. 背景

《檐下》是**纯网页（Three.js）+ 移动端浏览器**的 3D 高模等距微缩养猫游戏。渲染层必须同时满足：

1. **正交投影 + tilt-shift 后处理**是"微缩感"的视觉身份（美术圣经 §5.5），不可妥协。
2. **首屏 ≤ 3.5 MB（中端移动）**，包含 Three.js 自身。
3. **移动端中端机 40–60 fps**，低端机锁定 30 fps。
4. **必须保留 shader 注入能力**——ADR-103 的 4 套 lightmap 交叉淡入依赖 `onBeforeCompile` 修改内置材质的 lightmap 采样段。
5. 用户偏好：**单文件/少文件、零外部资产、importmap 固定版本、不引入重型构建链**。

约束 4 是最强的：它排除了"用更高级别的现成引擎/框架"这条路，因为我们需要钻到内置材质的 shader 里。

## 2. 决策

### 2.1 核心选型

| 项 | 决策 |
|---|---|
| **引擎** | **Three.js，锁定 `r172`（`three@0.172.0`）** |
| **API** | **强制 WebGL2**。能力探测失败 → 显示"请升级浏览器"整页，不做 WebGL1 回退 |
| **引入方式** | **importmap 固定版本 + 原生 ES 模块** |
| **构建** | **零构建可部署**：`src/` + `vendor/three/` 静态托管，importmap 指向本地副本**。Vite 仅用于 dev server（HMR），不参与产物** |
| **色彩管线** | `outputColorSpace = SRGBColorSpace`；`toneMapping = ACESFilmicToneMapping`；`toneMappingExposure = 1.0` |
| **抗锯齿** | **移动端 `antialias: false` + SMAA 后处理**；桌面 SMAA |
| **后处理** | **不引入 `EffectComposer`，自写 3-pass 薄管线** |
| **Web 上下文** | **全局只创建 1 个 WebGL context**（iOS 全系统上限 8–16 个） |

### 2.2 后处理管线（自写）

```
scene render（材质 shader 内含 ACESFilmicToneMapping，Three.js 内置）
   ↓
RT_color（全分辨率，RGBA8）
   ↓
pass 1: tilt-shift 降采样 + 水平模糊   1/4 分辨率
   ↓
pass 2: tilt-shift 垂直模糊             1/4 分辨率（ping-pong）
   ↓
pass 3: 上采样合成 + 色彩分级(季节/天气) + vignette   ← 全分辨率，一次遍历做完
   ↓
screen
```

**成本核算**（核算值，待 Spike 实测回填）

| Pass | 桌面 2560×1440 | 中端 1600×900 | 低端 1280×720 |
|---|---|---|---|
| pass 1 + 2（1/4 分辨率） | 0.36 ms | 0.24 ms | 关 |
| pass 3（全分辨率合成） | 1.55 ms | 0.55 ms | 0.35 ms |
| **合计** | **1.91 ms** | **0.79 ms** | **0.35 ms** |
| 占帧预算 | 11.5% | 4.8% / 2.4% | 1.1% |

### 2.3 明确不引入

| 不引入 | 理由 |
|---|---|
| `EffectComposer` / `UnrealBloomPass` 等官方后处理 | `EffectComposer` 会额外分配 2 张全分辨率 RT（中端移动 **+9.6 MiB**），且强制多 pass 全屏复制。我们只需 1 张 1/4 ping-pong + 1 次合成 |
| `WebGPURenderer` / WebGPU | r18x 处于重构期，WebGL 路径 API 不稳定；且 WebGPU 在 iOS Safari 上 2026 年仍未 GA |
| 2D 引擎（PixiJS / Phaser） | 本作是 3D，无适用场景 |
| 物理引擎（cannon / ammo / rapier） | 无物理需求。猫与家具用 AABB/OBB + raycast 即可 |
| 补间库（GSAP / Tween.js / anime.js） | 相机阻尼是 3 行 `lerp`；其余缓动用 `core/math/easing.ts` |
| 状态管理库（Redux / Zustand） | 状态是一个 `SaveBody` 对象 + 单向 Intent 流，引入库只会增加"绕过它"的诱惑 |
| ECS 框架（bitECS / miniplex） | 实体 ≤ 50、组件固定。ECS 收益在实体上千时才显现 |
| 任何运行时 npm 依赖 | 首屏 JS 预算 ≤ 300 KB（Three core 170 KB + 业务 120 KB） |

## 3. 备选方案

### 3.1 备选 A · Three.js r160（美术圣经 §8.5 的原建议）

| 维度 | 评价 |
|---|---|
| 优点 | 与美术圣经已写的版本一致；生态稳定 |
| 缺点 | **缺 `BatchedMesh`（r159+ 才有）**；morph target 与 SSS 支持弱于 r170+；`onBeforeCompile` 的 chunk 结构较旧 |
| 判定 | ❌ **否决**。`BatchedMesh` 虽在本架构中不是必需（我们用 `mergeGeometries` 静态合并），但 morph/SSS 的质量差距直接影响 RUL-2 的"视觉精度"验收 |

### 3.2 备选 B · Three.js r18x（最新）

| 维度 | 评价 |
|---|---|
| 优点 | 最新特性、更好的 WebGPU 支持 |
| 缺点 | **`WebGPURenderer` 重构期，WebGL 路径 API 不稳定**；`onBeforeCompile` 注入的 chunk 名可能变动 → ADR-103 的 crossfade 会**静默失效** |
| 判定 | ❌ **否决**。MVP 周期内不升级（风险 T-13） |

### 3.3 备选 C · 自研薄渲染层（如《潮线》ADR-001）

| 维度 | 评价 |
|---|---|
| 优点 | 完全控制 shader；零依赖；《潮线》已验证可行 |
| 缺点 | 本作是 **3D PBR + 骨骼动画 + morph + lightmap + shadow**，自研渲染层的成本 ≈ **40–60 人日**（对比《潮线》的 2D 索引色管线 ≈ 8 人日） |
| 判定 | ❌ **否决**。《潮线》选自研是因为"视觉身份就是渲染器"（硬边像素、有序抖动、整屏调色板），而本作的视觉身份是**光照、材质与构图**，这些恰恰是 Three.js 的强项。**为控制 shader 而重写整个 3D 管线是错误trade-off** |

### 3.4 备选 D · Canvas2D 伪 3D（预渲染精灵）

| 维度 | 评价 |
|---|---|
| 优点 | 极省性能、极省体积 |
| 缺点 | **RUL-1 的 4 套 lightmap 交叉淡入变成 4×N 张预渲染图**，体积爆炸；猫的 12 姿态 × 4 时段 × 多角度 = 天文数字；**"3D 高模"是用户明确的需求层诉求** |
| 判定 | ❌ **否决** |

## 4. 理由

### 4.1 为什么是 r172 而不是 r170 或 r180

- **≥ r170**：Phase 1 §5 已定。r170+ 的 morph target 处理（`morphTexture` 用 `HalfFloatType`）、SSS 支持、以及 `WebGLRenderer` 的状态管理都优于 r160。
- **r172 而非 r18x**：r172 是 WebGPURenderer 大规模重构**之前**的最后一个稳定成熟版本序列，WebGL 路径经过充分验证。
- **不是"最新版"是特征不是缺陷**：shader 注入依赖内部 chunk 名，稳定压倒新颖。

### 4.2 为什么不用 `EffectComposer`

`EffectComposer` 的默认构造会创建：
- `renderTarget1` + `renderTarget2`（各全分辨率 RGBA8 + depth）
- 每个 pass 至少一次全屏 blit

在中端移动（1600×900）这是 **2 × (5.5 + 3.6) = 18.2 MiB**。而自写管线只需：
- 1 张全分辨率 RT：5.5 MiB
- 1 张 1/4 ping-pong：0.69 MiB

**省 12 MiB（占中端纹理红线 96 MiB 的 12.5%）**。这 12 MiB 正好是 3 套 lightmap 的空间。

### 4.3 为什么禁止 WebGL1 回退

2026 年 WebGL2 渗透率 > 95%。做 WebGL1 回退意味着：
- 材质 shader 需要两套变体（`GLSL ES 1.00` vs `3.00`）
- Lightmap crossfade 注入要写两遍
- 测试矩阵翻倍

**成本远大于覆盖的 5% 用户**。改为给这 5% 一个体面的"请升级浏览器"页面。

### 4.4 为什么移动端 `antialias: false`

iOS WebGL2 的 MSAA **实际不生效或极贵**（Phase 1 §4.4）。移动端改用后处理 SMAA（~0.4 ms），比 MSAA 便宜且效果可控。

## 5. 影响

### 5.1 正面

| 项 | 说明 |
|---|---|
| 首屏 JS | Three core ~170 KB gzip + 业务 ~120 KB gzip = **290 KB**，占 3.5 MB 首屏的 8.3% |
| 后处理内存 | 比 `EffectComposer` 省 **12 MiB**（中端移动） |
| Shader 控制 | 保留 `onBeforeCompile`，ADR-103 的 crossfade 得以实现 |
| 部署 | 零构建，`src/` 直接静态托管 + Service Worker 缓存，符合用户偏好 |

### 5.2 负面 / 代价

| 项 | 说明 | 缓解 |
|---|---|---|
| **锁定单一版本** | 升级需跑三项回归（crossfade / morph / skinned shadow） | 风险 T-13；importmap 锁版本 |
| **shader 注入是脆弱依赖** | 依赖 `<lights_fragment_maps>` chunk 名 | 风险 T-5；**Spike A 必须先跑通**（§7 验收） |
| **自写后处理维护成本** | ~200 LOC，需要自己处理 resize / DPR / RT 释放 | 单元测试覆盖 resize 路径 |
| **无 WebGL1 回退** | ~5% 用户被挡在门外 | 体面的升级提示页 |

### 5.3 对下游的约束

| 对象 | 约束 |
|---|---|
| 美术 | DPR 由程序控制（H 1.5 / M 1.25 / L 1.0），不接受"Retina 全分辨率"（AR-9） |
| 美术 | 后处理顺序：色彩分级必须在 ACES **之后**（AR 见架构 §6.7） |
| 全员 | **全局只创建 1 个 WebGL context**——日记快照复用主 renderer 的 RT，不新建离屏 renderer |

## 6. 风险

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| **A101-R1** | `onBeforeCompile` 注入依赖 Three.js 内部 chunk 名，升级后可能静默失效 | 🟠 P1 | **Spike A 必须跑通并截图留证**；升级 checklist 含三项回归（crossfade / morph / skinned shadow）；见 T-5 |
| **A101-R2** | 桌面 2560×1440 后处理 1.91 ms 占帧预算 11.5% | 🟡 P2 | 若实测超标，把 vignette 合进 tilt-shift 上采样 pass，省一次全屏遍历 |
| **A101-R3** | `WEBGL_debug_renderer_info` 被现代浏览器限制，GPU 字符串不可靠 | 🟡 P2 | 设备分档以 **1 s benchmark** 为准，GPU 字符串只作弱提示（ADR-106） |
| **A101-R4** | 无 WebGL1 回退导致 ~5% 用户流失 | 🟡 P2 | 接受。这 5% 设备的性能也跑不动本作的美术规格 |

## 7. 验收

| # | 项 | 判定 |
|---|---|---|
| V-101-1 | r172 上 `onBeforeCompile` 注入跑通，crossfade 视觉正确（截图留证） | Spike A |
| V-101-2 | 中端移动 draw call ≤ 80，其中后处理 3 | WebGL Inspector |
| V-101-3 | 后处理 RT 占用 ≤ 6.2 MiB（中端） | GPU 内存 profile |
| V-101-4 | 全局 WebGL context 数 == 1 | 运行时断言 |
| V-101-5 | 首屏 JS ≤ 300 KB gzip | bundlesize CI |

---

*ADR-101 · 程基岩 · 待会签*
