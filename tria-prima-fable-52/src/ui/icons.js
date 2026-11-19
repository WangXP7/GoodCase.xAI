// Item pictures. The game renders 3D thumbnails (game.icons.get), but they may arrive late or not
// at all, so every icon starts as an engraved glyph and is swapped for the render once it exists.
import { h } from './dom.js';
import { fallbackIcon } from './glyphs.js';

export function createIcons(game) {
  const waiting = new Set();
  let clock = 0;

  function colorOf(kind, id) {
    const d = game.data;
    if (kind === 'ingredient') return d.INGREDIENTS[id] && d.INGREDIENTS[id].color;
    if (kind === 'potion') return d.POTIONS[id] && d.POTIONS[id].color;
    if (kind === 'prime') return d.PRIME_ITEMS[id] && d.PRIME_ITEMS[id].color;
    return null;
  }

  function source(kind, id) {
    try {
      const c = game.icons && typeof game.icons.get === 'function' ? game.icons.get(kind, id) : null;
      return c && c.width > 0 ? c : null;
    } catch (e) {
      return null;
    }
  }

  function fill(rec) {
    const src = source(rec.kind, rec.id);
    if (src) {
      const c = document.createElement('canvas');
      c.width = c.height = rec.px;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, rec.px, rec.px);
      rec.el.replaceChildren(c);
      rec.el.classList.add('is-render');
      return true;
    }
    if (!rec.el.firstChild) rec.el.append(fallbackIcon(rec.kind, rec.id, colorOf(rec.kind, rec.id)));
    return false;
  }

  /** An icon element. `px` is the backing size of the copy (128 for slots, 256 for a detail view). */
  function make(kind, id, cls = '', px = 128) {
    const el = h('span', { class: 'tp-icon ' + cls });
    const rec = { el, kind, id, px, miss: 0 };
    if (!fill(rec)) waiting.add(rec);
    return el;
  }

  /** Call once per frame: retries the missing renders about once a second. */
  function update(dt) {
    if (!waiting.size) return;
    clock += dt;
    if (clock < 1) return;
    clock = 0;
    for (const rec of waiting) {
      if (!rec.el.isConnected && ++rec.miss > 3) {
        waiting.delete(rec);
        continue;
      }
      if (fill(rec)) waiting.delete(rec);
    }
  }

  return { make, update };
}
