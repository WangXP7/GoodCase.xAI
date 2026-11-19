// Canonical feature-flag ids and defaults for Tiny World Builder.
// Client mirror: engine/world/00b-feature-flags.js (keep ids in sync).

export const FEATURE_FLAG_IDS = [
  'ai',
  'settings',
  'meshBuilding',
  'stamps',
  'movableMap',
  'buildBrush',
  'sunSlider',
  'weather',
  'elapsingTime',
  'generatePrompt',
  'spotlights',
  'connections',
  'lamps',
  'lava',
  'developerSettings',
  'playersMenu',
  'partyCreation',
  'playerSearch',
  'settingsWorkspace',
  'settingsRendering',
  'settingsWorld',
  'settingsMaterials',
  'settingsEnvironment',
  'settingsCrowd',
  'settingsAi',
  'thirdPersonView',
];

export const FEATURE_FLAG_META = {
  ai: { label: 'AI', hint: 'Agent chat, AI settings tab, and AI-backed tools' },
  settings: { label: 'Settings', hint: 'Settings modal and toolbar button' },
  meshBuilding: { label: 'Mesh Building', hint: 'Mesh terrain sculptor tool' },
  stamps: { label: 'Stamps', hint: 'Stamp browser and toolbar button' },
  movableMap: { label: 'Movable Map', hint: 'Draggable minimap (top-right under nav)' },
  buildBrush: { label: 'Build Brush', hint: 'Brush shape dock and toolbar' },
  sunSlider: { label: 'Sun Setting Slider', hint: 'Directional sun strength control' },
  weather: { label: 'Weather', hint: 'Weather pills and intensity in time popup' },
  elapsingTime: { label: 'Elapsing Time', hint: 'Live UK/BST time progression' },
  generatePrompt: { label: 'Generate from Prompt', hint: 'Separate AI world generator menu' },
  spotlights: { label: 'Spotlights', hint: 'Spotlight placement tool' },
  connections: { label: 'Connections', hint: 'Mooring / connect tool' },
  lamps: { label: 'Lamps', hint: 'Lamp-post placement tool' },
  lava: { label: 'Lava', hint: 'Lava terrain tool' },
  developerSettings: { label: 'Developer Settings', hint: 'Account → Developer (API keys, webhooks)' },
  playersMenu: { label: 'Players Menu', hint: 'Account → Players tab' },
  partyCreation: { label: 'Party Creation', hint: 'Create party inside Players tab' },
  playerSearch: { label: 'Player Search', hint: 'Find players inside Players tab' },
  settingsWorkspace: { label: 'Settings · Workspace', hint: 'Workspace tab inside Settings' },
  settingsRendering: { label: 'Settings · Rendering', hint: 'Rendering tab inside Settings' },
  settingsWorld: { label: 'Settings · World', hint: 'World tab inside Settings' },
  settingsMaterials: { label: 'Settings · Materials', hint: 'Materials tab inside Settings' },
  settingsEnvironment: { label: 'Settings · Environment', hint: 'Environment tab inside Settings' },
  settingsCrowd: { label: 'Settings · Crowd', hint: 'Crowd tab inside Settings' },
  settingsAi: { label: 'Settings · AI', hint: 'AI config tab inside Settings' },
  thirdPersonView: { label: 'Third-person View', hint: 'Third-person walk camera option in the view picker' },
};

export const DEFAULT_FEATURE_FLAGS = {
  ai: { everyone: false, admin: false },
  settings: { everyone: false, admin: true },
  meshBuilding: { everyone: false, admin: false },
  stamps: { everyone: false, admin: false },
  movableMap: { everyone: false, admin: false },
  buildBrush: { everyone: false, admin: false },
  sunSlider: { everyone: false, admin: false },
  weather: { everyone: false, admin: false },
  elapsingTime: { everyone: false, admin: false },
  generatePrompt: { everyone: false, admin: false },
  spotlights: { everyone: false, admin: false },
  connections: { everyone: false, admin: false },
  lamps: { everyone: false, admin: false },
  lava: { everyone: false, admin: false },
  developerSettings: { everyone: false, admin: false },
  playersMenu: { everyone: false, admin: false },
  partyCreation: { everyone: false, admin: false },
  playerSearch: { everyone: false, admin: false },
  settingsWorkspace: { everyone: false, admin: false },
  settingsRendering: { everyone: false, admin: false },
  settingsWorld: { everyone: false, admin: false },
  settingsMaterials: { everyone: false, admin: false },
  settingsEnvironment: { everyone: false, admin: false },
  settingsCrowd: { everyone: false, admin: false },
  settingsAi: { everyone: false, admin: false },
  thirdPersonView: { everyone: false, admin: false },
};

function cleanFlagEntry(raw, fallback) {
  const base = fallback && typeof fallback === 'object' ? fallback : { everyone: true, admin: true };
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    everyone: Object.prototype.hasOwnProperty.call(src, 'everyone') ? src.everyone === true : base.everyone === true,
    admin: Object.prototype.hasOwnProperty.call(src, 'admin') ? src.admin === true : base.admin === true,
  };
}

export function sanitizeFeatureFlags(input) {
  const source = input && typeof input === 'object' ? input : {};
  const rawFlags = source.flags && typeof source.flags === 'object' ? source.flags : source;
  const flags = {};
  for (const id of FEATURE_FLAG_IDS) {
    flags[id] = cleanFlagEntry(rawFlags[id], DEFAULT_FEATURE_FLAGS[id]);
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    flags,
  };
}

export function isFeatureFlagEnabled(flags, id, isAdmin) {
  const bag = flags && typeof flags === 'object' ? flags : {};
  const entry = bag[id] || DEFAULT_FEATURE_FLAGS[id];
  if (!entry) return true;
  return !!(entry.everyone || (entry.admin && isAdmin));
}

export function featureFlagsDto(doc, isAdmin) {
  const clean = sanitizeFeatureFlags(doc || {});
  const enabled = {};
  for (const id of FEATURE_FLAG_IDS) {
    enabled[id] = isFeatureFlagEnabled(clean.flags, id, isAdmin);
  }
  return {
    version: clean.version,
    updatedAt: clean.updatedAt,
    flags: clean.flags,
    enabled,
    meta: FEATURE_FLAG_META,
    ids: FEATURE_FLAG_IDS,
  };
}