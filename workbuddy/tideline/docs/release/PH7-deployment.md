# PH7 · 部署与分发

| 项目 | 内容 |
|---|---|
| **版本** | v0.1.0（测试版） |
| **产物** | `dist/tideline-v0.1.0.html`（版本化快照）· `dist/index.html`（托管根入口）—— 两份同内容，各 179,928 B ≈ 176 KB，零依赖 |
| **已上线地址** | **https://4ac70bca00374608a9180bed67f19118.app.workbuddy.link** |
| **运行要求** | 支持 WebGL2 的现代浏览器（自动降级 WebGL1）；无需安装、无需联网 |

---

## 0. 已发布状态（当前事实）

| 项 | 值 |
|---|---|
| 公网地址 | https://4ac70bca00374608a9180bed67f19118.app.workbuddy.link |
| 托管内容 | `dist/` 目录（静态托管；`index.html` 作为根路径入口） |
| 部署自检 | `Invoke-WebRequest` → **HTTP 200**，`179,928 B` |
| 一致性 | 公网返回内容与 `dist/index.html` **逐字节一致**（MD5 `7B7CA67BECBBBA78184096C95B7EDAF1`） |
| 浏览器验收 | `TL_URL=<公网> node tests/browser-verify.js` → **41 / 0**（§6.3） |

---

## 1. 四种分发方式

### 方式 0 · 在线链接（推荐给测试者）

直接发公网地址即可，**无需下载、无需安装**：

```
https://4ac70bca00374608a9180bed67f19118.app.workbuddy.link
```

- 根路径由 `dist/index.html` 提供；
- 内容与单文件产物**逐字节一致**，因此玩法与离线版完全相同。

### 方式 A · 单文件（离线分发）

把 `dist/tideline-v0.1.0.html` 单独发给对方，**双击即可玩**。

- HTML 里没有任何外部 `src` / `href`（favicon 也是内联 `data:,`）；
- 图集与音频全部**运行时程序化生成**，因此不受 `file://` 的 CORS / tainted-canvas 限制；
- 适合邮件附件、网盘、IM 直传。
- ✅ **已实测**：真实 Chromium 载入 `file:///…/dist/index.html` →
  **0 个 JS 错误**，canvas / WebGL / `TL.Game` / 标题屏 / 开始按钮全部就绪。
  （此前版本只是推断"应该能双击"，现已固化为实测结论。）

### 方式 B · 静态托管

把**整个 `dist/` 目录**上传到任意静态空间即可（对象存储 / Pages / CDN），
无需 Node、无需构建流水线。

```
dist/
├── index.html              # ★ 托管根路径入口（必须存在，否则访问域名会 404）
└── tideline-v0.1.0.html    # 版本化快照（回滚 / 直接下载）
```

> ⚠️ **`index.html` 是入口**：只上传 `tideline-v0.1.0.html` 会导致访问域名根路径 404。
> 两份文件内容相同，`index.html` 的存在只是为了满足静态托管的默认文件名约定。

若希望走「多文件源码」形态上线（便于热更单个模块），则上传整个 `src/` 目录，
入口为 `src/index.html`：

```
src/
├── index.html
└── src/            # core / renderer / game / ui + main.js
```

### 方式 C · 本地服务器（开发与验收）

```bash
cd src
python -m http.server 7070
# 打开 http://127.0.0.1:7070
```

> 说明：多文件形态**也能**通过双击 `src/index.html` 打开（`<script src>` 不受 CORS 限制），
> 但 `http://` 更贴近真实部署环境，**推荐用服务器方式做验收**。

---

## 2. 部署后自检（3 步，约 1 分钟）

| # | 步骤 | 期望 |
|---|---|---|
| 1 | 打开页面，看控制台 | **0 个 error**（尤其不能有 404） |
| 2 | 鼠标点「开始游戏」 | 能进入游戏（**这一条曾是发布阻断级缺陷**：指针被 `preventDefault` 吞掉，只有键盘 Enter 能绕） |
| 3 | 按住空格 → 切到别的窗口 → 切回来 | **不会**凭空冲刺，也**不会**误触发重开 |

