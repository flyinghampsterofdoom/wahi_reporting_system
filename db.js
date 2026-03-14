const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_CLIENT = (process.env.DB_CLIENT || "sqlite").toLowerCase();

function mapPgParamsToSqlite(sql, params) {
  return {
    sql: sql.replace(/\$(\d+)/g, (_m, n) => "?"),
    params,
  };
}

function isSelectQuery(sql) {
  return /^\s*(select|pragma|with)\b/i.test(sql);
}

function isReturningQuery(sql) {
  return /\breturning\b/i.test(sql);
}

class SqliteClient {
  constructor() {
    const dbPath = process.env.DB_PATH || path.join(__dirname, "data.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
  }

  async init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vendors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        address TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        corporate_number TEXT NOT NULL DEFAULT '',
        representative_name TEXT NOT NULL DEFAULT '',
        representative_phone TEXT NOT NULL DEFAULT '',
        representative_email TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      );

      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        vendor_id INTEGER NOT NULL,
        case_size INTEGER NOT NULL CHECK(case_size > 0),
        area_type TEXT NOT NULL DEFAULT 'FOH' CHECK(area_type IN ('FOH', 'BOH')),
        measure_type TEXT NOT NULL DEFAULT 'FLUID' CHECK(measure_type IN ('FLUID', 'WEIGHT', 'EA')),
        purchase_unit TEXT NOT NULL DEFAULT 'BOTTLE',
        purchase_cost REAL,
        sku TEXT NOT NULL DEFAULT '',
        source_system TEXT NOT NULL DEFAULT '',
        source_key TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        FOREIGN KEY(vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS item_sizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        size_label TEXT NOT NULL,
        size_amount REAL,
        size_unit TEXT,
        volume_ml INTEGER NOT NULL CHECK(volume_ml > 0),
        unit_cost REAL,
        par_level_bottles REAL NOT NULL DEFAULT 0 CHECK(par_level_bottles >= 0),
        is_tracked INTEGER NOT NULL DEFAULT 0 CHECK(is_tracked IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_item_sizes_one_tracked_per_item
      ON item_sizes(item_id)
      WHERE is_tracked = 1;

      CREATE TABLE IF NOT EXISTS inventory_counts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_size_id INTEGER NOT NULL,
        count_date TEXT NOT NULL,
        full_bottles REAL NOT NULL DEFAULT 0 CHECK(full_bottles >= 0),
        partial_percent REAL NOT NULL DEFAULT 0 CHECK(partial_percent >= 0 AND partial_percent <= 100),
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        UNIQUE(item_size_id, count_date),
        FOREIGN KEY(item_size_id) REFERENCES item_sizes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS par_levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_size_id INTEGER NOT NULL UNIQUE,
        par_bottles REAL CHECK(par_bottles IS NULL OR par_bottles >= 0),
        level_bottles REAL CHECK(level_bottles IS NULL OR level_bottles >= 0),
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        FOREIGN KEY(item_size_id) REFERENCES item_sizes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      );

      CREATE TABLE IF NOT EXISTS item_area_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        area_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
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
        base_unit TEXT,
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
        imported_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS recipe_builder_recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL DEFAULT 'General',
        status TEXT NOT NULL DEFAULT 'Draft',
        yield_qty REAL,
        yield_unit TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      );

      CREATE TABLE IF NOT EXISTS recipe_builder_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        line_type TEXT NOT NULL CHECK(line_type IN ('INGREDIENT','RECIPE','DIRECTION','COOK_TEMPERATURE','TIME','NOTE')),
        ingredient_item_id INTEGER,
        ingredient_recipe_id INTEGER,
        quantity REAL,
        unit TEXT,
        direction_text TEXT,
        cook_temperature REAL,
        cook_temperature_unit TEXT,
        time_value REAL,
        time_unit TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        FOREIGN KEY(recipe_id) REFERENCES recipe_builder_recipes(id) ON DELETE CASCADE,
        FOREIGN KEY(ingredient_item_id) REFERENCES items(id) ON DELETE SET NULL,
        FOREIGN KEY(ingredient_recipe_id) REFERENCES recipe_builder_recipes(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS recipe_book_pricing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_type TEXT NOT NULL CHECK(book_type IN ('Prep', 'Final', 'Syrup', 'Drinks')),
        recipe_name TEXT NOT NULL,
        retail_price REAL,
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        UNIQUE(book_type, recipe_name)
      );
    `);

    this.db.exec(`
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

