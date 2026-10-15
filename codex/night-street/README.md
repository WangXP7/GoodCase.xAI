# Night Street · 黄金时刻街景

纯代码生成的第一人称城市街景，基于 [StarKnightt/night-street](https://github.com/StarKnightt/night-street) 的 MIT 开源实现复刻，由 Codex 完成本地运行与 GitHub Pages 静态发布适配。上游锁定提交为 `333f064778105640588a95d2c2d150780044e7bf`。此案例属于开源参考复刻，保留原作者署名与许可。

Agent：Codex。原始生成模型未记录，无法核实具体名称。

- [在线体验](https://wangxp7.github.io/GoodCase.xAI/codex/night-street/)
- [源代码与原始提示词](source/)
- [MIT 许可](LICENSE)
- [浏览器验证结果](verification/pages-smoke.json)

使用桌面电脑和键盘鼠标。点击画面进入鼠标环顾，WASD 行走，Shift 奔跑，Esc 释放鼠标。首次打开需要在 GPU 上生成材质和编译着色器，性能取决于显卡；通常需要等待约 30–40 秒。手机显示设备能力提示，可选择继续加载。

道路、建筑、汽车、天空、材质与声音均通过代码生成。在线版本使用本站静态脚本，无运行时 CDN、外部贴图、模型、字体或音频依赖。

## 本地开发和再次导出

在 `source` 目录安装锁定依赖后运行：

```sh
npm ci
npm run dev
```

GitHub Pages 构建：

```sh
node build-pages.mjs
```

生成的 `out/` 部署到本站 `codex/night-street/`。`next.config.ts` 仅在此导出模式中启用 `/GoodCase.xAI/codex/night-street` 路径，普通本地开发仍使用根路径。

浏览器验证：

```sh
node tests/pages-smoke.mjs
```

已有 Chromium 可通过 `QA_BROWSER` 指定可执行文件路径，避免重复下载浏览器。
