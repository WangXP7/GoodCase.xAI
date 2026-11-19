# TinyWorld Economy Guide

A plain-English overview of the TinyWorld token, GOLD, islands, assets, and marketplace economy.

This guide has two audiences:

1. Players and community members who are new to TinyWorld or new to crypto.
2. Crypto-native users and community members who want to understand how the on-chain and in-game economy fits together.

It explains the intended relationship between:

- **$TINYWORLD**, the public Solana token.
- **GOLD**, the non-withdrawable in-game spending allowance.
- **ISLANDS**, scarce ownable world assets.
- **NFTs / on-chain assets**, player-owned game items.
- **Marketplace trading**, both inside and outside the game.

> Status: this is a draft of the intended economy design. Some details are still open decisions (see the end of this guide), and game rules may evolve.

**Prefer the full document?** [Download the complete Economy Guide & Technical Overview (PDF)](assets/tinyworld-economy-guide.pdf) — it includes the full technical architecture and integration notes.

---

## Part 1 — Player Overview

### 1. What is TinyWorld?

TinyWorld is a game world made of small floating islands, resources, characters, items, and player-driven economies. Players can explore, build, mine, craft, trade, and own parts of the world.

TinyWorld uses two different types of value:

| Type | What it is | Tradable outside the game? |
| --- | --- | --- |
| $TINYWORLD | Public Solana token | Yes |
| GOLD | In-game spending power | No |
| ISLAND NFTs | Ownable land / islands | Yes |
| Item NFTs | Optional on-chain game assets | Yes, if enabled |
| Internal resources | Wood, ore, crystal, energy, etc. | No, unless converted into an on-chain item |

The core idea is simple:

- $TINYWORLD is the external token.
- GOLD is gameplay spending power.
- ISLANDS and selected assets can be player-owned and tradable.

### 2. What is $TINYWORLD?

$TINYWORLD is the public Solana token connected to the TinyWorld ecosystem. Players may be able to:

- Hold $TINYWORLD in their own Solana wallet.
- Send $TINYWORLD wallet-to-wallet.
- Trade $TINYWORLD on supported Solana exchanges or swap platforms.
- Use $TINYWORLD for TinyWorld-related purchases.
- Use $TINYWORLD in the official TinyWorld marketplace.
- Use $TINYWORLD to unlock in-game benefits, depending on game rules.

The important point: players hold $TINYWORLD in their own wallets. TinyWorld does not need to hold player funds for them.

### 3. What is GOLD?

GOLD is TinyWorld's in-game spending allowance. GOLD is used for gameplay actions such as building, crafting, upgrading, speeding up actions, unlocking cosmetics, buying internal game services, paying internal gameplay fees, and participating in game systems.

GOLD is not designed to be a cash balance. GOLD:

- Cannot be withdrawn.
- Cannot be redeemed from TinyWorld for money.
- Cannot be exchanged directly for SOL, USDC, or $TINYWORLD.
- Has no fixed real-world value.
- Is not intended to be a bank balance, deposit, or stored-value account.

The clean principle is: **$TINYWORLD has market value. GOLD has game utility.**

### 4. How does holding $TINYWORLD affect GOLD?

TinyWorld may calculate a player's GOLD allowance based on their $TINYWORLD wallet status.

For example, a player who holds 10,000 $TINYWORLD might be given a 1,000 GOLD spending allowance for the current cycle. If that player later sends or sells some $TINYWORLD, their future GOLD allowance may decrease.

If Alice holds 10,000 $TINYWORLD and sends 5,000 to Bob, then Alice now holds 5,000 and her future GOLD allowance may reduce, while Bob holds more and his future allowance may increase. This does not mean GOLD itself has a cash value — it means the player's wallet status can unlock gameplay power.

### 5. Does GOLD go up and down in value?

The preferred wording is: **GOLD does not have a market price. A player's GOLD allowance may change based on their wallet status and gameplay status.**

Things that may affect GOLD allowance:

