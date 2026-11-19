// Half a minute of play, in eight takes: the title and the landing, the first steps, gathering,
// the cauldron, the briar gate, a Shade, the rockfall, the Brimstone Scar.
//   node tools/film.mjs tools/films/letsplay.mjs              the film: shots/film/letsplay.mp4
//   node tools/film.mjs tools/films/letsplay.mjs --novideo 1 --sheet 0.25 --shot jpeg
//                                                             stills only, for looking through
//   ... --only gate,shade                                     some of the takes
// It is the game itself that is filmed: every take is played by pressing the game's own keys and
// moving its own mouse (tools/film.mjs). What is arranged is what an editor arranges. Between
// takes the apprentice is carried to the next place and given what the road there would have
// given; the waiting is cut out (the fire coming up under the pot, the walk down the canyon); the
// haunts a walker would have met and unmade on the way do not rise; the name of the Scar is asked
// for at the sight it is named for and not where the region begins; and one piece of music runs
// under the whole film, the title theme set out in sixteen bars, so that the cuts fall on its
// beats and the blast on its last downbeat. In the game every place has its own piece.

const SEED = 7;
const BAR = (3 * 60) / 84; // the title theme: three beats at 84
const BEAT = BAR / 3;
const M0 = 0.1; // the band sits down a tenth of a second after it is asked
/** The film time of a beat of the theme; bars and beats are counted from 1. */
const at = (bar, beat = 1) => M0 + (bar - 1) * BAR + (beat - 1) * BEAT;
const LENGTH = Math.round(at(16) * 60) / 60; // sixteen bars: 32.25 s

const T = {
  title: 0,
  glide: at(2), // the cut inside the black after "Begin"
  steps: at(3), // the theme comes in as the apprentice is given their feet
  gather: at(4, 2),
  pot: at(6),
  bind: at(7, 3),
  gate: at(9),
  shade: at(11), // the full band
  rock: at(13),
  blast: at(14), // the last downbeat
  scar: at(15), // the held chord
};

// The hour of the island's day each take is played at (--hours gate=10,rock=15 to try others).
const HOURS = { gather: 16.75, pot: 17.3, gate: 17.9, shade: 16.6, rock: 15, scar: 17.5 };

// With --only the takes do not start where they do in the film: OFF is how far ahead the film's
// clock is of the take's own.
let OFF = 0;
const until = (f, t) => f.until(t + OFF);
const now = (f) => f.t - OFF;

