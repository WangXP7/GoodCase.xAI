import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moderationMigration = readFileSync(
  new URL('../netlify/database/migrations/20260616010000_community_message_moderation.sql', import.meta.url),
  'utf8',
);

// Netlify applies SQL migrations before any function can lazily create tables.
test('community moderation migration creates base messages table before altering it', () => {
  const createIndex = moderationMigration.indexOf('CREATE TABLE IF NOT EXISTS community_messages');
  const alterIndex = moderationMigration.indexOf('ALTER TABLE community_messages ADD COLUMN IF NOT EXISTS hidden_at');

  assert.ok(createIndex >= 0, 'migration must create community_messages for fresh deploys');
  assert.ok(alterIndex >= 0, 'migration must add moderation columns');
  assert.ok(createIndex < alterIndex, 'community_messages must exist before ALTER TABLE runs');
});
