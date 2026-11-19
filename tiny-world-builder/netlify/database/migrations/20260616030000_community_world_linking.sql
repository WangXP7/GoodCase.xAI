-- Link a community chat room to a 3D world by slug. Drives the community page's
-- live CCTV feeds panel (an iframe of tiny-world-builder.html?world=SLUG&view=cctv).
-- Nullable: a room with no linked world simply shows no feeds. Mirrored lazily by
-- ensureTables() in netlify/functions/community.mjs for older local databases.
ALTER TABLE community_rooms ADD COLUMN IF NOT EXISTS world_slug TEXT;