// ---------------------------------------------------------------------------------------------
// In the page
// ---------------------------------------------------------------------------------------------
/** Runs once in the page, before the film begins. */
async function install() {
  const g = TP.game,
    st = g.state,
    A = g.audio;
  const F = (window.F = {});
  // A plain pointer lock. A raw one hands the page the real mouse of this machine, film or no film.
  g.input.raw = false;

  // --- the music: the title theme in fourteen bars, and nobody else chooses a piece
  const { PIECES } = await import('/src/audio/score.js');
  const P = PIECES.title;
  const lute = "R F R' T' F R'",
    lute2 = "R F R' T' F' T'";
  const first = '5, - 1 | 3 - 1 | 5 - 4 | 2 - -',
    second = '5, - 1 | 3 - 4 | 5 4 2 | 1 - -';
  Object.assign(P.sections, {
    F0: { prog: '1 | 5s', dyn: 'mf', pad: true, lute, bass: 'R - -', toll: '1 | .' },
    F1: { prog: '1 | 6 | 3 | 7', dyn: 'mp', pad: true, lute, bass: 'R - -', viol: first },
    F2: { prog: '1 | 6 | 5M | 1', dyn: 'mf', pad: true, lute: lute2, bass: 'R - -', viol: second, flute: '=viol', choir: true },
    F3: { prog: '1 | 6 | 5M | 1', pad: true, lute: lute2, bass: 'R - F', viol: second, flute: '=viol', choir: true, bell: "1' . . | . | 5' . . | 1' . .", toll: '1 | . | . | 1', drum: 'B . . | . . b | B . b | B . .' },
    F4: { prog: '1 | 1', dyn: 'p', pad: true, choir: true },
  });
  P.form = ['F0', 'F1', 'F2', 'F3', 'F4'];
  P.loop = 4;
  F.setMusic = A.setMusic;
  A.setMusic = () => {};
  F.music = () => F.setMusic('title', { intensity: 1, at: 0 });

  // --- between takes
  /** Take down the cards and toasts of the take before. */
  F.clear = () => g.bus.emit('death', {});
  /** The haunts were unmade on the way: none rises for the length of a take. */
  F.quiet = () => {
    g.shades.reset();
    for (const s of g.shades.list) s.wait = 600;
  };
  /** These places are not announced when the apprentice is set down in them. */
  F.know = (...regions) => {
    for (const r of regions) {
      st.known.regions[r] = true;
      g._regionSaid[r] = st.world.clock;
    }
  };
  F.me = () => {
    const p = g.player.pos;
    return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), region: g.region, mode: st.mode, hp: st.player.hp, stage: st.quest.stage, hour: +st.time.hour.toFixed(2), potions: { ...st.inv.potions }, sel: st.inv.selected, tip: g.quests.tip };
  };
  /** Stand `dist` from (tx, tz) on the side of (fx, fz), facing it. */
  F.face = (tx, tz, fx, fz, dist, pitch = 0) => {
    const dx = fx - tx,
      dz = fz - tz,
      l = Math.hypot(dx, dz) || 1;
    const x = tx + (dx / l) * dist,
      z = tz + (dz / l) * dist;
    TP.go(x, z, (Math.atan2(tx - x, -(tz - z)) * 180) / Math.PI, pitch);
    return { x, z };
  };

  // --- the throw
  const SPEED = 15.5,
    G = 12;
  /** Where to look so that a phial thrown from here comes down on `to`: a point 30 m along that line. */
  F.solve = (to) => {
    const cam = g.engine.camera.position;
    let h = Math.atan2(to.x - cam.x, -(to.z - cam.z)),
      p = 0;
    const fly = (p) => {
      const cp = Math.cos(p);
      const x0 = cam.x + Math.sin(h) * cp * 0.35 + Math.cos(h) * 0.2,
        y0 = cam.y + Math.sin(p) * 0.35 - 0.14,
        z0 = cam.z - Math.cos(h) * cp * 0.35 + Math.sin(h) * 0.2;
      const t = Math.hypot(to.x - x0, to.z - z0) / (SPEED * cp);
      return { y: y0 + (SPEED * Math.sin(p) + 1.7) * t - 0.5 * G * t * t, x0, z0, t };
    };
    for (let it = 0; it < 5; it++) {
      let lo = -0.7,
        hi = 0.7;
      for (let i = 0; i < 40; i++) {
        p = (lo + hi) / 2;
        if (fly(p).y < to.y) lo = p;
        else hi = p;
      }
      const r = fly(p);
      h = Math.atan2(to.x - r.x0, -(to.z - r.z0));
    }
    const cp = Math.cos(p);
    return { x: cam.x + Math.sin(h) * cp * 30, y: cam.y + Math.sin(p) * 30, z: cam.z - Math.cos(h) * cp * 30, heading: h, pitch: p, t: fly(p).t };
  };
  /** Frames a phial let go now would be in the air, the frame of the throw included. */
  F.flight = () => {
    const P = g.potions,
      s = P.launch({});
    const dt = 1 / 60;
    for (let n = 1; n < 900; n++) {
      const sub = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy, s.vz) * dt) / 0.5));
      for (let k = 0; k < sub; k++) {
        const x0 = s.x,
          y0 = s.y,
          z0 = s.z;
        if (P.step(s, dt / sub) || g.shades.hitSegment(x0, y0, z0, s.x, s.y, s.z)) return n;
      }
    }
    return 900;
  };
  return Object.keys(P.sections).join(' ');
}

