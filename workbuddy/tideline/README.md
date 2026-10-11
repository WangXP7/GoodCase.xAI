# 《潮线 TIDELINE》· 项目总览

网页版鲨鱼街机游戏 · **测试版 v0.1.0 可玩**（MVP 垂直切片）

你是条鲨鱼。冲到沙滩叼走游客，活着带回深海才算你的。
**Bank（落袋为安）还是 Push（再捞一笔）——死了全损。**

---

## 🚀 立即试玩

**方式一 · 在线（无需下载）**

👉 **https://4ac70bca00374608a9180bed67f19118.app.workbuddy.link**

**方式二 · 单文件（双击即玩）**

打开 `dist/tideline-v0.1.0.html` —— 零依赖、零联网、无需安装。

**方式三 · 本地服务器（验收推荐）**

```bash
cd src
python -m http.server 7070
# 浏览器打开 http://127.0.0.1:7070
```

---

## 🎮 操作

| 键 | 动作 |
|---|---|
| **↑ / ↓ / ← / →** 或 **WASD** | 游动（方向由玩家，速率由状态） |
| **空格 / Shift** | 冲刺（咬合的唯一载体） |
| **冲刺中穿出水面** | 💥 DECOY BREACH（炸水引开敌人；**对已锁定你的单位无效**） |
| **连打任意键** | 搁浅 QTE 脱困 |
| **P** | 暂停　·　**M** 静音 |

**掌握要点**：深海最暗最安全；越往岸边越亮也越暴露。
冲浪区飘着瓶子 / 星星 / 圆环 —— **只有冲浪状态才吃得下**。

---

## 📁 文件结构

```
tideline/
├── dist/tideline-v0.1.0.html   # ★ 单文件自包含产物（176 KB，双击即玩）
├── src/                        # 源码（15 个 JS，4,454 行）
│   ├── index.html              # 入口（1440×864）
│   └── src/
│       ├── core/               # 常量 / 工具 / 输入 / 音频
│       ├── renderer/           # WebGL2 / 图集 / 批处理器 / 后期
│       ├── game/               # 世界 / 鲨鱼 / 实体 / 粒子 / 主循环
│       └── ui/hud.js           # HUD（走 DOM，屏幕阅读器可读）
├── tools/build-single.js       # 单文件打包器（读 VERSION，自检外部请求）
├── tests/                      # 6 套验证（见下）
├── design/                     # 概念文档 + R1 沙盘 + 3 份 GDD + 美术圣经
├── docs/
│   ├── architecture/           # 架构 + 6 条 ADR + 阻塞项解决
│   └── release/                # 变更日志 / 发布清单 / 部署 / 邀请文案
└── PHASE1-SUMMARY.md
```

---

## ✅ 当前状态

| 阶段 | 状态 |
|---|---|
| Phase 1 · 概念孵化 | ✅ PASS |
| Phase 2 · 系统设计 | ✅ MVP 核心 3 份 GDD |
| Phase 3 · 技术搭建 | ✅ 架构 + 6 条 ADR + 6 项阻塞项已解 |
| Phase 4 · 预制作 | ✅ 资产清单 + VFX + 验收清单 |
| Phase 5 · 制作 | ✅ MVP 垂直切片可运行 |
| Phase 6 · 打磨 | ✅ 音频 / 测试 / 修复完成（**真人 playtest 未执行**） |
| Phase 7 · 发布准备 | ✅ 单文件产物 + 发布文档齐备 |

---

## 🔒 硬红线（已在代码中实现并验证）

1. **光敏性癫痫安全**
   - 全项目闪烁 **≤2Hz**（严于 WCAG 2.3.1 的 <3Hz）
   - **统一闸门**：`triggerFlash()` 内 `C.FLASH_GAP = 0.51s` —— 任意 1s 窗至多 2 闪。
     放在唯一出口上，新增闪光源自动受约束
   - **禁用硬 on/off**，一律呼吸式渐变（`MAX_FLASH_HZ ≤ 2`）
   - **5 个正交开关**可独立关闭：震屏 / 闪烁 / 扫描线抖动 / CRT / 粒子密度
   - ⚠️ **视觉限频不压制音效与文字提示** —— 信息通道不因限频而减少

2. **可访问性**
   - 颜色永不作为唯一信息通道（ALARM 三重编码：条 + 刻度形状 + 音效）
   - 血红 / 洋红靠**形态通道**分离（洋红=径向运动粒子；血红=静态填充/条/描边）
   - 色盲模式、`prefers-reduced-motion` 自动降级、HUD 走 DOM 可被屏幕阅读器读取

