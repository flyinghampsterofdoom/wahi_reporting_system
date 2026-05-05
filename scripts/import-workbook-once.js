#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const util = require("util");
const XLSX = require("xlsx");
const { createDbClient } = require("../db");
const { importPricebook } = require("./import-pricebook");
const { importBuilderFromPricebook } = require("./import-builder-from-pricebook");

const REQUIRED_SHEETS = [
  "Ingredients",
  "SyrupCatalog",
  "Recipe Catalog",
  "Drink Catalog",
  "Food Catalog",
  "RecipeLines",
  "Conversions",
  "Yields",
  "Densities",
];

function assertV21WorkbookShape(sourcePath) {
  if (!sourcePath) {
    throw new Error("Usage: npm run import:workbook -- /absolute/path/to/Wahi-Price-Book-V2.1.xlsx");
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`File not found: ${sourcePath}`);
  }

  const workbook = XLSX.readFile(sourcePath, { bookSheets: true });
  const sheetNames = new Set(workbook.SheetNames || []);
  const missing = REQUIRED_SHEETS.filter((sheetName) => !sheetNames.has(sheetName));
  if (missing.length) {
    throw new Error(
      `Workbook is missing required V2.1 sheets: ${missing.join(", ")}. ` +
        "Use the authoritative Wahi Price Book V2.1 workbook for website import."
    );
  }
}

async function run() {
  const sourcePath = process.argv[2];
  assertV21WorkbookShape(sourcePath);

  const db = createDbClient();
  await db.init();

  const pricebook = await importPricebook(sourcePath, db);
  const recipeBuilder = await importBuilderFromPricebook(db);

  const bookCounts = await db.query(`
    SELECT category, COUNT(*) AS c
    FROM recipe_builder_recipes
    GROUP BY category
    ORDER BY c DESC, category
  `);

  // eslint-disable-next-line no-console
  console.log(
    "One-time workbook import complete:",
    util.inspect(
      {
        sourceFile: path.basename(sourcePath),
        pricebook,
        recipeBuilder,
        recipeBookCategories: bookCounts.rows,
      },
      { depth: null, colors: false }
    )
  );
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("One-time workbook import failed:", error);
  process.exit(1);
});
