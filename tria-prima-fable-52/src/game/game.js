// Tria Prima: the game itself. Owns every system, the modes, the frame and the save.
//
//   const game = await createGame(canvas);   // builds the island under the loading veil
//   game.frame(dt);                          // once per animation frame
//
// What the UI and the other systems read from here is docs/DESIGN.md section 5.
import * as THREE from 'three';
import * as data from './data.js';
import { createState, createBrew, SAVE_VERSION, count, add } from './state.js';
import { bus } from '../core/events.js';
import { clamp, damp, lerp, smoothstep, easeInOutCubic } from '../core/math.js';
import { Engine } from '../gfx/engine.js';
import { Particles } from '../gfx/particles.js';
import { Icons } from '../gfx/icons.js';
import { createWorld } from '../world/world.js';
import { drawMap } from '../world/mapimage.js';
import { WORLD, SCAR, RIVER } from '../world/heightmap.js';
import { Physics } from '../physics/physics.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Fx } from './fx.js';
import { Entities } from './entities.js';
import { Potions } from './potions.js';
import { Shades } from './shades.js';
import { Brewing } from './brewing.js';
import { Quests } from './quests.js';
import { Ambient } from './ambient.js';
import { createAudio } from '../audio/index.js';
import { createUI } from '../ui/index.js';

const SAVE_KEY = 'tria-prima.save.v1';
const SETTINGS_KEY = 'tria-prima.settings.v1';
const DEFAULTS = { quality: 'high', renderScale: 1, fov: 72, sensitivity: 1, invertY: false, master: 0.8, music: 0.7, sfx: 0.9, shake: true, grain: true, hints: true, autoQuality: true };
const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

const HOUR_SECONDS = 110; // one hour of the isle's day, in seconds of play
const START_HOUR = 16.2;
const TITLE_HOUR = 19.35;

// The air of each place: what the sky drifts toward while the apprentice stands there, and what
// the Gloom does to it while it still lies on the land.
const CLEAR = [1, 1, 1];
const WEATHER = {
  shore: { overcast: 0.7, fog: 0.38, wind: 0.5, tint: CLEAR, dim: 1 },
  vale: { overcast: 0.62, fog: 0.32, wind: 0.35, tint: CLEAR, dim: 1 },
  heights: { overcast: 0.55, fog: 0.22, wind: 0.7, tint: CLEAR, dim: 1 },
  saltwood: { overcast: 0.5, fog: 0.4, wind: 0.3, tint: CLEAR, dim: 1, gloom: { overcast: 0.9, fog: 0.8, tint: [0.86, 0.8, 1.0], dim: 0.75 } },
  mere: { overcast: 0.45, fog: 0.5, wind: 0.2, tint: CLEAR, dim: 1, gloom: { overcast: 0.85, fog: 0.9, tint: [0.8, 0.9, 1.0], dim: 0.8 } },
  scar: { overcast: 0.6, fog: 0.35, wind: 0.4, tint: [1.1, 0.95, 0.85], dim: 1, gloom: { overcast: 0.95, fog: 0.65, tint: [1.25, 0.8, 0.6], dim: 0.8 } },
};
const MOOD = { shore: 'vale', vale: 'vale', saltwood: 'saltwood', mere: 'mere', scar: 'scar', heights: 'heights' };
// The pieces that belong to a place or an hour. Between two of them the score waits until the new
// one has held for a while: a walk along a border must not start a tune over at every step.
const PLACE_MOODS = new Set(['vale', 'saltwood', 'mere', 'scar', 'heights', 'night']);
const MOOD_DWELL = 6; // seconds

const store = {
  get(k) {
    try {
      return window.localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      window.localStorage.setItem(k, v);
      return true;
    } catch (e) {
      return false;
    }
  },
  del(k) {
    try {
      window.localStorage.removeItem(k);
    } catch (e) {
      /* nothing to forget */
    }
  },
};

