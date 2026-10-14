# NEXUS BREACH — MCP 驱动的 Three.js 射击游戏

> 复现腾讯 Hy4 preview「通过 MCP 接入 UE5，纯对话从零做一个射击游戏 Demo」的同类思路，
> 但把引擎换成 Three.js。 AI 不写一行游戏代码，只调工具。

---

## 一、它到底做到了什么

一句话：**AI 通过 MCP 协议调用工具，实时改变一个正在运行的 3D 射击游戏。**

不是"生成代码然后你去看"，是：

```
AI: "生成一个夜间工业港区关卡，掩体密度 1.3，难度 1.4"
   ↓ 一次 build_arena 调用
浏览器里的游戏：59 个道具、11 个敌人、夜景光照 —— 立刻变

AI: "雾太浓了，看不清远处高台"
   ↓ set_environment
浏览器：雾浓度实时下降，太阳压到 7°，泛光拉到 1.25

AI: "跑一次试玩看看难度合不合理"
   ↓ run_playtest 10s
返回：{ avgFps: 58, kills: 7, accuracy: 41%, damageTaken: 63, hpRemaining: 37, verdict: "残血存活 → 难度偏高" }
```

游戏本身：`WASD` 移动 / `Shift` 冲刺 / `空格` 跳跃 / 左键射击 / `R` 换弹，
四种敌人（步兵、突击兵、狙击手、重甲兵），波次推进，爆头倍伤，后坐力与曳光弹。
全程序化几何，零外部资产。

---

## 二、30 秒跑起来

```bash
cd hy4-mcp-shooter

# 1) 起服务（静态托管 + MCP Server）
node tools/serve.js --with-mcp

# 2) 浏览器打开 http://127.0.0.1:8080  →  点击"开始"

# 3) 另一个终端：让 AI 建关
node tools/demo-agent.js
```

你会看到浏览器右上角的「AI 控制台」实时滚动出每一条工具调用，
场景跟着一条条变化。

### 一键看完整演示（含过程截图）

```bash
node tools/run-demo.js
```

这个脚本会自己起服务、开浏览器、走完 15 步建关流程，**每一步都截图存证**，
最后把成品关卡dump成 JSON：

```
意图 │ 一句话生成完整关卡：夜间 + 工业港区风格 + 掩体密度 1.3 + 难度 1.4。
调用 │ build_arena {"preset":"night","style":"industrial","density":1.3,...}
结果 │ ✓ preset: night, style: industrial, props: 59, enemies: 11,
     │   enemyMix: { grunt: 5, rusher: 3, sniper: 3 }   (9ms)
     ↳ 截图 demo/02-arena-generated.png
...
调用 │ run_playtest {"seconds":10}
结果 │ ✓ avgFps: 3, kills: 3, shots: 17, hits: 5, accuracy: 29,
     │   damageTaken: 0, hpRemaining: 100, verdict: 数值健康   (10586ms)
```

产出：`demo/` 下 7 张过程截图 + `final-level.json`。
（截图中 FPS 偏低是因为无头浏览器走 SwiftShader 软件渲染，真实显卡上 60+。）

### 自检

```bash
node tools/smoke-test.js      # 端到端冒烟：启动→渲染→射击→MCP改场景→截图→试玩→撤销
node tools/gallery.js         # 10 个机位出图，验证六套美术预设的观感
node tools/diag.js            # 诊断：机位/预设是否真的落到渲染管线里
```

---

## 三、架构总览

