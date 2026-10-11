/**
 * WorldScene —— 场景层（可被 zoom rails 缩放，HUD 在独立场景不受影响）
 *
 * 渲染策略（性能预算，美术 §6.0）：
 *   - 静态几何（天空带 / 星空 / 地球弧 / 地面 / 塔架 / 箭体）各只**绘制一次**，
 *     每帧只改位置 / 旋转 / alpha —— 不每帧重绘 Graphics（美术 §10.4 禁忌）。
 *   - 动态几何仅尾焰一个 Graphics（小面积），每帧重绘，代价可忽略。
 *   - 活跃粒子 = 0（火焰与烟全用程序化硬边形体占位），远低于 420 红线。
 *
 * 垂直映射：火箭锚点固定，**地面随高度下沉**（下沉锚点 C2 的 2D 实现）。
 * 这规避了美术 RA-2 的"千万级世界坐标 Float 抖动"，无需分段世界。
 */
import { Game } from './game-state.js';
import { C, TXT, FONT_MONO, FONT_SANS } from './palette.js';
import { SKY_BANDS, WORLD, CONTROL, PROGRAM } from '../core/constants.js';
import { SeqPhase } from '../core/simulation.js';

const GROUND_Y0 = 920;
const ROCKET_H = 768;

export class WorldScene extends Phaser.Scene {
  constructor() { super('WorldScene'); }

