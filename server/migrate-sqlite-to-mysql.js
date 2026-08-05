#!/usr/bin/env node
/**
 * One-time data migration: copies all rows from the legacy SQLite database
 * (server/mrfiber.db) into the MySQL database configured via .env (DB_*).
 *
 * Usage (from the project root):
 *   node server/migrate-sqlite-to-mysql.js
 *
 * Safe to re-run: every insert uses INSERT IGNORE, so existing rows (matched by
 * primary key / unique key) are skipped rather than duplicated. Original ids and
 * created_at timestamps are preserved so foreign references and ordering stay
 * stable.
 *
 * Requires better-sqlite3 (already a dependency) to read the old file.
 */
require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const db = require('./db'); // creates the MySQL pool and the schema

// Column lists mirror the schema. `id` and `created_at` are carried over
// verbatim to keep primary keys and timestamps identical to the source.
// `upsert` columns are overwritten when a row with the same key already exists,
// so the source data (not db.js's seeded default admin) is authoritative.
const TABLES = [
  { name: 'users', cols: ['id', 'username', 'password_hash'], upsert: ['password_hash'] },
  { name: 'vpn_profiles', cols: ['id', 'name', 'server_address', 'username', 'password', 'created_at'] },
  { name: 'olt_configs', cols: ['id', 'name', 'ip_address', 'telnet_port', 'username', 'password'] },
];

async function main() {
  const sqlitePath = path.join(__dirname, 'mrfiber.db');
  console.log(`[migrate] Source SQLite : ${sqlitePath}`);
  console.log(`[migrate] Target MySQL  : ${process.env.DB_NAME} @ ${process.env.DB_HOST}:${process.env.DB_PORT}`);

  // Ensure the MySQL schema exists before inserting.
  await db.ready;

  let sdb;
  try {
    sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error(`[migrate] Could not open SQLite file: ${e.message}`);
    console.error('[migrate] If there is no legacy data to migrate, nothing to do.');
    await db.pool.end();
    process.exit(1);
  }

  let grandTotal = 0;
  for (const table of TABLES) {
    let rows;
    try {
      rows = sdb.prepare(`SELECT * FROM ${table.name}`).all();
    } catch (e) {
      console.log(`[migrate] ${table.name}: skipped (${e.message})`);
      continue;
    }

    let inserted = 0;
    for (const row of rows) {
      // Only migrate columns that are actually present on the source row.
      const cols = table.cols.filter((c) => row[c] !== undefined);
      const placeholders = cols.map(() => '?').join(', ');
      const params = cols.map((c) => (row[c] === undefined ? null : row[c]));
      // Upsert tables overwrite the listed columns on key collision; others use
      // INSERT IGNORE so re-runs skip rows already present.
      const upsertCols = (table.upsert || []).filter((c) => cols.includes(c));
      const sql = upsertCols.length
        ? `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders}) ` +
          `ON DUPLICATE KEY UPDATE ${upsertCols.map((c) => `${c}=VALUES(${c})`).join(', ')}`
        : `INSERT IGNORE INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders})`;
      const [result] = await db.pool.execute(sql, params);
      if (result.affectedRows > 0) inserted += 1;
    }

    grandTotal += inserted;
    console.log(`[migrate] ${table.name}: ${inserted} inserted, ${rows.length - inserted} skipped (already present), ${rows.length} total in source`);
  }

  // Verify counts on the MySQL side.
  console.log('[migrate] --- MySQL row counts after migration ---');
  for (const table of TABLES) {
    const [[{ n }]] = await db.pool.query(`SELECT COUNT(*) AS n FROM ${table.name}`);
    console.log(`[migrate]   ${table.name}: ${n}`);
  }

  sdb.close();
  await db.pool.end();
  console.log(`[migrate] Done. ${grandTotal} new row(s) inserted.`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[migrate] FAILED:', err.message);
  try { await db.pool.end(); } catch (_e) { /* ignore */ }
  process.exit(1);
});
