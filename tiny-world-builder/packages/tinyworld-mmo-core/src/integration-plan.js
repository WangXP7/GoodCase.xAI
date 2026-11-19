import { CLAUDECRAFT_SNAPSHOT_PATTERN } from './multiplayer.js';
import { DEFAULT_ECONOMY_POLICY, ECONOMY_SAFETY_RULES } from './economy.js';

export const TINYWORLD_EXISTING_SURFACES = Object.freeze([
  Object.freeze({
    path: 'party/index.js',
    role: 'Authoritative PartyKit room for shared building, world-room movement, harvests, resource splits, and live entity relays.',
  }),
  Object.freeze({
    path: 'engine/world/47-worlds-room.js',
    role: 'Browser world-room client for enter/leave, one-cell movement, harvest requests, chat, peer avatars, and live flight ghosts.',
  }),
  Object.freeze({
    path: 'engine/world/48-worlds-harvest-hud.js',
    role: 'In-world HUD for hearts, resources, owner/visitor role, tax visibility, harvest buttons, chat, and reward popups.',
  }),
  Object.freeze({
    path: 'netlify/functions/worlds.mjs',
    role: 'World list/detail/save/publish API plus signed PartyKit join tokens.',
  }),
  Object.freeze({
    path: 'netlify/functions/world-resources.mjs',
    role: 'Durable resource bank and owner tax payouts flushed by PartyKit with a service token.',
  }),
  Object.freeze({
    path: 'netlify/database/migrations/20260607120000_worlds_economy.sql',
    role: 'Current worlds, resources, tax ledger, claims, listings, and economy-state tables.',
  }),
]);

export const CLAUDECRAFT_PATTERNS_TO_PULL = Object.freeze([
  Object.freeze({
    pattern: 'Shared world interface',
    source: 'World of ClaudeCraft IWorld + ClientWorld split',
    tinyworldUse: 'Keep render/UI on a small world-room facade while PartyKit or a future Node server owns movement, harvest, combat, and reward outcomes.',
  }),
  Object.freeze({
    pattern: 'Intent streaming, not client authority',
    source: 'Client sends compact input/commands every 50ms; server ticks at 20 Hz',
    tinyworldUse: 'Move from one-cell commands toward input intents for surface-roam/combat while preserving server-side validation.',
  }),
  Object.freeze({
    pattern: 'Interest-scoped full/lite/keep snapshots',
    source: CLAUDECRAFT_SNAPSHOT_PATTERN.replication,
    tinyworldUse: 'Replace broad presence broadcasts with viewer-specific snapshots once worlds hold many avatars, bots, harvest nodes, projectiles, and vehicles.',
  }),
  Object.freeze({
    pattern: 'Personal events plus proximity events',
    source: 'Server routes pid events and nearby world events separately',
    tinyworldUse: 'Send GOLD/resource/quest rewards only to the actor; broadcast visible actions like mining, emotes, combat, and node changes by distance.',
  }),
  Object.freeze({
    pattern: 'Authoritative persistence boundary',
    source: 'Character JSONB snapshots plus server autosave',
    tinyworldUse: 'Keep durable island/world state in Netlify Database/Postgres and keep room-only timers, locks, hearts, and fractional tax accumulators ephemeral.',
  }),
]);

export const TINYWORLD_MMO_MVP_PHASES = Object.freeze([
  Object.freeze({
    id: 'phase-1-core-contracts',
    outcome: 'Adopt this package from PartyKit and Netlify Functions for GOLD allowance, tax caps, ledger events, and snapshot contracts.',
    files: ['party/index.js', 'netlify/functions/world-resources.mjs', 'netlify/functions/worlds.mjs'],
  }),
  Object.freeze({
    id: 'phase-2-gold-ledger',
    outcome: 'Add gold_ledger_events and expose /api/me/gold using wallet-held $TINYWORLD, owned islands, rank, quest, and NFT inputs.',
    files: ['netlify/database/migrations/*gold*.sql', 'netlify/functions/wallet.mjs', 'netlify/functions/world-resources.mjs'],
  }),
  Object.freeze({
    id: 'phase-3-chain-ownership-projection',
    outcome: 'Introduce an indexer projection for island NFT ownership and item NFT ownership; use fresh chain checks before sensitive island admin actions.',
    files: ['netlify/functions/lib/solana.mjs', 'netlify/functions/worlds.mjs', 'netlify/functions/world-claim.mjs'],
  }),
  Object.freeze({
    id: 'phase-4-authoritative-world-engine',
    outcome: 'Lift PartyKit world-room state toward a ClaudeCraft-style simulation loop: fixed tick, input intents, command routing, interest snapshots, personal events.',
    files: ['party/index.js', 'engine/world/47-worlds-room.js'],
  }),
  Object.freeze({
    id: 'phase-5-marketplace-and-crafting',
    outcome: 'Add official marketplace listings, crafting recipes, spend-GOLD actions, rare NFT mint intents, and resource sinks without putting high-frequency gameplay on chain.',
    files: ['netlify/functions/world-economy.mjs', 'netlify/functions/world-claim.mjs', 'netlify/database/migrations/*.sql'],
  }),
]);

export const TINYWORLD_MMO_TARGET = Object.freeze({
  package: '@tinyworld/mmo-core',
  policy: DEFAULT_ECONOMY_POLICY,
  safetyRules: ECONOMY_SAFETY_RULES,
  sourceOfTruth: Object.freeze({
    tinyworldTokenBalance: 'Solana',
    islandOwnership: 'Solana NFT projection plus fresh chain verification for sensitive writes',
    nftItemOwnership: 'Solana NFT projection',
    goldAllowance: 'Backend calculation',
    goldSpent: 'Backend append-only ledger',
    internalResources: 'Backend append-only ledger/resource bank',
    movementCombatHarvest: 'Authoritative PartyKit room now, future Node simulation if load demands it',
    worldLayout: 'Netlify Database worlds.data plus live room refresh for active rooms',
  }),
  phases: TINYWORLD_MMO_MVP_PHASES,
});
