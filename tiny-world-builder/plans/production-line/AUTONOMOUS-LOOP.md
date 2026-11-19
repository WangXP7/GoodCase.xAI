# Autonomous production-line loop — SAFE SCOPE

Owner-approved scope (chosen 2026-06-25): **real continuous delivery, but no irreversible
or public actions without a human.** This documents what the loop does, the guardrails,
and how to enable / dial up / turn off.

## What runs

`.github/workflows/production-line.yml` — a scheduled GitHub Action (hourly, `:17`) +
a manual "Run workflow" button.

### Always (no secrets, default on once the workflow is on the default branch)
- `tools/production-line-tick.mjs`:
  - Drafts a **news entry + tweet** from the latest ship into `plans/production-line/drafts/` — for you to review and post. **It never publishes news or posts to any social account.**
  - Refreshes `status.json` (the mission-control dashboard stays live).
  - Surfaces the next non-economy queue item.
  - **Economy tripwire**: exits non-zero if the latest change touched a protected money path.
- Commits the drafts + dashboard refresh back to `main` (these are non-economy tracking files only).

### Opt-in only — autonomous code-build
Runs **only** if BOTH are set on the repo:
- variable `PRODUCTION_LINE_AUTONOMOUS = true`
- secret `ANTHROPIC_API_KEY`

When on, a headless agent picks the next **non-economy** roadmap item, builds it, and runs
`npm run check` + the test suite until green, then opens a PR. It does **not** auto-merge
(left to your repo policy), publish news, or post socially.

## Guardrails (defense in depth)
1. **Economy denylist** (`ECONOMY_PROTECTED` in `tools/production-line-tick.mjs`): coins,
   gold, gold-payout, gold-spend, referral, ai-generate, world-remix, world-template,
   stripe-*, resources-sell, coins-transfer, their libs, all DB migrations, and mmo-core.
2. **Independent ship-guard**: even if the agent ignored its instructions, the workflow
   re-checks the diff against the denylist and **blocks the ship** if any protected path
   changed.
3. **Build gate**: `npm run check` (dup-identifier + i18n) and `node --test tests/*.test.mjs`
   must pass before anything is pushed.
4. **No public side effects**: social content is draft-only; the gated economy is never
   touched autonomously; no auto-merge.

## Dials
- **Cadence**: edit the `cron:` in the workflow.
- **Turn the build step on**: set the variable + secret above.
- **Full autonomy** (auto-publish news + auto-post tweets): NOT enabled here by design —
  that needs X/Twitter keys and a separate, explicit owner decision (the "fully
  autonomous" option). Until then this stays safe-scope.
- **Off**: disable the workflow in the Actions tab, or delete the file.

## What still needs you
- Reviewing/posting the queued drafts (`plans/production-line/drafts/`, `tweets/`).
- Stripe keys (payments) and X/Twitter keys (auto-posting) — unchanged.
- Merging the autonomous PRs (or enabling auto-merge in repo settings if you want it).
