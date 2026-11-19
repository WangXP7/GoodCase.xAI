// Engraved line glyphs, all drawn in a 24 x 24 box as SVG path data.
// The three signs of the Tria Prima are vector paths on purpose: the Unicode alchemical block is
// missing from most fonts. The same path strings feed both SVG elements and canvas (Path2D).
import { s } from './dom.js';

const f = (n) => String(Math.round(n * 100) / 100);
const pt = (x, y) => `${f(x)} ${f(y)}`;
const circ = (cx, cy, r) => `M${pt(cx - r, cy)}a${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-r * 2)} 0`;
const seg = (x1, y1, x2, y2) => `M${pt(x1, y1)}L${pt(x2, y2)}`;
const poly = (pts, close = true) => 'M' + pts.map((p) => pt(p[0], p[1])).join('L') + (close ? 'Z' : '');
const polar = (cx, cy, deg, r) => [cx + Math.cos((deg * Math.PI) / 180) * r, cy + Math.sin((deg * Math.PI) / 180) * r];
const loz = (cx, cy, r) => poly([[cx, cy - r], [cx + r * 0.72, cy], [cx, cy + r], [cx - r * 0.72, cy]]);
function petal(cx, cy, deg, len, w, r0 = 0) {
  const b = polar(cx, cy, deg, r0),
    t = polar(cx, cy, deg, r0 + len),
    m = polar(cx, cy, deg, r0 + len * 0.45);
  const a = (deg * Math.PI) / 180;
  const nx = -Math.sin(a) * w,
    ny = Math.cos(a) * w;
  return `M${pt(b[0], b[1])}Q${pt(m[0] + nx, m[1] + ny)} ${pt(t[0], t[1])}Q${pt(m[0] - nx, m[1] - ny)} ${pt(b[0], b[1])}Z`;
}
const rays = (cx, cy, degs, r0, r1) => degs.map((d) => seg(...polar(cx, cy, d, r0), ...polar(cx, cy, d, r1))).join('');

// ---------------------------------------------------------------------------------------------
// The three signs. Sulfur: a triangle on a cross. Mercury: horns, circle, cross. Salt: a circle
// cut by a line.
// ---------------------------------------------------------------------------------------------
export const SIGN = {
  sulfur: poly([[12, 3.2], [5.6, 13.2], [18.4, 13.2]]) + seg(12, 13.2, 12, 21.6) + seg(8.4, 17.6, 15.6, 17.6),
  mercury: 'M7.6 3.4A4.4 4.4 0 0 0 16.4 3.4' + circ(12, 11.9, 4.1) + seg(12, 16, 12, 22) + seg(9, 19.2, 15, 19.2),
  salt: circ(12, 12, 7.6) + seg(4.4, 12, 19.6, 12),
};