    const itemColumns = this.db.prepare("PRAGMA table_info(items)").all();
    const itemColumnNames = new Set(itemColumns.map((column) => column.name));
    if (!itemColumnNames.has("sku")) {
      this.db.exec("ALTER TABLE items ADD COLUMN sku TEXT NOT NULL DEFAULT '';");
    }
    if (!itemColumnNames.has("source_system")) {
      this.db.exec("ALTER TABLE items ADD COLUMN source_system TEXT NOT NULL DEFAULT '';");
    }
    if (!itemColumnNames.has("source_key")) {
      this.db.exec("ALTER TABLE items ADD COLUMN source_key TEXT NOT NULL DEFAULT '';");
    }
    if (!itemColumnNames.has("purchase_unit")) {
      this.db.exec("ALTER TABLE items ADD COLUMN purchase_unit TEXT NOT NULL DEFAULT 'BOTTLE';");
    }
    if (!itemColumnNames.has("purchase_cost")) {
      this.db.exec("ALTER TABLE items ADD COLUMN purchase_cost REAL;");
    }
    if (!itemColumnNames.has("measure_type")) {
      this.db.exec("ALTER TABLE items ADD COLUMN measure_type TEXT NOT NULL DEFAULT 'FLUID';");
    }

    const sizeColumns = this.db.prepare("PRAGMA table_info(item_sizes)").all();
    const sizeColumnNames = new Set(sizeColumns.map((column) => column.name));
    if (!sizeColumnNames.has("unit_cost")) {
      this.db.exec("ALTER TABLE item_sizes ADD COLUMN unit_cost REAL;");
    }
    if (!sizeColumnNames.has("size_amount")) {
      this.db.exec("ALTER TABLE item_sizes ADD COLUMN size_amount REAL;");
    }
    if (!sizeColumnNames.has("size_unit")) {
      this.db.exec("ALTER TABLE item_sizes ADD COLUMN size_unit TEXT;");
    }

    this.db.exec(`
      UPDATE item_sizes
      SET size_amount = COALESCE(size_amount, volume_ml),
          size_unit = COALESCE(size_unit, 'mL')
      WHERE size_amount IS NULL OR size_unit IS NULL;
    `);

