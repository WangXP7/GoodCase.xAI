// Tiny synchronous event bus. See docs/ARCHITECTURE.md (Events) for names + payloads.
export function createBus() {
  const map = new Map();
  const api = {
    on(name, fn) {
      let set = map.get(name);
      if (!set) map.set(name, (set = new Set()));
      set.add(fn);
      return () => api.off(name, fn);
    },
    once(name, fn) {
      const off = api.on(name, (p) => { off(); fn(p); });
      return off;
    },
    off(name, fn) {
      const set = map.get(name);
      if (set) set.delete(fn);
    },
    emit(name, payload) {
      const set = map.get(name);
      if (!set || set.size === 0) return;
      for (const fn of [...set]) {
        try { fn(payload); } catch (err) { console.error('[bus] handler threw for event', name, err); }
      }
    },
    clear() { map.clear(); },
  };
  return api;
}

/** The single app-wide bus. Import this everywhere: import { bus } from '../core/events.js'. */
export const bus = createBus();
