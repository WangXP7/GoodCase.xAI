# PH7 · 发布文档漂移核查报告

| 项目 | 内容 |
|---|---|
| **文档编号** | PH7-DOC-AUDIT-001 |
| **角色** | 路远行 · 发布运营 |
| **核查日期** | 2026-09-10 |
| **核查对象** | `docs/release/` 下 5 份文档 |
| **方法** | **以磁盘实际状态为唯一事实来源**；所有数字来自本机实跑（命令与输出见 §2） |
| **裁决** | 发现 **10 处漂移**，已修正 **8 处**；**2 处超出我的可改范围**，记录待裁决（§5） |

---

## 0. 核查原则

1. **不采信任何口头回报**（包括此前的"已交付"与本次派单单里给的数字），一律以磁盘 + 实跑为准。
2. **每个数字都标来源**：哪条命令、哪次运行。
3. **未能核实的项如实列出**（§4），不假装验证过。

---

## 1. 核查环境

| 项 | 实测值 |
|---|---|
| Node 实际路径 | `C:/Users/xp772/.workbuddy/binaries/node/versions/22.22.2-3/node.exe` |
| Node 版本 | v22.22.2 |
| 浏览器 | Chromium 1234（`ms-playwright`） + SwiftShader 软件光栅 |
| 工作目录 | `D:/68.AIGC/xWorkBuddy/GoodCase/tideline` |

> ⚠️ **环境漂移**：全部发布文档里的命令都硬编码了 `.../versions/22.22.2-2/node.exe`，
> **该目录在本机已不存在**（实际为 `-3`）。照抄文档命令会直接失败。→ 见 §3 **D6**。

---

## 2. 实跑结果（本次核查的原始依据）

### 2.1 六套测试（逐条实跑，非转载）

| # | 套件 | 命令 | 本次实测 | 文档记载 | 判定 |
|---|---|---|---|---|---|
| 1 | 冒烟基线 | `node tests/smoke-mvp.js` | **48 / 0**（exit 0） | 48 / 0 | ✅ 一致 |
| 2 | 光敏安全 | `node tests/test-safety-fx.js` | **12 / 0**（exit 0） | 12 / 0 | ✅ 一致 |
| 3 | 防漏洞裁决 | `node tests/test-exploit-guard.js` | **29 / 0**（exit 0） | 29 / 0 | ✅ 一致 |
| 4 | 长跑边界 | `node tests/test-soak-stress.js` | **23 / 0**（exit 0） | 23 / 0 | ✅ 一致 |
| 5 | 真实浏览器 · 多文件 | `node tests/browser-verify.js` | **41 / 0**（exit 0） | 41 / 0 | ✅ 一致 |
| 6 | 真实浏览器 · 单文件 | `TL_ROOT=dist TL_ENTRY=tideline-v0.1.0.html node tests/browser-verify.js` | **41 / 0**（exit 0） | 41 / 0 | ✅ 一致 |
| 7 | **真实浏览器 · 公网** | `TL_URL=<公网> node tests/browser-verify.js` | **41 / 0**（exit 0） | **未记载** | ⚠️ 文档缺口 → D4 |
| 8 | 深海可读性 | `node tests/art-deep-verify.js` | **6 / 0**（exit 0） | 6 / 0 | ✅ 一致（Δ 见下） |

### 2.2 两个"单次采样"型数字（非固定值）

| 指标 | 文档记载 | 本次实测 | 说明 |
|---|---|---|---|
| C-09 深海明度差 | `Δ=73.4pp` | 连跑 3 次：**73.7 / 73.3 / 73.4 pp** | **逐次波动**（帧内容随鲨鱼位置/RNG 变化）。73.4 落在区间内，属**代表性单次值**而非定值 |
| 真实帧率 | `31.2 fps` | **27.8 fps** | 软件光栅下逐次波动。两者都只是**同一保守量级的不同采样** |

