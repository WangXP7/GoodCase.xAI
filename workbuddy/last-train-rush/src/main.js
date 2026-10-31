// 入口：组装场景、游戏循环、阶段状态机、输入接线、测试钩子
import * as THREE from 'three';
import { CFG, COLORS } from './config.js';
import { State, setPhase, resetRun, loadBest, loadMuted, setMuted, on, emit, saveBest } from './state.js';
import { Input, setupTouchUI } from './input.js';
import { audio } from './audio.js';
import { World } from './world.js';
import { LastTrain } from './train.js';
import { Character } from './character.js';
import { Spawner } from './spawner.js';
import { Player } from './player.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.isTouch = setupTouchUI();
    const dpr = Math.min(window.devicePixelRatio || 1, this.isTouch ? 1.5 : 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(innerWidth, innerHeight, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.fog);
    this.scene.fog = new THREE.FogExp2(COLORS.fog, 0.010);

    this.camera = new THREE.PerspectiveCamera(CFG.camFov, innerWidth / innerHeight, 0.1, 900);
    this.camera.position.set(CFG.camPos.x, CFG.camPos.y, CFG.camPos.z);

    // 世界
    this.world = new World(this.scene);
    this.train = new LastTrain(this.scene);
    this.character = new Character();
    this.scene.add(this.character.root);
    // 假阴影（贴地圆盘）
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);

    this.spawner = new Spawner(this.scene);
    this.player = new Player(this.spawner);
    this.fx = new FX(this.scene);
    this.hud = new HUD();

    // 输入
    this.input = new Input();
    this.input.onAction(a => this._onAction(a));

    // 事件
    this._bindGameEvents();

    // 状态
    loadBest();
    loadMuted();
    this._syncMuteBtn();
    this.virtualZ = 0;        // 菜单 attract 模式的虚拟前进
    this._milestoneHit = new Set();
    this._camRoll = 0;        // 相机屏幕空间滚转（rotateZ 施加，勿用 rotation.z）
    this._fpsAcc = 0; this._fpsN = 0; this._fpsCheck = 0; this._lowFps = 0;

    this._resize();
    addEventListener('resize', () => this._resize());

    // 启动
    this.clock = new THREE.Clock();
    setPhase('menu');
    document.getElementById('boot')?.classList.add('gone');
    setTimeout(() => document.getElementById('boot')?.remove(), 600);

    this.renderer.setAnimationLoop(() => this._frame());

    // 测试钩子
    window.__game = {
      State, player: this.player,
      start: () => this._start(),
      action: a => this._onAction(a),
      warp: (z) => { this.player.z = z; State.distance = z; this.spawner.cursor = z + 60; },
      debugHit: () => this.player._onHit({ type: 'test' }),
      debugObstacle: (type, lane, ahead) => this.spawner._spawnObstacle(type, lane, this.player.z + ahead),
      debugCoins: (n) => this.spawner._spawnCoinLine(this.player.lane, this.player.z + 8, n),
      debugCoinsOnLane: (lane, n) => this.spawner._spawnCoinLine(lane, this.player.z + 10, n),
      debugSpeed: (v) => { this.player.speed = v; },
      spawner: this.spawner,
      project: (x, y, z) => {
        const v = new THREE.Vector3(x, y, z);
        v.project(this.camera);
        const c = this.camera;
        return {
          ndcX: +v.x.toFixed(4), ndcY: +v.y.toFixed(4),
          camPos: [c.position.x, c.position.y, c.position.z].map(n => +n.toFixed(3)),
          camQuat: [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w].map(n => +n.toFixed(4)),
          proj: [c.projectionMatrix.elements[0], c.projectionMatrix.elements[5], c.projectionMatrix.elements[8], c.projectionMatrix.elements[9]].map(n => +n.toFixed(4)),
          fov: c.fov, aspect: +c.aspect.toFixed(3),
        };
      },
      snapshot: () => ({
        phase: State.phase, score: Math.round(State.score), coins: State.coins,
        hearts: State.hearts, distance: Math.round(State.distance),
        speed: +State.speed.toFixed(2), fps: this._fps,
      }),
    };
  }

  _bindGameEvents() {
    on('coin', e => this.fx.burst('gold', e.x, e.y, e.z, 8, 2.2, 2.6));
    on('hit', e => {
      this.fx.burst('hit', e.x, e.y, e.z, 14, 4, 4);
      this.fx.burst('dust', e.x, e.y - 0.6, e.z, 10, 3, 2);
      this.fx.shake(0.75);
    });
    on('player-land', () => {
      if (this.player.vy === 0 && this.player.y === 0) this.fx.burst('dust', this.player.x, 0.1, this.player.z, 7, 1.8, 1.2);
    });
    on('player-jump', () => this.fx.burst('dust', this.player.x, 0.08, this.player.z, 6, 1.6, 1.0));
    on('player-roll', () => this.fx.burst('dust', this.player.x, 0.08, this.player.z, 10, 2.2, 1.4));
    on('dead', () => this._onDead());
    on('win', () => this._onWin());
    on('ui-action', a => this._onUiAction(a));
    on('blur', () => { if (State.phase === 'playing') setPhase('paused'); });
  }

  _onUiAction(a) {
    if (a === 'start') this._start();
    else if (a === 'restart') this._start();
    else if (a === 'menu') { setPhase('menu'); this._resetAll(); }
    else if (a === 'resume') setPhase('playing');
    else if (a === 'pause') { if (State.phase === 'playing') setPhase('paused'); }
    else if (a === 'mute') { setMuted(!State.muted); this._syncMuteBtn(); }
  }

  _syncMuteBtn() {
    const on = document.getElementById('ic-sound');
    const off = document.getElementById('ic-mute');
    if (on) on.style.display = State.muted ? 'none' : '';
    if (off) off.style.display = State.muted ? '' : 'none';
  }

  _onAction(a) {
    if (a === 'blur') { if (State.phase === 'playing') setPhase('paused'); return; }
    audio.ensure();
    if (a === 'mute') { setMuted(!State.muted); this._syncMuteBtn(); return; }
    if (State.phase === 'menu' && (a === 'start' || a === 'jump')) { this._start(); return; }
    if ((State.phase === 'dead' || State.phase === 'win') && (a === 'restart' || a === 'start' || a === 'jump')) { this._start(); return; }
    if (State.phase === 'paused' && (a === 'pause' || a === 'start' || a === 'jump')) { setPhase('playing'); return; }
    if (State.phase !== 'playing') return;
    if (a === 'pause') { setPhase('paused'); return; }
    this.player.action(a);
  }

  _start() {
    audio.ensure();
    this._resetAll();
    setPhase('playing');
  }

  _resetAll() {
    resetRun();
    this.player.reset();
    this.spawner.reset();
    this.world.reset();
    this.train.reset();
    this.fx.reset();
    this._milestoneHit.clear();
    this.virtualZ = 0;
  }

  _onDead() {
    audio.stopMusic();
    audio.lose();
    saveBest(State.score);
    setPhase('dead');
  }

  _onWin() {
    audio.stopMusic();
    audio.win();
    saveBest(State.score);
    this.fx.burst('gold', this.player.x, this.player.y + 1.4, this.player.z, 40, 5, 6);
    this.fx.burst('teal', this.player.x, this.player.y + 1.8, this.player.z, 30, 5, 6);
    setPhase('win');
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const portrait = h > w;
    this.camera.fov = portrait ? CFG.camFovPortrait : CFG.camFov;
    this.camera.updateProjectionMatrix();
    this._portrait = portrait;
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const phase = State.phase;

    // FPS 统计 + 降级
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 1) {
      this._fps = Math.round(this._fpsN / this._fpsAcc);
      this._fpsAcc = 0; this._fpsN = 0;
      if (phase === 'playing' && this._fps < 32) {
        this._lowFps++;
        if (this._lowFps >= 2 && this.renderer.getPixelRatio() > 1) {
          this.renderer.setPixelRatio(1);
        }
      } else this._lowFps = 0;
    }

    if (phase === 'playing') {
      this.player.update(dt);
      const diff = Math.min(1, State.distance / 1700);
      this.spawner.update(dt, this.player.z, diff, this.player.x);
      this._milestones(diff);
      audio.setTempo(96 + State.speed / CFG.speedMax * 62);
    } else if (phase === 'menu') {
      // 吸引模式：世界缓慢滚动，角色原地跑
      this.virtualZ += 7 * dt;
      this.character.update(dt, {
        grounded: true, vy: 0, rolling: false, stumble: 0,
        laneTilt: Math.sin(this.virtualZ * 0.3) * 0.06,
        speedRatio: 0.1,
        footstep: () => { },
      });
      this.character.setPosition(0, 0, 0);
      this.world.update(dt, this.virtualZ);
      this.train.update(dt, this.virtualZ, Math.max(0, CFG.goalDistance - this.virtualZ));
      this._menuCamera(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // 角色与阴影
    const ps = this.player.animState();
    this.character.update(dt, ps);
    this.character.root.visible = phase !== 'playing' || this.player.blinkVisible;
    this.character.setPosition(this.player.x, this.player.y, this.player.z);
    this.shadow.position.set(this.player.x, 0.02, this.player.z);
    const shScale = Math.max(0.35, 1 - this.player.y * 0.28);
    this.shadow.scale.setScalar(shScale);
    this.shadow.material.opacity = 0.42 * shScale;

    // 世界
    this.world.update(dt, this.player.z);
    const remaining = Math.max(0, CFG.goalDistance - this.player.z);
    this.train.update(dt, this.player.z, remaining);

    // 特效 + 相机
    const speedRatio = ps.speedRatio;
    this.fx.update(dt, this.camera, this.player.z, phase === 'playing' ? speedRatio : 0.05);
    this._playCamera(dt, speedRatio);

    this.hud.update();
    this.renderer.render(this.scene, this.camera);
  }

  _milestones(diff) {
    const remaining = CFG.goalDistance - State.distance;
    const marks = [
      [CFG.goalDistance * 0.5, '末班车还有一半路程！'],
      [600, '！！末班车就在前方！！'],
      [250, '能看见车门了——冲！'],
    ];
    for (const [d, txt] of marks) {
      if (remaining <= d && !this._milestoneHit.has(d)) {
        this._milestoneHit.add(d);
        emit('milestone', txt);
        audio.horn();
      }
    }
  }

  _playCamera(dt, speedRatio) {
    const p = this.player;
    const camBase = this._portrait ? CFG.camPosPortrait : CFG.camPos;
    const targetX = p.x * 0.55;
    const targetY = camBase.y + p.y * 0.32;
    const targetZ = p.z + camBase.z;
    const k = Math.min(1, dt * CFG.camLag);
    this.camera.position.x += (targetX - this.camera.position.x) * k;
    this.camera.position.y += (targetY - this.camera.position.y) * k;
    this.camera.position.z += (targetZ - this.camera.position.z) * k;
    // 看向玩家前方
    this._lookTarget = this._lookTarget || new THREE.Vector3();
    this._lookTarget.set(p.x * 0.3, CFG.camLook.y + p.y * 0.3, p.z + CFG.camLook.z);
    this.camera.lookAt(this._lookTarget);
    // 屏幕空间侧倾：必须在 lookAt 之后用 rotateZ 全量施加。
    // ⚠️ 不要改 camera.rotation.z —— 相机偏航 180° 时 lookAt 的 Euler 分解 z=±π，
    // lerp rotation.z 会与分解打架，把相机持续滚转 ~72°（2026-10-22 实测踩坑）。
    const tiltTarget = -p.animState().laneTilt * 0.4;   // 与角色侧倾反向，保持地平线稳定
    this._camRoll += (tiltTarget - this._camRoll) * Math.min(1, dt * 8);
    this.camera.rotateZ(this._camRoll);
    const fovTarget = (this._portrait ? CFG.camFovPortrait : CFG.camFov) + speedRatio * CFG.fovKick;
    if (Math.abs(this.camera.fov - fovTarget) > 0.1) {
      this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }

  _menuCamera(dt) {
    const t = this.virtualZ * 0.05;
    const r = 8.6;
    this.camera.position.set(
      Math.sin(t) * r * 0.55,
      4.0 + Math.sin(t * 0.7) * 0.5,
      Math.cos(t) * r
    );
    this.camera.lookAt(0, 1.35, 0.6);
    this.camera.fov = this._portrait ? CFG.camFovPortrait : CFG.camFov;
    this.camera.updateProjectionMatrix();
  }
}

// 启动
try {
  new Game();
} catch (err) {
  console.error('boot failed', err);
  const bootText = document.getElementById('boot-text');
  if (bootText) bootText.textContent = '加载失败：' + (err && err.message ? err.message : err);
}
