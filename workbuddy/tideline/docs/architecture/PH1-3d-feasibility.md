# 《檐下 · UNDER THE EAVES》3D 高模网页可行性预评估报告

| 项目 | 内容 |
|---|---|
| **任务 ID** | PH1-TECH-000 |
| **作者** | 程基岩 · 技术总监/主程 |
| **阶段** | Phase 1 · 技术前置 |
| **上游输入** | `design/gdd/PH1-concept-doc-EAVES.md`（文策渊 v1.0）<br>`design/art-bible/PH1-art-bible-EAVES.md`（林绘澄 v1.0）<br>视觉参考图 `clipboard-2026-08-29T04-57-53-865Z-6c1ec872.png` |
| **版本** | 1.0 |

---

## 1. 结论先行

### 1.1 可行性判定：CONCERNS（可行，但美术预算有多处需要修正）

**一句话理由**：3D 高模 + 纯网页 + 移动端浏览器**可以做**，前提是"高模"必须被严格重新定义为"风格化高模"，且林绘澄给出的 A/B/C 面数、lightmap 套数、毛发卡片数量、首屏体积均过于乐观；若按当前美术圣经直接执行，低端机必掉帧、中低端机显存/下载会超预算。

**关键判断**：
- 不是 FAIL：技术栈（Three.js WebGL2 + .glb + KTX2/Basis）选对了大方向；等距微缩+正交投影本身是网页端最便宜的高模呈现方式之一。
- 不是 PASS：当前文档里的具体数字（猫 50k 面、沙发 35k 面、48 套 lightmap、≤200 张毛发卡片、MVP lightmap 仅 5 人日）在移动端不可行或低估了实际工时。
- 必须先刹住的点：lightmap 数量、视口内三角面上限、毛发卡片数量、移动端 DPR 与动态光数量。

### 1.2 对美术预算的核心修正（摘要）

| 项目 | 美术原预算 | 程基岩修正 | 理由 |
|---|---|---|---|
| 猫三角面 | 50,000 | **≤ 20,000** | 等距微缩下猫屏占仅 ~100×60 px，50k 面 = 8 三角/像素，严重过度细分 |
| 沙发三角面 | 35,000 | **≤ 12,000** | A 档视线焦点件，但正交视角下 35k 浪费；12k 足够表现倒角/软边 |
| MVP A 档总量 | 5 件，共 120k 面 | **5 件，共 ≤ 48k 面** | 否则移动端 200k 总面预算无余量 |
| 猫形态 blendshapes | ≥ 24 | **≤ 8 morph + 其余用骨骼** | 24 morph × 25k 顶点 ≈ 7.2MB（位置）+ 7.2MB（法线），内存爆炸 |
| Lightmap 套数 | 4 时段 × 4 季 × 3 天气 = 48 套 | **MVP 1 套；Standard 0 套新增 lightmap** | 48 套 2048² ETC1S ≈ 96MB 下载/192MB 显存，移动端不可能 |
| Standard 毛发卡片 | ≤ 200 张 | **≤ 40 张，且 alpha-test/alpha-hash** | 200 张 alpha 卡片 overdraw 达 200×，中端机 fill rate 崩溃 |
| MVP lightmap 工时 | 5 人日（4 套） | **8–10 人日（1 套 + UV1 展开）** | 仅 UV1 唯一展开 30+ 物件就需要 3–5 天 |
| 移动端目标帧率 | 60 fps（高端）/ 30 fps（低端） | **中端 40–55 fps 开满；稳定 60 需关 tilt-shift/降 DPR；低端锁定 30 fps** | Fill rate 是瓶颈，不是三角面 |

---

## 2. "高模"的定义澄清

用户与美术口中的"3D 高模"是模糊词。必须拆成三档可执行工程指标。

