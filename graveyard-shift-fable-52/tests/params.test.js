import { describe, it, expect } from 'vitest';
import { parseParams } from '../src/core/params.js';

describe('parseParams', () => {
  it('parses the documented example', () => {
    expect(parseParams('?cam=1,2,3,0.5,-0.1&step=1&q=low')).toEqual({ cam: [1, 2, 3, 0.5, -0.1], step: true, q: 'low' });
  });
  it('malformed cam yields undefined, not NaN', () => {
    expect(parseParams('?cam=abc').cam).toBeUndefined();
    expect(parseParams('?cam=1,2,3').cam).toBeUndefined();
    expect(parseParams('?cam=1,2,,4,5').cam).toBeUndefined();
  });
  it('parses numbers and rejects junk', () => {
    expect(parseParams('dt=0.016&seed=5&fov=70')).toEqual({ dt: 0.016, seed: 5, fov: 70 });
    expect(parseParams('dt=x').dt).toBeUndefined();
  });
  it('parses flags', () => {
    expect(parseParams('autostart=1&god=0&bot=1')).toMatchObject({ autostart: true, god: false, bot: true });
  });
  it('empty input gives empty object', () => {
    expect(parseParams('')).toEqual({});
  });
  it('parses the extended harness params, typed', () => {
    expect(parseParams('?q=mobile&touch=1&rs=0.7&zone=motel&give=smg,pump&open=all&points=5000')).toEqual({
      q: 'mobile', touch: true, rs: 0.7, zone: 'motel', give: ['smg', 'pump'], open: 'all', points: 5000,
    });
  });
  it('drops a render scale outside 0.5..1', () => {
    expect(parseParams('rs=7').rs).toBeUndefined();
    expect(parseParams('rs=0.2').rs).toBeUndefined();
    expect(parseParams('rs=0.5').rs).toBe(0.5);
    expect(parseParams('rs=1').rs).toBe(1);
  });
  it('open is "all" or a list of door ids', () => {
    expect(parseParams('open=diner,motel')).toEqual({ open: ['diner', 'motel'] });
    expect(parseParams('open=')).toEqual({});
  });
  it('parses flags, hints, gore and the rest', () => {
    expect(parseParams('autotier=1&power=1')).toEqual({ autotier: true, power: true });
    expect(parseParams('hints=0').hints).toBe(false);
    expect(parseParams('hints=reset').hints).toBe('reset');
    expect(parseParams('hints=1').hints).toBe(true);
    expect(parseParams('gore=reduced').gore).toBe('reduced');
    expect(parseParams('gore=lots').gore).toBeUndefined();
    expect(parseParams('searched=all').searched).toBe('all');
    expect(parseParams('searched=some').searched).toBeUndefined();
    expect(parseParams('plates=2&ztype=runner')).toEqual({ plates: 2, ztype: 'runner' });
    expect(parseParams('give=,,').give).toBeUndefined();
  });
});
