// Walks the UI the way a player would, against the workbench's stand-in game (dev/ui.html), with
// real key presses and clicks, and checks what docs/DESIGN.md section 5 promises: which layer is
// up in which mode, who takes which key, what game.actions were asked to do, and that a screen
// where nothing changes writes nothing to the DOM.
//
//   node tools/ui-flow.mjs              the whole walk in a 1280 x 720 frame
//   node tools/ui-flow.mjs 900x600      the same walk in another frame
//   node tools/ui-flow.mjs -v           also list the checks that passed
//
// Exits 1 when a check fails or the page logs an error or a warning.
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const argv = process.argv.slice(2);
const verbose = argv.includes('-v');
const size = argv.find((a) => /^\d+x\d+$/.test(a)) || '1280x720';
const [width, height] = size.split('x').map(Number);

const { server, url } = await startServer(0);
const { browser, page, logs } = await launch({ width, height });

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------
const out = [];
let passed = 0,
  failed = 0;
const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
function part(name) {
  out.push({ part: name });
}
/** `want` is a value to equal, or a test function. Without it the thing must simply be true. */
function check(label, got, want = true) {
  const ok = typeof want === 'function' ? !!want(got) : got === want;
  if (ok) passed++;
  else failed++;
  out.push({ ok, label, note: ok ? '' : `got ${show(got)}` + (typeof want === 'function' ? '' : `, wanted ${show(want)}`) });
}

