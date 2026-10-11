# ADR-105 · 资产管线与压缩：glTF/GLB + meshopt + KTX2 分通道编码 + WebP 二级回退

| 项 | 内容 |
|---|---|
| **编号** | ADR-105 |
| **状态** | 已提议（Proposed）· **含 1 项需美术确认的取舍（Atlas 分辨率）** |
| **日期** | 2026-08-30 |
| **决策者** | 程基岩（技术总监 / 主程） |
| **会签** | 林绘澄（美术）、游承峰（主理人） |
| **相关** | ADR-101（渲染栈）、ADR-103（lightmap 编码）、ADR-106（降级） |
| **上游** | `PH1-3d-feasibility.md` §4.2、§4.4、§5；美术圣经 §3.3、§8.3 |

---

## 1. 背景

本作是**纯网页 + 移动端浏览器**，首屏预算 **≤ 3.5 MB（中端移动）**，完整包 ≤ 8 MB。同时美术要求"3D 高模"（RUL-2 验收按视觉精度）。这两个约束只能通过**压缩管线**同时满足。

同时，ADR-103 的 4 套 lightmap 每张 2048²，是首屏与显存的双重压力源。

用户偏好：**零外部资产依赖、少文件、importmap 固定版本**——这排除了需要复杂离线工具链的方案。

---

## 2. 决策

### 2.1 总表

| 领域 | 选型 | 版本 / 参数 |
|---|---|---|
| **模型容器** | **`.glb`**（二进制 glTF 2.0） | — |
| **几何压缩** | **`EXT_meshopt_compression`（meshopt）** | decoder ≈ **12 KB gzip** |
| **纹理容器** | **KTX2 + Basis Universal** | `KTX2Loader` + transcoder WASM |
| **纹理编码 · albedo / lightmap** | **UASTC LDR 4×4 + KTX2 zstd**（高质量档）<br>**ETC1S + zstd**（Android 兼容档） | 8 bpp / 4 bpp |
| **纹理编码 · normal** | **UASTC + zstd**（**必须**，ASTC 优先） | 8 bpp |
| **纹理编码 · mask / UI** | **ETC1S + zstd**（够用） | 4 bpp |
| **二级回退** | **WebP**（无 KTX2 支持时） | — |
| **末级回退** | **RGB565**（lightmap）/ PNG（UI） | — |
| **字体** | woff2 子集化 | ≤ 50 KB |
| **音频** | MVP 无音频（U8 默认静音） | — |

### 2.2 为什么 meshopt 而非 Draco

| 项 | meshopt | Draco |
|---|---|---|
| Decoder 体积 | **≈ 12 KB gzip** | **≈ 180 KB gzip** |
| 解压速度 | 快（~1.5× Draco） | 慢 |
| 压缩率 | 略低（几何 ~1.5–2× 于 Draco） | 略高 |
| 首屏影响 | **decoder 占首屏 0.35%** | **decoder 占首屏 5.1%** |

> **首屏 3.5 MB 预算下，168 KB 的 decoder 差额是关键。** meshopt 的压缩率劣势可以通过"分批加载 + 后台解压"弥补（架构 §7.3）。

### 2.3 分通道纹理编码（关键）

| 通道 | 编码 | 理由 |
|---|---|---|
| **albedo** | UASTC（高质档）/ ETC1S（兼容档） | 色彩数据，ETC1S 的块效应在平坦色块上可见但可接受 |
| **normal** | **UASTC → ASTC 4×4（强制）** | **法线贴图的 ETC1S/ETC1 块效应非常明显**，会出现"阶梯状高光"。ASTC 对 XY 双通道数据质量好得多 |
| **ORM / mask** | ETC1S | 单通道打包数据，ETC1S 够用 |
| **lightmap** | **UASTC → ASTC 4×4** | **低频渐变数据，banding 是最致命的缺陷**（ADR-103 §6.1） |
| **UI 图集** | ETC1S / WebP | 非 3D，优先级低 |

> ⚠️ **iOS 的关键约束**：Basis 的 **ETC1S 不能转码到 ASTC**（只能转 ETC1/ETC2/BC1/BC3/PVRTC1）。而 **PVRTC1 4bpp 在法线与低频渐变上会产生严重色带**。
> **因此：法线与 lightmap 在 iOS 上必须走 UASTC→ASTC，不能用 ETC1S→PVRTC。**

