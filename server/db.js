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
// The app's access-controlled sections. A role grants access to a subset of
// these (the Admin role bypasses the list entirely). Keep this in sync with the
// frontend nav. `key` is stored in roles.permissions; `label` is for the UI.
const SECTIONS = [
  { key: 'vpn', label: 'VPN Base' },
  { key: 'olt', label: 'OLT Matrix' },
  // Destructive OLT action, granted separately from general OLT access.
  { key: 'olt_remove_ont', label: 'Remove existing ONT' },
  { key: 'proxy', label: 'Web Tunnel' },
  { key: 'customers', label: 'Customers' },
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles & Privileges' },
];
const SECTION_KEYS = SECTIONS.map((s) => s.key);

// Default seed roles. Admin is a super-role (is_admin=1) that always has every
// section, so an admin can never be locked out by a bad permissions list.
const DEFAULT_ROLES = [
  { name: 'Admin', description: 'Full access to everything', is_admin: 1, permissions: SECTION_KEYS },
  { name: 'Manager', description: 'Network + customer management', is_admin: 0, permissions: ['vpn', 'olt', 'proxy', 'customers'] },
  { name: 'Operator', description: 'Day-to-day OLT & customer work', is_admin: 0, permissions: ['olt', 'proxy', 'customers'] },
  { name: 'Viewer', description: 'Customer records only', is_admin: 0, permissions: ['customers'] },
];

// MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so check information_schema first.
// Lets us evolve the legacy `users` table without a destructive migration.
async function ensureColumn(table, column, ddl) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (rows[0].c === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    console.log(`[DB] Added column ${table}.${column}`);
  }
}

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

  // Roles: name + a JSON array of section keys the role may access.
  // is_admin=1 is a super-role that bypasses the permissions list.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL UNIQUE,
      description VARCHAR(255) DEFAULT NULL,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      permissions JSON DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Customers: fiber subscribers managed as data records (no login).
  // Minimal field set for now (name / tel_no / port) — extend later.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      tel_no VARCHAR(64) DEFAULT NULL,
      port VARCHAR(64) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Extend the legacy users table with profile + role columns (idempotent).
  await ensureColumn('users', 'role_id', 'role_id INT DEFAULT NULL');
  await ensureColumn('users', 'full_name', 'full_name VARCHAR(255) DEFAULT NULL');
  await ensureColumn('users', 'email', 'email VARCHAR(255) DEFAULT NULL');
  await ensureColumn('users', 'status', "status VARCHAR(32) NOT NULL DEFAULT 'active'");
  await ensureColumn('users', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');

  // Forward-compat for the current customer field set (adds to older tables).
  await ensureColumn('customers', 'tel_no', 'tel_no VARCHAR(64) DEFAULT NULL');
  await ensureColumn('customers', 'port', 'port VARCHAR(64) DEFAULT NULL');

  // Seed a default admin so a fresh database is immediately usable. This is a
  // safety net; a real admin row is also carried over by the migration script.
  const defaultPass = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
  const hash = bcrypt.hashSync(defaultPass, bcrypt.genSaltSync(10));
  await pool.execute(
    'INSERT IGNORE INTO users (username, password_hash) VALUES (?, ?)',
    ['admin', hash]
  );

  // Seed the default roles (idempotent).
  for (const r of DEFAULT_ROLES) {
    await pool.execute(
      'INSERT IGNORE INTO roles (name, description, is_admin, permissions) VALUES (?, ?, ?, ?)',
      [r.name, r.description, r.is_admin, JSON.stringify(r.permissions)]
    );
  }

  // Make sure the built-in admin account has the Admin role, and any other
  // role-less user defaults to Viewer (least privilege) so nobody is left with
  // a NULL role that would deny everything.
  const [[adminRole]] = await pool.query("SELECT id FROM roles WHERE name = 'Admin' LIMIT 1");
  const [[viewerRole]] = await pool.query("SELECT id FROM roles WHERE name = 'Viewer' LIMIT 1");
  if (adminRole) {
    await pool.execute('UPDATE users SET role_id = ? WHERE username = ? AND role_id IS NULL', [adminRole.id, 'admin']);
  }
  if (viewerRole) {
    await pool.execute('UPDATE users SET role_id = ? WHERE role_id IS NULL', [viewerRole.id]);
  }

  console.log('[DB] MySQL schema ready');
}

// Kick off schema init immediately. Consumers that run at startup (and the
// server bootstrap in index.js) await `ready` before issuing queries so they
// never race against table creation.
const ready = initSchema().catch((err) => {
  console.error('[DB] Schema initialization failed:', err.message);
  throw err;
});

module.exports = { prepare, pool, ready, SECTIONS, SECTION_KEYS };