- Amount of $TINYWORLD held.
- Whether $TINYWORLD is locked for gameplay access.
- Island ownership.
- Season rank.
- Quest progress.
- Guild membership.
- Special NFTs or items.
- Gameplay multipliers.
- GOLD already spent during the current cycle.

Things that should not directly affect GOLD allowance: the $TINYWORLD fiat price, market cap, DEX liquidity, USD value, or SOL price.

The safer design is "10,000 $TINYWORLD = a defined gameplay tier", not "£100 worth of $TINYWORLD = a cash-equivalent amount of GOLD". This keeps TinyWorld's in-game economy stable and avoids treating GOLD like money.

### 6. Suggested GOLD model

TinyWorld can use a tiered allowance system. For example:

| $TINYWORLD held | Tier | Weekly GOLD allowance |
| --- | --- | --- |
| 1,000 | Bronze | 100 GOLD |
| 10,000 | Silver | 500 GOLD |
| 50,000 | Gold | 1,500 GOLD |
| 100,000 | Mythic | 2,500 GOLD |

An alternative model scales the allowance by the square root of $TINYWORLD held, times a multiplier. This prevents whales from completely dominating the economy while still rewarding larger holders.

### 7. What happens when GOLD is spent?

GOLD should work like an allowance or gameplay energy system. If Alice has a 1,000 GOLD allowance this week and spends 300 on upgrades, she has 700 remaining. If she sells some $TINYWORLD during the cycle, the game may reduce her remaining available allowance.

Already-spent GOLD should not usually be clawed back, and items already bought should not vanish just because a wallet balance changed. The better player experience is: **wallet changes affect future or remaining allowance, not already-completed actions.**

### 8. Can players send $TINYWORLD directly to each other?

Yes. Because $TINYWORLD is a normal Solana token, players can send it wallet-to-wallet — outside the game, through a wallet, through a Solana swap or marketplace, or through a TinyWorld interface that asks the wallet to sign a transaction. TinyWorld reads the updated balances afterward, and future GOLD allowances may shift accordingly. TinyWorld does not need to hold the tokens.

### 9. Does TinyWorld earn fees when players send $TINYWORLD?

Not automatically. There are different types of fees:

- **Solana network fee** — a normal Solana transaction fee that goes to the network, not TinyWorld.
- **Marketplace fee** — if players trade through the official TinyWorld marketplace, TinyWorld may charge a marketplace fee. For example, on a 50,000 $TINYWORLD island sale with a 5% fee, the seller receives 47,500 and the treasury receives 2,500.
- **Token transfer fee** — if $TINYWORLD is created using a token standard that supports transfer fees, the token itself can charge a fee on transfers. This is possible but should be used carefully, because transfer taxes can annoy users, reduce exchange support, and make the token feel less open.

Recommended default: let wallet-to-wallet transfers remain simple, and earn through game actions, primary sales, marketplace fees, minting fees, upgrades, and optional premium systems.

---

## Part 2 — Islands and Land Ownership

### 10. What are islands?

Islands are scarce ownable world assets in TinyWorld. For example, there might be 20 original floating islands, each ownable by a player wallet, each with a unique identity and its own gameplay rights, settings, and economic rules.

An island may include a world position, name, visual style, resource types, mining zones, build permissions, tax settings, access rules, upgrade slots, decoration slots, and marketplace permissions.

### 11. How are islands represented?

Each island should be represented as an on-chain asset, most likely an NFT or equivalent Solana asset. The NFT proves ownership, and the game reads the blockchain to determine who owns each island.

If Wallet A owns the Island #7 NFT, TinyWorld gives Wallet A island management controls for Island #7. If Wallet A sells that NFT to Wallet B, TinyWorld sees the new owner and hands the controls to Wallet B. Ownership is not just stored in a private TinyWorld database — the public chain acts as the ownership ledger.

### 12. Initial island sales

At launch, TinyWorld may sell the first islands directly. A recommended flow: the player connects their Solana wallet, chooses an island, clicks Buy, approves the wallet transaction, and pays in SOL, USDC, or $TINYWORLD. Payment goes to the TinyWorld treasury wallet, the island NFT transfers or mints to the player wallet, TinyWorld detects ownership, and the player receives island controls in-game.

