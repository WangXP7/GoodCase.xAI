// UI workbench: the real UI (src/ui) driven by a stand-in game.
// The data and state shapes are the real ones (src/game/data.js, src/game/state.js); the actions
// only mutate that state and emit the bus events the real game would, and a painted still stands
// in for the 3D view.
//
//   /dev/ui.html?scene=hud            jump to a screen or state (see SCENES below)
//   &bg=night|dusk|day|gloom|forge    backdrop
//   &icons=1                          hand the UI rendered thumbnails instead of null
//   &map=0                            no map canvas (the UI draws its own coastline)
//   &still=1                          freeze the simulation (captures)
//
// While it runs (not still) the game-owned keys work as in the game: Tab book, M map, Esc pause,
// P photo, 1..7 / Q potions, and at the cauldron Space, C, B, X, Esc. Extra dev keys while
// walking: H hurt, K die, L read the next page, G gloom, B walk to the cauldron, N next quest step.
import * as D from '../src/game/data.js';
import { createState, createBrew } from '../src/game/state.js';
import { Emitter } from '../src/core/events.js';
import { createUI } from '../src/ui/index.js';

const Q = new URLSearchParams(location.search);
const SCENE = Q.get('scene') || 'title';
const STILL = Q.get('still') === '1';
const WANT_ICONS = Q.get('icons') === '1';
const WANT_MAP = Q.get('map') !== '0';

const bus = new Emitter();
let save = Q.get('save') === '1';

const game = {
  state: createState(),
  brew: createBrew(),
  data: D,
  bus,
  settings: { quality: 'high', renderScale: 1, fov: 75, sensitivity: 1, invertY: false, master: 0.8, music: 0.6, sfx: 0.8, shake: true, grain: true, hints: true },
  hud: { focus: null, crosshair: 'dot', compass: { heading: 0.3, marks: [] }, region: null, gloom: 0, hint: '', held: null, carrying: false, time: 8.25 },
  icons: { get: () => null },
  map: {
    canvas: null,
    size: 768,
    toUV: (x, z) => [(x + 384) / 768, (z + 384) / 768],
    get player() {
      const p = game.state.player;
      return { x: p.x, z: p.z, yaw: p.yaw };
    },
    get marks() {
      return mapMarks(game.state);
    },
  },
  actions: null,
};

// ---------------------------------------------------------------------------------------------
// State presets
// ---------------------------------------------------------------------------------------------
const bag = (...ids) => Object.fromEntries(ids.map((id) => [id, true]));

function early(st) {
  st.mode = 'play';
  st.quest.stage = 'gather';
  st.inv.ingredients = { cinderbloom: 2, saltwort: 3 };
  st.known.ingredients = bag('cinderbloom', 'saltwort');
  st.known.lore = bag('letter');
  st.known.charted = bag('ember');
  st.known.regions = bag('shore', 'vale');
  st.time = { day: 1, hour: 9.5 };
  st.player.x = -6;
  st.player.z = 130;
}
function mid(st) {
  st.mode = 'play';
  st.quest.stage = 'primes';
  st.inv.ingredients = { cinderbloom: 5, saltwort: 7, weepcap: 3, mirrorlily: 4, corpselight: 2, halite: 2 };
  st.inv.potions = { ember: 4, verdance: 2, rime: 3, levity: 1, vitae: 2 };
  st.inv.selected = 'ember';
  st.inv.primes.salt = true;
  st.known.ingredients = bag('cinderbloom', 'saltwort', 'weepcap', 'mirrorlily', 'corpselight', 'halite');
  st.known.potions = bag('ember', 'verdance', 'rime', 'vitae');
  st.known.charted = bag('ember', 'verdance', 'rime', 'levity', 'vitae');
  st.known.lore = bag('letter', 'flame', 'mending', 'green', 'gloom', 'stillness', 'rising');
  st.known.lanterns = bag('chapel', 'saltwood');
  st.known.regions = bag('shore', 'vale', 'saltwood', 'mere');
  st.world.gloom = { saltwood: 0, mere: 1, scar: 1 };
  st.world.athanor = 1;
  st.time = { day: 3, hour: 19.2 };
  st.stats = { seconds: 4380, brewed: 9, thrown: 14, deaths: 1, picked: 41 };
  st.player.x = 64;
  st.player.z = 118;
}
function late(st) {
  mid(st);
  st.quest.stage = 'opus';
  st.inv.primes = { salt: true, mercury: true, sulfur: true };
  st.inv.ingredients = { cinderbloom: 6, saltwort: 9, weepcap: 4, mirrorlily: 5, corpselight: 3, stormthistle: 3, halite: 2, quicksilver: 2, brimstone: 1 };
  st.inv.potions = { ember: 6, verdance: 3, rime: 4, levity: 2, fulminate: 2, saltspire: 3, vitae: 4 };
  st.known.ingredients = bag(...D.INGREDIENT_ORDER);
  st.known.potions = bag(...D.POTION_ORDER);
  st.known.charted = bag(...D.POTION_ORDER);
  st.known.lore = bag(...D.LORE_ORDER.filter((id) => id !== 'last'));
  st.known.lanterns = bag(...Object.keys(D.LANTERNS));
  st.known.regions = bag(...Object.keys(D.REGIONS));
  st.world.gloom = { saltwood: 0, mere: 0, scar: 0 };
  st.time = { day: 6, hour: 22.9 };
  st.stats = { seconds: 9120, brewed: 23, thrown: 37, deaths: 3, picked: 96 };
  st.player.x = -8;
  st.player.z = 78;
}
function done(st) {
  late(st);
  st.quest.stage = 'done';
  st.inv.primes = { salt: false, mercury: false, sulfur: false };
  st.world.athanor = 2;
  st.known.lore = bag(...D.LORE_ORDER);
  st.time = { day: 7, hour: 6.2 };
}

