/**
 * 入口：Phaser 3 引导。
 *  - 1920×1080 基准 + Scale.FIT 自适应（美术 §5.1.1）
 *  - 两个场景分层：WorldScene（可被 zoom rails 缩放）+ HudScene（恒 zoom 1，不参与）
 *  - 无外部资源加载 ⇒ 零加载失败风险、首屏即渲染
 */
import { WorldScene } from './render/world.js';
import { HudScene } from './render/hud.js';
import { Game } from './render/game-state.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 1920,
  height: 1080,
  backgroundColor: '#0b1026',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1920,
    height: 1080,
  },
  render: { antialias: true, roundPixels: false, powerPreference: 'high-performance' },
  fps: { target: 60, min: 30 },
  scene: [WorldScene, HudScene],
};

const game = new Phaser.Game(config);
// 供无头/自动化检查读取（只读钩子，不参与游戏逻辑）
window.__ROCKET_GAME__ = game;
window.__RLS__ = { Game, Phaser };
