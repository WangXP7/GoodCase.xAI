// The score, written down: a key, bars of chords and a line for every player, and the reader that
// turns them into notes. Nothing here makes a sound, so it can be read and checked without a
// browser (node tools/score-check.mjs). music.js is the band that plays it.
//
//   prog   '1 | 6 | 3 | 5M'    one bar each; two chords in a bar share it. A chord is a degree of
//                              the mode, then if needed a quality (M major, m minor, d diminished,
//                              s sus4, 5 bare fifth), 7 and 9, and /bass: '5M7', '19', 'b5M/1'.
//   line   "5, - 1 | 3 - 1"    the tokens of a bar share it equally. A token is a degree of the
//                              mode (1-7, with # or b before it and ' or , after it for an octave
//                              up or down), or a tone of the chord of the moment (R root, T third,
//                              F fifth, N ninth, S seventh, B its bass note), or - to hold the
//                              note before, or . for a rest.
//   kit    'B . . t . . k .'   B war drum, b the same softly, t frame drum, k its rim, s rattle,
//                              a anvil, h a far slack drum, x bowed metal, g a low growl.
//   true                       a player with `auto` voices plays the chords, led from one to the
//                              next by the smallest steps.
//   '=viol'                    the line of another player in this section, in this player's octave.
//   dyn    'p'                 how hard the whole room plays the section: pp, p, mp, mf or f. A
//                              section without a mark is played f, as written.
// A line shorter than the progression repeats under it. `from` is the intensity at which a player
// comes in; `near` keeps a player out of the hall (bass and drums turn to mud in it).
import { midi } from './dsp.js';

export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};
export const KIT = [...'Bbtksahxg'];
// A dynamic mark as a share of the written strength of every note.
export const DYN = { pp: 0.4, p: 0.55, mp: 0.7, mf: 0.85, f: 1 };

