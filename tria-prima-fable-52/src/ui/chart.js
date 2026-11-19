// The chart of the Tria Prima: an engraved triangle on which every mixture is a point.
// One canvas, two layers: a cached engraving (frame, signs, the regions the player has inked)
// and a live layer (ingredient marks, the mixture, its trail, where the next ingredient would
// pull it, the binding ring). All the maths comes from game.data.
import { h, rgba, mixHex, clamp } from './dom.js';
import { SIGN } from './glyphs.js';

const BONE = '#ddd5c4';
const EMBER = '#e2702c';
const EMBER_HOT = '#ffb373';
const INK = '#050507';
const SQ3_2 = 0.8660254037844386;
const TAU = Math.PI * 2;
const bone = (a) => rgba(BONE, a);

export function createChart(game, opts = {}) {
  const book = !!opts.book;
  const D = game.data;
  const el = h('div', { class: 'tp-chart' + (book ? ' tp-chart-book' : '') });
  const canvas = h('canvas', { class: 'tp-chart-canvas' });
  el.append(canvas);
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  const bctx = base.getContext('2d');
  const signs = {};
  for (const k in SIGN) signs[k] = new Path2D(SIGN[k]);

  let W = 0,
    H = 0,
    dpr = 1,
    g = null,
    fontTick = 0,
    sizeDirty = true,
    fam = null;
  let hover = null,
    focusPotion = null,
    focusIng = null;
  let shown = null; // eased mixture position
  let time = 0,
    addPulse = 0;
  // what the cached engraving, and the book's still picture, were last drawn from
  const drawn = { stale: true, w: 0, h: 0, tick: -1, opus: false, inked: -1, known: -1, potion: null, ing: null };

  if (typeof ResizeObserver === 'function') new ResizeObserver(() => (sizeDirty = true)).observe(el);
  else setInterval(() => (sizeDirty = true), 500);
  if (document.fonts && document.fonts.ready) {
    const bump = () => {
      fontTick++;
      fam = null;
    };
    document.fonts.ready.then(bump);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', bump);
  }

  // ---- set-up ---------------------------------------------------------------------------------
  function families() {
    if (fam) return fam;
    const cs = getComputedStyle(el);
    fam = {
      disp: cs.getPropertyValue('--tp-display').trim() || "'Cormorant Garamond', Georgia, serif",
      sans: cs.getPropertyValue('--tp-sans').trim() || 'system-ui, sans-serif',
    };
    return fam;
  }

  function resize() {
    sizeDirty = false;
    const w = el.clientWidth,
      hh = el.clientHeight;
    const d = Math.min(2, window.devicePixelRatio || 1);
    const nw = Math.round(w * d),
      nh = Math.round(hh * d);
    if (nw === W && nh === H && d === dpr) return;
    W = nw;
    H = nh;
    dpr = d;
    canvas.width = base.width = Math.max(1, W);
    canvas.height = base.height = Math.max(1, H);
    drawn.stale = true;
    if (W < 8 || H < 8) {
      g = null;
      return;
    }
    const padT = book ? 0.205 : 0.17,
      padB = 0.125,
      padS = 0.075;
    const L = Math.min(W / (1 + padS * 2), H / (SQ3_2 + padT + padB));
    const x0 = (W - L) / 2;
    const top = (H - L * (SQ3_2 + padT + padB)) / 2 + L * padT;
    const yBase = top + L * SQ3_2;
    const P = (b) => {
      const p = D.baryTo2D(b);
      return [x0 + p[0] * L, yBase - p[1] * L];
    };
    g = { L, u: L / 100, x0, yBase, P, S: P([1, 0, 0]), M: P([0, 1, 0]), K: P([0, 0, 1]), C: P([1 / 3, 1 / 3, 1 / 3]) };
  }

  const fontPx = (units, min = 10, max = 19) => clamp(units * g.u, min * dpr, max * dpr);
  function spacing(c, px) {
    if ('letterSpacing' in c) c.letterSpacing = px.toFixed(2) + 'px';
    return 'letterSpacing' in c ? px : 0;
  }
  function text(c, str, x, y, align = 'center', sp = 0, halo = false) {
    c.textAlign = align;
    c.textBaseline = 'middle';
    // canvas letter-spacing trails the last glyph: nudge so the ink is what gets aligned
    const tx = align === 'center' ? x + sp / 2 : align === 'right' ? x + sp : x;
    if (halo) {
      // lettering that crosses construction lines sits on a little cleared ground
      c.lineWidth = 4 * dpr;
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(8,8,10,0.9)';
      c.strokeText(str, tx, y);
    }
    c.fillText(str, tx, y);
  }

  function tri(c, grow = 0) {
    const { S, M, K, C, L } = g;
    const k = 1 + grow / (0.288675 * L);
    const q = (p) => [C[0] + (p[0] - C[0]) * k, C[1] + (p[1] - C[1]) * k];
    const a = q(S),
      b = q(K),
      d = q(M);
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.lineTo(d[0], d[1]);
    c.closePath();
  }
  function seg(c, a, b) {
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.stroke();
  }
  function lozenge(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y - r);
    c.lineTo(x + r * 0.74, y);
    c.lineTo(x, y + r);
    c.lineTo(x - r * 0.74, y);
    c.closePath();
  }
  function sign(c, id, cx, cy, size, style, lw = 1.15) {
    const k = size / 24;
    c.save();
    c.translate(cx - size / 2, cy - size / 2);
    c.scale(k, k);
    c.lineWidth = (lw * dpr) / k;
    c.strokeStyle = style;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.stroke(signs[id]);
    c.restore();
  }

  const inked = (id) => !!(game.state.known.charted[id] || game.state.known.potions[id]);

  // ---- regions --------------------------------------------------------------------------------
  /** level 0: an unwritten region (faint, nameless); 1: inked; 2: lit (the mixture is inside). */
  function region(c, id, level) {
    const p = D.POTIONS[id];
    if (!p) return;
    const [x, y] = g.P(p.center);
    const r = p.radius * g.L;
    c.save();
    tri(c);
    c.clip();
    if (level > 0) {
      c.fillStyle = rgba(p.color, level === 2 ? 0.15 : 0.07);
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
    c.lineWidth = (level === 2 ? 1.5 : 1) * dpr;
    c.strokeStyle = level === 0 ? bone(0.3) : rgba(mixHex(p.color, BONE, 0.25), level === 2 ? 0.95 : 0.58);
    c.setLineDash(level === 0 ? [2 * dpr, 4 * dpr] : []);
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.stroke();
    if (level > 0) {
      // the two inner rings are the thresholds of purity: two marks, three marks
      c.setLineDash([1 * dpr, 3.5 * dpr]);
      c.lineWidth = 1 * dpr;
      c.strokeStyle = rgba(mixHex(p.color, BONE, 0.4), level === 2 ? 0.55 : 0.26);
      for (const k of [0.7, 0.38]) {
        c.beginPath();
        c.arc(x, y, r * k, 0, TAU);
        c.stroke();
      }
    }
    c.restore();
  }

  function regionLabel(c, id, lit) {
    const p = D.POTIONS[id];
    if (!p) return;
    const b = p.center;
    const [x, y] = g.P(b);
    const { u, L, C } = g;
    const zeros = (b[0] < 1e-6 ? 1 : 0) + (b[1] < 1e-6 ? 1 : 0) + (b[2] < 1e-6 ? 1 : 0);
    const size = fontPx(3.3, 10, 17);
    c.font = `500 ${size}px ${families().disp}`;
    const sp = spacing(c, size * 0.16);
    c.fillStyle = rgba(mixHex(p.color, BONE, lit ? 0.5 : 0.62), lit ? 1 : 0.8);
    const name = p.name.toUpperCase();
    // Every name stands outside its own ring, so the ground inside stays clear for the mixture.
    if (zeros === 2) {
      // a corner region: beyond its arc, on the line from the corner to the centre. Under the
      // Sulfur corner the name hangs just below the arc; in the two lower corners a level line of
      // letters would cut the arc there, so it stands off in the open ground between the rings.
      const dx = C[0] - x,
        dy = C[1] - y,
        dl = Math.hypot(dx, dy) || 1;
      const k = b[0] > 0.5 ? p.radius * L + Math.max(size * 1.15, 4.6 * u) : (p.radius + 0.112) * L;
      text(c, name, x + (dx / dl) * k, y + (dy / dl) * k, 'center', sp, true);
    } else if (zeros === 1) {
      // an edge region: just outside the edge it sits on
      if (b[0] < 1e-6) text(c, name, x, y + u * 5.4, 'center', sp);
      else if (b[1] < 1e-6) text(c, name, x + u * 3.6, y, 'left', sp);
      else text(c, name, x - u * 3.6, y, 'right', sp);
    } else {
      // an inner region: above its ring, one word to a line so it stays clear of its neighbours
      const words = name.split(' ');
      const lh = size * 1.12;
      const y1 = y - p.radius * L - Math.max(size * 0.95, 3.2 * u);
      words.forEach((w, i) => text(c, w, x, y1 - (words.length - 1 - i) * lh, 'center', sp, true));
    }
    spacing(c, 0);
  }

  // ---- the engraving (cached) -----------------------------------------------------------------
  function drawBase(opus) {
    const c = bctx;
    c.clearRect(0, 0, W, H);
    const { S, M, K, C, u, L } = g;
    c.lineCap = 'butt';
    c.setLineDash([]);

    // the field
    tri(c);
    c.fillStyle = bone(0.03);
    c.fill();

    // medians, as a draughtsman's construction lines
    c.strokeStyle = bone(opus ? 0.16 : 0.1);
    c.lineWidth = 1 * dpr;
    c.setLineDash([1.5 * dpr, 4 * dpr]);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    seg(c, S, mid(M, K));
    seg(c, M, mid(S, K));
    seg(c, K, mid(S, M));
    c.setLineDash([]);

    if (!opus) {
      for (const id of D.POTION_ORDER) if (inked(id)) region(c, id, 1);
    }

    // frame: one firm line, one hairline outside it
    tri(c);
    c.strokeStyle = bone(0.7);
    c.lineWidth = 1.25 * dpr;
    c.lineJoin = 'miter';
    c.stroke();
    tri(c, 1.5 * u);
    c.strokeStyle = bone(0.2);
    c.lineWidth = 1 * dpr;
    c.stroke();

    // graduations along each edge, tenths, longer at the half
    c.strokeStyle = bone(0.42);
    c.lineWidth = 1 * dpr;
    for (const [a, b] of [
      [S, K],
      [K, M],
      [M, S],
    ]) {
      const ex = b[0] - a[0],
        ey = b[1] - a[1];
      const m = mid(a, b);
      let nx = C[0] - m[0],
        ny = C[1] - m[1];
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      for (let i = 1; i < 10; i++) {
        const px = a[0] + (ex * i) / 10,
          py = a[1] + (ey * i) / 10;
        const len = (i === 5 ? 2.3 : 1.1) * u;
        seg(c, [px, py], [px + nx * len, py + ny * len]);
      }
    }
    // the centre, where all three are equal
    c.strokeStyle = bone(0.4);
    lozenge(c, C[0], C[1], 0.9 * u);
    c.stroke();

    // the three signs
    const sz = 7.6 * u;
    const name = fontPx(3.0, 9.5, 16);
    const F = families();
    const P3 = D.PRIMES;
    const lettering = (id, x, y, align) => {
      c.font = `500 ${name}px ${F.sans}`;
      const sp = spacing(c, name * 0.2);
      c.fillStyle = bone(0.78);
      text(c, P3[id].name.toUpperCase(), x, y, align, sp);
      spacing(c, 0);
    };
    const epithet = (id, x, y, align) => {
      if (!book) return;
      const e = fontPx(3.1, 10, 17);
      c.font = `italic 400 ${e}px ${F.disp}`;
      c.fillStyle = bone(0.46);
      text(c, P3[id].epithet, x, y, align);
    };
    sign(c, 'sulfur', S[0], S[1] - 7.0 * u, sz, bone(0.9));
    lettering('sulfur', S[0], S[1] - 13.4 * u, 'center');
    epithet('sulfur', S[0], S[1] - 17.2 * u, 'center');
    sign(c, 'mercury', M[0] + 2.4 * u, M[1] + 7.4 * u, sz, bone(0.9));
    lettering('mercury', M[0] + 8.0 * u, M[1] + 6.0 * u + (book ? 0 : 1.4 * u), 'left');
    epithet('mercury', M[0] + 8.0 * u, M[1] + 9.8 * u, 'left');
    sign(c, 'salt', K[0] - 2.4 * u, K[1] + 7.4 * u, sz, bone(0.9));
    lettering('salt', K[0] - 8.0 * u, K[1] + 6.0 * u + (book ? 0 : 1.4 * u), 'right');
    epithet('salt', K[0] - 8.0 * u, K[1] + 9.8 * u, 'right');

    if (!opus) {
      for (const id of D.POTION_ORDER) if (inked(id)) regionLabel(c, id, false);
    }
  }

  /** Redraws the engraving when what it shows has changed. Returns true when it did. */
  function ensureBase(opus) {
    let mask = 0;
    for (let i = 0; i < D.POTION_ORDER.length; i++) if (inked(D.POTION_ORDER[i])) mask |= 1 << i;
    if (!drawn.stale && drawn.w === W && drawn.h === H && drawn.tick === fontTick && drawn.opus === opus && drawn.inked === mask) return false;
    drawn.stale = false;
    drawn.w = W;
    drawn.h = H;
    drawn.tick = fontTick;
    drawn.opus = opus;
    drawn.inked = mask;
    families();
    drawBase(opus);
    return true;
  }

  // ---- ingredient marks -----------------------------------------------------------------------
  function ingMark(c, id, strong, dim) {
    const ing = D.INGREDIENTS[id];
    if (!ing) return;
    const [x, y] = g.P(ing.bary);
    const r = Math.max(3.2 * dpr, 1.05 * g.u) * (strong ? 1.35 : 1);
    lozenge(c, x, y, r);
    c.fillStyle = strong ? rgba(mixHex(ing.color, BONE, 0.15), 1) : INK;
    c.fill();
    c.lineWidth = 1.1 * dpr;
    c.strokeStyle = strong ? bone(1) : rgba(mixHex(ing.color, BONE, 0.45), dim ? 0.4 : 0.85);
    c.stroke();
    if (strong) {
      const size = fontPx(3.5, 11, 19);
      c.font = `italic 500 ${size}px ${families().disp}`;
      const right = x < g.C[0];
      const tx = x + (right ? 1 : -1) * (r + 1.6 * g.u);
      const ty = y - 0.4 * g.u;
      // keep the lettering legible over rings and labels
      c.lineWidth = 3 * dpr;
      c.strokeStyle = 'rgba(5,5,7,0.85)';
      c.lineJoin = 'round';
      c.textAlign = right ? 'left' : 'right';
      c.textBaseline = 'middle';
      c.strokeText(ing.name, tx, ty);
      c.fillStyle = bone(1);
      c.fillText(ing.name, tx, ty);
    }
  }

  // ---- the live layer: brewing ----------------------------------------------------------------
  function drawBrew(dt) {
    const brew = game.brew,
      st = game.state,
      c = ctx;
    const mix = brew.mix;
    if (!mix) shown = null;
    else if (!shown) shown = mix.slice();
    else {
      const k = 1 - Math.exp(-dt * 9);
      for (let i = 0; i < 3; i++) shown[i] += (mix[i] - shown[i]) * k;
    }
    const ready = brew.ready;
    const litId = ready ? ready.potion : brew.region ? brew.region.id : null;
    if (litId) {
      region(c, litId, inked(litId) ? 2 : 0);
      if (inked(litId)) regionLabel(c, litId, true);
    }

    // where would the hovered ingredient pull the mixture?
    let target = null;
    if (hover && !ready && D.INGREDIENTS[hover] && brew.contents.length < D.BREW.capacity) {
      const cur = D.mixOf(brew.contents);
      const ing = D.INGREDIENTS[hover];
      if (cur.bary) {
        const w = cur.total + ing.weight;
        target = [0, 1, 2].map((i) => (cur.bary[i] * cur.total + ing.bary[i] * ing.weight) / w);
      } else target = ing.bary.slice();
      const tr = D.regionAt(target);
      if (tr && tr.id !== litId && inked(tr.id)) region(c, tr.id, 2);
    }

    for (const id of D.INGREDIENT_ORDER) {
      const n = st.inv.ingredients[id] || 0;
      const used = brew.contents.indexOf(id) >= 0;
      if (!n && !used && hover !== id) continue;
      if (hover !== id) ingMark(c, id, false, !n);
    }

    const r = Math.max(4.6 * dpr, 1.45 * g.u);
    if (shown) {
      const cur = g.P(shown);
      // the trail of earlier mixtures
      const pts = brew.trail.map((b) => g.P(b));
      c.lineWidth = 1 * dpr;
      c.setLineDash([]);
      for (let i = 0; i < pts.length; i++) {
        const a = 0.14 + (0.42 * (i + 1)) / pts.length;
        c.strokeStyle = bone(a);
        seg(c, pts[i], i + 1 < pts.length ? pts[i + 1] : cur);
        c.fillStyle = bone(a + 0.1);
        c.beginPath();
        c.arc(pts[i][0], pts[i][1], 1.5 * dpr, 0, TAU);
        c.fill();
      }
      if (target) {
        const tp = g.P(target);
        const ip = g.P(D.INGREDIENTS[hover].bary);
        c.strokeStyle = bone(0.16);
        seg(c, tp, ip);
        c.setLineDash([3 * dpr, 4 * dpr]);
        c.strokeStyle = bone(0.7);
        seg(c, cur, tp);
        c.beginPath();
        c.arc(tp[0], tp[1], r, 0, TAU);
        c.stroke();
        c.setLineDash([]);
      }
      // binding ring
      const potionCol = litId && inked(litId) ? D.POTIONS[litId].color : EMBER;
      if (ready) {
        const f = (time * 0.55) % 1;
        c.lineWidth = 1.2 * dpr;
        c.strokeStyle = rgba(mixHex(potionCol, BONE, 0.2), (1 - f) * 0.6);
        c.beginPath();
        c.arc(cur[0], cur[1], r * (2.1 + 2.6 * f), 0, TAU);
        c.stroke();
        c.lineWidth = 1.8 * dpr;
        c.strokeStyle = rgba(mixHex(potionCol, BONE, 0.2), 1);
        c.beginPath();
        c.arc(cur[0], cur[1], r * 2.1, 0, TAU);
        c.stroke();
      } else if (brew.progress > 0.002) {
        c.lineWidth = 1 * dpr;
        c.strokeStyle = bone(0.18);
        c.beginPath();
        c.arc(cur[0], cur[1], r * 2.1, 0, TAU);
        c.stroke();
        c.lineWidth = 1.8 * dpr;
        c.strokeStyle = EMBER_HOT;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(cur[0], cur[1], r * 2.1, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, brew.progress));
        c.stroke();
        c.lineCap = 'butt';
      }
      // the mixture itself
      const grow = 1 + addPulse * 0.6;
      c.fillStyle = INK;
      c.beginPath();
      c.arc(cur[0], cur[1], r * grow, 0, TAU);
      c.fill();
      c.lineWidth = 1.4 * dpr;
      c.strokeStyle = bone(1);
      c.stroke();
      c.save();
      c.shadowColor = potionCol;
      c.shadowBlur = 9 * dpr;
      c.fillStyle = ready || (brew.region && brew.fit === 0) ? rgba(mixHex(potionCol, '#ffffff', 0.25), 1) : potionCol;
      c.beginPath();
      c.arc(cur[0], cur[1], r * 0.44 * grow, 0, TAU);
      c.fill();
      c.restore();
    } else if (target) {
      const tp = g.P(target);
      c.setLineDash([3 * dpr, 4 * dpr]);
      c.strokeStyle = bone(0.7);
      c.lineWidth = 1 * dpr;
      c.beginPath();
      c.arc(tp[0], tp[1], r, 0, TAU);
      c.stroke();
      c.setLineDash([]);
    }
    if (hover) ingMark(c, hover, true, false);
  }

  // ---- the live layer: the Great Work -----------------------------------------------------------
  function drawOpus() {
    const brew = game.brew,
      o = brew.opus,
      c = ctx;
    const { C, L, u } = g;
    const stages = D.OPUS.stages;
    const corners = { sulfur: g.S, mercury: g.M, salt: g.K };
    c.setLineDash([]);
    for (const id in corners) {
      if (brew.contents.indexOf('prime:' + id) < 0) continue;
      c.strokeStyle = rgba(D.PRIME_ITEMS[id].color, 0.62);
      c.lineWidth = 1.3 * dpr;
      seg(c, corners[id], C);
      c.fillStyle = rgba(D.PRIME_ITEMS[id].color, 1);
      lozenge(c, corners[id][0], corners[id][1], 1.5 * u);
      c.fill();
    }
    if (!o) return;
    for (let i = stages.length - 1; i >= 0; i--) {
      const rr = (0.062 + 0.04 * i) * L;
      const done = o.done || i < o.stage;
      const now = !o.done && i === o.stage;
      const black = i === 0;
      const col = black ? INK : stages[i].color;
      const band = 2.6 * dpr;
      const arc = (a0, a1, style, lw) => {
        c.strokeStyle = style;
        c.lineWidth = lw;
        c.beginPath();
        c.arc(C[0], C[1], rr, a0, a1);
        c.stroke();
      };
      if (!done && !now) {
        arc(0, TAU, bone(0.16), 1 * dpr);
        continue;
      }
      const a1 = done ? TAU : TAU * Math.min(1, Math.max(0, o.progress));
      if (now) arc(0, TAU, bone(0.2), 1 * dpr);
      if (a1 <= 0.001) continue;
      // the black stage is drawn as a dark band between two pale hairlines so it reads on ink
      if (black) arc(-Math.PI / 2, -Math.PI / 2 + a1, bone(0.55), band + 2.2 * dpr);
      c.lineCap = 'butt';
      arc(-Math.PI / 2, -Math.PI / 2 + a1, col, band);
    }
    // the matter at the centre
    const sc = o.done ? stages[3].color : stages[Math.min(3, o.stage)].color;
    const pulse = 1 + 0.08 * Math.sin(time * 2.4);
    c.save();
    c.shadowColor = o.done ? stages[3].color : rgba(sc, 0.9);
    c.shadowBlur = (o.done ? 16 : 8) * dpr;
    lozenge(c, C[0], C[1], (o.done ? 3.4 : 2.3) * u * pulse);
    c.fillStyle = o.stage === 0 && !o.done ? INK : sc;
    c.fill();
    c.restore();
    c.lineWidth = 1.2 * dpr;
    c.strokeStyle = bone(0.9);
    lozenge(c, C[0], C[1], (o.done ? 3.4 : 2.3) * u * pulse);
    c.stroke();
  }

  // ---- the live layer: the book ---------------------------------------------------------------
  function drawBook() {
    const st = game.state,
      c = ctx;
    if (focusPotion && inked(focusPotion)) {
      region(c, focusPotion, 2);
      regionLabel(c, focusPotion, true);
    }
    for (const id of D.INGREDIENT_ORDER) {
      if (!st.known.ingredients[id] || id === focusIng) continue;
      ingMark(c, id, false, false);
    }
    if (focusIng && st.known.ingredients[focusIng]) ingMark(c, focusIng, true, false);
  }

  // ---- public ---------------------------------------------------------------------------------
  function draw(dt = 0) {
    if (sizeDirty) resize();
    if (!g) return;
    time += dt;
    addPulse = Math.max(0, addPulse - dt * 2.2);
    const opus = !book && (!!game.brew.opus || game.brew.contents.some((x) => String(x).startsWith('prime:')));
    const fresh = ensureBase(opus);
    if (book) {
      // the book's chart is a still picture: it is only drawn again when what it shows changes
      const known = game.state.known.ingredients;
      let mask = 0;
      for (let i = 0; i < D.INGREDIENT_ORDER.length; i++) if (known[D.INGREDIENT_ORDER[i]]) mask |= 1 << i;
      if (!fresh && mask === drawn.known && focusPotion === drawn.potion && focusIng === drawn.ing) return;
      drawn.known = mask;
      drawn.potion = focusPotion;
      drawn.ing = focusIng;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0);
    if (book) drawBook();
    else if (opus) drawOpus();
    else drawBrew(dt);
  }

  return {
    el,
    draw,
    invalidate() {
      drawn.stale = true;
      sizeDirty = true;
    },
    setHover(id) {
      hover = id || null;
    },
    setFocus(potion, ingredient) {
      focusPotion = potion || null;
      focusIng = ingredient || null;
    },
    /** A short swell of the mixture mark when something drops into the pot. */
    pulse() {
      addPulse = 1;
    },
  };
}
