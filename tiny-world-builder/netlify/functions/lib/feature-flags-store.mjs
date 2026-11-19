import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSql, isDatabaseUnavailable, isMissingRelation } from './db.mjs';
import {
  DEFAULT_FEATURE_FLAGS,
  sanitizeFeatureFlags,
} from './feature-flags.mjs';

const BLOB_STORE = 'tinyworld-config';
const BLOB_KEY = 'site-feature-flags.json';

const _featureFlagsStoreDir = path.dirname(fileURLToPath(import.meta.url));
const bundledFlagPaths = [
  path.resolve(_featureFlagsStoreDir, '../data/tinyworld-feature-flags.json'),
  path.resolve(_featureFlagsStoreDir, '../../../tinyworld-feature-flags.json'),
];

export function readBundledFeatureFlags() {
  for (const bundledFlagsPath of bundledFlagPaths) {
    try {
      if (!fs.existsSync(bundledFlagsPath)) continue;
      return sanitizeFeatureFlags(JSON.parse(fs.readFileSync(bundledFlagsPath, 'utf8')));
    } catch (_) {}
  }
  return sanitizeFeatureFlags({ flags: DEFAULT_FEATURE_FLAGS });
}

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS site_feature_flags (
      id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      flags      JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function readFlagsFromDb(sql) {
  const rows = await sql`SELECT flags, updated_at FROM site_feature_flags WHERE id = 1 LIMIT 1`;
  if (!rows.length) return null;
  return sanitizeFeatureFlags({
    updatedAt: rows[0].updated_at,
    flags: rows[0].flags,
  });
}

function jsonbParam(sql, value) {
  if (sql && typeof sql.json === 'function') return sql.json(value);
  return value;
}

async function writeFlagsToDb(sql, doc) {
  const clean = sanitizeFeatureFlags(doc);
  await sql`
    INSERT INTO site_feature_flags (id, flags, updated_at)
    VALUES (1, ${jsonbParam(sql, clean.flags)}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      flags = EXCLUDED.flags,
      updated_at = NOW()
  `;
  const saved = await readFlagsFromDb(sql);
  return saved || clean;
}

function envValue(name) {
  try {
    if (globalThis.Netlify && Netlify.env && typeof Netlify.env.get === 'function') {
      const value = Netlify.env.get(name);
      if (value) return value;
    }
  } catch (_) {}
  return process.env[name] || '';
}

async function blobModule() {
  try {
    return await import('@netlify/blobs');
  } catch (err) {
    console.error('[feature-flags] blobs module unavailable:', err);
    return null;
  }
}

async function blobStore() {
  const mod = await blobModule();
  if (!mod || typeof mod.getStore !== 'function') return null;
  const siteID = envValue('SITE_ID') || envValue('NETLIFY_SITE_ID');
  const token = envValue('NETLIFY_AUTH_TOKEN') || envValue('NETLIFY_API_TOKEN');
  if (siteID && token) {
    return mod.getStore({ name: BLOB_STORE, siteID, token });
  }
  return mod.getStore(BLOB_STORE);
}

async function readFlagsFromBlob() {
  try {
    const store = await blobStore();
    if (!store) return null;
    const raw = await store.get(BLOB_KEY, { type: 'text' });
    if (!raw) return null;
    return sanitizeFeatureFlags(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

async function writeFlagsToBlob(doc) {
  const clean = sanitizeFeatureFlags(doc);
  const store = await blobStore();
  if (!store) throw new Error('Netlify Blobs is not configured for this deploy');
  await store.set(BLOB_KEY, JSON.stringify(clean));
  return clean;
}

function isDbPersistenceError(err) {
  return isDatabaseUnavailable(err) || isMissingRelation(err, 'site_feature_flags');
}

function flagDocTime(doc) {
  const value = Date.parse(String(doc && doc.updatedAt || ''));
  return Number.isFinite(value) ? value : 0;
}

function pickPersistedDoc(fromDb, fromBlob) {
  if (fromDb && fromBlob) {
    if (flagDocTime(fromBlob) > flagDocTime(fromDb)) return { doc: fromBlob, source: 'blob' };
    return { doc: fromDb, source: 'db' };
  }
  if (fromDb) return { doc: fromDb, source: 'db' };
  if (fromBlob) return { doc: fromBlob, source: 'blob' };
  return null;
}

export async function loadPersistedFeatureFlags() {
  let fromDb = null;
  let fromBlob = null;
  try {
    const sql = getSql();
    await ensureTable(sql);
    fromDb = await readFlagsFromDb(sql);
  } catch (err) {
    if (!isDbPersistenceError(err)) console.error('[feature-flags] DB read error:', err);
  }
  fromBlob = await readFlagsFromBlob();
  const picked = pickPersistedDoc(fromDb, fromBlob);
  if (picked) return picked;
  return { doc: readBundledFeatureFlags(), source: 'bundled' };
}

export async function savePersistedFeatureFlags(doc) {
  const clean = sanitizeFeatureFlags(doc);
  let saved = null;
  let source = null;
  const errors = [];

  try {
    const sql = getSql();
    await ensureTable(sql);
    saved = await writeFlagsToDb(sql, clean);
    source = 'db';
  } catch (err) {
    errors.push(err);
    if (!isDbPersistenceError(err)) console.error('[feature-flags] DB write error:', err);
  }

  try {
    const blobSaved = await writeFlagsToBlob(clean);
    if (!saved) {
      saved = blobSaved;
      source = 'blob';
    }
  } catch (err) {
    errors.push(err);
    if (!saved) console.error('[feature-flags] blob write error:', err);
  }

  if (!saved) {
    const detail = errors
      .map((err) => String(err && err.message ? err.message : err))
      .filter(Boolean)
      .join(' | ')
      .slice(0, 240);
    throw new Error(detail || 'Failed to save feature flags — database and blob storage are unavailable');
  }

  return { doc: saved, source };
}