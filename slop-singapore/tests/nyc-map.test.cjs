const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/nyc-map.js'), 'utf8');

for (const [width, height, dpr] of [[500, 300, 1], [320, 180, 1.5], [1920, 1080, 2]]) {
  test(`map clicks match rendered world positions at ${width}x${height}, DPR ${dpr}`, () => {
    const window = { innerWidth: width, innerHeight: height, devicePixelRatio: dpr };
    const { NYCMapSystem } = loadModule(source, {
      globals: { window, performance: { now: () => 0 } },
      imports: { './geodata.js': { GEO: {} }, './city-config.js': { ROADS: [], CITY: { open: false } } }
    });
    const map = Object.create(NYCMapSystem.prototype);
    // Capture the production render viewport; drawing primitives are irrelevant to coordinate conversion.
    const context = new Proxy({}, { get: () => () => {} });
    let view;
    Object.assign(map, {
      fullCanvas: { clientWidth: width, clientHeight: height },
      fullCtx: context,
      fullStatic: { getContext: () => context },
      isFullMapOpen: true,
      viewCenterX: 200,
      viewCenterZ: -300,
      viewZoom: 0.5,
      controllerManager: { getActiveEntity: () => ({ position: { x: 200, z: -300 }, heading: 0 }) },
      renderFullMapStatic: (_context, viewport) => { view = viewport; }
    });
    map.resizeFullCanvas();
    map.renderFullMap();

    for (const point of [{ x: 200, z: -300 }, { x: 325, z: -375 }]) {
      // Convert the renderer's centred coordinates through the canvas backing store to CSS pixels.
      const [X, Y] = view.pt(point.x, point.z);
      const screenX = (X + view.w / 2) * view.dpr * width / map.fullCanvas.width;
      const screenY = (Y + view.h / 2) * view.dpr * height / map.fullCanvas.height;
      const clicked = map.screenToWorld(screenX, screenY, width, height);
      // The pixel budget can yield a fractional DPR; integer backing sizes may round by less than one pixel.
      const tolerance = 1 / (view.s * view.dpr);
      assert.ok(Math.abs(clicked.x - point.x) < tolerance, `clicked x ${clicked.x} should match drawn x ${point.x}`);
      assert.ok(Math.abs(clicked.z - point.z) < tolerance, `clicked z ${clicked.z} should match drawn z ${point.z}`);
    }
  });
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function classList() {
  const names = new Set();
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    contains: (name) => names.has(name),
    toggle(name, enabled) { if (enabled) names.add(name); else names.delete(name); }
  };
}

function mapHarness() {
  const window = { ...eventTarget(), innerWidth: 200, innerHeight: 200 };
  const canvas = {
    ...eventTarget(), style: {}, clientWidth: 200, clientHeight: 200,
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 200 })
  };
  const controls = eventTarget();
  const wrapper = { classList: classList() };
  const zoomIn = eventTarget(), zoomOut = eventTarget();
  const elements = {
    'fullmap-canvas': canvas, 'fullmap-canvas-wrap': wrapper,
    'fullmap-modal': { classList: classList() },
    'map-zoom-in': zoomIn, 'map-zoom-out': zoomOut
  };
  const document = {
    ...eventTarget(), hidden: false,
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => []
  };
  const captured = new Set();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
    canvas.dispatch('lostpointercapture', { pointerId: id });
  };
  const config = {
    ROADS: [], BLOCKS: [], NYC_LANDMARKS: [], CITY: { open: false },
    ISLAND_BOUNDS: { minX: -10000, maxX: 10000, minZ: -10000, maxZ: 10000 },
    getIslandBoundsAtZ: () => ({ westX: -10000, eastX: 10000 }),
    getLocationLabel: (x, z) => `${x}, ${z}`,
    isTypingInField: () => false
  };
  const { NYCMapSystem } = loadModule(source, {
    globals: { window, document },
    imports: { './geodata.js': { GEO: { frame: {} } }, './city-config.js': config }
  });
  const teleports = [], toggles = [];
  const map = new NYCMapSystem({
    controllerManager: { getActiveEntity: () => ({ position: { x: 1000, z: 2000 } }) },
    onTeleport: (x, z) => teleports.push([x, z]),
    onToggle: (open) => toggles.push(open)
  });
  // Exercise the real viewport/input state without drawing the map's geographic layers.
  map.renderFullMap = () => {};
  map.viewZoom = 1;
  map.toggleFullMap(true);
  return {
    map, canvas, controls, wrapper, window, document, captured, teleports, toggles, zoomIn, zoomOut,
    pointer(target, type, id, x = 110, y = 120, pointerType = 'touch', button = 0) {
      const event = { pointerId: id, clientX: x, clientY: y, pointerType, button, preventDefault() {} };
      (captured.has(id) ? canvas : target).dispatch(type, event);
      window.dispatch(type, event);
    }
  };
}