3. **美术规范**（美术圣经 §4.1.3 / 验收项 P-06 / C-09）
   - 鲨鱼背侧 `#4A5A6E`→`#6E7C8C`、腹侧 `#C7CFD8`→`#F2F5F8`、**3px** 深渊黑描边
   - 深海可读性实测 **Δ=73.4pp**（前景 98.1% vs 背景 24.7%）

---

## 🎯 核心数值（已通过沙盘验证）

| 参数 | 值 | 含义 |
|---|---|---|
| `m_surf` | 2.6 | 冲浪路线需布置 **8 个收集物** |
| `A_grab` | +20 | 每次捕食 ALARM 增量 |
| 最优押注数 | **k=2** | "押 2 个再走" |
| Bank 阈值 | `x < 750` | 深海 = 绝对安全区 |
| DECOY 免疫判据 | `!has_tether` | 有锁定系绳 → 免疫 |

**R1 三条判据全部通过**：C1 低 ALARM 优势 ✅ · C2 高 ALARM 反超 ✅ · C3 押注有牙齿 ✅

---

## 🧪 验证

```bash
# Node：受管运行时已在 PATH 中（`node -v` → v22.22.2），直接用 node 即可。
# ⚠️ 不要硬编码版本目录名（如 22.22.2-2）——升级后那个目录会消失，命令直接失效。
# 若必须使用绝对路径，用版本指针动态解析：
#   NODE=".../binaries/node/versions/$(cat .../binaries/node/versions/current)/node.exe"

node tests/smoke-mvp.js           # 48 / 0   区域边界·图集·核心循环·数值锚点·鲨鱼资产取证
node tests/test-safety-fx.js      # 12 / 0   光敏安全（硬红线①）
node tests/test-exploit-guard.js  # 29 / 0   防漏洞裁决
node tests/test-soak-stress.js    # 23 / 0   长跑与边界输入
node tests/browser-verify.js      # 41 / 0   真实浏览器（真实指针点击 / WebGL / 帧率）
node tests/art-deep-verify.js     #  6 / 0   深海可读性（读最终帧缓冲）

# 重新打包并用**同一套 41 项断言**验证单文件产物
node tools/build-single.js
TL_ROOT=dist TL_ENTRY=tideline-v0.1.0.html TL_SHOTS=tests/_shots-single \
  node tests/browser-verify.js    # 41 / 0

# 对**公网地址**跑同一套断言（跳过本地服务器）
TL_URL=https://4ac70bca00374608a9180bed67f19118.app.workbuddy.link \
  TL_SHOTS=tests/_shots-public node tests/browser-verify.js   # 41 / 0
```

**合计 159 项断言全绿**（48+12+29+23+41+6），单文件产物与公网环境各另计 41 项。

---

## ⚠️ 未验证项（**不作虚报**）

| # | 项 | 影响 |
|---|---|---|
| **U1** | 真人 playtest（`p_beach` 技巧曲线） | 参数"结构可平衡"已证明，"数值好玩"**未证明** |
| **U2** | 非 Chromium 浏览器 | 仅在 Chromium + SwiftShader 下验证 |
| **U3** | 移动真机 / 触屏 | 有代码路径，**未真机实测** |
| **U4** | 硬件级光敏检测 | 现有断言为静态扫描 + 运行时频率统计 |
| **U5** | 音频主观听感 | 只验证 API 与状态，**未做听感评审** |
| **U6** | 性能基准（独显 / 中低端手机） | 实测 **27.8–31.2 fps 为软件光栅下的采样值**，不是真机帧率 |
| **U7** | 存档 / 持久化 | ADR-006 提到但 MVP 未实现（无 localStorage 依赖） |

> 口径说明：U6 的帧率与美术验收的深海明度差（Δ = **73.3–73.7pp**，3 次采样）
> 都是**采样值**而非定值——软件光栅与抖动会让单次读数波动，引用时请带区间。

**已知设计差异**：MVP 把救生员 / 日光浴者作为猎物生成，与 `PH1-concept-doc.md` §5
（「MVP：救生员是敌人」）不一致。保留理由：构成"高风险高价值猎物"的合理扩展，
且在硬红线① 修复后不再构成安全风险。**待 playtest 裁决。**

详细证据与修复记录见 `tests/PH6-test-report.md`（含 §11 复验）与
`docs/release/PH7-release-checklist.md`。
