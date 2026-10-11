/**
 * HudScene —— 浮层 HUD（S7 + 美术 §5.1.2 布局）
 *
 * 与 WorldScene 分层：HUD 恒 zoom 1，不参与 zoom rails。
 * 静态几何（面板框 / 角标 / 刻度 / 标签）绘制一次；动态元素（数值文本 + 一处动态
 * Graphics）每帧更新。5 读数、5 动词全部有可视载体（A7-11 / A7-12）。
 *
 * 不撒谎五防线（S7 §3.1）：模态 A 无 km、含 EST、填充 A2 非绿、成功标记空心灰。
 */
import { Game } from './game-state.js';
import { C, TXT, FONT_MONO, FONT_SANS } from './palette.js';
import { HUD, WORLD, JUDGE, FAIL, SEQ } from '../core/constants.js';
import { SeqPhase, Judgement } from '../core/simulation.js';

const MONO = FONT_MONO, SANS = FONT_SANS;

// 遥测柱布局（S7 §5.1 / §5.2；单位 px @1920×1080）
const TX = 1584, TW = 320, TCX = TX + TW / 2;   // 1744
const BAR = { x: 1616, y: 282, w: 256, h: 248 };

export class HudScene extends Phaser.Scene {
  constructor() { super('HudScene'); }

  create() {
    this.sim = Game.sim;
    this.gDynamic = this.add.graphics();      // 唯一的每帧动态 Graphics
    this._buildStatic();
    this._buildDynamic();
    this._buildPanels();
  }

  // ── 静态层 ───────────────────────────────────────────────
  _panel(x, y, w, h, alpha = 0.78) {
    this.add.rectangle(x + w / 2, y + h / 2, w, h, C.P3, alpha)
      .setStrokeStyle(1, C.A2, 0.5);
    const g = this.add.graphics(); g.lineStyle(1, C.A2, 0.8);
    const L = 12;
    for (const [cx, cy, dx, dy] of [
      [x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1],
    ]) {
      g.lineBetween(cx, cy, cx + dx * L, cy); g.lineBetween(cx, cy, cx, cy + dy * L);
    }
  }

  _label(x, y, s, size, color, origin = [0, 0]) {
    return this.add.text(x, y, s, { fontFamily: SANS, fontSize: size + 'px', color })
      .setOrigin(origin[0], origin[1]);
  }

