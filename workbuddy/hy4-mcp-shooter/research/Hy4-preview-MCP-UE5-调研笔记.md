# Hy4 preview · MCP 协议与 UE5 接入调研笔记

> 调研日期：2026-08-28
> 触发：腾讯官方 demo 截图 ——「通过 MCP 接入 Unreal 5 引擎，纯对话从零制作一个射击游戏 Demo」

---

## 一、Hy4 preview 是什么

| 项目 | 数值 |
|---|---|
| 发布方 | 腾讯混元 |
| 发布时间 | 2026-08-28（开源） |
| 总参数 / 激活参数 | 770B / 49B（MoE） |
| 上下文长度 | 1M |
| 对比上代 Hy3 | 295B / 21B / 256k → 全面翻倍以上 |
| 开源地址 | HuggingFace / GitHub / ModelScope（apache-2.0） |
| API 价格 | 输入 ¥6/百万 token，输出 ¥18/百万，缓存命中 ¥0.3/百万 |
| 内部盲测 | 163 名专家 · 203 个工程任务，均分 2.99/4.00，略优于 GLM-5.3(2.92)、Kimi K3(2.94) |

**四个重点升级方向**：软件工程、办公分析、**游戏开发**、科学研究。

游戏开发方向的官方表述：
> 增强了从一句话需求直接生成可玩原型的能力，并能熟练使用游戏引擎，
> 开发者可以通过多轮交互持续完善复杂游戏项目。
> 通过 MCP 接入 Unreal 5 引擎，实现纯对话从零制作一个射击游戏 Demo，
> 包括环境美术搭建、玩法搭建、关卡搭建。

**注意**：英文稿提到支持 Unreal 5 **和 Unity** 两个引擎，中文稿只提了 Unreal 5。

### 已知问题（腾讯自述 + 媒体实测）
- 复杂任务容易陷入**长思考 / 过度自我验证**循环，需要人工打断推进
- 思考效率不算高
- 定位是 preview，预训练与后训练仍有提升空间

---

## 二、MCP 协议基础

**Model Context Protocol（MCP）**：Anthropic 2024-11 提出，2025-12 捐赠给 Linux Foundation 的
Agentic AI Foundation，现为**厂商中立的行业标准**。

核心模型：

```
MCP Client（Claude Code / Cursor / WorkBuddy / 自研 Agent）
        │  JSON-RPC 2.0
        ▼
MCP Server（暴露一组"工具"）
        │
        ▼
    真实系统（UE 编辑器 / 数据库 / 浏览器游戏 / ...）
```

三个关键概念：
- **Tools**：可被 AI 调用的函数，带 typed 输入/输出 schema（`tools/list` `tools/call`）
- **Resources**：可读的数据源
- **Prompts**：预置提示模板

传输层：
- `stdio`（本地子进程，最常用）
- `Streamable HTTP` / HTTP+SSE（远程或进程内服务，UE5.8 官方插件用的就是这个）

**MCP 的真正价值不是"生成"，而是"暴露"** —— 把原本封闭的系统的能力，
用带类型约束的结构化接口开放给 Agent。这是它与"让 AI 写代码"最本质的区别。

---

## 三、UE5 接入的三条路径

### 路径 A：Epic 官方插件（UE 5.8+，2026-06-17 发布）⭐ 最重要

UE 5.8 是**第一个由引擎厂商自己原生内置 MCP Server 的 AAA 引擎**。

| 项目 | 细节 |
|---|---|
| 插件名 | `UnrealMCP`（配套 `AllToolsets`） |
| 形态 | 编辑器进程内的本地 HTTP Server |
| 默认端点 | `http://127.0.0.1:8000/mcp` |
| 传输 | Streamable HTTP |
| 状态 | **Experimental**（Epic 明确说 API 会变，不建议用于生产） |
| 安全 | 仅 loopback，**无认证层**，串行跑在 game thread 上 |

**启用步骤**：
1. `Edit → Plugins` 启用 `UnrealMCP`（会自动启用 `Toolset Registry`）
2. `Edit → Editor Preferences → General → Model Context Protocol` 打开 `Auto Start Server`
   （或控制台执行 `ModelContextProtocol.StartServer`）
3. 控制台执行 `ModelContextProtocol.GenerateClientConfig ClaudeCode`
   生成 `.mcp.json`（也支持 Cursor / VSCode / Gemini / Codex / All）
4. AI 客户端指向该配置即可

**官方工具覆盖**：
- 生成/放置 Actor
- 配置光源（类型、参数、强度）
- 创建与修改 Material Instance
- 检视 Slate UI 组件
- 运行自动化测试
- 通过反射读取关卡层级与拓扑
- 通过 Asset Registry 摸清材质/网格/蓝图的依赖关系
- 对本地 Fab 资源库做语义检索并自动布置

**扩展机制（这是最有价值的部分）**：
开发者可以自定义 Toolset，注册后自动变成 MCP 工具：

```python
# Content/Python/my_project_toolset.py
import unreal
import toolset_registry

@unreal.uclass()
class MyProjectToolset(unreal.ToolsetDefinition):
    @toolset_registry.tool_call
    @staticmethod
    def run_project_action(message: str) -> str:
        return message
```

```python
# Content/Python/init_unreal.py
from my_project_toolset import MyProjectToolset
from toolset_registry.registration import Registration
_registration = Registration([MyProjectToolset])
_registration.register()
```

C++ 侧对应：继承 `UToolsetDefinition`，用 `AICallable` 标记的 static `UFUNCTION`。

