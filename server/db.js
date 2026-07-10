const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

// Resolve database path from .env, fallback to local path in dev
let dbPath = process.env.DB_PATH;
if (!dbPath || dbPath.includes('/var/www')) {
   // Local fallback for dev/testing if running outside linux
   dbPath = path.join(__dirname, 'mrfiber.db');
}

const db = new Database(dbPath, { verbose: console.log });
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS vpn_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    server_address TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS olt_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    telnet_port INTEGER DEFAULT 23,
    username TEXT NOT NULL,
    password TEXT NOT NULL
  );
`);

// Insert default admin if not exists
const defaultPass = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
const salt = bcrypt.genSaltSync(10);
const hash = bcrypt.hashSync(defaultPass, salt);

const insertAdmin = db.prepare(`INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)`);
insertAdmin.run('admin', hash);

module.exports = db;