| 档位 | 影视级 | 游戏级 PBR | 风格化高模（**本项目推荐**） |
|---|---|---|---|
| **典型面数** | 角色 100k–500k；场景 1M+ | 角色 30k–80k；场景 200k–500k | 主角 15k–25k；焦点件 8k–15k；场景合计 ≤120k（移动）/ ≤300k（桌面） |
| **贴图预算** | 4K–8K 多通道；UDIM | 2K–4K PBR 全套 | 主角 1024² albedo + normal + ORM；环境 2048² Atlas |
| **网页加载体积** | 不可行（单角色 >50MB） | 压缩后 10–30MB | **首屏 ≤4MB；完整包 ≤15MB** |
| **目标设备** | 桌面工作站 | 桌面 / 高端移动 | 中端移动及以上；低端机降级运行 |
| **预期帧率** | 离线渲染 | 桌面 60fps；移动不稳 | 桌面 60fps；中端移动 40–55fps；低端 30fps |
| **毛发方案** | XGen/Groom 实时/离线 | Hair Cards 200–500 张 | **法线烘焙 / ≤40 张 alpha-hash cards** |
| **光照方案** | 实时光追 / 离线路径追踪 | 实时光 + 烘焙 lightmap | **1 实时主光 + 1 实时点光 + 1 套烘焙 lightmap** |

### 2.1 推荐档位：风格化高模

理由：
1. **等距微缩+正交投影天然掩盖了低面数**。画面冲击力来自构图、暖光、手作材质，而不是每像素三角面。
2. **目标用户是"看 5 分钟"的治愈型玩家**，不是画面benchmark 观众；30fps 不会破坏体验。
3. **单文件/少文件、零外部资产、importmap 固定版本**的用户偏好，决定了我们不能引入 Draco/KTX2 之外的复杂离线工具链；风格化高模是能用程序化/轻量工具链交付的最高品质。

### 2.2 与林绘澄 A/B/C 分档的对应关系

| 美术分档 | 原面数 | 修正后面数 | 对应推荐档 | 备注 |
|---|---|---|---|---|
| A 档 · 主角 | 30k–80k/件 | **15k–25k/件，视口内 A 档总和 ≤48k** | 风格化高模 A | 猫永远 LOD0，但面数必须砍 |
| B 档 · 互动 | 5k–15k/件 | **2k–8k/件，尽量合并 draw call** | 风格化高模 B | 20 件独立 mesh 会爆 draw call |
| C 档 · 环境 | ≤2k/件 | **≤1.5k/件，合并到 Atlas** | 风格化高模 C | 2048² Atlas 装 30+ 件 OK |

**关键修正**：不是"A 档单件可以 80k"，而是"视口内所有 A 档加起来不能超过移动端 100k、桌面 220k"。

---

## 3. 性能预算模型

以下数字是**可验收的硬预算**，不是目标值。超过即视为性能事故。

### 3.1 首屏加载预算

| 档位 | 桌面端 | 中端移动 | 低端移动 |
|---|---|---|---|
| **网络目标** | ≤ 3s @ WiFi/4G | ≤ 5s @ 4G | ≤ 8s @ 4G/3G |
| **首屏下载量** | ≤ 4 MB（压缩后） | ≤ 3.5 MB | ≤ 3 MB |
| **解压/解码后 GPU 显存** | ≤ 80 MB | ≤ 50 MB | ≤ 35 MB |
| **JS 堆内存峰值** | ≤ 180 MB | ≤ 120 MB | ≤ 90 MB |

**首屏必加载清单（MVP）**：
- 猫 LOD0（≤20k tris）+ 12 姿态中前 4 个
- 沙发、茶几、窗、灯具（A 档 4 件）
- 地板/墙面 shell（C 档合并）
- 1 张 lightmap（2048² ETC1S ≈ 2 MB）
- 2 张 Atlas（2048² albedo + normal ≈ 4 MB）
- KTX2/Basis transcoder WASM（懒加载，首屏可用 WebP fallback 占位）
- UI 字体子集（≤50KB woff2）

合计压缩下载 ≈ **3.2–3.8 MB**。

### 3.2 运行时性能预算