The key point: the purchase should happen through a proper on-chain sale/mint flow or trusted marketplace, where payment and asset transfer happen atomically (together, or the transaction fails) — not through manual "send money and wait" transfers.

### 13. Initial sale formats

TinyWorld can sell islands in several ways:

- **Fixed-price sale** — each island has a fixed price. Simple and easy to explain, good for a first launch, but bots or whales may buy quickly and some islands may be more valuable than others.
- **Auction** — each island is auctioned to the highest bidder. The market discovers price, which is better for scarce or high-value islands, but it is more complex and can feel less accessible.
- **Whitelist sale** — only selected wallets (early players, token holders, contributors, testers, creators, builders) can buy during an early phase. Rewards the real community and reduces bot risk, but requires allowlist management and can create fairness concerns.
- **Hybrid model** — for example, 5 islands reserved for community, 5 sold at fixed price, 5 auctioned, and 5 kept by treasury for future events. This is often the best structure because it avoids putting the entire world into one sale format.

### 14. Player-to-player island sales

After the initial sale, players can sell islands to each other through two routes:

- **Official TinyWorld marketplace** — the preferred experience. A seller lists an island, a buyer purchases it through TinyWorld, the marketplace flow transfers payment and the island, and TinyWorld takes a marketplace fee. This route can provide clear listings, verified island data, game stats, tax settings, resource history, safer settlement, and better support.
- **Direct wallet-to-wallet sale** — players may also transact outside the official marketplace. TinyWorld still sees the new owner and hands over island controls, but may not receive a fee from this type of trade. This is part of open ownership: if players own assets in their own wallets, they can move them.

### 15. What happens when an island is sold?

When an island NFT changes owner, the old owner loses island controls and the new owner gains them. Island settings may persist, and pending taxes or rewards need a defined settlement rule.

Recommended settlement rule: ownership changes apply from the next game tick or season checkpoint. Unclaimed internal resources earned before the sale belong to the previous owner; future resources after the sale belong to the new owner. This prevents confusion.

---

## Part 3 — Island Taxes and Resource Economies

### 16. What are island taxes?

Island owners may be able to set gameplay taxes on activity that happens on their island. For example, if a miner gathers 100 ORE on an island with a 10% tax, the miner receives 90 ORE and the island owner receives 10 ORE.

The safest version is that **taxes are paid in internal game resources, not directly in cash-value tokens** — resources like ore, wood, crystal, energy, GOLD, build points, or crafting materials that can be used inside the game.

### 17. Why not pay island tax directly in $TINYWORLD?

It is possible, but it increases risk. If islands generate $TINYWORLD income automatically, they start to look like yield-generating assets, which can create regulatory risk, tax complexity, securities-style concerns, "passive income" expectations, speculative land flipping, and player backlash if returns fall.

Safer wording: "island owners receive in-game resources from gameplay activity." Riskier wording: "buy islands to earn passive token income." TinyWorld should avoid marketing islands as investments.

### 18. Recommended island tax model

The recommended model: island owners set resource tax rates, players mine or gather resources, tax is paid in internal resources, and island owners use those resources to upgrade, craft, decorate, or operate their islands. Rare crafted assets may optionally become NFTs that can be traded player-to-player.

This creates an indirect value path: own an island, collect in-game resources, upgrade/craft/build, create valuable game assets, and optionally sell those assets to other players. That is healthier than islands that automatically pay out tradable token yield.

### 19. Tax limits

TinyWorld should cap tax rates to avoid abuse — for example a minimum of 0%, a maximum of 20%, a default of 5%, and a tax-change cooldown of 24 hours or one game cycle.

Other safety rules: players must see tax rates before mining, tax changes should not apply mid-action, new rates apply from the next cycle, abusive islands can be ignored by players, and the game may apply maximum caps per resource type.

---

## Part 4 — NFTs and the On-Chain Ledger

