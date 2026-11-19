import { describe, it, expect } from 'vitest';
import { slotsView, timerPct, platesView, throwablesView, timerView, ringView, toastFor, pushToast, bannerFor, RING_R } from '../src/ui/panels.js';
import { summaryRows } from '../src/ui/endscreen.js';
import { compassFor } from '../src/ui/objective.js';

describe('weapon slots', () => {
  it('two slots, the held one marked, an empty one empty', () => {
    const v = slotsView({ slots: [{ id: 'pistol', mag: 8, reserve: 40, upgraded: false, attachments: new Set() }, null], slot: 0 });
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ id: 'pistol', name: 'Wren 9', held: true, upgraded: false });
    expect(v[1]).toBeNull();
  });
  it('slot view for [{id:pistol}, null] works with the bare minimum', () => {
    const v = slotsView({ slots: [{ id: 'pistol' }, null], slot: 1 });
    expect(v[0]).toMatchObject({ id: 'pistol', held: false, pips: { up: false, attach: 0 } });
    expect(v[1]).toBeNull();
  });
  it('counts upgrade and attachment pips', () => {
    const v = slotsView({ slots: [{ id: 'pump', upgraded: true, attachments: new Set(['sight', 'grip']) }, { id: 'pistol' }], slot: 0 });
    expect(v[0].pips).toEqual({ up: true, attach: 2 });
    expect(v[0].held).toBe(true);
  });
});

describe('plates, throwables, timers', () => {
  it('plates 0-3', () => {
    expect(platesView(0)).toEqual({ show: false, filled: 0, total: 3 });
    expect(platesView(1).filled).toBe(1);
    expect(platesView(3)).toEqual({ show: true, filled: 3, total: 3 });
    expect(platesView(9).filled).toBe(3);
    expect(platesView(-2).filled).toBe(0);
    expect(platesView(undefined).show).toBe(false);
  });
  it('throwables: the selected kind and what is carried', () => {
    expect(throwablesView({ throwables: { frag: 2, molotov: 0, decoy: 1 }, throwable: 'decoy' })).toEqual([
      { kind: 'frag', name: 'Frag', count: 2, selected: false },
      { kind: 'decoy', name: 'Decoy', count: 1, selected: true },
    ]);
    expect(throwablesView({ throwables: { frag: 0, molotov: 0, decoy: 0 } })).toEqual([]);
    expect(throwablesView(undefined)).toEqual([]);
  });
  it('a timer at 12.4 of 30 seconds is 41 %', () => {
    expect(timerView(12.4, 30).pct).toBe(41);
    expect(timerView(40, 30).pct).toBe(100);
    expect(timerView(-1, 30).pct).toBe(0);
    expect(timerView(5, 0).pct).toBe(0);
  });
});

describe('no per-tick allocation helpers', () => {
  it('slotsView fills a caller-owned array and timerPct is a number', () => {
    const out = [{}, {}];
    const w = { slots: [{ id: 'pistol', mag: 4, reserve: 9 }, null], slot: 0 };
    const r = slotsView(w, out);
    expect(r).toBe(out);
    expect(out[0].id).toBe('pistol');
    expect(out[1]).toBeNull();
    const first = out[0];
    slotsView(w, out);
    expect(out[0]).toBe(first); // same object, refilled
    expect(timerPct(12.4, 30)).toBe(41);
  });
});

describe('search ring', () => {
  it('half progress is half a turn; nothing at 0', () => {
    const half = ringView(0.5);
    expect(half.show).toBe(true);
    expect(half.turn).toBeCloseTo(0.5, 6);
    expect(half.dash).toBeCloseTo(Math.PI * RING_R, 6); // half of 2*pi*r
    expect(half.circ).toBeCloseTo(2 * Math.PI * RING_R, 6);
    expect(ringView(0).show).toBe(false);
    expect(ringView(undefined).show).toBe(false);
    expect(ringView(1.7).turn).toBe(1);
    expect(ringView(-1).show).toBe(false);
  });
});

