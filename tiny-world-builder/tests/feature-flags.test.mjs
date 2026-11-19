import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_IDS,
  featureFlagsDto,
  isFeatureFlagEnabled,
  sanitizeFeatureFlags,
} from '../netlify/functions/lib/feature-flags.mjs';
import { readBundledFeatureFlags } from '../netlify/functions/lib/feature-flags-store.mjs';

test('sanitizeFeatureFlags fills every known id with defaults', () => {
  const doc = sanitizeFeatureFlags({ flags: { ai: { everyone: true, admin: false } } });
  assert.equal(Object.keys(doc.flags).length, FEATURE_FLAG_IDS.length);
  assert.equal(doc.flags.ai.everyone, true);
  assert.equal(doc.flags.ai.admin, false);
  assert.equal(doc.flags.settings.everyone, false);
  assert.equal(doc.flags.settings.admin, true);
});

test('isFeatureFlagEnabled respects everyone and admin preview', () => {
  const flags = { ai: { everyone: false, admin: true }, settings: { everyone: true, admin: false } };
  assert.equal(isFeatureFlagEnabled(flags, 'ai', false), false);
  assert.equal(isFeatureFlagEnabled(flags, 'ai', true), true);
  assert.equal(isFeatureFlagEnabled(flags, 'settings', false), true);
  assert.equal(isFeatureFlagEnabled(flags, 'settings', true), true);
});

test('featureFlagsDto exposes enabled map for clients', () => {
  const dto = featureFlagsDto({ flags: DEFAULT_FEATURE_FLAGS }, true);
  assert.equal(dto.enabled.ai, false);
  assert.equal(dto.enabled.generatePrompt, false);
  assert.equal(dto.enabled.settings, true);
  assert.ok(Array.isArray(dto.ids));
});

test('readBundledFeatureFlags loads shipped defaults', () => {
  const doc = readBundledFeatureFlags();
  assert.equal(Object.keys(doc.flags).length, FEATURE_FLAG_IDS.length);
  assert.equal(doc.flags.settings.everyone, false);
  assert.equal(doc.flags.settings.admin, true);
  assert.equal(doc.flags.ai.admin, false);
});