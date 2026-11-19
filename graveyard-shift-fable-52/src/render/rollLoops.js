// Loops a shader compiler cannot unroll. Direct3D's compiler (FXC, behind every WebGL page on
// Windows) unrolls every loop with a constant bound and inlines every call inside it, so a few
// nested noise loops grow into minutes of compile (the effects atlas took 99 s and 196 s; with the
// bounds made unknown at compile time, 7 s and 14 s). rollLoops turns `i < 5` into `i < 5 + uRoll`
// (and `x < 4.0` into `x < 4.0 + uRollF`) with both uniforms 0: the same iterations doing the same
// arithmetic, in a loop that stays a loop. A loop whose body takes an implicit derivative
// (texture(), dFdx, dFdy, fwidth) is left alone: Direct3D must unroll those, and with an unknown
// bound it cannot.
export const ROLL_UNIFORMS = () => ({ uRoll: { value: 0 }, uRollF: { value: 0 } });
const DECL = 'uniform int uRoll;\nuniform float uRollF;';

const LOOP = /for \((int|float) (\w+) = (-?[\w.]+); \2 (<|<=) ([\w.]+); \2\+\+\)/g;
const DERIVATIVE = /\b(texture|texture2D|textureProj|textureOffset|dFdx|dFdy|fwidth)\s*\(/;

// The text a loop header governs: up to the brace that closes its first block, or to the end of
// its statement when no block opens first (a one-line body).
function bodyAfter(src, from) {
  const brace = src.indexOf('{', from);
  const semi = src.indexOf(';', from);
  if (brace < 0 || (semi >= 0 && semi < brace)) return src.slice(from, semi + 1);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

// Returns { src, count, kept } (kept: loops left as they were because they take derivatives).
// The uniforms are declared after the source's precision statements, or first when its precision
// comes from a header put in front of it.
export function rollLoops(src) {
  let count = 0; let kept = 0;
  const out = src.replace(LOOP, (m, type, v, a, op, b, at) => {
    if (DERIVATIVE.test(bodyAfter(src, at + m.length))) { kept++; return m; }
    count++;
    return `for (${type} ${v} = ${a}; ${v} ${op} ${b} + ${type === 'int' ? 'uRoll' : 'uRollF'}; ${v}++)`;
  });
  if (!count) return { src, count, kept };
  const lines = out.split('\n');
  let at = -1;
  for (let i = 0; i < lines.length; i++) { if (/^\s*precision\s/.test(lines[i])) at = i; else if (at >= 0 && lines[i].trim()) break; }
  lines.splice(at + 1, 0, DECL);
  return { src: lines.join('\n'), count, kept };
}
