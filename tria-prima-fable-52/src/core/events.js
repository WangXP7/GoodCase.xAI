// Minimal synchronous event bus. One shared instance (`bus`) connects game, UI and audio.
export class Emitter {
  constructor() {
    this._m = new Map();
  }
  on(name, fn) {
    let l = this._m.get(name);
    if (!l) this._m.set(name, (l = []));
    l.push(fn);
    return () => this.off(name, fn);
  }
  once(name, fn) {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }
  off(name, fn) {
    const l = this._m.get(name);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  emit(name, payload) {
    const l = this._m.get(name);
    if (!l || l.length === 0) return;
    for (const fn of l.slice()) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[bus] handler for "${name}" failed`, e);
      }
    }
  }
}

export const bus = new Emitter();
