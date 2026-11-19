// One material per zombie: the character program of the mats library (G.mats.cloth with `slots`
// and `body`), which shades skin, eight garment slots, hair, eyes, teeth and gore in one draw from
// the baked maps. Geometry is shared between zombies, so everything that makes one differ from the
// next is a uniform here (or the choice of index ranges in body.js). Nothing patches shader text.
import { BackSide, DoubleSide } from 'three';

export function createZombieMaterials(G, look, maps) {
  const mat = G.mats.cloth({
    kind: 'canvas', seed: look.seed, dirt: look.dirt, blood: look.fresh,
    stripes: look.stripes || { y: [9, 9], halfWidth: 0, x: 0 }, slots: look.slots,
    body: { tint: look.tint, rot: look.rot, grime: look.grime, hair: look.hair, hairAmt: look.hairAmt, eye: look.eye, glow: look.glow, hat: look.hatShade || 0, maps },
    name: 'zombie',
  });
  mat.shadowSide = BackSide;
  const sm = G.mats.shadowMaterials ? G.mats.shadowMaterials(mat) : null;
  // Depth pre-pass. A dressed figure is two or three layers deep and every garment is drawn on both
  // sides, and a program that discards (torn cloth, hair cards) cannot have its hidden fragments
  // rejected before they are shaded while it also writes depth. So depth goes down first with the
  // cheap cut-only program, pushed back a hair, and the costly program runs with depth writes off.
  let pre = null;
  if (sm) {
    // the shadow caster is the far level, a coarser hull than the surface it shadows: push it away
    // from the light so the two never trade places (the round-1 stipple on flanks and garments)
    for (const m of [sm.depth, sm.distance]) { m.polygonOffset = true; m.polygonOffsetFactor = 2.5; m.polygonOffsetUnits = 8; }
    pre = sm.depth.clone();
    pre.onBeforeCompile = sm.depth.onBeforeCompile;
    pre.customProgramCacheKey = () => `${sm.depth.customProgramCacheKey()}:pre`;
    pre.defines = { ...sm.depth.defines, CHAR_PREPASS: 1 };
    pre.colorWrite = false; pre.side = DoubleSide;
    pre.polygonOffset = true; pre.polygonOffsetFactor = 1; pre.polygonOffsetUnits = 1;
    mat.depthWrite = false;
  }
  const u = mat.surf;
  return {
    char: mat, skin: mat, cloth: mat, depth: sm ? sm.depth : null, distance: sm ? sm.distance : null, prepass: pre,
    // uZWound / uZBlood are the names the first version of this file used
    uniforms: { ...u, uZWound: u.uChWound, uZBlood: u.uChBlood },
  };
}