| 指标 | 桌面端 | 中端移动 | 低端移动 |
|---|---|---|---|
| **目标帧率** | 60 fps | 60 fps（H 模式）/ 30 fps（M/L 模式） | 30 fps（锁定） |
| **帧时间预算** | 16.6 ms | 16.6 ms / 33.3 ms | 33.3 ms |
| **Draw Call** | ≤ 150（含 shadow pass） | ≤ 80 | ≤ 45 |
| **三角面（视口内）** | ≤ 450,000 | ≤ 220,000 | ≤ 120,000 |
| **动态光源** | ≤ 6 | ≤ 4 | ≤ 2 |
| **实时阴影** | 1 directional PCFSoft | 1 directional BasicShadowMap | 关闭或仅 blob |
| **纹理内存** | ≤ 256 MB | ≤ 128 MB | ≤ 80 MB |
| **DPR（设备像素比）** | max 2.0 | max 1.5（H）/ 1.25（M）/ 1.0（L） | 1.0 |
| **Shader 编译时间** | ≤ 500 ms | ≤ 1.2 s | ≤ 2.0 s |
| **JS 堆稳定态** | ≤ 120 MB | ≤ 90 MB | ≤ 70 MB |

### 3.3 关键瓶颈说明

- **移动端真正的瓶颈是 fill rate，不是三角面**。在 1280×720 × DPR 1.5 = 1920×1080 的分辨率下，PBR 材质 + alpha overdraw + 后处理会迅速吃满 Mali-G57/Adreno 619。
- **DPR 是最强性能杠杆**。DPR 1.5 → 1.0 可以减少 56% 的像素量，帧率提升通常 30–60%。
- **Draw call 在 WebGL2 下并非不可逾越**，但 Three.js r160 没有 `BatchedMesh`，所以 B 档 20 件独立物件必须通过**合并 mesh（MergeGeometries）+ InstancedMesh + 材质 Atlas** 降到 ≤40 个 draw call。

---

## 4. 关键技术难点与方案

### 4.1 猫咪毛发（本项目最大难点）

| 方案 | 视觉品质 | 网页端性能成本 | 开发成本 | 本项目建议 |
|---|---|---|---|---|
| **Shell Fur（多层半透明壳）** | ★★★ | 致命：50+ 层 overdraw，fill rate 爆炸 | 中 | ❌ 不可行 |
| **Fin Fur（鳍片毛发）** | ★★ | 高：几何量大，需 tessellation/大量细条 | 中 | ❌ 不可行 |
| **Hair Cards（毛发卡片）alpha blend** | ★★★★ | 高：200 张 = 200× overdraw | 中 | ⚠️ 仅桌面/高端可承受 |
| **Hair Cards（≤40 张）+ alpha test/alpha hash** | ★★★ | 中：约 0.5–1.5 ms/帧 | 中 | ✅ **Standard 推荐** |
| **纯法线贴图烘焙** | ★★★ | 极低：零几何/零 overdraw | 低 | ✅ **MVP 推荐** |
| **体积渲染** | ★★★★★ | 绝对不可行 | 极高 | ❌ 不可行 |

#### 对美术方案的校验

- **MVP "纯法线烘焙"**：✅ **合理且推荐**。零额外成本，视觉完全满足参考图的"黏土/手办"感。
- **Standard "≤200 张毛发卡片"**：❌ **需要修正**。200 张 alpha 卡片在猫轮廓处会产生 50–200× overdraw，中端移动帧率会从 45fps 掉到 20fps。
- **程基岩修正**：Standard 用 **≤40 张 alpha-test/alpha-hash 毛发卡片**，仅用于头部/尾巴轮廓；平时 fallback 到法线烘焙；被摸特写时临时启用。这样成本从 ~3–5ms 降到 ~0.5ms。

### 4.2 资产流式加载与 LOD 策略

| 阶段 | 时间 | 加载内容 | 用户可见状态 |
|---|---|---|---|
| P0 | 0–1 s | HTML/CSS、Three.js core、相机、lights、猫 LOD0 + 4 个 idle/walk 动画、1 张 lightmap、2 张 Atlas | 已能看到猫和空房间 |
| P1 | 1–3 s | 沙发、茶几、窗、灯具、其余 8 个猫姿态 | 房间完整 |
| P2 | 3–5 s | B 档 10 件高频物件（碗、玩具、地毯等） | 可开始互动 |
| P3 | 5–8 s | 剩余 B/C 档、季节/天气资源（按需） | 全部就绪 |
| 后台 | 持续 | 截图缓存、字体、音频 | 无感知 |

