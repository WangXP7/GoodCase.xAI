const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The Navigate menu and the full map's tap menu (js/navigation-ui.js) on a small stand-in DOM: one menu for every way
// to go (drive yourself, self-driving, Crazy Taxi, teleport), from the place list or from a tap on the map
const source = readFileSync(join(__dirname, '../js/navigation-ui.js'), 'utf8');

function element(attrs = {}) {
  const listeners = new Map();
  const children = [];
  const el = {
    hidden: false, style: {}, dataset: {}, textContent: '', offsetWidth: 220, offsetHeight: 200, children,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { this[k] = v; },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    dispatch(type, e = {}) { for (const fn of listeners.get(type) || []) fn(e); },
    click() { el.dispatch('click'); },
    append(...c) { children.push(...c); },
    appendChild(c) { children.push(c); return c; },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const m = /^\[data-([a-z]+)(?:="([^"]+)")?\]$/.exec(sel);
      if (sel === 'use') return [el.useEl || (el.useEl = element())];
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (m && c.dataset[m[1]] !== undefined && (m[2] === undefined || c.dataset[m[1]] === m[2])) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
    ...attrs
  };
  return el;
}

function harness({ teleportable = true } = {}) {
  const ids = {};
  const byId = (id) => ids[id] || (ids[id] = element());
  const popover = byId('navigate-popover');
  popover.showPopover = () => { popover.shown = (popover.shown || 0) + 1; };
  // the ways strip: its two arrows and the four ways
  const ways = byId('nav-ways');
  const track = byId('nav-ways-track');
  for (const s of ['-1', '1']) {
    const b = element();
    b.dataset.step = s;
    ways.appendChild(b);
  }
  ways.appendChild(track);
  for (const d of ['you', 'self', 'crazy', 'teleport']) {
    const b = element({ textContent: { you: 'You drive', self: 'Self-driving', crazy: 'Crazy Taxi', teleport: 'Teleport' }[d] });
    b.dataset.driver = d;
    b.dataset.sub = `${d} sub`;
    track.appendChild(b);
  }
  const pick = byId('map-pick-menu');
  pick.hidden = true;
  for (const g of ['you', 'self', 'crazy', 'teleport']) {
    const b = element();
    b.dataset.go = g;
    pick.appendChild(b);
  }
  const winListeners = element();
  const document = { getElementById: byId, createElement: () => element(), body: element() };
  const window = { innerWidth: 1000, innerHeight: 700, addEventListener: winListeners.addEventListener };
  const places = {
    raffles: { x: 10, z: 20, heading: 1, name: 'Raffles Place', sub: 'CBD' },
    merlion: { x: -30, z: 40, heading: 2, name: 'Merlion Park', sub: 'Marina Bay' }
  };
  // timers run when the test says so (flush)
  let timers = [];
  const flush = () => { const t = timers; timers = []; for (const fn of t) fn(); };
  const { setupNavigationUI } = loadModule(source, {
    globals: { document, window, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, Math, Object, String, Number },
    imports: { './city-config.js': { NYC_LANDMARKS: Object.values(places), TELEPORT_LOCATIONS: places, CITY: { units: 'metric' } } }
  });
  const calls = [];
  const navigator = {
    driver: { id: 'you', auto: false, label: 'You drive' },
    active: false,
    setDriver(id) { calls.push(['driver', id]); this.driver = { id, auto: id !== 'you', label: id }; },
    setDestination(x, z, name) { calls.push(['destination', x, z, name]); this.active = true; return true; },
    reroute() { calls.push(['reroute']); return true; },
    clear() { this.active = false; },
    state() { return { active: this.active, driver: this.driver.id, driverLabel: this.driver.label }; },
    onChange: null, onEvent: null
  };
  const controllerManager = { activeMode: 'person', getActiveEntity: () => ({ position: { x: 0, z: 0 } }) };
  const fullCanvas = element();
  const mapSystem = {
    fullCanvas, waypoint: null, routeLine: null, pickHandler: null, onPick: null, open: true,
    toggleFullMap(open) { calls.push(['map', open]); this.open = open; },
    renderFullMap() {}
  };
  const ui = setupNavigationUI({
    navigator, mapSystem, controllerManager,
    selectMode: (m) => { calls.push(['mode', m]); controllerManager.activeMode = m; },
    closePopovers: () => {},
    teleport: teleportable ? (x, z, h) => calls.push(['teleport', x, z, h]) : null
  });
  return { ui, calls, navigator, mapSystem, controllerManager, popover, pick, byId, places, fullCanvas, ways, track, flush };
}

