// The GRAVEYARD SHIFT wordmark: one component for the title screen (and, as the same plain markup, the loading
// screen).
//   createWordmark({ tag = 'h1' }) -> element   size it with the CSS variable --wm-size on it or an ancestor
//   WORDMARK_HTML                                 the same markup as a string, for a page that has no script yet
//   loadFonts()                                   asks Google Fonts for the UI's faces once per page
// "GRAVEYARD" is a heavy slab in signage cream, then the Nightjar canopy band with the bird, then "Shift" as a
// red neon-tube script that flickers now and then. wordmark.css holds the look and its --wm-* variables.
import './wordmark.css';

// Display and label faces for the UI, plus the two faces only the wordmark uses.
export const FONT_URL = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Overpass:wght@400;500;600;700&family=Alfa+Slab+One&family=Yellowtail&display=swap';
const FONT_LINK_ID = 'gs-fonts';

// The only network request the UI makes. Skipped offline; if it is blocked or fails, the fallback stacks stay.
export function loadFonts(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !doc.head || doc.getElementById(FONT_LINK_ID)) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const link = doc.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = FONT_URL;
  doc.head.appendChild(link);
}

// the Nightjar: a small bird in a glide, wings swept back
export const BIRD_PATH = 'M1 9c7-4 14-3 20 3 3-6 10-10 22-9-8 3-13 7-16 13l-4 5-3-5C16 11 9 9 1 9z';
const BIRD_SVG = `<svg class="gs-wm-bird" viewBox="0 0 44 22" aria-hidden="true"><path d="${BIRD_PATH}"/></svg>`;
const INNER = `<span class="gs-wm-a" aria-hidden="true">Graveyard</span><span class="gs-wm-band" aria-hidden="true">${BIRD_SVG}</span><span class="gs-wm-b" aria-hidden="true">Shift</span>`;
export const WORDMARK_HTML = `<h1 class="gs-wm" aria-label="Graveyard Shift">${INNER}</h1>`;

export function createWordmark({ tag = 'h1', doc = document } = {}) {
  const el = doc.createElement(tag);
  el.className = 'gs-wm';
  el.setAttribute('aria-label', 'Graveyard Shift');
  el.innerHTML = INNER; // a constant string, no user text
  return el;
}
