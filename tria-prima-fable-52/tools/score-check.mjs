// Reads the written score (src/audio/score.js) the way the band will, without a browser.
//   node tools/score-check.mjs            every piece: length, players, anything that looks wrong
//   node tools/score-check.mjs vale       one piece, with every line spelled out in note names
// It fails on what cannot be played (a bad token, a line that does not fit its bars, a note out of
// an instrument's reach) and lists what is merely worth a second look: a long note on a strong
// beat that is not in the chord (a leaning note is fine if it was meant), a wide leap, two lines a
// semitone apart.
import { PIECES, compile } from '../src/audio/score.js';

const only = process.argv[2];
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const nn = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const mod12 = (x) => ((x % 12) + 12) % 12;
// What each instrument can reach (MIDI).
const REACH = { pad: [40, 79], organ: [36, 84], choir: [43, 74], viol: [43, 84], flute: [59, 91], horn: [38, 67], bass: [26, 57], pluck: [36, 88], chime: [60, 96], toll: [36, 62] };
const LINES = new Set(['viol', 'flute', 'horn', 'choir']);

let bad = 0,
  looks = 0;
for (const [name, written] of Object.entries(PIECES)) {
  if (only && only !== name) continue;
  let P;
  try {
    P = compile(written, name);
  } catch (e) {
    bad++;
    console.log(`${name}: FAIL  ${e.message}`);
    continue;
  }
  const secs = (bars) => (bars * P.bar).toFixed(1);
  const total = P.form.reduce((a, s) => a + P.sections[s].bars, 0),
    looped = P.form.slice(P.loop).reduce((a, s) => a + P.sections[s].bars, 0);
  console.log(`\n${name}: ${nn(P.key)} ${written.mode}, ${P.beats} to the bar, a bar is ${P.bar.toFixed(2)} s; ${P.form.join(' ')} = ${total} bars, ${secs(total)} s; repeats ${secs(looped)} s`);
  console.log(`  players: ${P.tracks.map((t) => `${t.name}${t.from ? ' >' + t.from : ''}`).join(', ')}`);
  for (const sn of Object.keys(P.sections)) {
    const S = P.sections[sn];
    if (!P.form.includes(sn)) {
      looks++;
      console.log(`  look  ${sn}: written but not in the form`);
    }
    const by = new Map();
    for (const n of S.notes) {
      if (!by.has(n.tr)) by.set(n.tr, []);
      by.get(n.tr).push(n);
    }
    if (only) console.log(`  ${sn} (${S.bars} bars)  ${S.chords.map((c) => c.ch.sym).join(' ')}`);
    for (const [ti, notes] of by) {
      const tr = P.tracks[ti],
        where = `${sn}.${tr.name}`;
      if (tr.inst === 'kit') {
        if (only) console.log(`    ${tr.name.padEnd(8)} ${notes.length} strokes: ${[...new Set(notes.map((n) => n.k))].join(' ')}`);
        continue;
      }
      const [lo, hi] = REACH[tr.inst] || [0, 127];
      for (const n of notes) {
        if (n.m < lo || n.m > hi) {
          bad++;
          console.log(`  FAIL  ${where}: ${nn(n.m)} in bar ${Math.floor(n.at) + 1} is out of reach of a ${tr.inst} (${nn(lo)} to ${nn(hi)})`);
        }
      }
      if (only) {
        const lineOut = [];
        let bar = -1;
        for (const n of notes) {
          if (Math.floor(n.at + 1e-9) !== bar) {
            bar = Math.floor(n.at + 1e-9);
            lineOut.push('|');
          }
          lineOut.push(nn(n.m));
        }
        console.log(`    ${tr.name.padEnd(8)} ${lineOut.join(' ')}`);
      }
      if (n_auto(notes)) continue;
      // a note that leans: on a strong beat, held at least a beat, and not in the chord
      for (const n of notes) {
        const beatsLong = n.len * P.beats * (P.beats === 6 ? 1 / 3 : 1);
        if (n.acc >= 0.9 && beatsLong >= 0.99 && LINES.has(tr.inst) && !n.ch.pcs.includes(mod12(n.m - P.key))) {
          looks++;
          console.log(`  look  ${where}: ${nn(n.m)} leans on ${n.ch.sym} in bar ${Math.floor(n.at) + 1}`);
        }
      }
      if (LINES.has(tr.inst))
        for (let i = 1; i < notes.length; i++) {
          const leap = Math.abs(notes[i].m - notes[i - 1].m);
          if (leap > 12 && notes[i].at - (notes[i - 1].at + notes[i - 1].len) < 0.5) {
            looks++;
            console.log(`  look  ${where}: a leap of ${leap} semitones into bar ${Math.floor(notes[i].at) + 1}`);
          }
        }
    }
    // two written lines sounding a semitone (or a major seventh, or a minor ninth) apart for a beat or more
    const lines = [...by].filter(([ti, notes]) => LINES.has(P.tracks[ti].inst) && !n_auto(notes));
    for (let a = 0; a < lines.length; a++)
      for (let b = a + 1; b < lines.length; b++)
        for (const x of lines[a][1])
          for (const y of lines[b][1]) {
            const over = Math.min(x.at + x.len, y.at + y.len) - Math.max(x.at, y.at);
            const iv = mod12(x.m - y.m);
            if (over * P.beats >= 0.99 && (iv === 1 || iv === 11)) {
              looks++;
              console.log(`  look  ${sn}: ${P.tracks[lines[a][0]].name} ${nn(x.m)} against ${P.tracks[lines[b][0]].name} ${nn(y.m)} in bar ${Math.floor(Math.max(x.at, y.at)) + 1}`);
            }
          }
  }
}
function n_auto(notes) {
  return notes.length > 0 && notes.every((n) => n.auto);
}
console.log(bad ? `\n${bad} FAILED` : `\nthe score can be played${looks ? `; ${looks} places to look at` : ''}`);
process.exit(bad ? 1 : 0);
