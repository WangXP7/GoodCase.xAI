# TinyWorld — Full Codebase Review

_Generated 2026-06-13. Method: 13 parallel subsystem reviewers → adversarial verification of every critical/high finding → a third independent re-read of each confirmed finding against the live code. Findings the verifier or the re-read refuted are listed at the bottom so you can see what was checked and discarded._

## STATUS: all actionable findings fixed (2026-06-13)

Every confirmed finding below has been fixed, verified (`npm test` → 66/66, dist/ rebuilt and confirmed fresh), and is summarised here. Three findings were investigated and **declined as not-real-bugs** with evidence (see notes): **M7** (crop-duster materials load once per session, not per cycle — not a recurring leak); **L4** (Box3 alloc is in a once-per-session load callback, not a hot path — pure churn to "fix"); **L6** (open-mode guest harvest is documented intended behaviour, confirmed by the open-mode test — changing it would break zero-config play).

| ID | Fix | File(s) |
|----|-----|---------|
| C1 | Reject linking a wallet owned by another profile (409) instead of `ON CONFLICT` reassigning | `netlify/functions/wallet.mjs` |
| C2 | Validate voxel-build conversion before deleting source fields | `engine/world/29-persistence-api.js` |
| H1 | Dispose chunk InstancedMesh instance buffers on stream-out (`_disposeChunk` helper) | `LandscapeEngine.js`, `engine/landscape/chunks.js` |
| H2 | Gate `handleMove` on `role==='play' && profileId` + regression test | `party/index.js`, `tests/party.test.mjs` |
| H3 | Dispose per-entity SpriteMaterial in `disposeEntity` | `engine/world/47-worlds-room.js` |
| H4 | `LIMIT 500` on roadmap GET | `netlify/functions/roadmap.mjs` |
| H5 | Cap service-token grant batch at 500 entries | `netlify/functions/world-resources.mjs` |
| M1 | Join token must match this world's slug (fail closed) | `party/index.js` |
| M2 | `sameOriginWriteGuard` fails closed on missing Origin (Referer/localhost fallback) | `netlify/functions/lib/http.mjs` |
| M3 | Reject non-https profile image URLs | `netlify/functions/profile.mjs` |
| M4 | `readJson` rejects bodies over 1 MB | `netlify/functions/lib/http.mjs` |
| M5 | Clamp object label before embedding in agent prompt | `engine/world/28-generate-panel-agent.js` |
| M6 | Escape palette search fields + strict color check on swatch | `engine/world/30-ui-boot-wiring.js` |
| L1 | Remove latent `html`→innerHTML branch from `el()` | `engine/world/46-worlds-universe.js` |
| L2 | Document `selectionOutlineMat` as intentionally shared | `engine/world/12-selection-tool.js` |
| L3 | Drop needless `_fcMTgtPos.clone()` on missile hit | `engine/world/41-flight-combat.js` |
| L5 | Distinguish ENOENT from parse error for `tinyworld-defaults.json` | `tools/check.js` |

---

## Original findings (for reference)

## How to read this

Every finding below was confirmed by reading the actual lines, not inferred from file names. Severity is the corrected severity after verification. Confidence is my post-re-read confidence that it's a real issue. I deliberately killed three "confirmed" agent findings that turned out to be false positives (see the bottom) — that's the point of the two-direction triage, not noise.

Baseline at time of review: `npm test` → **65 pass / 0 fail**. No `debugger`, no `eval`, no duplicate top-level identifiers across the 55 shared-scope modules (the headline footgun is structurally possible but not currently triggered), and zero `innerHTML` assignments using string interpolation (the obvious XSS class is absent).

---

## CRITICAL

### C1 — Wallet can be silently reassigned between profiles
`netlify/functions/wallet.mjs:98-106` · security · confidence 0.95

