# Chat Emotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players trigger networked avatar animations from in-world chat slash commands (`/wave`, `/jump`, `/dance`, `/sit`, `/crouch`, `/attack`), surfaced to every player as a pose plus an action line ("Jason waves") in a floating bubble and the chat log.

**Architecture:** Mirror the existing one-shot `jumpStart` pattern. A new server `emote` message (modeled on the `chat` handler) stamps identity and broadcasts to all admitted peers. Each client carries a single per-entity `ent.emote = { state, until, hold }` field that the existing `animVoxel` loop (which already runs for self **and** peers) consumes to drive the rig. The action line is built locally on receipt of the trusted `{ name, cmd }`.

**Tech Stack:** Plain-IIFE browser engine modules (`engine/world/*.js`), PartyKit server (`party/index.js`, ESM), Node built-in test runner (`node --test`), i18n via `engine/i18n/*.js`.

## Global Constraints

- **No emoji** anywhere — commands, bubbles, log lines, toasts (project rule).
- **Server change (`party/index.js`) → `npm run party:deploy` for prod**; local `npm run party:dev` hot-reloads. Client-only changes ship via `./publish.sh` (the served app is built `dist/`, not source). The user runs deploys.
- **i18n:** `engine/i18n/en.js` is authoritative; `fr/es/zh` must define EXACTLY the same keys (parity is enforced by `npm run i18n:check`). User-facing strings (action verbs, unknown-command toast) go through the i18n system; the command tokens (`wave`, etc.) stay un-localized.
- **Rig axis-neutralize contract** (`53-voxel-avatar.js:885-889`): `update()` zeroes the "extra" axes (`armL/R.sh.rotation.y/z`, `chest.rotation`, `legL/R.hip.rotation.y/z`) at the top of every frame. New poses must set only the CORE axes they need (`sh.x`, `elbow.x`, `hip.x`, `knee.x`, `body.position.y`) so leaving the pose can't leak splay/twist into the next state.
- **Move-cancel split:** movement cancels HOLD emotes (`/sit`, `/crouch`, `/dance`) early; one-shot emotes (`/wave`, `/jump`, `/attack`, all ≤ ~1.6s) finish naturally — matching how the existing jump/attack poses run to completion while moving.
- **Verification reality:** the voxel rig is a `THREE`-bound factory and is NOT reachable by the `buildEngineFns` test harness, so wave/dance pose correctness is verified by `npm run check` (syntax/i18n) plus the user's live in-room 3D-math/visual check (worlds-room is openMode/role-gated; agents land in the single-player builder). Do not fabricate a passing rig unit test. Automated tests cover the node-reachable logic (server handler, command parsing, emote-clear decision).

---

### Task 1: Server emote handler

The security-critical, pure-logic core and the only piece fully node-testable. Build it first.

**Files:**
- Modify: `party/index.js` (add `EMOTE_CMDS` export near other exports; add an `emote` message handler immediately after the `chat` handler, which currently ends at line 739)
- Test: `tests/party-emote.test.mjs` (Create)

**Interfaces:**
- Consumes: existing `this.admitted` (Map), `this.presence` (Map), `this.broadcastToAdmitted(obj)`, `cleanText(value, limit)` — all already in `party/index.js`.
- Produces: `export const EMOTE_CMDS` (a `Set` of the six command tokens) and an `emote`-typed broadcast `{ type:'emote', id, name, cmd, ts }`. Task 4's client `onMessage` consumes this shape.

- [ ] **Step 1: Write the failing test**

Create `tests/party-emote.test.mjs`:

```javascript
// Unit tests for the PartyKit emote relay (party/index.js).
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import TinyWorldParty, { EMOTE_CMDS } from '../party/index.js';

function makeRoom() {
  const conns = new Map();
  return {
    id: 'room-test',
    conns,
    getConnection: (id) => conns.get(id) || null,
    broadcast: () => {},
    addConn(id) {
      const c = { id, received: [], closed: false,
        send(raw) { c.received.push(JSON.parse(raw)); }, close() { c.closed = true; } };
      conns.set(id, c); return c;
    },
  };
}
function setup() {
  const room = makeRoom();
  const party = new TinyWorldParty(room);
  const connect = (id) => { const c = room.addConn(id); party.onConnect(c); return c; };
  const send = (sender, obj) => party.onMessage(JSON.stringify(obj), sender);
  return { room, party, connect, send };
}

test('emote command set has the six v1 commands', () => {
  assert.deepEqual([...EMOTE_CMDS].sort(),
    ['attack', 'crouch', 'dance', 'jump', 'sit', 'wave']);
});

test('admitted peer emote broadcasts to all admitted, stamped from sender', () => {
  const { party, connect, send } = setup();
  const a = connect('a'); const b = connect('b');
  party.admitted.set('a', { role: 'host', island: null });
  party.admitted.set('b', { role: 'play', island: null });
  party.presence.set('a', { id: 'a', name: 'Alice' });
  a.received.length = 0; b.received.length = 0;
  send({ id: 'a' }, { type: 'emote', cmd: 'wave', id: 'spoofed', name: 'Mallory' });
  const msgA = a.received.find(m => m.type === 'emote');
  const msgB = b.received.find(m => m.type === 'emote');
  assert.ok(msgA && msgB, 'both admitted peers receive the emote');
  assert.equal(msgB.id, 'a', 'id is stamped from sender, not the client value');
  assert.equal(msgB.name, 'Alice', 'name comes from the trusted presence record');
  assert.equal(msgB.cmd, 'wave');
});

test('unknown emote command is rejected (no broadcast)', () => {
  const { party, connect, send } = setup();
  const a = connect('a');
  party.admitted.set('a', { role: 'host', island: null });
  a.received.length = 0;
  send({ id: 'a' }, { type: 'emote', cmd: 'explode' });
  assert.equal(a.received.find(m => m.type === 'emote'), undefined);
});

test('non-admitted peer emote is ignored', () => {
  const { party, connect, send } = setup();
  const a = connect('a');                 // connected but NOT admitted
  a.received.length = 0;
  send({ id: 'a' }, { type: 'emote', cmd: 'wave' });
  assert.equal(a.received.find(m => m.type === 'emote'), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/party-emote.test.mjs`
Expected: FAIL — `EMOTE_CMDS` is `undefined` (not yet exported) / no `emote` broadcast.

- [ ] **Step 3: Add the `EMOTE_CMDS` export**

In `party/index.js`, near the other top-level `export const` declarations (e.g. beside `RATE_LIMITS`), add:

```javascript
// Server-side allowlist for chat emotes (client EMOTES table in 47-worlds-room.js
// must stay in sync). Anything not in this set is rejected — no spoofed states.
export const EMOTE_CMDS = new Set(['wave', 'dance', 'jump', 'sit', 'crouch', 'attack']);
```

- [ ] **Step 4: Add the `emote` handler**

In `party/index.js`, immediately AFTER the `chat` handler's closing `}` (the block that ends with `return; }` at line 739), insert:

```javascript
    if (data.type === 'emote') {
      // Chat-triggered avatar emote. NOT host-gated: any admitted peer may emote.
      // Identity is server-authoritative — id is stamped from sender.id (no spoof)
      // and name is taken from the trusted presence record. cmd is validated
      // against EMOTE_CMDS (reject anything else). Broadcast to ALL admitted
      // INCLUDING the sender so the action line renders through one path on every
      // client (the sender's own line included), server-ordered.
      if (!this.admitted.has(sender.id)) return;
      const cmd = cleanText(data.cmd, 16);
      if (!EMOTE_CMDS.has(cmd)) return;
      const known = this.presence.get(sender.id);
      const name = cleanText((known && known.name) || data.name || 'Builder', 48) || 'Builder';
      this.broadcastToAdmitted({ type: 'emote', id: sender.id, name, cmd, ts: Date.now() });
      return;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/party-emote.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add party/index.js tests/party-emote.test.mjs
git commit -m "feat(emotes): server emote relay with allowlist + identity stamping"
```

---

### Task 2: Client emote registry, command parsing, and chat interception

Pure parsing/registry logic plus the `WS.sendChat` funnel. `resolveChatInput` and `applyEmote` are top-level functions so the test harness can extract them; the rig poses they reference don't exist yet (wave/dance arrive in Task 6) — until then `applyEmote` still sets `ent.emote` correctly and the layer (Task 3) renders wave/dance as idle, which is a fine intermediate state.