```
┌──────────────────────────────────────────────────────────┐
│  Agent（Hy4 preview / Claude / 任意 MCP 客户端）            │
│  "做一个夜间工业港区的射击关卡"                              │
└───────────────────────┬──────────────────────────────────┘
                        │  MCP · JSON-RPC 2.0 · stdio
                        ▼
┌──────────────────────────────────────────────────────────┐
│  server/mcp-server.js                                     │
│  ├─ 19 个 MCP 工具（list_capabilities / build_arena / ...） │
│  └─ WebSocket Server  :8787                                │
└───────────────────────┬──────────────────────────────────┘
                        │  （进程内）
                        ▼
┌──────────────────────────────────────────────────────────┐
│  server/level-store.js   ← 权威状态（对应 UE 的 .umap）     │
│  ├─ Scene Manifest（纯 JSON）                              │
│  ├─ 撤销/重做历史（60 步）                                  │
│  └─ 变更分类：env / actors / gameplay / full                │
└───────────────────────┬──────────────────────────────────┘
                        │  WS 下行：level:full / :env / :actors / :gameplay
                        │  WS 上行：telemetry / capture:result / playtest:result
                        ▼
┌──────────────────────────────────────────────────────────┐
│  game/src/main.js（Three.js r160）                        │
│  ├─ scene-builder.js  清单 → 3D 场景图 + 碰撞盒 + 斜坡      │
│  ├─ player.js         第一人称控制器                        │
│  ├─ enemy.js          敌人 AI + 投射物                      │
│  └─ bridge.js         WebSocket 客户端（自动重连）           │
└──────────────────────────────────────────────────────────┘
```

**对照 UE5.8 官方方案**：

| UE5.8 官方 | 本实现 |
|---|---|
| 编辑器进程内 HTTP Server `:8000/mcp` | 独立进程 stdio + WS `:8787` |
| `UToolsetDefinition` / `unreal.ToolsetDefinition` | MCP `tools`（zod schema） |
| `.umap` 关卡资产 | `Scene Manifest` JSON |
| `start_play_in_editor` / `stop_play_in_editor` | `start_simulation` / `stop_simulation` |
| `get_editor_logs`（读引擎日志找错误） | `run_playtest`（返回 FPS/命中率/血量 + 难度判定） |
| Viewport 截图 | `capture_viewport`（返回 JPEG base64） |
| Viewport Camera 控制 | `set_viewpoint`（自由机位：位置 / 朝向 / FOV，可悬浮取景） |
| Toolset Registry 自动包装 | 手写工具表（19 个，够用且可控） |

---

## 四、核心设计决策

### 决策 1：AI 编辑「场景清单」，而不是写代码

这是整个方案的地基。Scene Manifest 是一份纯 JSON：

```jsonc
{
  "environment": { "preset":"night", "fogDensity":0.014, "sunElevation":7, "bloom":1.25, ... },
  "props":  [ { "id":"p1", "type":"container", "position":[-14,1.3,-18], "rotation":[0,0.3,0], "color":"#6b4a2f" }, ... ],
  "spawns": [ { "id":"e1", "type":"sniper", "position":[-18,0,-18] }, ... ],
  "gameplay": {
    "player":  { "damage":30, "fireRate":0.085, "magazine":36, ... },
    "enemies": { "globalHealthScale":1.24, "aggression":0.85, ... },
    "waves":   { "count":5, "perWaveBase":6, ... }
  },
  "playerStart": [0, 1.7, 34],
  "playerYaw": 0                     // 0 = 面朝 -Z，出生点就在 +Z，所以一睁眼正对场地中心
}
```

为什么不让 AI 直接写 JS？

| | 生成代码 | 编辑清单 |
|---|---|---|
| 可序列化 | ❌ 只能 diff 文本 | ✅ 存盘 / diff / 版本控制 |
| 撤销重做 | ❌ 几乎不可能 | ✅ 天然支持 |
| 非法状态 | ❌ 崩给你看 | ✅ sanitize 层兜底 |
| 人工审查 | ❌ 要读几百行 | ✅ 一眼看懂改了什么 |
| 幂等性 | ❌ 每次生成都不一样 | ✅ 同 seed 同结果 |
| 职责边界 | ❌ AI 能改任何东西 | ✅ 只能动暴露的字段 |

`sanitizeLevel()` 是这层的安全网 —— Agent 传来的任何值都被 clamp 到合法区间，
非法类型被丢弃。 UE 那边对应的是 UFUNCTION 的类型系统。

### 决策 2：工具分两层——原子 + 语义

**原子层**（精确但啰嗦）：