const place = (h, name) => h.byId('nav-places').children.find((b) => b.children[0].textContent === name);
const way = (h, d) => h.track.querySelector(`[data-driver="${d}"]`);
const arrow = (h, s) => h.ways.querySelector(`[data-step="${s}"]`);
const pickWay = (h, g) => h.pick.querySelector(`[data-go="${g}"]`);

test('the Navigate menu lists the places and goes there the way it is set to', () => {
  const h = harness();
  assert.equal(h.byId('nav-places').children.length, 2);
  place(h, 'Raffles Place').click();
  assert.deepEqual(h.calls, [['destination', 10, 20, 'Raffles Place']], 'navigates (you drive) by default');
  h.calls.length = 0;
  way(h, 'self').click();
  assert.deepEqual(h.calls, [['mode', 'car'], ['driver', 'self']], 'self-driving puts you in the car');
  place(h, 'Merlion Park').click();
  assert.deepEqual(h.calls.slice(-1), [['destination', -30, 40, 'Merlion Park']]);
});

test('Teleport is one of the ways to go: the places teleport to their arrival points', () => {
  const h = harness();
  way(h, 'teleport').click();
  assert.equal(h.ui.how, 'teleport');
  assert.ok(way(h, 'teleport').classList.contains('active'), 'shown as the chosen way');
  assert.equal(h.calls.length, 0, 'choosing it changes no driver');
  place(h, 'Merlion Park').click();
  assert.deepEqual(h.calls, [['teleport', -30, 40, 2]]);
  assert.equal(h.navigator.active, false, 'and starts no trip');
});

test('a tap on the map opens a menu there; each item closes the map and goes that way', () => {
  for (const [g, expected] of [
    ['you', [['map', false], ['destination', 5, 6, 'Somewhere']]],
    ['self', [['map', false], ['mode', 'car'], ['driver', 'self'], ['destination', 5, 6, 'Somewhere']]],
    ['crazy', [['map', false], ['mode', 'car'], ['driver', 'crazy'], ['destination', 5, 6, 'Somewhere']]],
    ['teleport', [['map', false], ['teleport', 5, 6, undefined]]]
  ]) {
    const h = harness();
    assert.equal(typeof h.mapSystem.onPick, 'function', 'the UI takes the map\'s taps');
    h.mapSystem.onPick(5, 6, 'Somewhere', 400, 300);
    assert.equal(h.pick.hidden, false, 'menu shown');
    assert.equal(h.byId('map-pick-title').textContent, 'Somewhere');
    assert.equal(h.pick.style.left, '412px');
    pickWay(h, g).click();
    assert.equal(h.pick.hidden, true, `${g}: menu put away`);
    assert.deepEqual(h.calls, expected, g);
  }
});

test('the tap menu stays on screen, goes away on a drag, and hides Teleport when there is none', () => {
  const h = harness({ teleportable: false });
  h.mapSystem.onPick(1, 2, 'Edge', 990, 690);
  assert.equal(h.pick.style.left, `${1000 - 220 - 8}px`);
  assert.equal(h.pick.style.top, `${700 - 200 - 8}px`);
  assert.equal(pickWay(h, 'teleport').hidden, true);
  h.fullCanvas.dispatch('pointerdown');
  assert.equal(h.pick.hidden, true);
  // and closing the map
  h.mapSystem.onPick(1, 2, 'Edge', 10, 10);
  h.mapSystem.toggleFullMap(false);
  assert.equal(h.pick.hidden, true);
});

test('a trip on the go carries on after a teleport, from the new spot', () => {
  const h = harness();
  place(h, 'Raffles Place').click();
  way(h, 'teleport').click();
  h.calls.length = 0;
  place(h, 'Merlion Park').click();
  assert.deepEqual(h.calls, [['teleport', -30, 40, 2], ['reroute']]);
});