### 2.4 加载时序与体积核算（中端移动）

| 阶段 | 内容 | 累计下载 |
|---|---|---|
| **P0** 0–1 s | HTML/CSS/JS（Three 170 KB + 业务 120 KB）、猫 LOD0 + 4 姿态、猫贴图、**当前 slot lightmap 1 套**、地板/墙 shell、字体 | **≈ 1.9 MB** |
| **P1** 1–3 s | A 档 5 件、环境 Atlas、**相邻 slot lightmap 1 套**、猫 4 姿态 | **≈ 3.3 MB** |
| **P2** 3–5 s | B 档 10 件（合并 batch）、C 档 Atlas、窗外天空 | **≈ 3.8 MB** |
| **P3** 5–8 s | 剩余 B/C 档、**剩余 2 套 lightmap**、剩余 4 姿态、季节资源（按需） | **≈ 5.6 MB**（后台） |

| 单套 lightmap 下载体积 | 值 |
|---|---|
| ETC1S + zstd（~1.2 bpp） | 0.60 MB |
| **UASTC + zstd（~2.0 bpp，采纳）** | **1.00 MB** |
| UASTC + zstd 高质（~2.8 bpp） | 1.40 MB |

> ⚠️ **首屏（P0+P1）核算 3.3 MB，预算 3.5 MB → 余量仅 6%。这是紧的。** 已列为风险 **T-9**。

### 2.5 首屏压缩的两条缓解手段（需美术确认）

| # | 手段 | 省下 | 代价 |
|---|---|---|---|
| **①** | **环境 Atlas 从 2048² 降到 1024²** | **−0.75 MB**（首屏 3.3 → 2.55 MB，余量 27%） | C 档装饰物件在**近景档**（viewSize 2.4 m）可能有可见的贴图模糊 |
| **②** | **A 档拆两批**（沙发/窗 P0，书架/茶几/灯 P1） | −0.25 MB | 首屏房间不完整约 1–2 s |

> 📋 **需林绘澄确认（架构 H-2 / AR-10）**：环境 Atlas 能否降到 1024²？我的推荐是**降**（安全优先）。

### 2.6 解压与流式加载

| 项 | 规则 |
|---|---|
| 解压时隙预算 | **每帧 ≤ 5 ms** 用于 decode，超出推迟到下一帧 |
| 后台解压 | `requestIdleCallback`（有则用）/ 自定义时隙 |
| 解码器加载 | **懒加载**（首屏不被 decoder 阻塞）；首屏用 WebP 占位 |
| 本地缓存 | 解压后的资产缓存进 IndexedDB（`blobs` store），下次访问跳过下载 |

### 2.7 资产命名与目录

```
assets/
├── models/
│   ├── cat/cat_body.glb                  # 20k tris, meshopt, 含骨骼 + 8 morph
│   ├── A/{A_sofa_lod0,A_sofa_lod1,...}.glb
│   ├── B/B_{bowl,toy_ball,...}.glb        # 运行时合并为 ≤3 batch
│   ├── C/C_{frame_01,plant_01,...}.glb    # 运行时合并为 ≤2 batch
│   └── outside/{tree_spring,tree_summer,tree_autumn,tree_winter}.glb
├── textures/
│   ├── atlas_env_albedo.ktx2              # 2048² (或 1024²，待确认)
│   ├── atlas_env_normal.ktx2              # 2048², UASTC
│   ├── atlas_C_albedo.ktx2                # 1024²
│   ├── cat_body_{albedo,normal,orm}.ktx2
│   └── vfx/{dust,fur_card}.ktx2
├── lightmap/
│   └── lm_{morning,noon,dusk,night}.ktx2  # 2048², UASTC, 无 mipmap
└── fonts/eaves_hand.woff2                 # ≤ 50 KB
```

---

## 3. 备选方案

### 3.1 备选 A · Draco 压缩

| 维度 | 评价 |
|---|---|
| 优点 | 压缩率比 meshopt 高 ~1.5–2× |
| 缺点 | **decoder ≈ 180 KB gzip**，占首屏预算 5.1%；解压慢 |
| 判定 | ❌ **否决**。除非首屏预算放宽到 6 MB+ |

### 3.2 备选 B · 不压缩几何（裸 glTF）

