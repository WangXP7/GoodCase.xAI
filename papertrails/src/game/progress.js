// Save game: one store per world seed in localStorage.
//
// Events on the app bus (src/core/events.js), emitted only when something NEW happens:
//   'game:explore'  { cx, cz, biome, count }                  first visit of a cell
//   'game:collect'  { kind, key, x, z, count }                a scrap was picked up
//   'game:lantern'  { key, x, z, count }                      a lamp was lit
//   'game:reset'    {}
import { bus } from '../core/events.js';

const blank = () => ({ cells: {}, scraps: {}, scrapCounts: {}, lanterns: {} });

export function createProgress({ seed = 0, persist = true } = {}) {
  const KEY = 'popup-atlas:v1:' + seed;
  let data = blank();
  if (persist) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const old = JSON.parse(raw);
        // only the known sections are taken over: saves written before the landmark stamps were removed still
        // hold `landmarks`, which is dropped here (and leaves the file with the next write)
        if (old && typeof old === 'object') for (const k in data) if (old[k] && typeof old[k] === 'object') data[k] = old[k];
      }
      localStorage.removeItem(KEY + ':stamps'); // side key of the removed stamp feature
    } catch { /* corrupt or blocked storage: start fresh */ }
  }
  let dirty = false;
  let timer = 0;
  function save() {
    timer = 0;
    if (!persist || !dirty) return;
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota / private mode */ }
  }
  function touch() { dirty = true; if (persist && !timer) timer = setTimeout(save, 1500); }
  if (persist && typeof window !== 'undefined') {
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  }
  const ck = (cx, cz) => cx + ',' + cz;

  const api = {
    persist,
    /** Mark a cell as walked. @returns true if new */
    explore(cx, cz, biome) {
      const k = ck(cx, cz);
      if (data.cells[k]) return false;
      data.cells[k] = biome || 1;
      touch();
      bus.emit('game:explore', { cx, cz, biome, count: Object.keys(data.cells).length });
      return true;
    },
    explored(cx, cz) { return !!data.cells[ck(cx, cz)]; },
    /** Biome id stored for an explored cell, or null. */
    cellBiome(cx, cz) { const v = data.cells[ck(cx, cz)]; return typeof v === 'string' ? v : null; },
    /** Iterate explored cells: fn(cx, cz, biome). */
    eachCell(fn) { for (const k in data.cells) { const i = k.indexOf(','); fn(+k.slice(0, i), +k.slice(i + 1), data.cells[k]); } },
    cellCount() { return Object.keys(data.cells).length; },

    /** Pick up a scrap. key = unique per placed scrap (e.g. "cx,cz,i"). @returns true if new */
    collect(key, kind, x, z) {
      if (data.scraps[key]) return false;
      data.scraps[key] = kind;
      data.scrapCounts[kind] = (data.scrapCounts[kind] || 0) + 1;
      touch();
      bus.emit('game:collect', { kind, key, x, z, count: data.scrapCounts[kind] });
      return true;
    },
    collected(key) { return !!data.scraps[key]; },
    scrapCount(kind) { return kind ? data.scrapCounts[kind] || 0 : Object.keys(data.scraps).length; },

    /** Light a lamp for good. key = unique per lamp (e.g. "cx,cz" or "cx,cz,node"). @returns true if new */
    light(key, x, z) {
      if (data.lanterns[key]) return false;
      data.lanterns[key] = 1;
      touch();
      bus.emit('game:lantern', { key, x, z, count: Object.keys(data.lanterns).length });
      return true;
    },
    lit(key) { return !!data.lanterns[key]; },
    lanternCount() { return Object.keys(data.lanterns).length; },

    /** Plain summary for the atlas page / debugging. */
    summary() {
      return { cells: api.cellCount(), scraps: { ...data.scrapCounts }, lanterns: api.lanternCount() };
    },
    save,
    reset() {
      data = blank();
      dirty = true; save();
      bus.emit('game:reset', {});
    },
  };
  return api;
}