test('unrelated touches cannot move or release the map pan', () => {
  const h = mapHarness();
  assert.equal(h.canvas.style.touchAction, 'none');
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.controls, 'pointerdown', 2);
  h.pointer(h.canvas, 'pointerdown', 3);
  h.pointer(h.controls, 'pointermove', 2, 190);
  h.pointer(h.canvas, 'pointermove', 3, 190);
  h.pointer(h.controls, 'pointerup', 2);
  h.pointer(h.canvas, 'pointercancel', 3);
  assert.equal(h.map.viewCenterX, 1000);
  assert.equal(h.map.isPanning, true);
  assert.equal(h.teleports.length, 0);

  h.pointer(h.controls, 'pointermove', 1, 130);
  // dragged 20 px right: the world under the pointer moved with it (the map turned true north up)
  const r = (29.02 * Math.PI) / 180;
  assert.ok(Math.abs(h.map.viewCenterX - (1000 - 20 * Math.cos(r))) < 1e-9, `x ${h.map.viewCenterX}`);
  assert.ok(Math.abs(h.map.viewCenterZ - (2000 + 20 * Math.sin(r))) < 1e-9, `z ${h.map.viewCenterZ}`);
  h.pointer(h.controls, 'pointerup', 1, 130);
  assert.equal(h.map.isPanning, false);
  assert.equal(h.wrapper.classList.contains('is-panning'), false);
  assert.equal(h.teleports.length, 0);
});

test('a normal map tap teleports once and releases capture', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.teleports, [[1000, 2000]]);
  assert.equal(h.map.waypoint.name, '1000, 2000');
  assert.equal(h.captured.size, 0);
  assert.equal(h.map.isPanning, false);
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'hidden', 'close']) {
  test(`${interruption} cancels a map tap without teleporting or leaving a drag active`, () => {
    const h = mapHarness();
    h.pointer(h.canvas, 'pointerdown', 1);
    if (interruption === 'blur') h.window.dispatch('blur');
    else if (interruption === 'hidden') {
      h.document.hidden = true;
      h.document.dispatch('visibilitychange');
    } else if (interruption === 'close') h.map.toggleFullMap(false);
    else if (interruption === 'lostpointercapture') h.canvas.releasePointerCapture(1);
    else h.pointer(h.canvas, interruption, 1);
    h.pointer(h.canvas, 'pointerup', 1);
    assert.equal(h.teleports.length, 0);
    assert.equal(h.map.isPanning, false);
    assert.equal(h.captured.size, 0);
    assert.equal(h.wrapper.classList.contains('is-panning'), false);
    if (interruption === 'close') {
      assert.deepEqual(h.toggles, [true, false]);
      h.map.toggleFullMap(true);
    }
    h.pointer(h.canvas, 'pointerdown', 2);
    h.pointer(h.canvas, 'pointerup', 2);
    assert.equal(h.teleports.length, 1);
  });
}

test('a pointer released outside the map or far from its start does not teleport', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 205);
  h.pointer(h.controls, 'pointerup', 1, 215);
  h.pointer(h.canvas, 'pointerdown', 2, 110);
  h.pointer(h.canvas, 'pointerup', 2, 130);
  assert.equal(h.teleports.length, 0);
});