> 结论：这两个数字**不是错的**，但文档把它们写成了定值。已在 §3 **D3** 改为区间/采样口径。

### 2.3 产物与公网（本次独立复核）

| 检查 | 实测 | 结论 |
|---|---|---|
| `dist/index.html` | 179,928 B | 存在 |
| `dist/tideline-v0.1.0.html` | 179,928 B | 存在 |
| 两份产物是否相同 | MD5 均为 `7B7CA67BECBBBA78184096C95B7EDAF1` | **逐字节一致** |
| 公网 `https://4ac70bca00374608a9180bed67f19118.app.workbuddy.link` | HTTP **200**，179,928 B，MD5 同上 | **与 `dist/index.html` 逐字节一致** |
| 产物内容：标题 | 含「潮线 TIDELINE · 测试版 v0.1.0」 | ✅ |
| 产物内容：硬红线常量 | `FLASH_GAP: 0.51` | ✅ |
| 产物内容：外部引用数 | `http(s)://` 引用 = **0**；`<script src=` = **0**；`.png/.mp3/.woff` = **0** | ✅ 全内联 |
| 产物内容：内联脚本块 | 15 个 | ✅ 与 `index.html` 一致 |
| `file://` 双击运行 | **0 个 JS 错误**；canvas / WebGL / `TL.Game` / 标题屏 / 开始按钮**全部就绪** | ✅ 「双击即可玩」**已实测**（此前只是推断） |

---

## 3. 漂移清单与修正记录

| # | 漂移 | 证据 | 处置 | 修正到哪 |
|---|---|---|---|---|
| **D1** | **公网地址在 `docs/release/` 全部 5 份文档中均未记录**（只有 `README.md` 有） | 逐份通读，0 命中该 URL | ✅ 已修正 | checklist §1/§7、deployment 新增 §1.1 与 §5、delivery-summary §1.2、launch-copy A/B、CHANGELOG |
| **D2** | **`dist/index.html` 入口未被记录**（文档只列 `tideline-v0.1.0.html`） | `tools/build-single.js:74-84` 实际写出两份；`dist/` 实测两份 | ✅ 已修正 | checklist §1、deployment §1，delivery-summary §1.2 |
| **D3** | `Δ=73.4pp` / `31.2 fps` 被写成**定值**，实为单次采样 | §2.2 连跑 3 次得 73.7/73.3/73.4；帧率得 27.8 | ✅ 已修正为采样/区间口径 | checklist §2.7、delivery-summary §2、README（不在我范围，见 §5） |
| **D4** | `PH7-deployment.md` 的「部署后自检」与「无人值守回归」**不含 `TL_URL` 公网验证** | 原文仅本地 3 步 + 本地套件 | ✅ 已修正（新增「发布后验证（三层）」+「重新发布流程」） | deployment §2 / §3 / §6 / §7 |
| **D5** | **未验证项编号口径不一致**：checklist/summary = U1–U7，README = U1–U6，`PH6-test-report.md` §11.4 = U1–U5 | 逐份比对 | ⚠️ 部分修正 | checklist 已加口径来源注；**README 与 test-report 不在我范围** → §5 待裁决 |
| **D6** | 全部命令硬编码 Node 路径 `.../22.22.2-2/...`，**本机已不存在** | §1 实测为 `-3`；`Test-Path` 对 `-2` 返回 False | ✅ 已修正为「PATH 优先 + 备用路径」 | deployment §3、checklist §1 |
| **D7** | `CHANGELOG.md` **未记录"发布到公网"这一事件** | 原文无 deployment/release 段 | ✅ 已修正 | CHANGELOG 新增「发布」段 |
| **D8** | `PH7-launch-copy.md` 未给公网地址（只有"发单文件"路径） | 原文 A/B/C 均无 URL | ✅ 已修正（在线链接设为方式一） | launch-copy A/B/C |
| **D9** | `tools/build-single.js` **头部注释**仍写「产物：`dist/tideline-v<版本>.html`」，未提 `index.html` | 文件头 line 9 vs 实现 line 74-84 | 📝 仅记录 | **不可改**（`tools/` 属他人范围）→ §4 |
| **D10** | 「双击即可玩」（方式 A）此前**未经验证**，文档以断言形式写出 | 本次 `file://` 实测通过（§2.3） | ✅ 已升级为"已实测"并附证据 | deployment §1 方式 A |