```jsonc
{ "props": [ { "type":"container", "position":[-14,1.3,-18] }, ... ] }
```

**语义层**（一句话出效果）：

```jsonc
// 在中心围一圈集装箱，全部朝向中心，颜色轮流，带 1.5m 随机抖动
{ "type":"container", "pattern":"ring", "count":10, "radius":22,
  "faceCenter":true, "colors":["#6b4a2f","#2f5a6b"], "jitter":1.5 }
```

`pattern` 支持 `ring / grid / scatter / line / arc / cluster`。
这一层是效率的关键 —— 让模型说人话，而不是推导 10 组坐标。

最高层是 `build_arena`：**一次调用生成完整关卡**
（环境美术 + 掩体布局 + 敌人配比 + 玩法数值），
这正是 demo 里「从零做一个射击游戏」对应的那个工具。

### 决策 3：给 AI 装眼睛和手（验证闭环）

这是整个方案里**最不能被省略**的部分。

- `capture_viewport` → 返回 JPEG，AI 能真的看到画面
- `run_playtest` → 内置机器人接管 8 秒，返回 FPS / 击杀 / 命中率 /
  造成伤害 / 承受伤害 / 剩余血量 / 是否阵亡，并给出难度判定

没有这两个工具，AI 只是在盲改。
有了它们，才形成 **执行 → 观察 → 修正** 的闭环 ——
这才是 Hy4 preview 那个 demo 能真正跑通的根因。

UE 侧的对应物就是 `start_play_in_editor` + `get_editor_logs`。

### 决策 4：按变更类型增量推送

store 会给每次变更打类别，浏览器走不同的应用路径：

| 类别 | 触发 | 浏览器动作 |
|---|---|---|
| `env` | `set_environment` | 只换光照/雾/色调，重建场景图 |
| `actors` | `place_props` / `spawn_enemies` | 重建道具与敌人，**保留玩家血量** |
| `gameplay` | `set_gameplay` | 只更新数值，不碰场景 |
| `full` | `build_arena` / `undo` / `load` | 整体重建 |

好处：调数值时玩家不会被打断，改美术时不会有卡顿。

---

## 五、19 个工具

分五类。前四类是"改东西"，最后一类是"看结果"——后者才是 Agent 能自主迭代的前提。

**① 读状态**

| 工具 | 作用 | 对应 UE 概念 |
|---|---|---|
| `list_capabilities` | 列出所有可用枚举值（预设/道具/敌人/布局） | 能力自省 |
| `get_level` | 读当前关卡清单 | 读取 Level |
| `get_telemetry` | 实时运行状态（FPS/波次/血量/位置/版本号） | Editor 状态查询 |

**② 搭场景**

| 工具 | 作用 | 对应 UE 概念 |
|---|---|---|
| `build_arena` | **一句话生成完整关卡**（美术+布局+敌人+数值） | PCG + 关卡模板 |
| `place_props` | 摆放道具（精确坐标 或 布局模式） | Spawn Actor |
| `remove_props` | 删除道具（按 id 或按类型批量） | Delete Actor |
| `spawn_enemies` | 布置敌人 | Spawn Pawn |
| `clear_actors` | 清空道具/敌人 | 清空关卡 |
| `set_environment` | 环境美术（6 套预设 + 逐项微调） | 光源 / 天空 / 雾 / 后处理 |

**③ 调玩法**

| 工具 | 作用 | 对应 UE 概念 |
|---|---|---|
| `set_gameplay` | 玩家/敌人/波次数值调参 | Data Asset / Gameplay Settings |

**④ 版本管理**

| 工具 | 作用 | 对应 UE 概念 |
|---|---|---|
| `undo` / `redo` | 撤销重做（60 步历史） | Undo/Redo |
| `save_level` / `load_level` | 存盘 / 读档 | Save Asset |

**⑤ 验证闭环（这部分最不能省）**