  _buildStatic() {
    const g = this.add.graphics();
    this._panel(0, 0, 1920, 96);            // 任务带
    this._panel(16, 140, 80, 800);          // 高度带
    this._panel(112, 96, 576, 844);         // 环境框边
    this._panel(TX, 220, TW, 660);          // 遥测柱
    this._panel(0, 940, 1920, 140);         // 控制台

    // 高度带刻度 0..20km 倒序
    for (let km = 0; km <= 20; km += 5) {
      const y = 140 + 800 - (km / 20) * 800;
      g.lineStyle(1, C.A2, 0.7); g.lineBetween(16, y, 16 + (km % 10 === 0 ? 20 : 12), y);
      this.add.text(42, y - 8, String(km), { fontFamily: MONO, fontSize: '14px', color: TXT.A2 });
    }
    this.add.text(56, 132, 'ALT km', { fontFamily: MONO, fontSize: '12px', color: TXT.P2 }).setOrigin(0.5, 1);

    // 遥测柱：Ω 目标线 + 刻度（条的量程上界 = 目标高度，故条满即达标）
    g.lineStyle(2, C.A2, 1); g.lineBetween(BAR.x - 14, BAR.y, BAR.x + BAR.w + 14, BAR.y);
    g.lineStyle(1, C.A2, 0.6); g.lineBetween(BAR.x - 14, BAR.y + BAR.h, BAR.x + BAR.w + 14, BAR.y + BAR.h);
    for (const [G, label] of [[0.8, '7.5'], [0.6, '0']]) {
      const y = BAR.y + BAR.h * (1 - G);
      g.lineStyle(1, C.A2, 0.4); g.lineBetween(BAR.x, y, BAR.x + BAR.w, y);
      this.add.text(BAR.x + 4, y - 14, label, { fontFamily: MONO, fontSize: '11px', color: TXT.P2 });
    }
    this.add.text(BAR.x + BAR.w + 12, BAR.y - 16, '15 KM TARGET', {
      fontFamily: MONO, fontSize: '11px', color: TXT.A2,
    }).setOrigin(1, 0);

    // 环境框边（纵向走纸网格 + 状态灯阵 + 远山剪影）
    g.fillStyle(C.P3, 0.5); g.fillRect(120, 106, 560, 824);
    g.lineStyle(1, C.S2, 0.35);
    for (let i = 0; i <= 12; i++) { const x = 132 + i * 46; g.lineBetween(x, 106, x, 930); }
    for (let i = 0; i <= 16; i++) { const y = 106 + i * 51; g.lineBetween(120, y, 680, y); }
    g.fillStyle(C.P3, 0.95);
    g.fillTriangle(120, 930, 260, 780, 400, 930);
    g.fillTriangle(360, 930, 520, 740, 680, 930);
    for (let i = 0; i < 8; i++) { g.fillStyle(C.P2, 0.9); g.fillRect(644, 140 + i * 40, 16, 16); }

    // 控制台：序列指示器 12 段（左右各一）
    for (let i = 0; i < 12; i++) {
      g.lineStyle(1, C.A2, 0.6); g.strokeRect(150 + i * 26, 1010, 20, 40);
      g.lineStyle(1, C.A2, 0.6); g.strokeRect(1920 - 150 - 12 * 26 + i * 26, 1010, 20, 40);
    }
    this._label(150, 978, '序列指示器 SEQUENCE', 14, TXT.P2);
    this._label(1440, 980, '节流 THROTTLE [W/S]', 14, TXT.P2);
    for (let i = 0; i < 8; i++) { g.lineStyle(1, C.A2, 0.6); g.strokeRect(1440 + i * 30, 1012, 24, 36); }

    // 主发射按钮 400×88（居中）
    g.lineStyle(2, C.A1, 0.9); g.strokeRect(760, 986, 400, 88);
    this.launchLabel = this.add.text(960, 1030, 'HOLD SPACE TO LAUNCH', {
      fontFamily: SANS, fontSize: '22px', color: TXT.A1, fontStyle: 'bold',
    }).setOrigin(0.5);

    // 分离按钮
    g.lineStyle(2, C.P2, 0.9); g.strokeRect(300, 998, 260, 64);
    this.sepLabel = this.add.text(430, 1030, 'SEPARATE [SHIFT]', {
      fontFamily: MONO, fontSize: '16px', color: TXT.P2,
    }).setOrigin(0.5);
    this.abortLabel = this.add.text(1700, 1030, 'ABORT [ESC]', {
      fontFamily: SANS, fontSize: '16px', color: TXT.P2,
    }).setOrigin(0.5);

    // 任务带
    this.missionName = this.add.text(24, 20, 'MISSION 01 · PLANET-C', {
      fontFamily: SANS, fontSize: '20px', color: TXT.P1, fontStyle: 'bold',
    });
    this.phaseText = this.add.text(960, 22, '待机 STANDBY', {
      fontFamily: SANS, fontSize: '22px', color: TXT.A2, fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    this.timerText = this.add.text(1896, 14, '--.-', {
      fontFamily: MONO, fontSize: '64px', color: TXT.A1,
    }).setOrigin(1, 0);
    this.warningText = this.add.text(1040, 34, '', {
      fontFamily: SANS, fontSize: '18px', color: TXT.WARN,
    });
    this.hintText = this.add.text(24, 54, 'A/D 配平   W/S 节流   SHIFT 分离   ESC 中止   M 减少动效   R 重开', {
      fontFamily: SANS, fontSize: '14px', color: TXT.P2,
    });
    this.subText = this.add.text(960, 62, '', {
      fontFamily: SANS, fontSize: '14px', color: TXT.P2,
    }).setOrigin(0.5);
  }

  // ── 动态文本 ─────────────────────────────────────────────
  _buildDynamic() {
    const mk = (x, y, size, color, origin = [0.5, 0], bold = false) =>
      this.add.text(x, y, '', { fontFamily: MONO, fontSize: size + 'px', color, fontStyle: bold ? 'bold' : 'normal' })
        .setOrigin(origin[0], origin[1]);

    this.omegaLabel = this._label(BAR.x, 228, '', 14, TXT.A2);
    this.omegaBadge = this._label(BAR.x + BAR.w, 228, '', 13, TXT.P2, [1, 0]);
    this.apoText = this._label(BAR.x, 250, '', 13, TXT.P2);
    this.omegaValue = mk(TCX, 536, 30, TXT.A2, [0.5, 0], true);
    this.omegaFoot = mk(TCX, 574, 14, TXT.P2);

    this._label(TX + 16, 604, '速度 SPEED m/s', 13, TXT.P2);
    this.speedValue = mk(TCX, 628, 40, TXT.A2, [0.5, 0], true);
    this.qValue = mk(TCX, 682, 16, TXT.A2);

    this._label(TX + 16, 712, '燃料 FUEL', 13, TXT.P2);
    this.fuel1Text = mk(BAR.x, 732, 14, TXT.A2, [0, 0]);
    this.fuel2Text = mk(BAR.x, 792, 14, TXT.A2, [0, 0]);
    this.stageText = mk(BAR.x, 848, 15, TXT.P1, [0, 0]);

    // 高度数字（贴在高度带）
    this.altText = this.add.text(60, 954, '', { fontFamily: MONO, fontSize: '18px', color: TXT.A1 }).setOrigin(0.5, 1);

    // 姿态指示器 + 配平代价（紧贴箭体，浮动；Task1：把约束变成可读的）
    this.attC = { x: 1216, y: 474 };
    this.trimLabel = this.add.text(this.attC.x, this.attC.y - 110, '配平 TRIM · 攻角 / Cd / 气动代价', {
      fontFamily: SANS, fontSize: '12px', color: TXT.P2,
    }).setOrigin(0.5);
    this.thetaText = this.add.text(this.attC.x, this.attC.y - 86, '', {
      fontFamily: MONO, fontSize: '16px', color: TXT.A2,
    }).setOrigin(0.5);
    this.aoaText = this.add.text(this.attC.x, this.attC.y + 64, '', {
      fontFamily: MONO, fontSize: '15px', color: TXT.A2,
    }).setOrigin(0.5);
    this.costText = this.add.text(this.attC.x, this.attC.y + 102, '', {
      fontFamily: MONO, fontSize: '13px', color: TXT.P2,
    }).setOrigin(0.5);
  }

  // ── 结算 / 失败面板 ──────────────────────────────────────
  _buildPanels() {
    this.panelContainer = this.add.container(0, 0).setDepth(50).setVisible(false);
    const dim = this.add.rectangle(960, 540, 1920, 1080, C.P3, 0.85);
    this.panelTitle = this.add.text(960, 210, '', { fontFamily: SANS, fontSize: '46px', color: TXT.SUCCESS, fontStyle: 'bold' }).setOrigin(0.5);
    this.panelBody = this.add.text(960, 320, '', { fontFamily: MONO, fontSize: '22px', color: TXT.P1, align: 'center', lineSpacing: 12 }).setOrigin(0.5, 0);
    this.panelLegend = this.add.text(960, 906, '入轨门槛  近地点 ≥ 13.5 km       精确入轨  近地点 14.25 – 15.75 km', {
      fontFamily: MONO, fontSize: '16px', color: TXT.P2,
    }).setOrigin(0.5);
    this.panelRetry = this.add.text(960, 986, 'RETRY (R)', { fontFamily: SANS, fontSize: '28px', color: TXT.A1, fontStyle: 'bold' }).setOrigin(0.5);
    this.panelContainer.add([dim, this.panelTitle, this.panelBody, this.panelLegend, this.panelRetry]);
  }

  // ═══════════════ 主循环 ═══════════════
  update() {
    this.sim = Game.sim;
    const m = this.sim.hudModel();
    const g = this.gDynamic; g.clear();

    this._updateMissionBar(m);
    this._updateAltitude(m, g);
    this._updateOmega(m, g);
    this._updateSpeed(m, g);
    this._updateFuel(m, g);
    this._updateConsole(m, g);
    this._updateAttitude(m, g);
    this._updatePanel(m);
  }

  _updateMissionBar(m) {
    this.missionName.setText(`MISSION ${String(m.missionNo).padStart(2, '0')} · PLANET-C`);
    this.phaseText.setText(m.phaseName);
    const flying = m.phase === SeqPhase.FLIGHT || m.phase === SeqPhase.RELEASE;
    if (m.phase === SeqPhase.COUNTDOWN) this.timerText.setText(fmt(Math.max(0, -m.t), 1)).setColor(TXT.A1);
    else if (flying) this.timerText.setText('T+' + fmt(m.flightTime, 1)).setColor(TXT.P1);
    else if (m.outcome === 'FAILURE') this.timerText.setText(fmt(m.flightTime, 1)).setColor(TXT.DANGER);
    else this.timerText.setText('--.-').setColor(TXT.P2);
    this.warningText.setText(m.warningText || '');
    this.subText.setText(flying
      ? `姿态 ${fmt(m.thetaDeg, 1)}°   攻角 ${fmt(m.alphaDeg, 1)}°   高度率 ${fmt(m.altitudeRateMs, 0)} m/s   质量 ${fmt(m.massKg, 0)} kg`
      : '');
  }

  _updateAltitude(m, g) {
    const km = m.altitudeM / 1000;
    const y = 140 + 800 - Phaser.Math.Clamp(km / 20, 0, 1) * 800;
    g.fillStyle(C.A1, 1); g.fillTriangle(96, y, 96 + 18, y - 9, 96 + 18, y + 9);
    this.altText.setText(fmt(km, 2) + ' km');
  }

  _updateOmega(m, g) {
    const pct = Phaser.Math.Clamp(m.omegaPct, 0, 100);
    const fillH = BAR.h * pct / 100;
    const modeB = m.omegaSource === 'B';

    g.fillStyle(C.P2, 0.18); g.fillRect(BAR.x, BAR.y, BAR.w, BAR.h);

    // 切换过渡：0.6s，8% 过冲（位移而非 scale，美术 §5.4 / T9）
    let overshoot = 0;
    if (modeB && m.omegaSwitchT !== null) {
      const e = Phaser.Math.Clamp((m.flightTime - m.omegaSwitchT) / HUD.T_TRANSITION, 0, 1);
      overshoot = Math.sin(e * Math.PI) * HUD.OVERSHOOT * 10;
    }

    const crossed = m.periapsisM >= WORLD.H;
    if (modeB) {
      g.fillStyle(crossed ? C.SUCCESS : C.A2, 0.95);
      g.fillRect(BAR.x, BAR.y + BAR.h - fillH - 6 - overshoot, BAR.w, 12);
    } else {
      g.fillStyle(C.A2, 0.85);
      g.fillRect(BAR.x, BAR.y + BAR.h - fillH, BAR.w, fillH);
    }

    // 成功标记：模态 A 恒空心灰（第 5 道防线）；模态 B 越线才点亮
    const mx = BAR.x + BAR.w + 22, my = BAR.y;
    if (modeB && crossed) { g.fillStyle(C.SUCCESS, 1); g.fillCircle(mx, my, 9); }
    else { g.lineStyle(2, C.P2, 1); g.strokeCircle(mx, my, 9); }

    if (modeB) {
      this.omegaLabel.setText('近地点 PERIAPSIS').setColor(crossed ? TXT.SUCCESS : TXT.A2);
      this.omegaBadge.setText('MEA').setColor(TXT.P2);
      const p = m.periapsisM / 1000;
      this.omegaValue.setText((p < 0 ? '0.00' : fmt(p, 2)) + ' km').setColor(crossed ? TXT.SUCCESS : TXT.A2);
      this.apoText.setText(`远地点 APOAPSIS ${fmtApo(m.apoapsisM)} km${Number.isFinite(m.apoapsisM) ? ' ▲' : ''}`);
    } else {
      this.omegaLabel.setText('入轨进度 ORBITAL PROGRESS Ω').setColor(TXT.A2);
      this.omegaBadge.setText('EST').setColor(TXT.P2);
      this.omegaValue.setText(fmt(pct, 1) + ' %').setColor(TXT.A2);
      this.apoText.setText('');
    }
    this.omegaFoot.setText(`Δv 余量 ${fmt(m.dvRemain, 0)} m/s · ${fmt(m.fuelRemainKg, 0)} kg`);
  }

  _updateSpeed(m, g) {
    this.speedValue.setText(fmt(m.speedMs, 0));
    const qCol = m.qState === 'DANGER' ? TXT.DANGER : m.qState === 'WARN' ? TXT.WARN : TXT.A2;
    if (m.qVisible) {
      this.qValue.setText(`q ${fmt(m.qPa / 1000, 1)} / ${fmt(m.qStructPa / 1000, 0)} kPa`).setColor(qCol).setAlpha(1);
      // Max-Q 量规：q 相对结构极限 30 kPa（Task1：让"要不要收油门"这条曲线看得见）
      const gy = 702, gw = BAR.w, gh = 7;
      g.fillStyle(C.P2, 0.25); g.fillRect(BAR.x, gy, gw, gh);
      g.fillStyle(m.qState === 'DANGER' ? C.DANGER : m.qState === 'WARN' ? C.A1 : C.A2, 0.95);
      g.fillRect(BAR.x, gy, gw * Phaser.Math.Clamp(m.qPa / m.qStructPa, 0, 1), gh);
      const wx = BAR.x + gw * (m.qWarnPa / m.qStructPa);   // 警戒线 12 kPa
      g.lineStyle(1, C.A1, 0.9); g.lineBetween(wx, gy - 3, wx, gy + gh + 3);
    } else {
      this.qValue.setAlpha(0);   // 真空段折叠隐藏（S4 §6.5）
    }
  }

  _updateFuel(m, g) {
    const y1 = 752, y2 = 812, w = BAR.w;
    g.fillStyle(C.P2, 0.25); g.fillRect(BAR.x, y1, w, 20); g.fillRect(BAR.x, y2, w, 20);
    g.fillStyle(m.stage === 1 ? (m.fuel1Pct < 0.2 ? C.A1 : C.A2) : C.P2, m.stage === 1 ? 0.95 : 0.35);
    g.fillRect(BAR.x, y1, w * Phaser.Math.Clamp(m.fuel1Pct, 0, 1), 20);
    g.fillStyle(m.stage === 2 ? C.A2 : C.P2, m.stage === 2 ? 0.95 : 0.35);
    g.fillRect(BAR.x, y2, w * Phaser.Math.Clamp(m.fuel2Pct, 0, 1), 20);
    this.fuel1Text.setText(`一级 ${fmt(m.fuel1Pct * 100, 0)}%`).setColor(m.stage === 1 ? TXT.A2 : TXT.P2);
    this.fuel2Text.setText(`二级 ${fmt(m.fuel2Pct * 100, 0)}%`).setColor(m.stage === 2 ? TXT.A2 : TXT.P2);
    this.stageText.setText(`当前级 STAGE ${m.stage}`);
  }

  _updateConsole(m, g) {
    const prog = this._seqProgress(m);
    for (let i = 0; i < 12; i++) {
      if (i / 12 >= prog) continue;
      g.fillStyle(prog > 0.999 ? C.A1 : C.A2, 0.85);
      g.fillRect(150 + i * 26, 1010, 20, 40);
      g.fillRect(1920 - 150 - 12 * 26 + i * 26, 1010, 20, 40);
    }
    const ch = m.phase === SeqPhase.CHARGING ? Math.min(1, this.sim.seq.chargeT / SEQ.CHARGING_DELAY) : 0;
    if (ch > 0) { g.fillStyle(C.A1, 0.5); g.fillRect(760, 986 + 88 * (1 - ch), 400, 88 * ch); }
    this.launchLabel.setText(
      m.phase === SeqPhase.IDLE ? 'HOLD SPACE TO LAUNCH'
        : m.phase === SeqPhase.CHARGING ? 'CHARGING…' : 'LAUNCH ARMED');
    const sepEnabled = m.stageState === 'ARMED_1' && m.qPa <= FAIL.Q_SEP_SAFE;
    this.sepLabel.setColor(sepEnabled ? TXT.A2 : TXT.P2);
    const seg = Math.round(Phaser.Math.Clamp(m.throttle, 0, 1) * 8);
    // 节流提示（S4 §5.4）：动压进警戒且油门仍大 → 节流条呼吸式高亮（教学，非强制；减少动效时静态）
    const hintOn = m.qVisible && m.qPa >= m.qWarnPa && m.throttle > 0.8;
    const breathe = hintOn && !Game.reduceMotion ? 0.5 + 0.5 * Math.sin(this.time.now / 240) : 1;
    for (let i = 0; i < seg; i++) { g.fillStyle(C.A1, 0.85 * breathe); g.fillRect(1440 + i * 30 + 2, 1014, 20, 32); }
    const canAbort = m.phase === SeqPhase.FLIGHT || m.phase === SeqPhase.RELEASE;
    this.abortLabel.setColor(canAbort ? TXT.A1 : TXT.P2);
  }

  _seqProgress(m) {
    if (m.phase === SeqPhase.IDLE) return 0;
    if (m.phase === SeqPhase.CHARGING) return 0.02;
    if (m.phase === SeqPhase.COUNTDOWN) return 0.1 + Phaser.Math.Clamp((m.t + SEQ.T_COUNT) / SEQ.T_COUNT, 0, 1) * 0.2;
    if (m.phase === SeqPhase.RELEASE) return 0.32;
    if (m.phase === SeqPhase.FLIGHT) return Phaser.Math.Clamp(0.35 + m.flightTime / 81, 0.35, 1);
    return 0;
  }

  _updateAttitude(m, g) {
    const cx = this.attC.x, cy = this.attC.y, R = 46;
    const flying = m.phase === SeqPhase.FLIGHT || m.phase === SeqPhase.RELEASE;
    const polar = (deg) => { const a = -deg * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; };

    // 表盘
    g.lineStyle(1, C.A2, 0.7);
    g.beginPath(); g.arc(cx, cy, R, Math.PI, Math.PI * 2, false); g.strokePath();
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      g.lineBetween(cx + Math.cos(a) * R, cy + Math.sin(a) * R,
        cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8));
    }

    // 参考程序指针（辅助线，S1 §3.5 / 概念 §5.2 减压阀）——灰色，代表"教科书弹道"目标
    if (flying) {
      const [rx, ry] = polar(m.refThetaDeg);
      g.lineStyle(2, C.P2, 0.85);
      g.lineBetween(cx, cy, cx + rx * (R - 6), cy + ry * (R - 6));
      g.fillStyle(C.P2, 0.9); g.fillCircle(cx + rx * (R - 6), cy + ry * (R - 6), 3);
    }

    // 实际姿态指针（琥珀）
    const [ax, ay] = polar(m.thetaDeg);
    g.lineStyle(3, C.A1, 1);
    g.lineBetween(cx, cy, cx + ax * (R - 3), cy + ay * (R - 3));

    // ── 配平代价条：|α| 越大 → Cd 越大 → 阻力越贵 ──
    const bx = cx - 84, by = cy + 76, bw = 168, bh = 9;
    const aAbs = Math.abs(m.alphaDeg);
    // 代价色：Cd×1.0(α0°)→1.3(10°)→1.9(20°)…
    const col = aAbs < 10 ? C.A2 : aAbs < 22 ? C.A1 : C.DANGER;
    g.fillStyle(C.P2, 0.25); g.fillRect(bx, by, bw, bh);
    g.fillStyle(col, 0.95); g.fillRect(bx, by, bw * Phaser.Math.Clamp(aAbs / 30, 0, 1), bh);
    // 代价刻度 5°/10°/20°（对应 Cd ×1.06 / ×1.24 / ×1.94，S4 §3.2）
    g.lineStyle(1, C.P3, 0.9);
    for (const d of [5, 10, 20]) { const x = bx + bw * (d / 30); g.lineBetween(x, by, x, by + bh); }

    this.thetaText.setText(`θ ${fmt(m.thetaDeg, 1)}°   α ${fmt(m.alphaDeg, 1)}°`).setColor(col);
    this.aoaText.setText(`参考 ${fmt(m.refThetaDeg, 1)}°   Cd ×${fmt(m.cdRatio, 2)}`);
    this.costText.setText(`阻力 ${fmt(m.dragFracThrust * 100, 1)}% 推力   气动损失 Δv ${fmt(m.dvDrag, 0)} m/s`);
  }

