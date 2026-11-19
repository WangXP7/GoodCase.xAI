#!/usr/bin/env bash
# Apply all (idempotent) migrations to the LIVE Netlify/Neon Postgres.
#
# Usage:
#   LIVE_DB_URL="postgres://user:pass@host/db?sslmode=require" tools/apply-migrations-to-live.sh
#   tools/apply-migrations-to-live.sh "postgres://user:pass@host/db?sslmode=require"
#
# Each migration runs in its own psql invocation. Benign "already exists" /
# "duplicate" errors on previously-applied migrations are tolerated so the run
# never aborts; genuine errors are surfaced per-file at the end.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/netlify/database/migrations"

DB_URL="${LIVE_DB_URL:-${1:-}}"
if [ -z "$DB_URL" ]; then
  echo "error: no connection string. Set LIVE_DB_URL or pass it as arg 1." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
fi
command -v psql >/dev/null 2>&1 || { echo "error: psql not found (brew install libpq)" >&2; exit 1; }

# Verify connectivity (don't print the URL).
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "error: cannot connect to the live database with the provided string." >&2
  exit 1
fi
echo "✓ Connected to live database"
echo ""

# Ordered list of migrations by leading timestamp.
mapfile -t ORDERED < <(
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$f" ] || continue
    ts="$(basename "$f" | grep -oE '^[0-9]+' || true)"
    [ -n "$ts" ] && printf '%s\t%s\n' "$ts" "$f"
  done | sort -k1,1n | cut -f2-
)

[ "${#ORDERED[@]}" -gt 0 ] || { echo "error: no migrations found" >&2; exit 1; }

PASS=(); SKIP=(); FAIL=()
for f in "${ORDERED[@]}"; do
  name="$(basename "$f")"
  out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"
  rc=$?
  if [ $rc -eq 0 ]; then
    echo "  ✓ $name"
    PASS+=("$name")
  elif echo "$out" | grep -qiE "already exists|duplicate|does not exist.*skipping"; then
    echo "  • $name (already applied — skipped)"
    SKIP+=("$name")
  else
    echo "  ✗ $name"
    echo "$out" | sed 's/^/      /' | tail -5
    FAIL+=("$name")
  fi
done

echo ""
echo "=== Summary ==="
echo "Applied: ${#PASS[@]}   Skipped(already applied): ${#SKIP[@]}   Failed: ${#FAIL[@]}"
if [ "${#FAIL[@]}" -gt 0 ]; then
  printf 'FAILED: %s\n' "${FAIL[@]}"
  exit 1
fi

echo ""
echo "=== Verify key state ==="
psql "$DB_URL" -tAc "SELECT 'profiles.lobby_access default = ' || COALESCE((SELECT column_default FROM information_schema.columns WHERE table_name='profiles' AND column_name='lobby_access'),'(none)');"
psql "$DB_URL" -tAc "SELECT 'published starter worlds: ' || count(*) FROM worlds WHERE kind='starter' AND status='published';"
psql "$DB_URL" -tAc "SELECT 'tinyverse-nexus present: ' || (count(*)>0)::text FROM worlds WHERE slug='tinyverse-nexus';"
psql "$DB_URL" -tAc "SELECT 'worlds.last_tax_change column: ' || (count(*)>0)::text FROM information_schema.columns WHERE table_name='worlds' AND column_name='last_tax_change';"
echo ""
echo "✅ Done."
