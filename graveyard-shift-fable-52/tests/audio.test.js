import { describe, it, expect } from 'vitest';
import { areaAt } from '../src/audio/engine.js';
import { areas } from '../src/level/layout.js';

describe('audio area from the level', () => {
  it('is canopy under the fuel canopy and the store awning, open elsewhere', () => {
    expect(areaAt(areas, [-2, 1.7, -3])).toBe('canopy'); // between the pumps
    expect(areaAt(areas, [0, 1.7, -19])).toBe('canopy'); // store pavement under the awning
    expect(areaAt(areas, [-4, 1.7, 12])).toBe('open'); // player start
    expect(areaAt(areas, [-2, 6.5, -3])).toBe('open'); // above the canopy deck
  });
  it('is open with no areas, a bad area or no position', () => {
    expect(areaAt(undefined, [0, 0, 0])).toBe('open');
    expect(areaAt([null, {}], [0, 0, 0])).toBe('open');
    expect(areaAt(areas, null)).toBe('open');
  });
});

import { vi } from 'vitest';
import { createAudio, voiceCapFor, panningFor } from '../src/audio/engine.js';

describe('audio before unlock and bad names', () => {
  it('play before unlock is a silent no-op', () => {
    const a = createAudio({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(a.play('pistol')).toBe(null);
    expect(a.play('pistol', { pos: [1, 2, 3] }, 0.5)).toBe(null);
    expect(() => a.setArea('diner')).not.toThrow();
    expect(() => a.update(0.016)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    expect(a.stats().state).toBe('locked');
    warn.mockRestore();
  });
  it('an unknown name warns once and returns', () => {
    const a = createAudio({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(a.play('no-such-sound')).toBe(null);
    expect(a.play('no-such-sound')).toBe(null);
    expect(warn).toHaveBeenCalledTimes(1);
    a.play('another-missing');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('voice budget by tier', () => {
  it('caps voices at 24 on mobile and 32 elsewhere, equal-power panning on mobile', () => {
    expect(voiceCapFor({ tier: 'mobile' })).toBe(24);
    expect(voiceCapFor({ tier: 'high' })).toBe(32);
    expect(voiceCapFor(undefined)).toBe(32);
    expect(voiceCapFor({ tier: 'mobile', audioVoices: 16 })).toBe(16);
    expect(panningFor({ tier: 'mobile' })).toBe('equalpower');
    expect(panningFor({ tier: 'low' })).toBe('HRTF');
  });
});

import { areaAt as areaOf, occlusionAt, SOUND_NAMES, musicDefaultFor, WALKWAY } from '../src/audio/engine.js';
import { areas as worldAreas, zones, zoneAt, doors } from '../src/level/worldLayout.js';
import { WEAPON_IDS } from '../src/audio/weapons.js';
import { musicMix, musicIntensity } from '../src/audio/music.js';
import { AREA_NAMES } from '../src/audio/ambience.js';
import { EVENTS } from '../src/audio/events.js';

const level = { zones, zoneAt, doors: doors.map((d) => ({ ...d, open: false })) };
const all = [...areas, ...worldAreas];

describe('acoustic spaces from the level', () => {
  it('names the eight spaces', () => {
    expect(AREA_NAMES.sort()).toEqual(['canopy', 'diner', 'garage', 'kitchen', 'motelRoom', 'open', 'scrapyard', 'walkway']);
    expect(areaOf(all, [12, 1.7, -25], level)).toBe('diner');
    expect(areaOf(all, [23, 1.7, -25], level)).toBe('kitchen');
    expect(areaOf(all, [50, 1.7, 10], level)).toBe('garage');
    expect(areaOf(all, [30, 1.7, 15], level)).toBe('scrapyard');
    expect(areaOf(all, [40, 1.7, -37], level)).toBe('walkway');
    expect(areaOf(all, [40, 1.7, -20], level)).toBe('open');
    expect(areaOf(all, [-2, 1.7, -3], level)).toBe('canopy');
    const room = worldAreas.find((a) => a.name === 'motelRoom');
    const mid = [0, 1, 2].map((i) => (room.min[i] + room.max[i]) / 2);
    expect(areaOf(all, mid, level)).toBe('motelRoom');
    expect(WALKWAY.length).toBe(2);
  });
  it('occludes through closed walls between zones, less through an open door or a window', () => {
    const fc = [0, 1.6, 10], diner = [12, 1.6, -25], motel = [40, 1.6, -20];
    expect(occlusionAt(level, all, fc, [3, 1, 5])).toBe(0);
    expect(occlusionAt(level, all, fc, diner)).toBe(2);
    const open = { ...level, doors: level.doors.map((d) => ({ ...d, open: d.id === 'd1' })) };
    expect(occlusionAt(open, all, fc, diner)).toBe(1);
    expect(occlusionAt(open, all, fc, motel)).toBe(2);
    expect(occlusionAt(level, all, [40, 1.6, -20], [40, 1.6, -42])).toBe(1); // lot and a motel room
    expect(occlusionAt(level, all, null, diner)).toBe(0);
  });
});

describe('sound names and events', () => {
  it('every weapon has its shot, variants, tails, dry and reload names', () => {
    expect(WEAPON_IDS.length).toBe(10);
    for (const id of WEAPON_IDS) for (const s of ['shot', 'shot:upgraded', 'shot:suppressed', 'tail-open', 'tail-room', 'dry']) expect(SOUND_NAMES).toContain(`${id}:${s}`);
    for (const id of WEAPON_IDS) expect(SOUND_NAMES.some((n) => n.startsWith(`${id}:reload-`))).toBe(true);
  });
  it('binds the events the game emits', () => {
    for (const e of ['weapon:fire', 'weapon:reload', 'weapon:switch', 'explosion', 'fire:pool', 'flare:launch', 'weapon:arc', 'zombie:burst', 'board:break', 'door:open', 'power:on', 'search:start', 'search:cancel', 'search:done', 'box:roll', 'powerup:take', 'round:start', 'hint:show']) expect(EVENTS).toContain(e);
  });
});

describe('music bed', () => {
  it('is off by default on mobile, on elsewhere', () => {
    expect(musicDefaultFor({ tier: 'mobile' })).toBe(false);
    expect(musicDefaultFor({ tier: 'high' })).toBe(true);
  });
  it('follows alive / maxAlive and the last quarter of a round', () => {
    expect(musicIntensity(6, 24, 0, 20)).toEqual({ intensity: 0.25, lastQuarter: false });
    expect(musicIntensity(2, 24, 16, 20).lastQuarter).toBe(true);
    expect(musicIntensity(2, 24, 16, 20).intensity).toBe(0.5);
    const lo = musicMix(0, false), hi = musicMix(1, false), late = musicMix(0.5, true);
    expect(lo.music_pulse).toBe(0);
    expect(hi.music_pulse).toBe(1);
    expect(hi.music_drone).toBeGreaterThan(lo.music_drone);
    expect(late.music_high).toBeGreaterThan(musicMix(0.5, false).music_high);
  });
});
