import * as THREE from 'three/webgpu';
import { createTreeField, TREE_SPECIES } from './trees.js';
import { blockAt, CITY } from './city-config.js';
import { createEnforcement } from './open-city-enforcement.js';
import { GEO } from './geodata.js';
import { treeColliders } from './street-colliders.js';

// js/open-city-details.js
// The street details of a city built from OpenStreetMap, built by main.js instead of street-details.js's New York
// furniture: the city's own trees (GEO.trees, an inventory such as NParks' for Singapore: tools/city/build.mjs), each
// where it stands on a sidewalk, median, verge or park lawn, grown to its height, its crown shape from its family
// (palms included; a shape without a model in js/trees.js isn't planted), and its road pricing gantries & traffic
// cameras (open-city-enforcement.js). Returns what main.js and the audio take from street-details.js: { group,
// footprints, signalClock, audioSignals, update(camera, player) }, and attach(network, audio) & notice(head, body,
// flash, chime) for the enforcement; colliders (the trees' trunks, the gantries' & cameras' poles) and, after
// attach, signalColliders() (the traffic lights' poles) for the player.

const SIDEWALK_Y = 0.22;
const LAWN_Y = 0.235;
// The tree models (mature trees, 10-13 m tall at scale 1) scale as a whole, leaf cards and all: below ~60% their crowns
// thin out to bare twigs, so the inventory's young & small trees grow to this height
const MIN_HEIGHT = 7.5;

function buildOpenCityDetails(scene) {
  const group = new THREE.Group();
  group.name = 'CityStreetDetails';
  const sites = [];
  const trees = GEO.trees;
  if (trees) {
    const speciesOf = trees.shapes.map((name) => TREE_SPECIES.findIndex((sp) => sp.name === name));
    let qx = 0;
    let qz = 0;
    for (let i = 0; i < trees.heights.length; i++) {
      qx += trees.xz[i * 2]; // dm, each a step from the tree before
      qz += trees.xz[i * 2 + 1];
      const species = speciesOf[trees.shape[i]];
      if (species < 0) continue;
      const x = qx / 10;
      const z = qz / 10;
      const height = Math.max(MIN_HEIGHT, trees.heights[i]);
      const b = blockAt(x, z);
      const park = !!b && b.park > 0.6;
      // draw distance: park trees and the tall ones furthest
      sites.push({ x, y: b ? (park ? LAWN_Y : SIDEWALK_Y) : 0, z, height, species, tier: park ? 0 : height >= 12 ? 1 : 2 });
    }
  }
  if (sites.length) group.add(createTreeField(scene, sites).group);
  const enforcement = createEnforcement(group, { keepLeft: CITY.driveSide === 'left' });
  // what the player bumps into (js/street-colliders.js): the trees' trunks, the gantries' & cameras' poles, and once
  // the traffic network is attached, its signal poles
  const colliders = [...treeColliders(sites), ...(enforcement ? enforcement.colliders : [])];
  scene.add(group);
  console.info(`[cityDetails] ${sites.length} trees${trees ? ` (${trees.credit})` : ''}`);
  const signalClock = { value: 0 }; // main.js keeps it at the traffic's time
  return {
    group,
    footprints: [],
    colliders,
    signalColliders: () => (enforcement ? enforcement.signalColliders() : []),
    signalClock,
    audioSignals: [],
    update: enforcement ? (camera, player) => enforcement.update(signalClock.value, player) : null,
    attach: enforcement ? (network, audio) => enforcement.attach(network, audio) : null,
    notice: enforcement ? enforcement.notice : null
  };
}

export { buildOpenCityDetails };