**Files:**
- Modify: `engine/world/47-worlds-room.js` (add `EMOTES`, `resolveChatInput`, `applyEmote` near the other top-level helpers around lines 13-70; rewrite `WS.sendChat` at 1243-1255)
- Test: `tests/worlds-emotes.test.mjs` (Create)

**Interfaces:**
- Consumes: existing `send(obj)` (70), `toast(m)` (14), `T(k, p)` (13), `selfEnt` (1710).
- Produces:
  - `const EMOTES` — `{ [cmd]: { state, ms, hold } }` for the six commands.
  - `function resolveChatInput(text)` → `{ kind:'emote', cmd }` | `{ kind:'unknown', cmd }` | `{ kind:'chat', text }`.
  - `function applyEmote(ent, cmd)` — sets `ent.emote = { state, until, hold }` and `ent._emoteFresh = true`; no-op for unknown `cmd` or null `ent`. Task 3's `animVoxel` layer and Task 4's `onMessage` both call it.

- [ ] **Step 1: Write the failing test**

Create `tests/worlds-emotes.test.mjs`:

```javascript
// Unit tests for chat-emote parsing + the applyEmote field-setter, extracted
// from the real engine/world/47-worlds-room.js. Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildEngineFns } from './helpers/extract-fn.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOM = join(__dirname, '..', 'engine', 'world', '47-worlds-room.js');

// EMOTES is a closure const, not a function declaration, so stub it in the
// preamble with the same shape the real table uses.
const PREAMBLE = `const EMOTES = {
  wave:   { state: 'wave',   ms: 1600, hold: false },
  dance:  { state: 'dance',  ms: 3000, hold: true  },
  jump:   { state: 'jump',   ms: 460,  hold: false },
  sit:    { state: 'sit',    ms: 4000, hold: true  },
  crouch: { state: 'crouch', ms: 2500, hold: true  },
  attack: { state: 'attack', ms: 460,  hold: false },
};`;
const { resolveChatInput, applyEmote } = buildEngineFns(
  ROOM, ['resolveChatInput', 'applyEmote'], PREAMBLE
);

test('slash emote command is recognized', () => {
  assert.deepEqual(resolveChatInput('/wave'), { kind: 'emote', cmd: 'wave' });
  assert.deepEqual(resolveChatInput('  /Sit  '), { kind: 'emote', cmd: 'sit' });
});
test('unknown slash command is flagged, not chatted', () => {
  assert.deepEqual(resolveChatInput('/explode'), { kind: 'unknown', cmd: 'explode' });
});
test('plain text is chat (trimmed)', () => {
  assert.deepEqual(resolveChatInput('  hello world '), { kind: 'chat', text: 'hello world' });
});
test('applyEmote sets the emote field for a hold pose', () => {
  const ent = {};
  applyEmote(ent, 'sit');
  assert.equal(ent.emote.state, 'sit');
  assert.equal(ent.emote.hold, true);
  assert.equal(ent._emoteFresh, true);
  assert.ok(ent.emote.until > 0);
});
test('applyEmote ignores unknown cmd and null ent', () => {
  const ent = {};
  applyEmote(ent, 'explode');
  assert.equal(ent.emote, undefined);
  assert.doesNotThrow(() => applyEmote(null, 'wave'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/worlds-emotes.test.mjs`
Expected: FAIL — `function not found: resolveChatInput`.

- [ ] **Step 3: Add the registry and helpers**

In `engine/world/47-worlds-room.js`, after the `toast` helper (line 14), add:

```javascript
    // ---- chat emotes -------------------------------------------------------
    // Single source of truth: command token -> rig state + duration + hold flag.
    // `ms` for jump/attack matches the rig's own clock (JUMP_DUR 0.46s, attack
    // DUR 0.45s) so the emote field clears about when the one-shot rig pose ends.
    // `hold:true` poses (sit/crouch/dance) are re-asserted each frame by the
    // emote layer until the timer expires; `hold:false` one-shots are set once
    // and left to the rig's own clock. Server allowlist (EMOTE_CMDS in
    // party/index.js) must list the same six tokens.
    const EMOTES = {
      wave:   { state: 'wave',   ms: 1600, hold: false },
      dance:  { state: 'dance',  ms: 3000, hold: true  },
      jump:   { state: 'jump',   ms: 460,  hold: false },
      sit:    { state: 'sit',    ms: 4000, hold: true  },
      crouch: { state: 'crouch', ms: 2500, hold: true  },
      attack: { state: 'attack', ms: 460,  hold: false },
    };
    // Classify a chat input: an emote command, an unknown slash command, or a
    // plain chat line. Pure (no side effects) so it is unit-testable.
    function resolveChatInput(text) {
      const t = String(text == null ? '' : text).trim();
      if (t[0] === '/') {
        const cmd = t.slice(1).split(/\s+/)[0].toLowerCase();
        return EMOTES[cmd] ? { kind: 'emote', cmd } : { kind: 'unknown', cmd };
      }
      return { kind: 'chat', text: t };
    }
    // Set the per-entity emote field that animVoxel consumes (self or peer).
    // _emoteFresh marks the rising edge so one-shot poses are set exactly once.
    function applyEmote(ent, cmd) {
      if (!ent) return;
      const def = EMOTES[cmd];
      if (!def) return;
      ent.emote = { state: def.state, until: Date.now() + def.ms, hold: def.hold };
      ent._emoteFresh = true;
    }
```