    const conversionColumns = this.db.prepare("PRAGMA table_info(pricebook_conversions)").all();
    const conversionColumnNames = new Set(conversionColumns.map((column) => column.name));
    if (!conversionColumnNames.has("base_unit")) {
      this.db.exec("ALTER TABLE pricebook_conversions ADD COLUMN base_unit TEXT;");
    }
    this.db.exec(`
      UPDATE pricebook_conversions
      SET base_unit = CASE
        WHEN LOWER(COALESCE(unit_type, '')) = 'volume' THEN 'fl oz'
        WHEN LOWER(COALESCE(unit_type, '')) = 'weight' THEN 'g'
        WHEN LOWER(COALESCE(unit_type, '')) IN ('count', 'each') THEN 'ea'
        ELSE base_unit
      END
      WHERE base_unit IS NULL OR TRIM(base_unit) = '';
    `);

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_vendor
      ON items(name, vendor_id);
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source_ref
      ON items(source_system, source_key)
      WHERE source_system <> '' AND source_key <> '';
    `);
  }

  async query(sql, params = []) {
    const mapped = mapPgParamsToSqlite(sql, params);
    const stmt = this.db.prepare(mapped.sql);
    if (isSelectQuery(mapped.sql) || isReturningQuery(mapped.sql)) {
      const rows = stmt.all(...mapped.params);
      return { rows, rowCount: rows.length };
    }
    const info = stmt.run(...mapped.params);
    return {
      rows: [],
      rowCount: info.changes,
      lastInsertRowid: info.lastInsertRowid,
    };
  }

  async transaction(fn) {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

class PostgresClient {
  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when DB_CLIENT=postgres");
    }
    // Load pg only when postgres mode is enabled.
    // eslint-disable-next-line global-require
    const { Pool } = require("pg");
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  async init() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        address TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        corporate_number TEXT NOT NULL DEFAULT '',
        representative_name TEXT NOT NULL DEFAULT '',
        representative_phone TEXT NOT NULL DEFAULT '',
        representative_email TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS items (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        vendor_id BIGINT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
        case_size INTEGER NOT NULL CHECK(case_size > 0),
        area_type TEXT NOT NULL DEFAULT 'FOH' CHECK(area_type IN ('FOH', 'BOH')),
        measure_type TEXT NOT NULL DEFAULT 'FLUID' CHECK(measure_type IN ('FLUID', 'WEIGHT', 'EA')),
        purchase_unit TEXT NOT NULL DEFAULT 'BOTTLE',
        purchase_cost DOUBLE PRECISION,
        sku TEXT NOT NULL DEFAULT '',
        source_system TEXT NOT NULL DEFAULT '',
        source_key TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.query(`
      ALTER TABLE items ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT ''
    `);
    await this.query(`
      ALTER TABLE items ADD COLUMN IF NOT EXISTS source_system TEXT NOT NULL DEFAULT ''
    `);
    await this.query(`
      ALTER TABLE items ADD COLUMN IF NOT EXISTS source_key TEXT NOT NULL DEFAULT ''
    `);
    await this.query(`
      ALTER TABLE items ADD COLUMN IF NOT EXISTS purchase_unit TEXT NOT NULL DEFAULT 'BOTTLE'
    `);
    await this.query(`
      ALTER TABLE items ADD COLUMN IF NOT EXISTS purchase_cost DOUBLE PRECISION
    `);
    await this.query(`
      ALTER TABLE items ADD COLUMN IF NOT EXISTS measure_type TEXT NOT NULL DEFAULT 'FLUID'
    `);
    await this.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_vendor
      ON items(name, vendor_id)
    `);
    await this.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source_ref
      ON items(source_system, source_key)
      WHERE source_system <> '' AND source_key <> ''
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS item_sizes (
        id BIGSERIAL PRIMARY KEY,
        item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        size_label TEXT NOT NULL,
        size_amount DOUBLE PRECISION,
        size_unit TEXT,
        volume_ml INTEGER NOT NULL CHECK(volume_ml > 0),
        unit_cost DOUBLE PRECISION,
        par_level_bottles DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(par_level_bottles >= 0),
        is_tracked INTEGER NOT NULL DEFAULT 0 CHECK(is_tracked IN (0, 1)),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.query(`
      ALTER TABLE item_sizes ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION
    `);
    await this.query(`
      ALTER TABLE item_sizes ADD COLUMN IF NOT EXISTS size_amount DOUBLE PRECISION
    `);
    await this.query(`
      ALTER TABLE item_sizes ADD COLUMN IF NOT EXISTS size_unit TEXT
    `);
    await this.query(`
      UPDATE item_sizes
      SET size_amount = COALESCE(size_amount, volume_ml),
          size_unit = COALESCE(size_unit, 'mL')
      WHERE size_amount IS NULL OR size_unit IS NULL
    `);

    await this.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_item_sizes_one_tracked_per_item
      ON item_sizes(item_id)
      WHERE is_tracked = 1
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS inventory_counts (
        id BIGSERIAL PRIMARY KEY,
        item_size_id BIGINT NOT NULL REFERENCES item_sizes(id) ON DELETE CASCADE,
        count_date TEXT NOT NULL,
        full_bottles DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(full_bottles >= 0),
        partial_percent DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(partial_percent >= 0 AND partial_percent <= 100),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_size_id, count_date)
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS par_levels (
        id BIGSERIAL PRIMARY KEY,
        item_size_id BIGINT NOT NULL UNIQUE REFERENCES item_sizes(id) ON DELETE CASCADE,
        par_bottles DOUBLE PRECISION,
        level_bottles DOUBLE PRECISION,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS areas (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS item_area_assignments (
        id BIGSERIAL PRIMARY KEY,
        item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        area_id BIGINT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_id, area_id)
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_ingredients (
        id BIGSERIAL PRIMARY KEY,
        ingredient_name TEXT NOT NULL UNIQUE,
        purchase_name TEXT,
        vendor TEXT,
        sku TEXT,
        buy_price DOUBLE PRECISION,
        size_value DOUBLE PRECISION,
        purchase_unit TEXT,
        per_price DOUBLE PRECISION,
        location TEXT,
        source_row INTEGER,
        source_file TEXT
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_recipes (
        id BIGSERIAL PRIMARY KEY,
        recipe_name TEXT NOT NULL UNIQUE,
        batch_yield_qty DOUBLE PRECISION,
        batch_yield_unit TEXT,
        batch_cost DOUBLE PRECISION,
        price_per_yield_unit DOUBLE PRECISION,
        recipe_type TEXT,
        status TEXT,
        prep_time_min DOUBLE PRECISION,
        labor_cost DOUBLE PRECISION,
        source_row INTEGER,
        source_file TEXT
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_recipe_lines (
        id BIGSERIAL PRIMARY KEY,
        recipe_name TEXT NOT NULL,
        ingredient_name TEXT,
        qty DOUBLE PRECISION,
        unit TEXT,
        line_cost DOUBLE PRECISION,
        notes TEXT,
        source_row INTEGER,
        source_file TEXT
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_conversions (
        id BIGSERIAL PRIMARY KEY,
        unit TEXT NOT NULL UNIQUE,
        unit_type TEXT,
        base_unit TEXT,
        to_base DOUBLE PRECISION,
        source_row INTEGER,
        source_file TEXT
      )
    `);
    await this.query(`
      ALTER TABLE pricebook_conversions ADD COLUMN IF NOT EXISTS base_unit TEXT
    `);
    await this.query(`
      UPDATE pricebook_conversions
      SET base_unit = CASE
        WHEN LOWER(COALESCE(unit_type, '')) = 'volume' THEN 'fl oz'
        WHEN LOWER(COALESCE(unit_type, '')) = 'weight' THEN 'g'
        WHEN LOWER(COALESCE(unit_type, '')) IN ('count', 'each') THEN 'ea'
        ELSE base_unit
      END
      WHERE base_unit IS NULL OR BTRIM(base_unit) = ''
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_yields (
        id BIGSERIAL PRIMARY KEY,
        product_name TEXT NOT NULL,
        source_ingredient TEXT,
        purchase_unit TEXT,
        source_per_price DOUBLE PRECISION,
        yield_unit TEXT,
        yield_value DOUBLE PRECISION,
        price_per_yield_unit DOUBLE PRECISION,
        key_value TEXT,
        verified_by TEXT,
        verified_date TEXT,
        notes TEXT,
        source_row INTEGER,
        source_file TEXT
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_densities (
        id BIGSERIAL PRIMARY KEY,
        ingredient_name TEXT NOT NULL UNIQUE,
        grams_per_cup DOUBLE PRECISION,
        cups_per_lb DOUBLE PRECISION,
        source_row INTEGER,
        source_file TEXT
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_drink_catalog (
        id BIGSERIAL PRIMARY KEY,
        recipe_name TEXT NOT NULL,
        drink_cost DOUBLE PRECISION,
        markup DOUBLE PRECISION,
        suggest_price DOUBLE PRECISION,
        actual_price DOUBLE PRECISION,
        margin DOUBLE PRECISION,
        profit DOUBLE PRECISION,
        source_row INTEGER,
        source_file TEXT
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_food_catalog (
        id BIGSERIAL PRIMARY KEY,
        recipe_name TEXT NOT NULL,
        food_cost DOUBLE PRECISION,
        markup DOUBLE PRECISION,
        suggest_price DOUBLE PRECISION,
        actual_price DOUBLE PRECISION,
        margin DOUBLE PRECISION,
        profit DOUBLE PRECISION,
        source_row INTEGER,
        source_file TEXT
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_syrup_catalog (
        id BIGSERIAL PRIMARY KEY,
        syrup_name TEXT NOT NULL,
        batch_yield_qty DOUBLE PRECISION,
        batch_yield_unit TEXT,
        batch_cost DOUBLE PRECISION,
        price_per_oz DOUBLE PRECISION,
        catalog_check TEXT,
        source_row INTEGER,
        source_file TEXT
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS pricebook_import_runs (
        id BIGSERIAL PRIMARY KEY,
        source_file TEXT NOT NULL,
        imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS recipe_builder_recipes (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL DEFAULT 'General',
        status TEXT NOT NULL DEFAULT 'Draft',
        yield_qty DOUBLE PRECISION,
        yield_unit TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS recipe_builder_lines (
        id BIGSERIAL PRIMARY KEY,
        recipe_id BIGINT NOT NULL REFERENCES recipe_builder_recipes(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL,
        line_type TEXT NOT NULL CHECK(line_type IN ('INGREDIENT','RECIPE','DIRECTION','COOK_TEMPERATURE','TIME','NOTE')),
        ingredient_item_id BIGINT REFERENCES items(id) ON DELETE SET NULL,
        ingredient_recipe_id BIGINT REFERENCES recipe_builder_recipes(id) ON DELETE SET NULL,
        quantity DOUBLE PRECISION,
        unit TEXT,
        direction_text TEXT,
        cook_temperature DOUBLE PRECISION,
        cook_temperature_unit TEXT,
        time_value DOUBLE PRECISION,
        time_unit TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS recipe_book_pricing (
        id BIGSERIAL PRIMARY KEY,
        book_type TEXT NOT NULL CHECK(book_type IN ('Prep', 'Final', 'Syrup', 'Drinks')),
        recipe_name TEXT NOT NULL,
        retail_price DOUBLE PRECISION,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(book_type, recipe_name)
      )
    `);

    await this.query(`
      UPDATE item_sizes s
      SET is_tracked = 1
      WHERE s.id IN (
        SELECT s1.id
        FROM item_sizes s1
        LEFT JOIN (
          SELECT item_id, SUM(is_tracked) AS tracked_count
          FROM item_sizes
          GROUP BY item_id
        ) t ON t.item_id = s1.item_id
        WHERE COALESCE(t.tracked_count, 0) = 0
          AND s1.volume_ml = (
            SELECT MAX(s2.volume_ml)
            FROM item_sizes s2
            WHERE s2.item_id = s1.item_id
          )
      )
    `);
  }

  async query(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
    };
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const txClient = {
        query: async (sql, params = []) => {
          const result = await client.query(sql, params);
          return { rows: result.rows, rowCount: result.rowCount };
        },
      };
      const result = await fn(txClient);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function createDbClient() {
  if (DB_CLIENT === "postgres") return new PostgresClient();
  return new SqliteClient();
}

module.exports = {
  DB_CLIENT,
  createDbClient,
};