function merge(base, src) {
  for (const k in src) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], v);
    else base[k] = v;
  }
  return base;
}
function loadSettings() {
  const s = { ...DEFAULTS };
  try {
    const raw = store.get(SETTINGS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      for (const k in DEFAULTS) if (typeof o[k] === typeof DEFAULTS[k]) s[k] = o[k];
    }
  } catch (e) {
    /* defaults */
  }
  if (QUALITY_ORDER.indexOf(s.quality) < 0) s.quality = 'high';
  s.renderScale = clamp(s.renderScale, 0.5, 1);
  s.fov = clamp(s.fov, 60, 100);
  s.sensitivity = clamp(s.sensitivity, 0.2, 3);
  return s;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = [0, 0, 0];
const _ro = {};

export async function createGame(canvas, opts = {}) {
  const game = new Game(canvas, opts);
  await game.init();
  return game;
}

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.data = data;
    this.bus = bus;
    this.settings = loadSettings();
    if (opts.quality) this.settings.quality = opts.quality;
    this.state = createState();
    this.brew = createBrew();
    this.hud = { focus: null, crosshair: 'none', compass: { heading: 0, marks: [] }, region: null, gloom: 0, hint: '', held: null, carrying: false, time: START_HOUR };
    this.map = { canvas: null, size: 768, toUV: (x, z) => [(x + WORLD.half) / WORLD.size, (z + WORLD.half) / WORLD.size], player: { x: 0, z: 0, yaw: 0 }, marks: [] };
    this.icons = { get: () => null };
    this.after = []; // { t, fn, wait }: things that happen a little later
    this.reading = null; // lore id while the reader is open
    this.frost = 0;
    this.region = null;
    this.ready = false;
    this.manual = !!opts.manual; // frames are stepped by a test, not by the clock
    this.god = false;
    this.endgame = { begin: () => this._beginEnding() };
    this.actions = this._actions();

    this._say = { text: '', t: 0 };
    this._fade = { v: 1, to: 1, speed: 1, fn: null };
    this._cut = null; // { kind: 'intro' | 'ending' | 'travel', t, ... }
    this._busy = false;
    this._lifts = [];
    this._hurt = { acc: 0, t: 0, since: 99, flash: 0 };
    this._gloomHere = 0;
    this._regionT = 0;
    this._regionSaid = {};
    this._water = 0;
    this._saveT = 0;
    this._slow = 0;
    this._ft = 1 / 60;
    this._hold = 3;
    this._titleT = 0;
    this._dead = 0;
    this._musicT = 0;
    this._mood = 'none'; // the piece the score was last asked for
    this._moodHeld = 0; // seconds another place's piece has been wanted instead
    this._inGloom = false;
    this._loops = { lava: null, river: null, levity: null };
    this._photo = null;
    this._cleared = 0;

    this.audio = createAudio();
    this._applyVolumes();
    this.ui = createUI(this, { loading: true });
    this._wireDom();
  }

  // ================================================================================ building
  async init() {
    const s = this.settings;
    const tick = async (p, label) => {
      this.bus.emit('loading', { progress: Math.min(0.94, p * 0.94), label });
      await new Promise((r) => setTimeout(r, 0));
    };
    await tick(0, 'Raising the island');
    const e = (this.engine = new Engine(this.canvas, { quality: s.quality, renderScale: s.renderScale }));
    e.setFov(s.fov);
    e.post.grade.fade = 1;
    this._grain = e.post.grade.grain;
    this.world = await createWorld(e, tick);
    this.particles = new Particles(e);
    this.physics = new Physics(this.world.T, this.world.collision);
    this.input = new Input(this.canvas);
    this.input.onUnlock = () => {
      const m = this.state.mode;
      if (m === 'play' && !this.reading && !this._busy) this.actions.pause();
      else if (m === 'photo') this.actions.photo(false);
    };
    this.player = new Player(this);
    this.fx = new Fx(this);
    this.ents = new Entities(this);
    this.potions = new Potions(this);
    this.shades = new Shades(this);
    this.brewing = new Brewing(this);
    this.quests = new Quests(this);
    this.ambient = new Ambient(this);
    await tick(0.95, 'Lighting the lamps');
    this.ents.build();
    this.shades.build();
    this.brewing.build();
    this.ambient.build();
    await tick(0.97, 'Inking the chart');
    this.map.canvas = drawMap(this.world.T, this.map.size);
    await tick(0.985, 'Setting the table');
    // the pictures of things are taken under a plain noon sky
    e.hour = 13;
    e.update(0.016);
    e.sky.updateEnvironment(e.scene, true);
    try {
      const icons = new Icons(e);
      icons.renderAll(data);
      this.icons = icons;
    } catch (err) {
      console.error('[icons] ' + err.message);
    }
    this._applyGrade();
    this.ents.reset();
    this.quests.reset();
    this.ready = true;
    this._toTitle(true);
    // let the first frames compile their shaders under the veil
    for (let i = 0; i < 3; i++) this.frame(1 / 60);
    await new Promise((r) => setTimeout(r, 0));
    this.bus.emit('loading', { progress: 1, label: '' });
  }

  _wireDom() {
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    // the voice of the menus
    const root = document.getElementById('ui');
    if (root) {
      let last = null;
      root.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest('button')) this.audio.sfx('ui_click');
      });
      root.addEventListener('pointerover', (e) => {
        const b = e.target instanceof Element ? e.target.closest('button') : null;
        if (b && b !== last) this.audio.sfx('ui_hover', { gain: 0.5 });
        last = b;
      });
    }
    window.addEventListener('pagehide', () => this.save(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.save(true);
        if (this.state.mode === 'play' && !this.reading && !this.manual) this.actions.pause();
      }
    });
  }

  // ================================================================================ small services
  toast(kind, title, text, icon) {
    this.bus.emit('toast', { kind, title, text, icon });
  }
  /** One line under the crosshair for a few seconds. */
  say(text, seconds = 4.5) {
    this._say.text = text;
    this._say.t = seconds;
  }
  shake(a) {
    if (this.settings.shake && this.player) this.player.shake = Math.max(this.player.shake, a);
  }
  hurt(amount, cause) {
    const st = this.state;
    if (!(amount > 0) || this.god) return;
    if ((st.mode !== 'play' && st.mode !== 'brew') || st.player.hp <= 0 || this._busy) return;
    st.player.hp = Math.max(0, st.player.hp - amount);
    this._hurt.acc += amount;
    this._hurt.since = 0;
    this._hurt.flash = Math.min(1, Math.max(this._hurt.flash, 0.2 + amount / 28));
    if (st.player.hp <= 0) this._die(cause);
  }
  heal(amount) {
    const p = this.state.player;
    const was = p.hp;
    p.hp = Math.min(p.hpMax, p.hp + amount);
    if (p.hp > was + 0.01) this.bus.emit('heal', { amount: p.hp - was, hp: p.hp });
  }
  /** The Gloom over a region goes back into the ground. */
  liftGloom(region) {
    const g = this.state.world.gloom;
    if (!(g[region] > 0)) return;
    if (this._lifts.some((l) => l.region === region)) return;
    this._lifts.push({ region, t: 0 });
    this.audio.sfx('gloom_lift');
    this.bus.emit('gloom:lift', { region });
  }
  fadeTo(to, seconds, fn = null) {
    const f = this._fade;
    f.to = to;
    f.speed = 1 / Math.max(0.01, seconds);
    f.fn = fn;
  }
  setMode(to, extra = null) {
    const st = this.state,
      from = st.mode;
    if (from === to) return;
    st.mode = to;
    if (this.input) {
      this.input.active = to === 'play' || to === 'brew' || to === 'photo' || to === 'cutscene';
      this.input.clear();
    }
    this.audio.setPaused(to === 'pause' || to === 'book');
    this._hold = 3;
    this.bus.emit('mode', { from, to, ...(extra || {}) });
  }

  // ================================================================================ actions (the UI calls these)
  _actions() {
    const g = this;
    return {
      hasSave: () => !!g._readSave(),
      newGame: () => g._start(null),
      continueGame: () => g._start(g._readSave()),
      pause() {
        if (g.state.mode !== 'play') return;
        g.setMode('pause');
        g.input.releaseLock();
        g.save(true);
      },
      resume() {
        const m = g.state.mode;
        if (g._cut && g._cut.kind === 'ending') {
          if (g._cut.phase === 'credits') g.input.requestLock();
          return g._endEnding();
        }
        if (m === 'pause' || m === 'book') {
          g.setMode('play');
          g.input.requestLock();
        }
      },
      quitToTitle() {
        if (g.state.mode === 'title') return;
        g._returnBrew();
        g.save(true);
        g.input.releaseLock();
        g._toTitle(false);
      },
      openBook(tab) {
        if (g.state.mode !== 'play' || g.reading || g._busy) return;
        g.setMode('book', tab ? { tab } : null);
        g.input.releaseLock();
        g.audio.sfx('ui_open');
      },
      closeBook() {
        if (g.state.mode !== 'book') return;
        g.setMode('play');
        g.input.requestLock();
        g.audio.sfx('ui_close');
      },
      selectPotion: (id) => g.potions.select(id),
      setSetting: (key, value) => g._setSetting(key, value, true),
      brewAdd: (id) => g.brewing.add(id),
      brewPump: (on) => g.brewing.pump(on),
      brewDamp: (on) => g.brewing.damp(on),
      brewBottle: () => g.brewing.bottle(),
      brewEmpty: () => g.brewing.empty(),
      brewLeave: () => g.brewing.leave(),
      travel: (id) => g._travel(id),
      respawn: () => g._respawn(),
      photo(on) {
        const m = g.state.mode;
        if (on && m === 'play' && !g.reading && !g._busy) {
          const c = g.engine.camera;
          g._photo = { x: c.position.x, y: c.position.y, z: c.position.z, heading: g.player.heading, pitch: g.player.pitch, fov: g.settings.fov, hide: false };
          g.setMode('photo');
        } else if (!on && m === 'photo') {
          g._photo = null;
          g.engine.setFov(g.settings.fov);
          g.setMode('play');
        }
      },
      readLoreDone() {
        if (!g.reading) return;
        g.reading = null;
        g.input.clear();
        if (g.state.mode === 'play') g.input.requestLock();
        g.quests.check();
      },
    };
  }

  _applyVolumes() {
    const s = this.settings;
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
  }
  _applyGrade() {
    this.engine.post.grade.grain = this.settings.grain ? this._grain : 0;
  }
  _setSetting(key, value, byHand) {
    const s = this.settings;
    if (!(key in DEFAULTS)) return;
    s[key] = value;
    const e = this.engine;
    if (key === 'quality') {
      if (QUALITY_ORDER.indexOf(value) < 0) return;
      if (byHand) s.autoQuality = false;
      if (e) e.setQuality(value);
    } else if (key === 'renderScale') {
      s.renderScale = clamp(Number(value) || 1, 0.5, 1);
      if (e) {
        e.renderScale = s.renderScale;
        e.resize(true);
      }
    } else if (key === 'fov') {
      s.fov = clamp(Number(value) || 72, 60, 100);
      if (e && this.brewing.k <= 0) e.setFov(s.fov);
    } else if (key === 'master' || key === 'music' || key === 'sfx') this._applyVolumes();
    else if (key === 'grain') this._applyGrade();
    store.set(SETTINGS_KEY, JSON.stringify(s));
    this._hold = 3;
    this.bus.emit('settings', { key, value: s[key] });
  }

  // ================================================================================ saving
  _readSave() {
    const raw = store.get(SAVE_KEY);
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (!o || o.v !== SAVE_VERSION || !o.state || !o.state.player) return null;
      return o;
    } catch (e) {
      return null;
    }
  }
  save(quiet) {
    const st = this.state;
    if (!this.ready || st.mode === 'title' || st.mode === 'dead' || st.player.hp <= 0) return false;
    if (this._cut && this._cut.kind !== 'travel') return false;
    const p = this.player;
    Object.assign(st.player, { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.heading, pitch: p.pitch });
    const ok = store.set(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, at: Date.now(), tips: this.quests.save(), state: { ...st, mode: 'play' } }));
    this._saveT = 0;
    if (ok && !quiet) this.bus.emit('save');
    return ok;
  }
  /** What is in the pot goes back in the satchel when the game is put away. */
  _returnBrew() {
    const b = this.brew;
    if (b.ready) this.brewing.bottle();
    else if (!b.opus) for (const id of b.contents) if (!id.startsWith('prime:')) add(this.state.inv.ingredients, id, 1, 99);
    this.brewing.reset();
  }

  /** Put the world in the shape a state describes. */
  _load(save) {
    const fresh = createState();
    if (save) merge(fresh, save.state);
    const st = this.state;
    for (const k in st) delete st[k];
    Object.assign(st, fresh);
    st.mode = 'cutscene';
    Object.assign(this.brew, createBrew());
    this.after.length = 0;
    this.reading = null;
    this.frost = 0;
    this._lifts.length = 0;
    this._say.t = 0;
    this._hurt.acc = 0;
    this._hurt.flash = 0;
    this._hurt.since = 99;
    this._dead = 0;
    this._cleared = st.world.athanor >= 2 ? 1 : 0;
    this._regionSaid = {};
    this.region = null;
    const w = this.world;
    w.fx._clear = true;
    for (const s of w.spots.scorch) w.fx.stamp(s[0], s[1], s[2], 0, s[3]);
    this.ents.reset();
    this.shades.reset();
    this.potions.reset();
    this.brewing.reset();
    this.quests.load(save ? save.tips : null);
    this.quests.reset();
  }

  // ================================================================================ title, start, travel, death
  _toTitle(first) {
    const go = () => {
      this._cut = null;
      this._busy = false;
      this.reading = null;
      this.shades.silence();
      this.setMode('title');
      this.state.mode = 'title';
      this.input.active = false;
      this.engine.hour = TITLE_HOUR;
      Object.assign(this.engine.want, { overcast: 0.42, fog: 0.5, dim: 1, wind: 0.35, lift: 0 });
      this.engine.want.tint.setRGB(1, 1, 1);
      if (first) {
        Object.assign(this.engine.atmo, { overcast: 0.42, fog: 0.5, dim: 1, wind: 0.35, lift: 0 });
        this.engine.atmo.tint.setRGB(1, 1, 1);
      }
      this.fadeTo(0, first ? 2.2 : 1.2);
    };
    if (first) go();
    else {
      this._busy = true;
      this.fadeTo(1, 0.6, go);
    }
  }

  _start(save) {
    if (!this.ready || this._cut) return;
    this.audio.unlock();
    this.input.requestLock();
    this._cut = { kind: save ? 'continue' : 'intro', t: -0.75, save, begun: false };
    this.setMode('cutscene');
    this.fadeTo(1, 0.6);
  }

  /** For tools: a fresh game standing on the dock, no arrival. */
  debugStart(save = null) {
    this._cut = null;
    this._fade.v = this._fade.to = 0;
    this._fade.fn = null;
    this._load(save);
    const L = this.world.layout;
    this.state.time.hour = START_HOUR;
    this.engine.hour = START_HOUR;
    this.player.teleport(L.start.x, L.start.y, L.start.z, L.start.heading || 0, 0);
    this._beginPlay();
  }

  _beginPlay() {
    this._cut = null;
    this._busy = false;
    this.player.frozen = false;
    this.setMode('play');
    this.input.requestLock();
    this._regionT = 0;
    this.quests.check(true);
  }

  _respawnPoint() {
    const st = this.state,
      L = this.world.layout;
    const id = st.world.respawn;
    const l = id && this.ents.lanterns.find((q) => q.id === id && q.lit);
    if (l) return { x: l.base.x, y: l.base.y + 0.05, z: l.base.z, heading: Math.atan2(l.flame.x - l.base.x, -(l.flame.z - l.base.z)) };
    if (st.quest.stage !== 'arrive' && st.quest.stage !== 'letter') return { x: L.spawn.x, y: L.spawn.y + 0.05, z: L.spawn.z, heading: 0 };
    return { x: L.start.x, y: L.start.y, z: L.start.z, heading: L.start.heading || 0 };
  }

  _travel(id) {
    const st = this.state;
    const l = this.ents.lanterns.find((q) => q.id === id);
    if (!l || !l.lit || this._cut || this._busy) return;
    if (st.mode !== 'book' && st.mode !== 'play') return;
    if (this.shades.closeness > 0.25) {
      if (st.mode === 'book') this.actions.closeBook();
      this.say('Not while the Gloom has hold of you.');
      return;
    }
    if (this.ents.held) this.ents.drop(false);
    this.setMode('play');
    this.input.requestLock();
    this._busy = true;
    this._cut = { kind: 'travel', t: 0, to: l, done: false };
    this.audio.sfx('travel');
    this.fadeTo(1, 0.55);
  }

  _die(cause) {
    const st = this.state;
    if (st.mode === 'dead') return;
    if (this.brew.active) this.brewing.leave();
    if (this.ents.held) this.ents.drop(false);
    st.stats.deaths++;
    st.player.levity = 0;
    st.player.regen = 0;
    this._dead = 0;
    this._deathCause = cause;
    this.setMode('dead');
    this.input.releaseLock();
    this.audio.sfx('death');
    this.bus.emit('death', { cause });
  }
  _respawn() {
    const st = this.state;
    if (st.mode !== 'dead' || this._busy) return;
    this._busy = true;
    this.input.requestLock();
    this.fadeTo(1, 0.5, () => {
      const p = this._respawnPoint();
      this.player.teleport(p.x, p.y, p.z, p.heading, 0);
      st.player.hp = st.player.hpMax;
      this._hurt.acc = 0;
      this._hurt.flash = 0;
      this._dead = 0;
      this.shades.reset();
      this.potions.reset();
      this._busy = false;
      this.setMode('play');
      this.audio.sfx('respawn');
      this.bus.emit('respawn', {});
      this.fadeTo(0, 1.4);
      this.save(true);
    });
  }

  // ================================================================================ the ending
  _beginEnding() {
    const st = this.state;
    if (this._cut || st.world.athanor >= 2 || !st.inv.stone) return;
    const N = this.world.named,
      L = this.world.layout,
      cam = this.engine.camera;
    if (this.ents.held) this.ents.drop(false);
    st.world.athanor = 2;
    this.ents.setAthanor(2);
    const a = N.athanor;
    const mouth = a ? a.anchor('mouth') || new THREE.Vector3(a.x, a.y + 1.2, a.z) : new THREE.Vector3(L.chapel.x, L.chapel.y + 1.2, L.chapel.z);
    const door = new THREE.Vector3(L.door.x, L.door.y, L.door.z);
    const out = door.clone().sub(mouth).setY(0).normalize();
    const p0 = cam.position.clone();
    const p1 = mouth.clone().addScaledVector(out, 9).setY(mouth.y + 1.4);
    const p2 = mouth.clone().addScaledVector(out, 16).setY(mouth.y + 20);
    const p3 = mouth.clone().addScaledVector(out, 64).setY(mouth.y + 46);
    this._cut = { kind: 'ending', t: 0, phase: 'cut', mouth, out, pts: [p0, p1, p2, p3], look0: new THREE.Vector3().copy(mouth), hour0: st.time.hour, lit: 0 };
    this.setMode('cutscene');
    this.player.frozen = true;
    this.audio.sfx('stone_form', { gain: 0.8 });
    this.audio.sfx('ignite', { pos: [mouth.x, mouth.y, mouth.z] });
    this.fx.flash(mouth.x, mouth.y, mouth.z, '#ffb070', 260, 60, 3.5);
    this.particles.fireball(mouth.x, mouth.y, mouth.z, 3.2);
    this.shake(0.8);
    this.bus.emit('ending', { phase: 'cut' });
    this.quests.check(true);
    for (const r in st.world.gloom) this.liftGloom(r);
  }
  _endEnding() {
    const c = this._cut;
    if (!c || c.kind !== 'ending' || c.phase !== 'credits') return;
    this._busy = true;
    this.fadeTo(1, 0.8, () => {
      const L = this.world.layout;
      this.bus.emit('ending', { phase: null });
      this.engine.setFov(this.settings.fov);
      this.player.teleport(L.spawn.x, L.spawn.y + 0.05, L.spawn.z, Math.PI, 0);
      this.state.quest.stage = 'done';
      this._beginPlay();
      this.bus.emit('quest', { stage: 'done' });
      this.fadeTo(0, 1.6);
      this.save(true);
    });
  }

  /** Every scripted camera: arriving, travelling by lantern, the ending. Runs after the player has placed the view. */
  _cutscene(dt) {
    const c = this._cut,
      st = this.state,
      cam = this.engine.camera,
      L = this.world.layout,
      input = this.input;
    c.t += dt;
    if (c.kind === 'intro' || c.kind === 'continue') {
      if (!c.begun) {
        this._title(dt);
        if (c.t >= 0) {
          c.begun = true;
          this._load(c.save);
          if (c.kind === 'continue') {
            const sp = st.player;
            const h = this.world.T.heightAt(sp.x, sp.z);
            const unsafe = h < 0.2 || (h < WORLD.lava + 0.5 && Math.hypot(sp.x - SCAR.x, sp.z - SCAR.z) < SCAR.lava + 6);
            if (unsafe) {
              const p = this._respawnPoint();
              this.player.teleport(p.x, p.y, p.z, p.heading, 0);
            } else this.player.teleport(sp.x, sp.y + 0.03, sp.z, sp.yaw || 0, sp.pitch || 0);
            this.engine.hour = st.time.hour;
            this._beginPlay();
            this.fadeTo(0, 1.4);
            return;
          }
          st.time.hour = START_HOUR;
          this.engine.hour = START_HOUR;
          this.player.teleport(L.start.x, L.start.y, L.start.z, L.start.heading || 0, 0);
          this.player.frozen = true;
          c.t = 0;
          this.fadeTo(0, 2.0);
        }
        return;
      }
      // the boat comes in: a low glide over the water to the end of the dock
      const T = 9.5;
      const k = easeInOutCubic(clamp(c.t / T, 0, 1));
      const eye = this.player.pos.y + this.player.eye;
      const far = 78;
      _v.set(L.start.x + 5.5 * (1 - k), lerp(2.4, eye, k), L.start.z + far * (1 - k));
      cam.position.copy(_v);
      const ch = L.chapel;
      _v2.set(lerp(ch.x, L.start.x, k * k), lerp(ch.y + 16, eye, k * k), lerp(ch.z, L.start.z - 60, k * k));
      cam.lookAt(_v2);
      cam.rotation.z += Math.sin(c.t * 0.9) * 0.012 * (1 - k);
      const skip = c.t > 1.2 && (input.hit('Space') || input.hit('Enter') || input.hit('Escape') || input.hit('Mouse0') || input.hit('KeyE'));
      if (c.t >= T || skip) {
        if (skip && c.t < T - 0.6) {
          // a blink rather than a jump
          this._fade.v = Math.max(this._fade.v, 0.85);
          this.fadeTo(0, 0.8);
        }
        this._beginPlay();
      }
      return;
    }
    if (c.kind === 'travel') {
      if (!c.done && this._fade.v >= 0.999) {
        c.done = true;
        const l = c.to;
        this.player.teleport(l.base.x, l.base.y + 0.05, l.base.z, Math.atan2(l.flame.x - l.base.x, -(l.flame.z - l.base.z)), 0);
        st.world.respawn = l.id;
        this.shades.reset();
        this.fadeTo(0, 1.0);
        c.t = 0;
      } else if (c.done && c.t > 0.35) {
        this._cut = null;
        this._busy = false;
        this.save(true);
      }
      return;
    }
    if (c.kind === 'ending') this._ending(dt, c);
  }

  _ending(dt, c) {
    const st = this.state,
      cam = this.engine.camera,
      L = this.world.layout;
    const CUT = 15,
      TEXT = 17.5;
    // the lanterns of the dead wake one after another
    const lanterns = this.ents.lanterns;
    while (c.lit < lanterns.length && c.t > 3 + c.lit * 1.6) {
      const l = lanterns[c.lit++];
      if (!l.lit) {
        this.ents.setLantern(l, true);
        st.known.lanterns[l.id] = true;
        this.audio.sfx('lantern_lit', { pos: [l.flame.x, l.flame.y, l.flame.z], gain: 0.7 });
      }
    }
    // the night runs out: the hour is wound on to first light
    const wind = smoothstep(2, CUT + 6, c.t);
    let span = 6.4 - c.hour0;
    if (span < 0) span += 24;
    if (span < 3) span += 24;
    st.time.hour = (c.hour0 + span * wind) % 24;
    this._cleared = damp(this._cleared, 1, 0.25, dt);

    if (c.phase === 'cut') {
      const k = clamp(c.t / CUT, 0, 1);
      const [p0, p1, p2, p3] = c.pts;
      // three legs: back from the fire, up through the open roof, out over the vale
      const a = easeInOutCubic(clamp(k / 0.3, 0, 1)),
        b = easeInOutCubic(clamp((k - 0.26) / 0.38, 0, 1)),
        d = easeInOutCubic(clamp((k - 0.56) / 0.44, 0, 1));
      _v.copy(p0).lerp(p1, a).lerp(p2, b).lerp(p3, d);
      cam.position.copy(_v);
      _v2.copy(c.mouth);
      _v2.y += 1.0 + 7 * d;
      cam.lookAt(_v2);
      if (c.t >= CUT) {
        c.phase = 'text';
        c.t0 = c.t;
        c.orbit = Math.atan2(cam.position.x - c.mouth.x, cam.position.z - c.mouth.z);
        c.r = Math.hypot(cam.position.x - c.mouth.x, cam.position.z - c.mouth.z);
        c.h = cam.position.y;
        this.bus.emit('ending', { phase: 'text' });
      }
    } else {
      // a slow wheel round the chapel while the words pass
      const t = c.t - c.t0;
      const ang = c.orbit + t * 0.028;
      const r = c.r + Math.min(40, t * 1.2);
      _v.set(c.mouth.x + Math.sin(ang) * r, c.h + Math.min(22, t * 0.7), c.mouth.z + Math.cos(ang) * r);
      _v.y = Math.max(_v.y, this.world.T.heightAt(_v.x, _v.z) + 12);
      cam.position.copy(_v);
      _v2.copy(c.mouth);
      _v2.y += 8;
      cam.lookAt(_v2);
      if (c.phase === 'text' && t >= TEXT) {
        c.phase = 'credits';
        this.bus.emit('ending', { phase: 'credits' });
      }
    }
  }

  _title(dt) {
    this._titleT += dt;
    const cam = this.engine.camera,
      L = this.world.layout,
      c = L.chapel,
      T = this.world.T;
    const a = 2.45 + this._titleT * 0.021;
    const r = 86;
    const x = c.x + Math.sin(a) * r,
      z = c.z + Math.cos(a) * r;
    const want = Math.max(c.y + 19, T.heightAt(x, z) + 7);
    this._titleY = this._titleY == null ? want : damp(this._titleY, want, 1.2, dt);
    cam.position.set(x, this._titleY, z);
    cam.lookAt(c.x, c.y + 10, c.z);
  }

  _photoCam(dt) {
    const p = this._photo,
      input = this.input,
      cam = this.engine.camera,
      s = this.settings;
    const k = 0.0021 * s.sensitivity;
    p.heading += input.dx * k;
    p.pitch = clamp(p.pitch - input.dy * k * (s.invertY ? -1 : 1), -1.55, 1.55);
    const sp = (input.held('ShiftLeft') || input.held('ShiftRight') ? 26 : 6) * dt;
    const sh = Math.sin(p.heading),
      ch = Math.cos(p.heading),
      cp = Math.cos(p.pitch),
      spn = Math.sin(p.pitch);
    let f = 0,
      r = 0,
      u = 0;
    if (input.held('KeyW')) f += 1;
    if (input.held('KeyS')) f -= 1;
    if (input.held('KeyD')) r += 1;
    if (input.held('KeyA')) r -= 1;
    if (input.held('KeyE') || input.held('Space')) u += 1;
    if (input.held('KeyQ') || input.held('KeyC')) u -= 1;
    p.x += (sh * cp * f + ch * r) * sp;
    p.y += (spn * f + u) * sp;
    p.z += (-ch * cp * f + sh * r) * sp;
    // stay near the body and out of the ground
    const pl = this.player.pos;
    const dx = p.x - pl.x,
      dz = p.z - pl.z,
      d = Math.hypot(dx, dz);
    if (d > 60) {
      p.x = pl.x + (dx / d) * 60;
      p.z = pl.z + (dz / d) * 60;
    }
    p.y = clamp(p.y, Math.max(this.world.T.heightAt(p.x, p.z), 0) + 0.3, pl.y + 70);
    if (input.held('BracketLeft')) p.fov = clamp(p.fov - 30 * dt, 20, 100);
    if (input.held('BracketRight')) p.fov = clamp(p.fov + 30 * dt, 20, 100);
    if (Math.abs(cam.fov - p.fov) > 0.01) this.engine.setFov(p.fov);
    cam.position.set(p.x, p.y, p.z);
    cam.rotation.set(p.pitch, -p.heading, 0, 'YXZ');
    if (input.hit('KeyP') || input.hit('Escape') || input.hit('Enter')) this.actions.photo(false);
  }

  // ================================================================================ the frame
  frame(rawDt) {
    if (!this.ready) return;
    const st = this.state,
      e = this.engine,
      input = this.input,
      cam = e.camera;
    const dt = clamp(rawDt, 0, 0.05);
    const mode = st.mode;
    const w0 = e.w,
      h0 = e.h;
    e.resize();
    if (e.w !== w0 || e.h !== h0) this._hold = 3;

    const frozen = mode === 'pause' || mode === 'book' || mode === 'photo' || !!this.reading;
    const sim = frozen ? 0 : dt;
    const control = mode === 'play' && !this.reading && !this._busy && !this._cut;

    // --- the fade runs on the wall clock
    const f = this._fade;
    if (f.v !== f.to) {
      f.v = f.v < f.to ? Math.min(f.to, f.v + dt * f.speed) : Math.max(f.to, f.v - dt * f.speed);
      if (f.v === f.to && f.fn) {
        const fn = f.fn;
        f.fn = null;
        fn();
      }
    }

    if (sim > 0) {
      this._clock(sim, mode);
      // --- the body
      if (mode !== 'title') this.player.update(sim, input, { control, carrying: !!this.ents.held });
      // --- hands
      if (control) this._interact();
      else this.hud.focus = null;
      // --- the world
      this.physics.step(sim);
      this.ents.update(sim);
      this.potions.update(sim, input, control);
      this.shades.update(sim);
      this.brewing.update(sim, input);
      this.quests.update(sim);
      this.ambient.update(sim);
      // --- the eye
      this.brewing.camera();
      if (mode === 'dead') {
        this._dead = Math.min(1, this._dead + sim / 1.3);
        const k = easeInOutCubic(this._dead);
        cam.position.y -= k * 1.15;
        cam.rotation.z += k * 0.42;
        cam.rotation.x -= k * 0.25;
      }
      if (mode === 'title') this._title(sim);
      else if (this._cut) this._cutscene(sim);
      cam.updateMatrixWorld();
      this.fx.update(sim);
      this.particles.update(sim, cam);
      this._air(sim, mode);
    } else if (mode === 'photo') {
      this._photoCam(dt);
      cam.updateMatrixWorld();
      this._hold = 2;
    }

    if (this.debugCam) {
      const d = this.debugCam;
      cam.position.set(d.x, d.y, d.z);
      cam.rotation.set(d.pitch, -d.heading, 0, 'YXZ');
      cam.updateMatrixWorld();
    }

    this._sound(dt, mode);
    this._view(dt, mode, control);
    this.ui.update(dt);

    // --- draw (a still screen is drawn a few times, then left alone)
    if (!frozen || this._hold > 0) {
      if (this._hold > 0) this._hold--;
      e.update(sim);
      this.world.update(sim);
      e.render(rawDt > 0 ? rawDt : dt);
    }
    input.endFrame();

    // --- keep the island moving on slower machines
    if (!this.manual && mode === 'play' && rawDt > 0) {
      this._ft = lerp(this._ft, rawDt, 0.04);
      this._slow = this._ft > 1 / 34 ? this._slow + rawDt : Math.max(0, this._slow - rawDt * 0.5);
      if (this._slow > 5 && this.settings.autoQuality) {
        this._slow = 0;
        this._ft = 1 / 60;
        const i = QUALITY_ORDER.indexOf(this.settings.quality);
        if (i > 0) this._setSetting('quality', QUALITY_ORDER[i - 1], false);
        else if (this.settings.renderScale > 0.7) this._setSetting('renderScale', Math.max(0.65, this.settings.renderScale - 0.15), false);
      }
    }
  }

  /** Time, timers and slow changes of state. */
  _clock(dt, mode) {
    const st = this.state;
    const playing = mode === 'play' || mode === 'brew';
    // things that happen a little later
    if (this.after.length) {
      for (let i = this.after.length - 1; i >= 0; i--) {
        const a = this.after[i];
        a.t -= dt;
        if (a.t <= 0) {
          this.after.splice(i, 1);
          try {
            a.fn();
          } catch (err) {
            console.error(err);
          }
        }
      }
    }
    if (playing) {
      const h = st.time.hour;
      const night = h < 5.5 || h > 20.5;
      st.time.hour = h + (dt / HOUR_SECONDS) * (night ? 2 : 1) * (mode === 'brew' ? 0.35 : 1);
      if (st.time.hour >= 24) {
        st.time.hour -= 24;
        st.time.day++;
      }
      st.stats.seconds += dt;
      st.world.clock += dt;
      const p = st.player;
      if (p.levity > 0) p.levity = Math.max(0, p.levity - dt);
      if (p.regen > 0) {
        p.regen = Math.max(0, p.regen - dt);
        if (p.hp > 0) p.hp = Math.min(p.hpMax, p.hp + 3.5 * dt);
      }
      // left alone, a body mends slowly
      this._hurt.since += dt;
      if (this._hurt.since > 12 && p.hp > 0 && p.hp < p.hpMax) p.hp = Math.min(p.hpMax, p.hp + 1.1 * dt);
      this._saveT += dt;
      if (this._saveT > 60 && mode === 'play' && !this._busy && this.shades.closeness < 0.1 && this.player.onGround) this.save();
    }
    if (mode !== 'title') this.engine.hour = st.time.hour;
    // the Gloom going out
    for (let i = this._lifts.length - 1; i >= 0; i--) {
      const l = this._lifts[i];
      l.t += dt;
      st.world.gloom[l.region] = Math.max(0, 1 - l.t / 8);
      if (l.t >= 8) {
        st.world.gloom[l.region] = 0;
        this._lifts.splice(i, 1);
      }
    }
    // pain, gathered so that a slow drain is one voice and not sixty
    const hu = this._hurt;
    hu.t -= dt;
    if (hu.acc > 0 && hu.t <= 0) {
      this.bus.emit('hurt', { amount: hu.acc, hp: st.player.hp });
      if (st.player.hp > 0) this.audio.sfx('hurt', { gain: clamp(0.35 + hu.acc / 30, 0.35, 1) });
      hu.acc = 0;
      hu.t = 0.45;
    }
    hu.flash = Math.max(0, hu.flash - dt * 1.4);
    this.frost = Math.max(0, this.frost - dt * 0.3);
    if (this._say.t > 0) this._say.t -= dt;
  }

  /** What the hands can reach, and the keys that are not movement. */
  _interact() {
    const input = this.input,
      cam = this.engine.camera,
      E = this.ents;
    const it = E.held ? null : E.focus(cam.position, this.player.aim(_dir));
    this._focus = it;
    if (E.held) this.hud.focus = { verb: 'Put down', name: E.held.name || '', key: 'E' };
    else this.hud.focus = it ? { verb: it.verb, name: it.name, key: 'E' } : null;
    if (input.hit('KeyE')) {
      if (E.held) E.drop(false);
      else if (it) it.use();
    }
    if (this.state.mode !== 'play' || this.reading) return;
    if (input.hit('Tab') || input.hit('KeyJ') || input.hit('KeyB')) this.actions.openBook();
    else if (input.hit('KeyM')) this.actions.openBook('map');
    else if (input.hit('KeyP')) this.actions.photo(true);
    else if (input.hit('Escape')) this.actions.pause();
  }

  /** Where we are, and what that does to the sky. */
  _air(dt, mode) {
    const st = this.state,
      e = this.engine,
      T = this.world.T,
      cam = e.camera;
    const titled = mode === 'title';
    const px = titled ? cam.position.x : this.player.pos.x,
      pz = titled ? cam.position.z : this.player.pos.z;
    this._regionT -= dt;
    if (this._regionT <= 0) {
      this._regionT = 0.35;
      const r = T.regionAt(px, pz);
      if (r !== this.region) {
        this.region = r;
        if (mode === 'play') {
          const now = st.world.clock;
          const first = !st.known.regions[r];
          st.known.regions[r] = true;
          if (first || !(now - (this._regionSaid[r] || -1e9) < 150)) this.bus.emit('region', { id: r });
          this._regionSaid[r] = now;
        }
      }
      // how much open water is near (for the sound of it)
      let wet = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.283;
        if (T.heightAt(px + Math.cos(a) * 14, pz + Math.sin(a) * 14) < 0.15) wet += 0.08;
        if (T.heightAt(px + Math.cos(a) * 34, pz + Math.sin(a) * 34) < 0.15) wet += 0.045;
      }
      this._water = wet;
    }
    const r = this.region || 'vale';
    const gl = titled ? 0 : st.world.gloom[r] || 0;
    this._gloomHere = damp(this._gloomHere, gl, 0.7, dt);
    if (titled) return;
    const W = WEATHER[r] || WEATHER.vale;
    const G = W.gloom || W;
    const k = this._gloomHere;
    const cl = this._cleared;
    const want = e.want;
    // once the Athanor burns the sky opens: the last thing the Work mends is the weather
    want.overcast = lerp(W.overcast, G.overcast, k) * (1 - 0.7 * cl);
    want.fog = lerp(W.fog, G.fog, k) * (1 - 0.6 * cl);
    want.dim = lerp(W.dim, G.dim, k);
    want.wind = W.wind;
    want.tint.setRGB(lerp(W.tint[0], G.tint[0], k), lerp(W.tint[1], G.tint[1], k), lerp(W.tint[2], G.tint[2], k));
    // a small lamp at the belt, so that night and the Gloom are dark and not blind
    const night = Math.max(e.sky.night || 0, k * 0.8);
    if (night > 0.12 && mode !== 'cutscene') {
      // held high and a step behind, and falling off gently: it must light the road ahead without
      // setting fire to whatever is in the hand
      const p = this.player.pos;
      e.camera.getWorldDirection(_v);
      e.lighting.point(p.x - _v.x * 0.9, p.y + 2.25, p.z - _v.z * 0.9, 0xffc48c, (2.8 + 2.0 * k) * night, 13 + 4 * k, 1);
    }
  }

  /** Ears. */
  _sound(dt, mode) {
    const e = this.engine,
      cam = e.camera,
      st = this.state,
      A = this.audio;
    cam.getWorldDirection(_v);
    A.setListener(cam.position.x, cam.position.y, cam.position.z, _v.x, _v.y, _v.z);
    const gloom = clamp(this._gloomHere * 0.8 + this.shades.closeness * 0.4, 0, 1);
    A.setAmbience({ region: this.region || 'vale', night: e.sky.night || 0, wind: e.atmo.wind, rain: 0, gloom, water: clamp(this._water, 0, 1), height: cam.position.y });
    this._musicT -= dt;
    if (this._musicT <= 0) {
      this._musicT = 0.5;
      let mood = 'none',
        intensity = 0.6;
      // the Gloom is entered a little deeper than it is left, so its edge does not flicker
      this._inGloom = this._gloomHere > (this._inGloom ? 0.3 : 0.45);
      if (mode === 'title') {
        mood = 'title';
        intensity = 0.7;
      } else if (this._cut && this._cut.kind === 'ending') {
        mood = 'ending';
        intensity = 1;
      } else if (mode === 'dead') mood = 'none';
      else if (mode === 'brew' || this.brewing.k > 0.5) {
        mood = this.brew.opus ? 'opus' : 'brew';
        intensity = this.brew.opus ? 0.4 + 0.15 * this.brew.opus.stage + 0.2 * this.brew.progress : 0.4 + 0.5 * this.brew.progress;
      } else if (this._inGloom) {
        mood = 'gloom';
        intensity = 0.35 + 0.65 * this.shades.closeness;
      } else if ((e.sky.night || 0) > 0.6) mood = 'night';
      else mood = MOOD[this.region] || 'vale';
      if (mood !== this._mood && PLACE_MOODS.has(mood) && PLACE_MOODS.has(this._mood) && (this._moodHeld += 0.5) < MOOD_DWELL) mood = this._mood;
      else {
        this._mood = mood;
        this._moodHeld = 0;
      }
      A.setMusic(mood, { intensity: clamp(intensity, 0, 1) });

      // the long voices of the land
      const L = this._loops;
      const p = cam.position;
      const ds = Math.hypot(p.x - SCAR.x, p.z - SCAR.z);
      if (ds < 150) {
        const r = Math.min(ds, SCAR.lava - 3) / (ds || 1);
        const pos = [SCAR.x + (p.x - SCAR.x) * r, WORLD.lava, SCAR.z + (p.z - SCAR.z) * r];
        if (!L.lava) L.lava = A.loop('lava', { pos, gain: 1 });
        else L.lava.set({ pos });
      } else if (L.lava && ds > 175) {
        L.lava.stop(1.5);
        L.lava = null;
      }
      const dr = RIVER.dist(p.x, p.z, _ro);
      if (dr < 32) {
        RIVER.at(_ro.s, _ro);
        const pos = [_ro.x, this.world.T.heightAt(_ro.x, _ro.z) + 0.3, _ro.z];
        if (!L.river) L.river = A.loop('river', { pos, gain: 0.8 });
        else L.river.set({ pos });
      } else if (L.river && dr > 38) {
        L.river.stop(1.5);
        L.river = null;
      }
      const lev = st.player.levity > 0 && (mode === 'play' || mode === 'brew');
      if (lev && !L.levity) L.levity = A.loop('levity', { gain: 0.6 });
      else if (!lev && L.levity) {
        L.levity.stop(0.8);
        L.levity = null;
      }
    }
    A.update(dt);
  }

  /** What the HUD and the lens show. */
  _view(dt, mode, control) {
    const st = this.state,
      hud = this.hud,
      e = this.engine,
      g = e.post.grade;
    const q = this.quests;
    hud.region = mode === 'play' ? this.region : hud.region;
    hud.gloom = clamp(this._gloomHere * 0.5 + this.shades.closeness * 0.65, 0, 1);
    hud.hint = this._say.t > 0 ? this._say.text : control ? q.tip : '';
    const sel = st.inv.selected;
    hud.held = sel && count(st.inv.potions, sel) > 0 ? sel : null;
    hud.carrying = !!this.ents.held;
    hud.time = st.time.hour;
    hud.crosshair = !control ? 'none' : this.potions.isAiming ? 'aim' : hud.focus ? 'ring' : 'dot';
    let hd = this.player.heading % (Math.PI * 2);
    if (hd < 0) hd += Math.PI * 2;
    hud.compass.heading = hd;
    hud.compass.marks = q.marks;
    if (mode === 'photo') hud.photo = PHOTO_KEYS;
    const mp = this.map;
    mp.player.x = this.player.pos.x;
    mp.player.z = this.player.pos.z;
    mp.player.yaw = -this.player.heading;
    mp.marks = q.mapMarks;

    g.fade = this._fade.v;
    g.gloom = mode === 'title' ? 0 : hud.gloom;
    g.hurt = this._hurt.flash;
    g.frost = this.frost;
    this.canvas.style.cursor = mode === 'play' && !this.input.locked ? 'crosshair' : '';
  }
}

const PHOTO_KEYS = [
  ['W A S D', 'Move'],
  ['Q E', 'Down, up'],
  ['Shift', 'Faster'],
  ['[ ]', 'Lens'],
  ['P', 'Back'],
];