**LOD 策略**：
- **猫**：不做 LOD（情感核心）。
- **A 档家具**：做 2 档 LOD（LOD0 100%，LOD1 30%），在移动端视距 8m 外切换。
- **B 档**：做 2 档 LOD（LOD1 40%，LOD2 10%）。
- **C 档**：本身就是低模，不做 LOD，合并为 1–3 个 `BufferGeometryUtils.mergeGeometries` 批次。

**避免加载卡顿**：
1. 所有 glTF 使用 **Draco** 或 **meshopt** 压缩；首屏用 meshopt（decoder 小，~40KB gzip）。
2. 动画姿态按优先级分批：idle/walk/sleep 优先，rare poses 按需。
3. 使用 `requestIdleCallback` 或自定义时隙预算（每帧 ≤5ms decode）在后台解压。
4. 资源按需保留在 IndexedDB；下次访问优先走本地缓存。

### 4.3 24h 光照循环的实现

**对美术方案的校验**："1 主光实时 + 1–2 室内灯实时，其余全 lightmap 烘焙"在大方向是对的，但**"48 套 lightmap"是错误的**。

#### 推荐实现（MVP）

| 层级 | 内容 | 实现 | 成本 |
|---|---|---|---|
| L0 | 太阳主光 | 1 个 `DirectionalLight`，direction/color/intensity 按 24h 表插值 | 极低 |
| L1 | 室内灯 | 1 个 `PointLight` 或 `SpotLight`，按入夜时段自动开关 | 低 |
| L2 | 环境漫射/天空 | 1 个 `HemisphereLight`，skyColor/groundColor 按时段插值 | 零 |
| L3 | 静态间接光/AO | **1 张 2048² lightmap**（烘焙 AO + 间接光） | 2 MB 下载 / 4 MB 显存 |
| L4 | 反射 | 4–6 个反射探针（烘焙 cube map 或 PMREM） | 可选，MVP 可省 |

**为什么不需要 48 套 lightmap**：
- 季节改变的是窗外树和整体色温，不是室内间接光分布。用**窗外模型 swap + hemisphere color tint** 即可。
- 天气改变的是主光强度和玻璃水珠，不是室内烘焙。用**uniform 调光强 + shader 开关**即可。
- 24h 时段变化用**实时主光 + hemisphere 插值**即可；lightmap 只负责静态 AO/间接光，不需要随时间变化。

#### 修正后内存成本

| 方案 | Lightmap 数量 | 下载量 | 显存 |
|---|---|---|---|
| 美术方案（48 套 2048² ETC1S） | 48 | ~96 MB | ~192 MB |
| 程基岩方案（1 套 + 实时插值） | 1 | ~2 MB | ~4 MB |

### 4.4 移动端 GPU 兼容性红线

| 项目 | 支持情况 | 红线/限制 |
|---|---|---|
| **WebGL2** | iOS Safari 15+；Android Chrome 80+；2026 年渗透率 >95% | **强制 WebGL2**，不支持则提示升级浏览器 |
| **KTX2/Basis Universal** | iOS A8+ 转码为 ASTC；老设备 PVRTC；Android ETC2 | 必须提供 **WebP/PNG fallback**；Basis transcoder WASM 懒加载 |
| **ASTC 4×4** | iOS A8+；高端 Android | 法线贴图优先用 ASTC；ETC1S 法线块效应明显 |
| **浮点纹理** | iOS Safari 部分设备不支持 `OES_texture_float_linear` | **禁用 FloatType 纹理的线性过滤**；morph target/SSS 用 HalfFloat 或 8-bit |
| **MSAA** | iOS WebGL2 实际不生效或极贵 | 移动端 `antialias: false`；后处理 FXAA/SMAA |
| **纹理尺寸上限** | 移动端 4096×4096；桌面 16384×16384 | 最大纹理 ≤2048²；避免 4096² |
| **WebGL 上下文数量** | iOS 全系统 ≤8–16 个 | 本应用只创建 1 个 context |
| **iOS 内存上限** | 单个页面约 300–500 MB；纹理/堆合计超 ~384MB 易被 kill | 纹理内存严格 ≤128MB（中端）/80MB（低端） |
| **IndexedDB** | iOS Safari 支持；**Private Browsing 禁用** | 必须检测 + fallback 到 localStorage/in-memory |