// ---------------------------------------------------------------------------------------------
// The takes
// ---------------------------------------------------------------------------------------------
/** A key pressed between takes, where nothing is filmed. */
async function quietTap(f, code, frames = 4) {
  f.down(code);
  await f.frames(frames, true);
  f.up(code);
  await f.frames(1, true);
}

/**
 * Set down in a new place, unfilmed: the game names the place as it would for anyone who walked
 * in, and that card, with the toasts of the take before, is taken down before the film looks.
 */
async function settle(f, secs) {
  await f.preroll(0.6);
  await f.ev(() => F.clear());
  if (secs > 0.6) await f.preroll(secs - 0.6);
}

/** The title, the pointer finding "Begin", the dark, and the boat coming in. */
async function title(f) {
  // the title's own first fade from black, and the interface settling, before the clock starts
  await f.ev(() => TP.step(110, 1 / 30));
  await new Promise((r) => setTimeout(r, 1600));
  const begin = await f.ev(() => {
    const b = [...document.querySelectorAll('.tp-title .tp-menu-item')].find((q) => q.textContent.trim() === 'Begin');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.55 };
  });
  await f.page.mouse.move(f.W * 0.47, f.H * 0.62);
  await f.ev(() => window.__film.pointer(true));
  await f.begin(LENGTH, SEED);
  await f.ev(() => F.music());
  f.cut('title');
  await f.wait(0.4);
  f.glide(begin.x, begin.y, 0.95, 0.1);
  await until(f, 1.5);
  await f.click();
  await f.ev(() => window.__film.pointer(false));
  await until(f, T.glide);

  // in the dark the island is raised; the film comes back for the end of the glide
  const frames = Math.round(T.steps * f.fps) - Math.round(T.glide * f.fps);
  const want = 9.5 - frames / f.fps;
  const cut = await f.ev(() => TP.game._cut.t);
  await f.frames(Math.max(0, Math.round((want - cut) * f.fps)), true);
  await f.ev(() => {
    const g = TP.game;
    g._fade.v = 1;
    g.fadeTo(0, 1.0);
  });
  f.cut('the landing');
  await until(f, T.steps);
}

/** First steps on the Grey Landing. */
async function steps(f) {
  f.cut('first steps');
  await f.wait(0.3);
  f.down('KeyW');
  f.turn(-16, 3, 1.0, 0.25);
  await f.wait(1.15);
  f.down('ShiftLeft');
  f.turn(34, -2, 1.25, 0.05);
  await until(f, T.gather);
  f.up('KeyW', 'ShiftLeft');
  console.log('  ', JSON.stringify(await f.ev(() => F.me())));
}

/** The scorched ground under the chapel: Cinderbloom, three times, walking up the hill. */
async function gather(f) {
  await f.ev((hour) => {
    const g = TP.game,
      st = g.state;
    F.clear();
    st.known.lore.letter = true;
    st.quest.stage = 'gather';
    g.quests._walked = 100;
    g.quests._shown.book = 100;
    F.know('shore', 'vale');
    TP.hour(hour);
    const near = (x, z) => g.ents.plants.filter((p) => p.id === 'cinderbloom' && !p.picked).sort((a, b) => Math.hypot(a.top.x - x, a.top.z - z) - Math.hypot(b.top.x - x, b.top.z - z))[0];
    // three that lie in an arc round the stake, clear of it and of the fallen timber
    const a = near(-29.9, 99.5),
      b = near(-26.4, 98.6),
      c = near(-24.8, 96.8);
    F.blooms = [a, b, c].map((p) => ({ x: p.top.x, y: p.top.y, z: p.top.z }));
    // from below the pyre, looking up the hill past the first of them
    const dx = F.blooms[0].x - -31.3,
      dz = F.blooms[0].z - 104.6;
    F.stand = () => TP.go(-31.3, 104.6, (Math.atan2(dx, -dz) * 180) / Math.PI, -9);
    F.stand();
  }, HOURS.gather);
  f.down('KeyW');
  await settle(f, 1.2);
  // (the pre-roll walked: come back to the mark, in stride)
  await f.ev(() => F.stand());
  await f.preroll(0.25);
  f.cut('gathering');
  const blooms = await f.ev(() => F.blooms);
  for (let i = 0; i < blooms.length; i++) {
    const b = blooms[i];
    // the eye rests above the flower, on the hill beyond it: the hand finds it all the same
    f.aimAt({ x: b.x, y: b.y + 0.7, z: b.z }, i ? 0.42 : 0.5, { hold: 3 });
    f.down('KeyW');
    // walk up to it, stop short, wait for the hand to find it
    for (let n = 0; n < 240; n++) {
      await f.frames(1);
      if (Math.hypot(f.state.x - b.x, f.state.z - b.z) < 2.0) break;
    }
    f.up('KeyW');
    for (let n = 0; n < 90 && !(f.state.focus || '').includes('Cinderbloom'); n++) await f.frames(1);
    await f.wait(0.13);
    await f.tap('KeyE', 5);
    console.log(`  picked ${i + 1} at ${now(f).toFixed(2)} (take ${(now(f) - T.gather).toFixed(2)}) from ${f.state.x.toFixed(1)}, ${f.state.z.toFixed(1)}`);
    await f.wait(0.12);
    f.noAim();
    if (now(f) > T.pot - 0.75) break;
  }
  // and up to the chapel, where the pot is
  f.aimAt({ x: -10, y: 27, z: 70 }, 0.7, { hold: 2 });
  await until(f, T.pot);
  f.noAim();
  console.log('  ', JSON.stringify(await f.ev(() => F.me())));
}

