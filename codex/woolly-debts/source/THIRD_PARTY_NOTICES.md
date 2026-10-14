# Third-Party Notices

本项目运行包只包含 npm 依赖及 Electron 运行时，不包含《Bills Must Be Paid》的代码或媒体资产。

## Runtime

| Component | License | Project |
|---|---|---|
| Three.js | MIT | https://github.com/mrdoob/three.js |
| Electron | MIT | https://github.com/electron/electron |

## Build and Test Tooling

| Component | License | Project |
|---|---|---|
| Vite | MIT | https://github.com/vitejs/vite |
| TypeScript | Apache-2.0 | https://github.com/microsoft/TypeScript |
| Vitest | MIT | https://github.com/vitest-dev/vitest |
| Playwright | Apache-2.0 | https://github.com/microsoft/playwright |
| electron-builder | MIT | https://github.com/electron-userland/electron-builder |

完整依赖版本由 `pnpm-lock.yaml` 锁定。各组件的许可证文本保留在 `node_modules` 对应包内，并随 Electron 运行时的标准许可证文件一起提供。

## Research-Only References

调研中查看过的 GitHub 辅助工具、视觉跟踪器和 Unity 研究工具没有被复制进源代码或发布包。详见 `RESEARCH_AND_NUMERICAL_BASELINE.md`。
