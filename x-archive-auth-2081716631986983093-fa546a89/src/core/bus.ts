/**
 * Tiny typed event bus. The sim raises events; FX, audio and UI subscribe.
 *
 * Handlers are called synchronously in registration order. Payload objects are
 * REUSED by the emitter for hot events (`hit`, `fire`) — consumers must copy any
 * field they intend to keep past the call.
 */

import type { GameEvents } from './types';

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

export class EventBus {
  private map = new Map<string, Array<(p: unknown) => void>>();

  on<K extends keyof GameEvents>(key: K, fn: Handler<K>): () => void {
    let list = this.map.get(key as string);
    if (!list) {
      list = [];
      this.map.set(key as string, list);
    }
    list.push(fn as (p: unknown) => void);
    return () => this.off(key, fn);
  }

  off<K extends keyof GameEvents>(key: K, fn: Handler<K>): void {
    const list = this.map.get(key as string);
    if (!list) return;
    const i = list.indexOf(fn as (p: unknown) => void);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof GameEvents>(key: K, payload: GameEvents[K]): void {
    const list = this.map.get(key as string);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }

  clear(): void {
    this.map.clear();
  }
}

/** Process-wide bus. Single game instance, so a module singleton is fine. */
export const bus = new EventBus();