// ---------------------------------------------------------------------------------------------
// Hands and eyes
// ---------------------------------------------------------------------------------------------
const ev = (fn, arg) => page.evaluate(fn, arg);
const frames = (n = 4) =>
  ev(
    (k) =>
      new Promise((res) => {
        const step = () => (--k <= 0 ? res() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n
  );
const wait = (ms) => page.waitForTimeout(ms);

async function open(scene, query = '') {
  await page.goto(`${url}/dev/ui.html?scene=${encodeURIComponent(scene)}${query ? '&' + query : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.UIDEV && window.UIDEV.done === true, null, { timeout: 20000 });
  // Note what the UI asks of the game, and which keys reach the game. The second list is kept by a
  // bubbling listener on window, the place the game listens: a key the UI took never arrives there.
  await ev(() => {
    const A = window.UIDEV.game.actions;
    window.__calls = [];
    window.__keys = [];
    for (const name of Object.keys(A)) {
      const fn = A[name];
      if (typeof fn !== 'function') continue;
      A[name] = function (...args) {
        window.__calls.push(name + '(' + args.map((a) => (a === undefined ? '' : String(a))).join(',') + ')');
        return fn.apply(this, args);
      };
    }
    window.addEventListener('keydown', (e) => window.__keys.push(e.code));
  });
  await frames(3);
}

/** One or more keys, pressed as a player presses them. Returns what the game saw of them. */
async function key(...codes) {
  await ev(() => (window.__keys.length = 0));
  for (const c of codes) await page.keyboard.press(c);
  await frames(4);
  return ev(() => window.__keys.join(' '));
}
/** What the UI and the stand-in game asked of game.actions since the last time this was read. */
const calls = () => ev(() => window.__calls.splice(0).join(' '));
/** Put the pointer where nothing is, so that a screen coming up under it is not chosen by it. */
const park = () => page.mouse.move(2, 2);
const mode = () => ev(() => window.UIDEV.game.state.mode);
const up = (sel) => ev((s) => !!document.querySelector(s) && document.querySelector(s).classList.contains('is-on'), sel);
const has = (sel, cls) => ev(([s, c]) => !!document.querySelector(s) && document.querySelector(s).classList.contains(c), [sel, cls]);
const count = (sel) => ev((s) => document.querySelectorAll(s).length, sel);
const text = (sel) => ev((s) => (document.querySelector(s) ? document.querySelector(s).textContent.trim() : null), sel);
/** The words of a menu, the chosen one in brackets. */
const menu = (sel) => ev((s) => [...document.querySelectorAll(s + ' .tp-menu-item')].map((b) => (b.classList.contains('is-sel') ? '[' + b.textContent + ']' : b.textContent)).join(' | '), sel);
const tab = () => text('.tp-tab.is-sel');
const state = (fn, arg) => ev(fn, arg);
const centre = async (sel, nth = 0) => {
  const box = await page.locator(sel).nth(nth).boundingBox();
  return box ? [box.x + box.width / 2, box.y + box.height / 2] : null;
};

// ---------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------
async function walk() {
  // ---- the veil -----------------------------------------------------------------------------
  part('Loading');
  await open('title', 'save=1');
  check('opens on the title', await mode(), 'title');
  check('the title is up', await up('.tp-title'));
  check('no veil until the game asks for one', await up('.tp-loading'), false);
  await ev(() => window.UIDEV.game.bus.emit('loading', { progress: 0.4, label: 'Planting the Saltwood' }));
  await frames();
  check('a loading event brings the veil down', await up('.tp-loading'));
  check('and it says what is being made', await text('.tp-loading-label'), 'Planting the Saltwood');
  check('the title waits behind it', await up('.tp-title'), false);
  await key('Enter');
  check('keys do nothing behind the veil', (await mode()) + '/' + (await has('.tp-title', 'has-pane')), 'title/false');
  await ev(() => window.UIDEV.game.bus.emit('loading', { progress: 1, label: 'Lighting the fires' }));
  await wait(700);
  check('the veil lifts when the work is done', await up('.tp-loading'), false);
  check('and the title is back', await up('.tp-title'));

  // ---- title --------------------------------------------------------------------------------
  part('Title');
  const T = '.tp-title .tp-menu-col';
  await park();
  await calls();
  check('a kept journey offers Continue first', await menu(T), '[Continue] | Begin again | Settings | Controls');
  check('the UI takes the keys of the title', await key('ArrowDown'), '');
  check('down moves the choice', await menu(T), 'Continue | [Begin again] | Settings | Controls');
  await key('Enter');
  check('Begin again asks first', await text('.tp-title .tp-confirm-text'), 'Begin again? The journey you kept will be lost.');
  check('the question opens on the answer that loses nothing', await menu('.tp-title .tp-confirm'), 'Begin again | [Keep it]');
  await key('Enter');
  check('Keep it puts the question away', await has('.tp-title', 'has-pane'), false);
  check('and nothing was begun', (await mode()) + ' ' + (await calls()), 'title ');
  check('the word that asked is still chosen', await menu(T), 'Continue | [Begin again] | Settings | Controls');

  await key('ArrowDown', 'Enter');
  check('Settings opens beside the menu', await count('.tp-title .tp-settings'), 1);
  const names = await state(() => Object.keys(window.UIDEV.game.settings).sort().join(' '));
  const rows = await count('.tp-title .tp-set-row');
  check('one row for every key of game.settings', rows, names.split(' ').length);
  const asSet = await state(() => ({ ...window.UIDEV.game.settings }));
  const touched = new Set();
  for (let i = 0; i < rows; i++) {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowRight']) {
      const before = await state(() => ({ ...window.UIDEV.game.settings }));
      await page.keyboard.press(k);
      const after = await state(() => ({ ...window.UIDEV.game.settings }));
      for (const name in after) if (after[name] !== before[name]) touched.add(name);
    }
    await page.keyboard.press('ArrowDown');
  }
  await frames();
  check('every one of them can be changed from the pane', [...touched].sort().join(' '), names);
  check('and each change goes through setSetting', await calls(), (c) => c.length > 0 && c.split(' ').every((x) => x.startsWith('setSetting(')));
  // hold every rule against its end stop
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < 60; k++) await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight');
    await page.keyboard.press('ArrowDown');
  }
  const ranges = await state(() => {
    const s = window.UIDEV.game.settings;
    return s.renderScale >= 0.5 && s.renderScale <= 1 && s.fov >= 60 && s.fov <= 100 && s.sensitivity >= 0.2 && s.sensitivity <= 3 && [s.master, s.music, s.sfx].every((v) => v >= 0 && v <= 1) && ['low', 'medium', 'high', 'ultra'].includes(s.quality);
  });
  check('values stay inside their ranges', ranges);
  await state((was) => {
    for (const name in was) window.UIDEV.game.actions.setSetting(name, was[name]);
  }, asSet);
  await frames();
  check('the pane follows settings changed by the game', await text('.tp-title .tp-set-row .tp-opt.is-on'), 'High');
  await calls();

  // the same pane by hand
  await page.locator('.tp-title .tp-set-row').first().locator('.tp-opt').first().click();
  check('a click on a choice sets it', await state(() => window.UIDEV.game.settings.quality), 'low');
  const track = await page.locator('.tp-title .tp-range').first().boundingBox();
  await page.mouse.click(track.x + track.width * 0.5, track.y + track.height / 2);
  check('a click on a rule sets it', await state(() => window.UIDEV.game.settings.renderScale), (v) => v >= 0.7 && v <= 0.8);
  await page.mouse.move(track.x + track.width * 0.5, track.y + track.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width + 40, track.y + track.height / 2, { steps: 4 });
  await page.mouse.up();
  check('and it can be dragged to its end', await state(() => window.UIDEV.game.settings.renderScale), 1);
  check('the number beside it follows', await text('.tp-title .tp-set-row .tp-set-val'), '100 %');
  check('no control keeps the focus', await state(() => document.activeElement === document.body));
  await calls();

  await key('Escape');
  check('Esc closes the pane', await has('.tp-title', 'has-pane'), false);
  check('with Settings still chosen', await menu(T), 'Continue | Begin again | [Settings] | Controls');
  await key('ArrowDown', 'Enter');
  check('Controls lists the keys of the isle and the cauldron', await count('.tp-title .tp-ctl-row'), 18);
  await key('Escape');

  const cont = await centre('.tp-title .tp-menu-col .tp-menu-item', 0);
  await page.mouse.move(cont[0], cont[1]);
  await frames();
  check('the pointer chooses a word by resting on it', await menu(T), '[Continue] | Begin again | Settings | Controls');
  await page.mouse.click(cont[0], cont[1]);
  await frames();
  check('a click on Continue walks onto the isle', (await mode()) + ' ' + (await calls()), 'play continueGame()');
  await park();

  // ---- walking ------------------------------------------------------------------------------
  part('HUD');
  const placed = Date.now();
  await wait(500);
  check('the HUD is up', await up('.tp-hud'));
  check('the title is gone', await up('.tp-title'), false);
  check('the place is announced', (await count('.tp-card')) + ' ' + (await text('.tp-card-name')), '1 ' + (await state(() => window.UIDEV.game.data.REGIONS.vale.name)));
  check('the work at hand is written', await text('.tp-obj-text'), (t) => !!t && t.length > 8);
  check('the belt holds what is carried', await count('.tp-belt .tp-slot'), 5);
  check('nothing in the HUD wants the mouse', await state(() => getComputedStyle(document.querySelector('.tp-hud')).pointerEvents), 'none');
  check('health is not shown to the unhurt', await up('.tp-health'), false);
  check('the game gets the keys of the isle', await key('KeyH'), 'KeyH');
  check('a wound shows the line', await up('.tp-health'));
  const held = () => text('.tp-slot.is-held .tp-slot-key');
  const first = await held();
  await key('KeyQ');
  check('the next potion is taken in hand', await held(), (v) => !!v && v !== first);
  await state(() => {
    const g = window.UIDEV.game;
    g.hud.focus = { verb: 'Gather', name: 'Cinderbloom', key: 'E', hold: null };
    g.hud.hint = 'Hold Shift to run.';
    g.hud.gloom = 0.8;
    g.hud.crosshair = 'ring';
  });
  await frames();
  check('what is looked at is named', (await up('.tp-focus')) + ' ' + (await text('.tp-focus-verb')) + ' ' + (await text('.tp-focus-name')), 'true Gather Cinderbloom');
  check('a tap prompt has no ring', await has('.tp-focus', 'is-hold'), false);
  check('the crosshair follows the game', await state(() => document.querySelector('.tp-cross').getAttribute('data-s')), 'ring');
  check('the hint is written', (await up('.tp-hint')) + ' ' + (await text('.tp-hint')), 'true Hold Shift to run.');
  check('the Gloom closes in', await state(() => Number(document.querySelector('.tp-vig-gloom').style.opacity)), 0.8);
  await state(() => {
    const g = window.UIDEV.game;
    g.hud.focus = { verb: 'Rest', name: 'Lantern of the dead', key: 'E', hold: 0.5 };
    g.actions.setSetting('hints', false);
  });
  await frames();
  check('a hold prompt wears its ring', await has('.tp-focus', 'is-hold'));
  check('hints can be put out', await up('.tp-hint'), false);
  await state(() => {
    const g = window.UIDEV.game;
    g.hud.focus = null;
    g.hud.gloom = 0;
    g.hud.hint = '';
    g.actions.setSetting('hints', true);
  });
  await state(() => window.UIDEV.toast('pickup', 'Saltwort', '×2', { kind: 'ingredient', id: 'saltwort' }));
  await state(() => window.UIDEV.toast('pickup', 'Saltwort', '×3', { kind: 'ingredient', id: 'saltwort' }));
  await frames();
  check('the same thing gathered twice is counted, not stacked', (await count('.tp-toast')) + ' ' + (await text('.tp-toast-text')), '1 ×5');
  // the stand-in game named the place twice, in game.hud.region and in a region event
  await wait(Math.max(0, 6400 - (Date.now() - placed)));
  check('a place named twice was announced once', await count('.tp-card'), 0);
  await state(() => (window.UIDEV.game.hud.region = 'saltwood'));
  await frames();
  check('game.hud.region alone announces a place', await text('.tp-card-name'), await state(() => window.UIDEV.game.data.REGIONS.saltwood.name));
  await state(() => {
    const g = window.UIDEV.game;
    g.state.mode = 'cutscene';
    g.bus.emit('mode', { from: 'play', to: 'cutscene' });
    g.hud.region = 'mere';
  });
  await frames();
  check('but not in a cutscene', await text('.tp-card-name'), await state(() => window.UIDEV.game.data.REGIONS.saltwood.name));
  await state(() => {
    const g = window.UIDEV.game;
    g.hud.region = 'saltwood';
    g.state.mode = 'play';
    g.bus.emit('mode', { from: 'cutscene', to: 'play' });
  });
  await calls();

  // ---- the book -----------------------------------------------------------------------------
  part('The book');
  check('Tab is the game\'s key while walking', await key('Tab'), 'Tab');
  check('and it opens the book', (await mode()) + ' ' + (await up('.tp-book')), 'book true');
  check('the HUD steps back', await up('.tp-hud'), false);
  check('at the journal', await tab(), 'Journal');
  check('the UI takes the keys of the book', await key('KeyD'), '');
  check('D turns the page', await tab(), 'Chart');
  const potion = () => text('.tp-book .tp-row.is-sel .tp-row-name');
  const p0 = await potion();
  await key('KeyS');
  check('S chooses the next potion', await potion(), (v) => !!v && v !== p0);
  await key('ArrowRight');
  check('the arrows turn pages too', await tab(), 'Ingredients');
  await key('KeyA', 'KeyA');
  check('A turns back', await tab(), 'Journal');
  await key('Digit4');
  check('a number opens its page', await tab(), 'Pages');
  await key('KeyM');
  check('M turns to the map from another page', (await mode()) + ' ' + (await tab()), 'book Map');
  await key('KeyM');
  check('and closes the book from the map', (await mode()) + ' ' + (await calls()).includes('closeBook()'), 'play true');
  await key('KeyM');
  check('M on the isle opens the book at the map', (await mode()) + ' ' + (await tab()), 'book Map');
  await calls();

  const lantern = () => text('.tp-row-lantern.is-sel .tp-row-name');
  const l0 = await lantern();
  check('a lit lantern is chosen and can be travelled to', await count('.tp-map-act .tp-act'), 1);
  await key('ArrowDown', 'ArrowDown');
  check('a dark lantern says why it cannot', await text('.tp-map-act'), 'This lantern is dark. An Ember will light it.');
  await key('Enter');
  check('and Enter does not travel there', (await mode()) + ' ' + (await calls()), 'book ');
  // the survey itself: rest on a lantern, then click it
  const spot = await state(() => {
    const g = window.UIDEV.game;
    const m = g.map.marks.find((x) => x.kind === 'lantern' && x.lit && x.id !== 'chapel') || g.map.marks.find((x) => x.kind === 'lantern' && x.lit);
    const uv = g.map.toUV(m.x, m.z);
    const r = document.querySelector('.tp-map-canvas').getBoundingClientRect();
    return { id: m.id, name: m.name, x: r.left + uv[0] * r.width, y: r.top + uv[1] * r.height };
  });
  await page.mouse.move(spot.x - 3, spot.y - 3);
  await page.mouse.move(spot.x, spot.y);
  await frames();
  check('resting on a lantern of the map chooses it', await lantern(), spot.name);
  await page.mouse.click(spot.x, spot.y);
  await frames();
  check('a click on it travels', (await mode()) + ' ' + (await calls()), `play travel(${spot.id})`);
  await park();
  await key('KeyM');
  await key('ArrowUp', 'ArrowUp', 'ArrowUp');
  check('the keys choose a lantern as well', await lantern(), l0);
  await key('Enter');
  check('and Enter travels to it', (await mode()) + ' ' + (await calls()), (v) => v.startsWith('play ') && v.endsWith('travel(chapel)'));
  await key('Tab');
  check('the book opens again where it was left', (await mode()) + ' ' + (await tab()), 'book Map');
  await page.locator('.tp-tab').first().click();
  await frames();
  check('a click on a tab turns to it', await tab(), 'Journal');
  await park();
  await key('Escape');
  check('Esc closes the book', await mode(), 'play');

  // ---- pause --------------------------------------------------------------------------------
  part('Pause');
  await key('Escape');
  check('Esc pauses', (await mode()) + ' ' + (await up('.tp-pause')), 'pause true');
  await calls();
  const P = '.tp-pause .tp-menu-col';
  check('four words', await menu(P), '[Return] | Settings | Controls | Leave the isle');
  await key('ArrowUp');
  check('the choice wraps round', await menu(P), 'Return | Settings | Controls | [Leave the isle]');
  await key('Enter');
  check('leaving asks first', await text('.tp-pause .tp-confirm-text'), 'Leave Morne? Your journey is kept as it stands.');
  await key('Escape');
  check('Esc takes the question back', (await mode()) + ' ' + (await has('.tp-pause', 'has-pane')), 'pause false');
  await key('ArrowDown', 'ArrowDown', 'Enter');
  check('the same settings are here', await count('.tp-pause .tp-set-row'), rows);
  check('and they show what was set at the title', await text('.tp-pause .tp-set-row .tp-opt.is-on'), 'Low');
  await key('Escape');
  check('the UI takes Esc while paused', await key('Escape'), '');
  check('Esc on the menu returns to the isle', (await mode()) + ' ' + (await calls()), 'play resume()');
  await key('Escape');
  await key('Enter');
  check('so does Return', (await mode()) + ' ' + (await calls()).includes('resume()'), 'play true');
  await key('Escape');
  await key('ArrowUp', 'Enter', 'Enter');
  check('Leave goes back to the title', (await mode()) + ' ' + (await up('.tp-title')), 'title true');
  check('through quitToTitle', (await calls()).includes('quitToTitle()'));
  check('the title starts from its first word again', await menu(T), '[Continue] | Begin again | Settings | Controls');
  await key('ArrowDown', 'Enter', 'ArrowUp', 'Enter');
  check('Begin again, answered yes, begins', (await mode()) + ' ' + (await calls()), (v) => v.startsWith('play ') && v.endsWith('newGame()'));
  check('a new journey starts with an empty belt', await count('.tp-belt .tp-slot'), 0);

  // ---- death --------------------------------------------------------------------------------
  part('Death');
  await key('KeyK', 'Enter');
  check('the Gloom takes the apprentice', (await mode()) + ' ' + (await up('.tp-dead')), 'dead true');
  check('a key still down from the fight does not skip the moment', await calls(), '');
  check('every key is the UI\'s here', await key('Tab', 'KeyM', 'Escape'), '');
  check('and none of them leaves', await mode(), 'dead');
  await wait(1500);
  await key('Enter');
  check('Enter rises at the last lantern', (await mode()) + ' ' + (await calls()), 'play respawn()');
  check('the HUD is back', await up('.tp-hud'));

  // ---- a page of lore -----------------------------------------------------------------------
  part('Lore');
  await key('KeyL', 'KeyE');
  check('a lore event opens the page', await up('.tp-reader'));
  check('the key that picked it up does not put it away at once', await calls(), '');
  check('it has its title', await text('.tp-reader .tp-lore-title'), await state(() => window.UIDEV.game.data.LORE[window.UIDEV.game.data.LORE_ORDER[0]].title));
  check('the HUD steps back', await up('.tp-hud'), false);
  await wait(450);
  check('every key is the UI\'s while reading', await key('Tab', 'KeyM'), '');
  check('and the page stays', (await up('.tp-reader')) + ' ' + (await mode()), 'true play');
  await key('Enter');
  check('Enter puts the page away', await up('.tp-reader'), false);
  check('and tells the game once', await calls(), 'readLoreDone()');
  check('the page is kept', await state(() => !!window.UIDEV.game.state.known.lore[window.UIDEV.game.data.LORE_ORDER[0]]), true);
  check('the HUD returns', await up('.tp-hud'));

  // ---- the cauldron -------------------------------------------------------------------------
  part('The cauldron');
  await state(() => {
    const st = window.UIDEV.game.state;
    st.inv.ingredients = { cinderbloom: 3, saltwort: 2 };
    st.known.ingredients = { cinderbloom: true, saltwort: true };
    st.known.charted = { ember: true };
  });
  await key('KeyB');
  check('the overlay comes up at the pot', (await mode()) + ' ' + (await up('.tp-brew')), 'brew true');
  check('the HUD steps back', await up('.tp-hud'), false);
  const through = await state(() => {
    const panel = document.querySelector('.tp-brew-panel').getBoundingClientRect();
    const hits = [];
    for (const fx of [0.03, 0.2, 0.4, 0.57]) for (const fy of [0.05, 0.5, 0.95]) {
      const el = document.elementFromPoint(innerWidth * fx, innerHeight * fy);
      if (el && el.closest('#ui')) hits.push(fx + ',' + fy);
    }
    return { root: getComputedStyle(document.querySelector('.tp-brew')).pointerEvents, panel: getComputedStyle(document.querySelector('.tp-brew-panel')).pointerEvents, left: panel.left / innerWidth, hits: hits.join(' ') };
  });
  check('the overlay lets the pointer through', through.root, 'none');
  check('nothing of the UI answers in the left 58 %', through.hits, '');
  check('the panel stands to the right of it', through.left, (v) => v >= 0.58);
  check('and takes the pointer itself', through.panel, 'auto');
  check('an empty pot says what to do', await text('.tp-shelf-info'), 'Choose what goes into the pot.');
  check('the shelf shows what is carried', await count('.tp-shelf-item'), 2);
  const item = await centre('.tp-shelf-item', 0);
  await page.mouse.move(item[0], item[1]);
  await frames();
  check('resting on a thing names it', await text('.tp-shelf-info-name'), 'Cinderbloom');
  await page.mouse.click(item[0], item[1]);
  await page.mouse.click(item[0], item[1]);
  await frames();
  check('a click puts it in the pot', (await state(() => window.UIDEV.game.brew.contents.join(' '))) + ' | ' + (await calls()), 'cinderbloom cinderbloom | brewAdd(cinderbloom) brewAdd(cinderbloom)');
  check('the pips count it', await count('.tp-pips i.is-on'), 2);
  check('the shelf counts what is left', await text('.tp-shelf-item .tp-shelf-n'), '1');
  check('the mixture is named when its region is known', await text('.tp-brew-name'), (t) => !!t && t !== 'Unwritten');
  check('no control keeps the focus', await state(() => document.activeElement === document.body));
  check('the keys of the cauldron are the game\'s', await key('Space'), 'Space');
  check('so the bellows key cannot press a button again', (await state(() => window.UIDEV.game.brew.contents.length)) + ' ' + (await calls()), '2 brewPump(true) brewPump(false)');
  const bellows = await centre('.tp-keybtn', 0);
  await page.mouse.move(bellows[0], bellows[1]);
  await page.mouse.down();
  await frames();
  const downCalls = await calls();
  await page.mouse.up();
  await frames();
  check('holding the Bellows button works the bellows', downCalls + ' / ' + (await calls()), 'brewPump(true) / brewPump(false)');
  const damper = await centre('.tp-keybtn', 1);
  await page.mouse.move(damper[0], damper[1]);
  await page.mouse.down();
  await frames();
  await page.mouse.move(damper[0], damper[1] - 200, { steps: 3 });
  await page.mouse.up();
  await frames();
  check('a hold let go off the button still ends', await calls(), 'brewDamp(true) brewDamp(false)');
  check('Bottle waits until there is something to bottle', await state(() => document.querySelectorAll('.tp-keybtn')[2].disabled), true);
  await page.locator('.tp-keybtn').nth(3).click();
  await frames();
  check('Empty empties the pot', (await state(() => window.UIDEV.game.brew.contents.length)) + ' ' + (await calls()), '0 brewEmpty()');
  await key('Space');
  check('and the bellows key after it does not empty it again', await calls(), 'brewPump(true) brewPump(false)');
  // a finished brew
  await page.mouse.click(item[0], item[1]);
  await frames();
  check('the emptied pot takes things again', await calls(), 'brewAdd(cinderbloom)');
  await state(() => {
    const b = window.UIDEV.game.brew;
    b.ready = { potion: 'ember', stars: 2, count: 3 };
    b.progress = 1;
  });
  await frames();
  check('a bound potion is announced', (await has('.tp-brew-status', 'is-ready')) + ' ' + (await count('.tp-marks i.is-on')) + ' ' + (await text('.tp-brew-sub')), 'true 2 Three phials. Bottle it.');
  check('and Bottle calls for the hand', await has('.tp-keybtn:nth-child(3)', 'is-call'));
  await page.locator('.tp-keybtn').nth(2).click();
  await frames();
  check('Bottle bottles', await calls(), 'brewBottle()');
  await page.locator('.tp-keybtn').nth(4).click();
  await frames();
  check('Leave leaves', (await mode()) + ' ' + (await calls()), 'play brewLeave()');
  check('the belt has the new phials', await text('.tp-belt .tp-slot .tp-slot-n'), '3');
  await park();

  // the Great Work
  await state(() => {
    const st = window.UIDEV.game.state;
    st.inv.primes = { salt: true, mercury: true, sulfur: true };
    st.quest.stage = 'opus';
  });
  await key('KeyB');
  check('the Primes stand on the shelf', await count('.tp-shelf-item.is-prime'), 3);
  for (let i = 0; i < 3; i++) {
    await page.locator('.tp-shelf-item.is-prime').first().click();
    await frames();
  }
  check('all three in the pot begin the Great Work', await state(() => !!window.UIDEV.game.brew.opus), true);
  check('its four colours are shown', (await state(() => !document.querySelector('.tp-stages').hidden)) + ' ' + (await count('.tp-stage')) + ' ' + (await count('.tp-stage.is-now')), 'true 4 1');
  await state(() => {
    const o = window.UIDEV.game.brew.opus;
    o.stage = 2;
    o.progress = 0.4;
  });
  await frames();
  check('with the ones behind marked done', await count('.tp-stage.is-done'), 2);
  await state(() => {
    const b = window.UIDEV.game.brew;
    b.opus = { stage: 3, progress: 1, done: true };
  });
  await frames();
  check('the finished Stone is taken, not bottled', (await text('.tp-brew-name')) + ' / ' + (await text('.tp-keybtn:nth-child(3) .tp-label')), 'The Stone / Take');
  check('and the pot cannot be emptied over it', await state(() => document.querySelectorAll('.tp-keybtn')[3].disabled), true);
  await calls();
  await page.locator('.tp-keybtn').nth(2).click();
  await frames();
  check('Take takes it', (await calls()) + ' ' + (await state(() => window.UIDEV.game.state.inv.stone)), 'brewBottle() true');
  await park();
  await key('Escape');

  // ---- photo mode ---------------------------------------------------------------------------
  part('Photo mode');
  check('P is the game\'s key', await key('KeyP'), 'KeyP');
  check('the bar is all that is left', (await mode()) + ' ' + (await up('.tp-photo')) + ' ' + (await up('.tp-hud')), 'photo true false');
  check('it names the way back', await text('.tp-photo-bar'), (t) => /Photo mode/.test(t) && /Return/.test(t));
  await state(() => (window.UIDEV.game.hud.photo = [['P', 'Return'], ['H', 'Hide this line']]));
  await frames();
  check('the game may list its own keys there', await count('.tp-photo-bar .tp-foot-item'), 2);
  await state(() => delete window.UIDEV.game.hud.photo);
  await key('KeyP');
  check('P returns', await mode(), 'play');
  await calls();

  // ---- the ending ---------------------------------------------------------------------------
  part('Ending');
  await state(() => {
    const g = window.UIDEV.game;
    g.state.quest.stage = 'done';
    g.state.mode = 'cutscene';
    g.bus.emit('mode', { from: 'play', to: 'cutscene' });
    g.bus.emit('ending', { phase: 'cut' });
  });
  await frames();
  check('the cut wears its bars and nothing else', (await has('.tp-bars', 'is-on')) + ' ' + (await up('.tp-hud')) + ' ' + (await up('.tp-ending')), 'true false false');
  check('the keys of the cut are the game\'s', await key('Escape'), 'Escape');
  await state(() => window.UIDEV.game.bus.emit('ending', { phase: 'text' }));
  await frames();
  check('the closing lines are written', (await up('.tp-ending')) + ' ' + (await count('.tp-ending-text p')), 'true 4');
  check('the UI holds the keys through them', await key('Escape', 'Tab'), '');
  check('and nothing is skipped', (await mode()) + ' ' + (await calls()), 'cutscene ');
  await state(() => window.UIDEV.game.bus.emit('ending', { phase: 'credits' }));
  await frames();
  check('the credits count the work', (await count('.tp-credits-stats .tp-known-row')) + ' ' + (await has('.tp-bars', 'is-on')), '5 false');
  await key('Enter');
  check('Enter walks the isle again', (await mode()) + ' ' + (await calls()), 'play resume()');
  await wait(600);
  check('the ending is put away', (await up('.tp-ending')) + ' ' + (await up('.tp-hud')), 'false true');
  check('and the keys are the game\'s again', await key('KeyG'), 'KeyG');
}

// ---------------------------------------------------------------------------------------------
// A still screen must cost nothing: no DOM writes, and little time
// ---------------------------------------------------------------------------------------------
const STILLS = ['title', 'title-settings', 'hud', 'hud-hold', 'hud-hurt', 'hud-day', 'brew-mix', 'brew-binding', 'brew-ready', 'brew-opus', 'book-journal', 'book-chart', 'book-ingredients', 'book-lore', 'book-map', 'lore', 'pause-settings', 'dead', 'photo', 'ending-credits'];

async function stills() {
  part('Still screens');
  const costs = [];
  for (const scene of STILLS) {
    await open(scene, 'still=1');
    // past the entry: the hurt flash and the page turn have run out, no toast or card has yet
    await wait(1100);
    const seen = await ev(
      () =>
        new Promise((res) => {
          const seen = [];
          const name = (n) => (n.nodeType === 1 ? n.nodeName.toLowerCase() + (n.getAttribute('class') ? '.' + n.getAttribute('class').split(' ').join('.') : '') : '#text in ' + (n.parentNode ? n.parentNode.nodeName.toLowerCase() : '?'));
          const mo = new MutationObserver((list) => {
            for (const m of list) seen.push(m.type + (m.attributeName ? ' ' + m.attributeName : '') + ' on ' + name(m.target));
          });
          mo.observe(document.getElementById('ui'), { subtree: true, childList: true, attributes: true, characterData: true });
          const t0 = performance.now();
          let n = 90;
          const step = () => {
            if (--n > 0 || performance.now() - t0 < 500) return requestAnimationFrame(step);
            for (const m of mo.takeRecords()) seen.push(m.type + (m.attributeName ? ' ' + m.attributeName : '') + ' on ' + name(m.target));
            mo.disconnect();
            res(seen);
          };
          requestAnimationFrame(step);
        })
    );
    check(`${scene}: no DOM writes while nothing changes`, seen.length ? seen.length + ' writes, first: ' + seen.slice(0, 3).join('; ') : 'none', 'none');
    const us = await ev(() => {
      const ui = window.UIDEV.ui;
      for (let i = 0; i < 50; i++) ui.update(1 / 60);
      const t0 = performance.now();
      for (let i = 0; i < 400; i++) ui.update(1 / 60);
      return ((performance.now() - t0) / 400) * 1000;
    });
    costs.push([scene, us]);
  }
  const worst = costs.reduce((a, b) => (b[1] > a[1] ? b : a));
  check(`ui.update() stays under half a millisecond (worst: ${worst[0]}, ${worst[1].toFixed(0)} µs)`, worst[1], (v) => v < 500);
  return costs;
}

// ---------------------------------------------------------------------------------------------
let costs = [];
let crash = null;
try {
  await walk();
  costs = await stills();
} catch (e) {
  crash = e;
} finally {
  await browser.close();
  server.close();
}

for (const line of out) {
  if (line.part) {
    if (verbose) console.log('\n' + line.part);
  } else if (!line.ok) console.log(`FAIL  ${line.label}: ${line.note}`);
  else if (verbose) console.log(`  ok  ${line.label}`);
}
if (verbose && costs.length) {
  console.log('\nui.update(), microseconds a call');
  for (const [scene, us] of costs) console.log(`  ${String(us.toFixed(0)).padStart(5)}  ${scene}`);
}
const bad = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[warning]'));
console.log(`\n${size}: ${passed} checks passed, ${failed} failed` + (bad.length ? `, ${bad.length} console problem(s)` : ', console clean'));
if (crash) console.log('the walk stopped early:', (crash && crash.stack) || crash);
if (failed || bad.length || crash) process.exitCode = 1;
