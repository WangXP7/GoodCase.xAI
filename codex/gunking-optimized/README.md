# 枪王 GunKing · 独立优化版

这是 GunKing 中文还原版的独立工作副本。当前为初始副本，玩法、画质与原案例一致，尚未实施优化。

- 新案例发布路径：`codex/gunking-optimized/index.html`
- 原案例路径：`codex/gunking/index.html`，保持不变。
- 初始来源提交：`3b68355b839bd634f0a22676d6127a78f0bc7fde`
- 原项目来源、署名、许可说明和历史验证见 [原案例说明](原案例说明.md)。历史验证不代表优化版新验证。

## 本地启动

双击 `启动.cmd`，或执行 `node tools/serve.mjs --open`。

## 后续修改与发布

只编辑本副本的 `src/game.js`、`src/ui.css`、`src/page.html`。

```powershell
node tools/build.mjs --editable
Copy-Item -LiteralPath editable.html -Destination index.html
node --check src/game.js
node tools/serve.mjs --open
```

注意：原构建脚本不带参数时会把中文还原基线复制回入口；优化后不要用默认构建覆盖入口。`tools/verify-source.mjs` 仅验证未优化的还原基线，优化后应使用本轮功能验证。

每轮修改完成后，验证当前入口与关键交互，再更新同一新案例。不得写入原案例目录。保留上游来源与第三方许可。

当前缩略图沿用原案例截图，仅代表初始副本画面。