### 4.5 tilt-shift 等后处理的性能成本

正交投影 + 上下模糊带是参考图"微缩感"的核心。

| 方案 | 桌面成本 | 中端移动成本 | 低端移动成本 | 推荐度 |
|---|---|---|---|---|
| 全屏 RT + 全分辨率高斯模糊 | ~0.8 ms | ~3–5 ms | ~6–10 ms | ❌ |
| 1/4 分辨率降采样模糊 + 上采样合成 | ~0.4 ms | ~0.6 ms | ~1.0 ms | ✅ **推荐** |
| 仅 vignette + 上下渐变遮罩（假 tilt-shift） | ~0.1 ms | ~0.2 ms | ~0.3 ms | ✅ **L 档兜底** |

**结论**：用 **1/4 分辨率双通道高斯模糊** 做 tilt-shift，全档位都能开；L 档可进一步关闭动态模糊，只保留 vignette。

---

## 5. 技术栈建议

| 领域 | 建议 | 备注 |
|---|---|---|
| **Three.js 版本** | **锁定 r170+**；若用户强制 r160，则接受但需额外性能余量 | r160 缺少 `BatchedMesh`，不能依赖它降 draw call；r170+ 有更好的 morph/SSS 支持 |
| **引入方式** | `importmap` 固定版本 + 原生 ES 模块，符合工作室偏好 | 不要 npm 打包；保持少文件 |
| **渲染管线** | `WebGLRenderer`，WebGL2 强制；`ACESFilmicToneMapping`，`SRGBColorSpace` | 暂不上 WebGPU（用户偏好稳定 WebGL2） |
| **后处理** | `EffectComposer` 或手动 RT；tilt-shift 用 1/4 降采样 | 禁用 bloom（美术已禁用） |
| **几何压缩** | `meshopt`（首选，decoder 小）或 `Draco`（压缩率高但 decoder 大） | 首屏 4MB 预算下 meshopt 更合适 |
| **纹理压缩** | KTX2 + Basis Universal ETC1S（albedo/lightmap）；UASTC+zstd（normal） | 提供 WebP fallback |
| **物理** | 不需要物理引擎；猫/家具移动用简单 AABB/OBB + raycast | 避免引入 cannon.js/ammo.js |
| **动画** | `THREE.AnimationMixer` + glTF 动画 clips；程序化呼吸/尾巴用骨骼直接驱动 | 不用 GSAP/anime.js |
| **状态机** | **自写轻量 HFSM**，不用 XState | XState bundle 大、事件模型过重 |
| **输入** | Pointer events 统一鼠标/触屏；双指用于家具摆放 | 长按=抚摸，拖拽=视角 |
| **存储** | **IndexedDB**（idb-keyval/Dexie）；localStorage 只存元数据 | Private Browsing 降级到 in-memory |
| **云端同步** | **MVP 不做**；Standard 阶段可选 | 用服务器时间戳防本地时间作弊 |
| **构建/部署** | 单/少文件 HTML + ES 模块；静态托管；Service Worker 缓存 | 符合用户"零外部资产"偏好 |
| **字体** | fonttools 子集化；woff2 <50KB | 避免加载完整思源宋体 |

---

## 6. 风险登记

