# TinyWorld MMO Core

This package is the extraction layer for turning the current TinyWorld "worlds"
runtime into a fuller multiplayer MMO economy. It combines:

- the TinyWorld economy guide at `/Users/jkneen/Downloads/tinyworld_economy_guide.pdf`;
- the World of ClaudeCraft architecture pass: server authority, command/input
  separation, interest snapshots, personal/world events, and durable persistence;
- the TinyWorld code that already exists in `party/index.js`,
  `engine/world/47-worlds-room.js`, `engine/world/48-worlds-harvest-hud.js`,
  `netlify/functions/worlds.mjs`, and `netlify/functions/world-resources.mjs`.

The package is dependency-free ESM so it can be imported by Node, Netlify
Functions, PartyKit, and tests without adding a bundler to TinyWorld.

## What This Pulls Over From World Of ClaudeCraft

TinyWorld should not copy World of ClaudeCraft wholesale. The reusable parts are
the multiplayer contracts:

- one authoritative simulation boundary;
- client sends movement intent and commands, never final outcomes;
- server validates commands and emits personal events plus nearby world events;
- snapshots use full identity on first sight, lite dynamic updates afterward,
  and `keep` markers for unchanged visible entities;
- durable state is saved behind the server boundary, not trusted from the
  browser.

`src/multiplayer.js` provides the first portable pieces: `createWorldJoinMessage`,
`createMovementIntent`, `createCommandMessage`, and `buildInterestSnapshot`.

## What This Implements From The Economy Guide

The guide's safest MVP is:

- `$TINYWORLD` is a public Solana token held by players.
- `GOLD` is non-withdrawable gameplay spending power.
- islands are scarce ownable assets, eventually represented by Solana NFTs.
- internal resources stay off chain.
- taxes are paid in internal resources, not passive token yield.
- official marketplace settlement can take fees; wallet-to-wallet transfers stay
  open and are recognized by ownership sync.

`src/economy.js` implements the pure mechanics that should be shared by API and
room code:

- tiered or square-root GOLD allowance calculation;
- weekly/daily/seasonal cycle IDs;
- append-only GOLD ledger event helpers;
- GOLD spend checks;
- island tax clamping with the guide's recommended `20%` cap;
- resource ledger event creation for harvester and island owner payouts.

## How It Fits TinyWorld Today

TinyWorld already has most of the scaffolding:

- `party/index.js` is the authoritative per-world room for movement, harvesting,
  live entity relay, hearts, cooldowns, and resource/tax accrual.
- `netlify/functions/world-resources.mjs` persists whole-unit resources and tax
  payouts from PartyKit.
- `netlify/functions/worlds.mjs` signs world-room join tokens and owns world
  save/publish permissions.
- `netlify/database/migrations/20260607120000_worlds_economy.sql` already has
  `worlds`, `player_resources`, `tax_ledger`, `world_claims`,
  `world_market_listings`, and `world_economy_state`.

The important correction from the guide is tax policy. The current migration and
PartyKit code allow `tax_percent` up to `100`; this package makes the target
policy `0..20%`, default `5%`, with a 24-hour change cooldown. Wiring that into
the database and UI is the next runtime change.

## Recommended Integration Phases

1. Import the package into `party/index.js` for `applyIslandTax` / tax caps and
   into Netlify Functions for shared policy constants.
2. Add a `gold_ledger_events` migration and `/api/me/gold`, using wallet balance
   reads plus owned islands/rank/quest/NFT inputs to calculate allowance.
3. Add a chain ownership projection for island NFTs and item NFTs; revalidate
   sensitive island admin actions against chain ownership.
4. Move high-frequency room state toward the ClaudeCraft contract: fixed tick,
   input intents, command routing, interest snapshots, and personal reward
   events.
5. Add crafting/resource sinks and marketplace flows: GOLD spend, recipe outputs,
   rare NFT mint intents, official listing fees, and transaction confirmation.

See `src/integration-plan.js` for a machine-readable version of this plan.
