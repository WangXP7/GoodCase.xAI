#!/usr/bin/env node
// Production-line tick — the SAFE-SCOPE autonomous loop (owner-approved scope).
//
// What it does each run (all reversible, nothing public, nothing economy):
//   1. Reads the most recent ship (latest commit) and writes a NEWS draft + a TWEET
//      draft to plans/production-line/drafts/ for the owner to review/post. It never
//      publishes news or posts to any social account.
//   2. Updates plans/production-line/status.json (lastTick + a feed line) so the
//      mission-control dashboard stays live.
//   3. Surfaces the next NON-economy queue item.
//   4. Runs the ECONOMY DENYLIST guard over the latest change and REFUSES (exit 2) if a
//      protected money path was touched outside a human-reviewed flow — a tripwire.
//
// The autonomous CODE-BUILD step is intentionally NOT here: it lives in the GitHub
// Actions workflow behind an explicit opt-in var + the API key, and is constrained to
// non-economy paths. This script is safe to run unattended with no secrets.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PL = join(ROOT, 'plans', 'production-line');
const DRAFTS = join(PL, 'drafts');

// HARD denylist: the gated economy / money paths. The autonomous loop must never modify
// these without a human in the loop. Used as a tripwire here and as the ship-guard in CI.
export const ECONOMY_PROTECTED = [
  /netlify\/functions\/(coins|gold|gold-payout|gold-spend|referral|ai-generate|world-remix|world-template|stripe-checkout|stripe-webhook|resources-sell|coins-transfer)\.mjs$/,
  /netlify\/functions\/lib\/(coins|referrals|ai|stripe|resources|tinyverse-access)\.mjs$/,
  /netlify\/database\/migrations\//,
  /packages\/tinyworld-mmo-core\//,
];

export function touchesEconomy(files) {
  return files.filter((f) => ECONOMY_PROTECTED.some((re) => re.test(f)));
}

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'update';
}

function main() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16); // YYYY-MM-DDTHH-MM
  const subject = git('log -1 --pretty=%s');
  const bodyFirst = git('log -1 --pretty=%b').split('\n').find((l) => l.trim()) || '';
  const changed = git('diff --name-only HEAD~1 HEAD').split('\n').filter(Boolean);

  // Tripwire: report (do not crash the dashboard update) if the latest change touched a
  // protected money path. In CI the ship-guard turns this into a hard block.
  const econ = touchesEconomy(changed);

  if (!existsSync(DRAFTS)) mkdirSync(DRAFTS, { recursive: true });

  // News + tweet DRAFTS (never published) derived from the latest ship.
  const title = subject.replace(/^(feat|fix|chore|news|docs)(\([^)]*\))?:\s*/i, '');
  const draftPath = join(DRAFTS, `${stamp}-${slugify(title)}.md`);
  const newsDraft = [
    `# DRAFT (review before publishing) — ${now.toUTCString()}`,
    '',
    `## News draft`,
    `**Headline:** ${title}`,
    '',
    bodyFirst || `We shipped: ${title}.`,
    '',
    `## Tweet draft`,
    `${title} just shipped on TinyWorld. ${bodyFirst ? bodyFirst.slice(0, 160) : ''}`.trim().slice(0, 270),
    '',
    `_Source commit: ${git('log -1 --pretty=%h')} — ${subject}_`,
    econ.length ? `\n> NOTE: this change touched protected economy paths: ${econ.join(', ')} (expected only via human-reviewed flow).` : '',
  ].join('\n');
  writeFileSync(draftPath, newsDraft);

  // Keep the dashboard live: bump lastTick + append a feed line.
  const statusPath = join(PL, 'status.json');
  let status = {};
  try { status = JSON.parse(readFileSync(statusPath, 'utf8')); } catch (_) { status = { feed: [] }; }
  status.lastTick = now.toISOString();
  status.feed = status.feed || [];
  status.feed.unshift({
    ts: now.toISOString(),
    kind: 'tick',
    text: `Autonomous tick (safe scope): drafted news/tweet for "${title}" -> ${draftPath.replace(ROOT + '/', '')}. ${econ.length ? 'ECONOMY TRIPWIRE: ' + econ.join(', ') : 'No economy paths touched.'}`,
  });
  status.feed = status.feed.slice(0, 40);
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n');

  // Surface the next NON-economy queue item (best-effort, from the pipeline).
  const next = (status.pipeline || []).find((p) => p && p.status && p.status !== 'shipped' && !/econom|gold|coin|stripe|referr|remix|template|ai-/i.test(`${p.id} ${p.title}`));
  console.log(`[tick] drafted: ${draftPath.replace(ROOT + '/', '')}`);
  console.log(`[tick] next non-economy item: ${next ? next.id + ' — ' + next.title : '(none queued)'}`);
  if (econ.length) {
    console.error(`[tick] ECONOMY TRIPWIRE — protected paths in latest change: ${econ.join(', ')}`);
    process.exitCode = 2; // CI ship-guard treats this as a block
  }
}

// Only run when invoked directly (so the guard helpers can be imported + tested).
if (process.argv[1] && process.argv[1].endsWith('production-line-tick.mjs')) main();