| 工具 | 作用 | 对应 UE 概念 |
|---|---|---|
| `start_simulation` | 启动模拟，物理/AI/波次开始推进 | `start_play_in_editor` |
| `stop_simulation` | 暂停模拟，便于稳定截取美术图 | `stop_play_in_editor` |
| `capture_viewport` | 截图回传 JPEG（AI 的"眼睛"） | Viewport Capture |
| `set_viewpoint` | 自由机位：位置/朝向/FOV，可悬浮取景 | Viewport Camera 控制 |
| `run_playtest` | 机器人接管 N 秒，回报 FPS/击杀/命中率/受伤/残血 | PIE + Engine Logs |

> **为什么 `set_viewpoint` 是必需的？**
> 没有它，AI 只能看到玩家当前站的地方。有了它，AI 才能飞到高空审视关卡布局、
> 站在高台检查垂直空间是否真的可用、贴近地面确认掩体尺度 ——
> 这是"审图"能力，和"改图"能力一样重要。

### 可调的美术预设

`dusk` 黄昏 · `noon` 正午 · `night` 夜景 · `toxic` 毒沼 · `snow` 雪原 · `inferno` 炼狱

### 关卡风格（build_arena）

`industrial` 工业港区 · `military` 军事基地 · `ruins` 废墟遗迹 · `outpost` 前哨站 · `forest` 林地

### 道具类型（全程序化几何）

`crate` 货箱 · `container` 集装箱 · `wall` 墙段 · `pillar` 立柱 · `ramp` 斜坡（可踩踏） ·
`platform` 高台 · `barrel` 油桶 · `tower` 塔楼 · `antenna` 天线 · `rock` 岩石 · `tree` 枯树 · `lamp` 灯柱

### 敌人类型

| 类型 | HP | 速度 | 伤害 | 射程 | 特点 |
|---|---|---|---|---|---|
| `grunt` 步兵 | 60 | 3.2 | 8 | 22 | 基础远程 |
| `rusher` 突击兵 | 40 | 6.4 | 20 | 2.2 | 近战冲脸 |
| `sniper` 狙击手 | 45 | 1.9 | 26 | 70 | 高伤慢速 |
| `tank` 重甲兵 | 190 | 2.2 | 15 | 12 | 高血量 |

---

## 六、文件职责

```
nexus-breach/
├── index.html                案例入口页：架构图 + 过程对比 + 验证记录
├── demo/                     run-demo.js 产出的过程截图 + final-level.json
├── shots/                    gallery.js 产出的十机位图
├── game/
│   ├── index.html            游戏本体：外壳 + HUD + CSS（暗色琥珀金主题）
│   └── src/
│       ├── level.js          ★ Scene Manifest 定义、预设表、校验清洗、布局模式展开
│       ├── scene-builder.js  ★ 清单 → Three.js 场景（程序化几何 / 天空 shader / 碰撞盒 / 斜坡）
│       ├── player.js         第一人称控制器（AABB 碰撞 + 斜坡吸附 + 射击状态机）
│       ├── enemy.js          敌人 AI（FSM：patrol/chase/attack + 视线遮挡检测）+ 投射物
│       ├── bridge.js         WebSocket 客户端（自动重连；非本机环境自动降级为单机模式）
│       ├── hud.js            HUD 与反馈（伤害暗角、命中标记、AI 控制台日志）
│       └── main.js           主循环、波次、射击判定、MCP 下行指令处理
├── server/
│   ├── level-store.js        ★ 权威状态、历史、程序化关卡生成器、变更分类
│   └── mcp-server.js         ★ MCP 工具定义（19 个）+ WS 桥
├── tools/
│   ├── serve.js              静态托管（--with-mcp 顺带拉起 MCP Server）
│   ├── run-demo.js           ★ 完整演示：15 步建关 + 每步截图存证 + 导出最终关卡
│   ├── demo-agent.js         纯终端版演示 Agent（不起浏览器，更快但无截图）
│   ├── gallery.js            取景脚本：10 个机位出图，验证六套预设观感
│   ├── diag.js               诊断脚本：确认机位/预设真的落进了渲染管线
│   └── smoke-test.js         端到端冒烟测试（7 项断言）
├── research/                 Hy4 preview · MCP · UE5 调研笔记
└── levels/                   存盘的关卡 JSON
```