### 20. What is on-chain?

The blockchain should store or verify important ownership events: $TINYWORLD token balances, island ownership, NFT item ownership, marketplace sales, primary sale purchases, and optional royalty/fee or locking/escrow records.

High-frequency gameplay stays off-chain and in-game: GOLD allowance, internal resources, XP, quest progress, building placement, local island state, combat data, temporary rewards, cooldowns, session data, and player preferences.

The rule: **put ownership and settlement on-chain; keep high-frequency gameplay off-chain.**

### 21. Why not put everything on-chain?

Games need fast interactions. Mining, movement, crafting, combat, and building happen frequently, and putting every action on-chain would be slower, more expensive, more annoying, worse for UX, and harder to scale. So TinyWorld uses a hybrid model: the blockchain handles ownership and settlement, the game backend handles gameplay state and simulation, and the app handles the interface and wallet signing.

### 22. NFTs as ownership keys

An NFT can act as a key: if a wallet owns a given island's NFT, the game shows that wallet the island's admin controls; if not, it hides them. The NFT does not need to contain every detail of the island — it only needs to prove ownership. The game database can store the extended state (name, tax rate, resource profile, level, build slots, and so on). The chain says who owns the island; the backend says what is happening on it.

### 23. Item NFTs

Not every item should be an NFT. Use NFTs for rare items, land, founder assets, special cosmetics, unique machines, high-value crafted assets, and transferable player creations. Do not use NFTs for every piece of wood, every ore unit, every basic sword, every temporary boost, or every low-value consumable.

| Item type | On-chain? |
| --- | --- |
| Basic resources | No |
| Common consumables | No |
| Normal crafted tools | Usually no |
| Rare cosmetics | Maybe |
| Unique land / islands | Yes |
| Founder assets | Yes |
| Player-created rare assets | Maybe |
| High-value tradeable machines | Maybe |

### 24. Marketplace sales

Marketplace sales should be atomic. In a typical sale, a buyer's payment, the marketplace fee to the TinyWorld treasury, the remainder to the seller, and the NFT to the buyer all move together in one transaction. After it confirms, TinyWorld detects the ownership change, updates the owner mapping, and hands island controls to the new owner while removing them from the previous owner.

---

## Part 5 — Economy Safety Rules

### 25. Do not promise redemption

TinyWorld should avoid saying GOLD can be cashed out, GOLD is backed by $TINYWORLD, GOLD has a fixed dollar value, TinyWorld guarantees liquidity, TinyWorld will buy assets back, or island owners earn passive income.

Preferred wording: GOLD is non-withdrawable gameplay spending power; $TINYWORLD is a public token with market risk; island and asset prices are determined by players and external markets; TinyWorld does not guarantee resale value.

### 26. Avoid bank-like mechanics

Avoid a model where a player deposits a token, TinyWorld credits a redeemable balance, the player later withdraws from TinyWorld, TinyWorld manages pooled reserves, and TinyWorld guarantees conversion.

Prefer a model where the player holds the token in their own wallet, the game reads wallet status, the player gets a gameplay allowance, the player owns NFTs directly, players trade assets peer-to-peer, and TinyWorld only settles official marketplace actions.

### 27. Risk disclosure

TinyWorld should clearly disclose that:

- $TINYWORLD can go up or down in value.
- Liquidity may be limited.
- Market prices are not guaranteed.
- GOLD cannot be withdrawn.
- NFTs may lose value.
- Player-to-player trades outside TinyWorld are at the player's own risk.
- Wallet security is the player's responsibility.
- TinyWorld does not provide financial advice.
- Game rules may evolve.
- On-chain transactions are generally irreversible.

---

## How it all fits together

TinyWorld uses a hybrid game economy.

$TINYWORLD is the public Solana token that players can hold, send, and trade in their own wallets. Holding $TINYWORLD can unlock in-game benefits such as GOLD allowance, access tiers, island rights, or premium actions.

GOLD is not a cash balance. It is non-withdrawable gameplay spending power. Players can use GOLD inside TinyWorld, but they cannot redeem it from TinyWorld for money, SOL, USDC, or $TINYWORLD.