/** The cauldron: three blooms, the bellows, the ladle; the fire coming up is cut out. */
async function pot(f) {
  await f.ev((hour) => {
    const g = TP.game,
      st = g.state;
    F.clear();
    st.known.lore.letter = true;
    st.known.ingredients.cinderbloom = st.known.ingredients.saltwort = st.known.ingredients.weepcap = true;
    st.inv.ingredients = { cinderbloom: 3, saltwort: 2, weepcap: 1 };
    st.quest.stage = 'brew';
    g.quests._walked = 100;
    F.know('shore', 'vale');
    TP.hour(hour);
    const c = g.world.named.cauldron;
    g.player.teleport(c.x, c.y + 0.1, c.z + 2.2, 0, -0.3);
  }, HOURS.pot);
  await settle(f, 0.9);
  await quietTap(f, 'KeyE');
  await f.preroll(0.2);
  // the pointer comes back with the pot
  await f.page.mouse.move(f.W * 0.56, f.H * 0.58);
  await f.ev(() => window.__film.pointer(true));
  // a few strokes of the bellows first: there has to be a fire to see the pot by
  f.down('Space');
  await f.preroll(1.15);
  f.up('Space');
  await f.preroll(0.45);
  const ui = await f.ev(() => {
    const g = TP.game;
    const b = document.querySelector('.tp-shelf-item[aria-label="Cinderbloom"]');
    const r = b.getBoundingClientRect();
    const v = g.brewing.surface.clone().project(g.engine.camera);
    return { mode: g.state.mode, bx: r.left + r.width / 2, by: r.top + r.height / 2, px: (v.x * 0.5 + 0.5) * innerWidth, py: (-v.y * 0.5 + 0.5) * innerHeight, band: g.brew.band, fire: g.brew.fire, heat: g.brew.heat };
  });
  console.log('  pot', JSON.stringify(ui));
  f.cut('the cauldron');
  await f.wait(0.25);
  f.glide(ui.bx + 3, ui.by + 4, 0.6, 0.06);
  await f.wait(0.72);
  for (let i = 0; i < 3; i++) {
    await f.click();
    await f.wait(i < 2 ? 0.36 : 0.2);
  }
  // to the pot, and the bellows on the way
  const R = f.H * 0.2;
  f.glide(ui.px + R, ui.py + 10, 0.62, -0.08);
  await f.wait(0.3);
  f.down('Space');
  await f.wait(0.4);
  f.circle(ui.px, ui.py, R, 46, 40);
  await until(f, T.bind);

  // the fire comes up, the mixture starts to bind: not filmed
  await f.ev(() => (TP.game.brewing.autoStir = 1));
  for (let n = 0; n < 1500; n++) {
    await f.frames(1, true);
    const b = f.state.brew;
    if (b.fit === 0 && b.progress >= 0.68) break;
  }
  await f.ev(() => (TP.game.brewing.autoStir = 0));
  console.log('  bound to', JSON.stringify(f.state.brew));
  f.cut('it binds');
  let bottled = false;
  while (now(f) < T.gate - 0.5 / f.fps) {
    await f.frames(1);
    if (f.state.brew.ready && !bottled) {
      bottled = true;
      console.log(`  ready at ${now(f).toFixed(2)} (take ${(now(f) - T.bind).toFixed(2)})`);
      f.up('Space');
      await f.wait(0.42);
      await f.tap('KeyB', 5);
    }
  }
  f.up('Space');
  // the ladle is let go: a hand still circling would turn the head once the pot is left
  f.rest();
  await f.ev(() => window.__film.pointer(false));
  console.log('  ', JSON.stringify(await f.ev(() => F.me())));
}

