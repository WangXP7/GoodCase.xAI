# PH6-BALANCE-001 · 验收门与改动前基线（R1 的 C1/C3 ＋ QTE 削平）

| 项目 | 内容 |
|---|---|
| **文档编号** | PH6-BALANCE-001-GATE |
| **阶段** | Phase 6 · 打磨 |
| **作者** | 严守真（Yan Soujin）· 游戏质量保障与测试工程师 |
| **状态** | ✅ 已锁定**改动前基线**（真实代码 · 确定性 bot 实跑） |
| **范围** | 把两项已裁决的变更（①R1 数值拉回设计意图；②QTE 削平悬崖）变成**可机械判定**的验收门 + 锁定**改动前基线** |
| **硬约束** | **本轮不改 `src/`**；门与基线只读。上层设计规格见 `design/gdd/PH6-BALANCE-001.md`（vince-coyer） |
| **数据来源** | 全部实跑：`tests/_bot-out/r1-gate-baseline.json`、`qte-gate-noassist.json`、`qte-gate-assist.json`、`r1-model-gate.json`、各 `*-run.txt` 日志 |
| **基线绑定 revision** | `game/game.js = 4b502969…`（= `src-md5-current.txt`）；机制文件 `constants/entities/shark/world` 与 §2 基线一致 |

> **一句话**：两项变更各给一条**可逐字复跑的判定**（R1 走 `tests/r1-gate.js` + 模型沙盘；QTE 走 `tests/qte-gate.js`）。
> **改动前基线全部 FAIL**（这正是要修的），团队改完源码后**用同一条命令复跑即得 PASS/FAIL 的翻转**。数字与命令见下。

---

## 0. 两层约定（为什么有的指标给两个数）

R1 的判据存在**两个可复现层**，本门**两层都要满足**：
- **代码层（authoritative）**：真实 `src/` 上跑确定性 bot → `scoreRate = Σbanked/Σ存活秒`。回答"**实际跑出来**怎样"。
- **模型层（diagnostic）**：R1 修正沙盘的一阶解析模型（`design/gdd/tools/r1_sandbox_corrected.py`）。回答"**为什么**、以及常数怎么调能回到设计意图"。

> team-lead 锁定的 "C1=0.80" 是**模型层**；代码层另有一值（0.986）。两者都是实跑/实算产物，**都要求 ≥1.50**。

---

## A. R1 验收门（C1 / C3）

### A.1 C1 —— 冲浪 / 深海 得分速率比值

**定义（单一事实来源：`tests/r1-gate.js`）**

| 项 | 规定 |
|---|---|
| 指标 | `scoreRate = Σbanked / Σ存活秒`（分/s）——与 R1 §1.2、bot §1.5 同构 |
| 分子 | 冲浪返程路线、k=1 的得分速率 = 画像 **`surf_k1`** |
| 分母 | 深海返程路线、k=1 的得分速率 = 画像 **`conservative`** |
| 对照纯度 | `surf_k1` 与 `conservative` **逐参数相同、仅 `route` 不同**（deep→surf）；其余：targetK=1、alarmCap=65、filter=noBeach、tetherReflex=on、taps=6.0/s |
| 样本量 | **每画像 200 局** |
| 统计窗口 | 单局上限 **60s**（3600 帧，定步长 1/60） |
| 随机性 | **完全确定性**：`U.srand(seed0 + 局号)`，`seed0 = 20240601` |
| 判定目标 | **比值 ≥ 1.50**（R1 §2.4 C1） |

**模型层同式**：`r1_sandbox_corrected.py` 的 `【E】` 输出 `C1（k=1 冲浪/深水）`，由 `--m_surf/--A_grab/--qte_hz/…` 参数化。

### A.2 C3 —— 押注数 k 的最优性（含"显著"）

**定义（`tests/r1-gate.js`）**