Islands are scarce ownable game assets. Each island can be represented by an on-chain NFT or similar Solana asset. When a wallet owns an island asset, the game gives that wallet control over the island. If the asset is sold or transferred, the game follows the new owner.

Players may trade islands and selected assets through the official TinyWorld marketplace or directly wallet-to-wallet. The official marketplace can provide better safety, verified data, and marketplace fees. External trades may happen without TinyWorld taking a fee, but the game can still recognize the new owner because ownership is on-chain.

Island owners may be able to set gameplay taxes on resources mined or gathered on their islands. The recommended model is for those taxes to be paid in internal game resources, not directly as token yield. This keeps the economy game-first rather than turning islands into passive income products.

The core design principle is:

- $TINYWORLD = market token
- GOLD = game utility
- ISLANDS = ownable world assets
- NFTs = optional player-owned items
- Marketplace = player-to-player settlement
- Backend = gameplay state
- Blockchain = ownership ledger

TinyWorld does not need to hold player funds for this system to work. Players hold their own tokens and assets in their wallets. The game reads wallet status and ownership, then unlocks gameplay features accordingly.

---

## Open decisions

These decisions are still being worked out before a production launch. We are sharing them in the open so the community can follow along.

**Token design**

- SPL Token or Token-2022?
- Transfer fee or no transfer fee?
- Fixed supply or mint authority?
- Burn mechanics?
- Treasury allocation?
- Liquidity strategy?

**GOLD design**

- Wallet-held or locked $TINYWORLD?
- Linear, tiered, or square-root allowance?
- Daily, weekly, or seasonal cycle?
- Can unspent GOLD roll over?
- Can GOLD be gifted inside the game?
- Can GOLD be used in player-to-player trades, or only system actions?

**Island sale design**

- Fixed price, auction, whitelist, or hybrid?
- Payment in SOL, USDC, $TINYWORLD, or multiple?
- How many islands sold initially?
- How many reserved for treasury/events?
- Marketplace fee percentage?
- Royalty policy?

**Island tax design**

- Maximum tax rate?
- Tax paid in which resources?
- Tax change cooldown?
- Can islands block access?
- Do taxes apply instantly or next cycle?
- What happens to unclaimed taxes when an island is sold?

**NFT design**

- Which assets become NFTs and which remain internal?
- Metadata standard?
- Update authority policy?
- Royalty policy?
- Compressed or standard NFTs?
- Marketplace compatibility?

**Legal / compliance**

- Public risk disclosures.
- Token marketing rules.
- No redemption language.
- No guaranteed returns.
- No passive income claims.
- Consumer protection review.
- Tax/accounting review.
- Jurisdiction-specific legal review.

---

## Recommended first version

The recommended first version of the economy:

1. Launch $TINYWORLD as a normal tradable Solana token. **(Done)**
2. Let players connect wallets. **(Done)**
3. Calculate GOLD allowance from the amount of $TINYWORLD held.
4. Make GOLD non-withdrawable.
5. Sell a small number of island NFTs through an official sale flow.
6. Let the game read island ownership from the chain.
7. Allow island owners to set internal resource taxes.
8. Keep taxes paid in internal resources.
9. Add an official marketplace for islands and assets.
10. Charge marketplace fees only when players use the official marketplace.

Things to avoid in the first version: GOLD redemption, guaranteed token value, automatic token yield from islands, cash-equivalent balances, company-held player deposits, manual wallet sales, complex transfer taxes, and over-promising treasury mechanics.

The first version should prove the fun loop first — hold token, get gameplay power, own island, mine resources, upgrade island, craft assets, trade assets, build world — and then expand the economy only where the game actually needs it.

---

## In one sentence

TinyWorld lets players hold a real Solana token, use that wallet status to unlock non-withdrawable in-game GOLD, own scarce island assets on-chain, and trade selected assets peer-to-peer — without TinyWorld needing to custody player funds or promise cash redemption.