test('the ways strip: arrows and [ ] step along it, a tap on the chosen way asks where to', () => {
  const h = harness();
  assert.equal(h.ways.dataset.how, 'you');
  assert.equal(arrow(h, '-1').disabled, true, 'nothing before You drive');
  assert.equal(h.byId('nav-ways-sub').textContent, 'you sub');
  assert.equal(h.byId('nav-where-title').textContent, 'Where to · You drive');
  arrow(h, '1').click();
  assert.equal(h.ways.dataset.how, 'self', 'shown at once');
  assert.equal(h.ui.how, 'you', 'taken once the strip rests');
  h.flush();
  assert.equal(h.ui.how, 'self');
  assert.deepEqual(h.calls, [['mode', 'car'], ['driver', 'self']]);
  assert.equal(way(h, 'self').classList.contains('active'), true);
  assert.equal(way(h, 'self')['aria-checked'], 'true');
  assert.equal(way(h, 'self').tabindex, '0', 'the chosen way takes the focus stop');
  assert.equal(way(h, 'you').tabindex, '-1');
  assert.equal(h.byId('nav-ways-sub').textContent, 'self sub');
  h.calls.length = 0;
  h.ui.step(1);
  h.ui.step(1);
  assert.equal(arrow(h, '1').disabled, true, 'nothing after Teleport');
  h.ui.step(1);
  h.flush();
  assert.equal(h.ui.how, 'teleport', 'stops at the end');
  assert.deepEqual(h.calls, [], 'passing Crazy Taxi on the way picked up no fare');
  assert.equal(h.popover.shown, undefined);
  way(h, 'teleport').click();
  assert.equal(h.popover.shown, 1, 'the chosen way, tapped again: where to');
  way(h, 'you').click();
  assert.equal(h.ui.how, 'you', 'another way, tapped: picked');
});

test('a swipe across the strip moves a way per 56 px; the click it ends with is not a tap', () => {
  const h = harness();
  h.ways.dispatch('pointerdown', { clientX: 300, pointerId: 1, button: 0, target: h.track });
  h.ways.dispatch('pointermove', { clientX: 260, pointerId: 1 });
  assert.equal(h.ui.how, 'you', 'under a way: nothing yet');
  h.ways.dispatch('pointermove', { clientX: 240, pointerId: 1 });
  assert.equal(h.ways.dataset.how, 'self', 'dragged left: the next way');
  h.ways.dispatch('pointermove', { clientX: 120, pointerId: 1 });
  assert.equal(h.ways.dataset.how, 'teleport');
  h.ways.dispatch('pointermove', { clientX: 230, pointerId: 1 });
  assert.equal(h.ways.dataset.how, 'self', 'and back');
  assert.equal(h.ui.how, 'you', 'nothing taken mid-swipe');
  h.ways.dispatch('pointerup', { pointerId: 1 });
  assert.equal(h.ui.how, 'self', 'taken on letting go');
  assert.deepEqual(h.calls, [['mode', 'car'], ['driver', 'self']]);
  way(h, 'self').click();
  assert.equal(h.popover.shown, undefined, 'the swipe\'s click opens nothing');
});

test('Crazy Taxi from the strip with no trip on picks up a fare', () => {
  const h = harness();
  way(h, 'crazy').click();
  assert.deepEqual(h.calls.slice(0, 2), [['mode', 'car'], ['driver', 'crazy']]);
  assert.equal(h.calls[2][0], 'destination', 'a fare across town');
});

test('Pick a spot on the map: the map closes once the spot is picked, teleporting too', () => {
  for (const d of ['you', 'teleport']) {
    const h = harness();
    if (d !== 'you') way(h, d).click();
    h.flush();
    h.calls.length = 0;
    h.byId('nav-pick').click();
    assert.deepEqual(h.calls, [['map', true]], `${d}: the map opens to pick`);
    h.mapSystem.pickHandler(7, 8, 'There');
    assert.deepEqual(h.calls[1], ['map', false], `${d}: and closes`);
    assert.equal(h.mapSystem.open, false);
  }
});
