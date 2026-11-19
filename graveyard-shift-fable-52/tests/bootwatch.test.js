import { describe, it, expect } from 'vitest';
import {
  buildDetails, createStallMeter, warmLabel, createBootWatch, SLOW_MS, NOTE_MS, NOTE_TEXT, LOST_WAIT_MS, readGl,
} from '../src/core/bootwatch.js';
import { createFakeDoc, createFakeWin } from './fakes/dom.js';

function bootScreen(doc) {
  const boot = doc.createElement('div'); boot.id = 'boot';
  const foot = doc.createElement('div'); foot.className = 'ld-foot';
  boot.appendChild(foot); doc.body.appendChild(boot);
  return foot;
}
function setup() {
  const doc = createFakeDoc();
  const win = createFakeWin({ __errors: [] });
  bootScreen(doc);
  const watch = createBootWatch({ win, doc, now: win.now, wallClock: () => new Date(Date.UTC(2026, 10, 11, 12, 0, 0)) });
  return { doc, win, watch };
}
const textOf = (e) => (e ? [e.textContent, ...e.children.map(textOf)].join(' ') : '');

describe('boot watch: the details text', () => {
  const base = {
    when: '2026-11-11T12:00:00.000Z', ua: 'Mozilla/5.0 (Windows NT 10.0)', gpu: 'ANGLE (NVIDIA GeForce GTX 1060 Direct3D11)',
    parallel: true, colorFloat: true, stage: 'shaders', running: true, elapsedMs: 52300,
    stages: [['renderer', 210], ['zombies', 4100], ['shaders', 48000]], programs: { ready: 40, total: 67, mode: 'parallel' },
    lost: false, restored: 0, stall: { ms: 1400, stage: 'level' }, errors: [], failed: [],
  };

  it('says everything a bug report needs, in plain lines', () => {
    const t = buildDetails(base);
    expect(t).toContain('Browser: Mozilla/5.0 (Windows NT 10.0)');
    expect(t).toContain('Graphics: ANGLE (NVIDIA GeForce GTX 1060 Direct3D11)');
    expect(t).toContain('KHR_parallel_shader_compile: yes   EXT_color_buffer_float: yes');
    expect(t).toContain('Stage: shaders (still running)');
    expect(t).toContain('Seconds per stage: renderer 0.2, zombies 4.1, shaders 48.0');
    expect(t).toContain('Shaders ready: 40 / 67 programs (parallel)');
    expect(t).toContain('Context lost: no');
    expect(t).toContain('Longest pause: 1.4 s (level)');
    expect(t).toContain('Errors: none');
    expect(t).toContain('52.3 s after the page opened');
  });

  it('lists the first errors, shader logs longer than the rest, one line each', () => {
    const shader = `[console.error] [shader] zombie [MeshStandardMaterial] failed to compile or link: ${'X'.repeat(3000)}`;
    const errors = [shader, `[error] ${'y'.repeat(2000)}`, 'a\nb', '4', '5', '6', '7'];
    const t = buildDetails({ ...base, errors, lost: true, restored: 1, parallel: false, programs: { ready: 3, total: 9, mode: 'sliced', timedOut: true } });
    const lines = t.split('\n');
    expect(t).toContain('Errors (7, first 6):');
    const sh = lines.find((l) => l.includes('[shader]'));
    expect(sh.length).toBe(2 + 1500);
    expect(lines.find((l) => l.startsWith('- [error]')).length).toBe(2 + 600);
    expect(t).toContain('- a | b');
    expect(t).not.toContain('- 7');
    expect(t).toContain('Context lost: yes (given back 1 time)');
    expect(t).toContain('KHR_parallel_shader_compile: no');
    expect(t).toContain('Shaders ready: 3 / 9 draws (sliced), gave up waiting');
  });

  it('labels the progress line', () => {
    expect(warmLabel({ ready: 23, total: 67 })).toBe('Preparing graphics 23 / 67');
    expect(warmLabel({ ready: 0, total: 0 })).toBe('Preparing graphics');
    expect(warmLabel({ ready: 9, total: 4 })).toBe('Preparing graphics 4 / 4');
  });

  it('reads the device, and leaves what it cannot read unknown', () => {
    const gl = {
      RENDERER: 1, isContextLost: () => false, getParameter: (p) => (p === 7 ? 'ANGLE (D3D11)' : 'masked'),
      getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 7 } : n === 'EXT_color_buffer_float' ? {} : null),
    };
    expect(readGl(gl)).toEqual({ gpu: 'ANGLE (D3D11)', parallel: false, colorFloat: true });
    expect(readGl({ isContextLost: () => true })).toEqual({ gpu: null, parallel: null, colorFloat: null });
  });
});

