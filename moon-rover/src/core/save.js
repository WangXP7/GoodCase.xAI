const KEY = 'regolith.anaxagoras.v1';

export const Save = {
  read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch { return null; }
  },
  write(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch { return false; }
  },
  clear() { try { localStorage.removeItem(KEY); } catch { /* private mode */ } },
  settings() {
    try { return JSON.parse(localStorage.getItem(KEY + '.set') || 'null') || {}; }
    catch { return {}; }
  },
  saveSettings(s) {
    try { localStorage.setItem(KEY + '.set', JSON.stringify(s)); } catch { /* ignore */ }
  }
};