/** The briar gate: the first phial thrown. */
async function gate(f) {
  await f.ev((hour) => {
    const g = TP.game,
      st = g.state;
    if (st.mode === 'brew') g.brewing.leave();
    F.clear();
    st.world.athanor = 1;
    g.ents.setAthanor(1, true);
    st.known.lore.letter = true;
    st.known.potions.ember = st.known.charted.ember = true;
    st.quest.stage = 'primes';
    g.quests._walked = 100;
    g.quests._shown.gate = 100; // that advice was read on the walk up to it
    if (!(st.inv.potions.ember > 0)) st.inv.potions.ember = 3;
    st.inv.selected = 'ember';
    st.stats.thrown = 0;
    F.know('shore', 'vale');
    TP.hour(hour);
    const gt = g.ents.gate,
      L = TP.world.layout;
    F.stand = () => F.face(gt.x, gt.z, L.chapel.x, L.chapel.z, 14, 4);
    F.stand();
    F.gate = { x: gt.x, y: gt.y + 1.3, z: gt.z };
  }, HOURS.gate);
  f.down('KeyW');
  await settle(f, 1.3);
  await f.ev(() => F.stand());
  await f.preroll(0.3);
  f.cut('the briar gate');
  await f.wait(0.45);
  f.up('KeyW');
  await f.wait(0.12);
  f.down('Mouse0');
  await f.wait(0.08);
  f.aimAt(await f.ev(() => F.solve(F.gate)), 0.42, { hold: 0.4 });
  await f.wait(0.55);
  f.up('Mouse0');
  console.log(`  thrown at take ${(now(f) - T.gate).toFixed(2)}`);
  await f.wait(1.4);
  f.turn(0, -3, 0.8);
  await until(f, T.shade - 0.55);
  f.down('KeyW');
  await until(f, T.shade);
  f.up('KeyW');
  console.log('  ', JSON.stringify(await f.ev(() => ({ ...F.me(), burn: TP.game.ents.gate.burn, burning: TP.game.ents.gate.burning }))));
}