test('mouse hover and zoom buttons remain available without a pan', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointermove', 1, 120, 130, 'mouse');
  // 10 px right & 10 px down of the centre, turned back into the world frame
  const r = (29.02 * Math.PI) / 180;
  assert.ok(Math.abs(h.map.hoverWorld.x - (1000 + 10 * Math.cos(r) + 10 * Math.sin(r))) < 1e-9);
  assert.ok(Math.abs(h.map.hoverWorld.z - (2000 - 10 * Math.sin(r) + 10 * Math.cos(r))) < 1e-9);
  const hovered = h.map.hoverWorld.x;
  h.pointer(h.canvas, 'pointermove', 2, 180, 130);
  assert.equal(h.map.hoverWorld.x, hovered, 'untracked touch does not update hover');
  h.zoomIn.dispatch('click');
  assert.equal(h.map.viewZoom, 1.45);
  h.zoomOut.dispatch('click');
  assert.equal(h.map.viewZoom, 1);
});

// True north up: the world frame is turned GEO.frame.bearingDeg (the street grid's bearing) from true north
// (tools/city/frame.mjs: true north is (x, z) = (-sin b, -cos b)); both maps turn it back
for (const bearing of [31.8, 29.02, -12]) {
  test(`the maps put true north up for a grid ${bearing}° off it`, () => {
    const { NYCMapSystem, MapView } = loadModule(source, {
      globals: { window: { innerWidth: 400, innerHeight: 300 }, performance: { now: () => 0 } },
      imports: { './geodata.js': { GEO: { frame: { bearingDeg: bearing } } }, './city-config.js': { ROADS: [], CITY: { open: true } } }
    });
    void NYCMapSystem;
    const b = (bearing * Math.PI) / 180;
    const v = new MapView(100, 200, 0.5, 400, 300, 2);
    // a point 100 m due north of the centre is straight up the screen
    const [X, Y] = v.pt(100 - 100 * Math.sin(b), 200 - 100 * Math.cos(b));
    assert.ok(Math.abs(X) < 1e-9 && Math.abs(Y + 50) < 1e-9, `north at (${X.toFixed(3)}, ${Y.toFixed(3)})`);
    // and due east is to the right (no mirroring): east = (cos b, -sin b)
    const [Xe, Ye] = v.pt(100 + 100 * Math.cos(b), 200 - 100 * Math.sin(b));
    assert.ok(Math.abs(Xe - 50) < 1e-9 && Math.abs(Ye) < 1e-9, `east at (${Xe.toFixed(3)}, ${Ye.toFixed(3)})`);
    // the canvas transform for world geometry lands every point where pt() says
    let m;
    v.world({ setTransform: (...a) => (m = a) });
    for (const [x, z] of [[100, 200], [160, 120], [-30, 260]]) {
      const [px, py] = v.pt(x, z);
      const cx = m[0] * x + m[2] * z + m[4];
      const cy = m[1] * x + m[3] * z + m[5];
      assert.ok(Math.abs(cx - (px + 200) * 2) < 1e-6 && Math.abs(cy - (py + 150) * 2) < 1e-6, 'world transform matches pt()');
      // and back
      const back = v.unproject(px, py);
      assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.z - z) < 1e-9, 'unproject inverts pt()');
    }
    // the view's world bounds cover all four screen corners
    for (const [sx, sy] of [[-200, -150], [200, -150], [-200, 150], [200, 150]]) {
      const c = v.unproject(sx, sy);
      assert.ok(c.x >= v.minX - 1e-9 && c.x <= v.maxX + 1e-9 && c.z >= v.minZ - 1e-9 && c.z <= v.maxZ + 1e-9, 'corner inside bounds');
    }
  });
}

test('wheel zoom keeps the place under the cursor put on the turned map', () => {
  const h = mapHarness();
  const before = h.map.screenToWorld(150, 60, 200, 200);
  h.canvas.dispatch('wheel', { clientX: 160, clientY: 80, deltaY: -1, preventDefault() {} });
  const after = h.map.screenToWorld(150, 60, 200, 200);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.z - before.z) < 1e-9);
});

test('a map tap offers what to do there when the app asks to choose, and teleports otherwise', () => {
  const h = mapHarness();
  const picks = [];
  h.map.onPick = (x, z, name, clientX, clientY) => picks.push([x, z, name, clientX, clientY]);
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(picks, [[1000, 2000, '1000, 2000', 110, 120]]);
  assert.equal(h.teleports.length, 0, 'the choice is the app\'s, not a teleport');
});
