// Bridge decks at street level (a road crossing a railway cutting or a river). Under them the terrain
// dips, but everything on the bridge must stay at deck level.
//
// A deck is { pts: [x, y, z, ...], half }: the bridge centreline at deck level, bank to bank, and the half
// width of the corridor in which everything is held at that level. A wide bridge (a plaza over the tracks)
// is covered by the corridors of the several ways that cross it. The compiler also marks the road polygons
// on a bridge (area.code = DECK_FLAG | index) to find the open edges that need a parapet.
import { sampleGrid } from './terrain.js';

export const DECK_FLAG = 0x8000;
export const deckOf = (code) => (code & DECK_FLAG ? code & 0x7fff : -1);

// Nearest point of the deck centreline to (x, z): { dist, y, inside }. `inside` is false beyond either
// bank, where the ground takes over again.
export function projectOnDeck(deck, x, z) {
  const p = deck.pts, last = p.length / 3 - 1;
  let best = { dist: Infinity, y: 0, inside: false };
  for (let i = 1; i <= last; i++) {
    const ax = p[i * 3 - 3], ay = p[i * 3 - 2], az = p[i * 3 - 1], dx = p[i * 3] - ax, dz = p[i * 3 + 2] - az;
    const raw = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), t = Math.max(0, Math.min(1, raw));
    const dist = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (dist < best.dist) best = { dist, y: ay + (p[i * 3 + 1] - ay) * t, inside: !(i === 1 && raw <= 0) && !(i === last && raw >= 1) };
  }
  return best;
}

// Returns surface(x, z): the height to stand on — the level of the highest deck whose corridor contains
// the point, blended back to the terrain over FADE metres beside the corridor; the terrain elsewhere.
// What is overhead at (x, z), for things that pass underneath (railway tracks): the terrain itself, or a
// bridge deck. Unlike the surface, a deck counts only over its real width — its corridor is CORRIDOR_MARGIN
// wider than the bridge so that sidewalks and plazas are held level, and must not roof the open track beside it.
export const CORRIDOR_MARGIN = 16;
export function makeCover(grid, decks) {
  return (x, z) => {
    let y = sampleGrid(grid, x, z);
    for (const d of decks) {
      const p = projectOnDeck(d, x, z);
      if (p.inside && p.dist <= d.half - CORRIDOR_MARGIN + 3.5) y = Math.max(y, p.y);
    }
    return y;
  };
}

const FADE = 8; // metres over which a deck's level blends back into the terrain beside its corridor

export function makeSurface(grid, decks) {
  // bounding boxes, to skip decks that are nowhere near
  const boxes = decks.map((d) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < d.pts.length; i += 3) { x0 = Math.min(x0, d.pts[i]); x1 = Math.max(x1, d.pts[i]); z0 = Math.min(z0, d.pts[i + 2]); z1 = Math.max(z1, d.pts[i + 2]); }
    const m = d.half + FADE;
    return [x0 - m, x1 + m, z0 - m, z1 + m];
  });
  return (x, z, deck = -1) => {
    const terrain = sampleGrid(grid, x, z);
    if (deck < -1) return terrain;
    let y = terrain;
    for (let i = 0; i < decks.length; i++) {
      const b = boxes[i];
      if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
      const p = projectOnDeck(decks[i], x, z);
      if (!p.inside || p.y <= terrain) continue;
      const w = Math.max(0, Math.min(1, 1 - (p.dist - decks[i].half) / FADE));
      y = Math.max(y, terrain + (p.y - terrain) * w);
    }
    return y;
  };
}