`linkWalletToProfile` inserts with `ON CONFLICT (public_key) DO UPDATE SET profile_id = EXCLUDED.profile_id`. The unique constraint is global on `public_key` (`migrations/20260602120000_…sql:31`), so when profile B connects a wallet already linked to profile A, the row's `profile_id` flips from A to B. The preceding `DELETE` only clears *B's* other wallets — it does nothing to protect A. After the flip, `world-claim.mjs:111-115` ("the paying wallet must be your linked wallet") authorizes B against A's wallet.

Caveat on exploitability: B must be able to sign with that wallet's key (the connect flow verifies a signed challenge), so this is not a remote takeover of an arbitrary victim — it's a real ownership-integrity / shared-key hijack hole, and it corrupts the per-profile authorization invariant the payment path relies on.

Fix: reject the link when the wallet already belongs to a different profile rather than reassigning.
```js
const existing = await sql`SELECT profile_id FROM wallet_accounts WHERE public_key = ${publicKey} LIMIT 1`;
if (existing.length && existing[0].profile_id !== profile.id) {
  return errorResponse('This wallet is already linked to another account', 409, origin);
}
```
Do **not** apply the auto-suggested `UNIQUE(profile_id, provider, public_key)` migration — the table already has `UNIQUE(profile_id, provider)`, so a composite key would conflict with it. The 409 guard is the correct fix.

### C2 — Imported/loaded world can permanently lose custom-object data
`engine/world/29-persistence-api.js:199-206` · correctness/data-loss · confidence 0.95

`materializeCustomPartCells` deletes `customParts`, `customName`, `customFootprint`, `footprint`, `renderFootprint` from the cell **before** attempting the conversion, then:
```js
delete c.customParts; delete c.customName; /* …3 more… */
let stamp = null;
try { stamp = normalizeVoxelBuildStamp({ name, customParts: parts, custom: true, footprint }, 'Custom Object'); } catch (_) {}
if (!stamp) continue;   // <-- cell is now stripped AND unconverted
```
If `normalizeVoxelBuildStamp` throws or returns falsy (malformed import, schema drift, a future field it rejects), the `continue` leaves the cell with its source data deleted and no voxel-build replacement — the custom object is gone, and if this was a load of the user's own saved world, it's gone from their save on the next persist. `parts` is captured before the delete so it survives in scope, but nothing writes it back.

Fix: validate first, mutate only on success.
```js
let stamp = null;
try { stamp = normalizeVoxelBuildStamp({ name, customParts: parts, custom: true, footprint }, 'Custom Object'); } catch (_) {}
if (!stamp) continue;                 // bail BEFORE deleting anything
delete c.customParts; delete c.customName; delete c.customFootprint;
delete c.footprint; delete c.renderFootprint;
// …rest of conversion…
```

---

## HIGH

### H1 — Terrain chunk streaming leaks GPU memory (InstancedMesh never disposed)
`LandscapeEngine.js:1433-1442, 1495-1500, 1543-1548` + `engine/landscape/chunks.js` · perf/leak · confidence 0.95

All three chunk-teardown paths (`clearChunks`, near-stream-out, far-stream-out) dispose only the terrain geometry:
```js
this.scene.remove(c.group);
c.geo.dispose();          // only the ground mesh
this.chunks.delete(key);
```
Each near chunk's group also holds up to 5 `InstancedMesh` children (rocks, pines, cacti, shrubs, boulders — up to ~610 instances) created in `_makeChunk`. Their `instanceMatrix` BufferAttributes are per-chunk GPU allocations that are never freed. With continuous terrain streaming, every chunk that scrolls out of range orphans its instanced buffers; VRAM climbs for the whole session. (The shared *materials* are correctly left alone — only geometry/instance buffers need disposing.)