| 维度 | 评价 |
|---|---|
| 优点 | 零 decoder、零解压成本 |
| 缺点 | 猫 20k tris + A 档 43k tris + B/C 档 ~95k tris ≈ **5–8 MB 裸几何**。首屏必炸 |
| 判定 | ❌ **否决** |

### 3.3 备选 C · 纹理用 WebP / PNG（不用 KTX2）

| 维度 | 评价 |
|---|---|
| 优点 | 兼容性最好；无 transcoder WASM |
| 缺点 | **WebP/PNG 在 GPU 上必须解码为 RGBA8**（32 bpp）→ lightmap 单套 **16 MiB**（vs ASTC 4.0 MiB）；4 套 = 64 MiB = **66.7% 触发 ADR-103 的降级**；且解码在 CPU 上，首屏多 200–500 ms |
| 判定 | ❌ **主路径否决**，保留为**二级回退**（回退时强制 lightmap 降为 2 套 + 1024² + RGB565） |

### 3.4 备选 D · 纹理用 ASTC 裸文件（不经 Basis）

| 维度 | 评价 |
|---|---|
| 优点 | 无 transcoder；iOS 上质量最佳 |
| 缺点 | **Android 不支持 ASTC 的设备无法读取**；需要为 iOS / Android 各出一套文件（资产管线条数翻倍） |
| 判定 | ❌ **否决**。KTX2/Basis 的意义就在于"一份文件，多端转码" |

### 3.5 备选 E · 全部用 UASTC（不分通道）

| 维度 | 评价 |
|---|---|
| 优点 | 质量一致最优；管线条数少（只需一种编码设置） |
| 缺点 | albedo / mask 通道付出 2× 显存与 1.5× 下载，但收益不可见 |
| 判定 | ⏸ **不采纳但可接受**。若美术认为管线条数比显存更重要，可以统一用 UASTC（代价：纹理总显存从 26.45 → 约 34 MiB，仍在 96 MiB 内） |

### 3.6 备选 F · 引入 glTF-Transform / 自研 CLI 资产流水线

| 维度 | 评价 |
|---|---|
| 优点 | 自动化、可复现 |
| 缺点 | 引入 Node 工具链，与用户"零构建"偏好冲突 |
| 判定 | ⏸ **采纳但限定范围**：只用 `gltf-transform` CLI 做**离线一次性处理**（Draco/meshopt 压缩、KTX2 转换、UV1 检查），**不进运行时，不进 CI**。产物直接提交到 `assets/` |

---

## 4. 理由

### 4.1 为什么法线与 lightmap 必须用 UASTC→ASTC

| 数据类型 | ETC1S 的表现 | ASTC 4×4 的表现 |
|---|---|---|
| **法线（XY 双通道）** | 块效应 → **"阶梯状高光"**，在沙发倒角、猫的轮廓上非常明显 | 平滑 |
| **lightmap（低频渐变）** | **banding（色带）** → 黄昏的暖色渐变出现条纹，直接破坏"家的诗意" | 平滑 |
| albedo（平坦色块） | 可接受 | 更好 |
| mask（单通道） | 完全可接受 | 更好 |

**法线与 lightmap 的质量缺陷是"看得出且伤氛围"的，albedo 的是"看不出"的。把预算花在刀刃上。**

### 4.2 为什么首屏只下 1 套 lightmap

4 套全下 = 4.0 MB（UASTC+zstd），超过整个首屏预算。而 crossfade 在**进入后的头几分钟内不会触发**（过渡窗 45 游戏分钟 = 225 真实秒），所以：

- P0 下当前 slot 1 套（1.0 MB）→ 立即可玩
- P1 下相邻 slot 1 套（1.0 MB）→ crossfade 目标在位
- P3 下剩余 2 套（2.0 MB）→ 覆盖异常路径

**这是把 4 套的成本从"首屏"移到"后台"，且不损失任何视觉。**

### 4.3 为什么解压要限流到 5 ms/帧

一次性解压全部资产会在低端机上造成 **2–5 秒的白屏**，玩家会以为页面挂了。限流 + 分批加载（架构 §7.3 的 P0–P3）让解压成本摊进"本来就在加载"的时间窗。

### 4.4 为什么 decoder 要懒加载

meshopt decoder 12 KB、KTX2 transcoder WASM ≈ 200 KB（未 gzip）。若放进首屏关键路径，会阻塞首帧。改为：

