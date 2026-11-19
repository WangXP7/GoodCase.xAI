# Living Lobby — WAVE1 launch-day activity plan

> Companion to `wave-launch-system.md` / `autonomous-agentic-team.md`. Those make the
> roadmap/voting/builder launch-ready; this one makes the **lobby itself feel alive** for the
> **Sunday 21 Jun 23:59 GMT (WAVE1)** arrival. Grounded in a read-only code audit
> (`explore-lobby-liveness`, codex). Every claim below is a real file:line.

The lobby is the in-world social hub, slug hardcoded **`tidewater-bay`**
(`64-lobby-chat-bridge.js:16-19`, `65-lobby-benches.js:12-18`).

---

## TL;DR — the core finding

**Almost every "alive" mechanism already exists. They're just OFF or ungated for a real visitor.**
A first-timer landing Sunday sees: static hero art + a countdown on the web page; and in-world, a
roster that says **"1"**, empty chat, no crowd, no bots, a screen cycling **static** slides. The
machinery for population, chat, nameplates, CCTV, big-screen is all wired — nothing is *driving* it.

**Biggest single lever:** a **production-safe lobby population layer** — 3–5 NPC/AI peers that join
`tidewater-bay`, wander, emote, occasionally chat. This one thing lights up the roster count,
nameplates, chat bubbles, CCTV tracking, and gives the big screen something to cut to — **with zero
new rendering infrastructure**, because PartyKit avatars already render peers.

---

## Current state (audit map)

| Mechanism | Status for a real prod visitor | Seam |
|---|---|---|
| WAVE1 countdown (web + lobby screen) | **ACTIVE** | `index.html:63`, `58-lobby-presentation.js:171-185` |
| Atmosphere (clouds, cloud-sea, smoke, water) | **ACTIVE** | `25-animation-loop-schema.js:42-82`, `31-cloud-sea.js:129-160` |
| Voxel avatars for self/peers | **ACTIVE** (renders any peer) | `53-voxel-avatar.js`, `47-worlds-room.js:2416-2453` |
| Name labels / nameplates | **ACTIVE** (per peer) | `47-worlds-room.js:2839-2974` |
| Real-time chat + speech bubbles + emotes | **ACTIVE** (if anyone speaks) | `50-worlds-play-chat.js:814`, `47-worlds-room.js:2699-2837` |
| Lobby big screen | **ACTIVE but STATIC deck** | `58-lobby-presentation.js:17-40` (default copy) |
| Live presence COUNT on landing page | **HIDDEN when logged-out** (DB-derived, not live) | `landing-feed.js:328-337`, `worlds.mjs:127-131` |
| Ambient wandering crowd | **DORMANT** (default off, hidden in rooms) | `tinyworld-defaults.json:52`, `47-worlds-room.js:222-225` |
| Lobby benches (seated online members) | **AUTH-GATED** (signed-in only) | `65-lobby-benches.js:126-163`, `community.mjs:766-809` |
| Browser AI bots | **LOCAL-DEV-ONLY** (hard-refuses prod) | `51-worlds-bots.js:1-10` |
| CLI AI bot runner (join/move/chat) | **EXISTS, not deployed** (defaults localhost) | `tools/ai-bots.mjs:54-64,213-270` |
| Toast notifications (joins/chat) | **OPT-IN, default off** | `68-notifications.js:7-15,30-33` |
| In-world activity / "what's happening" feed | **NOT BUILT** | — |

**Key prod nuance to exploit:** empty-token joins are downgraded to `observe`, **but observers can
still move AND chat** (`party/index.js:1209-1223`, `:1125-1130`). So a deployed CLI bot may populate
`tidewater-bay` in prod **without minting signed play-tokens** — needs a live verify, but if true it
is the cheapest population path that exists.

---

## Prioritized plan (each item = own worktree + PR + cross-review; human merges)