- [ ] **Step 4: Rewrite `WS.sendChat` to intercept emotes**

Replace `WS.sendChat` (lines 1243-1255) with:

```javascript
    WS.sendChat = (text, replyTo) => {
      const r = resolveChatInput(text);
      if (r.kind === 'emote') {
        // Instant local pose (responsive); the action line + peer replication
        // arrive when the server echoes {emote,id,name,cmd} back through onMessage.
        applyEmote(selfEnt, r.cmd);
        send({ type: 'emote', cmd: r.cmd });
        return;
      }
      if (r.kind === 'unknown') { toast(T('worlds.unknownCommand')); return; }
      const t2 = r.text.slice(0, 280).trim();
      if (!t2) return;
      const msg = { type: 'chat', text: t2 };
      if (replyTo && typeof replyTo === 'object' && replyTo.id) {
        msg.replyTo = {
          id: String(replyTo.id).slice(0, 64),
          name: String(replyTo.name || '').slice(0, 48),
          snippet: String(replyTo.snippet || '').slice(0, 120),
        };
      }
      send(msg);
    };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/worlds-emotes.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the static check**

Run: `npm run check`
Expected: PASS (no syntax/i18n regressions; `worlds.unknownCommand` is added in Task 3 — if `check` flags it as a missing literal key, proceed to Task 3 then re-run. If you prefer green-at-every-step, do Task 3 Step 3 now.)

- [ ] **Step 7: Commit**

```bash
git add engine/world/47-worlds-room.js tests/worlds-emotes.test.mjs
git commit -m "feat(emotes): emote registry, command parsing, chat interception"
```

---

### Task 3: i18n strings (action verbs + unknown-command toast)

Add the user-facing strings before the action line (Task 4) renders them, so the bubble/log read correctly and `npm run check` stays green.

**Files:**
- Modify: `engine/i18n/en.js`, `engine/i18n/fr.js`, `engine/i18n/es.js`, `engine/i18n/zh.js`

**Interfaces:**
- Produces i18n keys consumed by Task 4: `worlds.emote.wave`, `worlds.emote.dance`, `worlds.emote.jump`, `worlds.emote.sit`, `worlds.emote.crouch`, `worlds.emote.attack` (third-person action verbs, e.g. `wave` -> "waves"), and `worlds.unknownCommand` (consumed by Task 2's `WS.sendChat`).

- [ ] **Step 1: Invoke the i18n skill**

Use the `tinyworld-i18n` skill. Add to `engine/i18n/en.js` (authoritative) these keys with English values, then have the skill translate them into `fr/es/zh` with parity:

| Key | EN value |
|-----|----------|
| `worlds.emote.wave` | `waves` |
| `worlds.emote.dance` | `dances` |
| `worlds.emote.jump` | `jumps` |
| `worlds.emote.sit` | `sits down` |
| `worlds.emote.crouch` | `crouches` |
| `worlds.emote.attack` | `attacks` |
| `worlds.unknownCommand` | `Unknown command` |

Follow the existing flat dotted-key style already used by `worlds.*` keys in `en.js`. No emoji in any value.

- [ ] **Step 2: Verify locale parity**

Run: `npm run i18n:check`
Expected: PASS — all four locales define the same keys, no empty translations. (`worlds.emote.*` are referenced via the dynamic key `t('worlds.emote.' + cmd)` so they are not auto-checked as literals; parity check #1 still requires fr/es/zh to match en.)

- [ ] **Step 3: Commit**

```bash
git add engine/i18n/en.js engine/i18n/fr.js engine/i18n/es.js engine/i18n/zh.js
git commit -m "i18n(emotes): action verbs + unknown-command toast (en/fr/es/zh)"
```

---

### Task 4: Emote layer in `animVoxel` + `onMessage` receipt + action line

The integration. The clear/cancel decision is extracted as a pure function (`emoteShouldClear`) and unit-tested — it encodes the two subtlest rules (the `2145` guard and the move-cancel split). The rig wiring and action line are verified by `npm run check` plus the user's live two-client check using `/sit` (a reused rig state — no rig work needed yet).

**Files:**
- Modify: `engine/world/47-worlds-room.js` (add `emoteShouldClear` near `applyEmote`; insert the emote layer into `animVoxel` at 2140-2156; add `case 'emote'` to `onMessage` after line 241)
- Test: extend `tests/worlds-emotes.test.mjs`

**Interfaces:**
- Consumes: `applyEmote` (Task 2), `EMOTES` (Task 2), `selfEnt`/`peerEnts` (1710-1711), `myId` (34), `showChatBubble(id, text)` (2331), `emit(ev, d)`, `T(k, p)`.
- Produces: `function emoteShouldClear(emote, now, moving)` -> bool; the `ent.emote` consumption contract in `animVoxel`; a chat-log entry `emit('chat', { id, name, text, action: true })` consumed by Task 5.

- [ ] **Step 1: Write the failing test (extend the emote test file)**

Append to `tests/worlds-emotes.test.mjs`:

```javascript
const { emoteShouldClear } = buildEngineFns(ROOM, ['emoteShouldClear'], '');