  _updatePanel(m) {
    if (m.outcome === null) { this.panelContainer.setVisible(false); return; }
    if (m.outcome === 'SUCCESS' && this.sim.judgeFreezeT < 1.4) { this.panelContainer.setVisible(false); return; }
    if (m.outcome === 'FAILURE' && m.timeSinceFailure < 1.70) { this.panelContainer.setVisible(false); return; }

    this.panelContainer.setVisible(true);
    if (m.outcome === 'SUCCESS') {
      const s = m.summary;
      const rating = m.judgement === Judgement.PRECISE ? 'PRECISE ORBIT' : 'ORBITAL';
      this.panelTitle.setText(`● ${rating}`).setColor(TXT.SUCCESS);
      this.panelBody.setText([
        `入轨精度   ${signed(s.accuracyM)} m`,
        `Δv 余量    ${fmt(s.dvRemain, 0)} m/s · ${fmt(s.fuelRemainKg, 0)} kg`,
        `单局时长   ${fmt(s.flightTime, 1)} s`,
        `近地点     ${fmt(s.periapsis / 1000, 2)} km        远地点 ${fmtApo(s.apoapsis)} km`,
      ].join('\n'));
      this.panelLegend.setVisible(true);
    } else {
      const r = m.failure;
      this.panelTitle.setText(`▲ ${r.title}`).setColor(TXT.DANGER);
      const ev = r.evidence.map((e) => {
        const mark = e.verdict === 'BAD' ? '▲' : e.verdict === 'WARN' ? '◆' : '■';
        return `${mark} T+${fmt(e.t, 1)}s   ${e.label}   ${fmt(e.value, 1)} ${e.unit}`;
      }).join('\n');
      this.panelBody.setText([r.primary, '', ev, '', '建议：' + r.fixHint].join('\n'));
      this.panelLegend.setVisible(false);
    }
  }
}

function fmt(x, d) { if (!Number.isFinite(x)) return '--.-'; if (Math.abs(x) < 1e-3) return '0'; return x.toFixed(d); }
function signed(x) { if (!Number.isFinite(x)) return '--.-'; return (x >= 0 ? '+' : '') + x.toFixed(0); }
function fmtApo(x) { if (!Number.isFinite(x)) return '∞'; return (x / 1000).toFixed(0); }
