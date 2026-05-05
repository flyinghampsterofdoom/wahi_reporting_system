#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { createDbClient } = require("../db");
const { syncPricebookToCatalog } = require("../lib/pricebook-sync");

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.valueOf())) return null;
  return d.toISOString().slice(0, 10);
}

function defaultBaseUnit(unitType) {
  const type = String(unitType || "").trim().toLowerCase();
  if (type === "volume") return "fl oz";
  if (type === "weight") return "g";
  if (type === "count") return "ea";
  return "";
}

async function importPricebook(sourcePath, existingDb = null) {
  if (!sourcePath) {
    throw new Error("Usage: npm run import:pricebook -- /absolute/path/to/Wahi-Price-Book.xlsx");
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`File not found: ${sourcePath}`);
  }

  const sourceFile = path.basename(sourcePath);
  const workbook = XLSX.readFile(sourcePath, { cellDates: true });

  function rows(sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  }

  const db = existingDb || createDbClient();
  if (!existingDb) await db.init();

  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM pricebook_recipe_lines");
    await tx.query("DELETE FROM pricebook_yields");
    await tx.query("DELETE FROM pricebook_drink_catalog");
    await tx.query("DELETE FROM pricebook_food_catalog");
    await tx.query("DELETE FROM pricebook_syrup_catalog");

    for (const [idx, row] of rows("Ingredients").entries()) {
      const name = str(row.IngredientName);
      if (!name) continue;
      await tx.query(
        `
        INSERT INTO pricebook_ingredients
        (ingredient_name, purchase_name, vendor, sku, buy_price, size_value, purchase_unit, per_price, location, source_row, source_file)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(ingredient_name)
        DO UPDATE SET
          purchase_name = excluded.purchase_name,
          vendor = excluded.vendor,
          sku = excluded.sku,
          buy_price = excluded.buy_price,
          size_value = excluded.size_value,
          purchase_unit = excluded.purchase_unit,
          per_price = excluded.per_price,
          location = excluded.location,
          source_row = excluded.source_row,
          source_file = excluded.source_file
        `,
        [
          name,
          str(row.PurchaseName),
          str(row.Vendor),
          str(row.SKU),
          num(row.BuyPrice),
          num(row.Size),
          str(row.PurchaseUnit),
          num(row["Per Price"]),
          str(row.Location),
          idx + 2,
          sourceFile,
        ]
      );
    }

    for (const [idx, row] of rows("Recipe Catalog").entries()) {
      const recipeName = str(row.RecipeName);
      if (!recipeName) continue;
      await tx.query(
        `
        INSERT INTO pricebook_recipes
        (recipe_name, batch_yield_qty, batch_yield_unit, batch_cost, price_per_yield_unit, recipe_type, status, prep_time_min, labor_cost, source_row, source_file)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(recipe_name)
        DO UPDATE SET
          batch_yield_qty = excluded.batch_yield_qty,
          batch_yield_unit = excluded.batch_yield_unit,
          batch_cost = excluded.batch_cost,
          price_per_yield_unit = excluded.price_per_yield_unit,
          recipe_type = excluded.recipe_type,
          status = excluded.status,
          prep_time_min = excluded.prep_time_min,
          labor_cost = excluded.labor_cost,
          source_row = excluded.source_row,
          source_file = excluded.source_file
        `,
        [
          recipeName,
          num(row.BatchYieldQty),
          str(row.BatchYieldUnit),
          num(row.BatchCost),
          num(row.PricePerYieldUnit),
          str(row.RecipeType),
          str(row.Status),
          num(row.PrepTimeMin),
          num(row.LaborCost),
          idx + 2,
          sourceFile,
        ]
      );
    }

    for (const [idx, row] of rows("RecipeLines").entries()) {
      const recipeName = str(row.RecipeName);
      if (!recipeName) continue;
      await tx.query(
        `
        INSERT INTO pricebook_recipe_lines
        (recipe_name, ingredient_name, qty, unit, line_cost, notes, source_row, source_file)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          recipeName,
          str(row.IngredientName),
          num(row.Qty),
          str(row.Unit),
          num(row.LineCost),
          str(row.Notes),
          idx + 2,
          sourceFile,
        ]
      );
    }

    for (const [idx, row] of rows("Conversions").entries()) {
      const unit = str(row.Unit);
      if (!unit) continue;
      const unitType = str(row.Type);
      const baseUnit = str(row.BaseUnit) || defaultBaseUnit(unitType);
      await tx.query(
        `
        INSERT INTO pricebook_conversions
        (unit, unit_type, base_unit, to_base, source_row, source_file)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(unit)
        DO UPDATE SET
          unit_type = excluded.unit_type,
          base_unit = excluded.base_unit,
          to_base = excluded.to_base,
          source_row = excluded.source_row,
          source_file = excluded.source_file
        `,
        [unit, unitType, baseUnit, num(row.ToBase), idx + 2, sourceFile]
      );
    }

    for (const [idx, row] of rows("Yields").entries()) {
      const productName = str(row.ProductName);
      if (!productName) continue;
      await tx.query(
        `
        INSERT INTO pricebook_yields
        (product_name, source_ingredient, purchase_unit, source_per_price, yield_unit, yield_value, price_per_yield_unit, key_value, verified_by, verified_date, notes, source_row, source_file)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `,
        [
          productName,
          str(row.SourceIngredient),
          str(row.PurchaseUnit),
          num(row.SourcePerPrice),
          str(row.YieldUnit),
          num(row.YieldValue),
          num(row.PricePerYieldUnit),
          str(row.Key),
          str(row.VerfiiedBy),
          isoDate(row.Date),
          str(row.Notes),
          idx + 2,
          sourceFile,
        ]
      );
    }

    for (const [idx, row] of rows("Densities").entries()) {
      const ingredientName = str(row.IngredientName);
      if (!ingredientName) continue;
      await tx.query(
        `
        INSERT INTO pricebook_densities
        (ingredient_name, grams_per_cup, cups_per_lb, source_row, source_file)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(ingredient_name)
        DO UPDATE SET
          grams_per_cup = excluded.grams_per_cup,
          cups_per_lb = excluded.cups_per_lb,
          source_row = excluded.source_row,
          source_file = excluded.source_file
        `,
        [ingredientName, num(row.GramsPerCup), num(row.CupsPerLb), idx + 2, sourceFile]
      );
    }

    for (const [idx, row] of rows("Drink Catalog").entries()) {
      const recipeName = str(row.RecipeName);
      if (!recipeName) continue;
      await tx.query(
        `
        INSERT INTO pricebook_drink_catalog
        (recipe_name, drink_cost, markup, suggest_price, actual_price, margin, profit, source_row, source_file)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          recipeName,
          num(row.DrinkCost),
          num(row.Markup),
          num(row.SuggestPrice),
          num(row.ActualPrice),
          num(row.Margin),
          num(row.Profit),
          idx + 2,
          sourceFile,
        ]
      );
    }

    for (const [idx, row] of rows("Food Catalog").entries()) {
      const recipeName = str(row.RecipeName);
      if (!recipeName) continue;
      await tx.query(
        `
        INSERT INTO pricebook_food_catalog
        (recipe_name, food_cost, markup, suggest_price, actual_price, margin, profit, source_row, source_file)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          recipeName,
          num(row.FoodCost),
          num(row.Markup),
          num(row.SuggestPrice),
          num(row.ActualPrice),
          num(row.Margin),
          num(row.Profit),
          idx + 2,
          sourceFile,
        ]
      );
    }

    for (const [idx, row] of rows("SyrupCatalog").entries()) {
      const syrupName = str(row.SyrupName);
      if (!syrupName) continue;
      await tx.query(
        `
        INSERT INTO pricebook_syrup_catalog
        (syrup_name, batch_yield_qty, batch_yield_unit, batch_cost, price_per_oz, catalog_check, source_row, source_file)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          syrupName,
          num(row.BatchYieldQty),
          str(row.BatchYieldUnit),
          num(row.BatchCost),
          num(row.PricePerOz),
          str(row.CatalogCheck),
          idx + 2,
          sourceFile,
        ]
      );
    }

    await tx.query(
      "INSERT INTO pricebook_import_runs (source_file, notes) VALUES ($1, $2)",
      [sourceFile, "Imported workbook sheets into pricebook tables"]
    );
  });

  const counts = await Promise.all([
    db.query("SELECT COUNT(*) AS c FROM pricebook_ingredients"),
    db.query("SELECT COUNT(*) AS c FROM pricebook_recipes"),
    db.query("SELECT COUNT(*) AS c FROM pricebook_recipe_lines"),
    db.query("SELECT COUNT(*) AS c FROM pricebook_conversions"),
    db.query("SELECT COUNT(*) AS c FROM pricebook_yields"),
    db.query("SELECT COUNT(*) AS c FROM pricebook_densities"),
    db.query("SELECT COUNT(*) AS c FROM pricebook_drink_catalog"),
    db.query("SELECT COUNT(*) AS c FROM pricebook_food_catalog"),
    db.query("SELECT COUNT(*) AS c FROM pricebook_syrup_catalog"),
  ]);

  const pick = (q) => Number(q.rows[0].c);
  const catalogSync = await syncPricebookToCatalog(db);
  return {
    ingredients: pick(counts[0]),
    recipes: pick(counts[1]),
    recipeLines: pick(counts[2]),
    conversions: pick(counts[3]),
    yields: pick(counts[4]),
    densities: pick(counts[5]),
    drinkCatalog: pick(counts[6]),
    foodCatalog: pick(counts[7]),
    syrupCatalog: pick(counts[8]),
    catalogSync,
  };
}

async function run() {
  const summary = await importPricebook(process.argv[2]);
  // eslint-disable-next-line no-console
  console.log("Price book import complete:", summary);
}

if (require.main === module) {
  run().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Import failed:", error);
    process.exit(1);
  });
}

module.exports = {
  importPricebook,
};