| 编号 | 等级 | 风险 | 影响 | 缓解措施 |
|---|---|---|---|---|
| **R1** | 🔴 P0 | **iOS Safari WebGL 上下文丢失 / 内存 kill** | 页面直接白屏/重载，无法恢复 | 纹理内存 ≤128MB；监听 `webglcontextlost` 提示刷新；避免多 context；首屏先渲染再加载重资源 |
| **R2** | 🔴 P0 | **48 套 lightmap 计划导致移动端显存/下载双双爆炸** | 低端机进不去，中端机被 kill | 强制改为 **1 套 lightmap + 实时插值**；季节/天气用模型 swap + uniform 实现 |
| **R3** | 🟠 P1 | **毛发卡片数量过高（200 张）导致 fill rate 崩溃** | 中端移动掉到 20fps | 限制 ≤40 张；使用 alpha-test/alpha-hash；非特写 fallback 法线烘焙 |
| **R4** | 🟠 P1 | **首屏 4MB 预算与 KTX2/Draco 解码器体积冲突** | 解码器 WASM 本身占 100–300KB，首屏紧张 | Basis/meshopt decoder **懒加载**；首屏用 WebP/PNG 占位；解码在后台进行 |
| **R5** | 🟠 P1 | **iOS Safari Private Browsing 禁用 IndexedDB** | 用户数据无法持久化 | 运行时检测；fallback 到 localStorage（仅关键元数据）或 in-memory + 导出码 |
| **R6** | 🟠 P1 | **24 个 morph targets × 20k 顶点导致显存/堆内存过大** | 7–14MB 仅 morph 数据，低端机吃紧 | 压缩到 ≤8 morph；其余表情用骨骼驱动；关闭 morph normals |
| **R7** | 🟡 P2 | **低端 Android 不支持 WebGL2 或 shader 编译超时** | 用户无法进入 | 强制 WebGL2；不支持则优雅降级为"设备不支持"提示；简化 shader 变体 |
| **R8** | 🟡 P2 | **DPR 1.5 + 实时阴影 + tilt-shift 同时开导致中端机不稳** | 帧时间抖动，从 60 掉到 40 | M 档默认关 tilt-shift 动态模糊、关 PCFSoftShadowMap；提供一键"轻量模式" |

---

## 7. 给策划与美术的硬性约束清单

以下约束必须在 Phase 1 拍板，否则 Phase 2/3 会返工。

### 7.1 对美术的约束

1. **猫 ≤ 20,000 三角面；A 档视口内总和 ≤ 48k（移动）/ 100k（桌面）**
   - 不是"单件可以 80k"，而是"同时出现在屏幕里的 A 档加起来不能超"。
2. **禁止 48 套 lightmap；MVP 只有 1 套 2048² lightmap**
   - 季节/天气通过模型 swap、uniform 调光、玻璃水珠 shader 实现，不增加 lightmap。
3. **毛发方案锁定**
   - MVP：纯法线烘焙。
   - Standard：≤40 张 alpha-test/alpha-hash 毛发卡片，仅头尾，特写才启用。
4. **B 档物件必须合并 draw call**
   - 20 件独立 mesh = 20 draw call，加上 shadow pass 会超过移动端 80 上限。必须按材质 Atlas 合并为 1–3 个 mesh，保留 raycast 与 transform 映射。
5. **移动端动态光 ≤ 4 个（推荐 2 个）**
   - 1 directional + 1 point/spot。任何额外的"氛围灯"必须烘焙。
6. **移动端 DPR 上限由程序控制**：H 1.5 / M 1.25 / L 1.0
   - 美术不能要求"Retina 全分辨率"。
7. ** morph targets ≤ 8**
   - 耳朵/尾巴/胡须/瞳孔动画优先走骨骼。
8. **贴图最大 2048²；禁止 4096²**
   - 移动端纹理上限 4096，但大纹理会挤爆内存与带宽。

### 7.2 对策划的约束

1. **MVP 仅 1 只猫；Standard 最多 3 只同屏**
   - 每多 1 只猫 ≈ +20k tris + 1 skinned mesh + 12 anim clips + shadow caster。移动端 2 只是上限。
2. **房间自由度锁定为固定等距视角**
   - 自由漫游需要透视相机 + 动态遮挡剔除 + 寻路，工程量增加 30–50%，且破坏微缩感。
