let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error('\n❌ Could not load better-sqlite3.');
  console.error('   Fix: make sure you ran "npm install" INSIDE the backend/ folder');
  console.error('   (not the repo root), with Node.js 18 or newer installed.');
  console.error('   Then try again with: npm start\n');
  process.exit(1);
}
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'pharmacy.db'));
// NOTE: this resolves to <project-root>/pharmacy.db since db.js lives in backend/
db.pragma('journal_mode = WAL');

// ---------------------------------------------------------------------
// Schema
//   users     -> pharmacist/owner accounts (registration/login)
//   medicines -> one row per distinct medicine name
//   batches   -> stock batches; each tied to a medicine, with its own
//                quantity and expiry_date. FEFO dispensing and in-date
//                stock counts are both computed off this table.
// ---------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    reorder_threshold INTEGER NOT NULL DEFAULT 20,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    batch_code TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity >= 0),
    expiry_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','quarantined')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(medicine_id, batch_code)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_batches_medicine ON batches(medicine_id);
  CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expiry_date);
`);

module.exports = db;
