#!/usr/bin/env node
const { createDbClient } = require("../db");

function normalizeLookupName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeRecipeUnit(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

function recipeUnitCategory(value) {
  const unit = normalizeRecipeUnit(value);
  if (!unit) return "OTHER";
  const volumeUnits = new Set(["ml", "l", "fl oz", "floz", "oz", "qt", "gal", "cup", "cups", "tbsp", "tsp", "pt", "pint"]);
  const weightUnits = new Set(["g", "kg", "oz wt", "lb", "lbs", "gram", "grams", "pound", "pounds"]);
  const eachUnits = new Set(["ea", "each", "x", "count"]);
  if (volumeUnits.has(unit)) return "VOLUME";
  if (weightUnits.has(unit)) return "WEIGHT";
  if (eachUnits.has(unit)) return "EACH";
  return "OTHER";
}

function resolveRecipeReferenceUnit(sourceUnit, recipeYieldUnit) {
  const rawSourceUnit = String(sourceUnit || "").trim();
  const rawYieldUnit = String(recipeYieldUnit || "").trim();
  if (!rawSourceUnit) return rawYieldUnit || "x";
  if (!rawYieldUnit) return rawSourceUnit;

  const sourceCategory = recipeUnitCategory(rawSourceUnit);
  const yieldCategory = recipeUnitCategory(rawYieldUnit);
  if (sourceCategory !== "OTHER" && yieldCategory !== "OTHER" && sourceCategory !== yieldCategory) {
    return rawYieldUnit;
  }
  return rawSourceUnit;
}

function parseSourceNameFromNotes(notes) {
  const match = String(notes || "").match(/Source:\s*([^|]+)/i);
  return match ? String(match[1] || "").trim() : null;
}

async function importBuilderFromPricebook(existingDb = null) {
  const db = existingDb || createDbClient();
  if (!existingDb) await db.init();

  const result = await db.transaction(async (tx) => {
    const [
      recipeRowsRes,
      lineRowsRes,
      itemRowsRes,
      mappedRowsRes,
      drinkRes,
      foodRes,
      syrupRes,
      yieldRes,
      builderExistingRes,
    ] = await Promise.all([
      tx.query("SELECT recipe_name, recipe_type, status, batch_yield_qty, batch_yield_unit FROM pricebook_recipes ORDER BY recipe_name"),
      tx.query("SELECT recipe_name, ingredient_name, qty, unit, line_cost, notes FROM pricebook_recipe_lines ORDER BY recipe_name, id"),
      tx.query("SELECT id, name FROM items"),
      tx.query(`SELECT pi.ingredient_name, i.id AS item_id FROM pricebook_ingredients pi JOIN items i ON i.source_system='pricebook' AND i.source_key=('ingredient:' || pi.id)`),
      tx.query("SELECT recipe_name FROM pricebook_drink_catalog"),
      tx.query("SELECT recipe_name FROM pricebook_food_catalog"),
      tx.query("SELECT syrup_name FROM pricebook_syrup_catalog"),
      tx.query("SELECT product_name, source_ingredient FROM pricebook_yields"),
      tx.query("SELECT id, name FROM recipe_builder_recipes"),
    ]);

    const drinkSet = new Set(drinkRes.rows.map((r) => normalizeLookupName(r.recipe_name)));
    const foodSet = new Set(foodRes.rows.map((r) => normalizeLookupName(r.recipe_name)));
    const syrupSet = new Set(syrupRes.rows.map((r) => normalizeLookupName(r.syrup_name)));

    function categoryFromCatalog(recipeName, fallbackType) {
      const key = normalizeLookupName(recipeName);
      if (syrupSet.has(key)) return "Syrup";
      if (drinkSet.has(key)) return "Drink";
      if (foodSet.has(key)) return "Final";
      const type = String(fallbackType || "").trim();
      return type || "Prep";
    }

    const builderRecipeByNorm = new Map();
    for (const row of builderExistingRes.rows) {
      const key = normalizeLookupName(row.name);
      if (key && !builderRecipeByNorm.has(key)) builderRecipeByNorm.set(key, Number(row.id));
    }

    const recipeMap = new Map();
    for (const row of recipeRowsRes.rows) {
      const recipeName = String(row.recipe_name || "").trim();
      if (!recipeName) continue;
      const category = categoryFromCatalog(recipeName, row.recipe_type);
      const existing = await tx.query("SELECT id FROM recipe_builder_recipes WHERE name = $1 LIMIT 1", [recipeName]);
      let recipeId;
      if (existing.rows.length) {
        recipeId = Number(existing.rows[0].id);
        await tx.query(
          `UPDATE recipe_builder_recipes
           SET category = $1, status = $2, yield_qty = $3, yield_unit = $4, updated_at = CURRENT_TIMESTAMP
           WHERE id = $5`,
          [category, row.status || "Draft", row.batch_yield_qty ?? null, row.batch_yield_unit ?? null, recipeId]
        );
      } else {
        const inserted = await tx.query(
          `INSERT INTO recipe_builder_recipes (name, category, status, yield_qty, yield_unit, notes, updated_at)
           VALUES ($1, $2, $3, $4, $5, '', CURRENT_TIMESTAMP)
           RETURNING id`,
          [recipeName, category, row.status || "Draft", row.batch_yield_qty ?? null, row.batch_yield_unit ?? null]
        );
        recipeId = Number(inserted.rows[0].id);
      }
      const norm = normalizeLookupName(recipeName);
      builderRecipeByNorm.set(norm, recipeId);
      recipeMap.set(recipeName, { id: recipeId, yieldUnit: row.batch_yield_unit || null });
    }

    const itemsByNormName = new Map();
    const normItemEntries = [];
    for (const row of itemRowsRes.rows) {
      const key = normalizeLookupName(row.name);
      if (key && !itemsByNormName.has(key)) itemsByNormName.set(key, Number(row.id));
      if (key) normItemEntries.push({ key, id: Number(row.id) });
    }

    const itemsBySourceIngredient = new Map();
    for (const row of mappedRowsRes.rows) {
      const key = normalizeLookupName(row.ingredient_name);
      if (key && !itemsBySourceIngredient.has(key)) itemsBySourceIngredient.set(key, Number(row.item_id));
    }

    const yieldsByProduct = new Map();
    for (const row of yieldRes.rows) {
      const product = normalizeLookupName(row.product_name);
      const source = normalizeLookupName(row.source_ingredient);
      if (product && source && !yieldsByProduct.has(product)) yieldsByProduct.set(product, source);
    }

    function findItemIdForIngredient(ingredientName) {
      const normalized = normalizeLookupName(ingredientName);
      if (!normalized) return null;

      const direct =
        itemsBySourceIngredient.get(normalized) ||
        itemsByNormName.get(normalized) ||
        null;
      if (direct) return direct;

      const yieldSource = yieldsByProduct.get(normalized);
      if (yieldSource) {
        const fromYield = itemsBySourceIngredient.get(yieldSource) || itemsByNormName.get(yieldSource) || null;
        if (fromYield) return fromYield;
      }

      const includesMatches = normItemEntries.filter(
        (entry) => entry.key.includes(normalized) || normalized.includes(entry.key)
      );
      const uniqueIds = [...new Set(includesMatches.map((m) => m.id))];
      if (uniqueIds.length === 1) return uniqueIds[0];
      return null;
    }

    function findRecipeRefId(ingredientName) {
      const normalized = normalizeLookupName(ingredientName);
      if (!normalized) return null;
      if (builderRecipeByNorm.has(normalized)) return builderRecipeByNorm.get(normalized);
      const stripped = normalizeLookupName(String(ingredientName || "").replace(/\([^)]*\)/g, " "));
      if (stripped && builderRecipeByNorm.has(stripped)) return builderRecipeByNorm.get(stripped);
      return null;
    }

    const linesByRecipe = new Map();
    for (const line of lineRowsRes.rows) {
      const recipeName = String(line.recipe_name || "").trim();
      if (!recipeName) continue;
      if (!linesByRecipe.has(recipeName)) linesByRecipe.set(recipeName, []);
      linesByRecipe.get(recipeName).push(line);
    }

    let importedRecipes = 0;
    let importedLines = 0;
    let matchedItems = 0;
    let matchedRecipeRefs = 0;
    let unmatched = 0;

    for (const [recipeName, lines] of linesByRecipe.entries()) {
      const recipe = recipeMap.get(recipeName);
      if (!recipe) continue;
      importedRecipes += 1;
      await tx.query("DELETE FROM recipe_builder_lines WHERE recipe_id = $1", [recipe.id]);

      let sortOrder = 1;
      for (const line of lines) {
        const ingredientName = String(line.ingredient_name || "").trim();
        const ingredientRecipeId = ingredientName ? findRecipeRefId(ingredientName) : null;
        const ingredientItemId = ingredientRecipeId || !ingredientName ? null : findItemIdForIngredient(ingredientName);
        const lineType = ingredientRecipeId ? "RECIPE" : "INGREDIENT";

        const mappedRecipeRef = ingredientRecipeId
          ? [...recipeMap.values()].find((r) => r.id === ingredientRecipeId)
          : null;

        const unit =
          lineType === "RECIPE"
            ? resolveRecipeReferenceUnit(line.unit ?? null, mappedRecipeRef?.yieldUnit ?? null)
            : line.unit ?? null;

        if (ingredientName) {
          if (ingredientItemId) matchedItems += 1;
          else if (ingredientRecipeId) matchedRecipeRefs += 1;
          else unmatched += 1;
        }

        const notes = [
          ingredientName ? `Source: ${ingredientName}` : null,
          line.notes || null,
          line.line_cost !== null && line.line_cost !== undefined ? `LineCost: ${line.line_cost}` : null,
        ]
          .filter(Boolean)
          .join(" | ");

        await tx.query(
          `INSERT INTO recipe_builder_lines
           (recipe_id, sort_order, line_type, ingredient_item_id, ingredient_recipe_id, quantity, unit, direction_text, cook_temperature, cook_temperature_unit, time_value, time_unit, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL, NULL, NULL, $8)`,
          [recipe.id, sortOrder, lineType, ingredientItemId, ingredientRecipeId, line.qty ?? null, unit, notes || null]
        );
        sortOrder += 1;
        importedLines += 1;
      }

      await tx.query("UPDATE recipe_builder_recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [recipe.id]);
    }

    // Yield-aware second pass for any remaining unmatched Source lines
    const unmatchedRows = await tx.query(`
      SELECT id, notes
      FROM recipe_builder_lines
      WHERE line_type = 'INGREDIENT'
        AND ingredient_item_id IS NULL
        AND ingredient_recipe_id IS NULL
        AND notes LIKE 'Source:%'
    `);

    let yieldMapped = 0;
    for (const row of unmatchedRows.rows) {
      const sourceName = parseSourceNameFromNotes(row.notes);
      const normalizedSource = normalizeLookupName(sourceName);
      const yieldSource = yieldsByProduct.get(normalizedSource);
      if (!yieldSource) continue;
      const itemId =
        itemsBySourceIngredient.get(yieldSource) ||
        itemsByNormName.get(yieldSource) ||
        null;
      if (!itemId) continue;
      const updated = await tx.query(
        `UPDATE recipe_builder_lines
         SET ingredient_item_id = $1
         WHERE id = $2
           AND ingredient_item_id IS NULL
           AND ingredient_recipe_id IS NULL`,
        [itemId, Number(row.id)]
      );
      if (Number(updated.rowCount || 0) > 0) yieldMapped += 1;
    }

    const remaining = await tx.query(`
      SELECT COUNT(*) AS c
      FROM recipe_builder_lines
      WHERE line_type = 'INGREDIENT'
        AND ingredient_item_id IS NULL
        AND ingredient_recipe_id IS NULL
        AND notes LIKE 'Source:%'
    `);

    return {
      importedRecipes,
      importedLines,
      matchedItems,
      matchedRecipeRefs,
      unmatchedInitially: unmatched,
      yieldMapped,
      unmatchedRemaining: Number(remaining.rows[0].c),
    };
  });

  const counts = await Promise.all([
    db.query("SELECT COUNT(*) AS c FROM recipe_builder_recipes"),
    db.query("SELECT COUNT(*) AS c FROM recipe_builder_lines"),
    db.query("SELECT category, COUNT(*) AS c FROM recipe_builder_recipes GROUP BY category ORDER BY c DESC, category"),
  ]);

  const pick = (q) => Number(q.rows[0].c);
  return {
    ...result,
    recipeBuilderRecipes: pick(counts[0]),
    recipeBuilderLines: pick(counts[1]),
    categories: counts[2].rows,
  };
}

async function run() {
  const summary = await importBuilderFromPricebook();
  // eslint-disable-next-line no-console
  console.log("Recipe Builder import complete:", summary);
}

if (require.main === module) {
  run().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Recipe Builder import failed:", error);
    process.exit(1);
  });
}

module.exports = {
  importBuilderFromPricebook,
};
