# 2066 决战世界杯

由 Codex AI Agent 完成的 3D 五人制足球游戏。

在线游玩：https://wangxp7.github.io/GoodCase.xAI/codex/2066-world-cup/

Three.js 渲染球场，Ammo.js 处理刚体碰撞，PixiJS 绘制特效；支持键盘、鼠标及触屏。

操作：WASD/方向键移动、空格射门、E 传球、Q/Tab 切人、P 暂停。

包含三档 AI、阵型与时长设置、比赛统计、浏览器本地档案与战绩、带种子数据的排行榜。数据仅保存在当前浏览器。

## 源码与构建

源码位于 source/。Node.js 22.13+，运行 npm ci 和 npm run build:pages；生成的 dist-pages/ 可部署到静态站点任意子目录。需要现代 WebGL 浏览器并通过 HTTP(S) 访问。所有引擎依赖随构建打包，无需 CDN 或后端服务。