  create() {
    this.sim = Game.sim;
    this.reduceMotion = Game.reduceMotion;

    // ── 天空（两层交叉淡入，离散色带，非连续渐变）──
    this.skyLayers = [this._makeSkyLayer(), this._makeSkyLayer()];
    this.activeSky = 0;
    this.currentBandIdx = -1;
    this._applySkyBand(0, 0, true);

    // ── 星空 / 地球弧（各绘制一次）──
    this.stars = this.add.graphics().setAlpha(0);
    this._drawStars();
    this.earthArc = this.add.graphics().setAlpha(0);
    this._drawEarthArc();

    // ── 云层（扁平硬边椭圆，视差）──
    this.clouds = [];
    this._drawClouds();

    // ── 大气顶事件线 ──
    this.atmLine = this.add.graphics().setAlpha(0);
    this.atmLine.lineStyle(1, C.A2, 1);
    this.atmLine.lineBetween(0, 0, 1920, 0);
    this.atmText = this.add.text(960, -22, 'ATMOSPHERE TOP · 12 KM', {
      fontFamily: FONT_MONO, fontSize: '18px', color: TXT.A2,
    }).setOrigin(0.5, 1).setAlpha(0);

    // ── 地面 + 塔架（绘制一次）──
    this.ground = this.add.graphics();
    this._drawGround();

    // ── 火箭（容器 + 绘制一次）──
    this.rocket = this.add.container(960, 516);
    this.rocketG = this.add.graphics();
    this._drawRocket(this.rocketG);
    this.rocket.add(this.rocketG);

    // ── 尾焰（每帧重绘，小面积）──
    // 修复：图形对象锚定到箭体 x=960（此前留在 (0,0)，尾焰实际画在屏幕最左侧）
    this.flame = this.add.graphics().setPosition(960, 0);

    // ── 分离残骸（屏幕空间近似）──
    this.debris = this.add.graphics().setVisible(false);

    // ── 输入 ──
    this.keys = this.input.keyboard.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
      w: 'W', s: 'S', a: 'A', d: 'D',
      space: 'SPACE', shift: 'SHIFT', esc: 'ESC', r: 'R', m: 'M',
    });

    // 场景级事件订阅
    this.simEvents = [];
    this.shakeT = 0;
    this.restartLock = 0;

    // HUD 独立场景：本场景不参与 zoom rails，HUD 恒 1:1（美术 §12.3-7）
    if (!this.scene.isActive('HudScene')) this.scene.launch('HudScene');

    this.scale.on('resize', () => {});   // Scale.FIT 自动，无需处理
  }

  // ═══════════════ 绘制（一次性） ═══════════════
  _makeSkyLayer() {
    const top = this.add.rectangle(960, 350, 1920, 700, C.P3, 1);
    const bot = this.add.rectangle(960, 890, 1920, 380, C.P3, 1);
    return { top, bot };
  }

  _applySkyBand(idx, alpha, instant) {
    const band = SKY_BANDS[idx];
    const incoming = 1 - this.activeSky;
    const layer = this.skyLayers[incoming];
    layer.top.setFillStyle(band.top, 1);
    layer.bot.setFillStyle(band.bot, 1);
    if (instant) {
      layer.top.setAlpha(1); layer.bot.setAlpha(1);
      this.skyLayers[this.activeSky].top.setAlpha(0);
      this.skyLayers[this.activeSky].bot.setAlpha(0);
      this.activeSky = incoming;
      return;
    }
    layer.top.setAlpha(0); layer.bot.setAlpha(0);
    this.tweens.add({
      targets: [layer.top, layer.bot], alpha: 1, duration: 800,
      onComplete: () => {
        this.skyLayers[this.activeSky].top.setAlpha(0);
        this.skyLayers[this.activeSky].bot.setAlpha(0);
        this.activeSky = incoming;
      },
    });
  }

  _drawStars() {
    const g = this.stars;
    let seed = 1337;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let i = 0; i < 160; i++) {
      const x = rnd() * 1920, y = rnd() * 620;
      const r = rnd() < 0.85 ? 1 : 2;
      g.fillStyle(0xffffff, 0.4 + rnd() * 0.6);
      g.fillRect(x, y, r, r);
    }
  }

  _drawEarthArc() {
    // 行星本体 + 大气辉光弧：圆心压到屏幕下方，只露出顶部一条"limb"
    const g = this.earthArc;
    const cx = 960, cy = 3500, r = 2700;      // 顶缘 y ≈ 800
    g.fillStyle(C.P3, 1); g.fillCircle(cx, cy, r);
    g.lineStyle(10, C.S2, 0.9); g.strokeCircle(cx, cy, r);
    g.lineStyle(3, C.A2, 0.85); g.strokeCircle(cx, cy, r + 12);
  }

  _drawClouds() {
    let seed = 77;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 12; i++) {
      const g = this.add.graphics();
      const w = 200 + rnd() * 420, h = w * (0.22 + rnd() * 0.12);
      const x = rnd() * 1920, y = 120 + rnd() * 640;
      g.fillStyle(0xf4efe4, 0.85); g.fillEllipse(x, y, w, h);
      g.fillStyle(0xc9d6e4, 0.75); g.fillEllipse(x + 8, y + h * 0.35, w * 0.92, h * 0.8);
      this.clouds.push({ g, y, parallax: 0.4 + rnd() * 0.35 });
    }
  }

  _drawGround() {
    const g = this.ground;
    // 地表
    g.fillStyle(C.SAND_DARK, 1); g.fillRect(-200, 0, 2320, 300);
    g.fillStyle(C.SAND, 1); g.fillRect(-200, 0, 2320, 90);
    // 发射台水泥基座
    g.fillStyle(C.CONCRETE, 1); g.fillRect(600, -40, 720, 90);
    g.fillStyle(C.P2, 1); g.fillRect(600, 40, 720, 16);
    // 导流槽
    g.fillStyle(C.P3, 1); g.fillRect(880, -30, 160, 60);
    g.fillStyle(C.S1, 0.6); g.fillRect(890, -20, 140, 40);
    // 燃料储罐（圆柱）
    g.fillStyle(C.P1, 1); g.fillRect(320, -150, 110, 150);
    g.fillStyle(C.S1, 1); g.fillRect(320, -100, 110, 22);
    g.fillStyle(C.P2, 1); g.fillRect(320, -158, 110, 12);
    g.fillStyle(C.P1, 1); g.fillRect(1480, -140, 100, 140);
    g.fillStyle(C.S1, 1); g.fillRect(1480, -96, 100, 20);
    g.fillStyle(C.P2, 1); g.fillRect(1480, -148, 100, 12);
    // 控制室方舱
    g.fillStyle(C.P3, 1); g.fillRect(200, -80, 90, 80);
    g.fillStyle(C.A2, 0.9); g.fillRect(212, -62, 26, 14);
    // 塔架（X 形交叉支撑 + 水平平台）
    const tx = 1140, tw = 96;
    g.fillStyle(C.S1, 1); g.fillRect(tx, -880, 16, 880); g.fillRect(tx + tw - 16, -880, 16, 880);
    for (let i = 0; i < 9; i++) {
      const y0 = -i * 96, y1 = -(i + 1) * 96;
      g.lineStyle(10, C.S1, 1);
      g.lineBetween(tx + 16, y0, tx + tw - 16, y1);
      g.lineBetween(tx + 16, y1, tx + tw - 16, y0);
    }
    g.fillStyle(C.S1, 1);
    for (let i = 0; i < 4; i++) g.fillRect(tx - 14, -180 - i * 200, tw + 28, 12);
    g.fillStyle(C.P2, 1); g.fillRect(tx + tw - 24, -880, 8, 880);
  }

  _drawRocket(g) {
    // 全局坐标：容器原点 = 箭体中心；y 从 -384（顶）到 +384（底）
    const half = ROCKET_H / 2;   // 384
    const w = 96;
    // 整流罩（头锥 22°）
    g.fillStyle(C.P1, 1);
    g.fillTriangle(-w / 2, -half + 160, w / 2, -half + 160, 0, -half);
    g.fillRect(-w / 2, -half + 160, w, 20);
    g.fillStyle(C.P2, 1); g.fillRect(-w / 2, -half + 180, w, 8);
    // 二级
    g.fillStyle(C.P1, 1); g.fillRect(-w / 2, -half + 188, w, 200);
    g.fillStyle(C.A2, 1); g.fillRect(-w / 2, -half + 300, w, 8);
    g.fillStyle(C.P2, 1); g.fillRect(0, -half + 188, 4, 200);   // 燃料管
    // 级间环
    g.fillStyle(C.P2, 1); g.fillRect(-w / 2, -half + 388, w, 10);
    // 一级
    g.fillStyle(C.P1, 1); g.fillRect(-w / 2, -half + 398, w, 336);
    g.fillStyle(C.S1, 1); g.fillRect(-w / 2, -half + 500, w, 32);
    g.fillStyle(C.P2, 1); g.fillRect(0, -half + 398, 4, 336);
    // 尾翼
    g.fillStyle(C.S1, 1);
    g.fillTriangle(-w / 2, -half + 640, -w / 2 - 56, -half + 734, -w / 2, -half + 734);
    g.fillTriangle(w / 2, -half + 640, w / 2 + 56, -half + 734, w / 2, -half + 734);
    // 发动机喷口（5 个：1 中 + 4 周）
    g.fillStyle(C.P2, 1);
    g.fillRect(-18, -half + 734, 36, 20);
    g.fillRect(-44, -half + 726, 16, 24); g.fillRect(28, -half + 726, 16, 24);
    // 铆钉点阵
    g.fillStyle(C.P2, 0.8);
    for (let y = -half + 200; y < half - 20; y += 32) { g.fillRect(-w / 2 + 6, y, 2, 2); g.fillRect(w / 2 - 8, y, 2, 2); }
  }

  // ═══════════════ 主循环 ═══════════════
  update(time, delta) {
    const sim = this.sim;
    const dt = Math.min(delta / 1000, 0.1);

    // 减少动效开关（M）
    if (Phaser.Input.Keyboard.JustDown(this.keys.m)) {
      this.reduceMotion = !this.reduceMotion;
      Game.reduceMotion = this.reduceMotion;
    }

    this._readInput(sim);

    // 重开（失败面板后 R / Space）
    if (this.restartLock > 0) this.restartLock -= dt;
    const hm = sim.hudModel();
    const restartPressed = Phaser.Input.Keyboard.JustDown(this.keys.r) ||
      (Phaser.Input.Keyboard.JustDown(this.keys.space) && hm.canRestart);
    if (restartPressed && hm.canRestart) {
      Game.recordOutcome();
      this.sim = Game.restart();
      this.restartLock = 0.3;
      this._resetVisuals();
      return;
    }
    // 成功结算后也可重开
    if (sim.outcome === 'SUCCESS' && sim.judgeFreezeT > 1.4 &&
        (Phaser.Input.Keyboard.JustDown(this.keys.r) || Phaser.Input.Keyboard.JustDown(this.keys.space))) {
      Game.recordOutcome();
      this.sim = Game.restart();
      this._resetVisuals();
      return;
    }

    const events = sim.update(dt);
    this._handleEvents(events);
    if (sim.outcome !== null && !this._outcomeRecorded) {
      this._outcomeRecorded = true;
      Game.recordOutcome();
    }
    if (sim.outcome === null) this._outcomeRecorded = false;

    this._render(sim, dt);
  }

  _readInput(sim) {
    const k = this.keys;
    const pitch = (k.left.isDown || k.a.isDown ? 1 : 0) + (k.right.isDown || k.d.isDown ? -1 : 0);
    const throttle = (k.up.isDown || k.w.isDown ? 1 : 0) + (k.down.isDown || k.s.isDown ? -1 : 0);
    sim.setInput({
      pitch: Math.sign(pitch),
      throttle: Math.sign(throttle),
      stage: k.shift.isDown,
      launch: k.space.isDown,
      abort: Phaser.Input.Keyboard.JustDown(k.esc),
    });
  }

  _handleEvents(events) {
    for (const e of events) {
      if (e.type === 'T_ZERO' || e.type === 'SEPARATE') this._shake(this.reduceMotion ? 0 : 10, 0.4);
      if (e.type === 'MAXQ_PASSED') this._shake(this.reduceMotion ? 0 : 4, 0.3);
      if (e.type === 'ATMOSPHERE_EXIT') this._flashAtmLine();
      if (e.type === 'FAILURE') this._shake(this.reduceMotion ? 0 : 12, 0.5);
      if (e.type === 'SEPARATE') this._spawnDebris();
    }
  }

  _shake(px, dur) { if (px > 0) this.cameras.main.shake(dur * 1000, px / 1000, false); }

  _flashAtmLine() {
    this.atmLine.setAlpha(1); this.atmText.setAlpha(1);
    this.tweens.add({ targets: [this.atmLine, this.atmText], alpha: 0, duration: 1200, delay: 200 });
  }

  _spawnDebris() {
    const d = this.sim.staging.debris;
    if (!d) return;
    this.debrisObj = {
      x: 960 + 8, y: this.rocketY + ROCKET_H / 2 * this.zoom - 40,
      vx: 30, vy: -260, angle: 0, spin: 0.785, life: 0, active: true,
    };
  }

  _resetVisuals() {
    this._outcomeRecorded = false;
    this.debris.setVisible(false);
    if (this.debrisObj) this.debrisObj.active = false;
    this.flame.clear();
    this.cameras.main.resetFX && this.cameras.main.resetFX();
    this._applySkyBand(0, 1, true);
    this.currentBandIdx = 0;
  }

  // ═══════════════ 渲染 ═══════════════
  _render(sim, dt) {
    const m = sim.hudModel();
    const alt = Math.max(0, m.altitudeM);

    // 天空色带
    const bi = this._bandIndex(alt);
    if (bi !== this.currentBandIdx) { this._applySkyBand(bi, 1, false); this.currentBandIdx = bi; }

    // 星空 / 地球弧
    this.stars.setAlpha(Phaser.Math.Clamp((alt - 5000) / 7000, 0, 0.9));
    this.earthArc.setAlpha(Phaser.Math.Clamp((alt - 9000) / 9000, 0, 0.9));

    const scroll = this._scrollOf(alt);

    // 云（视差：随高度整体下沉，渐变淡出）
    const cloudAlpha = Phaser.Math.Clamp(1 - (alt - 1500) / 3500, 0, 1) * 0.95;
    for (const c of this.clouds) {
      c.g.setPosition(0, scroll * c.parallax);
      c.g.setAlpha(cloudAlpha);
    }

    // 地面
    this.ground.y = GROUND_Y0 + scroll;

    // zoom rails（事件节点硬切，美术 §5.1.3 C1）
    this.zoom = this._zoomOf(alt, m);
    this.rocket.setScale(this.zoom);
    this.rocketY = this._anchorY(this.zoom);
    this.rocket.y = this.rocketY;
    this.rocket.x = 960;
    const theta = m.thetaDeg * Math.PI / 180;
    // theta=90°（垂直向上）→ rotation 0（箭体绘制为朝上）；theta=0°（当地水平）→ +90°（朝 downrange 右）
    this.rocket.setRotation(Math.PI / 2 - theta);

    // 尾焰
    this._drawFlame(m);

    // 残骸
    this._updateDebris(dt);
  }

  _bandIndex(alt) {
    for (let i = 0; i < SKY_BANDS.length; i++) if (alt < SKY_BANDS[i].hi) return i;
    return SKY_BANDS.length - 1;
  }

  _scrollOf(altM) { return 900 * Math.pow(Math.max(0, altM) / 1000, 0.7); }

  _zoomOf(alt, m) {
    const tRel = (m.phase === SeqPhase.FLIGHT || m.phase === SeqPhase.RELEASE) ? m.flightTime : -1;
    if (tRel < 0.6) return 1.0;
    if (alt < WORLD.ATM_TOP) return 0.75;
    return 0.5;
  }

  _anchorY(zoom) { return zoom === 1.0 ? 516 : zoom === 0.75 ? 648 : 702; }

  _drawFlame(m) {
    const g = this.flame; g.clear();
    const th = m.throttle;
    const firing = (m.phase === SeqPhase.FLIGHT) &&
      ((m.stage === 1 && m.fuel1Kg > 0) || (m.stage === 2 && m.fuel2Kg > 0)) &&
      sim2Firing(this.sim);
    const vac = m.altitudeM > WORLD.ATM_TOP;
    const base = 360 * (vac ? 1.6 : 1.0) * th;
    if (!firing || base <= 1) return;
    const y0 = this.rocketY + (ROCKET_H / 2 - 8) * this.zoom;
    const w = 96 * this.zoom;
    const layers = [
      { len: base * 0.55, col: 0xfff3d0, wid: w * 0.5 },
      { len: base, col: C.A1, wid: w * 0.8 },
      { len: base * 1.15, col: C.S1, wid: w * (vac ? 2.4 : 1.0) },
    ];
    // 侧滑暗示：α ≠ 0 时尾焰侧偏（S4 §5.4 —— 让"配平失准"看得见）
    const slip = Phaser.Math.Clamp(-m.alphaDeg / 25, -1, 1) * 22 * this.zoom;
    for (const L of layers) {
      g.fillStyle(L.col, vac ? 0.7 : 0.95);
      const tx = L.len > 0 ? slip * (L.len / base) : 0;
      g.fillTriangle(-L.wid / 2, y0, L.wid / 2, y0, tx, y0 + L.len);
    }
    // 大气段地面横向卷云（简化为 3 个硬边椭圆；x 相对箭体锚点 960）
    if (!vac && m.altitudeM < 800) {
      const gy = GROUND_Y0 + this._scrollOf(Math.max(0, m.altitudeM));
      const a = Phaser.Math.Clamp(1 - m.altitudeM / 800, 0, 1) * 0.5;
      g.fillStyle(0xc9d6e4, a);
      g.fillEllipse(0, gy - 20, 800, 60);
      g.fillEllipse(-200, gy - 30, 560, 44);
      g.fillEllipse(200, gy - 30, 640, 48);
    }
  }

  _updateDebris(dt) {
    const o = this.debrisObj;
    if (!o || !o.active) { this.debris.setVisible(false); return; }
    o.life += dt;
    o.vy += 240 * dt;                 // 屏幕空间重力近似
    o.x += o.vx * dt; o.y += o.vy * dt;
    o.angle += o.spin * dt;
    if (o.life > 6 || o.y > 1400) { o.active = false; this.debris.setVisible(false); return; }
    const g = this.debris; g.clear(); g.setVisible(true);
    g.fillStyle(C.P1, 1); g.fillRect(-24, -40, 48, 80);
    g.fillStyle(C.S1, 1); g.fillRect(-24, -6, 48, 12);
    g.setPosition(o.x, o.y); g.setRotation(o.angle);
  }
}

function sim2Firing(sim) {
  const fm = sim.fm;
  return (fm.stage === 1 && fm.fuel1 > 0) || (fm.stage === 2 && fm.fuel2 > 0);
}