### P0 — Quick un-gates (hours, mostly config/flags; light up what already works)
- **P0a — Public live count.** Surface a real "N explorers in Tidewater Bay" on the landing hero
  even when logged-out (today `landing-feed.js` hides the whole feed without auth). Either expose a
  minimal anonymous count from `/api/worlds` (`worlds.mjs:127-131`) or read PartyKit room presence.
- **P0b — Turn notifications on by default** for the lobby (join/chat toasts) so arrivals *feel*
  events happening (`68-notifications.js:30-33`). Keep a mute toggle.
- **P0c — Ambient crowd in the lobby.** Flip the default-off crowd on for `tidewater-bay` and stop
  suppressing it in the lobby room (`47-worlds-room.js:222-225`) — purely cosmetic wanderers, no net.

### P1 — Lobby population layer (THE lever — make it feel populated)
- **P1 — Deploy 3–5 persistent NPC/AI peers** into `tidewater-bay` via the existing CLI runner
  (`tools/ai-bots.mjs`), pointed at prod, as an always-on process (or scheduled keep-alive).
  - **Phase 1a (cheap, no LLM):** scripted wander + periodic emotes + a small rotating canned-chat
    set. Lights roster/nameplates/bubbles/CCTV immediately. No per-message LLM cost.
  - **Phase 1b (optional):** wire LLM chat for ambient banter (orcarouter; cost per call).
  - **Prod-safety:** must NOT use the local-only browser module (`51-worlds-bots.js` refuses prod).
    First task: VERIFY whether observer-token joins can move/chat in prod (`party/index.js:1209`),
    else mint signed tokens for the bots. Bots clearly flagged as NPCs (name/skin) — not deceptive.

### P2 — Make the big screen + feed dynamic (gives solo visitors something to watch)
- **P2a — Live big-screen deck.** Replace the static slide copy (`58-lobby-presentation.js:17-40`)
  with launch content: WAVE1 countdown (already there), top-voted roadmap items, "recent builds",
  and CCTV cuts to active rooms (CCTV cut path already exists `:337-357`).
- **P2b — In-world activity feed.** A small "what's happening" surface (recent joins / messages /
  new worlds). NOT BUILT today; smallest version reuses chat + presence events client-side.

### P3 — Polish (only if time before Sunday)
- Auto day/night clock (today setting-driven, not autonomous: `01-render-core.js:137`).
- Ambient music auto-start within autoplay rules (today needs a user gesture: `22-audio.js:109-125`).
- Default-on crop-duster banner planes for motion (`24-crop-duster-banners.js:71-85`).

---

## Recommended sequencing for Sunday
1. **P1 population layer first** (highest perceived impact; verify the observer/token path Day 1).
2. **P0a/P0b/P0c in parallel** (cheap un-gates, independent files).
3. **P2a live deck** if P1 lands with time to spare.
4. P2b/P3 are stretch.

## Decisions (locked by Jason, 18 Jun)
1. **Bots: LLM chat, on FREE OpenRouter models** (no canned). Cost stays ~zero via free-tier models;
   runner must target OpenRouter free model ids and degrade gracefully on rate-limit/empty response.
2. **Default at least 10 NPC peers** in the lobby.
3. **Notifications + ambient crowd default-ON in the lobby — YES** (build P0b + P0c).
4. **Public anonymous live count — NO** (P0a dropped; do not expose a count to logged-out visitors).

## Build set (post-decision)
- **P1** — LLM lobby population layer: ≥10 NPC peers via `tools/ai-bots.mjs`, OpenRouter free models,
  prod-safe (verify observer move/chat path `party/index.js:1209` Day 1; mint signed tokens if needed).
- **P0bc** — lobby defaults: notifications ON (`68-notifications.js:30-33`) + ambient crowd ON
  (`tinyworld-defaults.json:52`, un-suppress in `47-worlds-room.js:222-225`).
- **DROPPED:** P0a public live count.