// ---------------------------------------------------------------------------------------------
// Ingredients: { d: outline, a: the one live detail (drawn in the ingredient's own colour) }
// ---------------------------------------------------------------------------------------------
export const ING = {
  cinderbloom: {
    d: [-90, -142, -38, -194, 14].map((a) => petal(12, 10.6, a, 7.4, 2.0, 1.2)).join('') + 'M12 12.2C11.2 15 12.8 18 12 22' + seg(11.8, 16.6, 9.9, 15.4),
    a: circ(12, 10.6, 1.25),
  },
  saltwort: {
    d: 'M12 22V5.6' + seg(12, 17.2, 7.6, 13.8) + seg(12, 13.6, 16.4, 10.2) + seg(12, 10, 8.6, 7.2),
    a: loz(7.6, 12.6, 1.4) + loz(16.4, 9, 1.4) + loz(8.6, 6, 1.4) + loz(12, 4.2, 1.5),
  },
  weepcap: {
    d: 'M4.8 11.5C5.5 5.5 18.5 5.5 19.2 11.5C17 12.6 7 12.6 4.8 11.5ZM10.6 12.3C10.2 16 10.8 19 10 21.5M13.4 12.3C13.8 16 13.6 19 14.2 21.5',
    a: 'M18.3 13.6C19.6 15.4 19.8 16.4 19.3 17.2A1.25 1.25 0 0 1 17.3 17.2C16.8 16.4 17 15.4 18.3 13.6Z',
  },
  mirrorlily: {
    d: 'M4 18.6a8 2.5 0 1 0 16 0a8 2.5 0 1 0 -16 0M7.2 8.5C7.6 14.5 16.4 14.5 16.8 8.5M7.2 8.5C8.8 9.8 10.2 9.8 12 6.6C13.8 9.8 15.2 9.8 16.8 8.5' + seg(12, 13.1, 12, 16.2),
    a: circ(12, 10.7, 1.45),
  },
  corpselight: {
    d: 'M4.5 20.5H19.5' + [[8, 7], [12, 11], [16, 5.4]].map(([x, hh]) => `M${f(x - 1.15)} 20.5V${f(20.5 - hh + 1.15)}a1.15 1.15 0 0 1 2.3 0V20.5`).join(''),
    a: circ(12, 6.3, 0.75) + circ(6.2, 10.4, 0.6) + circ(17.8, 12, 0.6),
  },
  stormthistle: {
    d: 'M12 22V13.2' + seg(12, 18.2, 8.6, 16.2) + seg(12, 16.6, 15.4, 14.6) + 'M9 10.7a3 2.6 0 1 0 6 0a3 2.6 0 1 0 -6 0' + rays(12, 9.2, [-90, -66, -114, -42, -138, -20, -160], 2.4, 6.6),
    a: seg(17.6, 3.2, 16.4, 5.4) + seg(16.4, 5.4, 18.2, 5.6) + seg(18.2, 5.6, 17, 7.8),
  },
  halite: {
    d: poly([[12, 4], [18.9, 8], [18.9, 16], [12, 20], [5.1, 16], [5.1, 8]]) + seg(12, 12, 18.9, 8) + seg(12, 12, 5.1, 8) + seg(12, 12, 12, 20),
    a: '',
  },
  quicksilver: {
    d: circ(11, 13, 6.2) + 'M7.4 10.6A4.6 4.6 0 0 1 10.4 8.2',
    a: circ(18.7, 18.5, 1.6) + circ(19.2, 7.6, 1.0),
  },
  brimstone: {
    d: 'M10.2 20.5L10.8 6.6L12.6 3.5L14.2 7L14 20.5M10.3 20.5H6.4L5.6 12.6L7.6 9.4L10.5 13M14 20.5H18L18.6 14.4L16.6 11.4L14.1 14.2' + seg(4.4, 20.5, 19.6, 20.5),
    a: '',
  },
};

// ---------------------------------------------------------------------------------------------
// Potions: one phial outline, one sign inside.
// ---------------------------------------------------------------------------------------------
export const BOTTLE = 'M9.6 2.6h4.8M10.2 2.6v4.3C6.9 8.3 5 11.2 5 14.6a7 7 0 0 0 14 0c0-3.4-1.9-6.3-5.2-7.7V2.6';
export const POTION = {
  ember: 'M12 18.4c-2.2 0-3.4-1.5-3.4-3.3 0-1.4.9-2.4 1.6-3.2.2 1 .7 1.5 1.3 1.6-.2-1.6.5-2.9 1.6-3.7.1 1.6 2.3 2.9 2.3 5.3 0 1.8-1.2 3.3-3.4 3.3z',
  verdance: 'M12 18.6V13.4M12 15.6c-2.6.2-3.6-1.3-3.6-3 2.3-.2 3.6 1 3.6 3zM12 14c0-1.9 1.2-3.2 3.6-3.1 0 1.9-1.2 3.2-3.6 3.1z',
  rime: rays(12, 14.8, [90, 30, 150, 270, 210, 330], 0, 3.7) + rays(12, 14.8, [60, 0, 120, 180, 240, 300], 1.9, 2.7),
  levity: 'M8.8 15.4l3.2-3 3.2 3M8.8 18.4l3.2-3 3.2 3',
  fulminate: 'M13.2 10.6l-3.4 4.6h2.6l-1.4 3.8 3.8-5h-2.6z',
  saltspire: 'M10.4 18.6l.7-6.6.9-1.6.9 1.6.7 6.6zM9 18.6h6',
  vitae: 'M12 10.8c1.9 2.3 2.9 3.8 2.9 5.2a2.9 2.9 0 0 1-5.8 0c0-1.4 1-2.9 2.9-5.2z',
  empty: '',
};

