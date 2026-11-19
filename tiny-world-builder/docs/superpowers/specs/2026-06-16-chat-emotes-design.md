# Chat Emotes — Design

**Date:** 2026-06-16
**Status:** Approved for planning
**Files in scope:** `engine/world/47-worlds-room.js`, `engine/world/53-voxel-avatar.js`, `engine/world/50-worlds-play-chat.js`, `party/index.js`

## Goal

Let players trigger avatar animations by typing slash commands in the in-world
chat — `/wave`, `/jump`, `/dance`, `/sit`, `/crouch`, `/attack`. Emotes are
**networked**: every player in the room sees the animation play on the
triggering player's avatar. Each emote also surfaces a plain-text action line
("Jason waves") as a floating bubble **and** in the scrollable chat log.

No emoji anywhere (project rule).

## Decisions (locked)

- **Visibility:** networked — others see your emote.
- **Commands v1:** `/wave`, `/jump`, `/dance`, `/sit`, `/crouch`, `/attack`.
- **Chat text:** the raw `/wave` is intercepted (never shown as chat text); an
  action line is rendered instead.
- **Action line surface:** floating bubble **and** chat-log entry.
- **Held poses (`/sit`, `/crouch`):** auto-release after a few seconds — all six
  are treated uniformly as timed emotes. Moving cancels early.

## Architecture

The design mirrors the existing `jumpStart` one-shot pattern. `animEntity` →
`animVoxel` already runs for **every** voxel entity (self and peers, line 2385),
so a per-entity emote field animates remote avatars with no rework of the peer
loop.

### 1. Emote registry (client, `47-worlds-room.js`)

A single source-of-truth table maps command → rig state + hold duration:

| Command   | Rig state        | Duration | `hold` | Mechanism                          |
|-----------|------------------|----------|--------|------------------------------------|
| `/wave`   | `wave` *(new)*   | ~1.6s    | false  | one-shot, rig auto-returns         |
| `/dance`  | `dance` *(new)*  | ~3.0s    | true   | looping pose, emote timer releases |
| `/jump`   | `jump`           | rig-timed| false  | reuses existing pose               |
| `/sit`    | `sit`            | ~4.0s    | true   | hold pose, emote timer releases    |
| `/crouch` | `crouch`         | ~2.5s    | true   | hold pose, emote timer releases    |
| `/attack` | `attack`         | rig-timed| false  | reuses existing swing              |

The `hold` flag drives the emote layer (§4): `hold:true` poses are re-asserted
every frame until the timer expires (the rig would otherwise sit idle); `hold:false`
poses are set once on the rising edge and left to the rig's own clock.

The registry also carries the action verb key for the action line (e.g.
`wave` → `"waves"`). Verbs are user-facing → routed through the i18n system
(see tinyworld-i18n); the command tokens themselves stay un-localized.

### 2. Command interception

`WS.sendChat(text)` (47:1243) is the single funnel for every chat UI (harvest
HUD 48, play-chat 50). Wrap it:

```
WS.sendChat = (text) => {
  const t = String(text || '').trim();
  if (t[0] === '/') {
    const cmd = t.slice(1).split(/\s+/)[0].toLowerCase();
    if (EMOTES[cmd]) { triggerEmote('local', cmd); send({ type:'emote', cmd }); return; }
    // unknown command: local toast, do not broadcast
    toast(T('worlds.unknownCommand')); return;
  }
  /* ...existing chat send... */
};
```

Intercepted commands are **never** sent as `chat` messages.

### 3. Networked trigger

- **Local:** on intercept, set the emote on `selfEnt` immediately (responsive)
  and `send({ type:'emote', cmd })`.
- **Server (`party/index.js`):** new `emote` handler, modeled on the `chat`
  handler — admitted-only, `cmd` validated against a server-side allowlist
  (reject anything else), id stamped from `sender.id` (no spoofing), name taken
  from the trusted presence record. Broadcast `{ type:'emote', id, name, cmd }`
  to **all admitted including the sender** (server-ordered; the sender's own
  avatar re-confirms through the same path).
- **Client `onMessage` (47:199):** `case 'emote'` → resolve `id`→ent via the
  same lookup `showChatBubble` uses (`id === myId ? selfEnt : peerEnts.get(id)`)
  → `applyEmote(ent, cmd)` + render the action line.

### 4. Unified emote layer in `animVoxel`

One per-entity field replaces six special cases:

```
ent.emote = { state, until }   // set by applyEmote
```

