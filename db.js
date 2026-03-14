const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = process.env.DB_PATH || path.join(__dirname, "data.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    corporate_number TEXT NOT NULL DEFAULT '',
    representative_name TEXT NOT NULL DEFAULT '',
    representative_phone TEXT NOT NULL DEFAULT '',
    representative_email TEXT NOT NULL DEFAULT '',
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

  CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS item_area_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    area_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(item_id, area_id),
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY(area_id) REFERENCES areas(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pricebook_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_name TEXT NOT NULL,
    purchase_name TEXT,
    vendor TEXT,
    sku TEXT,
    buy_price REAL,
    size_value REAL,
    purchase_unit TEXT,
    per_price REAL,
    location TEXT,
    source_row INTEGER,
    source_file TEXT,
    UNIQUE(ingredient_name)
  );

  CREATE TABLE IF NOT EXISTS pricebook_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_name TEXT NOT NULL,
    batch_yield_qty REAL,
    batch_yield_unit TEXT,
    batch_cost REAL,
    price_per_yield_unit REAL,
    recipe_type TEXT,
    status TEXT,
    prep_time_min REAL,
    labor_cost REAL,
    source_row INTEGER,
    source_file TEXT,
    UNIQUE(recipe_name)
  );

  CREATE TABLE IF NOT EXISTS pricebook_recipe_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_name TEXT NOT NULL,
    ingredient_name TEXT,
    qty REAL,
    unit TEXT,
    line_cost REAL,
    notes TEXT,
    source_row INTEGER,
    source_file TEXT
  );

  CREATE TABLE IF NOT EXISTS pricebook_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit TEXT NOT NULL,
    unit_type TEXT,
    to_base REAL,
    source_row INTEGER,
    source_file TEXT,
    UNIQUE(unit)
  );

  CREATE TABLE IF NOT EXISTS pricebook_yields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    source_ingredient TEXT,
    purchase_unit TEXT,
    source_per_price REAL,
    yield_unit TEXT,
    yield_value REAL,
    price_per_yield_unit REAL,
    key_value TEXT,
    verified_by TEXT,
    verified_date TEXT,
    notes TEXT,
    source_row INTEGER,
    source_file TEXT
  );

  CREATE TABLE IF NOT EXISTS pricebook_densities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_name TEXT NOT NULL,
    grams_per_cup REAL,
    cups_per_lb REAL,
    source_row INTEGER,
    source_file TEXT,
    UNIQUE(ingredient_name)
  );

  CREATE TABLE IF NOT EXISTS pricebook_drink_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_name TEXT NOT NULL,
    drink_cost REAL,
    markup REAL,
    suggest_price REAL,
    actual_price REAL,
    margin REAL,
    profit REAL,
    source_row INTEGER,
    source_file TEXT
  );

  CREATE TABLE IF NOT EXISTS pricebook_food_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_name TEXT NOT NULL,
    food_cost REAL,
    markup REAL,
    suggest_price REAL,
    actual_price REAL,
    margin REAL,
    profit REAL,
    source_row INTEGER,
    source_file TEXT
  );

  CREATE TABLE IF NOT EXISTS pricebook_syrup_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    syrup_name TEXT NOT NULL,
    batch_yield_qty REAL,
    batch_yield_unit TEXT,
    batch_cost REAL,
    price_per_oz REAL,
    catalog_check TEXT,
    source_row INTEGER,
    source_file TEXT
  );

  CREATE TABLE IF NOT EXISTS pricebook_import_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT
  );
`);

const itemColumns = db.prepare("PRAGMA table_info(items)").all();
const hasAreaType = itemColumns.some((column) => column.name === "area_type");
if (!hasAreaType) {
  db.exec(
    "ALTER TABLE items ADD COLUMN area_type TEXT NOT NULL DEFAULT 'FOH' CHECK(area_type IN ('FOH', 'BOH'));"
  );
}

const vendorColumns = db.prepare("PRAGMA table_info(vendors)").all();
const vendorColumnNames = new Set(vendorColumns.map((column) => column.name));
if (!vendorColumnNames.has("address")) {
  db.exec("ALTER TABLE vendors ADD COLUMN address TEXT NOT NULL DEFAULT '';");
}
if (!vendorColumnNames.has("email")) {
  db.exec("ALTER TABLE vendors ADD COLUMN email TEXT NOT NULL DEFAULT '';");
}
if (!vendorColumnNames.has("corporate_number")) {
  db.exec("ALTER TABLE vendors ADD COLUMN corporate_number TEXT NOT NULL DEFAULT '';");
}
if (!vendorColumnNames.has("representative_name")) {
  db.exec("ALTER TABLE vendors ADD COLUMN representative_name TEXT NOT NULL DEFAULT '';");
}
if (!vendorColumnNames.has("representative_phone")) {
  db.exec("ALTER TABLE vendors ADD COLUMN representative_phone TEXT NOT NULL DEFAULT '';");
}
if (!vendorColumnNames.has("representative_email")) {
  db.exec("ALTER TABLE vendors ADD COLUMN representative_email TEXT NOT NULL DEFAULT '';");
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
