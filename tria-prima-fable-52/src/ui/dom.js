// Tiny DOM helpers for the UI. No framework: elements are built once and then patched through
// the cached setters below, so a frame in which nothing changed writes nothing to the DOM.
const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs, svg) {
  if (!attrs) return;
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') {
      if (svg) el.setAttribute('class', v);
      else el.className = v;
    } else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v; // trusted, static markup only (glyphs)
    else if (k === 'style' && typeof v === 'object') {
      for (const p in v) el.style.setProperty(p, v[p]);
    } else if (k === 'on') {
      for (const ev in v) el.addEventListener(ev, v[ev]);
    } else if (k === 'data') {
      for (const d in v) el.dataset[d] = v[d];
    } else el.setAttribute(k, v === true ? '' : v);
  }
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

/** h('div', { class: 'x', text: 'hi', on: { click } }, child, child) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  apply(el, attrs, false);
  append(el, kids);
  return el;
}

/** The same for SVG elements. */
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs, true);
  append(el, kids);
  return el;
}

// Cached setters ------------------------------------------------------------------------------
export function setText(el, v) {
  v = v == null ? '' : String(v);
  if (el.__t !== v) {
    el.__t = v;
    el.textContent = v;
  }
}
export function setClass(el, cls, on) {
  on = !!on;
  const k = '__c_' + cls;
  if (el[k] !== on) {
    el[k] = on;
    el.classList.toggle(cls, on);
  }
}
export function setAttr(el, name, v) {
  v = String(v);
  const k = '__a_' + name;
  if (el[k] !== v) {
    el[k] = v;
    el.setAttribute(name, v);
  }
}
export function setStyle(el, prop, v) {
  const k = '__s_' + prop;
  if (el[k] !== v) {
    el[k] = v;
    el.style.setProperty(prop, v);
  }
}
export function setShown(el, on) {
  on = !!on;
  if (el.__h !== on) {
    el.__h = on;
    el.hidden = !on;
  }
}

/**
 * game.actions, looked up at the moment of each call: the game may build or replace that object
 * after the UI exists. An action the game does not have is reported once and then does nothing,
 * so a half-wired game shows its gaps in the console instead of breaking a screen.
 */
export function actionsOf(game) {
  const told = {};
  return new Proxy(
    {},
    {
      get(_, name) {
        return (...args) => {
          const a = game.actions;
          const fn = a && a[name];
          if (typeof fn === 'function') return fn.apply(a, args);
          if (!told[name]) {
            told[name] = true;
            console.warn(`[ui] game.actions.${String(name)} is not a function`);
          }
          return undefined;
        };
      },
    }
  );
}

// Small maths -----------------------------------------------------------------------------------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** '#rrggbb' -> 'rgba(r,g,b,a)' */
export function rgba(hex, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** Mix two '#rrggbb' colours -> '#rrggbb'. */
export function mixHex(a, b, t) {
  const x = parseInt(a.slice(1), 16),
    y = parseInt(b.slice(1), 16);
  const c = (sh) => Math.round(lerp((x >> sh) & 255, (y >> sh) & 255, t));
  return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Spell small counts the way the Magistra would. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const numberWord = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