function mapMarks(st) {
  const lit = st.known.lanterns;
  const L = D.LANTERNS;
  const marks = [
    { id: 'home', kind: 'home', x: -10, z: 70, name: 'The Athanor' },
    { id: 'chapel', kind: 'lantern', x: 18, z: 104, name: L.chapel.name, lit: !!lit.chapel },
    { id: 'saltwood', kind: 'lantern', x: -112, z: 68, name: L.saltwood.name, lit: !!lit.saltwood },
    { id: 'mere', kind: 'lantern', x: 128, z: 86, name: L.mere.name, lit: !!lit.mere },
    { id: 'scar', kind: 'lantern', x: 52, z: -150, name: L.scar.name, lit: !!lit.scar },
  ];
  if (st.quest.stage === 'primes' && !st.inv.primes.mercury) marks.push({ id: 'quest', kind: 'quest', x: 184, z: 52 });
  else if (st.quest.stage === 'opus' || st.quest.stage === 'arrive') marks.push({ id: 'quest', kind: 'quest', x: -10, z: 70 });
  return marks;
}
function compassMarks(st) {
  const p = st.player;
  const out = [];
  for (const m of mapMarks(st)) {
    if (m.kind === 'lantern' && !m.lit) continue;
    const dx = m.x - p.x,
      dz = m.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 6) continue;
    out.push({ id: m.id, kind: m.kind, bearing: Math.atan2(dx, -dz), dist });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The stand-in game: actions and a small cauldron simulation
// ---------------------------------------------------------------------------------------------
function setMode(to, extra) {
  const from = game.state.mode;
  if (from === to && !extra) return;
  game.state.mode = to;
  bus.emit('mode', Object.assign({ from, to }, extra));
}
const toast = (kind, title, text, icon) => bus.emit('toast', { kind, title, text, icon });

const pot = { pump: false, damp: false, stirTarget: 0, auto: false };

function brewRecalc() {
  const b = game.brew;
  const primes = b.contents.filter((x) => x.startsWith('prime:'));
  if (primes.length) {
    b.mix = null;
    b.region = null;
    if (primes.length === 3 && !b.opus) {
      b.opus = { stage: 0, progress: 0, done: false };
      bus.emit('opus:stage', { stage: 0 });
    }
    b.band = b.opus ? D.OPUS.stages[b.opus.stage].heat : null;
  } else {
    const m = D.mixOf(b.contents);
    b.mix = m.bary;
    b.region = D.regionAt(m.bary);
    b.band = b.region ? D.POTIONS[b.region.id].heat : null;
  }
  b.fit = b.band ? D.heatFit(b.heat, b.band) : null;
}
function brewClear() {
  const b = game.brew;
  b.contents = [];
  b.trail = [];
  b.mix = b.region = b.band = b.fit = b.ready = b.opus = null;
  b.progress = 0;
  b.hint = '';
}

const actions = {
  newGame() {
    game.state = createState();
    game.brew = createBrew();
    save = true;
    game.hud.gloom = 0;
    game.hud.focus = null;
    setMode('play');
    game.hud.region = 'shore';
    bus.emit('region', { id: 'shore' });
    game.state.known.regions.shore = true;
    game.hud.hint = 'Follow the road up to the chapel.';
  },
  continueGame() {
    game.state = createState();
    mid(game.state);
    game.state.mode = 'title';
    setMode('play');
    game.hud.region = 'vale';
    bus.emit('region', { id: 'vale' });
  },
  hasSave: () => save,
  resume() {
    if (game.state.quest.stage === 'done' && game.state.mode === 'cutscene') bus.emit('ending', { phase: 'free' });
    setMode('play');
  },
  pause: () => setMode('pause'),
  quitToTitle() {
    bus.emit('save', {});
    setMode('title');
  },
  openBook: (tab) => setMode('book', { tab: tab || undefined }),
  closeBook: () => setMode('play'),
  selectPotion(id) {
    if ((game.state.inv.potions[id] || 0) > 0) game.state.inv.selected = id;
  },
  setSetting(key, value) {
    game.settings[key] = value;
    bus.emit('settings', { key, value });
  },
  brewAdd(id) {
    const b = game.brew,
      st = game.state;
    if (b.ready || b.opus || b.contents.length >= D.BREW.capacity) return;
    if (id.startsWith('prime:')) {
      const p = id.slice(6);
      if (!st.inv.primes[p] || b.contents.includes(id) || b.contents.some((x) => !x.startsWith('prime:'))) return;
      b.contents.push(id);
    } else {
      if (!(st.inv.ingredients[id] > 0) || b.contents.some((x) => x.startsWith('prime:'))) return;
      if (--st.inv.ingredients[id] <= 0) delete st.inv.ingredients[id];
      if (b.mix) b.trail.push(b.mix.slice());
      b.contents.push(id);
    }
    b.progress = 0;
    brewRecalc();
    bus.emit('brew:add', { id });
  },
  brewPump: (on) => (pot.pump = !!on),
  brewDamp: (on) => (pot.damp = !!on),
  brewBottle() {
    const b = game.brew,
      st = game.state;
    if (b.opus && b.opus.done) {
      st.inv.stone = true;
      st.inv.primes = { salt: false, mercury: false, sulfur: false };
      st.quest.stage = 'stone';
      bus.emit('quest', { stage: 'stone' });
      brewClear();
      return;
    }
    if (!b.ready) return;
    const { potion, count } = b.ready;
    const first = !st.known.potions[potion];
    st.inv.potions[potion] = Math.min(D.BREW.maxCarry, (st.inv.potions[potion] || 0) + count);
    st.known.potions[potion] = st.known.charted[potion] = true;
    if (!st.inv.selected) st.inv.selected = potion;
    st.stats.brewed++;
    bus.emit('brew:bottled', { potion, count });
    bus.emit('pickup', { kind: 'potion', id: potion, count });
    if (first) bus.emit('discover', { kind: 'potion', id: potion });
    else toast('pickup', D.POTIONS[potion].full, '×' + count, { kind: 'potion', id: potion });
    brewClear();
  },
  brewEmpty() {
    if (game.brew.opus && game.brew.opus.done) return;
    brewClear();
  },
  brewLeave() {
    game.brew.active = false;
    pot.pump = pot.damp = false;
    setMode('play');
  },
  travel(id) {
    const m = mapMarks(game.state).find((x) => x.id === id);
    if (!m || !m.lit) return;
    game.state.player.x = m.x + 4;
    game.state.player.z = m.z + 6;
    setMode('play');
    bus.emit('save', {});
    toast('info', D.LANTERNS[id].name, 'You rise where the flame is kept.');
  },
  respawn() {
    game.state.player.hp = game.state.player.hpMax;
    game.hud.gloom = 0;
    bus.emit('respawn', {});
    setMode('play');
  },
  photo: (on) => setMode(on ? 'photo' : 'play'),
  readLoreDone() {
    const id = reading;
    reading = null;
    if (!id) return;
    const st = game.state;
    const firstRead = !st.known.lore[id];
    st.known.lore[id] = true;
    const rv = D.LORE[id].reveals;
    if (rv && !st.known.charted[rv] && !st.known.potions[rv]) {
      st.known.charted[rv] = true;
      bus.emit('discover', { kind: 'chart', id: rv });
    } else if (firstRead) toast('lore', D.LORE[id].title, 'A page is added to the book.');
  },
};
game.actions = actions;

let reading = null;
function readLore(id) {
  reading = id;
  bus.emit('lore', { id });
}
function enterBrew() {
  game.brew.active = true;
  setMode('brew');
}
function hurt(amount) {
  const p = game.state.player;
  p.hp = Math.max(0, p.hp - amount);
  bus.emit('hurt', { amount, hp: p.hp });
  if (p.hp <= 0) die();
}
function die() {
  game.state.player.hp = 0;
  game.state.stats.deaths++;
  bus.emit('death', {});
  setMode('dead');
}

function simBrew(dt) {
  const b = game.brew;
  const fireTo = pot.pump ? 1 : 0;
  const rate = pot.pump ? 0.5 : pot.damp ? 0.45 : 0.05;
  b.fire += Math.sign(fireTo - b.fire) * Math.min(Math.abs(fireTo - b.fire), rate * dt);
  b.heat += (b.fire - b.heat) * (1 - Math.exp(-dt * 1.3));
  b.stir += ((pot.auto ? 0.85 : pot.stirTarget) - b.stir) * (1 - Math.exp(-dt * 4));
  pot.stirTarget *= Math.exp(-dt * 2.5);
  b.fit = b.band ? D.heatFit(b.heat, b.band) : null;
  if (b.opus && !b.opus.done) {
    const o = b.opus;
    if (b.fit === 0 && b.stir > 0.25) o.progress += dt / D.OPUS.stages[o.stage].seconds;
    else o.progress = Math.max(0, o.progress - dt * 0.03);
    if (o.progress >= 1) {
      if (o.stage >= 3) {
        o.done = true;
        o.progress = 1;
        bus.emit('opus:done', {});
      } else {
        o.stage++;
        o.progress = 0;
        b.band = D.OPUS.stages[o.stage].heat;
        bus.emit('opus:stage', { stage: o.stage });
      }
    }
  } else if (b.region && !b.ready) {
    if (b.fit === 0 && b.stir > 0.25) b.progress += (dt / D.BREW.bindSeconds) * Math.min(1, b.stir * 1.3);
    else b.progress = Math.max(0, b.progress - dt * 0.05);
    if (b.progress >= 1) {
      b.progress = 1;
      b.ready = { potion: b.region.id, stars: b.region.stars, count: D.yieldFor(b.region.stars) };
      bus.emit('brew:ready', b.ready);
    }
  }
}

function sim(dt) {
  const st = game.state,
    hud = game.hud;
  st.world.clock += dt;
  if (st.mode === 'play') {
    st.stats.seconds += dt;
    if (st.player.levity > 0) st.player.levity = Math.max(0, st.player.levity - dt);
    if (st.player.regen > 0) {
      st.player.regen = Math.max(0, st.player.regen - dt);
      st.player.hp = Math.min(st.player.hpMax, st.player.hp + dt * 6);
    }
    if (hud.focus && hud.focus.hold != null) hud.focus.hold = Math.max(0, Math.min(1, hud.focus.hold + (keys.KeyE ? dt * 0.8 : -dt * 1.6)));
  } else if (st.mode === 'brew') simBrew(dt);
}
function syncHud() {
  const st = game.state,
    hud = game.hud;
  hud.held = st.inv.selected;
  hud.time = st.time.hour;
  hud.compass.marks = compassMarks(st);
}

// ---------------------------------------------------------------------------------------------
// Input the game owns (play, brew, photo). The UI's own listener takes the other modes first.
// ---------------------------------------------------------------------------------------------
const keys = {};
let loreAt = 0,
  mouseX = null;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  keys[e.code] = true;
  if (e.repeat || STILL) return;
  const st = game.state,
    m = st.mode,
    c = e.code;
  if (m === 'play') {
    if (c === 'Tab') actions.openBook();
    else if (c === 'KeyM') actions.openBook('map');
    else if (c === 'Escape') actions.pause();
    else if (c === 'KeyP') actions.photo(true);
    else if (/^Digit[1-7]$/.test(c)) actions.selectPotion(D.POTION_ORDER[Number(c.slice(5)) - 1]);
    else if (c === 'KeyQ') {
      const belt = D.POTION_ORDER.filter((id) => st.inv.potions[id] > 0);
      if (belt.length) actions.selectPotion(belt[(belt.indexOf(st.inv.selected) + 1) % belt.length]);
    } else if (c === 'KeyF') {
      const id = st.inv.selected;
      if (id && D.POTIONS[id].drink && st.inv.potions[id] > 0) {
        if (--st.inv.potions[id] <= 0) delete st.inv.potions[id];
        if (id === 'vitae') {
          st.player.regen = 10;
          bus.emit('heal', { amount: 30, hp: st.player.hp });
        } else st.player.levity = 12;
      }
    } else if (c === 'KeyH') hurt(18);
    else if (c === 'KeyK') die();
    else if (c === 'KeyG') game.hud.gloom = game.hud.gloom > 0.5 ? 0 : 0.85;
    else if (c === 'KeyB') enterBrew();
    else if (c === 'KeyL') readLore(D.LORE_ORDER[loreAt++ % D.LORE_ORDER.length]);
    else if (c === 'KeyN') {
      const i = D.QUEST_ORDER.indexOf(st.quest.stage);
      st.quest.stage = D.QUEST_ORDER[(i + 1) % D.QUEST_ORDER.length];
      bus.emit('quest', { stage: st.quest.stage });
    } else if (c === 'KeyE' && game.hud.focus && game.hud.focus.hold == null) {
      st.inv.ingredients.cinderbloom = (st.inv.ingredients.cinderbloom || 0) + 1;
      st.known.ingredients.cinderbloom = true;
      toast('pickup', 'Cinderbloom', '×1', { kind: 'ingredient', id: 'cinderbloom' });
    }
  } else if (m === 'brew') {
    if (c === 'Space') actions.brewPump(true);
    else if (c === 'KeyC') actions.brewDamp(true);
    else if (c === 'KeyB') actions.brewBottle();
    else if (c === 'KeyX') actions.brewEmpty();
    else if (c === 'Escape') actions.brewLeave();
  } else if (m === 'photo') {
    if (c === 'KeyP' || c === 'Escape') actions.photo(false);
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Space') actions.brewPump(false);
  else if (e.code === 'KeyC') actions.brewDamp(false);
});
window.addEventListener('mousemove', (e) => {
  if (STILL) return;
  const m = game.state.mode;
  if (m === 'play' && mouseX != null) game.hud.compass.heading += (e.clientX - mouseX) * 0.004;
  else if (m === 'brew' && e.clientX < innerWidth * 0.58) pot.stirTarget = Math.min(1, pot.stirTarget + Math.hypot(e.movementX, e.movementY) / 220);
  mouseX = e.clientX;
});