---

## 4. 未能核实的项（如实列出）

| # | 项 | 为什么没核实 |
|---|---|---|
| V1 | `PH6-test-report.md` §4/§5 的**旧数字**（`smoke 40`、`safety 11/1`、`合计 103/1`）与 §11.3 的新数字并存 | 该文件在 `tests/` 下，**不在我的可改范围**且我未修改；无法判定 §4 是"历史快照"还是漏更新的漂移 |
| V2 | `README.md` 的未验证项只列 **U1–U6**（缺 U7 存档/持久化） | `README.md` 不在 `docs/release/`，按硬约束我不改 |
| V3 | 真人 playtest / 非 Chromium 浏览器 / 移动真机 / 硬件级光敏检测 / 音频主观听感 | 继承项目既有 U1–U5，**本轮无新增证据**，仍为未验证 |
| V4 | 公网托管的**缓存头 / CDN 行为 / 回源策略** | 我只有 URL，无托管控制台权限，未核实响应头细节 |
| V5 | 「发布目录 = `dist/`」这一说法本身 | 我从公网返回内容与 `dist/index.html` 逐字节一致**间接佐证**，但未能直接查看托管配置 |
| V6 | U6（性能）中的"31.2 fps"来源那次运行的环境细节 | 仅有文档记载，无法回溯当时的采样条件 |

---

## 5. 需主理人裁决的分歧

1. **未验证项编号口径以哪份为准？**
   现状：checklist/summary 用 **U1–U7**，README 用 **U1–U6**，test-report §11.4 用 **U1–U5**。
   建议：**统一为 U1–U7**，并让 README 与 test-report 补 U6/U7（两者都不在我可改范围）。
2. **`README.md` 与 `tests/PH6-test-report.md` 的漂移由谁修？**
   我按硬约束只改了 `docs/release/`。若需一并修正，请指定负责人。
3. **`tools/build-single.js` 头部注释（D9）**是否顺手补一句 `index.html`？（属 `tools/`，非我范围）

---

## 6. 本次核查的诚实性声明

- §2 所有数字均为**本机实跑输出**，命令见表格；未使用任何"文件存在即通过"的推断。
- 我**没有编辑** `src/`、`dist/`、`tests/`、`tools/` 下的任何**文件内容**。
- ⚠️ **但需如实说明一处副作用**：为取得真实数字，我按文档命令实跑了各测试套件。
  其中 `tests/browser-verify.js` 与 `tests/art-deep-verify.js` 会**重新生成截图**到
  `tests/_shots/`（与 `tests/_shots-single/`）—— 这是套件的既定行为，
  导致这两个目录下 PNG 证据的**时间戳/内容被刷新**。我未修改其任何源码或断言逻辑，
  也无法恢复刷新前的 PNG（仓库无 git 历史）。
  我自己的临时产物全部写在 `docs/release/` 下并在核查后**已删除**（`_audit_tmp.txt` /
  `_public.html` / `_public_raw.bin` / `_filecheck.js` / `_shots-audit/`）。
- 我**没有**执行任何发布或下线操作。
- `file://` 可运行结论来自一次性临时脚本（已删除）；其断言口径与 `browser-verify.js` 一致（0 JS 错误）。
- 本报告 §4 列出的项**不得**被解读为"已验证"。

---

*PH7-DOC-AUDIT-001 · 发现 10 处漂移 · 修正 8 处 · 2 处待裁决*