describe('boot watch: the stall meter', () => {
  it('puts each gap on the side of __ready it began on, and on the stage it began in', () => {
    const m = createStallMeter(0, 5000);
    m.beat(25, false, 'level');
    m.beat(1425, false, 'weapon'); // 1.4 s that began while 'level' was running
    m.beat(1450, false, 'shaders');
    m.beat(4450, true, 'ready'); // the turn that set __ready ends a boot gap of 3 s
    m.beat(4500, true, 'ready');
    m.beat(4900, true, 'ready'); // 400 ms after ready
    m.beat(10000, true, 'ready'); // began 0.45 s into the window: still counted
    m.beat(10100, true, 'ready');
    const r = m.report();
    expect(r.bootMs).toBe(3000);
    expect(r.bootStage).toBe('shaders');
    expect(r.worstByStage.level).toBe(1400);
    expect(r.afterReadyMs).toBe(5100);
    expect(r.readyAtS).toBe(4.5);
    expect(m.done).toBe(true);
  });
});

describe('boot watch: on the page', () => {
  it('shows the progress under the bar, the calm note after 10 s, and clears both at ready', () => {
    const { doc, win, watch } = setup();
    watch.stage('shaders');
    watch.progress({ ready: 3, total: 67, mode: 'parallel' });
    const status = doc.getElementById('boot-status');
    expect(status.textContent).toBe('Preparing graphics 3 / 67');
    const note = doc.getElementById('boot-note');
    expect(note.textContent).toBe(NOTE_TEXT);
    expect(note.hidden).toBe(true);
    win.advance(NOTE_MS - 100);
    expect(note.hidden).toBe(true);
    win.advance(200);
    expect(note.hidden).toBe(false);
    watch.progress({ ready: 67, total: 67, mode: 'parallel' });
    expect(status.textContent).toBe('Preparing graphics 67 / 67');
    watch.ready();
    expect(note.hidden).toBe(true);
  });

  it('publishes the heartbeat as window.__bootStalls', () => {
    const { win, watch } = setup();
    watch.stage('level');
    win.advance(500);
    expect(win.__bootStalls.beats).toBeGreaterThan(5);
    expect(win.__bootStalls.bootMs).toBeLessThan(100);
  });

  it('after 45 s without __ready: a small box with the live status and Copy details; gone at ready', async () => {
    const { doc, win, watch } = setup();
    watch.stage('shaders');
    watch.progress({ ready: 40, total: 67, mode: 'parallel' });
    win.advance(SLOW_MS - 10);
    expect(doc.getElementById('boot-watch')).toBe(null);
    win.advance(20);
    const box = doc.getElementById('boot-watch');
    expect(box).not.toBe(null);
    expect(textOf(box)).toContain('Still loading');
    expect(textOf(box)).toContain('Preparing graphics 40 / 67. 45 s so far');
    win.advance(3000);
    expect(textOf(box)).toContain('48 s so far');
    // Copy details puts the text on the clipboard and shows it
    let copied = null;
    win.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
    const copy = box.querySelector('.gs-bw-actions').children.find((b) => b.textContent === 'Copy details');
    copy.click();
    await Promise.resolve();
    expect(copied).toContain('Graveyard Shift: loading details');
    expect(copied).toContain('Stage: shaders (still running)');
    expect(copied).toContain('Shaders ready: 40 / 67 programs (parallel)');
    expect(copy.textContent).toBe('Copied');
    watch.ready();
    expect(doc.getElementById('boot-watch')).toBe(null);
  });

  it('a stage that threw: a box that says which, and stays until dismissed', () => {
    const { doc, win, watch } = setup();
    watch.stage('zombies');
    watch.fail('zombies', new Error('no bodies'));
    watch.ready();
    win.advance(SLOW_MS + 1000);
    const box = doc.getElementById('boot-watch');
    expect(textOf(box)).toContain('zombies: no bodies');
    expect(watch.details()).toContain('Stages that failed: zombies');
    box.querySelector('.gs-bw-actions').children.find((b) => b.textContent === 'Dismiss').click();
    expect(doc.getElementById('boot-watch')).toBe(null);
  });

  it('a context lost during the boot and not given back: a full message with Reload; given back: nothing', () => {
    const { doc, win, watch } = setup();
    const canvas = doc.createElement('canvas');
    watch.attach({ getContext: () => ({ isContextLost: () => false, getExtension: () => null, getParameter: () => 'GPU', RENDERER: 1 }), domElement: canvas });
    canvas.dispatch('webglcontextlost');
    win.advance(LOST_WAIT_MS + 10);
    const fail = doc.getElementById('boot-failed');
    expect(textOf(fail)).toContain('Graphics context lost');
    fail.querySelector('.gs-bw-actions').children.find((b) => b.textContent === 'Reload').click();
    expect(win.reloaded).toBe(1);
    expect(watch.details()).toContain('Context lost: yes');

    const b = setup();
    const c2 = b.doc.createElement('canvas');
    b.watch.attach({ getContext: () => null, domElement: c2 });
    c2.dispatch('webglcontextlost');
    let back = false;
    b.watch.waitForRestore().then((v) => { back = v; });
    c2.dispatch('webglcontextrestored');
    b.win.advance(LOST_WAIT_MS + 10);
    expect(b.doc.getElementById('boot-failed')).toBe(null);
    return Promise.resolve().then(() => { expect(back).toBe(true); expect(b.watch.details()).toContain('Context lost: no (given back 1 time)'); });
  });

  it('waits for the restore when the context says it is lost before its event arrives', async () => {
    const { doc, watch } = setup();
    const canvas = doc.createElement('canvas');
    let lost = true;
    watch.attach({ getContext: () => ({ isContextLost: () => lost, getExtension: () => null, getParameter: () => '', RENDERER: 1 }), domElement: canvas });
    let back = false;
    watch.waitForRestore().then(() => { back = true; });
    await Promise.resolve();
    expect(back).toBe(false);
    canvas.dispatch('webglcontextlost');
    lost = false;
    canvas.dispatch('webglcontextrestored');
    await Promise.resolve();
    expect(back).toBe(true);
  });

  it('when the renderer already put up its own message, the buttons join it instead', () => {
    const { doc, win, watch } = setup();
    const canvas = doc.createElement('canvas');
    watch.attach({ getContext: () => null, domElement: canvas });
    const own = doc.createElement('div'); own.id = 'gfx-lost'; doc.body.appendChild(own);
    canvas.dispatch('webglcontextlost');
    win.advance(LOST_WAIT_MS + 10);
    expect(doc.getElementById('boot-failed')).toBe(null);
    expect(own.querySelector('.gs-bw-actions')).not.toBe(null);
  });

  it('a fatal boot error: the full message', () => {
    const { doc, watch } = setup();
    watch.fatal(new Error('boom'));
    expect(textOf(doc.getElementById('boot-failed'))).toContain('could not finish loading');
  });
});

