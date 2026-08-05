require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

// ---------------------------------------------------------------------------
// MySQL connection pool.
//
// The app previously used better-sqlite3, whose API is fully synchronous.
// MySQL access over the network is inherently asynchronous, so this module
// exposes a small Promise-based shim (`prepare(sql).get/all/run`) that mirrors
// the better-sqlite3 surface the rest of the codebase already calls — the only
// change required at each call site is adding `await`.
// ---------------------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kmcable',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  // Keep the pool healthy across idle periods / server-side timeouts.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// mysql2's execute() (prepared-statement protocol) throws on `undefined`
// bind parameters. better-sqlite3 tolerated them, so normalise undefined→null.
function clean(params) {
  return params.map((p) => (p === undefined ? null : p));
}

/**
 * better-sqlite3-compatible statement shim.
 *   db.prepare(sql).get(...args)  -> first row (or undefined)
 *   db.prepare(sql).all(...args)  -> array of rows
 *   db.prepare(sql).run(...args)  -> { lastInsertRowid, changes }
 * All three are async — call sites must `await` them.
 */
function prepare(sql) {
  return {
    async get(...params) {
      const [rows] = await pool.execute(sql, clean(params));
      return rows[0];
    },
    async all(...params) {
      const [rows] = await pool.execute(sql, clean(params));
      return rows;
    },
    async run(...params) {
      const [result] = await pool.execute(sql, clean(params));
      return { lastInsertRowid: result.insertId, changes: result.affectedRows };
    },
  };
}

/**
 * Creates the schema if it doesn't exist and seeds the default admin user.
 *
 * DDL runs through pool.query() rather than pool.execute() because the MySQL
 * prepared-statement protocol used by execute() rejects CREATE TABLE.
 *
 * MySQL-specific notes vs. the old SQLite schema:
 *   - INTEGER PRIMARY KEY AUTOINCREMENT  -> INT AUTO_INCREMENT PRIMARY KEY
 *   - TEXT UNIQUE                         -> VARCHAR(255) (MySQL can't index
 *                                            an unbounded TEXT column without a
 *                                            prefix length)
 *   - INSERT OR IGNORE                    -> INSERT IGNORE
 */
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE,
      password_hash VARCHAR(255)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vpn_profiles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      server_address VARCHAR(255) NOT NULL,
      username VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS olt_configs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      ip_address VARCHAR(255) NOT NULL,
      telnet_port INT DEFAULT 23,
      username VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Seed a default admin so a fresh database is immediately usable. This is a
  // safety net; a real admin row is also carried over by the migration script.
  const defaultPass = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
  const hash = bcrypt.hashSync(defaultPass, bcrypt.genSaltSync(10));
  await pool.execute(
    'INSERT IGNORE INTO users (username, password_hash) VALUES (?, ?)',
    ['admin', hash]
  );

  console.log('[DB] MySQL schema ready');
}

// Kick off schema init immediately. Consumers that run at startup (and the
// server bootstrap in index.js) await `ready` before issuing queries so they
// never race against table creation.
const ready = initSchema().catch((err) => {
  console.error('[DB] Schema initialization failed:', err.message);
  throw err;
});

module.exports = { prepare, pool, ready };
