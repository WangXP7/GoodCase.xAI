// FROZEN contract (owner: orchestrator): what counts as progress in Pop-up Atlas.
// SCRAPS: small paper collectables lying on the page, one kind per biome plus a rare night-only one.
export const SCRAPS = {
  leaf: { biome: 'heartland', name: 'Pressed leaf' },
  shell: { biome: 'desert', name: 'Fossil shell' },
  snowflake: { biome: 'snow', name: 'Paper snowflake' },
  petal: { biome: 'blossom', name: 'Pressed blossom' },
  feather: { biome: 'pinewood', name: 'Owl feather' },
  star: { biome: null, name: 'Paper star', night: true },
};
export const SCRAP_IDS = Object.keys(SCRAPS);
