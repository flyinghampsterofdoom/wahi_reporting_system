#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const db = require("../db");

const sourcePath = process.argv[2];
if (!sourcePath) {
  // eslint-disable-next-line no-console
  console.error("Usage: npm run import:pricebook -- /absolute/path/to/Wahi-Price-Book.xlsx");
  process.exit(1);
}

if (!fs.existsSync(sourcePath)) {
  // eslint-disable-next-line no-console
  console.error(`File not found: ${sourcePath}`);
  process.exit(1);
}

const sourceFile = path.basename(sourcePath);
const workbook = XLSX.readFile(sourcePath, { cellDates: true });

function rows(sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
}

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

const insertImportRun = db.prepare(
  "INSERT INTO pricebook_import_runs (source_file, notes) VALUES (?, ?)"
);

const clearTable = (tableName) => db.prepare(`DELETE FROM ${tableName}`).run();

const upsertIngredient = db.prepare(`
  INSERT INTO pricebook_ingredients
  (ingredient_name, purchase_name, vendor, sku, buy_price, size_value, purchase_unit, per_price, location, source_row, source_file)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
`);

const upsertRecipe = db.prepare(`
  INSERT INTO pricebook_recipes
  (recipe_name, batch_yield_qty, batch_yield_unit, batch_cost, price_per_yield_unit, recipe_type, status, prep_time_min, labor_cost, source_row, source_file)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
`);

const insertRecipeLine = db.prepare(`
  INSERT INTO pricebook_recipe_lines
  (recipe_name, ingredient_name, qty, unit, line_cost, notes, source_row, source_file)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertConversion = db.prepare(`
  INSERT INTO pricebook_conversions
  (unit, unit_type, to_base, source_row, source_file)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(unit)
  DO UPDATE SET
    unit_type = excluded.unit_type,
    to_base = excluded.to_base,
    source_row = excluded.source_row,
    source_file = excluded.source_file
`);

const insertYield = db.prepare(`
  INSERT INTO pricebook_yields
  (product_name, source_ingredient, purchase_unit, source_per_price, yield_unit, yield_value, price_per_yield_unit, key_value, verified_by, verified_date, notes, source_row, source_file)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertDensity = db.prepare(`
  INSERT INTO pricebook_densities
  (ingredient_name, grams_per_cup, cups_per_lb, source_row, source_file)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(ingredient_name)
  DO UPDATE SET
    grams_per_cup = excluded.grams_per_cup,
    cups_per_lb = excluded.cups_per_lb,
    source_row = excluded.source_row,
    source_file = excluded.source_file
`);

const insertDrinkCatalog = db.prepare(`
  INSERT INTO pricebook_drink_catalog
  (recipe_name, drink_cost, markup, suggest_price, actual_price, margin, profit, source_row, source_file)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertFoodCatalog = db.prepare(`
  INSERT INTO pricebook_food_catalog
  (recipe_name, food_cost, markup, suggest_price, actual_price, margin, profit, source_row, source_file)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertSyrupCatalog = db.prepare(`
  INSERT INTO pricebook_syrup_catalog
  (syrup_name, batch_yield_qty, batch_yield_unit, batch_cost, price_per_oz, catalog_check, source_row, source_file)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const runImport = db.transaction(() => {
  clearTable("pricebook_recipe_lines");
  clearTable("pricebook_yields");
  clearTable("pricebook_drink_catalog");
  clearTable("pricebook_food_catalog");
  clearTable("pricebook_syrup_catalog");

  rows("Ingredients").forEach((row, idx) => {
    const name = str(row.IngredientName);
    if (!name) return;
    upsertIngredient.run(
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
      sourceFile
    );
  });

  rows("Recipe Catalog").forEach((row, idx) => {
    const recipeName = str(row.RecipeName);
    if (!recipeName) return;
    upsertRecipe.run(
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
      sourceFile
    );
  });

  rows("RecipeLines").forEach((row, idx) => {
    const recipeName = str(row.RecipeName);
    if (!recipeName) return;
    insertRecipeLine.run(
      recipeName,
      str(row.IngredientName),
      num(row.Qty),
      str(row.Unit),
      num(row.LineCost),
      str(row.Notes),
      idx + 2,
      sourceFile
    );
  });

  rows("Conversions").forEach((row, idx) => {
    const unit = str(row.Unit);
    if (!unit) return;
    upsertConversion.run(unit, str(row.Type), num(row.ToBase), idx + 2, sourceFile);
  });

  rows("Yields").forEach((row, idx) => {
    const productName = str(row.ProductName);
    if (!productName) return;
    insertYield.run(
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
      sourceFile
    );
  });

  rows("Densities").forEach((row, idx) => {
    const ingredientName = str(row.IngredientName);
    if (!ingredientName) return;
    upsertDensity.run(ingredientName, num(row.GramsPerCup), num(row.CupsPerLb), idx + 2, sourceFile);
  });

  rows("Drink Catalog").forEach((row, idx) => {
    const recipeName = str(row.RecipeName);
    if (!recipeName) return;
    insertDrinkCatalog.run(
      recipeName,
      num(row.DrinkCost),
      num(row.Markup),
      num(row.SuggestPrice),
      num(row.ActualPrice),
      num(row.Margin),
      num(row.Profit),
      idx + 2,
      sourceFile
    );
  });

  rows("Food Catalog").forEach((row, idx) => {
    const recipeName = str(row.RecipeName);
    if (!recipeName) return;
    insertFoodCatalog.run(
      recipeName,
      num(row.FoodCost),
      num(row.Markup),
      num(row.SuggestPrice),
      num(row.ActualPrice),
      num(row.Margin),
      num(row.Profit),
      idx + 2,
      sourceFile
    );
  });

  rows("SyrupCatalog").forEach((row, idx) => {
    const syrupName = str(row.SyrupName);
    if (!syrupName) return;
    insertSyrupCatalog.run(
      syrupName,
      num(row.BatchYieldQty),
      str(row.BatchYieldUnit),
      num(row.BatchCost),
      num(row.PricePerOz),
      str(row.CatalogCheck),
      idx + 2,
      sourceFile
    );
  });

  insertImportRun.run(sourceFile, "Imported workbook sheets into pricebook tables");
});

runImport();

const summary = {
  ingredients: db.prepare("SELECT COUNT(*) AS c FROM pricebook_ingredients").get().c,
  recipes: db.prepare("SELECT COUNT(*) AS c FROM pricebook_recipes").get().c,
  recipeLines: db.prepare("SELECT COUNT(*) AS c FROM pricebook_recipe_lines").get().c,
  conversions: db.prepare("SELECT COUNT(*) AS c FROM pricebook_conversions").get().c,
  yields: db.prepare("SELECT COUNT(*) AS c FROM pricebook_yields").get().c,
  densities: db.prepare("SELECT COUNT(*) AS c FROM pricebook_densities").get().c,
  drinkCatalog: db.prepare("SELECT COUNT(*) AS c FROM pricebook_drink_catalog").get().c,
  foodCatalog: db.prepare("SELECT COUNT(*) AS c FROM pricebook_food_catalog").get().c,
  syrupCatalog: db.prepare("SELECT COUNT(*) AS c FROM pricebook_syrup_catalog").get().c,
};

// eslint-disable-next-line no-console
console.log("Price book import complete:", summary);
