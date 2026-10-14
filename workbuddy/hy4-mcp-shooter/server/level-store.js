/**
 * level-store.js — 服务端权威关卡状态
 *
 * 对应 UE5 里"编辑器进程持有的那个 Level"。所有 MCP 工具都只改这里的状态，
 * 改完统一广播给浏览器。因为状态集中在一处，撤销/重做、存盘、diff 都变得 trivial。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultLevel, defaultGameplay, sanitizeLevel, expandPattern,
  ENV_PRESETS, PROP_TYPES, ENEMY_TYPES, uid,
} from '../game/src/level.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SAVE_DIR = path.join(__dirname, '..', 'levels');

/** 变更类别 —— 决定给浏览器推哪种消息（避免每次都全量重建） */
export const CHANGE = { ENV: 'env', ACTORS: 'actors', GAMEPLAY: 'gameplay', FULL: 'full' };

export class LevelStore {
  constructor() {
    this.level = defaultLevel();
    this.history = [];
    this.future = [];
    this.telemetry = null;
    this.listeners = new Set();

    // 截图 / 试玩这类"需要浏览器回包"的请求
    this.pendingCapture = null;
    this.pendingPlaytest = null;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(kind, meta = {}) {
    const payload = { level: this.level, kind, tool: meta.tool, detail: meta.detail };
    for (const fn of this.listeners) fn(payload);
  }

  /* ---------------- 历史 ---------------- */

  _snapshot() {
    this.history.push(JSON.parse(JSON.stringify(this.level)));
    if (this.history.length > 60) this.history.shift();
    this.future.length = 0;
  }

  undo() {
    if (!this.history.length) return { ok: false, message: '没有可撤销的操作' };
    this.future.push(JSON.parse(JSON.stringify(this.level)));
    this.level = this.history.pop();
    this.emit(CHANGE.FULL, { tool: 'undo', detail: `回退到 rev ${this.level.meta.revision}` });
    return { ok: true, revision: this.level.meta.revision };
  }

  redo() {
    if (!this.future.length) return { ok: false, message: '没有可重做的操作' };
    this.history.push(JSON.parse(JSON.stringify(this.level)));
    this.level = this.future.pop();
    this.emit(CHANGE.FULL, { tool: 'redo', detail: `前进到 rev ${this.level.meta.revision}` });
    return { ok: true, revision: this.level.meta.revision };
  }

  _bump() { this.level.meta.revision += 1; }

  /* ---------------- 环境美术 ---------------- */

  setEnvironment(patch, tool = 'set_environment') {
    this._snapshot();
    // 传 preset 就整体套用预设，再叠加个别覆盖项
    if (patch.preset && ENV_PRESETS[patch.preset]) {
      const { preset, ...rest } = patch;
      this.level.environment = { ...this.level.environment, ...ENV_PRESETS[preset], ...rest, preset };
    } else {
      this.level.environment = { ...this.level.environment, ...patch };
    }
    this.level = sanitizeLevel(this.level);
    this._bump();
    const e = this.level.environment;
    this.emit(CHANGE.ENV, { tool, detail: `${e.preset} · 日照${e.sunElevation}° · 雾${e.fogDensity}` });
    return this.level.environment;
  }

  /* ---------------- 道具 ---------------- */

  /**
   * 摆放道具。支持两种写法：
   *   A. 显式坐标：{ props:[{type,position,...}] }
   *   B. 布局模式：{ type:'container', pattern:'ring', count:10, radius:24 }
   * B 是关键 —— 让 Agent 用一句话描述"围一圈掩体"，而不是推导 10 组坐标。
   */
  placeProps(spec, tool = 'place_props') {
    this._snapshot();
    const added = [];

    if (Array.isArray(spec.props)) {
      for (const p of spec.props) {
        added.push({
          id: p.id || uid('p'),
          type: PROP_TYPES[p.type] ? p.type : 'crate',
          position: p.position || [0, 1, 0],
          rotation: p.rotation || [0, 0, 0],
          scale: p.scale || [1, 1, 1],
          color: p.color,
        });
      }
    } else {
      const type = PROP_TYPES[spec.type] ? spec.type : 'crate';
      const pts = expandPattern(spec.pattern || 'ring', {
        count: spec.count ?? 8,
        center: spec.center ?? [0, 0],
        radius: spec.radius ?? 20,
        spacing: spec.spacing ?? 7,
        width: spec.width ?? 40,
        height: spec.height ?? 40,
        arcStart: spec.arcStart ?? 0,
        arcEnd: spec.arcEnd ?? Math.PI * 2,
        seed: spec.seed ?? 1337,
        jitter: spec.jitter ?? 0,
      });
      const y = spec.y ?? PROP_TYPES[type].footprint[1] / 2;
      for (const [x, z] of pts) {
        added.push({
          id: uid('p'), type,
          position: [round2(x), y, round2(z)],
          rotation: [0, spec.faceCenter ? Math.atan2(-x, -z) : (spec.rotationY ?? 0), 0],
          scale: spec.scale || [1, 1, 1],
          color: Array.isArray(spec.colors)
            ? spec.colors[added.length % spec.colors.length]
            : spec.color,
        });
      }
    }

    this.level.props = this.level.props.concat(added).slice(0, 400);
    this.level = sanitizeLevel(this.level);
    this._bump();
    this.emit(CHANGE.ACTORS, { tool, detail: `+${added.length} 道具 → 共 ${this.level.props.length}` });
    return { added: added.length, total: this.level.props.length, ids: added.map((p) => p.id) };
  }

  removeProps(filter = {}) {
    this._snapshot();
    const before = this.level.props.length;
    const ids = new Set(Array.isArray(filter.ids) ? filter.ids : []);
    this.level.props = this.level.props.filter((p) => {
      if (ids.size) return !ids.has(p.id);
      if (filter.type) return p.type !== filter.type;
      return false;
    });
    const removed = before - this.level.props.length;
    this._bump();
    this.emit(CHANGE.ACTORS, { tool: 'remove_props', detail: `-${removed} 道具 → 剩 ${this.level.props.length}` });
    return { removed, total: this.level.props.length };
  }

  /* ---------------- 敌人 ---------------- */

  spawnEnemies(spec, tool = 'spawn_enemies') {
    this._snapshot();
    const added = [];

    if (Array.isArray(spec.enemies)) {
      for (const s of spec.enemies) {
        added.push({
          id: s.id || uid('e'),
          type: ENEMY_TYPES[s.type] ? s.type : 'grunt',
          position: s.position || [0, 0, 0],
          patrol: s.patrol || null,
        });
      }
    } else {
      const type = ENEMY_TYPES[spec.type] ? spec.type : 'grunt';
      const pts = expandPattern(spec.pattern || 'ring', {
        count: spec.count ?? 5,
        center: spec.center ?? [0, 0],
        radius: spec.radius ?? 30,
        spacing: spec.spacing ?? 10,
        width: spec.width ?? 60,
        height: spec.height ?? 60,
        seed: spec.seed ?? 4242,
        jitter: spec.jitter ?? 0,
      });
      const types = Array.isArray(spec.types) ? spec.types : [type];
      pts.forEach(([x, z], i) => {
        const t = types[i % types.length];
        added.push({ id: uid('e'), type: ENEMY_TYPES[t] ? t : 'grunt', position: [round2(x), 0, round2(z)], patrol: null });
      });
    }

    this.level.spawns = this.level.spawns.concat(added).slice(0, 120);
    this.level = sanitizeLevel(this.level);
    this._bump();
    const counts = added.reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m; }, {});
    this.emit(CHANGE.ACTORS, { tool, detail: `+${added.length} 敌人 ${JSON.stringify(counts)}` });
    return { added: added.length, total: this.level.spawns.length, breakdown: counts };
  }

  clearActors({ props = true, enemies = true } = {}) {
    this._snapshot();
    const p = props ? this.level.props.length : 0;
    const e = enemies ? this.level.spawns.length : 0;
    if (props) this.level.props = [];
    if (enemies) this.level.spawns = [];
    this._bump();
    this.emit(CHANGE.ACTORS, { tool: 'clear_actors', detail: `清空 ${p} 道具 / ${e} 敌人` });
    return { clearedProps: p, clearedEnemies: e };
  }

  /* ---------------- 玩法数值 ---------------- */

  setGameplay(patch = {}) {
    this._snapshot();
    const g = this.level.gameplay;
    this.level.gameplay = {
      player: { ...g.player, ...(patch.player || {}) },
      enemies: { ...g.enemies, ...(patch.enemies || {}) },
      waves: { ...g.waves, ...(patch.waves || {}) },
    };
    this.level = sanitizeLevel(this.level);
    this._bump();
    const bits = [];
    if (patch.player) bits.push('玩家');
    if (patch.enemies) bits.push('敌人');
    if (patch.waves) bits.push('波次');
    this.emit(CHANGE.GAMEPLAY, { tool: 'set_gameplay', detail: `调整 ${bits.join('/')} 数值` });
    return this.level.gameplay;
  }

  /* ---------------- 高层：一句话生成完整关卡 ---------------- */

  /**
   * build_arena —— 这是 demo 里"从零做一个射击游戏"真正调用的那个工具。
   * 它把环境美术 + 掩体布局 + 敌人配置 + 玩法数值一次性算好，
   * Agent 只需要给风格与强度，不需要自己推导几百个坐标。
   */
  buildArena({ preset = 'dusk', style = 'industrial', density = 1, difficulty = 1, seed = 20260828 } = {}) {
    this._snapshot();

    const env = ENV_PRESETS[preset] ? preset : 'dusk';
    const arenaSize = 90;
    const half = arenaSize / 2;

    const props = [];
    const push = (type, x, z, ry = 0, color, scale) => {
      const fp = PROP_TYPES[type].footprint;
      props.push({
        id: uid('p'), type,
        position: [round2(x), fp[1] / 2, round2(z)],
        rotation: [0, round2(ry), 0],
        scale: scale || [1, 1, 1],
        color,
      });
    };

    // 1) 围墙（所有风格通用）
    const wallColor = { industrial: '#39424f', military: '#4a4f42', ruins: '#4a4550', outpost: '#3b4652', forest: '#3f4a3a' }[style] || '#39424f';
    for (let i = -2; i <= 2; i++) {
      push('wall', i * 17.6, -half + 1, 0, wallColor, [2.2, 1.15, 1]);
      push('wall', i * 17.6, half - 1, 0, wallColor, [2.2, 1.15, 1]);
      push('wall', -half + 1, i * 17.6, Math.PI / 2, wallColor, [2.2, 1.15, 1]);
      push('wall', half - 1, i * 17.6, Math.PI / 2, wallColor, [2.2, 1.15, 1]);
    }

    // 2) 风格化内容
    const d = Math.max(0.4, Math.min(density, 2.2));
    const nCover = Math.round(9 * d);
    const nDetail = Math.round(10 * d);

    if (style === 'industrial') {
      const cols = ['#6b4a2f', '#2f5a6b', '#5a2f3f', '#3f5a2f', '#6b5a2f'];
      for (let i = 0; i < nCover; i++) {
        const a = (i / nCover) * Math.PI * 2 + 0.3;
        const r = 16 + (i % 3) * 9;
        push('container', Math.cos(a) * r, Math.sin(a) * r, a + 0.4, cols[i % cols.length]);
      }
      for (let i = 0; i < nDetail; i++) {
        const a = (i / nDetail) * Math.PI * 2;
        const r = 30 + (i % 4) * 4;
        push(i % 3 === 0 ? 'barrel' : 'crate', Math.cos(a) * r, Math.sin(a) * r, a, i % 3 === 0 ? '#8a5a2a' : '#5c6675');
      }
      push('platform', 0, -12, 0, '#414a58', [1.6, 1, 1.6]);
      push('ramp', 7.5, -12, -Math.PI / 2, '#4a5462');
      push('tower', -36, 10, 0.3, '#333b47');
      push('tower', 36, -10, -0.4, '#333b47');
      push('antenna', -36, 10, 0, '#6b7280');
      push('antenna', 36, -10, 0, '#6b7280');
    } else if (style === 'military') {
      const cols = ['#4f5245', '#5a5040', '#454f52'];
      for (let i = 0; i < nCover; i++) {
        const a = (i / nCover) * Math.PI * 2;
        const r = 18 + (i % 3) * 8;
        push('wall', Math.cos(a) * r, Math.sin(a) * r, a + Math.PI / 2, cols[i % cols.length], [1.1, 1.2, 1]);
      }
      for (let i = 0; i < nDetail; i++) {
        const a = (i / nDetail) * Math.PI * 2 + 0.5;
        const r = 28 + (i % 3) * 6;
        push('crate', Math.cos(a) * r, Math.sin(a) * r, a, '#5d6047');
      }
      push('platform', -14, -14, 0, '#4a5245', [1.4, 1.2, 1.4]);
      push('platform', 14, 14, 0, '#4a5245', [1.4, 1.2, 1.4]);
      push('tower', -34, -34, 0.2, '#3f4438');
      push('tower', 34, 34, -0.2, '#3f4438');
    } else if (style === 'ruins') {
      for (let i = 0; i < nCover + 4; i++) {
        const a = (i / (nCover + 4)) * Math.PI * 2 + 0.2;
        const r = 14 + (i % 4) * 8;
        push(i % 2 === 0 ? 'pillar' : 'rock', Math.cos(a) * r, Math.sin(a) * r, a, i % 2 === 0 ? '#4a4550' : '#514c46');
      }
      for (let i = 0; i < nDetail; i++) {
        const a = (i / nDetail) * Math.PI * 2;
        const r = 26 + (i % 3) * 7;
        push('rock', Math.cos(a) * r, Math.sin(a) * r, a, '#4d4a44', [0.8 + (i % 3) * 0.4, 1, 0.8 + (i % 2) * 0.5]);
      }
      push('platform', 10, -18, 0.4, '#454050', [1.2, 1, 1.2]);
      push('ramp', 3, -18, -Math.PI / 2, '#4a4550');
    } else if (style === 'outpost') {
      for (let i = 0; i < nCover; i++) {
        const a = (i / nCover) * Math.PI * 2;
        const r = 20;
        push('container', Math.cos(a) * r, Math.sin(a) * r, a + Math.PI / 2, '#3b5163', [0.7, 1.1, 1]);
      }
      for (let i = 0; i < nDetail; i++) {
        const a = (i / nDetail) * Math.PI * 2 + 0.7;
        const r = 32;
        push('crate', Math.cos(a) * r, Math.sin(a) * r, a, '#4a5766');
      }
      push('tower', 0, -30, 0, '#2f3a46', [1.3, 1.2, 1.3]);
      push('antenna', 0, -30, 0, '#7b8590');
      push('platform', 0, 16, 0, '#3d4756', [1.8, 1, 1.8]);
      push('ramp', 8, 16, -Math.PI / 2, '#455060');
    } else { // forest
      for (let i = 0; i < nCover + 6; i++) {
        const a = (i / (nCover + 6)) * Math.PI * 2 + 0.15;
        const r = 12 + (i % 5) * 7;
        push('tree', Math.cos(a) * r, Math.sin(a) * r, a, '#4a4038');
      }
      for (let i = 0; i < nDetail; i++) {
        const a = (i / nDetail) * Math.PI * 2;
        const r = 25 + (i % 3) * 8;
        push(i % 2 === 0 ? 'rock' : 'crate', Math.cos(a) * r, Math.sin(a) * r, a, i % 2 === 0 ? '#4f4c46' : '#4d5a45');
      }
      push('platform', -10, 12, 0, '#404a3e');
    }

    // 3) 灯柱：沿边界布置，夜间氛围的关键
    const lampCount = Math.round(6 * d);
    for (let i = 0; i < lampCount; i++) {
      const a = (i / lampCount) * Math.PI * 2 + 0.4;
      push('lamp', Math.cos(a) * (half - 8), Math.sin(a) * (half - 8), 0, '#ffb765');
    }

    // 4) 敌人：难度曲线决定配置
    const df = Math.max(0.5, Math.min(difficulty, 3));
    const spawns = [];
    const enemyMix = df < 1
      ? ['grunt', 'grunt', 'rusher']
      : df < 1.8
        ? ['grunt', 'rusher', 'sniper', 'grunt']
        : ['grunt', 'rusher', 'sniper', 'tank', 'rusher', 'grunt'];
    const total = Math.round(5 + df * 4);
    for (let i = 0; i < total; i++) {
      const a = (i / total) * Math.PI * 2 + 0.6;
      const r = half - 10 - (i % 3) * 5;
      spawns.push({
        id: uid('e'), type: enemyMix[i % enemyMix.length],
        position: [round2(Math.cos(a) * r), 0, round2(Math.sin(a) * r)],
        patrol: null,
      });
    }

    // 5) 玩法数值随难度缩放
    const gp = defaultGameplay();
    gp.enemies.globalHealthScale = round2(0.75 + df * 0.35);
    gp.enemies.globalSpeedScale = round2(0.85 + df * 0.2);
    gp.enemies.globalDamageScale = round2(0.7 + df * 0.4);
    gp.waves.count = 3 + Math.round(df);
    gp.waves.perWaveBase = 3 + Math.round(df * 2);
    gp.waves.perWaveGrowth = 1 + Math.round(df);

    this.level = sanitizeLevel({
      environment: { ...ENV_PRESETS[env], preset: env, arenaSize },
      props, spawns, gameplay: gp,
      playerStart: [0, 1.7, half - 12],
      meta: { name: `${env} · ${style} · 难度${df}`, author: 'agent', revision: 1 },
    });
    this.level.meta.revision = this.level.meta.revision || 1;
    this._bump();

    this.emit(CHANGE.FULL, {
      tool: 'build_arena',
      detail: `${env}/${style} · ${props.length} 道具 · ${spawns.length} 敌人 · 难度${df}`,
    });

    return {
      preset: env, style, density: d, difficulty: df,
      props: props.length, enemies: spawns.length,
      enemyMix: spawns.reduce((m, s) => { m[s.type] = (m[s.type] || 0) + 1; return m; }, {}),
    };
  }

  /* ---------------- 存盘 / 读档 ---------------- */

  save(name) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    const file = path.join(SAVE_DIR, `${sanitizeFileName(name || this.level.meta.name)}.json`);
    fs.writeFileSync(file, JSON.stringify(this.level, null, 2), 'utf8');
    return { file, bytes: fs.statSync(file).size };
  }

  load(name) {
    const file = path.join(SAVE_DIR, `${sanitizeFileName(name)}.json`);
    if (!fs.existsSync(file)) return { ok: false, message: `找不到关卡 ${name}` };
    this._snapshot();
    this.level = sanitizeLevel(JSON.parse(fs.readFileSync(file, 'utf8')));
    this.emit(CHANGE.FULL, { tool: 'load_level', detail: `载入 ${name}` });
    return { ok: true, name };
  }

  list() {
    if (!fs.existsSync(SAVE_DIR)) return [];
    return fs.readdirSync(SAVE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  }

  /* ---------------- 遥测 ---------------- */

  setTelemetry(t) { this.telemetry = { ...t, at: Date.now() }; }
  getTelemetry() { return this.telemetry; }
}

function round2(v) { return Math.round(v * 100) / 100; }
function sanitizeFileName(n) { return String(n).replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 60); }