启动时序：
```
挂载 Content 根目录 → PythonScriptPlugin 把 Content/Python 加入 sys.path
→ 发现并执行 init_unreal.py → 反射创建 Toolset 类与 AICallable UFunction
→ 显式注册 → Toolset Registry 生成运行时 handler
→ Unreal MCP 把 schema 暴露给已连接的 MCP 客户端
```

**注意**：启动脚本只在编辑器初始化时跑一次，改 toolset 定义通常需要**重启编辑器**；
改动频繁时可用 `ModelContextProtocol.RefreshTools` 热重载。

**已知限制**：
- 仅 UE 5.8+，5.3–5.7 无官方方案（而 2026 年多数在研项目还在这些版本）
- 无认证层，只能同机使用
- 新增工具需要重启编辑器（Live Coding 无法拾取）
- 纯终端工作流，无编辑器内 UI

### 路径 B：社区开源 MCP Server

| 项目 | 特点 |
|---|---|
| `chongdashu/unreal-mcp` | ~2k stars，C++ 编辑器插件 + TCP + 外部 Python MCP Server |
| `oprincipe/unreal-mcp-agent` | 强化 Blueprint 内省、PIE 控制、读引擎日志，UE5.5+ / Py3.12+ |
| `avdo403/UnrealMCP` | 最全：蓝图图编辑、程序化世界生成（城堡/城市/桥梁/地牢/WFC）、AI 导航、Mass AI |
| `flopperam/unreal-engine-mcp` | 偏高层世界构建 |
| `nodormu/unreal-mcp-additional-tools` | 78 工具 / 14 子系统，专门补官方没覆盖的：构建打包、Niagara、Sequencer、自动化测试、源码管理、Profiling、World Partition |

共同代价：都要自己拼装（编译 C++ 插件 + 装 Python/uv + 手改客户端配置），
README 几乎都写着 experimental / 不建议生产使用。

### 路径 C：商业插件（如 Claude Assistant）

把同样的架构做成成品：支持 UE 5.3–5.8 全版本、内置 localhost + token + host allowlist、
80 工具自测通过。适合生产中项目，不适合我们这种探索。

---

## 四、关键洞察

### 1. 「MCP 驱动」与「AI 生成资产」是两件事，社区反应截然相反

Epic 在宣布 UE 5.8 MCP 的同一天预告了 UE6 的生成式 AI 资产创建，
《吸血鬼幸存者》开发者 Poncle 公开表示要把 Fortnite 联动**重新评估**。

- MCP Server = **增强开发者控制力** 的工具（自动化繁琐操作）→ 开发者欢迎
- UE6 AI 生成资产 = **把创作决策交给模型** → 社区强烈反弹

这两件事被不少媒体报道混为一谈，但本质完全不同。

### 2. Epic 刻意不做生态锁定

State of Unreal 2026 明确表态："用 Claude、Gemini 或任何适合你的模型来构建"。
AI 层被定位为**开放的、可替换的基础设施**，而不是绑定某家模型厂商。
这对长周期的商业游戏项目极其重要。

### 3. 工具设计的质量决定 Agent 上限

多家评测反复提到同一个结论：
> Agent 质量取决于**可调用工具的设计**、权限授予、上下文与验证机制，
> 而不只是模型本身有多强。

类型信息与文档字符串会直接变成对外暴露的 schema ——
**接口设计本身就是 Agent 安全的一部分**。

### 4. 验证闭环才是分水岭

Hy4 preview 在游戏 demo 里最有说服力的不是"生成了代码"，而是：
- 能操作游戏角色执行动作 → **截图确认是否成功**
- 能启动 PIE 跑游戏 → **读引擎日志找错误**

UE MCP 侧对应的是 `start_play_in_editor` + `get_editor_logs`。

**「执行 → 观察 → 修正」的闭环，才是 Agent 能自主完成复杂任务的根因。**
单纯"生成代码然后交付"没有这个闭环，质量天花板很低。

---

## 五、对我们的直接启示

1. **不要等 UE5.8。** 我们手上的 Three.js / Phaser / Godot 项目都能自己搭这套桥，
   而且浏览器环境天生可远程驱动，成本比 UE 低一个数量级。
2. **核心抽象是「场景清单」而不是「生成代码」。** UE 对应 `.umap` 资产，
   我们用一个 JSON manifest —— 可序列化、可 diff、可 undo、可进版本控制、可人工审查。
3. **工具要分层。** 底层原子工具（摆一个箱子）+ 高层语义工具（生成一整关）都要有。
   让 Agent 说"在中心围一圈掩体"，而不是推导 10 组坐标。
4. **必须给 AI 装眼睛和手。** 截图回传 + 自动试玩指标，这套验证闭环比模型能力更关键。
5. **权限要有边界。** 所有 Agent 输入过 sanitize 层，非法值被丢弃而不是让游戏崩掉。

---

## 六、参考来源

- 腾讯官方发布（新qq / 同花顺 / 智东西）：Hy4 preview 发布与能力说明
- AIBase 英文稿：含 Unity 引擎支持、盲测数据
- byteiota：UE 5.8 MCP Server 技术解析（工具清单、Toolset 扩展、局限）
- Epic Developer Community Forums：Python 函数注册为 AI 可调用工具的完整时序
- gameenginehub：Toolset Registry 与 JSON-RPC 封装细节、State of Unreal 2026 立场
- LobeHub MCP 目录：社区各 MCP Server 的工具清单对比
- SEELE AI：UE MCP 与 UAT / BuildGraph / Commandlet / Python 的决策边界对比