3. **家具/换装自定义数量受 draw call 限制**
   - 移动端可见可摆家具 ≤ 30 件；超出必须进入"合并 batch"或"仅桌面可用"。
4. **季节/天气不增加 lightmap**
   - 每加一种天气：+0 MB 下载、+0.5 天 shader/uniform 工作。
   - 每加一个季节：+1 套窗外树模型（~200KB）、+1 个室内 color tint（~0 天）。
5. **姿态库 12 → 24 → 32 的增量成本**
   - 运行时内存：每姿态约 0.3–0.6 MB（压缩后动画 clip）。
   - 下载：+12 姿态 ≈ +3–6 MB（按需懒加载可降到 +1 MB 首屏）。
   - 工时：+12 姿态 ≈ 4–6 周（不是林绘澄表中的 4–6 周？其实林表是 4–6 周 12 姿态，基本合理；但需确认是单美术产能）。
6. **截图功能有帧 hitch**
   - 单次截图 ≈ 10–40ms 主线程停顿；超分辨率 ×2 可达 50–200ms。
   - 移动端禁用连拍；点击后 0.3s 内不响应第二次。
7. **离线日记存储容量受限**
   - 单张"照片"若存为 PNG 约 200–500KB；20 张相册 ≈ 4–10 MB。
   - IndexedDB 容量足够，但 iOS Private Browsing 会丢失；MVP 不做云端同步。

---

## 8. 策划与美术 11 个技术问题回答

| # | 提问人 | 问题 | 结论 | 理由 |
|---|---|---|---|---|
| Q1 | 美术 | Three.js 版本（建议 r160+）+ 是否强制 WebGL2 | **锁定 r170+；强制 WebGL2** | r160 缺 BatchedMesh，morph/SSS 支持弱于 r170+；2026 年 WebGL2 覆盖率 >95%，不支持则提示升级 |
| Q2 | 美术 | 资源格式（.glb + KTX2/Basis）是否合适 | **合适，但需细分** | .glb 正确；KTX2 用 ETC1S 给 albedo/lightmap，UASTC+zstd 给 normal；必须提供 WebP fallback |
| Q3 | 美术 | 猫动画用 AnimationMixer 还是外部库 | **AnimationMixer** | 与 glTF 动画 clips 原生集成；程序化层（呼吸/尾巴）用骨骼直接驱动；GSAP/anime.js 冗余 |
| Q4 | 美术 | 状态机用 XState 还是自写 | **自写轻量 HFSM** | XState bundle 大、Actor 模型过重；猫状态机只需 currentState + weighted transitions，约 500 LOC |
| Q5 | 美术 | 移动端 30fps 降级模式的触发策略 | **三级：设备分级 → 1s 帧时间 benchmark → 用户手动覆盖** | 先用 UA/GPU 初分 H/M/L；运行时连续 3s 帧时间 >18ms 自动降档；L 档锁定 30fps |
| Q6 | 美术 | 截图功能实现（canvas.toBlob vs preserveDrawingBuffer） | **canvas.toBlob，禁用 preserveDrawingBuffer** | preserveDrawingBuffer 每帧复制 framebuffer，移动端带宽杀手；toBlob 必须在同一 rAF tick 内调用 |
| Q7 | 美术 | 离线"日记"存储（IndexedDB？是否云端同步） | **IndexedDB；MVP 不做云端同步** | IndexedDB 容量足够；iOS Private Browsing 需 fallback；云端同步 Standard 阶段再评估 |
| Q8 | 策划 | 异步快照的存储结构怎么设计 | **单一版本化 JSON + IndexedDB** | 结构：version、lastServerTime、cat（personality/needs/affection）、environment（furniture/states）、events[]、journal[]、settings |
| Q9 | 策划 | 3D 高模 + 实时光在移动浏览器的帧率基线 | **中端 40–55 fps（开满）/ 30 fps（稳定档）；低端锁定 30 fps** | 详见 §3.2；参考设备：中端 iPhone 13 / Snapdragon 7 Gen1；低端 iPhone SE2 / Snapdragon 6 Gen1 |
| Q10 | 策划 | localStorage / IndexedDB 容量管理 | **localStorage 只存元数据；IndexedDB 存主数据；相册 PNG 压缩/降级** | localStorage ≈ 5MB；IndexedDB 实际 >1GB；iOS Private Browsing 无 IDB，需 fallback |
| Q11 | 策划 | "猫没有死亡"这一前提对状态机设计意味着什么 | **状态机无终止态；所有状态循环；数值 clamp 在 floor；存档必须可验证** | 无需 death 分支；需求/亲密度最低到 0 但不触发死亡；load 时必须 validate schema |