| 项 | 规定 |
|---|---|
| 采样 | k ∈ {1,2,3,4}，画像集 = `conservative`(k1) / `balanced`(k2) / `smart_k2`(k2) / `smart_k3`(k3) / `aggressive`(k4) |
| 排序指标 | 同一 `scoreRate`（分/s） |
| 「最优」 | 上述集合中 `scoreRate` **最高者的 targetK** |
| 「显著」 | 最优者 `scoreRate ≥ 1.15 ×` 最佳 k=1 画像的 `scoreRate`（押注需 **≥+15%** 才算"有牙齿"） |
| 判定目标 | **最优 k ≥ 2** 且 **显著** |

> 说明：集合里 k=2 有两个配置（`balanced` alarmCap=85 / `smart_k2` alarmCap=58），保留二者以反映"同 k 不同打法"；判定取全局 argmax。

### A.3 复跑命令（固定种子）

```bash
cd D:/68.AIGC/xWorkBuddy/GoodCase/tideline

# —— 代码层（一键：自动复跑 bot 再判定；≈2–3 min）——
node tests/r1-gate.js                      # → tests/_bot-out/r1-gate-baseline.json(+.gate.json)

# —— 模型层（参数化：vince 改完常数用它快速自检）——
python design/gdd/tools/r1_sandbox_corrected.py               # 默认常数 → 【E】判定
python design/gdd/tools/r1_sandbox_corrected.py --m_surf=2.6 --A_grab=20   # 试候选常数
```

### A.4 改动前基线（已锁定）

| 判据 | 层 | 改动前基线 | 目标 | 判定 |
|---|---|---|---|---|
| **C1** | 模型层 | **0.801** | ≥1.50 | ❌ FAIL |
| **C1** | 代码层 | **0.986**（surf_k1 19.14 / conservative 19.41） | ≥1.50 | ❌ FAIL |
| **C3** | 模型层 | 最优 **k=1**（倍数 1.000） | k≥2 且倍数 ≥1.15 | ❌ FAIL |
| **C3** | 代码层 | 最优 **k=1**（conservative 19.41） | k≥2 且倍数 ≥1.15 | ❌ FAIL |

| 画像 | k | scoreRate（分/s） | 死亡/200 |
|---|---|---|---|
| conservative | 1 | **19.41** | **0** |
| balanced | 2 | 8.58 | 155 |
| smart_k2 | 2 | 11.53 | 68 |
| smart_k3 | 3 | 8.27 | 112 |
| aggressive | 4 | 2.66 | 166 |
| *surf_k1（C1 新增对照）* | *1* | *19.14* | *1* |

---

## B. QTE 削平悬崖 验收门

### B.1 判据定义（单一事实来源：`tests/qte-gate.js` 顶部 `GATE` 常量）

> 夹具：`G.enterBeached(s)` 制造初始条件（唯一白盒）→ 之后 QTE 全程**真实逻辑** + **真实空格连打时间戳**（同 §1.3）。
> 「逃脱率」= `!G.qte.active && G.shark.alive && !G.over` 的占比。

| 编号 | 判据（可机械判定） |
|---|---|
| **B1 无悬崖** | 在 **1.0→4.0 次/s（步长 0.2，16 点）** 上，**每一档抖动**的**相邻逃脱率绝对差 ≤ 40 个百分点** |
| **B2 低技巧兜底** | **1.2 次/s**：**ideal ≥ 60%**（低连打人群不得必死，硬红线②）；附加 **±50% ≥ 40%** |
| **B3 高技巧上限** | **4.0 次/s**：**ideal ≥ 95% 且 ±50% ≥ 95%**（改动不得压低上限） |
| **总判定** | **B1 ∧ B2 ∧ B3** |

**采样规定**：抖动档 = ideal / ±10% / ±25% / ±50% / ±75% / ±100%；**每点 200 次**；`seed0=20240601`。（阈值与网格均可在 `qte-gate.js` 的 `GATE` 里改。）

### B.2 改动前基线（已锁定 · 真实代码）

逃脱率矩阵（%，节选 16 点中的关键段）：

