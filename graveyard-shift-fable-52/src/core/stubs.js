// No-op stand-ins that satisfy each module's contract shape. Used (a) as the initial body of every
// not-yet-built module and (b) by main.js when a real factory throws. Every stub carries stub:true.
const noop = () => {};
const NO_SAFE = { top: 0, right: 0, bottom: 0, left: 0 };

export const stubs = {
  device: () => ({ stub: true, touch: false, coarse: false, phone: false, ios: false, inFrame: false, dpr: 1, portrait: false, safe: { ...NO_SAFE }, onChange: noop }),
  quality: () => ({ stub: true, preset: 'high', renderScale: 1 }),
  renderer: () => ({ stub: true }),
  lights: () => ({ stub: true, update: noop }),
  sky: () => ({ stub: true, update: noop }),
  mats: () => ({ stub: true }),
  post: () => ({ stub: true, render: noop }),
  level: () => ({
    stub: true,
    colliders: [],
    raycast: () => null,
    moveCapsule: (pos, _radius, _height, delta) => {
      const p = [pos[0] + delta[0], Math.max(0, pos[1] + delta[1]), pos[2] + delta[2]];
      return { pos: p, onGround: p[1] <= 0 };
    },
    bounds: { min: [-50, -1, -50], max: [50, 20, 50] },
    spawnPoints: [],
    playerStart: { pos: [0, 0, 0], yaw: 0 },
    interactables: [],
    shots: {},
    update: noop,
  }),
  nav: () => ({
    stub: true,
    buildGrid: () => ({ walkable: () => true }),
    createFlowField: () => ({ setTarget: noop, dir: () => [0, 0], dist: () => Infinity }),
  }),
  input: () => ({ stub: true, update: noop }),
  player: () => ({ stub: true, update: noop }),
  weapon: () => ({ stub: true, update: noop }),
  zombies: () => ({ stub: true, alive: 0, update: noop }),
  fx: () => ({ stub: true, update: noop }),
  audio: () => ({ stub: true, update: noop }),
  game: () => ({ stub: true, state: 'title', round: 0, points: 0, update: noop }),
  ui: () => ({ stub: true, update: noop }),
  hints: () => ({ stub: true, enabled: false, show: noop, dismiss: noop, seen: () => false, reset: noop, update: noop }),
};