> 本表是**人工快速自检**（约 1 分钟，人眼可判）。
> 正式发布/重新发布必须再跑 **§6「发布后验证（三层）」** —— 那里的断言是可复现、可留证的。

---

## 3. 无人值守回归（改动后必跑）

```bash
# ⚠️ Node 路径含版本号，随环境变化，会失效。
#    推荐用 PATH 上的 node；若不可用再指向受管二进制（先确认目录存在）。
node --version                        # 或： "$NODE" --version
NODE="${NODE:-node}"

# 1) 四条无头套件
"$NODE" tests/smoke-mvp.js           # 期望 48/0
"$NODE" tests/test-safety-fx.js      # 期望 12/0   ← 硬红线①
"$NODE" tests/test-exploit-guard.js  # 期望 29/0
"$NODE" tests/test-soak-stress.js    # 期望 23/0

# 2) 真实浏览器（多文件源码）
"$NODE" tests/browser-verify.js      # 期望 41/0

# 3) 重新打包 + 验证单文件产物（同一套断言）
"$NODE" tools/build-single.js
TL_ROOT=dist TL_ENTRY=tideline-v0.1.0.html TL_SHOTS=tests/_shots-single \
  "$NODE" tests/browser-verify.js    # 期望 41/0

# 4) 深海美术合规（读最终帧缓冲）
"$NODE" tests/art-deep-verify.js     # 期望 6/0，C-09 Δ ≥ 30pp（单次采样，实测 73.3–73.7pp）
```

退出码：全绿 = `0`，有失败 = `1`。

> 📌 第 2 步（多文件）与第 3 步（单文件）用的是**同一套 41 项断言**，
> 因此"打包不改变行为"是被证明的，而不是假设的。
> **线上部署后**，再加跑 `TL_URL` 一层 → 见 §6。

---

## 4. 版本与回滚

- **版本号唯一真源**：`src/src/core/constants.js` 的 `VERSION`。
  打包器读取它生成文件名，页面标题与 `CHANGELOG.md` 同步该值。
- **回滚**：单文件产物是**不可变快照**。保留上一版 HTML 即可瞬时回滚；
  无需数据库迁移、无需服务端配合。

---

## 5. 已知的部署侧注意

| 项 | 说明 |
|---|---|
| 音频自动播放策略 | 浏览器要求用户手势后才能出声。本作在「开始游戏」点击时初始化音频，**不依赖自动播放** |
| 首帧时间 | 图集在启动时运行时烘焙（含鲨鱼 3px 描边膨胀运算），约 1–2 帧；无需预加载指示器 |
| 高分屏 | canvas 固定 1440×864 + `image-rendering: pixelated`，按整数倍意图缩放 |
| 竖屏手机 | 显示「请横屏游玩」覆盖层（按 5:3 横屏构图，ADR-002） |
| 微软商店 / 应用封装 | 未做，也**不建议**在测试版阶段做 |

---

## 6. 发布后验证（三层）

> 目的：把"链接能打开"升级为"**线上跑的是我们验证过的那份字节**"。
> 三层互相独立：HTTP 层证明**传输完整**，内容层证明**是这一版**，浏览器层证明**真的能玩**。
> 三层全过 = 线上部署可信。

### 6.1 第一层 · HTTP 层（传输完整 + 逐字节一致）

```bash
URL="https://4ac70bca00374608a9180bed67f19118.app.workbuddy.link"

# 下载线上内容，并打印状态码与字节数
curl -sS -o online.html -w 'HTTP %{http_code}  %{size_download} bytes\n' "$URL"
# 期望：HTTP 200  179928 bytes

# 与本地产物逐字节比对（cmp 无输出 = 完全一致）
cmp online.html dist/index.html && echo "OK: 公网内容与 dist/index.html 逐字节一致"

# 双保险：哈希
md5sum online.html dist/index.html
# 期望两者同为 7b7ca67bcebbba78184096c95b7edaf1
```

PowerShell 等价写法（Windows）：

```powershell
Invoke-WebRequest -Uri $URL -OutFile online.html -UseBasicParsing
(Get-Item online.html).Length          # 期望 179928
(Get-FileHash online.html -Algorithm MD5).Hash   # 与 dist/index.html 对比
```