In `animVoxel`, before the existing walk/idle precedence block:

- On the rising edge (emote just set): `ent.voxel.setState(state)` once.
- While `now < until` **and** the entity is not moving:
  - `hold:true` → keep re-asserting `state` each frame (the rig would otherwise
    fall back to idle; this holds sit/crouch and loops dance).
  - `hold:false` → do **not** re-assert; leave the rig to run its own one-shot
    clock (re-asserting would restart jump/attack/wave every frame).
  - In both cases, skip the walk/idle precedence block so it can't stomp the emote.
- On expiry, or when the entity moves (`moving === true`): clear `ent.emote`
  and fall through to the existing walk/idle logic (which stands sit/crouch up,
  same as the `_sitToggle` release today).

This works identically for self and peers.

### 5. New rig poses (`53-voxel-avatar.js`)

- Add `wave` and `dance` to the `setState` whitelist (line 849).
- In `setState`, seed their pose clocks (reuse `_poseT`, or add `_emoteT`).
- Add `update()` branches:
  - **wave:** raise `armR.sh` + bend `armR.elbow`, oscillate the hand for ~1.6s,
    then auto-return to idle (mirrors how `jump` self-times via `_jumpT`).
  - **dance:** looping chest bob + lateral sway + alternating arm/hip motion
    (lift from the existing walk `strideCore` constants where useful, per
    "extract, don't reinvent"); loops until the 47 emote timer releases it.
- Both must respect the top-of-`update()` axis-neutralize contract (lines
  885–889) — set only the core axes they need so leaving the pose can't leak
  splay/twist into the next state.

### 6. Action line — bubble + chat log

On `emote` receipt, each client builds the action text **locally** from the
trusted `{ name, cmd }` (never from raw client text):

```
const line = `${name} ${T('worlds.emote.' + cmd)}`;   // e.g. "Jason waves"
showChatBubble(id, line);                               // floating bubble (existing path)
emit('chat', { id, name, text: line, action: true });   // chat-log entry (existing listener)
```

- **Bubble:** reuses `showChatBubble` (47) verbatim.
- **Log:** the play-chat log already subscribes via `on('chat', addMessage)`
  (50:544). Add an `action` flag so `addMessage` styles it distinctly
  (italic / system color) instead of as a spoken line. No new transport.

## Data flow

```
type /wave ─▶ WS.sendChat intercept ─▶ applyEmote(selfEnt,'wave')  [instant local]
                                    └▶ send {emote,cmd}
                                          │
                                  server validates + stamps
                                          │ broadcast {emote,id,name,cmd}
                                          ▼
   every client onMessage 'emote' ─▶ applyEmote(ent,'wave')  ─▶ rig setState('wave')
                                  └▶ showChatBubble + emit('chat',{action})
```

## Out of scope (v1)

- Persisting/queueing emotes (only the latest emote per entity is shown).
- Emote cancel/interrupt UI beyond "movement cancels".
- Emotes for sprite/strip avatars (poses are voxel-only; a sprite avatar still
  gets the action bubble + log line, just no limb animation — matches how
  skyfall posture is voxel-guarded).
- A `/help` or emote-picker UI. (Note: an unknown-command toast hints at it.)
- Bot/AI emote authoring.

## Constraints & gotchas

- **Server change → `partykit deploy` for prod** (local `partykit dev`
  hot-reloads). The client-only parts ship via `./publish.sh` (served app is
  built `dist/`, not source).
- **i18n:** action verbs + the unknown-command toast are user-facing strings →
  add via the tinyworld-i18n workflow (EN/FR/ZH/ES); run `npm run i18n:check`.
- **No emoji** in any command, bubble, log line, or toast.
- **Axis-neutralize contract** in the rig must be honored by the new poses.
- **Move-cancels-emote** must use the same `moving` signal already computed in
  `animVoxel` so sit/crouch release matches today's behavior.

## Verification plan

- **Rig poses:** 3D-math check (limb-group rotations move vs idle by a
  measurable delta; pose returns to exactly idle after duration — no axis leak),
  per the project's "test with 3D math, not screenshots" rule.
- **Interception:** unit-check `WS.sendChat` — `/wave` does not emit a `chat`
  message; a normal line still does; unknown `/foo` is swallowed.
- **Networked path:** two-client check (or a bot peer) — client A `/wave`,
  client B sees A's avatar wave + the action line in B's log/bubble.
- **Live confirmation** in a real room is the user's channel (worlds-room is
  openMode/role-gated; agents land in the single-player builder).
