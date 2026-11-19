import { describe, it, expect, vi } from 'vitest';
import { createEvents } from '../src/core/events.js';

describe('events', () => {
  it('delivers payloads to handlers in order', () => {
    const e = createEvents(); const seen = [];
    e.on('x', (p) => seen.push(['a', p])); e.on('x', (p) => seen.push(['b', p]));
    e.emit('x', 1);
    expect(seen).toEqual([['a', 1], ['b', 1]]);
  });
  it('a throwing handler does not stop later handlers', () => {
    const onError = vi.fn(); const e = createEvents(onError); const later = vi.fn();
    e.on('x', () => { throw new Error('boom'); }); e.on('x', later);
    expect(() => e.emit('x', 1)).not.toThrow();
    expect(later).toHaveBeenCalledWith(1);
    expect(onError).toHaveBeenCalledOnce();
  });
  it('off / unsubscribe works, emit with no handlers is fine', () => {
    const e = createEvents(); const fn = vi.fn();
    const un = e.on('x', fn); un(); e.emit('x'); e.emit('nothing');
    expect(fn).not.toHaveBeenCalled();
  });
});