/** The Saltwood: a Shade, held with cold, unmade with fire. */
async function shade(f) {
  const where = await f.ev((hour) => {
    const g = TP.game,
      st = g.state;
    F.clear();
    // the briar of the take before burns out behind us (its toast comes down with the rest)
    const gt = g.ents.gate;
    if (gt.burning) gt.burn = 1.3;
    else if (!gt.gone) st.world.flags.gate = true;
    st.quest.stage = 'primes';
    st.world.athanor = 1;
    st.known.potions.ember = st.known.potions.rime = true;
    st.inv.potions = { ember: 2, rime: 2 };
    st.inv.selected = 'rime';
    st.stats.thrown = 1;
    st.player.hp = st.player.hpMax;
    g.quests._walked = 100;
    g.quests._shown.gloom = 100;
    F.know('shore', 'vale', 'saltwood');
    TP.hour(hour);
    // one haunt of the wood (the others were unmade on the way), and a place to stand before it
    F.quiet();
    const s = g.shades.list.find((q) => Math.abs(q.spot.x + 156.1) < 1 && Math.abs(q.spot.z + 50.9) < 1);
    s.wait = 0;
    F.shade = s;
    const lan = g.ents.lanterns.find((l) => l.id === 'saltwood');
    const at = F.face(s.spot.x, s.spot.z, lan.base.x, lan.base.z, 19.5, 0);
    return { spot: [s.spot.x, s.spot.z], at, y: g.player.pos.y };
  }, HOURS.shade);
  console.log('  shade', JSON.stringify(where));
  await settle(f, 0.7);
  // it rises, sees the living, and comes
  for (let n = 0; n < 900; n++) {
    await f.frames(1, true);
    const d = await f.ev(() => {
      const s = F.shade,
        p = TP.game.player.pos;
      return { d: Math.hypot(s.x - p.x, s.z - p.z), state: s.state, fade: s.fade };
    });
    if (d.state === 'chase' && d.fade <= 0.02 && d.d < 13.6) break;
  }
  const chest = () => f.ev(() => ({ x: F.shade.x, y: F.shade.y + 1.5, z: F.shade.z }));
  // where it will be when a phial let go in `secs` arrives
  const lead = (secs) =>
    f.ev((secs) => {
      const s = F.shade,
        p = TP.game.player.pos;
      const d = Math.hypot(s.x - p.x, s.z - p.z) || 1;
      const k = s.frozen > 0 ? 0 : Math.min(d - 3, 3.25 * secs);
      return F.solve({ x: s.x + ((p.x - s.x) / d) * k, y: s.y + 1.25, z: s.z + ((p.z - s.z) / d) * k });
    }, secs);
  f.cut('a Shade');
  f.aimAt(await chest(), 0.35, { hold: 0.1 });
  await f.wait(0.35);
  f.down('Mouse0');
  await f.wait(0.08);
  f.aimAt(await lead(0.47 + 0.6), 0.34, { hold: 0.2 });
  await f.wait(0.47);
  f.up('Mouse0');
  console.log(`  rime thrown at take ${(now(f) - T.shade).toFixed(2)}`);
  await f.wait(0.72);
  // fire for the one that is held
  await f.tap('Digit1', 5);
  await f.wait(0.25);
  f.down('Mouse0');
  await f.wait(0.08);
  f.aimAt(await lead(0), 0.36, { hold: 0.3 });
  await f.wait(0.5);
  f.up('Mouse0');
  console.log(`  ember thrown at take ${(now(f) - T.shade).toFixed(2)}`);
  await until(f, T.rock);
  console.log('  ', JSON.stringify(await f.ev(() => ({ ...F.me(), shade: F.shade.state, frozen: F.shade.frozen }))));
}

/** The plug of the canyon, and thunder for it. */
async function rock(f) {
  await f.ev((hour) => {
    const g = TP.game,
      st = g.state;
    F.clear();
    st.quest.stage = 'primes';
    st.world.athanor = 1;
    st.known.potions.ember = st.known.potions.rime = st.known.potions.fulminate = true;
    st.inv.potions = { ember: 1, rime: 1, fulminate: 2 };
    st.inv.selected = 'fulminate';
    st.stats.thrown = 3;
    st.player.hp = st.player.hpMax;
    g.quests._walked = 100;
    g.quests._shown.gloom = 100;
    F.quiet();
    F.know('shore', 'vale', 'saltwood', 'mere', 'scar', 'heights');
    TP.hour(hour);
    const s = g.ents.rockfall.spot;
    F.rock = { x: s.x, y: s.y + 1.6, z: s.z };
    F.stand = () => TP.go(s.x - s.tx * 16.2, s.z - s.tz * 16.2, (Math.atan2(s.tx, -s.tz) * 180) / Math.PI, 2);
    F.stand();
  }, HOURS.rock);
  f.down('KeyW');
  await settle(f, 1.3);
  await f.ev(() => F.stand());
  await f.preroll(0.3);
  f.cut('the rockfall');
  await f.wait(0.35);
  f.up('KeyW');
  await f.wait(0.1);
  f.down('Mouse0');
  await f.wait(0.08);
  f.aimAt(await f.ev(() => F.solve(F.rock)), 0.42, { hold: 3 });
  await f.wait(0.5);
  // let go so that it lands on the downbeat
  const n = await f.ev(() => F.flight());
  const go = Math.round((T.blast + OFF) * f.fps) - n;
  console.log(`  ${n} frames of flight; letting go at take ${(go / f.fps - OFF - T.rock).toFixed(2)} (now ${(now(f) - T.rock).toFixed(2)})`);
  await f.frames(Math.max(0, go - f.n));
  f.up('Mouse0');
  await f.frames(n + 1);
  console.log(`  broken: ${await f.ev(() => TP.game.ents.rockfall.broken)} at ${now(f).toFixed(3)}`);
  f.noAim();
  await f.wait(0.55);
  f.down('KeyW');
  f.turn(0, -4, 1.0);
  await until(f, T.scar);
  f.up('KeyW');
  console.log('  ', JSON.stringify(await f.ev(() => F.me())));
}

