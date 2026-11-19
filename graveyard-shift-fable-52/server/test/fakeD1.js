// In-memory stand-in for a Cloudflare D1 binding, for tests only.
//
// It implements the slice of the D1 Worker API the server uses (prepare / bind / first /
// all / run / batch / exec) on top of Node's built-in SQLite (node:sqlite, Node >= 22.13),
// so the real schema.sql runs and SQLite itself enforces UNIQUE, CHECK and foreign keys.
// Mirrors documented D1 behaviour:
//   - bind() accepts string | number | boolean | null | ArrayBuffer; undefined is an error
//   - first() returns the first row or null; first(col) returns that column's value
//   - run()/all() return { success, meta: { changes, last_row_id, ... }, results }
//   - batch() runs statements in order inside one transaction and rolls back on error
//   - errors carry a "D1_ERROR: <sqlite message>" message

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEMA = fileURLToPath(new URL('../schema.sql', import.meta.url));

function d1Error(e) {
  const err = new Error(`D1_ERROR: ${e.message}`);
  err.cause = e;
  return err;
}

const plain = (row) => (row ? { ...row } : row);

class FakeStatement {
  constructor(d1, sql, params = []) {
    this.d1 = d1;
    this.sql = sql;
    this.params = params;
  }

  bind(...values) {
    for (const v of values) {
      const ok = v === null || ['string', 'number', 'boolean'].includes(typeof v) || v instanceof ArrayBuffer;
      if (!ok) throw new Error(`D1_TYPE_ERROR: Type '${typeof v}' not supported for value '${v}'`);
    }
    const mapped = values.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0)
      : v instanceof ArrayBuffer ? new Uint8Array(v) : v));
    return new FakeStatement(this.d1, this.sql, mapped);
  }

  _exec() {
    this.d1.queries.push(this.sql);
    let stmt;
    try {
      stmt = this.d1.sqlite.prepare(this.sql);
    } catch (e) {
      throw d1Error(e);
    }
    const returnsRows = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql);
    try {
      if (returnsRows) {
        const results = stmt.all(...this.params).map(plain);
        return { success: true, results, meta: { changes: 0, last_row_id: 0, duration: 0 } };
      }
      const info = stmt.run(...this.params);
      return {
        success: true,
        results: [],
        meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid), duration: 0 },
      };
    } catch (e) {
      throw d1Error(e);
    }
  }

  async first(column) {
    const { results } = this._exec();
    const row = results[0];
    if (!row) return null;
    if (column === undefined) return row;
    if (!(column in row)) throw new Error(`D1_ERROR: Column not found: ${column}`);
    return row[column];
  }

  async all() {
    return this._exec();
  }

  async run() {
    return this._exec();
  }

  async raw() {
    return this._exec().results.map((r) => Object.values(r));
  }
}

export class FakeD1 {
  constructor({ schema = true } = {}) {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    this.queries = [];
    if (schema) this.sqlite.exec(readFileSync(SCHEMA, 'utf8'));
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map((s) => s._exec());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql) {
    this.sqlite.exec(sql);
    return { count: sql.split('\n').filter((l) => l.trim()).length, duration: 0 };
  }

  // Test helper: synchronous SELECT straight against SQLite.
  rows(sql, ...params) {
    return this.sqlite.prepare(sql).all(...params).map(plain);
  }
}
