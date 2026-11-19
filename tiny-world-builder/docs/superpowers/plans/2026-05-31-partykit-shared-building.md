# PartyKit Shared Building Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local PartyKit-powered shared-building MVP with live remote cursors, remote selection squares, and broadcast cell edits.

**Architecture:** A PartyKit room server broadcasts presence and edit operations for each shared world room. The browser uses a new classic TinyWorld module loaded after existing editing modules; it connects when `?party=` / `?room=` is present, renders remote cursor/selection overlays in Three.js, and applies incoming `cell.set` snapshots through `setCell()`.

**Tech Stack:** Vanilla browser WebSocket, PartyKit server, existing TinyWorld globals (`setCell`, `currentHover`, `window.__tinyworldSelection`, `tilePos`, `hoverHeightForCell`), Netlify share URLs for room entry.

---

### Task 1: PartyKit Room Server

**Files:**
- Create: `partykit.json`
- Create: `party/index.js`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] Add a PartyKit project config pointing at `party/index.js` on port 1999.
- [ ] Add a room server that tracks participants in memory, sends `welcome` with existing presence, broadcasts `presence`, `cell.set`, and `leave` messages, and rejects malformed messages.
- [ ] Add `party:dev` and `dev:party` npm scripts for local testing beside `netlify dev`.
- [ ] Ignore `.partykit/` local state.

### Task 2: Browser Shared-Building Module

**Files:**
- Create: `engine/world/38-multiplayer-partykit.js`
- Modify: `tiny-world-builder.html`
- Modify: `publish.sh`

- [ ] Load the new classic script after `37-island-placement-holos.js`.
- [ ] Detect room id from `?party=`, `?room=`, or `?collab=`.
- [ ] Connect to `ws://localhost:1999/party/<room>` locally, or `wss://<host>/party/<room>` from `?partyHost=`.
- [ ] Render one colored remote cursor ring and selection fill/edge group per participant.
- [ ] Send throttled presence from `currentHover` and `window.__tinyworldSelection`.
- [ ] Apply incoming `cell.set` snapshots via `setCell()` under a remote flag to prevent echo loops.

### Task 3: Share/Collaborate URL Wiring

**Files:**
- Modify: `engine/world/30-ui-boot-wiring.js`
- Modify: `styles/tiny-world.css`
- Modify: `netlify.toml`

- [ ] Add a world-menu action named `Copy collaborate URL`.
- [ ] Reuse `/api/share` to create a share id, then copy `/tiny-world-builder?share=<id>&party=<id>`.
- [ ] Add a compact multiplayer status pill showing room/connected/offline state.
- [ ] Permit WebSocket connections in CSP with `ws:` and `wss:`.

### Task 4: Tests and Verification

**Files:**
- Modify: `tools/check.js`

- [ ] Add static checks for the PartyKit config, script include, server broadcast handlers, and collaborate URL action.
- [ ] Run `npm install` to update lockfile, `npm test`, and `npm run build`.
- [ ] Start `npm run party:dev` and keep Netlify Dev on `http://localhost:8888`.
- [ ] Open two browser tabs with the same `?party=local-test` room and verify: both connect, moving hover in one tab shows a remote cursor in the other, selection squares appear, and a placed object broadcasts to the other tab.
