// 玩家控制：换道 / 跳跃 / 翻滚 / 受击 / 计分 / 胜负判定
import * as THREE from 'three';
import { CFG } from './config.js';
import { State, emit } from './state.js';
import { audio } from './audio.js';

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

export class Player {
  constructor(spawner) {
    this.spawner = spawner;
    this.reset();
  }

  reset() {
    this.lane = 1;
    this.laneFrom = 1;
    this.laneTo = 1;
    this.laneT = 1;
    this.x = CFG.lanes[1];
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.coyote = 0;
    this.rollT = 0;
    this.stumbleT = 0;
    this.invincibleT = 0;
    this.z = 0;
    this.speed = CFG.speedStart;
    this.time = 0;
    this.hearts = CFG.hearts;
    this.dead = false;
    this.won = false;
    this.coinCombo = 0;
    this.comboT = 0;
    this._blinkT = 0;
  }

  get height() { return this.rollT > 0 ? CFG.playerRollHeight : CFG.playerHeight; }
  get box() {
    return { x: this.x, y: this.y, z: this.z, h: this.height };
  }

  action(a) {
    if (a === 'left' || a === 'right') {
      const dir = a === 'left' ? -1 : 1;
      const target = THREE.MathUtils.clamp(this.laneTo + dir, 0, 2);
      if (target !== this.laneTo) {
        this.laneFrom = this.laneTo;
        this.laneTo = target;
        this.laneT = 0;
        this.lane = target;
        audio.whoosh();
      }
    } else if (a === 'jump') {
      if (this.grounded || this.coyote > 0) {
        this.vy = CFG.jumpVel;
        this.grounded = false;
        this.coyote = 0;
        this.rollT = 0;
        audio.jump();
        emit('player-jump', null);
      }
    } else if (a === 'roll') {
      if (this.grounded) {
        this.rollT = CFG.rollTime;
        audio.whoosh();
        emit('player-roll', null);
      } else {
        // 空中下压，落地自动接翻滚
        this.vy = Math.min(this.vy, -22);
        this._slamRoll = true;
      }
    }
  }

  update(dt) {
    this.time += dt;
    // 速度
    const target = Math.min(CFG.speedMax, CFG.speedStart + CFG.speedRamp * this.time);
    this.speed += (target - this.speed) * Math.min(1, dt * CFG.speedRecover);
    State.speed = this.speed;

    // 前进
    this.z += this.speed * dt;
    State.distance = this.z;

    // 换道
    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / CFG.laneSwitchTime);
      const e = easeOutCubic(this.laneT);
      this.x = CFG.lanes[this.laneFrom] + (CFG.lanes[this.laneTo] - CFG.lanes[this.laneFrom]) * e;
    } else {
      this.x = CFG.lanes[this.laneTo];
    }

    // 重力
    if (!this.grounded) {
      this.vy -= CFG.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        audio.land();
        emit('player-land', null);
        // 空中下压落地 → 自动接个小翻滚
        if (this._slamRoll) {
          this.rollT = Math.max(this.rollT, 0.35);
          this._slamRoll = false;
        }
      }
    } else {
      this.coyote = 0.08;
    }
    if (!this.grounded) this.coyote = Math.max(0, this.coyote - dt);

    // 计时器
    if (this.rollT > 0) this.rollT = Math.max(0, this.rollT - dt);
    if (this.stumbleT > 0) this.stumbleT = Math.max(0, this.stumbleT - dt);
    if (this.invincibleT > 0) this.invincibleT = Math.max(0, this.invincibleT - dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.coinCombo = 0; }

    // 无敌闪烁
    this._blinkT += dt;
    this.blinkVisible = this.invincibleT <= 0 || (Math.floor(this._blinkT * 12) % 2 === 0);

    // 碰撞
    const res = this.spawner.checkCollisions(this.box);
    if (res.coins > 0) {
      this.coinCombo += res.coins;
      this.comboT = 1.4;
      State.coins += res.coins;
      State.score += res.coins * CFG.coinValue;
      audio.coin(this.coinCombo);
      emit('coin', { x: this.x, y: this.y + 1, z: this.z, n: res.coins });
    }
    if (res.nearMiss) {
      State.score += CFG.nearMissBonus;
      State.stats.nearMiss++;
      emit('near-miss', null);
    }
    if (res.hit && this.invincibleT <= 0 && !this.dead) {
      this._onHit(res.hit);
    }

    // 分数（距离）
    State.score += this.speed * dt * CFG.scorePerMeter;

    // 胜利判定
    if (!this.won && this.z >= CFG.goalDistance - CFG.catchWindow) {
      this.won = true;
      emit('win', null);
    }
  }

  _onHit(obstacle) {
    if (this.dead) return;
    this.hearts--;
    State.hearts = this.hearts;
    State.stats.hits++;
    this.invincibleT = CFG.invincibleTime;
    this.stumbleT = 0.5;
    this.speed *= CFG.speedHitFactor;
    audio.hit();
    emit('hit', { x: this.x, y: this.y + 0.9, z: this.z, type: obstacle.type });
    if (this.hearts <= 0) {
      this.hearts = 0;
      State.hearts = 0;
      this.dead = true;
      emit('dead', null);
    }
  }

  // 供动画读取
  animState() {
    return {
      grounded: this.grounded,
      vy: this.vy,
      rolling: this.rollT > 0,
      stumble: this.stumbleT,
      laneTilt: (this.laneTo - this.laneFrom) * Math.sin(Math.PI * Math.min(1, this.laneT)) * CFG.laneTilt,
      speedRatio: THREE.MathUtils.clamp((this.speed - CFG.speedStart) / (CFG.speedMax - CFG.speedStart), 0, 1),
      footstep: (right) => audio.footstep(right),
    };
  }
}