| 抖动档 | 1.0 | 1.2 | 1.6 | 1.8 | **2.0** | **2.2** | 2.4 | 3.0 | 3.6 | 4.0 | 6.0 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 理想(无抖动) | 0 | 0 | 0 | 0 | **0** | **100** | 100 | 100 | 100 | 100 | 100 |
| ±10% | 0 | 0 | 0 | 0 | 31 | 100 | 100 | 100 | 100 | 100 | 100 |
| ±25% | 0 | 0 | 0 | 3 | 40 | 92 | 100 | 100 | 100 | 100 | 100 |
| ±50% | 0 | 0 | 5 | 21 | 40 | 74 | 91 | 100 | 100 | 100 | 100 |
| ±75% | 1 | 2 | 15 | 30 | 47 | 68 | 82 | 99 | 100 | 100 | 100 |
| ±100% | 1 | 3 | 13 | 19 | 28 | 43 | 57 | 94 | 100 | 100 | 100 |

| 判据 | 改动前 | 判定 | 反例 |
|---|---|---|---|
| **B1** | ideal 最大相邻Δ = **100pp @2→2.2**；±10% 70pp；±25% 53pp | ❌ **FAIL** | **2.0 次/s 0% → 2.2 次/s 100%**（理想档，单档 100pp 跳变） |
| **B2** | 1.2/s：ideal **0%**、±50% **0%** | ❌ **FAIL** | 1.2 次/s 低连打人群**必死**（硬红线②被现机制直接违反） |
| **B3** | 4.0/s：ideal 100%、±50% 100% | ✅ PASS | — |
| **总** | — | ❌ **FAIL**（预期） | — |

**复跑命令**：
```bash
node tests/qte-gate.js                 # 非 assist（B 门以此档为准）→ tests/_bot-out/qte-gate-noassist.json
```

---

## C. assist / 非 assist 双档对比（QTE_ASSIST 会随机制改动失效）

改机制后 `QTE_ASSIST { WINDOW:3.5, NEED:3 }` **同样要重定**。给出两档 + 对比器：

```bash
node tests/qte-gate.js --assist=0      # 默认档 → qte-gate-noassist.json
node tests/qte-gate.js --assist=1      # 辅助档（boot({qteAssist:true})）→ qte-gate-assist.json
node tests/qte-gate-compare.js         # 并排 + 机械判定
```

**对比器判据**：
- **M1**：分别输出两档的 B1/B2/B3 与总判定（**B 门以 non-assist 为准**）。
- **M2 单调可及**：∀(速率, 抖动档)，`assist 逃脱率 ≥ non-assist 逃脱率`（辅助**不得**比默认更难）。
- **M3 非平凡**（仅提示）：assist 是否在 1.0/s 处已 100%（过宽只提示，不判 FAIL）。

**改动前基线**：

| 档 | window/need | B1 | B2 | B3 | 总判定 |
|---|---|---|---|---|---|
| **非 assist** | 2.5s / 6 | ❌ | ❌ | ✅ | ❌ FAIL |
| **assist** | 3.5s / 3 | ✅ | ✅ | ✅ | ✅ PASS |

- **M2 单调可及**：**违反 0 格** ✓（当前 assist 处处 ≥ 默认）。
- 最坏抖动逃脱率（%）：默认档 1.2/s = **0**；辅助档 1.2/s = **100**。

---

## D. 改动前基线总表（LOCK）

| 门 | 指标 | 基线 | 目标 |
|---|---|---|---|
| R1 · C1 | 模型层 k=1 冲浪/深水 | **0.801** | ≥1.50 |
| R1 · C1 | 代码层 k=1 冲浪/深水 | **0.986** | ≥1.50 |
| R1 · C3 | 最优 k（两层） | **1** | ≥2 且倍数 ≥1.15 |
| R1 · 速率 | k1/k2/k3/k4 scoreRate | **19.41 / 8.58·11.53 / 8.27 / 2.66** | 单调性待设计定 |
| R1 · 死亡 | 各画像死亡数 | **0 / 155 / 68 / 112 / 166** | — |
| QTE · B1 | 相邻Δ（逐抖动档） | 最坏 **100pp @2→2.2** | ≤40pp |
| QTE · B2 | 1.2/s ideal / ±50% | **0% / 0%** | ≥60% / ≥40% |
| QTE · B3 | 4.0/s ideal / ±50% | **100% / 100%** | ≥95% / ≥95% |
| QTE · 总 | 非 assist / assist | **FAIL / PASS** | 均 PASS |

