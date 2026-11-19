// The upgraded look (the bench's one tier): the finish, its colours, and the upgraded tracer's colour.
//
// Every model calls upgradeFinish(model, upgraded, G, patch) from its finish(upgraded). The finish
// itself is drawn by the viewmodel's material patch (viewmodel.js): the steel turns to a tinted
// mirror that runs from one of the weapon's two colours to the other along its length, the
// furniture goes to a near-black lacquer, and thin lit lines run the length of the gun with pulses
// of light travelling toward the muzzle. Here each material is told which of those it is (steel,
// furniture, or left alone: brass, hulls, sight dots), once per model. Long guns also get a
// stripe painted by hand round the barrel: a yellow band with a white one ahead of it, in
// road-marking paint, shown only while upgraded. Nothing is rebuilt per call.
import { Mesh } from 'three';
import { lathe } from '../geo.js';

// scene-linear tint of a stock tracer, and of an upgraded one whose weapon is not known (fx/combat.js draws them;
// an upgraded round of a known weapon flies in upgradeLook(id).tracer)
export const TRACER_COLOR = { warm: [1, 0.62, 0.28], violet: [0.62, 0.34, 1] };

// Each upgraded weapon's own colours, scene-linear: `a` the lines and the rear of the steel, `b`
// the pulses and the muzzle end, `flash` the muzzle flame's body and core, `tracer` its rounds.
const look = (a, b, tracer = b) => ({ a, b, tracer, flash: [[a[0] * 0.9 + 0.1, a[1] * 0.9 + 0.05, a[2] * 0.9 + 0.05], [b[0] * 0.5 + 0.5, b[1] * 0.5 + 0.5, b[2] * 0.5 + 0.5]] });
export const UPGRADE_LOOK = {
  pistol: look([1.0, 0.55, 0.08], [0.55, 0.85, 1.0], [1.0, 0.7, 0.25]), // Night Owl: amber eyes, a cold moon
  revolver: look([1.0, 0.08, 0.22], [1.0, 0.5, 0.2]), // Last Call: neon red, a warm filament
  pump: look([0.25, 1.0, 0.12], [0.9, 1.0, 0.3]), // Deadfall: sap green
  autoShotgun: look([0.1, 0.75, 1.0], [0.85, 0.97, 1.0]), // Squall: storm cyan and white
  smg: look([1.0, 0.1, 0.75], [0.45, 0.4, 1.0]), // Whiplash: magenta into blue
  rifle: look([0.42, 0.22, 1.0], [0.2, 0.75, 1.0]), // Long Night: violet into dawn blue
  battleRifle: look([1.0, 0.62, 0.1], [1.0, 0.92, 0.6]), // Iron Vigil: forge gold
  lmg: look([0.05, 0.9, 0.7], [0.2, 0.45, 1.0]), // Undertow: deep teal into blue
  jumper: look([0.2, 0.45, 1.0], [0.5, 0.8, 1.0], [0.75, 0.9, 1.0]), // Jump Lead: arc blue
  flare: look([1.0, 0.2, 0.05], [1.0, 0.8, 0.3]), // Signal Fire: flare red into yellow
};
const FALLBACK = look([0.62, 0.34, 1], [0.3, 0.8, 1], TRACER_COLOR.violet);
export const upgradeLook = (id) => UPGRADE_LOOK[id] || FALLBACK;
// What each material name on the models (models/*.js) is to the finish: 1 steel, 2 furniture,
// 3 a moulded body (the Jumper's bright pack: dark paint in the weapon's colour; as a mirror its
// broad top face only ever showed the lamp overhead).
// A name that is not here is left as it is (brass, bullets, hulls, sight dots, roll marks).
export const FINISH_KIND = {
  slide: 1, ctrl: 1, blued: 1, mag: 1, steel: 1,
  orange: 1, // the flare gun's tube
  yellow: 3, red: 3, blue: 3, cell: 3,
  polymer: 2, panel: 2, wood: 2, magBase: 2, olive: 2, fiber: 2, black: 2,
};
// where the stripe goes, by weapon id: [z of its rear edge, z of its front edge, the barrel's radius there] in mm
const STRIPE = {
  pump: [-618, -650, 11.6], autoShotgun: [-584, -616, 11.6], rifle: [-418, -446, 9.4],
  battleRifle: [-598, -630, 8.6], lmg: [-524, -548, 9.6], flare: [-236, -262, 21],
};

function make(model, G, patch) {
  const mats = G.mats;
  const U = { stripe: null, kinds: 0 };
  // tell each material what it is (the viewmodel's patch gives a material `vmUp`, its own uniform)
  const seen = new Set();
  for (const mesh of model.meshes) {
    const mat = mesh.material, kind = FINISH_KIND[mesh.userData.mat];
    if (!mat || seen.has(mat)) continue;
    seen.add(mat);
    if (kind && mat.vmUp) { mat.vmUp.value = kind; U.kinds++; }
  }
  const s = STRIPE[model.id];
  if (s && model.parts && (model.parts.barrel || model.parts.recv)) {
    const [z0, z1, r] = s; const mid = z0 + (z1 - z0) * 0.62;
    const yellow = patch(mats.gunmetal({ finish: 'polymer', color: 0xc9a416, wear: 0.6, oil: 0, seed: 301, space: 'rest', shelter: 0.6 }), { rough: [1.1, 0.7] });
    const white = patch(mats.gunmetal({ finish: 'polymer', color: 0xc8c6ba, wear: 0.6, oil: 0, seed: 303, space: 'rest', shelter: 0.6 }), { rough: [1.1, 0.7] });
    const band = (a, b, mat) => {
      // a brushed band is not a clean ring: its edges wander a little
      const soup = lathe([[r + 0.05, b], [r + 0.3, b - 0.4], [r + 0.34, (a + b) / 2], [r + 0.3, a + 0.5], [r + 0.05, a]], { segs: 28 });
      const geo = soup.toGeometry();
      mats.bakeRest(geo, {});
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = -10; mesh.visible = false;
      mesh.userData.mat = 'stripe';
      return mesh;
    };
    const parent = model.parts.barrel || model.parts.recv;
    U.stripe = [band(z0, mid + 2, yellow), band(mid - 1.5, z1, white)];
    for (const m of U.stripe) {
      // a part with its own pivot holds its geometry relative to that pivot
      m.position.set(-parent.position.x, -parent.position.y, -parent.position.z);
      parent.add(m);
      model.meshes.push(m);
    }
  }
  return U;
}

export function upgradeFinish(model, upgraded, G, patch = (m) => m) {
  if (!model || !model.meshes) return;
  const U = model.upgradeMats || (model.upgradeMats = make(model, G, patch));
  model.upgraded = !!upgraded; // the viewmodel draws the finish on the weapon in the hands from this
  if (U.stripe) for (const m of U.stripe) m.visible = !!upgraded;
}