**失败意味着什么**：状态码 ≠200 → 托管未生效 / 路径错 / 权限问题；
字节数或哈希不符 → **线上不是这一版**（缓存旧内容、上传不完整、或打包后又改了 `src/` 未重发）。
此时**不要**对外发出链接。

### 6.2 第二层 · 内容层（确认"是哪一版"）

```bash
# ① 零外部引用（自包含的关键特征）
grep -oE '(src|href)="https?://' online.html | wc -l      # 期望 0
grep -c '<script src=' online.html                        # 期望 0

# ② 标题与版本
grep -c '潮线 TIDELINE' online.html                       # 期望 > 0

# ③ 硬红线常量确实被打进产物
grep -oE 'FLASH_GAP:[[:space:]]*[0-9.]+' online.html      # 期望 FLASH_GAP: 0.51

# ④ 内联脚本块数量与源码一致
grep -c '<script>' online.html                            # 期望 15
```

**失败意味着什么**：外部引用 ≠0 → 打包不完整（仍有外部 `src`，`file://` 与离线分发会失效）；
`FLASH_GAP` 缺失 → **硬红线① 的限频闸门不在线上产物里**，属发布阻断级；
脚本块 ≠15 → 产物与源码不同源。

### 6.3 第三层 · 真实浏览器层（确认"真的能玩"）

```bash
# 用同一套 41 项断言直连线上地址（跳过本地服务器）
TL_URL="https://4ac70bca00374608a9180bed67f19118.app.workbuddy.link" \
TL_SHOTS=tests/_shots-public \
  node tests/browser-verify.js
# 期望：通过 41 / 失败 0（exit 0）
```

**失败意味着什么**：线上环境出现本地没有的问题 —— CDN 改写了响应、MIME 类型错误、
跨域/安全头阻止了 WebGL 或 WebAudio、或托管注入内容。
即使第一层字节一致，本层仍可能因**响应头**而失败，故三层缺一不可。

> 本文件所述三层于 2026-09-10 全部实跑通过：HTTP 200 / 179,928 B / 逐字节一致；
> 内容层 0 外部引用、`FLASH_GAP: 0.51`、标题存在；浏览器层 41/0。

---

## 7. 内容更新后如何重新发布

### 7.1 标准流程

```bash
# 1) 改 src/ 后，先跑完整回归（§3），全绿才能继续
node tests/smoke-mvp.js && node tests/test-safety-fx.js && \
node tests/test-exploit-guard.js && node tests/test-soak-stress.js && \
node tests/browser-verify.js && node tests/art-deep-verify.js

# 2) 重新打包（同时产出 index.html 与版本化快照）
node tools/build-single.js

# 3) 本地验证单文件产物（同一套 41 项断言）
TL_ROOT=dist TL_ENTRY=tideline-v0.1.0.html TL_SHOTS=tests/_shots-single \
  node tests/browser-verify.js

# 4) 【需用户明确授权】重新发布 dist/ 目录
#    —— 发布动作由用户决定，文档不代为执行

# 5) 发布后再跑三层验证（§6），确认线上已换成新内容
```

### 7.2 ⚠️ 两条必须知道的规则

| 规则 | 说明 |
|---|---|
| **重新发布会覆盖线上链接** | 向**同一地址**重新发布，链接**不变**，但**内容被静默替换**。正在玩的测试者刷新后即拿到新版本，旧版不可回退到该地址（如需保留，先下载存档 `tideline-v<旧版本>.html`）。 |
| **发布许可不跨轮次继承** | 一次发布授权只对**当时那一份内容**有效。内容变更后，**必须由用户再次明确要求**才能重新发布 —— 不得沿用上一轮的授权自动发布。 |

### 7.3 版本化与回滚

- 每次打包都会生成 `dist/tideline-v<版本>.html`；**版本号唯一真源**仍是
  `src/src/core/constants.js` 的 `VERSION`（当前 `0.1.0`）。
- 单文件产物是**不可变快照**：保留旧版 HTML 即可瞬时回滚，无需数据库迁移或服务端配合。
- 若需在同一托管上并存多版本，建议把产物放进版本化路径（如 `/v0.1.0/`），
  `index.html` 放在根路径指向当前版 —— 这样替换版本时不会覆盖历史快照。
