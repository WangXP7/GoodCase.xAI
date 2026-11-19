// localStorage can throw inside sandboxed artifact frames; never let it propagate.
export const store = {
  get(key, fallback = null) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch { return fallback; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, String(value)); return true; } catch { return false; }
  },
};
