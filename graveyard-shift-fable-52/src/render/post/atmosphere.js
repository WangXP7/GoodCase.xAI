// Registers the atmosphere passes on a post chain: ambient occlusion, planar reflection, volumetric
// light and fog, lens flare, and the rain. One call from the chain's factory:
//
//   import { installAtmosphere } from './atmosphere.js';
//   installAtmosphere(G, post);   // after the built-in passes are added
//
// nopass tokens: ao, vol, flare, reflection, rain (the slot name `volumetrics` also drops the
// reflection, and `fx` drops the rain along with the particles). Each token switches off that pass only.
// The rain belongs to G.fx, which does not exist yet when the chain is built, so it is created on
// the first frame that finds G.fx, from a one-shot pass in the 'fx' slot; the rain's own pass is
// then added to that slot, after the particles.
import { createAo } from './ao.js';
import { createReflection } from './reflection.js';
import { createVolumetrics } from './volumetrics.js';
import { createFlare } from './flare.js';
import { createRain } from '../../fx/rain.js';

export function installAtmosphere(G, post) {
  post.addPass(createAo(G), 'ao');
  post.addPass(createReflection(G), 'volumetrics');
  post.addPass(createVolumetrics(G), 'volumetrics');
  post.addPass(createFlare(G), 'flare');
  const boot = post.addPass({
    name: 'rain-boot',
    render() {
      if (!G.fx || G.fx.stub) return;
      if (!G.fx.rain) createRain(G);
      boot.enabled = false;
    },
  }, 'fx');
}