（★ = 核心文件，读懂这五个就懂了整套架构）

> **在 github.io 上打开时是「单机模式」**：桥接对象只连本机运行的 MCP Server，
> 部署到静态托管后浏览器会以 mixed-content 拦掉 `ws://127.0.0.1`，
> 所以 `bridge.js` 会先判断环境，非本机直接降级（不重连、不报错），游戏加载内置关卡照常可玩。
> 想在本机体验「AI 实时改关卡」，按第二节起服务即可。

---

## 七、验证记录

这套东西不是"写完就交付"，而是有三层验证：

### 1. 静态检查

```bash
node --check server/*.js tools/*.js
node --input-type=module --check < game/src/*.js
```

### 2. 端到端冒烟（7 项断言，全部通过）

```
✓ 页面加载无 JS 报错
✓ 游戏已引导（window.__GAME__ 可用）        道具 41 敌人 5 rev1
✓ 渲染循环在推进（FPS > 0）
✓ 射击系统工作                              已发射 1 发
✓ MCP build_arena 改变了浏览器场景          rev 1→2 · 预设 dusk→inferno · 道具 29→64 · 敌人 13
✓ capture_viewport 返回真实画面             JPEG 19KB
✓ run_playtest 返回指标                     accuracy 25% · kills 1 · damageTaken 39
✓ undo 生效                                rev → 1
```

### 3. 视觉验收（肉眼比对十机位出图）

调试过程中靠截图抓出并修掉的真问题：

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | 一路截图全是超时 | 浏览器端 `_emit` 没把请求 id 透给处理器，回包发不出去，Server 干等 15s | 透传 id + capture 加 try/catch 回报错误而不是静默超时 |
| 2 | 所有机位图长得一模一样 | 游戏没进运行态（`running=false`），`player.update()` 整段被跳过，相机卡在原点 | 加 `?autostart=1` + `start_simulation` 工具 |
| 3 | 高空俯瞰能看穿地面边缘，关卡像悬浮板子 | 地面平面只有 `arenaSize+120`，从 60 米高往下看直接越过边界 | 地面放大到 `arenaSize×8`，配合指数雾自然淡出 |
| 4 | 黄昏地面死黑、网格线看不见 | 太阳强度 2.4 / 环境光 0.95 太低，且相机正对太阳（逆光） | 提亮地表 albedo + 环境光，环境光系数 0.55→0.75 |
| 5 | 灯泡糊成一大团白光斑 | 自发光 4.5 + bloom threshold 0.85，HDR 值远超声阈值 | 自发光降到 1.6、阈值提到 1.0、radius 收到 0.4；改用 PointLight 照亮地面 |
| 6 | 夜景几乎全黑，只有灯亮着 | 环境光 0.62 + 地表 albedo 过暗，掩体轮廓不可辨 | 环境光提到 1.35、地表提亮、把平行光当"月光"用 |
| 7 | 出生点正前方 4 米杵着灯柱 | 灯柱摆在 `[0,·,30]`，出生点在 `z=34` | 灯柱挪到 `[-13,·,31]` |
| 8 | 玩家一睁眼背对竞技场 | `Player` 构造函数硬编码 `yaw = Math.PI`，而出生点在 +Z 侧 | 清单里加 `playerYaw` 字段，`respawn()` 应用它 |

> 这份表本身就是"验证闭环"的价值证明：
> 没有截图回传，第 1、2、5 条这类问题在"代码看起来没问题"的情况下根本发现不了。

---

## 八、移植到你的其他项目

### Three.js（已实现，本仓库）

最省事。浏览器天生可远程驱动，WebSocket 直接通。
**「幽冥雀坛」** 如果要接入，清单结构要换成：
`{ cards: [...], enemies: [...], relics: [...], layout: {...} }`，
工具换成 `add_card / modify_card_cost / set_enemy_intent / spawn_relic`。

### Phaser 3（TBOI 重制）

Phaser 是 2D，但思路完全一致：