describe('boot watch: software renderer and console', () => {
  it('says plainly on the loading screen that the graphics card is not used, and in the details', () => {
    const { doc, watch } = setup();
    const gl = { RENDERER: 1, isContextLost: () => false, getParameter: () => 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', getExtension: () => null };
    watch.attach({ getContext: () => gl, domElement: null });
    const soft = doc.getElementById('boot-soft');
    expect(textOf(soft)).toContain('Your browser is drawing without your graphics card');
    expect(textOf(soft)).toContain('Chrome or Edge');
    expect(textOf(soft)).toContain('Firefox');
    expect(watch.details()).toContain('Software renderer: yes');
  });

  it('a hardware renderer: no notice, and the details say no', () => {
    const { doc, watch } = setup();
    const gl = { RENDERER: 1, isContextLost: () => false, getParameter: () => 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5)', getExtension: () => null };
    watch.attach({ getContext: () => gl, domElement: null });
    expect(doc.getElementById('boot-soft')).toBe(null);
    expect(watch.details()).toContain('Software renderer: no');
  });

  it('writes the details to console.info when still loading, again every 30 s, and at ready', () => {
    const { win, watch } = setup();
    const info = [];
    const orig = console.info;
    console.info = (m) => info.push(m);
    try {
      win.advance(SLOW_MS + 10);
      expect(info.length).toBe(1);
      expect(info[0]).toContain('[boot details] still loading');
      win.advance(30000);
      expect(info.length).toBe(2);
      watch.ready();
      expect(info.at(-1)).toContain('[boot details] ready');
      win.advance(60000);
      expect(info.length).toBe(3);
    } finally { console.info = orig; }
  });
});