export const STONE = {
  d: poly([[12, 3], [19, 8], [19, 16], [12, 21], [5, 16], [5, 8]]) + poly([[12, 7.4], [15.4, 9.8], [15.4, 14.2], [12, 16.6], [8.6, 14.2], [8.6, 9.8]]) + seg(12, 3, 12, 7.4) + seg(19, 8, 15.4, 9.8) + seg(19, 16, 15.4, 14.2) + seg(12, 21, 12, 16.6) + seg(5, 16, 8.6, 14.2) + seg(5, 8, 8.6, 9.8),
};

// Marks for the map and the compass, and a few interface signs.
export const MARK = {
  lantern: 'M8.5 21.5h7M9.8 21.5V10.2M14.2 21.5V10.2M8.6 10.2h6.8L12 4.6z',
  flame: circ(12, 7.9, 0.95),
  home: 'M7 21.5V11.5Q12 2.5 17 11.5V21.5M10.4 21.5v-5.2q1.6-2.4 3.2 0v5.2',
  quest: loz(12, 12, 7),
  arrow: 'M12 3.5L17 20L12 16.6L7 20Z',
  triangle: poly([[12, 3.4], [21.4, 19.7], [2.6, 19.7]]),
};

// ---------------------------------------------------------------------------------------------
// SVG builders
// ---------------------------------------------------------------------------------------------
/** A bare line glyph: currentColor strokes, hairline weight. */
export function glyph(d, cls = '') {
  return s('svg', { class: 'tp-glyph ' + cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d, class: 'tp-glyph-line' }));
}

export function signGlyph(id, cls = '') {
  return glyph(SIGN[id] || '', 'tp-sign ' + cls);
}

/**
 * The engraved stand-in used wherever the game has no rendered thumbnail yet.
 * kind: 'ingredient' | 'potion' | 'prime' | 'stone'. `color` tints the one live detail.
 */
export function fallbackIcon(kind, id, color) {
  const svg = s('svg', { class: 'tp-glyph tp-glyph-icon' + (kind === 'stone' ? ' tp-glyph-stone' : ''), viewBox: '1 1 22 22', 'aria-hidden': 'true' });
  const style = color ? { color } : null;
  if (kind === 'ingredient' && ING[id]) {
    svg.append(s('path', { d: ING[id].d, class: 'tp-glyph-line' }));
    if (ING[id].a) svg.append(s('path', { d: ING[id].a, class: 'tp-glyph-live', style }));
  } else if (kind === 'potion') {
    svg.append(s('path', { d: BOTTLE, class: 'tp-glyph-line' }));
    if (POTION[id]) svg.append(s('path', { d: POTION[id], class: 'tp-glyph-live', style }));
  } else if (kind === 'prime' && SIGN[id]) {
    svg.append(s('path', { d: circ(12, 12, 10.6), class: 'tp-glyph-faint' }));
    svg.append(s('path', { d: SIGN[id], class: 'tp-glyph-line', transform: 'translate(3.6 3.6) scale(0.7)' }));
  } else if (kind === 'stone') {
    svg.append(s('path', { d: STONE.d, class: 'tp-glyph-live', style: { color: color || '#c4121f' } }));
  } else {
    svg.append(s('path', { d: MARK.quest, class: 'tp-glyph-faint' }));
  }
  return svg;
}
