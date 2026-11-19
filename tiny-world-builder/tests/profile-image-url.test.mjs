import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfileImageUrl, profileDto } from '../netlify/functions/lib/profiles.mjs';

const SITE_ENV_KEYS = ['TINYWORLD_SITE_URL', 'URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL'];

function withSiteEnv(env, fn) {
  const old = {};
  for (const key of SITE_ENV_KEYS) {
    old[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    fn();
  } finally {
    for (const key of SITE_ENV_KEYS) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}

test('normalizes preset avatar paths against the configured site origin', () => {
  withSiteEnv({ TINYWORLD_SITE_URL: 'https://tinyworld.build' }, () => {
    assert.equal(
      normalizeProfileImageUrl('/assets/avatars/wizard.png'),
      'https://tinyworld.build/assets/avatars/wizard.png',
    );
    assert.equal(
      normalizeProfileImageUrl('assets/avatars/wizard.png'),
      'https://tinyworld.build/assets/avatars/wizard.png',
    );
    assert.equal(normalizeProfileImageUrl('/assets/avatars/notakey.png'), '/assets/avatars/notakey.png');
  });
});

test('keeps already absolute profile image URLs unchanged', () => {
  withSiteEnv({ TINYWORLD_SITE_URL: 'https://tinyworld.build' }, () => {
    assert.equal(
      normalizeProfileImageUrl('https://cdn.example.test/avatars/wizard.png'),
      'https://cdn.example.test/avatars/wizard.png',
    );
    assert.equal(
      normalizeProfileImageUrl('http://localhost:8888/assets/avatars/wizard.png'),
      'http://localhost:8888/assets/avatars/wizard.png',
    );
  });
});

test('does not bless arbitrary relative profile image paths', () => {
  withSiteEnv({ TINYWORLD_SITE_URL: 'https://tinyworld.build' }, () => {
    assert.equal(normalizeProfileImageUrl('/uploads/custom.png'), '/uploads/custom.png');
    assert.equal(normalizeProfileImageUrl('javascript:alert(1)'), 'javascript:alert(1)');
  });
});

test('keeps empty profile image values as strings', () => {
  assert.equal(normalizeProfileImageUrl(null), '');
  assert.equal(normalizeProfileImageUrl(undefined), '');
  assert.equal(profileDto({ image: null }).image, '');
  assert.equal(profileDto({ image: undefined }).image, '');
});