| 本实现 | Phaser 对应 |
|---|---|
| Scene Manifest JSON | 同样一份 JSON，字段换成 `tilemap / entities / spawnTable` |
| `scene-builder.js` | 监听 `level:*` 消息 → `scene.restart()` 重建 |
| WebSocket 桥 | 一模一样，复制即可 |
| `capture_viewport` | `game.renderer.snapshot(...)` 或 `canvas.toDataURL()` |
| `run_playtest` | 让 AI 控制一个假 player 跑 N 秒，回报伤害/存活 |

Phaser 的优势：`scene.restart()` 重建成本几乎为零，热更新比 3D 还干净。

### Godot 4（Nodebuster）

Godot 没有内置 MCP，但有三种接法，按推荐度排序：

1. **`WebSocketServer`（推荐）** —— GDScript 里起一个 WS 服务，
   `Node` 监听消息 → 操作 `SceneTree`。概念上和本实现完全同构，
   只是把浏览器换成 Godot 进程。
2. **`--remote-debug` + 自定义插件** —— 用 `EditorPlugin` 做编辑器内 MCP，
   复杂但能做真正的资产编辑（对应 UE 官方路线）。
3. **HTTP + `OS.execute`** —— 最糙，适合只读场景。

Godot 的额外好处：`Resource` 系统天然可序列化，
`.tres` 文件就是现成的「场景清单」，直接复用本方案的 manifest 思想。

### 通用移植清单

不管什么引擎，做四件事就够：

1. **定义清单** —— 把可变的关卡状态抽成纯数据（JSON / Resource / ScriptableObject）
2. **起本地服务** —— WS 或 HTTP，暴露给 MCP Server
3. **包工具** —— 底层原子 + 高层语义，两层都要
4. **加验证** —— 截图 + 自动跑测，让 AI 能自己看到结果

---

## 九、接入真实 AI 客户端

### WorkBuddy / CodeBuddy

写入 `~/.workbuddy/mcp.json`（注意：不是 `.mcp.json`）：

```json
{
  "mcpServers": {
    "nexus-breach": {
      "command": "node",
      "args": ["D:/68.AIGC/GoodCase/hy4-mcp-shooter/server/mcp-server.js"]
    }
  }
}
```

然后在连接器管理页右上角的「自定义连接器」入口，对新 server 点「信任」启用。

### Claude Code

```bash
claude mcp add nexus-breach -- node D:/68.AIGC/GoodCase/hy4-mcp-shooter/server/mcp-server.js
```

### 接上之后可以说的话

> 帮我做一个炼狱风格的废墟关卡，掩体稀疏一点，难度拉到 2.5，
> 然后截图看看效果，再跑一次试玩确认难度。

Agent 会自己走完 `build_arena → capture_viewport → set_environment → run_playtest` 的闭环。

---

## 十、已知限制

| 限制 | 说明 |
|---|---|
| 需要浏览器先打开 | `capture_viewport` / `run_playtest` 依赖浏览器连接，否则返回提示性错误 |
| 无认证层 | 与 UE5.8 官方插件一致，仅 loopback，同机使用 |
| 场景整体重建 | 道具变更会 dispose 重建；几十个道具规模下 <5ms，几百个需改增量更新 |
| 斜坡只处理绕 Y 轴 | 任意角度旋转的斜坡足迹用 AABB 近似 |
| 敌人不走斜坡 | 敌人碰撞忽略 slope，只走平地 |
| 依赖 CDN | three.js r160 从 unpkg 拉取，离线需改成本地路径 |

---

## 十一、下一步可以做的

1. **增量场景更新** —— 按 propId 做增删，避免整体重建
2. **资源（Resources）** —— 把 `levels/*.json` 暴露成 MCP Resource，AI 能直接读历史关卡
3. **多关卡管理** —— `list_levels` / `switch_level`，做关卡序列
4. **AI 生成贴图** —— 把 ImageGen 接进来，`set_material` 支持程序化贴图
5. **Godot / Phaser 版本** —— 按第七节的对照表移植，验证架构通用性