Fix: have `_makeChunk` return the instanced children, and dispose them everywhere `c.geo.dispose()` is called.
```js
// in _makeChunk return:
return { group, geo, mesh, instanced: [rocks, pines, cacti, shrubs, boulders].filter(Boolean) };
// in all 3 teardown sites:
this.scene.remove(c.group);
c.geo.dispose();
if (c.instanced) for (const im of c.instanced) im.geometry?.dispose();
this.chunks.delete(key);
```
(Verified the far-chunk path does **not** carry instanced flora, so the original "it repeats in far chunks" claim was over-generalized and is excluded — far chunks only need their `geo` disposed, which they already get.)

### H2 — Multiplayer: observers can move/teleport without being an admitted player
`party/index.js:1010-1022` · correctness/trust-the-client · confidence 0.95

`handleMove` checks harvest-lock, world existence, bounds, adjacency, and standability — but never checks `this.admitted.has(id)` or that the player's role is `'play'`. On world rooms, connections start provisional (`observe`) until `world.join` upgrades them. An un-upgraded or `observe` client can send `move` messages and walk the board, appearing at arbitrary standable cells and positioning next to resource nodes for harvest attempts. `tests/party.test.mjs` only exercises move via already-admitted players, so it's green and the gap is invisible.

Fix: gate at the top of `handleMove`.
```js
handleMove(id, data) {
  if (!this.admitted.has(id)) return;
  const p = this.getPlayer(id);
  if (!p || p.role !== 'play') return;
  // …existing checks…
}
```
Add a test: an `observe`-role connection sending `move` should be a no-op.

### H3 — Avatar sprite materials leak on every player departure
`engine/world/47-worlds-room.js:821-826` · perf/leak · confidence 0.95

`disposeEntity` removes the sprite from the scene and disposes its textures, but never disposes `sprite.material` (a `THREE.SpriteMaterial` created per entity at ~line 798). `removeBubble` (~line 1030) already does it correctly. In a busy world with players joining/leaving, SpriteMaterials accumulate in GPU memory.

Fix:
```js
function disposeEntity(ent) {
  if (!ent) return; ent.disposed = true;
  removeBubble(ent);
  if (ent.sprite) {
    if (ent.sprite.parent) ent.sprite.parent.remove(ent.sprite);
    ent.sprite.material?.dispose();
  }
  disposeAvatarTextures(ent);
}
```

### H4 — `/api/roadmap` GET has no LIMIT
`netlify/functions/roadmap.mjs:93` · perf · confidence 0.9

```js
const rows = await sql`SELECT * FROM roadmap_milestones ORDER BY sort_order ASC, id ASC`;
```
Unbounded fetch. Today it's ~12 seed rows, but the admin POST/PATCH can insert without bound, and every GET returns the whole table to every visitor. Low live risk (admin is localhost-gated) but a trivial, correct hardening.

Fix: `… ORDER BY sort_order ASC, id ASC LIMIT 500`.

### H5 — `/api/world-resources` service-token grant has unbounded nested loops
`netlify/functions/world-resources.mjs:64-95` · perf/DoS · confidence 0.9

The handler iterates `Object.entries(resources)` and `Object.entries(taxPayouts)` with no size cap, doing an INSERT/UPDATE (and possibly several `tax_ledger` inserts) per entry. A caller holding the service token can post a small JSON with thousands of keys and trigger thousands of DB round-trips in tight loops. Requires the valid service token, so the attack surface is operators/systems that share it — but a single compromised or over-shared token turns this into an availability hole.

Fix: cap the batch.
```js
const MAX = 200;
for (const [pid, raw] of Object.entries(resources).slice(0, MAX)) { /* … */ }
for (const [pid, payout] of Object.entries(taxPayouts).slice(0, MAX)) { /* … */ }
```

---

## MEDIUM

### M1 — Join token accepted on any world when it carries no slug
`party/index.js:940` · security · confidence 0.85