- 首屏用 WebP 占位贴图渲染（画面先出来）
- decoder 在 P1 阶段后台加载
- 加载完成后切换为 KTX2 贴图

---

## 5. 影响

### 5.1 正面

| 项 | 说明 |
|---|---|
| 首屏 | 3.3 MB（核算），配合 Atlas 降分辨率可到 2.55 MB |
| 显存 | lightmap 4.0 MiB/套（ASTC），稳态驻留 2 套 = 8.0 MiB |
| 质量 | 法线与 lightmap 无 banding |
| 兼容 | KTX2 一份文件覆盖 iOS（ASTC）与 Android（ETC2 / ETC1） |
| 工具链 | 只用 `gltf-transform` CLI 做离线处理，不进运行时 |

### 5.2 负面 / 代价

| 项 | 说明 | 缓解 |
|---|---|---|
| **首屏余量仅 6%** | 3.3 MB / 3.5 MB | 风险 T-9；两条缓解手段待美术确认 |
| **两套编码档位增加管线条数** | UASTC 档 + ETC1S 档 | 用 `gltf-transform` CLI 脚本化，一条命令出两套 |
| **KTX2 transcoder WASM 200 KB** | 虽懒加载但仍是体积 | 只在需要 KTX2 时下载；WebP 回退路径完全不需要 |
| **回退路径画质显著下降** | RGB565 lightmap（1024²） | 回退路径 < 2% 设备；且回退时强制降套数与分辨率 |

### 5.3 对下游的约束

| 对象 | 约束 |
|---|---|
| **美术** | 贴图最大 **2048²**，禁止 4096²（AR-6） |
| **美术** | 法线贴图必须导出为**切线空间、OpenGL 约定（+Y）** |
| **美术** | lightmap 必须 **UV1 唯一展开、不重叠**、**关闭 mipmap**（ADR-103） |
| **美术** | 模型导出前必须**清理未使用的顶点属性**（`gltf-transform dedup`） |
| **QA** | 回退路径（无 KTX2）必须在 3 台真机上验证 |

## 6. 风险

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| **A105-R1** | **首屏余量仅 6%（3.3 / 3.5 MB）** | 🟠 P1 | 风险 T-9；① Atlas 降到 1024²（−0.75 MB）② A 档拆两批 |
| **A105-R2** | 无 KTX2 能力时回退到 RGBA8 → lightmap 66.7% 触发 ADR-103 降级 | 🟠 P1 | 回退路径**强制** lightmap 降为 2 套 + 1024² + RGB565（4.0 MiB） |
| **A105-R3** | UASTC 在部分 Android 上转码到 ASTC 失败 | 🟡 P2 | 三级 fallback：ASTC → ETC2 → ETC1S→ETC1 |
| **A105-R4** | meshopt 压缩率不及预期，首屏超标 | 🟡 P2 | 备用：A 档启用 Draco（只对该档，decoder 仍只下一份） |
| **A105-R5** | 解压时隙 5 ms/帧导致加载时间被拉长到 > 8 s | 🟡 P2 | 加载阶段（有遮罩）放宽到 12 ms/帧；playable 后回落到 5 ms |
| **A105-R6** | `gltf-transform` CLI 版本漂移导致产物不一致 | 🟡 P2 | 版本锁定 + 产物提交到仓库（不每次重新生成） |

## 7. 验收

| # | 项 | 判定 |
|---|---|---|
| V-105-1 | 首屏（P0+P1）≤ 3.5 MB（中端移动） | bundlesize CI |
| V-105-2 | 完整包（P3 后）≤ 8 MB | bundlesize CI |
| V-105-3 | 中端移动纹理内存 ≤ 96 MiB | GPU 内存 profile |
| V-105-4 | lightmap `generateMipmaps === false` | CI 断言 |
| V-105-5 | 法线与 lightmap 的 KTX2 编码为 UASTC | 资产检查脚本 |
| V-105-6 | 回退路径（禁用 KTX2）在 3 台真机上可运行 | 手动 QA |
| V-105-7 | 解压时隙：加载期 ≤ 12 ms/帧，playable 后 ≤ 5 ms/帧 | 帧时间埋点 |
| V-105-8 | 无 4096² 贴图 | 资产检查脚本 |

---

*ADR-105 · 程基岩 · Atlas 分辨率需林绘澄确认 · 待会签*