---

## 9. 交付回传（Handoff to 主理人 游承峰）

### 9.1 文档路径

`<案例工作目录>/docs/architecture/PH1-3d-feasibility.md`

### 9.2 可行性判定

**CONCERNS（可行，但美术预算需修正）**

大方向可行：Three.js WebGL2 + .glb + KTX2/Basis + 等距微缩是正确技术栈；但林绘澄的 A/B/C 面数、48 套 lightmap、200 张毛发卡片、5 人日 lightmap 工时均过于乐观，直接执行会导致低端机无法运行、中端机显存吃紧。

### 9.3 推荐精度档位

**风格化高模（Stylized High-res）**：猫 ≤20k 面、A 档视口内 ≤48k 面、1 套 lightmap、法线烘焙毛发、≤40 张 alpha-hash cards（Standard）。

### 9.4 对美术预算的校验结果

| 认可 | 需修正 |
|---|---|
| A/B/C 分档思路 ✅ | 面数整体下调 50–70% |
| 纯法线烘焙毛发（MVP）✅ | Standard 毛发卡片从 200 张降到 ≤40 张 |
| .glb + KTX2/Basis 格式 ✅ | 需加 WebP fallback 与懒加载 decoder |
| 移动端 3 档降级 ✅ | 触发策略需细化（设备分级 + benchmark + 手动） |
| 正交投影 + tilt-shift ✅ | 用 1/4 降采样模糊实现，成本低 |
| 1 主光实时 + 烘焙其余 ✅ | 48 套 lightmap 必须砍到 1 套 |
| MVP 90.5 人日方向 ✅ | lightmap 工时应从 5d 修正到 8–10d；若按原 48 套计划则≈25–30d |

### 9.5 最重要的 5 条硬性约束

1. **猫 ≤20k 三角面；A 档视口内总和 ≤48k（移动）**。
2. **MVP 仅 1 套 2048² lightmap；禁止 48 套**。
3. **Standard 毛发卡片 ≤40 张，alpha-test/alpha-hash**。
4. **移动端动态光 ≤4 个，推荐 2 个**。
5. **MVP 仅 1 只猫；Standard 最多 3 只同屏**。

### 9.6 最担心的 2 个技术风险

1. **R1 · iOS Safari WebGL 上下文丢失 / 内存 kill**：一旦纹理/堆内存接近 ~384MB，Safari 会直接 kill 页面。本项目靠严格控制纹理内存（≤128MB 中端）和 DPR 来缓解，但 iOS 是黑盒，必须在真机上做压力测试。
2. **R2 · 48 套 lightmap 计划**：如果美术坚持按 4 时段×4 季×3 天气烘焙 48 套，移动端首屏/显存会立刻爆炸。必须现在就拍板："季节/天气不走 lightmap"。

### 9.7 下一步建议

1. **用户拍板**：确认 Three.js 版本锁定 r170+（或坚持 r160 并承担额外风险）；确认"季节/天气不走 lightmap"；确认猫面数上限 20k。
2. **Phase 2 技术前置**：输出 `PH1-TECH-ADR-001`（渲染管线选择）、`PH1-TECH-ADR-002`（毛发方案）、`PH1-TECH-ADR-003`（存储与快照结构）。
3. **原型验证**：2 周内做一个"单房间 + 单猫 + 1 套 lightmap"的 Three.js 原型，跑 iPhone 13/SE2 + 中端 Android 帧率测试，用真实数字回填本报告。

---

*文档结束 · 待主理人/用户拍板*