// ---------------------------------------------------------------------------------------------
// Backdrop: a still painting where the 3D view will be
// ---------------------------------------------------------------------------------------------
const SKIES = {
  night: { sky: ['#04050a', '#0a0e17', '#1b2231'], ridges: ['#151b27', '#0d1119', '#080a0f', '#040507'], fog: [150, 160, 185, 0.075], glow: null, stars: 1, window: 0.9 },
  dusk: { sky: ['#0c0d15', '#2b2530', '#8a5236'], ridges: ['#33272b', '#1f181c', '#110e11', '#070607'], fog: [200, 150, 120, 0.08], glow: [226, 120, 60, 0.34], stars: 0.25, window: 0.7 },
  day: { sky: ['#78828c', '#a8b0b5', '#cdd0cc'], ridges: ['#7f898d', '#5a6468', '#394144', '#1d2223'], fog: [230, 232, 230, 0.16], glow: null, stars: 0, window: 0 },
  gloom: { sky: ['#06040d', '#150d26', '#2b1a46'], ridges: ['#1d1232', '#120b20', '#0a0613', '#050309'], fog: [140, 100, 220, 0.1], glow: null, stars: 0, window: 0.5 },
};
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function paintWorld(x, w, h, kind) {
  const P = SKIES[kind] || SKIES.night;
  const hor = h * 0.6;
  let g = x.createLinearGradient(0, 0, 0, hor);
  g.addColorStop(0, P.sky[0]);
  g.addColorStop(0.55, P.sky[1]);
  g.addColorStop(1, P.sky[2]);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const r = lcg(7);
  if (P.stars) {
    for (let i = 0; i < 260; i++) {
      const sx = r() * w,
        sy = r() * hor * 0.9,
        a = r() * r() * 0.8 * P.stars * (1 - sy / hor);
      x.fillStyle = `rgba(215,222,240,${a.toFixed(3)})`;
      x.fillRect(sx, sy, r() < 0.12 ? 2 : 1, r() < 0.12 ? 2 : 1);
    }
  }
  if (P.glow) {
    g = x.createRadialGradient(w * 0.68, hor, 0, w * 0.68, hor, w * 0.5);
    g.addColorStop(0, `rgba(${P.glow[0]},${P.glow[1]},${P.glow[2]},${P.glow[3]})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  }
  const ridge = (y0, amp, seed, color) => {
    const q = lcg(seed);
    const ph = [q() * 6.28, q() * 6.28, q() * 6.28, q() * 6.28];
    const at = (px) => {
      const t = px / w;
      return y0 - amp * (0.55 * Math.sin(t * 3.1 + ph[0]) + 0.3 * Math.sin(t * 7.7 + ph[1]) + 0.12 * Math.sin(t * 19 + ph[2]) + 0.05 * Math.sin(t * 53 + ph[3]));
    };
    x.beginPath();
    x.moveTo(0, h);
    for (let px = 0; px <= w + 4; px += 4) x.lineTo(px, at(px));
    x.lineTo(w, h);
    x.closePath();
    x.fillStyle = color;
    x.fill();
    return at;
  };
  const fog = (y, hh) => {
    const f = P.fog;
    g = x.createLinearGradient(0, y - hh, 0, y + hh);
    g.addColorStop(0, `rgba(${f[0]},${f[1]},${f[2]},0)`);
    g.addColorStop(0.5, `rgba(${f[0]},${f[1]},${f[2]},${f[3]})`);
    g.addColorStop(1, `rgba(${f[0]},${f[1]},${f[2]},0)`);
    x.fillStyle = g;
    x.fillRect(0, y - hh, w, hh * 2);
  };
  ridge(h * 0.52, h * 0.1, 11, P.ridges[0]);
  fog(h * 0.57, h * 0.09);
  ridge(h * 0.61, h * 0.07, 23, P.ridges[1]);
  fog(h * 0.66, h * 0.08);
  const at3 = ridge(h * 0.7, h * 0.05, 37, P.ridges[2]);

  // the chapel on the third ridge, right of centre
  const cx = w * 0.71,
    u = h * 0.011,
    by = at3(cx) + u * 1.5;
  x.fillStyle = P.ridges[2];
  x.beginPath();
  x.moveTo(cx - 9 * u, by);
  x.lineTo(cx - 9 * u, by - 8 * u);
  x.lineTo(cx - 3.5 * u, by - 13 * u);
  x.lineTo(cx + 2 * u, by - 8 * u);
  x.lineTo(cx + 2 * u, by - 19 * u);
  x.lineTo(cx + 3.6 * u, by - 21.5 * u);
  x.lineTo(cx + 5 * u, by - 18 * u);
  x.lineTo(cx + 6.4 * u, by - 20 * u);
  x.lineTo(cx + 7.6 * u, by - 17.5 * u);
  x.lineTo(cx + 7.6 * u, by);
  x.closePath();
  x.fill();
  if (P.window) {
    g = x.createRadialGradient(cx - 3.5 * u, by - 5 * u, 0, cx - 3.5 * u, by - 5 * u, 16 * u);
    g.addColorStop(0, `rgba(240,140,60,${(0.26 * P.window).toFixed(2)})`);
    g.addColorStop(1, 'rgba(240,140,60,0)');
    x.fillStyle = g;
    x.fillRect(cx - 20 * u, by - 22 * u, 34 * u, 34 * u);
    x.fillStyle = `rgba(255,176,96,${P.window})`;
    x.beginPath();
    x.moveTo(cx - 4.2 * u, by - 3 * u);
    x.lineTo(cx - 4.2 * u, by - 6.4 * u);
    x.lineTo(cx - 3.5 * u, by - 7.6 * u);
    x.lineTo(cx - 2.8 * u, by - 6.4 * u);
    x.lineTo(cx - 2.8 * u, by - 3 * u);
    x.closePath();
    x.fill();
  }
  fog(h * 0.76, h * 0.07);
  ridge(h * 0.86, h * 0.045, 51, P.ridges[3]);

  // bare trees in the foreground
  const tree = (tx, ty, len, ang, depth, lw) => {
    if (depth <= 0 || len < 2) return;
    const ex = tx + Math.cos(ang) * len,
      ey = ty + Math.sin(ang) * len;
    x.lineWidth = lw;
    x.beginPath();
    x.moveTo(tx, ty);
    x.lineTo(ex, ey);
    x.stroke();
    tree(ex, ey, len * (0.62 + r() * 0.16), ang - 0.3 - r() * 0.5, depth - 1, lw * 0.62);
    tree(ex, ey, len * (0.62 + r() * 0.16), ang + 0.25 + r() * 0.5, depth - 1, lw * 0.62);
  };
  x.strokeStyle = P.ridges[3];
  x.lineCap = 'round';
  tree(w * 0.09, h * 0.9, h * 0.2, -1.5, 7, h * 0.012);
  tree(w * 0.93, h * 0.92, h * 0.17, -1.66, 6, h * 0.01);
  tree(w * 0.43, h * 0.9, h * 0.07, -1.5, 5, h * 0.005);
}
function paintForge(x, w, h) {
  x.fillStyle = '#060608';
  x.fillRect(0, 0, w, h);
  const r = lcg(3);
  // stone courses
  for (let j = 0; j < 12; j++) {
    const y = (j / 12) * h * 0.74;
    for (let i = -1; i < 16; i++) {
      const bw = w / 14,
        bx = i * bw + (j % 2 ? bw / 2 : 0);
      x.fillStyle = `rgba(190,180,170,${(0.012 + r() * 0.03).toFixed(3)})`;
      x.fillRect(bx + 2, y + 2, bw - 4, (h * 0.74) / 12 - 4);
    }
  }
  const cx = w * 0.29,
    cy = h * 0.6;
  let g = x.createRadialGradient(cx, h * 0.86, 0, cx, h * 0.86, w * 0.42);
  g.addColorStop(0, 'rgba(240,120,40,0.42)');
  g.addColorStop(0.35, 'rgba(180,70,20,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  // floor
  g = x.createLinearGradient(0, h * 0.74, 0, h);
  g.addColorStop(0, 'rgba(8,7,8,0.9)');
  g.addColorStop(1, 'rgba(3,3,4,1)');
  x.fillStyle = g;
  x.fillRect(0, h * 0.74, w, h * 0.26);
  // embers under the pot
  for (let i = 0; i < 46; i++) {
    const ex = cx + (r() - 0.5) * w * 0.2,
      ey = h * 0.86 + (r() - 0.5) * h * 0.05;
    x.fillStyle = `rgba(255,${(120 + r() * 90) | 0},50,${(0.25 + r() * 0.6).toFixed(2)})`;
    x.beginPath();
    x.arc(ex, ey, 1 + r() * h * 0.006, 0, 6.283);
    x.fill();
  }
  // the pot
  const rx = w * 0.135,
    ry = h * 0.062;
  g = x.createLinearGradient(cx - rx, 0, cx + rx, 0);
  g.addColorStop(0, '#0a0909');
  g.addColorStop(0.3, '#1b1817');
  g.addColorStop(0.55, '#100e0e');
  g.addColorStop(1, '#050505');
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(cx - rx, cy);
  x.bezierCurveTo(cx - rx * 1.16, cy + h * 0.2, cx - rx * 0.6, cy + h * 0.27, cx, cy + h * 0.27);
  x.bezierCurveTo(cx + rx * 0.6, cy + h * 0.27, cx + rx * 1.16, cy + h * 0.2, cx + rx, cy);
  x.closePath();
  x.fill();
  x.fillStyle = '#17120f';
  x.beginPath();
  x.ellipse(cx, cy, rx, ry, 0, 0, 6.283);
  x.fill();
  g = x.createRadialGradient(cx - rx * 0.2, cy - ry * 0.2, 0, cx, cy, rx);
  g.addColorStop(0, '#f5a04a');
  g.addColorStop(0.5, '#b8501c');
  g.addColorStop(1, '#3a1608');
  x.fillStyle = g;
  x.beginPath();
  x.ellipse(cx, cy + ry * 0.08, rx * 0.9, ry * 0.82, 0, 0, 6.283);
  x.fill();
  x.strokeStyle = 'rgba(255,220,170,0.28)';
  x.lineWidth = 1.5;
  for (const k of [0.3, 0.52, 0.72]) {
    x.beginPath();
    x.ellipse(cx + rx * 0.05, cy + ry * 0.08, rx * k, ry * k * 0.8, 0.2, 0.4, 3.6);
    x.stroke();
  }
  x.strokeStyle = 'rgba(255,190,130,0.3)';
  x.lineWidth = 2;
  x.beginPath();
  x.ellipse(cx, cy, rx, ry, 0, 3.4, 6.0);
  x.stroke();
  // steam
  for (let i = 0; i < 9; i++) {
    const sx = cx + (r() - 0.5) * rx * 1.4,
      sy = cy - h * (0.06 + r() * 0.3),
      sr = h * (0.05 + r() * 0.09);
    g = x.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g.addColorStop(0, 'rgba(255,190,140,0.05)');
    g.addColorStop(1, 'rgba(255,190,140,0)');
    x.fillStyle = g;
    x.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
}
function paintBackdrop(kind) {
  const cv = document.getElementById('bg');
  const w = (cv.width = Math.max(2, innerWidth)),
    h = (cv.height = Math.max(2, innerHeight));
  const x = cv.getContext('2d');
  if (kind === 'forge') paintForge(x, w, h);
  else paintWorld(x, w, h, kind);
  const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.56);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------------------------
// Stand-ins for the game's thumbnails and its map image
// ---------------------------------------------------------------------------------------------
const iconCache = {};
function fakeIcon(kind, id) {
  const key = kind + ':' + id;
  if (iconCache[key]) return iconCache[key];
  const col = kind === 'ingredient' ? D.INGREDIENTS[id] && D.INGREDIENTS[id].color : kind === 'potion' ? D.POTIONS[id] && D.POTIONS[id].color : kind === 'prime' ? D.PRIME_ITEMS[id] && D.PRIME_ITEMS[id].color : '#c4121f';
  if (!col) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(100, 92, 6, 128, 132, 112);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.16, col);
  g.addColorStop(1, '#09090b');
  x.fillStyle = g;
  x.beginPath();
  if (kind === 'potion') {
    x.moveTo(108, 26);
    x.lineTo(148, 26);
    x.lineTo(148, 86);
    x.bezierCurveTo(210, 108, 216, 200, 128, 230);
    x.bezierCurveTo(40, 200, 46, 108, 108, 86);
    x.closePath();
  } else if (kind === 'prime' || kind === 'stone') {
    x.moveTo(128, 20);
    x.lineTo(208, 92);
    x.lineTo(176, 226);
    x.lineTo(80, 226);
    x.lineTo(48, 92);
    x.closePath();
  } else x.arc(128, 132, 94, 0, 6.2832);
  x.fill();
  return (iconCache[key] = c);
}
async function loadMap() {
  // the survey drawn by src/world/mapimage.js, when a capture of it is lying about; else a sketch
  try {
    const img = new Image();
    img.src = '/shots/map_check.jpg';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    c.getContext('2d').drawImage(img, 0, 0, 1024, 1024);
    return c;
  } catch (e) {
    const c = document.createElement('canvas');
    c.width = c.height = 768;
    const x = c.getContext('2d');
    x.fillStyle = '#0c0e13';
    x.fillRect(0, 0, 768, 768);
    x.fillStyle = '#4a443a';
    x.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * 6.2832;
      const rr = 300 * (1 + 0.08 * Math.sin(3 * a + 1) + 0.05 * Math.sin(5 * a));
      x.lineTo(384 + Math.cos(a) * rr, 384 + Math.sin(a) * rr);
    }
    x.fill();
    x.fillStyle = '#8f877f';
    x.fillRect(84, 300, 180, 220);
    x.fillStyle = '#0b0d12';
    x.beginPath();
    x.arc(600, 434, 72, 0, 6.2832);
    x.fill();
    return c;
  }
}

// ---------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------
// Sent to the body, as real key presses are: listeners on window then run capture first, which is
// the order the UI relies on to take a key before the game sees it.
const press = (...codes) => codes.forEach((code) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true })));
const st = () => game.state;
function brewSet(contents, o = {}) {
  const b = game.brew;
  b.active = true;
  for (const id of contents) {
    if (!id.startsWith('prime:') && b.mix) b.trail.push(b.mix.slice());
    b.contents.push(id);
    brewRecalc();
  }
  Object.assign(b, o);
  brewRecalc();
  if (o.opus) {
    b.opus = o.opus;
    b.band = D.OPUS.stages[Math.min(3, o.opus.stage)].heat;
  }
  b.fit = b.band ? D.heatFit(b.heat, b.band) : null;
  game.state.mode = 'brew';
}

// name -> { bg, small (also captured at 900 x 600), seek (ms into the CSS animations), run() -> after() }
const SCENES = {
  loading: {
    bg: 'night',
    run() {
      const p = Number(Q.get('p') || 0.62);
      return () => {
        if (STILL) return bus.emit('loading', { progress: p, label: 'Raising the isle' });
        let t = 0;
        const labels = ['Raising the isle', 'Planting the Saltwood', 'Filling the Mere', 'Lighting the fires'];
        const id = setInterval(() => {
          t = Math.min(1, t + 0.012);
          bus.emit('loading', { progress: t, label: labels[Math.min(3, (t * 4) | 0)] });
          if (t >= 1) clearInterval(id);
        }, 50);
      };
    },
  },
  title: { bg: 'night', small: true, run() {} },
  'title-continue': { bg: 'night', run: () => void (save = true) },
  'title-settings': { bg: 'night', small: true, run: () => () => press('ArrowDown', 'Enter', 'ArrowDown', 'ArrowDown') },
  'title-controls': { bg: 'night', small: true, run: () => () => press('ArrowDown', 'ArrowDown', 'Enter') },
  'title-confirm': {
    bg: 'night',
    run() {
      save = true;
      return () => press('ArrowDown', 'Enter');
    },
  },

  hud: {
    bg: 'dusk',
    small: true,
    run() {
      mid(st());
      Object.assign(game.hud, { focus: { verb: 'Gather', name: 'Mirrorlily', key: 'E', hold: null }, crosshair: 'ring' });
      game.hud.compass.heading = 0.72;
      return () => {
        toast('pickup', 'Weepcap', '×2', { kind: 'ingredient', id: 'weepcap' });
        toast('pickup', 'Mirrorlily', '×1', { kind: 'ingredient', id: 'mirrorlily' });
      };
    },
  },
  'hud-start': {
    bg: 'night',
    run() {
      st().mode = 'play';
      st().player.z = 290;
      Object.assign(game.hud, { crosshair: 'dot', hint: 'Hold Shift to run.' });
      game.hud.compass.heading = 0.05;
    },
  },
  'hud-aim': {
    bg: 'dusk',
    small: true,
    run() {
      mid(st());
      st().inv.selected = 'rime';
      Object.assign(game.hud, { crosshair: 'aim', hint: 'Release to throw.' });
      game.hud.compass.heading = 1.1;
    },
  },
  'hud-hurt': {
    bg: 'gloom',
    run() {
      mid(st());
      st().player.hp = 24;
      st().player.levity = 7;
      st().player.regen = 4.5;
      Object.assign(game.hud, { crosshair: 'dot', gloom: 0.85 });
      return () => {
        st().player.levity = 5.2;
        bus.emit('hurt', { amount: 26, hp: 24 });
        toast('warn', 'The Gloom is on you', 'Flame unmakes the Shades. Cold holds them still.');
      };
    },
  },
  'hud-hold': {
    bg: 'night',
    run() {
      mid(st());
      Object.assign(game.hud, { focus: { verb: 'Rest', name: 'Lantern of the dead', key: 'E', hold: 0.64 }, crosshair: 'ring' });
    },
  },
  'hud-card': {
    bg: 'dusk',
    small: true,
    run() {
      early(st());
      st().quest.stage = 'arrive';
      // named in the view model only, with no region event: the HUD announces it all the same
      return () => (game.hud.region = 'vale');
    },
  },
  'hud-discover': {
    bg: 'night',
    run() {
      mid(st());
      return () => bus.emit('discover', { kind: 'potion', id: 'rime' });
    },
  },
  'hud-ingredient': {
    bg: 'dusk',
    run() {
      mid(st());
      return () => bus.emit('discover', { kind: 'ingredient', id: 'corpselight' });
    },
  },
  'hud-prime': {
    bg: 'night',
    run() {
      mid(st());
      st().inv.primes.mercury = true;
      return () => bus.emit('prime', { id: 'mercury' });
    },
  },
  'hud-toasts': {
    bg: 'dusk',
    run() {
      mid(st());
      return () => {
        toast('quest', 'The three Primes', 'Recover the pure Primes from under the Gloom.');
        toast('lore', 'Of stillness', 'A page is added to the book.');
        toast('pickup', 'Saltwort', '×3', { kind: 'ingredient', id: 'saltwort' });
        toast('info', 'The road is barred by briar', 'Flame would clear it.');
        bus.emit('quest', { stage: 'primes' });
        bus.emit('save', {});
      };
    },
  },
  'hud-day': {
    bg: 'day',
    run() {
      mid(st());
      Object.assign(game.hud, { focus: { verb: 'Gather', name: 'Saltwort', key: 'E', hold: null }, crosshair: 'ring', hint: 'Saltwort grows on graves. It is in nearly every recipe.' });
      game.hud.compass.heading = -0.4;
      return () => toast('pickup', 'Saltwort', '×2', { kind: 'ingredient', id: 'saltwort' });
    },
  },

  'brew-empty': {
    bg: 'forge',
    run() {
      early(st());
      st().inv.ingredients = { cinderbloom: 3, saltwort: 3 };
      brewSet([], { fire: 0.12, heat: 0.1 });
    },
  },
  'brew-mix': {
    bg: 'forge',
    run() {
      mid(st());
      brewSet(['cinderbloom', 'saltwort'], { fire: 0.22, heat: 0.18 });
    },
  },
  'brew-binding': {
    bg: 'forge',
    small: true,
    run() {
      mid(st());
      st().inv.ingredients.brimstone = 1;
      st().known.ingredients.brimstone = true;
      brewSet(['cinderbloom', 'cinderbloom', 'brimstone'], { fire: 0.93, heat: 0.84, stir: 0.8, progress: 0.62 });
    },
  },
  'brew-ready': {
    bg: 'forge',
    small: true,
    run() {
      mid(st());
      brewSet(['mirrorlily', 'halite', 'mirrorlily'], { fire: 0.16, heat: 0.2, stir: 0.3, progress: 1 });
      game.brew.ready = { potion: 'rime', stars: 3, count: 4 };
    },
  },
  'brew-unknown': {
    bg: 'forge',
    run() {
      early(st());
      st().inv.ingredients = { cinderbloom: 2, saltwort: 3, mirrorlily: 2 };
      st().known.ingredients.mirrorlily = true;
      brewSet(['mirrorlily', 'mirrorlily'], { fire: 0.5, heat: 0.46 });
    },
  },
  'brew-hover': {
    bg: 'forge',
    run() {
      mid(st());
      brewSet(['cinderbloom'], { fire: 0.4, heat: 0.36 });
      return () => {
        const b = document.querySelector('.tp-shelf-item[aria-label="Saltwort"]');
        if (b) b.dispatchEvent(new PointerEvent('pointerenter'));
      };
    },
  },
  'brew-opus-begin': {
    bg: 'forge',
    run() {
      late(st());
      brewSet(['prime:salt', 'prime:mercury'], { fire: 0.3, heat: 0.26 });
    },
  },
  'brew-opus': {
    bg: 'forge',
    small: true,
    run() {
      late(st());
      brewSet(['prime:salt', 'prime:mercury', 'prime:sulfur'], { fire: 0.74, heat: 0.67, stir: 0.8, opus: { stage: 2, progress: 0.56, done: false } });
    },
  },
  'brew-opus-done': {
    bg: 'forge',
    run() {
      late(st());
      brewSet(['prime:salt', 'prime:mercury', 'prime:sulfur'], { fire: 0.96, heat: 0.93, stir: 0.2, opus: { stage: 3, progress: 1, done: true } });
    },
  },

  'book-journal': { bg: 'dusk', small: true, run: () => (mid(st()), () => actions.openBook('journal')) },
  'book-journal-early': { bg: 'night', run: () => (early(st()), () => actions.openBook('journal')) },
  'book-journal-late': { bg: 'night', run: () => (done(st()), (st().inv.stone = false), () => actions.openBook('journal')) },
  'book-chart': { bg: 'dusk', small: true, run: () => (mid(st()), () => (actions.openBook('chart'), press('ArrowDown', 'ArrowDown'))) },
  'book-chart-early': { bg: 'night', run: () => (early(st()), () => actions.openBook('chart')) },
  'book-chart-late': { bg: 'night', run: () => (late(st()), () => (actions.openBook('chart'), press('ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'))) },
  'book-ingredients': { bg: 'dusk', small: true, run: () => (mid(st()), () => (actions.openBook('ingredients'), press('ArrowDown', 'ArrowDown', 'ArrowDown'))) },
  'book-ingredients-late': { bg: 'night', run: () => (late(st()), () => (actions.openBook('ingredients'), press('ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'))) },
  'book-lore': { bg: 'dusk', small: true, run: () => (mid(st()), () => (actions.openBook('lore'), press('ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp'))) },
  'book-lore-short': { bg: 'night', run: () => (mid(st()), () => actions.openBook('lore')) },
  'book-map': { bg: 'dusk', small: true, run: () => (mid(st()), () => actions.openBook('map')) },
  'book-map-late': { bg: 'night', run: () => (late(st()), () => (actions.openBook('map'), press('ArrowDown', 'ArrowDown'))) },
  'book-map-plain': { bg: 'night', nomap: true, run: () => (mid(st()), () => (actions.openBook('map'), press('ArrowDown', 'ArrowDown'))) },

  lore: { bg: 'night', small: true, run: () => (early(st()), (st().known.charted = {}), (st().known.lore = {}), () => readLore('letter')) },
  'lore-short': { bg: 'night', run: () => (mid(st()), () => readLore('thunder')) },

  pause: { bg: 'dusk', small: true, run: () => (mid(st()), () => actions.pause()) },
  'pause-settings': { bg: 'dusk', small: true, run: () => (mid(st()), () => (actions.pause(), press('ArrowDown', 'Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'))) },
  'pause-controls': { bg: 'dusk', run: () => (mid(st()), () => (actions.pause(), press('ArrowDown', 'ArrowDown', 'Enter'))) },
  'pause-confirm': { bg: 'dusk', run: () => (mid(st()), () => (actions.pause(), press('ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter'))) },

  dead: {
    bg: 'gloom',
    small: true,
    seek: 4200,
    run() {
      mid(st());
      game.hud.gloom = 0.9;
      st().player.hp = 6;
      return () => die();
    },
  },
  'ending-text': { bg: 'dusk', seek: 2300, run: () => (done(st()), () => (setMode('cutscene'), bus.emit('ending', { phase: 'text' }))) },
  'ending-text-last': { bg: 'dusk', seek: 13300, run: () => (done(st()), () => (setMode('cutscene'), bus.emit('ending', { phase: 'text' }))) },
  'ending-credits': { bg: 'dusk', small: true, run: () => (done(st()), () => (setMode('cutscene'), bus.emit('ending', { phase: 'credits' }))) },
  photo: { bg: 'dusk', run: () => (mid(st()), () => actions.photo(true)) },
  cutscene: { bg: 'night', seek: 1200, run: () => (mid(st()), () => setMode('cutscene')) },
};

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
const scene = SCENES[SCENE] || SCENES.title;
const bgKind = Q.get('bg') || scene.bg || 'night';

const UIDEV = (window.UIDEV = {
  game,
  ui: null,
  done: false,
  list: Object.keys(SCENES).map((name) => ({ name, small: !!SCENES[name].small, seek: SCENES[name].seek || 1500 })),
  /** Jump every CSS animation to `ms` and finish every transition: a settled frame, at once. */
  seek(ms) {
    for (const a of document.getAnimations()) {
      try {
        if (typeof CSSTransition === 'function' && a instanceof CSSTransition) a.finish();
        else a.currentTime = ms;
      } catch (e) {
        /* an animation that cannot be moved is left alone */
      }
    }
  },
  readLore,
  hurt,
  die,
  enterBrew,
  toast,
});

const frames = (n) => new Promise((res) => {
  const step = () => (--n <= 0 ? res() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});

async function boot() {
  paintBackdrop(bgKind);
  window.addEventListener('resize', () => paintBackdrop(bgKind));
  if (document.fonts && document.fonts.load) {
    const faces = ['400 20px "Cormorant Garamond"', 'italic 400 20px "Cormorant Garamond"', '500 20px "Cormorant Garamond"', 'italic 500 20px "Cormorant Garamond"', '500 12px Inter', '600 12px Inter'];
    await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null)));
  }
  if (WANT_ICONS) game.icons.get = fakeIcon;
  if (WANT_MAP && !scene.nomap) game.map.canvas = await loadMap();

  const after = scene.run();
  syncHud();
  const ui = (UIDEV.ui = createUI(game));

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!STILL) sim(dt);
    syncHud();
    ui.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  await frames(3);
  if (typeof after === 'function') after();
  await frames(4);

  const pick = document.getElementById('dev-pick');
  if (pick && !STILL) {
    for (const name of Object.keys(SCENES)) pick.append(new Option(name, name, false, name === SCENE));
    pick.hidden = false;
    pick.addEventListener('change', () => {
      Q.set('scene', pick.value);
      location.search = Q.toString();
    });
  }
  UIDEV.done = true;
}
boot().catch((e) => {
  console.error('[ui dev] boot failed', e);
  UIDEV.done = true;
});