```js
if (payload && (!payload.slug || payload.slug === slug)) {
```
A validly-signed token with no `slug` field is accepted on **every** world room. Requires the server's signing secret to mint, so it's not directly attacker-exploitable today — but it's a latent cross-world replay if any code path ever mints a slug-less play token. Tighten to fail-closed:
```js
if (payload && payload.slug === slug) {
```
(Downgraded from the finder's "critical" — minting requires the secret. Worth fixing as defense-in-depth.)

### M2 — Same-origin write guard fails open on missing Origin header
`netlify/functions/lib/http.mjs:46-50` · security · confidence 0.7

```js
export function sameOriginWriteGuard(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;            // fails open
  return origin === new URL(request.url).origin;
}
```
A request with no `Origin` header passes the CSRF guard. Browsers send Origin on credentialed writes and SameSite cookies provide a backstop, so this is defense-in-depth, not an open door. If you fail closed, allow-list localhost so dev tooling/curl still works:
```js
if (!origin) return false;
```

### M3 — Profile image field accepts any string (stored-XSS feeder)
`netlify/functions/profile.mjs:8-16` (and `lib/profiles.mjs:38`) · security · confidence 0.7

`validateProfile` accepts any ≤2048-char string as `image` with no URL validation, so `javascript:…` or `data:text/html,…` can be stored. Safe at rest as JSON, but it becomes XSS the moment a client renders it as an `<img src>` or anchor without checking. Validate at the boundary:
```js
if (image && !/^https?:\/\//i.test(image)) return { error: 'Image must be an http(s) URL' };
```

### M4 — `readJson` has no body-size limit
`netlify/functions/lib/http.mjs:38-44` · perf/DoS · confidence 0.7

`readJson` calls `request.json()` with no guard; combined with M5/H5 a large/deeply-nested body can spike memory before any per-handler validation runs. Netlify caps requests ~6 MB, so this is a hardening item. Add a `content-length` check and reject early.

### M5 — Prompt injection via selected-cell data in the agent panel
`engine/world/28-generate-panel-agent.js:2797-2803` · security · confidence 0.7

The selected object's cell is `JSON.stringify`'d straight into the LLM system prompt. A `customName` (which can originate from prior AI output or an imported world) containing instruction-override text could subvert the region-restriction instruction. Lower stakes than a server hole — worst case is a misbehaving generation — but worth scrubbing: embed only whitelisted scalar fields (`x`, `z`, `kind`, `terrain`) and clamp/sanitize `customName` to `[\w\s]{0,32}`.

### M6 — Command-palette search renders entry text without escaping
`engine/world/30-ui-boot-wiring.js:3383-3399` · security · confidence 0.6 _(found during my own scan, not a lane finding)_

The palette results build raw HTML by concatenation: `html += '<div class="palette-group">' + e.group + '</div>'`, and similarly for `e.label`, `e.hint`, `e.swatch`. Tool/static entries are safe, but if any palette entry can carry a user-supplied name (e.g. a saved/imported custom stamp surfaced in search), this is an unescaped sink. The codebase already has `escapeName()` (`30-ui-boot-wiring.js:2860`) — route these fields through it, and validate `e.swatch` is a color before inlining it into `style=`.

### M7 — Crop-duster propeller materials cloned per load, never disposed
`engine/world/24-crop-duster-banners.js:543-548` · perf/leak · confidence 0.7

Each load clones a `MeshLambertMaterial` per propeller (6-12 per load cycle) with no disposal when planes are cleared/reloaded. Accumulates over repeated banner/dusting cycles. Track them (`plane.propMaterials.push(mat)`) and dispose in the stop/clear path.

---

## LOW (refactor / cleanup — not verified individually, low blast radius)

- **L1** `engine/world/46-worlds-universe.js:74` — the `el()` helper exposes an `html` → `innerHTML` branch that's currently unused (grep: 0 callers). Latent XSS if anyone ever passes user text. Remove the branch or guard it; everything else in this file uses `textContent`.
- **L2** `engine/world/12-selection-tool.js:46` — `selectionOutlineMat` is shared and never disposed (minor; lives for the session). Document it as an intentional shared resource or dispose on teardown.
- **L3** `engine/world/41-flight-combat.js:754` — `applyDamage(..., _fcMTgtPos.clone(), 'missile')`: the `hitPos` parameter is accepted but unused (dead param), and the `.clone()` is needless garbage. The multiplayer-desync angle was refuted (no position leaves the sender). Drop the clone and the unused parameter.
- **L4** `engine/world/24-crop-duster-banners.js:552-553` — `new THREE.Box3()/Vector3()` per propeller in the load callback (not a per-frame path). Reuse module-scope scratch objects if you touch this code.
- **L5** `tools/check.js:224-229` — a missing (optional) `tinyworld-defaults.json` is reported as "not valid JSON" because the catch lumps ENOENT in with parse errors. Add an `fs.existsSync` check for a clearer message.
- **L6** `party/index.js:951-954` — open-testing mode assigns `profileId = 'guest:'+id` (truthy), so the `!p.profileId` harvest gate doesn't actually exclude guests. Harmless today because `flushPending()` is disabled in open mode (no durable economy), but the comment "guests cannot harvest" is misleading. Set `profileId = null` for declared-play guests if you want the gate to mean what it says.

---

## Verified-and-DISCARDED (false positives — shown so the check is auditable)

These were reported as critical/high by a reviewer and **rejected** after re-reading the real code:

- **dev-server "invalid OpenAI endpoint/model"** (`tools/dev-server.js:427,464,613`) — REJECTED. `/v1/responses` **is** the real OpenAI Responses API endpoint (the payload uses `input_text`, `reasoningEffort`, `textVerbosity`, `maxOutputTokens` — all Responses-API fields), and `gpt-5.5` is a deliberate model id. The verifier "confirmed" this from stale training knowledge that OpenAI only has `/v1/chat/completions`. Not a bug.
- **`worldHistoryMuted` stuck after pointercancel** (`engine/world/20-input-place-erase.js:1111`) — REJECTED. The finder claimed `worldHistoryMuted = false` was missing; it is present at line 1124 inside the `activePointers.size === 0` block. Undo/redo is fine.
- **Shield point-lights toggle `.visible` per-frame → r128 recompile cascade** (`engine/world/40-shield-system.js:67`) — REJECTED. Line 67 drives `.visible` from de-flickered `power` (monotonic during deploy), while flicker rides on intensity only — which is exactly the documented fix. No cascade.
- **`setCell` desync via direct `world[][]` writes** (`engine/world/20-input-place-erase.js:70,1229`) — REJECTED/downgraded. The cited writes are followed by a guaranteed `setCell` that performs the adjacency refresh and index maintenance; at most there's a minor double-render, not a correctness desync.
- **WindowInterior / islandShell shared-uniform mutation** (`engine/world/03-geometry-materials.js:711, 753`) — downgraded to LOW. Real shared-uniform *patterns* exist but are guarded in current usage (single-window-at-a-time `onBeforeRender`; the shell alias sits behind a guard that prevents the corrupting path). Latent maintenance risk, not an active bug — leave a comment rather than add defensive clones.

---

## Suggested order of work

1. **C2** (data loss — cheap, self-contained, protects user saves). 
2. **C1** (wallet 409 guard — small, closes the auth-integrity hole). 
3. **H2** (move gate — one guard, closes the trust-the-client hole; add the test). 
4. **H1 + H3 + M7** (the GPU-leak cluster — same dispose-the-thing-you-made pattern, do them together). 
5. **H4 / H5 / M2 / M4** (backend hardening — a focused half-day on `lib/http.mjs` + the two unbounded endpoints). 
6. **M1, M3, M5, M6** (security defense-in-depth). 
7. Low items as you next touch those files.

Each fix is small and local; none require touching the `world` / `cellMeshes` / `setCell` public contract or bumping Three.js off r128.