/** Beyond the plug: the Brimstone Scar, and the game's own name for it. */
async function scar(f) {
  await f.ev((hour) => {
    const g = TP.game,
      st = g.state;
    F.clear();
    st.quest.stage = 'primes';
    st.world.athanor = 1;
    st.world.flags.rockfall = true;
    st.player.hp = st.player.hpMax;
    g.quests._walked = 100;
    g.quests._shown.gloom = 100;
    F.quiet();
    TP.hour(hour);
    // down the canyon is half a minute's walk, and it is cut: the apprentice is set down at the
    // canyon's mouth, looking out over the fire
    const m = TP.world.layout.scarMouth,
      is = TP.world.layout.scarIsland;
    F.stand = () => TP.go(m.x, m.z, (Math.atan2(is.x - m.x, -(is.z - m.z)) * 180) / Math.PI, -3);
    F.stand();
  }, HOURS.scar);
  // whoever walked that canyon has had the Scar's weather over them for a good while: it is given
  // the time to close in, so the place is filmed as it is found (and nine seconds is also longer
  // than the interface will hold back a name it has only just shown)
  await f.preroll(Number(f.args.scarpre ?? 9));
  await f.ev(() => {
    F.clear();
    F.stand();
  });
  await f.preroll(0.2);
  // the game's own card for the place. In play it comes up where the Scar begins, on the road
  // before the plug; here it is asked for again at the sight the place is named for
  await f.ev(() => TP.game.bus.emit('region', { id: 'scar' }));
  f.down('KeyW');
  await f.preroll(0.3);
  f.cut('the Brimstone Scar');
  await f.wait(1.1);
  f.up('KeyW');
  f.turn(0, 2, 0.8);
  await until(f, LENGTH);
  console.log('  ', JSON.stringify(await f.ev(() => F.me())));
}

const TAKES = { title, steps, gather, pot, gate, shade, rock, scar };

export default async function (f) {
  console.log('music:', await f.ev(install));
  const only = f.args.only ? String(f.args.only).split(',') : Object.keys(TAKES);
  for (const q of f.args.hours ? String(f.args.hours).split(',') : []) {
    const [k, v] = q.split('=');
    if (!(k in HOURS) || !isFinite(+v)) throw new Error('--hours: ' + q);
    HOURS[k] = +v;
  }
  if (only[0] !== 'title') {
    // some takes alone: a game started by hand, the loading veil given time to lift, and the clock
    await f.ev(() => TP.play());
    await f.ev(() => TP.step(20, 1 / 30));
    await new Promise((r) => setTimeout(r, 1500));
    await f.begin(LENGTH, SEED);
    await f.ev(() => F.music());
  }
  for (const name of only) {
    if (!TAKES[name]) throw new Error('no take called ' + name);
    OFF = f.args.only && name !== 'title' ? f.t - T[name] : 0;
    await TAKES[name](f);
  }
}
