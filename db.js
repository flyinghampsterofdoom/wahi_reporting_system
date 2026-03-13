const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "data.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vendor_id INTEGER NOT NULL,
    case_size INTEGER NOT NULL CHECK(case_size > 0),
    area_type TEXT NOT NULL DEFAULT 'FOH' CHECK(area_type IN ('FOH', 'BOH')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS item_sizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    size_label TEXT NOT NULL,
    volume_ml INTEGER NOT NULL CHECK(volume_ml > 0),
    par_level_bottles REAL NOT NULL DEFAULT 0 CHECK(par_level_bottles >= 0),
    is_tracked INTEGER NOT NULL DEFAULT 0 CHECK(is_tracked IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS inventory_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_size_id INTEGER NOT NULL,
    count_date TEXT NOT NULL,
    full_bottles REAL NOT NULL DEFAULT 0 CHECK(full_bottles >= 0),
    partial_percent REAL NOT NULL DEFAULT 0 CHECK(partial_percent >= 0 AND partial_percent <= 100),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(item_size_id, count_date),
    FOREIGN KEY(item_size_id) REFERENCES item_sizes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS par_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_size_id INTEGER NOT NULL UNIQUE,
    par_bottles REAL CHECK(par_bottles IS NULL OR par_bottles >= 0),
    level_bottles REAL CHECK(level_bottles IS NULL OR level_bottles >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(item_size_id) REFERENCES item_sizes(id) ON DELETE CASCADE
  );
`);

const itemColumns = db.prepare("PRAGMA table_info(items)").all();
const hasAreaType = itemColumns.some((column) => column.name === "area_type");
if (!hasAreaType) {
  db.exec(
    "ALTER TABLE items ADD COLUMN area_type TEXT NOT NULL DEFAULT 'FOH' CHECK(area_type IN ('FOH', 'BOH'));"
  );
}

const itemSizeColumns = db.prepare("PRAGMA table_info(item_sizes)").all();
const hasIsTracked = itemSizeColumns.some((column) => column.name === "is_tracked");
if (!hasIsTracked) {
  db.exec(
    "ALTER TABLE item_sizes ADD COLUMN is_tracked INTEGER NOT NULL DEFAULT 0 CHECK(is_tracked IN (0, 1));"
  );
}

// Only one tracked size per item.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_item_sizes_one_tracked_per_item
  ON item_sizes(item_id)
  WHERE is_tracked = 1;
`);

// Backfill any items that currently have no tracked size by selecting the largest volume.
db.exec(`
  UPDATE item_sizes
  SET is_tracked = 1
  WHERE id IN (
    SELECT s.id
    FROM item_sizes s
    LEFT JOIN (
      SELECT item_id, SUM(is_tracked) AS tracked_count
      FROM item_sizes
      GROUP BY item_id
    ) t ON t.item_id = s.item_id
    WHERE COALESCE(t.tracked_count, 0) = 0
      AND s.volume_ml = (
        SELECT MAX(s2.volume_ml)
        FROM item_sizes s2
        WHERE s2.item_id = s.item_id
      )
  );
`);

module.exports = db;