const mod12 = (x) => ((x % 12) + 12) % 12;
const ACC = { '': 0, '#': 1, b: -1 };
const QUALITY = { M: [4, 7], m: [3, 7], d: [3, 6], s: [5, 7], 5: [null, 7] };
const CHORD = /^([b#]?)([1-7])([Mmds5]?)(7?)(9?)(?:\/([b#]?)([1-7]))?$/;
const TOKEN = /^([b#]?)([1-7RTFNSB])([',]*)$/;
const MAX_HOLD = 4; // bars a chord voice is held before it is bowed again

/** A chord symbol in a mode: its tones as semitones above the tonic (root, bass, pcs) and above its root. */
export function chord(sym, scale) {
  const m = CHORD.exec(sym);
  if (!m) throw new Error(`bad chord "${sym}"`);
  const d = Number(m[2]) - 1;
  const root = mod12(scale[d] + ACC[m[1]]);
  const up = (steps) => mod12(scale[(d + steps) % 7] - scale[d]);
  let third = up(2),
    fifth = up(4);
  if (m[3]) [third, fifth] = QUALITY[m[3]];
  else if (m[1]) [third, fifth] = QUALITY.M;
  const seventh = m[4] ? up(6) : null;
  const ninth = m[5] ? up(1) : null;
  const bass = m[7] ? mod12(scale[Number(m[7]) - 1] + ACC[m[6]]) : root;
  const pcs = [root];
  for (const iv of [third, fifth, seventh, ninth]) if (iv != null) pcs.push(mod12(root + iv));
  // `second`: what N plays when the chord has no ninth of its own. A minor second above the root
  // is not a colour but a wound, so there N falls back on the root.
  return { sym, root, third, fifth, seventh, ninth, second: up(1) === 2 ? 2 : 0, bass, pcs };
}

function bars(text, where) {
  const out = String(text).split('|').map((b) => b.trim().split(/\s+/).filter(Boolean));
  for (const b of out) if (!b.length) throw new Error(`${where}: an empty bar`);
  return out;
}

function readProg(text, scale, where) {
  const chords = [];
  const list = bars(text, where);
  list.forEach((syms, b) => syms.forEach((s, i) => chords.push({ at: b + i / syms.length, len: 1 / syms.length, ch: chord(s, scale) })));
  return { bars: list.length, chords };
}

/** A written line as notes: { at, len (in bars), tok, slot, of }. */
function readLine(text, nBars, where) {
  const list = bars(text, where);
  if (nBars % list.length) throw new Error(`${where}: ${list.length} bars do not fit under ${nBars}`);
  const notes = [];
  let open = null;
  for (let b = 0; b < nBars; b++) {
    const toks = list[b % list.length],
      n = toks.length;
    toks.forEach((tok, i) => {
      const at = b + i / n;
      if (tok === '-') {
        if (open) open.len = at + 1 / n - open.at;
        return;
      }
      open = null;
      if (tok === '.') return;
      open = { at, len: 1 / n, tok, slot: i, of: n };
      notes.push(open);
    });
  }
  return notes;
}

/** How much weight a place in the bar carries: 1 the downbeat, 0.9 the middle of a bar of 4 or 6. */
function accent(slot, of, beats) {
  const b = (slot / of) * beats,
    near = (x) => Math.abs(b - x) < 1e-6;
  if (near(0)) return 1;
  if (beats === 4 && near(2)) return 0.9;
  if (beats === 6) return near(3) ? 0.9 : 0.72;
  return near(Math.round(b)) ? 0.8 : 0.7;
}

function pitch(tok, ch, tr, P, where) {
  const m = TOKEN.exec(tok);
  if (!m) throw new Error(`${where}: bad note "${tok}"`);
  let oct = tr.oct || 0;
  for (const c of m[3]) oct += c === "'" ? 1 : -1;
  let rel;
  if (m[2] >= '1' && m[2] <= '7') rel = P.scale[Number(m[2]) - 1] + ACC[m[1]];
  else {
    if (m[1]) throw new Error(`${where}: "${tok}" - a tone of the chord takes no accidental`);
    // roots lie within a fourth below and a tritone above the tonic, so a bass line stays in one octave
    const wrap = (pc) => (pc > 6 ? pc - 12 : pc);
    const root = wrap(ch.root);
    rel = { R: root, T: root + (ch.third ?? ch.fifth), F: root + ch.fifth, S: root + (ch.seventh ?? 12), N: root + (ch.ninth ?? ch.second), B: wrap(ch.bass) }[m[2]];
  }
  return P.key + 12 * oct + rel + (tr.shift || 0);
}

/** The n notes between lo and hi that say the chord best and move least from the voicing before. */
function voicing(ch, n, lo, hi, key, prev) {
  const cand = [];
  for (let m = lo; m <= hi; m++) if (ch.pcs.includes(mod12(m - key))) cand.push(m);
  n = Math.min(n, cand.length);
  const need = (iv, cost) => (iv == null ? null : [mod12(ch.root + iv), cost]);
  const wants = [need(ch.third, 8), need(ch.ninth, 5), need(ch.seventh, 5), [ch.root, 2], need(ch.fifth, 1)].filter(Boolean);
  let best = null,
    bestCost = Infinity;
  const pick = [];
  const cost = () => {
    let c = 0;
    const have = new Set(pick.map((m) => mod12(m - key)));
    for (const [pc, w] of wants) if (!have.has(pc)) c += w;
    c += (pick.length - have.size) * 3;
    let sum = 0;
    for (let i = 0; i < pick.length; i++) {
      sum += pick[i];
      if (!i) continue;
      const d = pick[i] - pick[i - 1];
      c += d < 2 ? 6 : d === 2 ? 1.5 : d > 12 ? 6 : d > 9 ? 2 : 0;
    }
    c += Math.abs(sum / pick.length - (lo + hi) / 2) * 0.25;
    if (prev && prev.length === pick.length) {
      for (let i = 0; i < pick.length; i++) c += Math.abs(pick[i] - prev[i]);
      if (Math.abs(pick[pick.length - 1] - prev[prev.length - 1]) > 4) c += 2;
    }
    return c;
  };
  const rec = (start) => {
    if (pick.length === n) {
      const c = cost();
      if (c < bestCost) {
        bestCost = c;
        best = pick.slice();
      }
      return;
    }
    for (let i = start; i < cand.length; i++) {
      pick.push(cand[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return best || [];
}

/** Chords for a player with `auto` voices: a note that two chords share is held, not struck again. */
function autoNotes(chords, tr, key) {
  const notes = [];
  let open = new Map(),
    prev = null;
  for (const c of chords) {
    prev = voicing(c.ch, tr.auto, tr.lo ?? 50, tr.hi ?? 69, key, prev);
    const next = new Map();
    for (const m of prev) {
      let note = open.get(m);
      if (note && c.at + c.len - note.at <= MAX_HOLD) note.len = c.at + c.len - note.at;
      else notes.push((note = { at: c.at, len: c.len, m, acc: 1, auto: true, ch: c.ch }));
      next.set(m, note);
    }
    open = next;
  }
  return notes;
}

/** Read a piece: every section becomes a list of notes in the order they sound. */
export function compile(piece, name = 'piece') {
  const scale = MODES[piece.mode];
  if (!scale) throw new Error(`${name}: no mode "${piece.mode}"`);
  const P = {
    name,
    key: midi(piece.key),
    scale,
    beats: piece.beats,
    bar: (piece.beats * 60) / piece.bpm, // seconds
    wet: piece.wet ?? 0.6,
    form: piece.form,
    loop: piece.loop ?? 0,
    tracks: [],
    sections: {},
  };
  const index = new Map();
  for (const [tn, t] of Object.entries(piece.tracks)) {
    index.set(tn, P.tracks.length);
    P.tracks.push({ name: tn, oct: 0, g: 1, from: 0, pan: 0, ...t });
  }
  for (const [sn, sec] of Object.entries(piece.sections)) {
    const at = `${name}.${sn}`;
    const { bars: nBars, chords } = readProg(sec.prog, scale, at);
    const dyn = DYN[sec.dyn ?? 'f'];
    if (dyn == null) throw new Error(`${at}: no dynamic mark "${sec.dyn}"`);
    const chordAt = (x) => {
      let c = chords[0];
      for (const k of chords) {
        if (k.at > x + 1e-9) break;
        c = k;
      }
      return c.ch;
    };
    const notes = [];
    for (const [tn, val] of Object.entries(sec)) {
      if (tn === 'prog' || tn === 'dyn' || val == null || val === false) continue;
      const ti = index.get(tn),
        where = `${at}.${tn}`;
      if (ti == null) throw new Error(`${where}: there is no such player`);
      const tr = P.tracks[ti];
      if (val === true) {
        if (!tr.auto) throw new Error(`${where}: this player needs a written line`);
        for (const n of autoNotes(chords, tr, P.key)) notes.push({ ...n, tr: ti });
        continue;
      }
      let text = val;
      if (text[0] === '=') {
        text = sec[text.slice(1)];
        if (typeof text !== 'string' || text[0] === '=') throw new Error(`${where}: "${val}" names no written line`);
      }
      const line = readLine(text, nBars, where);
      line.forEach((n, i) => {
        const next = line[i + 1];
        const note = { tr: ti, at: n.at, len: n.len, acc: accent(n.slot, n.of, P.beats), join: !!next && Math.abs(next.at - n.at - n.len) < 1e-6 };
        if (tr.inst === 'kit') {
          if (!KIT.includes(n.tok)) throw new Error(`${where}: "${n.tok}" is not in the kit`);
          note.k = n.tok;
        } else {
          note.ch = chordAt(n.at);
          note.m = pitch(n.tok, note.ch, tr, P, where);
        }
        notes.push(note);
      });
    }
    notes.sort((a, b) => a.at - b.at || a.tr - b.tr);
    P.sections[sn] = { name: sn, bars: nBars, chords, notes, dyn };
  }
  for (const s of P.form) if (!P.sections[s]) throw new Error(`${name}: the form names "${s}", which is not written`);
  if (!(P.loop >= 0 && P.loop < P.form.length)) throw new Error(`${name}: the form cannot loop to ${P.loop}`);
  return P;
}

// --- the pieces -------------------------------------------------------------------------------------
// One motif runs through them: a fifth and a third rising, A D F over D, the three Primes. It opens
// the title theme and the Great Work, rings in the bells at night, and comes back in the major at
// the end.

// Title. D minor in three. The theme on a vielle over a lute; the flute joins it the second time.
const title = (() => {
  const lute = "R F R' T' F R'";
  const A = {
    prog: '1 | 6 | 3 | 7 | 1 | 6 | 5M | 1',
    pad: true,
    lute,
    bass: 'R - -',
    viol: '5, - 1 | 3 - 1 | 5 - 4 | 2 - - | 5, - 1 | 3 - 4 | 5 4 2 | 1 - -',
  };
  return {
    key: 'D3', mode: 'aeolian', beats: 3, bpm: 84, wet: 0.6,
    tracks: {
      pad: { inst: 'pad', auto: 3, lo: 50, hi: 69, g: 1.1 },
      lute: { inst: 'pluck', bright: 0.55, pan: -0.25, g: 1.15 },
      bass: { inst: 'bass', oct: -1, near: true, g: 1.1 },
      viol: { inst: 'viol', oct: 1, from: 0.2, pan: 0.15 },
      flute: { inst: 'flute', oct: 2, from: 0.5, pan: -0.2, g: 0.65 },
      choir: { inst: 'choir', auto: 2, from: 0.6, v: ['oo', 'ah'], lo: 57, hi: 72, g: 1.15 },
      bell: { inst: 'chime', oct: 1, from: 0.3, pan: 0.3, g: 1.55 },
      toll: { inst: 'toll', from: 0.5, g: 0.8 },
      drum: { inst: 'kit', from: 0.6, near: true, g: 1.6 },
    },
    sections: {
      I: { prog: '1 | 1 | 6 | 5s', pad: true, lute, bass: 'R - -', toll: '1 | . | . | .' },
      A,
      A2: { ...A, lute: "R F R' T' F' T'", flute: '=viol', choir: true },
      B: {
        prog: '3 | 7 | 4 | 1 | 6 | 3 | 4 | 5M',
        pad: true,
        lute,
        bass: 'R - -',
        viol: "3 5 7 | 1' - 7 | 6 - 5 | 5 - - | 6 - 1' | 7 - 5 | 6 5 4 | 3 2 -",
        flute: '. | . | . | 3 2 1 | . | . | . | .',
      },
      A3: {
        ...A,
        lute: "R F R' T' F' T'",
        bass: 'R - F',
        flute: '=viol',
        choir: true,
        bell: "1' . . | . | 5' . . | . | 1' . . | . | 5' . . | 1' . .",
        toll: '1 | . | . | . | 1 | . | . | .',
        drum: 'B . . | . . b | B . . | . . b | B . . | . . b | B . b | B . .',
      },
      R: { prog: '1 | 6 | 6 | 5M', pad: true, bass: 'R - -', lute: "R . F . R' . | .", bell: "5 . . | 1' . . | 3' . . | 2' . ." },
    },
    form: ['I', 'A', 'A2', 'B', 'A3', 'R'],
    loop: 1,
  };
})();

// Hearthfall. D Dorian in six: the raised sixth is the little warmth left in the moor. A whistle
// tune over a lute, a second strain on the vielle.
const vale = (() => {
  const lute = "R F R' T' R' F";
  const A = {
    prog: '1 | 4 | 1 | 7 | 1 | 4 | 5 | 1',
    pad: true,
    lute,
    bass: 'R',
    flute: "1 - - 5 - - | 6 - 5 4 - - | 5 - 3 1 - - | 2 - - 7, - - | 1 - - 5 - - | 6 - 7 1' - - | 7 - 5 2 - - | 1 - - - - -",
  };
  return {
    key: 'D3', mode: 'dorian', beats: 6, bpm: 156, wet: 0.55,
    tracks: {
      pad: { inst: 'pad', auto: 3, lo: 50, hi: 69, bright: 0.45 },
      lute: { inst: 'pluck', bright: 0.55, pan: -0.25, g: 1.05 },
      bass: { inst: 'bass', oct: -1, near: true },
      flute: { inst: 'flute', oct: 1, pan: 0.15 },
      viol: { inst: 'viol', oct: 1, from: 0.25, pan: -0.12, g: 0.95 },
      choir: { inst: 'choir', auto: 2, from: 0.45, v: ['mm', 'oo'], lo: 55, hi: 69, g: 0.55 },
      drum: { inst: 'kit', from: 0.4, near: true, g: 1.2 },
    },
    sections: {
      I: { prog: '1 | 1', pad: true, lute },
      A,
      A2: { ...A, bass: 'R - - F - -', choir: true },
      B: {
        prog: '3 | 7 | 4 | 1 | 3 | 7 | 5 | 5',
        pad: true,
        lute: "R T F R' F T",
        bass: 'R',
        viol: '3 - - 5 - 3 | 2 - 3 2 - 7, | 4 - - 6 - - | 5 - - - - - | 7 - 5 3 - - | 2 - 4 7 - - | 7 - 6 5 - - | 5 - - 2 - -',
      },
      A3: { ...A, bass: 'R - - F - -', viol: '1, | 4, | 3, | 2, | 1, | 4, | 2, | 1,', drum: 't . . k . k', choir: true },
      R: { prog: '1 | 7 | 4 | 1', pad: true, lute: "1' - - 5' - - | 2' - - 7 - - | 6 - - 4 - - | 1' - - - - -" },
    },
    form: ['I', 'A', 'A2', 'B', 'A3', 'R'],
    loop: 1,
  };
})();

// Night anywhere. D minor, slow three: a harp, and the motif let fall one bell at a time.
const night = (() => {
  const harp = "R F T'";
  return {
    key: 'D3', mode: 'aeolian', beats: 3, bpm: 66, wet: 0.7,
    tracks: {
      pad: { inst: 'pad', auto: 3, lo: 45, hi: 65, bright: 0.25, a: 1.1, r: 2.2, g: 1.3 },
      harp: { inst: 'pluck', bright: 0.7, pan: -0.2, g: 1.55 },
      bell: { inst: 'chime', oct: 2, pan: 0.25, dk: 6, g: 2.2 },
      viol: { inst: 'viol', oct: 1, from: 0.2, pan: 0.1 },
      bass: { inst: 'bass', oct: -1, from: 0.3, near: true, g: 1.1 },
      choir: { inst: 'choir', auto: 2, from: 0.5, v: ['mm', 'oo'], lo: 53, hi: 67, g: 0.65 },
    },
    sections: {
      A: { prog: '1 | 1 | 6 | 6 | 4 | 4 | 5s | 5M', pad: true, harp, bell: '5, - 1 | 3 - - | . . 3 | 1 - - | . 6, 1 | 4 - 3 | 2 - - | #7, - -' },
      B: {
        prog: '6 | 7 | 1 | 1 | 4 | 1 | 5M | 1',
        pad: true,
        harp,
        bass: 'R - -',
        choir: true,
        viol: "1' - - | 7 - - | 5 - - | - - - | 6 - - | 5 - 4 | 2 - #7, | 1 - -",
        bell: '. | . | . | . 1 5 | . | . | . | . . 5',
      },
      R: { prog: '1 | 1 | 1 | 1', pad: true, harp: "R . . | . . F | . | R' . .", bell: '. | . . 5 | . | .' },
      // the second time the vielle has the motif, low, and the bells only answer it
      A2: {
        prog: '1 | 1 | 6 | 6 | 4 | 4 | 5s | 5M',
        pad: true,
        harp,
        bass: 'R - -',
        viol: '5, - 1 | 3 - - | - - - | 1 - - | 6, - 1 | 4 - 3 | 2 - - | #7, - -',
        bell: '. | . . 3 | 1 - - | . | . | . . 4 | . . 2 | .',
      },
    },
    form: ['A', 'B', 'R', 'A2', 'B', 'R'],
    loop: 0,
  };
})();

// The Saltwood. E Phrygian: a chant in steps over bare fifths, answered by a vielle, then sung
// again with a second voice a fifth above it, the way the oldest written music goes.
const saltwood = (() => {
  const psalt = "R F R' F";
  const A = {
    // where the chant and its fifth land on another chord, the bar is shared: G then E, F then A minor
    prog: '15 | 3 15 | 2 4 | 15 | 7 | 6 | 4 2 | 15',
    pad: true,
    bass: 'R | R - R - | R - R - | R | R | R | R - R - | R',
    chant: '1 - - 2 | 3 - 2 1 | 2 - 4 - | 3 2 1 - | 7, - 1 2 | 3 - 4 3 | 4 - 3 2 | 1 - - -',
    psalt,
    drum: 't . . . . . k . | t . . . . . . .',
  };
  return {
    key: 'E3', mode: 'phrygian', beats: 4, bpm: 63, wet: 0.75,
    tracks: {
      pad: { inst: 'pad', auto: 3, lo: 52, hi: 71, bright: 0.3, thin: true, g: 0.7 },
      bass: { inst: 'bass', oct: -1, near: true, g: 0.85 },
      chant: { inst: 'choir', v: ['oh', 'oo'], pan: -0.1 },
      organum: { inst: 'choir', shift: 7, v: ['oo', 'oh'], from: 0.3, pan: 0.15, g: 0.6 },
      psalt: { inst: 'pluck', oct: 1, bright: 0.9, from: 0.3, pan: 0.3, g: 1.2 },
      viol: { inst: 'viol', oct: 1, from: 0.2, pan: 0.1, g: 0.7 },
      bell: { inst: 'chime', oct: 2, from: 0.35, pan: -0.3, dk: 7, g: 1.25 },
      toll: { inst: 'toll', from: 0.5, g: 0.7 },
      drum: { inst: 'kit', from: 0.45, near: true, g: 1.3 },
    },
    sections: {
      A,
      B: {
        prog: '15 | 6 | 15 | 2 | 4 | 3 | 2 | 15',
        pad: true,
        bass: 'R',
        psalt,
        viol: "5 - - - - - 6 5 | 3 - - - - - 4 5 | 5 - - - 4 - 3 - | 4 - - - - - - - | 1' - - - 7 - 6 - | 5 - - - 7 - 5 - | 4 - 3 - 2 - - - | 1 - - - - - - -",
      },
      A2: { ...A, organum: '=chant', bell: '. | . | . | 5 . . . | . | . | . | 1 . . .', toll: '1 | . | . | . | . | . | . | .' },
      R: { prog: '15 | 15 | 15 | 15', pad: true, bass: 'R', psalt: "R . . . F . . . | . . . . R' . . . | F . . . . . . . | ." },
    },
    form: ['A', 'B', 'A2', 'R'],
    loop: 0,
  };
})();

// Quickmere. C sharp minor, every phrase of the flute coming to rest on a ninth left hanging over
// still water; long harp figures underneath.
const mere = (() => {
  const harp = "R F N' T' F' T' N' F";
  const A = {
    prog: '19 | 19 | 69 | 69 | 49 | 49 | 5s | 5',
    pad: true,
    harp,
    bass: 'R',
    flute: "5 - - - - - 3 2 | 2 - - - - - - . | 3 - - - - - 5 7 | 1' - - - 7 - - . | 1' - - - 7 - 6 - | 5 - - - - - - . | 5 - - - 4 - 2 - | 2 - - - - - . .",
  };
  return {
    key: 'Cs3', mode: 'aeolian', beats: 4, bpm: 70, wet: 0.7,
    tracks: {
      pad: { inst: 'pad', auto: 3, lo: 52, hi: 71, bright: 0.55 },
      harp: { inst: 'pluck', bright: 0.75, pan: -0.25, g: 1.15 },
      bass: { inst: 'bass', oct: -1, from: 0.25, near: true },
      flute: { inst: 'flute', oct: 1, pan: 0.2 },
      viol: { inst: 'viol', oct: 1, from: 0.2, pan: -0.1, g: 0.9 },
      bell: { inst: 'chime', oct: 2, from: 0.3, pan: 0.3, dk: 5, g: 2.1 },
      choir: { inst: 'choir', auto: 2, from: 0.45, v: ['oo', 'oh'], lo: 56, hi: 71, g: 0.85 },
    },
    sections: {
      I: { prog: '19 | 19', pad: true, harp },
      A,
      B: {
        prog: '3 | 7 | 6 | 1 | 4 | 3 | 6 | 5M',
        pad: true,
        bass: 'R',
        harp: "R F T' F' T' F R' F",
        viol: "3 - 5 - 7 - - - | 7 - - - 2' - - - | 1' - - - 7 - 6 - | 5 - - - - - - - | 6 - - - 1' - 6 - | 5 - - - 7 - 5 - | 6 - 5 - 3 - - - | 2 - - - #7, - - -",
      },
      A2: { ...A, choir: true, bell: '. | . . . . 2 . . . | . | . . . . 7 . . . | . | . . . . 5 . . . | . | . . . . 2 . . .' },
      R: { prog: '19 | 19 | 69 | 5s', pad: true, harp: "R . F . N' . T' ." },
    },
    form: ['I', 'A', 'B', 'A2', 'R'],
    loop: 1,
  };
})();

// The Scar. A Phrygian, slow and heavy: a horn over a pedal with the flat second ground against it,
// war drums, and men's voices for the second strain.
const scar = (() => {
  const drum = 'B . . . . . t . | B . . . t . . .';
  const A = {
    prog: '1 | 1 | 2/1 | 1 | 6 | 4 | 2 | 5',
    organ: true,
    bass: '1 | - | 1 | - | R | R | R | R',
    drum,
    horn: '1 - - - - - - 2 | 1 - - - 5, - - - | 2 - - - 4 - 3 2 | 1 - - - - - . . | 3 - - - 6 - - - | 6 - 5 - 4 - - - | 4 - - - 2 - - - | 2 - - - - - 7, -',
  };
  return {
    key: 'A2', mode: 'phrygian', beats: 4, bpm: 56, wet: 0.65,
    tracks: {
      organ: { inst: 'organ', auto: 3, lo: 48, hi: 65, g: 0.65 },
      bass: { inst: 'bass', near: true, g: 0.8 },
      horn: { inst: 'horn', oct: 1, pan: 0.1 },
      choir: { inst: 'choir', oct: 1, auto: 2, from: 0.2, v: ['oh', 'eh'], lo: 52, hi: 67, pan: -0.1, g: 0.65 },
      drum: { inst: 'kit', from: 0.45, near: true, g: 1.1 },
      anvil: { inst: 'kit', from: 0.7, pan: 0.3, g: 1.4 },
      fx: { inst: 'kit', from: 0.2, g: 0.55 },
    },
    sections: {
      I: { prog: '1 | 1', bass: '1 | -', drum },
      A,
      B: {
        prog: '4 | 1 | 2 | 1 | 4 | 6 | 2 | 1',
        organ: true,
        bass: 'R',
        drum,
        choir: "4 - - - 6 - 5 4 | 5 - - - 3 - - - | 4 - - - 6 - 5 4 | 3 - 2 - 1 - - - | 6 - - - 1' - - - | 1' - 7 - 6 - - - | 6 - - - 4 - 2 - | 1 - - - - - - -",
      },
      A2: { ...A, choir: true, anvil: 'a . . . . . . . | . | . | . | a . . . . . . . | . | . | .' },
      // the band stops: the pedal alone, a far drum, something turning over under the ground
      R: { prog: '1 | 1', bass: '1 | -', drum: 'h . . . . . . . | .', fx: 'g - - - - - - - | -' },
      R2: { prog: '2/1 | 1', organ: true, bass: '1 | -', drum: 'h . . . . . . . | . . . . t . . .' },
    },
    form: ['I', 'A', 'B', 'A2', 'R', 'R2'],
    loop: 1,
  };
})();

// Greyhorn. A minor, wide and high and slow: a flute alone above the valley, a horn calling from
// the far side and the flute answering.
const heights = (() => {
  const harp = "R . F . T' . . .";
  const A = {
    prog: '1 | 5 | 6 | 3 | 4 | 1 | 6 | 5',
    pad: true,
    bass: 'R',
    harp,
    flute: "1 - - - 5 - - - | 5 - - 4 2 - - - | 3 - - - 6 - - 5 | 5 - - - - - 3 - | 4 - - - 1' - - - | 1' - - 7 5 - - - | 6 - - 5 3 - - - | 2 - - - - - . .",
  };
  return {
    key: 'A3', mode: 'aeolian', beats: 4, bpm: 54, wet: 0.8,
    tracks: {
      pad: { inst: 'pad', auto: 3, lo: 55, hi: 76, bright: 0.4, thin: true, a: 1.0, r: 2.2, g: 0.85 },
      bass: { inst: 'bass', oct: -1, from: 0.2, near: true, g: 1.35 },
      harp: { inst: 'pluck', bright: 0.7, pan: -0.3, g: 1.5 },
      flute: { inst: 'flute', oct: 1, pan: 0.15 },
      horn: { inst: 'horn', from: 0.2, pan: -0.15, g: 1.4 },
      choir: { inst: 'choir', auto: 2, from: 0.45, v: ['oo', 'ah'], lo: 57, hi: 72, g: 1.15 },
      bell: { inst: 'chime', oct: 1, from: 0.3, pan: 0.3, dk: 7, g: 1.8 },
    },
    sections: {
      A,
      B: {
        prog: '6 | 7 | 1 | 1 | 6 | 7 | 5 | 5',
        pad: true,
        bass: 'R',
        harp,
        horn: '6, - - - 1 - - - | 2 - - - 4 - - - | 3 - - - - - - - | . | 6, - - - 1 - 3 - | 4 - - - 2 - - - | 2 - - - - - - - | .',
        flute: '. | . | . | 5 - 3 - 1 - - - | . | . | . | 5 - 4 - 2 - - -',
      },
      A2: { ...A, choir: true },
      R: { prog: '1 | 1 | 6 | 5', pad: true, bell: ". | 5 . . . . . . . | 1' . . . . . . . | 7 . . . . . . ." },
    },
    form: ['A', 'B', 'A2', 'R'],
    loop: 0,
  };
})();

// The Gloom. D Phrygian with the fifth flattened: a figure in the low strings that will not stop,
// a double heartbeat, a voice that only ever sighs downward. The nearer the Shades, the more of the
// band is in the room: voices, then drums, then horns.
const gloom = (() => {
  const heart = 'h . h . . . . . h . h . . . . .';
  const toms = 't . . k . . t . . k . . t . k .';
  const war = 'B . . . . . . . B . . . . . . .';
  const anvil = 'a . . . . . . . | . | a . . . . . . . | .';
  return {
    key: 'D3', mode: 'phrygian', beats: 4, bpm: 72, wet: 0.75,
    tracks: {
      pad: { inst: 'pad', auto: 3, lo: 50, hi: 67, bright: 0.2, g: 1.15 },
      bass: { inst: 'bass', oct: -1, near: true, g: 1.2 },
      ost: { inst: 'bass', from: 0.2, near: true, a: 0.02, r: 0.1, stac: 0.7, bite: true, pan: -0.1, g: 2.6 },
      heart: { inst: 'kit', from: 0.3, near: true, g: 1.45 },
      line: { inst: 'viol', oct: 1, from: 0.2, pan: 0.1 },
      wail: { inst: 'choir', oct: 1, from: 0.4, v: ['ah', 'oo'], pan: 0.2, g: 0.9 },
      choir: { inst: 'choir', auto: 3, from: 0.45, v: ['eh', 'ah'], lo: 53, hi: 68, pan: -0.15, g: 1.65 },
      toms: { inst: 'kit', from: 0.62, near: true, g: 1.35 },
      horn: { inst: 'horn', from: 0.75, g: 1.35 },
      war: { inst: 'kit', from: 0.85, near: true, g: 1.9 },
      anvil: { inst: 'kit', from: 0.85, pan: 0.3, g: 1.4 },
      fx: { inst: 'kit', from: 0.25 },
    },
    sections: {
      A: {
        prog: '1 | 1 | 2M/1 | 1 | 1 | b5M/1 | 2M/1 | 15',
        pad: true,
        bass: '1 | - | 1 | - | 1 | - | 1 | -',
        ost: '1 1 2 1 b5 1 2 1 | 1 1 2 1 4 3 2 1',
        heart,
        choir: true,
        wail: '. | 6 - - - 5 - - - | . | 6 - - - 5 - - - | . | 7 - - - b5 - - - | . | 2 - - - 1 - - -',
        toms,
        war,
        anvil,
        horn: '1 - . . . . . . | . | 2 - . . . . . . | . | 1 - . . . . . . | b5 - . . . . . . | 2 - . . . . . . | 1 - - - . . . .',
        fx: 'x - - - - - - - | . | . | . | . | x - - - - - - - | . | .',
      },
      B: {
        prog: '1 | 6 | b5M/1 | 2M/1 | 1 | 4 | 2M | 15',
        pad: true,
        bass: '1 | R | 1 | 1 | 1 | R | R | 1',
        ost: '1 1 2 1 4 3 2 1',
        heart,
        choir: true,
        line: '1 - - - - - 3 - | 6 - - - 5 - - - | b5 - - - - - 3 - | 2 - - - - - 1 - | 1 - - - 5 - - - | 6 - - - 4 - - - | 4 - - - 2 - - - | 1 - - - - - - -',
        toms,
        war,
        anvil,
        horn: 'R - . . . . . . | R - . . . . . . | . | . | R - . . . . . . | R - . . . . . . | R - . . . . . . | R - - - . . . .',
        fx: 'g - - - - - - - | . | . | . | g - - - - - - - | . | . | .',
      },
      // it holds its breath: the pedal, the heart, metal dragged somewhere; then the figure starts again
      C: { prog: '1 | 1 | 2M/1 | 15', pad: true, bass: '1 | - | 1 | -', heart, fx: 'x - - - - - - - | . | x - - - - - - - | .' },
    },
    form: ['A', 'B', 'C'],
    loop: 0,
  };
})();

// At the cauldron. G Dorian, a workshop dance that keeps the hands moving: lute and a plucked bass,
// a flute tune, the vielle for the second strain.
const brew = (() => {
  const lute = "R F T' F R' F T' F";
  const bass = 'R . . . F . . .';
  const A = {
    prog: '1 | 4 | 1 | 7 | 3 | 4 | 5 | 5M',
    lute,
    bass,
    flute: '1 - 3 - 5 - 4 3 | 4 - - - 6 - 5 - | 5 - 3 - 1 - 2 3 | 4 - - - 2 - - - | 3 - 5 - 7 - 6 5 | 6 - - - 4 - 5 6 | 5 - - - 4 - 2 - | #7, - - - 2 - - -',
  };
  return {
    key: 'G3', mode: 'dorian', beats: 4, bpm: 96, wet: 0.45,
    tracks: {
      pad: { inst: 'pad', auto: 3, lo: 53, hi: 72, bright: 0.45, g: 0.9 },
      lute: { inst: 'pluck', bright: 0.6, pan: -0.25, g: 1.05 },
      bass: { inst: 'pluck', oct: -1, bright: 0.35, near: true, g: 1.35 },
      flute: { inst: 'flute', oct: 1, from: 0.3, pan: 0.15 },
      viol: { inst: 'viol', from: 0.3, pan: -0.1, g: 0.9 },
      drum: { inst: 'kit', from: 0.55, near: true },
      choir: { inst: 'choir', auto: 2, from: 0.75, v: ['oo', 'ah'], lo: 58, hi: 72 },
    },
    sections: {
      I: { prog: '1 | 1', lute, bass },
      A,
      B: {
        prog: '3 | 7 | 4 | 1 | 3 | 7 | 5M | 1',
        pad: true,
        lute,
        bass,
        drum: 't . . . k . . .',
        viol: '3 - - - 5 - - - | 4 - - - 7, - - - | 4 - 6 - 5 - 4 - | 3 - - - 1 - - - | 3 - - - 5 - 7 - | 7 - - - 4 - - - | 5 - - - #7, - 2 - | 1 - - - - - - -',
      },
      A2: { ...A, pad: true, drum: 't . . k t . k .', choir: true },
      // the hands rest: the lute at half its pace over the bass, and the tune comes round again
      R: { prog: '1 | 4 | 1 | 5M', lute: "R . F . R' . F .", bass: 'R . . . . . . .', drum: '. . . . k . . .' },
    },
    form: ['I', 'A', 'B', 'A2', 'R'],
    loop: 1,
  };
})();

// The Great Work. D minor over a ground of four bars that never changes. The theme again; then a
// voice that climbs an octave by step; then everyone.
const opus = (() => {
  // each time round the ground there are more in the room, and they play harder: bass, harp and
  // the theme, quietly; then the organ, a far drum and the voice; then the war drums and the horns
  const base = { prog: '1 | 6 | 4 | 5M | 1 | 6 | 4 | 5M', bass: 'R - - - - - F -' };
  const toll = '1 | . | . | . | 1 | . | . | .';
  const theme = '5, - - - 1 - - - | 3 - - - 1 - - - | 4 - - - 6 - 5 4 | 5 - - - 2 - - - | 5, - - - 1 - - - | 3 - - - 4 - - - | 6 - 5 - 4 - 3 - | 2 - - - #7, - - -';
  const harp = "R F R' T' R' F R' T'";
  return {
    key: 'D3', mode: 'aeolian', beats: 4, bpm: 66, wet: 0.7,
    tracks: {
      organ: { inst: 'organ', auto: 3, lo: 50, hi: 69 },
      bass: { inst: 'bass', oct: -1, near: true, g: 1.2 },
      viol: { inst: 'viol', oct: 1, from: 0.3, pan: 0.1 },
      choir: { inst: 'choir', oct: 1, auto: 3, from: 0.3, v: ['oh', 'ah'], lo: 57, hi: 72, pan: -0.1 },
      harp: { inst: 'pluck', bright: 0.6, pan: -0.25, g: 1.2 },
      toll: { inst: 'toll', from: 0.5, g: 0.7 },
      drum: { inst: 'kit', from: 0.6, near: true, g: 1.35 },
      flute: { inst: 'flute', oct: 1, from: 0.7, pan: -0.2, g: 0.65 },
      horn: { inst: 'horn', from: 0.8, g: 0.7 },
    },
    sections: {
      G1: { ...base, dyn: 'p', harp, viol: theme, toll: '1 | . | . | . | . | . | . | .' },
      G2: { ...base, dyn: 'mf', organ: true, harp, toll, drum: 'h . . . . . . . | . . . . t . . .', choir: '1 - - - - - 2 - | 3 | 4 | 5 | - | 6 | 6 - - - 7 - - - | #7' },
      G3: {
        ...base,
        organ: true,
        harp,
        toll,
        drum: 'B . . . t . . . | B . . . t . t .',
        horn: 'R',
        viol: "1' - - - 5 - 1' - | 3' - - - 1' - - - | 6 - 1' - 4' - 3' - | 2' - - - #7 - - - | 1' - - - 3' - - - | 6' - - - 3' - - - | 4' - 3' - 2' - 1' - | 2' - #7 - 2' - - -",
        flute: '=viol',
        choir: true,
      },
    },
    form: ['G1', 'G2', 'G3'],
    loop: 0,
  };
})();

// After. The title theme with its third raised.
const ending = (() => {
  const lute = "R F R' T' F R'";
  const A = {
    prog: '1 | 6 | 4 | 5 | 1 | 4 | 5 | 1',
    pad: true,
    lute,
    bass: 'R - -',
    viol: '5, - 1 | 3 - 1 | 6 - 5 | 2 - - | 5, - 1 | 4 - 6 | 5 4 2 | 1 - -',
  };
  return {
    key: 'D3', mode: 'major', beats: 3, bpm: 80, wet: 0.65,
    tracks: {
      pad: { inst: 'pad', auto: 3, lo: 50, hi: 69, bright: 0.6, g: 1.15 },
      lute: { inst: 'pluck', bright: 0.6, pan: -0.25, g: 1.3 },
      bass: { inst: 'bass', oct: -1, near: true, g: 1.2 },
      viol: { inst: 'viol', oct: 1, pan: 0.15 },
      flute: { inst: 'flute', oct: 2, from: 0.3, pan: -0.2, g: 0.7 },
      choir: { inst: 'choir', auto: 3, from: 0.4, v: ['oo', 'ah'], lo: 57, hi: 73 },
      bell: { inst: 'chime', oct: 1, from: 0.3, pan: 0.3, dk: 7, g: 1.65 },
      toll: { inst: 'toll', from: 0.6, g: 0.7 },
    },
    sections: {
      A,
      B: {
        prog: '4 | 1 | 2 | 6 | 4 | 1/3 | 5s | 5',
        pad: true,
        lute,
        bass: 'B - -',
        viol: "6 - 1' | 5 - 3 | 4 - 2 | 3 - - | 6 - 1' | 2' - 1' | 2' - - | 2' 1' 7",
        flute: '=viol',
      },
      A2: {
        ...A,
        lute: "R F R' T' F' T'",
        bass: 'R - F',
        flute: '=viol',
        choir: true,
        bell: "1' . . | . | 6' . . | . | 1' . . | . | 5' . . | 1' . .",
        toll: '1 | . | . | . | 1 | . | . | .',
      },
      C: { prog: '1 | 1 | 1 | 1', pad: true, bass: 'R - -', choir: true, lute: "R . . | F . . | R' . . | .", bell: "5 - - | 1' - - | 3' - - | ." },
    },
    form: ['A', 'B', 'A2', 'C'],
    loop: 0,
  };
})();

export const PIECES = { title, vale, saltwood, mere, scar, heights, night, gloom, brew, opus, ending };
