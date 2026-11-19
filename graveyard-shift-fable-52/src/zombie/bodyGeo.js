// The wardrobe of one sculpt (a sex and a build): every cage, the eyes and mouth parts, every hair
// style and every garment of every variant, near level and far level, in one set of vertex
// buffers. A zombie's geometry is only an index buffer over it: the shells its look wears.
import { buildFigure, FACES } from './sculpt/figure.js';
import { MeshBuf, buildBodyCages } from './sculpt/cage.js';
import { buildEyes, buildMouth, buildCore } from './eyes.js';
import { buildHair } from './hair.js';
import { buildGarments } from './garments.js';

// skin that is always drawn, and skin a look may leave out
export const SKIN_ALWAYS = ['head', 'handL', 'handR', 'eyes', 'mouth', 'teeth', 'core'];
export const SKIN_BODY = ['torso', 'armL', 'armR', 'legL', 'legR'];
// the cages the bake draws (left side only: the right shares its rectangles)
export const BAKE_SHELLS = ['head', 'earL', 'torso', 'armL', 'handL', 'legL', 'footL'];

function level(fig, q, faces) {
  const mesh = new MeshBuf();
  const info = buildBodyCages(mesh, fig, q, faces);
  buildEyes(mesh, q);
  if (q >= 1) buildMouth(mesh, info.mouth, q);
  buildCore(mesh, fig, q);
  buildHair(mesh, fig, q);
  const garments = buildGarments(mesh, fig, q);
  return { m: mesh.finish(), garments };
}

export function buildWardrobe(sex, build) {
  const fig = buildFigure(sex, build);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  // the other faces of this sex and build: a head shell each at the near level; far away one head serves all
  const faces = [];
  for (let k = 1; k < FACES; k++) faces.push(buildFigure(sex, build, k));
  const n = level(fig, 1, faces), f = level(fig, 0.5, null);
  for (let k = 1; k < FACES; k++) f.m.shells.set(`head${k}`, f.m.shells.get('head'));
  const cat = (key, A) => { const a = new A(n.m[key].length + f.m[key].length); a.set(n.m[key], 0); a.set(f.m[key], n.m[key].length); return a; };
  return {
    fig, sex, build,
    arrays: { position: cat('position', Float32Array), normal: cat('normal', Float32Array), uv: cat('uv', Float32Array), skinIndex: cat('skinIndex', Uint16Array), skinWeight: cat('skinWeight', Float32Array), aSurf: cat('aSurf', Float32Array) },
    near: n.m.shells, far: f.m.shells, farBase: n.m.count, count: n.m.count + f.m.count,
    garments: n.garments,
    ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
  };
}

// What the bake draws: the near skin cages of a wardrobe, one region per cage.
export function bakeAtlasOf(w, size) {
  const idx = [], regions = [];
  for (const name of BAKE_SHELLS) {
    const l = w.near.get(name);
    if (!l) continue;
    regions.push([idx.length, l.length]);
    for (const v of l) idx.push(v);
  }
  return { size, position: w.arrays.position, normal: w.arrays.normal, uv: w.arrays.uv, index: new Uint32Array(idx), regions };
}
