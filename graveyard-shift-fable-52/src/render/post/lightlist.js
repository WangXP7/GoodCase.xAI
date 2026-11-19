// The lamps that matter to an effect this frame. Reads the lights module's fixture list
// (G.lights.fixtures: every registered lamp, slotted or not) and keeps the best `max` by a score the
// caller supplies, without allocating. Falls back to the pooled records (G.lights.shadowed /
// unshadowed) if the fixture list is not there. Used by the volumetric cones, the flare and the rain.
import { Vector3 } from 'three';

// The part of a spot's light that shows in rain and damp air. The level's lamps spread light over
// 55 to 75 degrees so the ground is evenly lit; what reads as a cone is the hot core (three's
// cone * (1 - penumbra)), and around it a much fainter skirt of spill light, in which columns,
// pumps and cars cast their shadows.
//   beam   half angle = core + spread of the penumbra (+ pad), at most max; its edge is soft over
//          the outer (1 - core) of that angle, so the cone has an edge you can see.
//   skirt  half angle = core + skirt of the penumbra, at most skirtMax; skirtGain of the beam's
//          brightness (0 = no skirt).
// Shared so the rain glitters in the same cones the air shows. Change the fields at run time; they
// are read at every gather.
export const BEAM = { spread: 0.1, pad: 0, max: 0.64, core: 0.45, skirt: 0.8, skirtMax: 1.05, skirtGain: 0.25 };

const makeItem = () => ({
  pos: new Vector3(), dir: new Vector3(0, -1, 0), r: 0, g: 0, b: 0,
  intensity: 0, // scene candela, flicker included
  range: 0, cosOuter: -2, cosInner: -1.5, // points: (-2, -1.5), so smoothstep(outer, inner, x) is always 1
  spot: false,
  cosVisOuter: -2, cosVisInner: -1.5, visAngle: 0, // the visible beam (BEAM above); visAngle = its half angle, 0 for points
  cosSkirt: -2, skirtAngle: 0, // the faint skirt around it
  groundY: 0, // height of the ground the lamp stands over
  ref: null, // the fixture (or pooled record) this came from: a stable identity across frames
  shadowShare: 0, // 0..1 of this lamp currently carried by a shadow-casting slot (the marched shafts draw that part)
  score: 0,
});

export function createLightList(G, max) {
  const items = Array.from({ length: max }, makeItem);
  const cur = makeItem();
  const list = { items, count: 0, gather };

  function offer(score) {
    if (!(score > 0)) return;
    let n = list.count;
    if (n === max && items[n - 1].score >= score) return;
    if (n < max) list.count = ++n;
    let i = n - 1;
    const spare = items[i];
    while (i > 0 && items[i - 1].score < score) { items[i] = items[i - 1]; i--; }
    items[i] = spare;
    spare.pos.copy(cur.pos); spare.dir.copy(cur.dir);
    spare.r = cur.r; spare.g = cur.g; spare.b = cur.b;
    spare.intensity = cur.intensity; spare.range = cur.range;
    spare.cosOuter = cur.cosOuter; spare.cosInner = cur.cosInner;
    spare.cosVisOuter = cur.cosVisOuter; spare.cosVisInner = cur.cosVisInner; spare.visAngle = cur.visAngle; spare.ref = cur.ref;
    spare.cosSkirt = cur.cosSkirt; spare.skirtAngle = cur.skirtAngle; spare.groundY = cur.groundY;
    spare.spot = cur.spot; spare.shadowShare = cur.shadowShare; spare.score = score;
  }

  function shape(spot, cone, penumbra) {
    cur.spot = spot;
    if (spot) {
      cur.cosOuter = Math.cos(cone);
      cur.cosInner = Math.max(Math.cos(cone * (1 - (penumbra || 0))), cur.cosOuter + 1e-3);
      const inner = cone * (1 - (penumbra || 0));
      const vis = Math.min(cone, inner + BEAM.spread * (cone - inner) + BEAM.pad, BEAM.max);
      cur.visAngle = vis;
      cur.cosVisOuter = Math.cos(vis);
      cur.cosVisInner = Math.max(Math.cos(vis * BEAM.core), cur.cosVisOuter + 1e-3);
      const skirt = Math.max(vis, Math.min(cone, inner + BEAM.skirt * (cone - inner), BEAM.skirtMax));
      cur.skirtAngle = skirt;
      cur.cosSkirt = Math.cos(skirt);
    } else { cur.cosOuter = -2; cur.cosInner = -1.5; cur.cosVisOuter = -2; cur.cosVisInner = -1.5; cur.visAngle = 0; cur.cosSkirt = -2; cur.skirtAngle = 0; }
  }

  // scoreFn(light) -> number; <= 0 drops the light. Returns the list ({ items, count }), best first.
  function gather(scoreFn) {
    list.count = 0;
    const L = G.lights;
    if (!L || L.stub) return list;
    if (Array.isArray(L.fixtures)) {
      for (const fx of L.fixtures) {
        if (!fx.enabled || !(fx.candela > 0)) continue;
        cur.pos.copy(fx.pos); cur.dir.copy(fx.dir);
        cur.r = fx.color.r; cur.g = fx.color.g; cur.b = fx.color.b;
        cur.intensity = fx.candela * (fx.gain ?? 1);
        cur.range = fx.range;
        cur.groundY = Number.isFinite(fx.groundY) ? fx.groundY : 0;
        shape(fx.type === 'spot', fx.cone, fx.penumbra);
        const slot = fx.slots && fx.slots.shadow;
        cur.shadowShare = slot ? Math.min(1, Math.max(0, slot.fade)) : 0;
        cur.ref = fx;
        offer(scoreFn(cur));
      }
      return list;
    }
    const groups = [L.shadowed, L.unshadowed];
    for (let k = 0; k < 2; k++) {
      if (!Array.isArray(groups[k])) continue;
      for (const rec of groups[k]) {
        if (!rec || !(rec.intensity > 0)) continue;
        cur.pos.copy(rec.pos); cur.dir.copy(rec.dir);
        cur.r = rec.color.r; cur.g = rec.color.g; cur.b = rec.color.b;
        cur.intensity = rec.intensity; cur.range = rec.range; cur.groundY = 0;
        shape(rec.type === 'spot', rec.cone, rec.penumbra);
        cur.shadowShare = k === 0 ? 1 : 0;
        cur.ref = rec;
        offer(scoreFn(cur));
      }
    }
    return list;
  }
  return list;
}

// Height-fog numbers every effect here agrees on. fog = G.sky.fog (or nothing).
export function readFog(G, out) {
  const f = G.sky && G.sky.fog;
  out.density = f && typeof f.density === 'number' ? f.density : 0;
  out.falloff = f && typeof f.heightFalloff === 'number' ? f.heightFalloff : 0;
  if (f && f.color) { out.r = f.color.r; out.g = f.color.g; out.b = f.color.b; } else { out.r = 0.012; out.g = 0.014; out.b = 0.02; }
  return out;
}

// GLSL: optical depth of the height fog along a ray (closed form), shared by every shader that fogs.
export const FOG_GLSL = /* glsl */ `
uniform float uFogDensity;
uniform float uFogFalloff;
float fogOpticalDepth(float originY, float dirY, float t) {
  float x = uFogFalloff * dirY * t;
  float k = abs(x) < 1e-3 ? 1.0 - 0.5 * x : (1.0 - exp(-x)) / x;
  return uFogDensity * exp(-uFogFalloff * max(originY, 0.0)) * t * k;
}
`;
