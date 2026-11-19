# Forced onboarding + email-verification gate — plan

Target: on next login, every user is prompted to set/confirm X handle, avatar,
about, email, display name; then verify email. Skippable (costs early-update /
special-offer access). Hard rule: no verified email -> cannot view OR use
chat/community (server-enforced).

Grounded in read-only investigation (codex), origin/main bb84f72.

## What already exists (good news)
- Auth: Netlify Identity + Phantom wallet. Post-login seam = `enterApp()`
  (engine/world/30-ui-boot-wiring.js). Server identity = `getAuthUser()` /
  `requireAuthUser()` (netlify/functions/lib/auth.mjs).
- Profile model already has: display_name, about, image, twitter, github,
  email, and a voxel-avatar JSONB column. (`profiles` table + profiles.mjs.)
- Avatar picker exists and is reusable: `WS.openAvatarPicker()`
  (engine/world/49-worlds-avatar-picker.js) -> voxel descriptor -> /api/avatar.
- Onboarding precedent: community ALREADY force-completes a missing Twitter
  handle (community.html). Builder account modal + community edit-profile modal
  already collect display name / about / photo / Twitter / GitHub.
- Admin email is server-verified centrally via `isWorldAdminEmail()` — reuse
  this server-trust pattern for the email gate.

## What's missing
- No `email_verified_at`, no onboarding-status fields, no verification-token table.
- No email field in any existing profile UI; no email-verification UI.
- No server-side email-verified check anywhere on community/worlds/players/livekit.
- `/api/profile` `image` is URL-only (rejects data URLs) — avatar onboarding
  should go through `/api/avatar` (voxel), not the image field.

## THE BLOCKING DECISION: how do we send the verification email?
There is NO custom transactional email capability today (no Resend/Postmark/
SendGrid/SES/SMTP). Two paths:

- **Option A — Netlify Identity built-in confirmation (no new infra, no API key).**
  Identity already sends its own signup-confirmation email and exposes
  `confirmed_at`. `email_verified` = Identity confirmed_at.
  - Pros: zero new infra, nothing to wire, no key.
  - Cons: only covers Identity email/password (and OAuth) users. **Wallet
    (Phantom) users have no email and no Identity record**, so they can't be
    verified this way. Also requires Identity email templates enabled in the
    Netlify dashboard.

- **Option B — Transactional provider (e.g. Resend) + token table (recommended
  if email is required for EVERYONE incl. wallet users).**
  - Needs: a provider account + API key (from you), a `sendVerificationEmail()`,
    a `email_verification_tokens` table, request/verify endpoints, and a
    server-side `requireVerifiedEmail()` helper.
  - Pros: works for all users incl. wallet; full control of template/flow.
  - Cons: new dependency + key + a bit more build.

Recommendation: **Option B (Resend)** since the requirement is "everyone provides
+ validates email" and many users are wallet-only. Could combine: treat Identity
`confirmed_at` as already-verified to avoid double-emailing those users.

Second flag: there is **no X/Twitter OAuth** — "update Twitter name" is a
self-entered handle, NOT a verified X identity. True ownership verification would
need X OAuth (separate, larger). Assume self-entered handle unless you want OAuth.

## Phased build (after you pick A/B and approve)
- **P-A (migration, additive):** add `profiles.email_verified_at`,
  `onboarding_completed_at`, `onboarding_skipped_at`; if Option B, add
  `email_verification_tokens(profile_id,email,token_hash,expires_at,used_at)`.
- **P-B (email capability, Option B only):** provider + `sendVerificationEmail()`
  + `POST /api/email-verification/request` + `GET/POST .../verify` +
  `requireVerifiedEmail()` helper.
- **P-C (onboarding UI):** forced modal from `enterApp()` (builder) + extend the
  existing community forced-profile modal: X handle, avatar (reuse
  `WS.openAvatarPicker()`), about, email, display name, "verify email" action,
  and a Skip that records `onboarding_skipped_at` and explains the cost.
- **P-D (hard gates, server-side):** in community.mjs block bootstrap/rooms/
  members/dms/messages (GET) + all participation (POST) unless `email_verified_at`
  is set; in worlds.mjs do NOT mint play/build join tokens for unverified users
  (this blocks live world chat via PartyKit, which trusts the signed token);
  also gate /api/players and /api/livekit/token. Client hides chat/community
  entry points as UX, but the server check is the real gate.

Each phase = its own PR, cross-reviewed, human-merged. P-A and P-C-skeleton can
start in parallel; P-D depends on P-A; P-B depends on the provider decision.
