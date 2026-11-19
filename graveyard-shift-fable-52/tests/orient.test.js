// The landscape suggestion (orient.js): never blocks or pauses; a line on the title in portrait, a
// toast at the first upright moment of each run, then a glyph until the phone turns; a tap hides it
// for the session.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mode, createOrient, TOAST_MS, TURN_TEXT } from '../src/ui/orient.js';
import { createEvents } from '../src/core/events.js';

describe('mode()', () => {
  const base = { touch: true, portrait: true, state: 'title', dismissed: false, toasting: false };
  it('title in portrait: the line', () => expect(mode(base)).toBe('line'));
  it('landscape, no touch, dismissed: off', () => {
    expect(mode({ ...base, portrait: false })).toBe('off');
    expect(mode({ ...base, touch: false })).toBe('off');
    expect(mode({ ...base, dismissed: true })).toBe('off');
  });
  it('playing: the line while the toast runs, the glyph after', () => {
    expect(mode({ ...base, state: 'playing', toasting: true })).toBe('line');
    expect(mode({ ...base, state: 'playing' })).toBe('glyph');
  });
  it('pause and death screens: off', () => {
    expect(mode({ ...base, state: 'paused' })).toBe('off');
    expect(mode({ ...base, state: 'dead' })).toBe('off');
  });
  it('the words', () => expect(TURN_TEXT).toBe('Turn your phone sideways for a bigger view'));
});

// A minimal DOM: just what orient.js touches.
const fakeEl = () => {
  const l = {};
  const cls = new Set();
  return {
    hidden: false, children: [], attrs: {}, textContent: '', className: '',
    classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; }, append(...k) { this.children.push(...k); }, appendChild(k) { this.children.push(k); },
    addEventListener(t, f) { (l[t] ||= []).push(f); }, fire(t) { for (const f of l[t] || []) f({ stopPropagation() {} }); },
    set innerHTML(v) { this._html = v; },
  };
};

describe('createOrient', () => {
  let saved;
  let session;
  beforeEach(() => {
    vi.useFakeTimers();
    saved = { window: globalThis.window, document: globalThis.document };
    session = new Map();
    globalThis.window = { addEventListener() {}, sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)) } };
    globalThis.document = { createElement: fakeEl, createElementNS: fakeEl };
  });
  afterEach(() => { vi.useRealTimers(); globalThis.window = saved.window; globalThis.document = saved.document; });

  const setup = (state = 'title', portrait = true) => {
    const cbs = [];
    const G = { events: createEvents(), game: { state }, device: { touch: true, portrait, onChange: (f) => cbs.push(f) } };
    const o = createOrient(G, fakeEl());
    const go = (s) => { G.game.state = s; G.events.emit('game:state', { state: s }); };
    const turn = (p) => { G.device.portrait = p; for (const f of cbs) f(G.device); };
    return { G, o, go, turn };
  };

  it('never pauses or blocks: visible is always false, the game state is untouched', () => {
    const { G, o, go } = setup('title');
    go('playing');
    expect(o.visible).toBe(false);
    expect(G.game.state).toBe('playing');
  });
  it('title in portrait shows the line; landscape hides it', () => {
    const { o, turn } = setup('title');
    expect(o.mode).toBe('line');
    expect(o.el.hidden).toBe(false);
    turn(false);
    expect(o.mode).toBe('off');
    expect(o.el.hidden).toBe(true);
  });
  it('a run: toast for TOAST_MS, then the glyph; landscape hides it; no second toast in the same run', () => {
    const { o, go, turn } = setup('title');
    go('playing');
    expect(o.mode).toBe('line');
    expect(o.el.classList.contains('play')).toBe(true); // placed under the top corners in play
    vi.advanceTimersByTime(TOAST_MS - 10);
    expect(o.mode).toBe('line');
    vi.advanceTimersByTime(20);
    expect(o.mode).toBe('glyph');
    expect(o.el.classList.contains('mini')).toBe(true);
    turn(false);
    expect(o.mode).toBe('off');
    turn(true);
    expect(o.mode).toBe('glyph'); // same run: the glyph, not another toast
    go('paused');
    expect(o.mode).toBe('off');
    go('playing');
    expect(o.mode).toBe('glyph');
  });
  it('the toast waits for the first upright moment of the run, and a new run toasts again', () => {
    const { o, go, turn } = setup('title', false);
    go('playing');
    expect(o.mode).toBe('off');
    turn(true);
    expect(o.mode).toBe('line');
    vi.advanceTimersByTime(TOAST_MS + 1);
    go('dead');
    expect(o.mode).toBe('off');
    go('playing');
    expect(o.mode).toBe('line');
  });
  it('a tap hides it for the session (sessionStorage), and a new page in the same session stays quiet', () => {
    const { o, go } = setup('title');
    o.el.fire('click');
    expect(o.mode).toBe('off');
    go('playing');
    expect(o.mode).toBe('off');
    expect(session.get('graveyard-shift.turnHint')).toBe('1');
    const again = setup('title');
    expect(again.o.mode).toBe('off');
  });
  it('no sessionStorage (a sandboxed frame): dismissal still works for this page', () => {
    globalThis.window.sessionStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const { o } = setup('title');
    expect(o.mode).toBe('line');
    expect(() => o.dismiss()).not.toThrow();
    expect(o.mode).toBe('off');
  });
  it('a desktop (no touch) never shows it', () => {
    const G = { events: createEvents(), game: { state: 'title' }, device: { touch: false, portrait: true, onChange() {} } };
    expect(createOrient(G, fakeEl()).mode).toBe('off');
  });
});