---

## E. 交接口：vince-coyer 改完常数怎么自检

1. **模型层先跑**（秒级）：把候选常数喂给沙盘，直到 `【E】` 输出 `C1 PASS 且 C3 PASS`
   ```bash
   python design/gdd/tools/r1_sandbox_corrected.py --m_surf=<x> --A_grab=<y> --qte_hz=<z> --P75_deep=<d> --P75_surf=<s>
   # 判定写入 tests/_bot-out/r1-model-gate.json
   ```
2. **代码层再跑**（分钟级）：改完 `src/` 后用同一条命令复跑，看是否翻转
   ```bash
   node tests/r1-gate.js          # R1：C1/C3
   node tests/qte-gate.js         # QTE：B1/B2/B3
   node tests/qte-gate.js --assist=1 && node tests/qte-gate-compare.js   # 辅助档
   ```
3. **本门是建议性（advisory）**：给 PASS/FAIL，**放行仍由用户/主理人裁决**。

---

## F. 交付物清单

| 文件 | 说明 |
|---|---|
| `tests/PH6-BALANCE-001-acceptance-gates.md` | 本文档（门定义 + 基线 + 命令） |
| `tests/r1-gate.js` | R1 验收门判定器（代码层；可自动复跑 bot） |
| `tests/qte-gate.js` | QTE 验收门跑分+判定（`--assist` 两档） |
| `tests/qte-gate-compare.js` | assist/非 assist 对比器（M1/M2/M3） |
| `design/gdd/tools/r1_sandbox_corrected.py` | R1 模型层（已参数化，含 `【E】` 判定 + `r1-model-gate.json`） |
| `tests/_bot-out/r1-gate-baseline.json`(+`.gate.json`) | R1 代码层基线（含新画像 `surf_k1`） |
| `tests/_bot-out/qte-gate-noassist.json` / `qte-gate-assist.json` | QTE 两档基线矩阵 + 判定 |
| `tests/_bot-out/r1-model-gate.json` | R1 模型层基线判定 |
| 日志 | `r1-gate-baseline-run.txt`、`qte-gate-rerun.txt`、`r1-sandbox-run.txt`、`r1-gate-baseline-judge.txt` |

> `tests/bot-playtest.js` 已扩展：新增 `surf_k1` 画像（C1 对照对）与 `--out=<file>`（落盘改名，**不动 §2 的 `summary.json`**）。

---

## G. 诚实性边界

1. **代码层 C1=0.986 ≠ 模型层 C1=0.801**：代码层含 bot 的能力上限（不会完整跑"冲浪 8 连"路线，见 bot 报告 §7），故代码层更接近"bot 能不能吃到冲浪优势"，模型层更接近"设计意图下应如何"。**两层都要求 ≥1.50**，避免"改一个参数就过门"。
2. **C3 的"显著阈值 1.15"是本门新引入的**（team-lead 只给了方向）；如需改，改 `tests/r1-gate.js` 顶部 `SIGNIF` 即可，判定随之重算。
3. **QTE 门以 non-assist 为准**；assist 档只作"辅助不劣于默认"的护栏（M2）。
4. **抖动是合成的**（`(1/rate)·(1−a+2a·U)`），非人类连打分布。
5. 本门**只读 `src/`**，不修改任何源码；`summary.json` 保持 §2 基线不变（基线另存 `r1-gate-baseline.json`）。

---

*文档结束 · PH6-BALANCE-001-GATE · 改动前基线：R1 C1/C3 ❌FAIL、QTE 削平 ❌FAIL（assist ✅）*