test('emote clears when expired regardless of movement', () => {
  assert.equal(emoteShouldClear({ until: 100, hold: false }, 200, false), true);
  assert.equal(emoteShouldClear({ until: 100, hold: true }, 200, true), true);
});
test('moving cancels a HOLD emote early', () => {
  assert.equal(emoteShouldClear({ until: 9999, hold: true }, 0, true), true);
});
test('moving does NOT cancel a one-shot emote (it finishes naturally)', () => {
  assert.equal(emoteShouldClear({ until: 9999, hold: false }, 0, true), false);
});
test('a live, stationary emote stays', () => {
  assert.equal(emoteShouldClear({ until: 9999, hold: true }, 0, false), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/worlds-emotes.test.mjs`
Expected: FAIL — `function not found: emoteShouldClear`.

- [ ] **Step 3: Add `emoteShouldClear`**

In `engine/world/47-worlds-room.js`, right after `applyEmote` (added in Task 2), add:

```javascript
    // The emote layer clears the field when the timer expires, OR when the
    // entity moves AND the emote is a HOLD pose (sit/crouch/dance). One-shot
    // emotes (wave/jump/attack) are NOT cancelled by movement — they finish on
    // the rig's own clock, matching how the jump/attack poses run today.
    function emoteShouldClear(emote, now, moving) {
      return now >= emote.until || (moving && emote.hold);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/worlds-emotes.test.mjs`
Expected: PASS (9 tests total).

- [ ] **Step 5: Insert the emote layer into `animVoxel`**

In `engine/world/47-worlds-room.js`, replace the jump rising-edge + walk/idle precedence block (lines 2140-2156, from `if (ent.jumpStart && !ent._jumpPrev)` through the closing `}` of the `if (rigState !== 'attack' && rigState !== 'jump')` block) with:

```javascript
      if (ent.jumpStart && !ent._jumpPrev) ent.voxel.setState('jump');
      ent._jumpPrev = !!ent.jumpStart;
      // ---- emote layer (networked; runs for self AND peers). One field set by
      // applyEmote replaces six special cases. While an emote is active it OWNS
      // the rig state, so the walk/idle precedence below is skipped (note the
      // `!ent.emote` guard) — without that guard the idle fallback would stomp
      // the pose every frame, and peers (who have no _crouchHeld/_sitToggle)
      // would never show sit/crouch at all.
      if (ent.emote) {
        if (emoteShouldClear(ent.emote, Date.now(), moving)) {
          ent.emote = null;            // expired, or movement cancelled a HOLD pose
        } else if (ent._emoteFresh || ent.emote.hold) {
          // one-shot: set once on the rising edge; HOLD: re-assert each frame so
          // the rig can't fall back to idle (and dance keeps looping).
          ent.voxel.setState(ent.emote.state);
          ent._emoteFresh = false;
        }
      }
      const rigState = ent.voxel.getState();
      // attack and jump are one-shot poses owned by the rig — don't stomp them with
      // walk/idle each frame (the rig clears back to idle when the pose finishes).
      // An active emote also owns the state, hence the `!ent.emote` guard.
      if (!ent.emote && rigState !== 'attack' && rigState !== 'jump') {
        if (ent.attacking) ent.attacking = false;          // rig finished the swing
        let want;
        if (moving) { want = 'walk'; if (ent === selfEnt) ent._sitToggle = false; }
        else if (ent === selfEnt && ent._crouchHeld) want = 'crouch';
        else if (ent === selfEnt && ent._sitToggle) want = 'sit';
        else want = 'idle';
        ent.voxel.setState(want); ent.state = want;
      }
```

(The `ent.voxel.update(dt)` call and the vertical/`updateBubble` tail at 2157-2163 stay unchanged.)

- [ ] **Step 6: Add the `onMessage` emote case**

In `engine/world/47-worlds-room.js`, after the `chat` case (line 241), add:

```javascript
        case 'emote': {
          if (!d.cmd || !EMOTES[d.cmd]) break;            // ignore unknown (defensive)
          const ent = (d.id != null && d.id === myId) ? selfEnt : peerEnts.get(d.id);
          applyEmote(ent, d.cmd);                          // drive the rig (self re-confirms)
          const name = String(d.name || 'Player');
          const line = name + ' ' + T('worlds.emote.' + d.cmd);   // e.g. "Jason waves"
          showChatBubble(d.id, line);                      // floating bubble (existing path)
          emit('chat', { id: d.id, name, text: line, action: true });  // chat-log entry
          break;
        }
```

- [ ] **Step 7: Run the static check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add engine/world/47-worlds-room.js tests/worlds-emotes.test.mjs
git commit -m "feat(emotes): animVoxel emote layer + networked receipt + action line"
```

- [ ] **Step 9: Live verification (user's channel — reused poses)**

Two clients (or a bot peer) in a worlds room. Client A types `/sit`, `/crouch`, `/jump`, `/attack`. Confirm on client B: A's avatar plays the pose, an action line appears in B's chat log AND a floating bubble over A; `/sit` and `/crouch` auto-release after a few seconds; moving A mid-`/sit` stands A up immediately while a mid-`/jump` finishes. Confirm a normal chat line still sends, and `/foo` shows the unknown-command toast locally without broadcasting. (Requires the server change deployed: `npm run party:dev` locally or `npm run party:deploy` for prod.)

---

### Task 5: Chat-log action-line styling

Make `addMessage` render `action:true` entries distinctly (italic, muted) and skip the reply affordance, which makes no sense on a system action line.

**Files:**
- Modify: `engine/world/50-worlds-play-chat.js` (`addMessage`, lines 590-663)

**Interfaces:**
- Consumes: the `{ id, name, text, action:true }` payload emitted by Task 4 (arrives through the existing `on('chat', addMessage)` listener at line 771 — no transport change).

- [ ] **Step 1: Style the action row and skip the reply button**

In `engine/world/50-worlds-play-chat.js`, in `addMessage`, change the reply-button block (lines 644-651) so it is skipped for action lines:

```javascript
      // Reply affordance (appears on row hover; needs a stable message id). Action
      // lines (chat emotes) are system text — no reply target — so skip it.
      if (!d.action) {
        const replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'tw-chat-reply-btn';
        replyBtn.setAttribute('aria-label', 'Reply');
        replyBtn.title = 'Reply';
        replyBtn.appendChild(ic('reply', 13));
        replyBtn.addEventListener('click', () => setPendingReply(d));
        meta.appendChild(replyBtn);
      }
```

Then change the text element (lines 653-655) to style action lines:

```javascript
      const textEl = document.createElement('div');
      textEl.className = 'mp-chat-text';
      textEl.textContent = d.text;
      if (d.action) { textEl.style.fontStyle = 'italic'; textEl.style.opacity = '0.85'; }
```

- [ ] **Step 2: Run the static check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add engine/world/50-worlds-play-chat.js
git commit -m "feat(emotes): style chat-log action lines (italic, no reply affordance)"
```

- [ ] **Step 4: Live verification (user's channel)**

In a worlds room, trigger any emote and confirm the chat-log line renders italic/muted with the name dot and no reply button, distinct from a spoken line.

---

### Task 6: New rig poses — `wave` and `dance`

The only rig work, done last so the whole networked path is already proven against reused poses. Poses are inline (matching the six existing inline poses); verified by `npm run check` + the user's live 3D-math/visual check.

**Files:**
- Modify: `engine/world/53-voxel-avatar.js` (`setState` whitelist line 849 + clock seed lines 842-848; a new `wave` and `dance` branch in `update()`, added in the `else if` chain before the final `else` idle branch at line 1208)

**Interfaces:**
- Consumes: the rig's existing per-instance bones (`armL`, `armR`, `chest`, `head`, `legL`, `legR`, `body`), `BASE`, `bobBase`, `this._t`, `this._poseT`, and the axis-neutralize block at the top of `update()`.
- Produces: rig states `'wave'` and `'dance'` reachable via `setState` — consumed by `applyEmote`/the emote layer (Task 4) through `ent.voxel.setState(...)`.

- [ ] **Step 1: Add `wave` and `dance` to the `setState` whitelist**

In `engine/world/53-voxel-avatar.js`, line 849, extend the allowed-states list:

```javascript
          this._state = (s === 'walk' || s === 'attack' || s === 'jump' || s === 'crouch' || s === 'sit' || s === 'climb' || s === 'skydive' || s === 'rocket' || s === 'wave' || s === 'dance') ? s : 'idle';
```

- [ ] **Step 2: Seed the pose clocks in `setState`**

In `setState`, alongside the existing clock seeds (lines 842-848), add a seed for the new one-shot/loop clocks. `wave` self-times, so reset a dedicated `_emoteT`; `dance` loops on `this._t` and needs no reset:

```javascript
          if (s === 'wave') this._emoteT = 0;
```

Initialize `_emoteT` with the other instance fields at line 799 (append `, _emoteT: 0` to that object literal).

- [ ] **Step 3: Add the `wave` and `dance` branches in `update()`**

In `engine/world/53-voxel-avatar.js`, insert these two `else if` branches into the pose chain immediately BEFORE the final `} else {` idle branch (line 1208). Both set ONLY core axes (the top-of-`update` neutralize already zeroed sh.y/z, chest, hip.y/z this frame), so nothing leaks on exit.

```javascript
          } else if (st === 'wave') {
            // ---- WAVE: right arm raises to the side and the forearm oscillates a
            // few times, then auto-returns to idle (self-timed via _emoteT, the same
            // pattern jump/attack use). Left arm + legs hold the rest pose. Core axes
            // only: sh.x raises the upper arm, sh.z lifts it out to the side, elbow.x
            // bends the forearm, and a sine on the forearm is the wave itself.
            this._emoteT += dt;
            const DUR = 1.6;
            const a = Math.min(this._emoteT / DUR, 1);
            const ease = (t) => t * t * (3 - 2 * t);     // smoothstep raise/lower
            const lift = ease(Math.min(1, a / 0.2)) * (1 - ease(Math.max(0, (a - 0.85) / 0.15)));
            armR.sh.rotation.x = -1.9 * lift;            // upper arm up (negative = up/forward)
            armR.sh.rotation.z = 0.5 * lift;             // out to the side a touch
            armR.elbow.rotation.x = (-0.5 - 0.5 * Math.sin(this._t * 14)) * lift;  // forearm waves
            armL.sh.rotation.x = 0; armL.elbow.rotation.x = 0;
            legL.hip.rotation.x = 0; legR.hip.rotation.x = 0;
            legL.knee.rotation.x = 0; legR.knee.rotation.x = 0;
            body.position.y = bobBase;
            if (a >= 1) {                                // hard-zero, return to idle
              armR.sh.rotation.set(0, 0, 0); armR.elbow.rotation.x = 0;
              this.setState('idle');
            }
          } else if (st === 'dance') {
            // ---- DANCE: a looping groove — chest bob + lateral sway, alternating arm
            // pumps and a hip shift. Loops on this._t (the emote timer in 47 releases
            // it). Core axes only; eased-in via _poseT so it doesn't snap on entry.
            this._poseT = Math.min(1, this._poseT + dt * 5);
            const u = this._poseT;
            const beat = this._t * 6.5;                  // groove tempo
            const bob = Math.abs(Math.sin(beat)) * 0.4 * u;
            const sway = Math.sin(beat * 0.5) * 0.5 * u;
            chest.position.y = BASE.chestY - bob;
            chest.position.x = BASE.chestX + sway;
            chest.rotation.z = -sway * 0.12;             // lean into the sway
            head.position.y = BASE.headY + Math.sin(beat) * 0.2 * u;
            // arms pump alternately (one up while the other is down)
            armL.sh.rotation.x = (-1.1 + Math.sin(beat) * 0.8) * u;
            armR.sh.rotation.x = (-1.1 - Math.sin(beat) * 0.8) * u;
            armL.elbow.rotation.x = -0.7 * u; armR.elbow.rotation.x = -0.7 * u;
            // knees give a small bounce in time with the bob (feet stay planted)
            const bounce = Math.abs(Math.sin(beat)) * 0.12 * u;
            legL.knee.rotation.x = bounce; legR.knee.rotation.x = bounce;
            legL.hip.rotation.x = 0; legR.hip.rotation.x = 0;
            body.position.y = bobBase - bounce * 0.5;
          } else {
```

(The trailing `} else {` shown is the existing idle branch opener at 1208 — do not duplicate it; the two new branches are inserted before it.)

- [ ] **Step 4: Run the static check**

Run: `npm run check`
Expected: PASS (parses; whitelist + branches valid).

- [ ] **Step 5: Commit**

```bash
git add engine/world/53-voxel-avatar.js
git commit -m "feat(emotes): wave + dance voxel rig poses"
```

- [ ] **Step 6: Live verification (user's channel — 3D math)**

In a worlds room, trigger `/wave` and `/dance`. 3D-math/visual acceptance:
- **wave:** right-arm shoulder + elbow rotations are non-zero during the pose (forearm oscillates), then the rig returns to EXACTLY idle after ~1.6s — measure that `armR.sh.rotation` and `armR.elbow.rotation.x` are back to ~0 (no axis leak into idle/walk).
- **dance:** chest bob/sway and alternating arm rotations are visibly periodic and bounded (no NaN, no drift), feet stay planted; releasing (timer expiry or moving) returns cleanly to idle/walk with no residual sway.
- Confirm a peer/second client sees both poses on the triggering avatar.

---

## Self-Review

**Spec coverage:**
- Networked emotes, six commands — Tasks 1 (server relay), 2 (registry/parse), 4 (replication). ✓
- Slash interception, raw text never shown — Task 2 (`resolveChatInput` + `WS.sendChat`). ✓
- Action line as bubble + chat-log entry — Task 4 (`showChatBubble` + `emit('chat',{action})`), Task 5 (log styling). ✓
- Held poses auto-release after a few seconds; movement cancels early — Task 4 (`emoteShouldClear` + the layer); split made explicit (hold cancels on move, one-shots finish). ✓
- New rig poses wave/dance honoring axis-neutralize — Task 6. ✓
- i18n verbs + unknown-command toast (en/fr/es/zh) — Task 3. ✓
- Server allowlist, id-stamp, name-from-presence, broadcast incl. sender — Task 1. ✓
- Constraints (no emoji, deploy split, axis-neutralize, move-cancel signal) — Global Constraints + per-task notes. ✓

**Placeholder scan:** No TBDs; every code step shows full code; every test shows assertions and exact run commands with expected output. ✓

**Type consistency:** `EMOTES[cmd] = { state, ms, hold }` (Task 2) → `applyEmote` writes `ent.emote = { state, until, hold }` + `ent._emoteFresh` (Task 2) → consumed by `emoteShouldClear(emote, now, moving)` and the `animVoxel` layer (Task 4). Server `EMOTE_CMDS` Set + broadcast `{ type:'emote', id, name, cmd, ts }` (Task 1) → consumed by `onMessage case 'emote'` (Task 4). i18n keys `worlds.emote.<cmd>` + `worlds.unknownCommand` (Task 3) → referenced in Tasks 2 and 4. Rig states `'wave'`/`'dance'` (Task 6) → set via `EMOTES[*].state` (Task 2). Names and shapes match across tasks. ✓
