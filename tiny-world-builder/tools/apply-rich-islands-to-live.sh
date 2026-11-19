#!/bin/bash
set -e

echo "=== Apply rich Tinyverse islands + hub + stargates to LIVE Netlify DB ==="
echo ""
echo "1. Go to Netlify dashboard → tiny-world-builder site → Databases"
echo "2. Copy the Production connection string (it starts with postgres://...)"
echo ""

read -p "Paste the live Netlify DB connection string here: " LIVE_DB_URL

if [ -z "$LIVE_DB_URL" ]; then
  echo "No URL provided. Exiting."
  exit 1
fi

echo ""
echo "Applying migration to LIVE..."
if psql "$LIVE_DB_URL" -f netlify/database/migrations/20260620143000_rich_tinyverse_islands.sql; then
  echo ""
  echo "✅ SUCCESS. The rich islands + Tinyverse Nexus (hub) with stargates are now in the live DB."
  echo "Test at: https://mmo-preview--tiny-world-builder.netlify.app"
  echo "Look for 'Tinyverse Nexus (Hub)' in the published worlds list."
else
  echo ""
  echo "❌ psql failed. Check the error above."
  exit 1
fi
