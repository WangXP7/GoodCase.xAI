# TinyWorld Economy Guide Trace

Source: `/Users/jkneen/Downloads/tinyworld_economy_guide.pdf`.

This is the implementation trace for the PDF, the existing TinyWorld code, and
the World of ClaudeCraft multiplayer architecture extraction. It is intentionally
stricter than the README: it separates implemented code, package contracts,
runtime gaps, and verification that still needs a real local stack.

## Current Non-Mock Evidence

- PDF content was extracted locally with `uv run --with pypdf`.
- TinyWorld existing runtime was inspected in `party/index.js`,
  `engine/world/47-worlds-room.js`, `engine/world/48-worlds-harvest-hud.js`,
  `netlify/functions/worlds.mjs`, `netlify/functions/world-resources.mjs`,
  `netlify/functions/world-claim.mjs`, `netlify/functions/world-economy.mjs`,
  `netlify/functions/wallet.mjs`, and the worlds economy migration.
- A real local Postgres database `tinyworld_mmo_codex` was created with the
  repo migrations: 19 migrations, 22 tables, 10 worlds.
- `netlify dev --offline --port 8888` was run locally. `/api/worlds` still
  returned 503 because the function worker connected to `template1` through the
  Netlify Database fallback instead of the migrated local DB.
- A real PartyKit dev server was run locally on `ws://localhost:1999`.
- A direct live WebSocket smoke against the actual PartyKit server passed:
  `world.join` produced `world.state`, ore node derivation worked, a real 5s
  `mine` harvest resolved, and the 10% tax split returned `2700` harvester milli
  and `300` owner milli.

## Part 1: Player Overview

Guide requirements:

- `$TINYWORLD` is the public Solana token.
- `GOLD` is non-withdrawable gameplay spending power.
- islands and selected assets may be owned and traded.
- internal resources stay off-chain unless converted into an on-chain asset.

TinyWorld status:

- Wallet linking and token balance refresh exist in `netlify/functions/wallet.mjs`.
- Internal resources exist as `fish`, `meat`, `plants`, and `ore` in
  `player_resources`.
- GOLD exists as a column in `player_resources`, but the allowance and ledger
  model is not implemented yet.

Package coverage:

- `DEFAULT_GOLD_TIERS`, `calculateGoldAllowance`, `createGoldLedgerEvent`,
  `reduceGoldLedger`, and `spendGold` encode the guide's GOLD model.

Runtime gap:

- Add a real `gold_ledger_events` table and `/api/me/gold`.
- Derive GOLD from backend-verified wallet balance, owned islands, rank, quest
  progress, NFT bonuses, and spent ledger events.

## Part 2: Islands And Land Ownership

Guide requirements:

- Islands are scarce ownable assets.
- On-chain NFT ownership is the final authority.
- Initial island sale must be atomic, not manual wallet send.
- Ownership changes move controls to the new owner.

TinyWorld status:

- `worlds` already models ownable worlds with `status`, `owner_profile_id`,
  `tax_percent`, `data`, and claim status.
- `world-claim.mjs` supports a quote/confirm sale path and verifies USDC transfer
  when on-chain verification is enabled.
- Signed join tokens in `worlds.mjs` decide `build`, `play`, or `observe`.

Runtime gap:

- `worlds.owner_profile_id` is still database ownership, not an NFT projection.
- Add island NFT mint fields and a chain ownership projection table.
- Revalidate sensitive island admin actions against current chain owner.

## Part 3: Island Taxes And Resource Economies

Guide requirements:

- Taxes should be paid in internal resources by default.
- Do not market islands as passive token yield.
- Suggested tax cap is 20%, default 5%, with a cooldown.

TinyWorld status:

- PartyKit already performs server-side resource harvests and owner tax splits.
- `world-resources.mjs` persists whole-unit resource grants and owner tax payouts.
- Current migration allows `tax_percent` from 1 to 100, which conflicts with the
  guide's recommended cap.

Package coverage:

- `DEFAULT_ECONOMY_POLICY.maxTaxRate` is `0.2`.
- `applyIslandTax` caps tax, exempts owner self-harvest, and creates miner/owner
  outputs.
- `createResourceLedgerEvents` emits append-style resource credit events.

Runtime gap:

- Migrate `worlds.tax_percent` to `0..20` or convert to basis points with a 20%
  cap.
- Add tax change cooldown state.
- Import shared policy into PartyKit and Netlify Functions so tax math is not
  duplicated.

## Part 4: NFTs And The On-Chain Ledger

Guide requirements:

- Chain stores token balances, island ownership, NFT item ownership, marketplace
  sales, and sale transactions.
- Backend stores GOLD, internal resources, quests, world layout, cooldowns, and
  session state.
- High-frequency gameplay stays off-chain.

TinyWorld status:

- `wallet.mjs` reads SPL token accounts through Solana RPC.
- `world-claim.mjs` verifies payment transactions.
- PartyKit holds ephemeral room state: movement, hearts, cooldowns, node locks,
  regrowth, animals, and fractional tax accumulators.

Runtime gap:

- Add chain indexer/projection tables:
  `island_ownership_snapshots`, `nft_assets`, `chain_transactions`,
  `marketplace_sales`.
- Add item NFT mint intents only for rare or transferable assets, not basic
  resources.

## Part 5: Economy Safety Rules

Guide requirements:

- No GOLD redemption.
- No bank-like deposits or pooled withdrawal balance.
- No guaranteed liquidity, returns, or passive income claims.
- Backend must not trust frontend balances, ownership, or settlement.

Package coverage:

- `ECONOMY_SAFETY_RULES` captures the policy language for code and UI review.
- GOLD helpers are allowance/ledger based, not mutable cash-balance based.

Runtime gap:

- Add API copy and UI copy that uses this language exactly.
- Reject client-provided token balances, island ownership, marketplace settlement,
  and GOLD totals.
- Keep transaction confirmation server-side.

## Part 6: Technical Architecture

Guide requirements:

- Frontend wallet UI, API server, chain indexer, game engine/simulation,
  database, WebSocket/SSE live updates.
- Source-of-truth split by data type.

TinyWorld status:

- Frontend: vanilla JS modules, Netlify Identity, Phantom wallet bridge.
- API: Netlify Functions.
- Live multiplayer: PartyKit.
- Database: Netlify Database/Postgres migrations.
- Game-room server: PartyKit world rooms, not a separate Node MMO server.

ClaudeCraft extraction:

- Use a shared world facade like `IWorld`.
- Send client intent and commands, not outcomes.
- Move from broad presence to interest-scoped full/lite/keep snapshots as worlds
  gain more entities.
- Route personal rewards separately from nearby world events.

Package coverage:

- `createWorldJoinMessage`, `createMovementIntent`, `createCommandMessage`, and
  `buildInterestSnapshot`.

Runtime gap:

- Integrate snapshot contracts into PartyKit once room entity count justifies it.
- Preserve `setCell()` for durable world edits; keep presence and room state out
  of saved world JSON.

## Part 7: Publishing-Friendly Summary

Implementation principle:

- `$TINYWORLD` is market token.
- `GOLD` is game utility.
- `ISLANDS` are ownable world assets.
- NFTs are optional player-owned items.
- Marketplace handles player-to-player settlement.
- Backend owns gameplay state.
- Blockchain owns ownership ledger.

TinyWorld status:

- This is not fully true yet. The current app has wallet, claim, worlds, resources,
  and PartyKit rooms, but no completed GOLD ledger or NFT ownership indexer.

## Part 8: Open Decisions

Must decide before production:

- SPL Token vs Token-2022.
- Transfer fee or no transfer fee. The guide recommends no transfer fee at launch.
- GOLD cadence: daily, weekly, or seasonal. Package default is weekly.
- GOLD allowance formula: tiered or square-root. Package supports both.
- Initial island sale format: fixed, auction, whitelist, or hybrid.
- Which assets become NFTs.
- Marketplace fee basis points.
- Tax cap and cooldown. Package target is 20%, 24h cooldown.

## Part 9: Recommended MVP

Recommended TinyWorld implementation sequence:

1. Keep $TINYWORLD wallet-held and non-custodial.
2. Add `/api/me/gold` using backend-verified wallet balance and ledger spend.
3. Add `gold_ledger_events`.
4. Cap island tax to 20% and add tax cooldown.
5. Keep PartyKit as authoritative room server for harvest/movement.
6. Add island NFT ownership projection before enabling true external island
   transfer support.
7. Add marketplace listings and transaction confirmation.
8. Add crafting/resource sinks that spend GOLD and internal resources.
9. Add rare NFT mint intents only for selected outputs.

Avoid in MVP:

- GOLD redemption.
- automatic token yield from islands.
- manual wallet sales.
- client-trusted balances.
- putting harvest/movement/crafting ticks on-chain.

## Part 10: One-Sentence Explanation

TinyWorld should let players hold a real Solana token, use wallet status to
unlock non-withdrawable GOLD, own scarce island assets on-chain, and trade
selected assets without TinyWorld taking custody or promising redemption.