describe('toasts', () => {
  it('names every reward kind', () => {
    expect(toastFor({ kind: 'nothing' }).text).toBe('Nothing here');
    expect(toastFor({ kind: 'ammo', item: 'pistol', amount: 36 }).text).toBe('+36 rounds');
    expect(toastFor({ kind: 'points', amount: 150 }).text).toBe('+150');
    expect(toastFor({ kind: 'medkit', amount: 60 }).text).toBe('Medkit');
    expect(toastFor({ kind: 'plate' }).text).toBe('Armour plate');
    expect(toastFor({ kind: 'throwable', item: 'molotov' }).text).toBe('Molotov');
    expect(toastFor({ kind: 'attachment', item: 'sight' }).text).toBe('Sight');
    expect(toastFor({ kind: 'powerup', item: 'oneTap', amount: 15 }).text).toBe('One-Tap · 15s');
    expect(toastFor({ kind: 'weapon', item: 'axe' }).text).toBe('Fire axe');
    expect(toastFor({ kind: 'weapon', item: 'revolver' }).text).toMatch(/Marlow/);
    expect(toastFor(null)).toBeNull();
    expect(toastFor({ kind: 'mystery' }).text).toBe('Found something');
  });
  it('at most three stacked: a fourth drops the oldest', () => {
    let list = [];
    for (const n of ['a', 'b', 'c', 'd']) list = pushToast(list, { text: n }, 0, 3);
    expect(list.map((t) => t.text)).toEqual(['b', 'c', 'd']);
  });
  it('a pickup of a weapon says it is taken', () => {
    expect(toastFor({ kind: 'weapon', item: 'axe' }, 'take').text).toBe('Fire axe taken');
  });
});

describe('banner and compass', () => {
  it('round banner copy', () => {
    expect(bannerFor('start', { n: 3, boss: false })).toEqual({ big: '3', small: 'Round' });
    expect(bannerFor('start', { n: 5, boss: true })).toEqual({ big: '5', small: 'Boss round' });
    expect(bannerFor('end', { n: 3 })).toEqual({ big: '3', small: 'Round cleared' });
  });
  it('compass: ahead is the middle, behind pins to an edge, near hides', () => {
    const p = { pos: [0, 0, 0], yaw: 0 };
    expect(compassFor(p, [0, -20]).x).toBeCloseTo(0.5, 5);
    const right = compassFor(p, [20, 0]); // forward is -z, so +x is on the right
    expect(right.side).toBe(1);
    expect(compassFor(p, [0, 20]).side).not.toBe(0);
    expect(compassFor(p, [0, -2]).show).toBe(false);
    expect(compassFor(null, [0, -20]).show).toBe(false);
    expect(compassFor(p, null).show).toBe(false);
  });
});

describe('end screen rows', () => {
  it('renders the rows in the order given, dropping the big round numeral duplicate', () => {
    const rows = summaryRows({ rows: [{ label: 'Round reached', value: '7' }, { label: 'Kills', value: '61' }, { label: 'Headshots', value: '12' }, { label: 'Time', value: '9:41' }] });
    expect(rows.map((r) => r.label)).toEqual(['Kills', 'Headshots', 'Time']);
    expect(rows[2].value).toBe('9:41');
  });
  it('other modules add rows without touching the UI', () => {
    const rows = summaryRows({ rows: [{ label: 'Kills', value: '1' }, { label: 'Zebra', value: 'z' }, { label: 'Aardvark', value: 'a' }] });
    expect(rows.map((r) => r.label)).toEqual(['Kills', 'Zebra', 'Aardvark']);
  });
  it('is safe on anything', () => {
    expect(summaryRows(null)).toEqual([]);
    expect(summaryRows({})).toEqual([]);
    expect(summaryRows({ rows: [null, { label: 'X' }, { label: 'Y', value: 4 }] })).toEqual([{ label: 'Y', value: '4' }]);
  });
});

describe('missing optional state renders nothing and throws nothing', () => {
  it('every view-model tolerates absent input', () => {
    expect(() => {
      slotsView(undefined); slotsView({}); slotsView({ slots: [null, null] });
      platesView(); throwablesView({}); timerView(); ringView(); toastFor(undefined);
    }).not.toThrow();
    expect(slotsView(undefined)).toEqual([]);
    expect(slotsView({ slots: [null, null] })).toEqual([null, null]);
  });
});
