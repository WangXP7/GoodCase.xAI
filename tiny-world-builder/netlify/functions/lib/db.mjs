import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { getConnectionString } from '@netlify/database';

let _twSql = null;

function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    if (globalThis.Netlify && Netlify.env && typeof Netlify.env.get === 'function') {
      const value = Netlify.env.get(name);
      if (value) return value;
    }
  } catch (_) {}
  return '';
}

function envFileValue(name) {
  const starts = [];
  try { starts.push(process.cwd()); } catch (_) {}
  try { starts.push(path.dirname(fileURLToPath(import.meta.url))); } catch (_) {}
  const seen = new Set();
  const re = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=(.*)$', 'm');
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 10; i++) {
      const file = path.join(dir, '.env');
      if (!seen.has(file)) {
        seen.add(file);
        try {
          const match = fs.readFileSync(file, 'utf8').match(re);
          if (match) return match[1].trim().replace(/^["']|["']$/g, '');
        } catch (_) {}
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return '';
}

function connectionStringFromEnv() {
  for (const name of ['NETLIFY_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'NETLIFY_DATABASE_URL']) {
    const value = envValue(name);
    if (value) return value;
  }
  for (const name of ['NETLIFY_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'NETLIFY_DATABASE_URL']) {
    const value = envFileValue(name);
    if (value) return value;
  }
  return getConnectionString();
}

export function isDatabaseUnavailable(err) {
  return !!(err && (
    err.name === 'MissingDatabaseConnectionError'
    || /Netlify Database/i.test(String(err.message || ''))
    || /NETLIFY_DB_URL/i.test(String(err.message || ''))
  ));
}

export function isMissingRelation(err, relationName) {
  if (!err || err.code !== '42P01') return false;
  const name = String(relationName || '').trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('relation "' + escaped + '" does not exist', 'i').test(String(err.message || ''));
}

export function isMissingRelations(err, relationNames) {
  return Array.isArray(relationNames) && relationNames.some(name => isMissingRelation(err, name));
}

export function getSql() {
  if (!_twSql) {
    const connectionString = connectionStringFromEnv();
    _twSql = postgres(connectionString, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return _twSql;
}
