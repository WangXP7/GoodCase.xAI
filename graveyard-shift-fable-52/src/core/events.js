// Minimal pub/sub. A throwing handler never stops later handlers.
export function createEvents(onError = (e, name) => console.error(`[events] ${name} handler threw`, e)) {
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(fn);
      return () => this.off(name, fn);
    },
    off(name, fn) {
      const l = map.get(name);
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    emit(name, payload) {
      const l = map.get(name);
      if (!l) return;
      for (const fn of l.slice()) {
        try { fn(payload); } catch (e) { onError(e, name); }
      }
    },
  };
}
