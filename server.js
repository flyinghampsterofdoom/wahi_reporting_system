const express = require("express");
const path = require("path");
const { z } = require("zod");
const { createDbClient, DB_CLIENT } = require("./db");
const { syncPricebookToCatalog } = require("./lib/pricebook-sync");

const app = express();
const PORT = process.env.PORT || 3000;
const db = createDbClient();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const vendorSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().optional().default(""),
  email: z.string().trim().email().or(z.literal("")).optional().default(""),
  corporateNumber: z.string().trim().optional().default(""),
  representativeName: z.string().trim().optional().default(""),
  representativePhone: z.string().trim().optional().default(""),
  representativeEmail: z.string().trim().email().or(z.literal("")).optional().default(""),
});

const itemSchema = z.object({
  name: z.string().trim().min(1),
  vendorId: z.number().int().positive(),
  caseSize: z.number().int().positive(),
  areaType: z.enum(["FOH", "BOH"]),
  sizes: z
    .array(
      z.object({
        sizeLabel: z.string().trim().min(1),
        volumeMl: z.number().int().positive(),
        isTracked: z.boolean(),
        unitCost: z.number().nonnegative().nullable().optional(),
      })
    )
    .min(1),
});

const itemUpdateSchema = z.object({
  name: z.string().trim().min(1),
  vendorId: z.number().int().positive(),
  caseSize: z.number().int().positive(),
  areaType: z.enum(["FOH", "BOH"]),
  sizes: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        sizeLabel: z.string().trim().min(1),
        volumeMl: z.number().int().positive(),
        isTracked: z.boolean(),
        unitCost: z.number().nonnegative().nullable().optional(),
      })
    )
    .min(1),
});

const countSchema = z.object({
  itemSizeId: z.number().int().positive(),
  countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fullBottles: z.number().nonnegative(),
  partialPercent: z.number().min(0).max(100),
});

const parLevelsQuerySchema = z.object({ area: z.enum(["FOH", "BOH"]) });
const parLevelUpsertSchema = z.object({
  itemSizeId: z.number().int().positive(),
  parBottles: z.number().nonnegative().nullable(),
  levelBottles: z.number().nonnegative().nullable(),
});

const countsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  area: z.enum(["FOH", "BOH"]),
});

const areaSchema = z.object({ name: z.string().trim().min(1) });
const areaAssignmentSchema = z.object({
  itemId: z.number().int().positive(),
  areaId: z.number().int().positive(),
});

const recipeCreateSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().optional().default("General"),
  status: z.string().trim().optional().default("Draft"),
  yieldQty: z.number().positive().nullable().optional(),
  yieldUnit: z.string().trim().nullable().optional(),
  notes: z.string().trim().optional().default(""),
});

const recipeUpdateSchema = recipeCreateSchema;

const recipeLineSchema = z.object({
  lineType: z.enum(["INGREDIENT", "RECIPE", "DIRECTION", "COOK_TEMPERATURE", "TIME", "NOTE"]),
  ingredientItemId: z.number().int().positive().nullable().optional(),
  ingredientRecipeId: z.number().int().positive().nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  unit: z.string().trim().nullable().optional(),
  directionText: z.string().trim().nullable().optional(),
  cookTemperature: z.number().nonnegative().nullable().optional(),
  cookTemperatureUnit: z.string().trim().nullable().optional(),
  timeValue: z.number().nonnegative().nullable().optional(),
  timeUnit: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

const recipeLinesReplaceSchema = z.object({
  lines: z.array(recipeLineSchema),
});

function hasExactlyOneTrackedSize(sizes) {
  return sizes.filter((size) => size.isTracked).length === 1;
}

function toBoolInt(v) {
  return v ? 1 : 0;
}

function normalizeSqlError(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("constraint") || msg.includes("unique")) return "UNIQUE";
  return "OTHER";
}

async function getRecipeBaseRows(tx) {
  const { rows } = await tx.query(`
    SELECT id, name, category, status, yield_qty, yield_unit, notes, created_at, updated_at
    FROM recipe_builder_recipes
    ORDER BY name
  `);
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    category: row.category,
    status: row.status,
    yieldQty: row.yield_qty === null ? null : Number(row.yield_qty),
    yieldUnit: row.yield_unit || null,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function getRecipeLines(tx, recipeId) {
  const { rows } = await tx.query(
    `
    SELECT
      l.id,
      l.recipe_id,
      l.sort_order,
      l.line_type,
      l.ingredient_item_id,
      l.ingredient_recipe_id,
      l.quantity,
      l.unit,
      l.direction_text,
      l.cook_temperature,
      l.cook_temperature_unit,
      l.time_value,
      l.time_unit,
      l.notes,
      i.name AS ingredient_item_name,
      rr.name AS ingredient_recipe_name,
      tis.unit_cost AS ingredient_item_cost
    FROM recipe_builder_lines l
    LEFT JOIN items i ON i.id = l.ingredient_item_id
    LEFT JOIN item_sizes tis ON tis.item_id = i.id AND tis.is_tracked = 1
    LEFT JOIN recipe_builder_recipes rr ON rr.id = l.ingredient_recipe_id
    WHERE l.recipe_id = $1
    ORDER BY l.sort_order, l.id
    `,
    [recipeId]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    recipeId: Number(row.recipe_id),
    sortOrder: Number(row.sort_order),
    lineType: row.line_type,
    ingredientItemId: row.ingredient_item_id ? Number(row.ingredient_item_id) : null,
    ingredientItemName: row.ingredient_item_name || null,
    ingredientItemCost:
      row.ingredient_item_cost === null || row.ingredient_item_cost === undefined
        ? null
        : Number(row.ingredient_item_cost),
    ingredientRecipeId: row.ingredient_recipe_id ? Number(row.ingredient_recipe_id) : null,
    ingredientRecipeName: row.ingredient_recipe_name || null,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit || null,
    directionText: row.direction_text || null,
    cookTemperature: row.cook_temperature === null ? null : Number(row.cook_temperature),
    cookTemperatureUnit: row.cook_temperature_unit || null,
    timeValue: row.time_value === null ? null : Number(row.time_value),
    timeUnit: row.time_unit || null,
    notes: row.notes || null,
  }));
}

async function calculateRecipeCost(tx, recipeId, path = new Set()) {
  const id = Number(recipeId);
  if (path.has(id)) return 0;
  const nextPath = new Set(path);
  nextPath.add(id);

  const lines = await getRecipeLines(tx, id);
  let total = 0;

  for (const line of lines) {
    const qty = line.quantity ?? 0;
    if (line.lineType === "INGREDIENT" && line.ingredientItemCost !== null) {
      total += qty * line.ingredientItemCost;
    } else if (line.lineType === "RECIPE" && line.ingredientRecipeId) {
      const nestedCost = await calculateRecipeCost(tx, line.ingredientRecipeId, nextPath);
      total += qty * nestedCost;
    }
  }

  return Number(total.toFixed(4));
}

app.get("/api/vendors", async (_req, res) => {
  const { rows } = await db.query("SELECT id, name FROM vendors ORDER BY name");
  res.json(rows);
});

app.post("/api/vendors", async (req, res) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid vendor payload." });

  try {
    const { rows } = await db.query(
      `
      INSERT INTO vendors
      (name, address, email, corporate_number, representative_name, representative_phone, representative_email)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name
      `,
      [
        parsed.data.name,
        parsed.data.address,
        parsed.data.email,
        parsed.data.corporateNumber,
        parsed.data.representativeName,
        parsed.data.representativePhone,
        parsed.data.representativeEmail,
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    if (normalizeSqlError(error) === "UNIQUE") {
      return res.status(409).json({ error: "Vendor already exists." });
    }
    return res.status(500).json({ error: "Failed to create vendor." });
  }
});

app.get("/api/areas", async (_req, res) => {
  const { rows } = await db.query("SELECT id, name FROM areas ORDER BY name");
  res.json(rows);
});

app.post("/api/areas", async (req, res) => {
  const parsed = areaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid area payload." });

  try {
    const { rows } = await db.query(
      "INSERT INTO areas (name) VALUES ($1) RETURNING id, name",
      [parsed.data.name]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    if (normalizeSqlError(error) === "UNIQUE") {
      return res.status(409).json({ error: "Area already exists." });
    }
    return res.status(500).json({ error: "Failed to create area." });
  }
});

app.delete("/api/areas/:id", async (req, res) => {
  const areaId = Number(req.params.id);
  if (!Number.isInteger(areaId) || areaId <= 0) {
    return res.status(400).json({ error: "Invalid area id." });
  }

  const found = await db.query("SELECT id FROM areas WHERE id = $1", [areaId]);
  if (!found.rows.length) return res.status(404).json({ error: "Area not found." });

  await db.query("DELETE FROM areas WHERE id = $1", [areaId]);
  return res.status(204).send();
});

app.get("/api/item-area-assignments", async (_req, res) => {
  const { rows } = await db.query(`
    SELECT
      ia.item_id,
      i.name AS item_name,
      i.area_type,
      v.name AS vendor_name,
      a.id AS area_id,
      a.name AS area_name
    FROM item_area_assignments ia
    JOIN items i ON i.id = ia.item_id
    JOIN vendors v ON v.id = i.vendor_id
    JOIN areas a ON a.id = ia.area_id
    ORDER BY i.name, a.name
  `);
  res.json(rows);
});

app.post("/api/item-area-assignments", async (req, res) => {
  const parsed = areaAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid area assignment payload." });
  }

  const { itemId, areaId } = parsed.data;
  const item = await db.query("SELECT id FROM items WHERE id = $1", [itemId]);
  if (!item.rows.length) return res.status(404).json({ error: "Item not found." });
  const area = await db.query("SELECT id FROM areas WHERE id = $1", [areaId]);
  if (!area.rows.length) return res.status(404).json({ error: "Area not found." });

  try {
    await db.query("INSERT INTO item_area_assignments (item_id, area_id) VALUES ($1, $2)", [
      itemId,
      areaId,
    ]);
    return res.status(201).json({ itemId, areaId });
  } catch (error) {
    if (normalizeSqlError(error) === "UNIQUE") {
      return res.status(409).json({ error: "Assignment already exists." });
    }
    return res.status(500).json({ error: "Failed to create assignment." });
  }
});

app.delete("/api/item-area-assignments", async (req, res) => {
  const parsed = areaAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid area assignment payload." });
  }
  const { itemId, areaId } = parsed.data;
  await db.query("DELETE FROM item_area_assignments WHERE item_id = $1 AND area_id = $2", [
    itemId,
    areaId,
  ]);
  res.status(204).send();
});

app.get("/api/items", async (_req, res) => {
  const { rows } = await db.query(`
    SELECT
      i.id AS item_id,
      i.name AS item_name,
      i.case_size,
      i.area_type,
      v.id AS vendor_id,
      v.name AS vendor_name,
      s.id AS size_id,
      s.size_label,
      s.volume_ml,
      s.unit_cost,
      s.is_tracked
    FROM items i
    JOIN vendors v ON v.id = i.vendor_id
    JOIN item_sizes s ON s.item_id = i.id
    ORDER BY v.name, i.name, s.volume_ml DESC
  `);

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.item_id)) {
      grouped.set(row.item_id, {
        id: Number(row.item_id),
        name: row.item_name,
        caseSize: Number(row.case_size),
        areaType: row.area_type,
        vendor: {
          id: Number(row.vendor_id),
          name: row.vendor_name,
        },
        sizes: [],
      });
    }
    grouped.get(row.item_id).sizes.push({
      id: Number(row.size_id),
      sizeLabel: row.size_label,
      volumeMl: Number(row.volume_ml),
      unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
      isTracked: Number(row.is_tracked) === 1,
    });
  }

  res.json([...grouped.values()]);
});

app.post("/api/items", async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid item payload." });

  const { name, vendorId, caseSize, areaType, sizes } = parsed.data;
  if (!hasExactlyOneTrackedSize(sizes)) {
    return res
      .status(400)
      .json({ error: "Exactly one bottle size must be marked as Track Item Size." });
  }

  try {
    const itemId = await db.transaction(async (tx) => {
      const vendor = await tx.query("SELECT id FROM vendors WHERE id = $1", [vendorId]);
      if (!vendor.rows.length) throw new Error("VENDOR_NOT_FOUND");

      const inserted = await tx.query(
        "INSERT INTO items (name, vendor_id, case_size, area_type) VALUES ($1, $2, $3, $4) RETURNING id",
        [name, vendorId, caseSize, areaType]
      );

      const id = Number(inserted.rows[0].id);
      for (const size of sizes) {
        await tx.query(
          "INSERT INTO item_sizes (item_id, size_label, volume_ml, unit_cost, is_tracked) VALUES ($1, $2, $3, $4, $5)",
          [id, size.sizeLabel, size.volumeMl, size.unitCost ?? null, toBoolInt(size.isTracked)]
        );
      }

      return id;
    });

    return res.status(201).json({ id: itemId });
  } catch (error) {
    if (error.message === "VENDOR_NOT_FOUND") {
      return res.status(404).json({ error: "Vendor not found." });
    }
    return res.status(500).json({ error: "Failed to create item." });
  }
});

app.put("/api/items/:id", async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: "Invalid item id." });
  }

  const parsed = itemUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid item payload." });

  const { name, vendorId, caseSize, areaType, sizes } = parsed.data;
  if (!hasExactlyOneTrackedSize(sizes)) {
    return res
      .status(400)
      .json({ error: "Exactly one bottle size must be marked as Track Item Size." });
  }

  try {
    await db.transaction(async (tx) => {
      const item = await tx.query("SELECT id FROM items WHERE id = $1", [itemId]);
      if (!item.rows.length) throw new Error("ITEM_NOT_FOUND");

      const vendor = await tx.query("SELECT id FROM vendors WHERE id = $1", [vendorId]);
      if (!vendor.rows.length) throw new Error("VENDOR_NOT_FOUND");

      await tx.query(
        "UPDATE items SET name = $1, vendor_id = $2, case_size = $3, area_type = $4 WHERE id = $5",
        [name, vendorId, caseSize, areaType, itemId]
      );

      const existing = await tx.query("SELECT id FROM item_sizes WHERE item_id = $1", [itemId]);
      const existingIds = new Set(existing.rows.map((r) => Number(r.id)));
      const keepIds = new Set();

      for (const size of sizes) {
        if (size.id) {
          if (!existingIds.has(size.id)) throw new Error("SIZE_NOT_FOUND");
          await tx.query(
            "UPDATE item_sizes SET size_label = $1, volume_ml = $2, unit_cost = $3, is_tracked = $4 WHERE id = $5 AND item_id = $6",
            [size.sizeLabel, size.volumeMl, size.unitCost ?? null, toBoolInt(size.isTracked), size.id, itemId]
          );
          keepIds.add(size.id);
        } else {
          const inserted = await tx.query(
            "INSERT INTO item_sizes (item_id, size_label, volume_ml, unit_cost, is_tracked) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [itemId, size.sizeLabel, size.volumeMl, size.unitCost ?? null, toBoolInt(size.isTracked)]
          );
          keepIds.add(Number(inserted.rows[0].id));
        }
      }

      for (const id of existingIds) {
        if (!keepIds.has(id)) {
          await tx.query("DELETE FROM item_sizes WHERE item_id = $1 AND id = $2", [itemId, id]);
        }
      }
    });

    return res.status(204).send();
  } catch (error) {
    if (error.message === "ITEM_NOT_FOUND") return res.status(404).json({ error: "Item not found." });
    if (error.message === "VENDOR_NOT_FOUND") return res.status(404).json({ error: "Vendor not found." });
    if (error.message === "SIZE_NOT_FOUND") {
      return res.status(400).json({ error: "One or more sizes were invalid for this item." });
    }
    return res.status(500).json({ error: "Failed to update item." });
  }
});

app.post("/api/items/:id/tracked-size", async (req, res) => {
  const itemId = Number(req.params.id);
  const itemSizeId = Number(req.body?.itemSizeId);
  if (!Number.isInteger(itemId) || itemId <= 0) return res.status(400).json({ error: "Invalid item id." });
  if (!Number.isInteger(itemSizeId) || itemSizeId <= 0) {
    return res.status(400).json({ error: "Invalid item size id." });
  }

  const item = await db.query("SELECT id FROM items WHERE id = $1", [itemId]);
  if (!item.rows.length) return res.status(404).json({ error: "Item not found." });

  const size = await db.query("SELECT id FROM item_sizes WHERE id = $1 AND item_id = $2", [
    itemSizeId,
    itemId,
  ]);
  if (!size.rows.length) {
    return res.status(404).json({ error: "Selected size does not belong to this item." });
  }

  await db.transaction(async (tx) => {
    await tx.query("UPDATE item_sizes SET is_tracked = 0 WHERE item_id = $1", [itemId]);
    await tx.query("UPDATE item_sizes SET is_tracked = 1 WHERE id = $1 AND item_id = $2", [
      itemSizeId,
      itemId,
    ]);
  });

  return res.status(204).send();
});

app.get("/api/par-levels", async (req, res) => {
  const parsed = parLevelsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Provide area as FOH or BOH." });

  const { rows } = await db.query(
    `
    SELECT
      i.id AS item_id,
      i.name AS item_name,
      i.area_type,
      s.id AS item_size_id,
      s.size_label,
      s.volume_ml,
      p.par_bottles,
      p.level_bottles
    FROM items i
    JOIN item_sizes s ON s.item_id = i.id AND s.is_tracked = 1
    LEFT JOIN par_levels p ON p.item_size_id = s.id
    WHERE i.area_type = $1
    ORDER BY i.name, s.volume_ml DESC
    `,
    [parsed.data.area]
  );

  res.json(rows);
});

app.post("/api/par-levels", async (req, res) => {
  const parsed = parLevelUpsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid par/level payload." });

  const { itemSizeId, parBottles, levelBottles } = parsed.data;
  const size = await db.query("SELECT id FROM item_sizes WHERE id = $1", [itemSizeId]);
  if (!size.rows.length) return res.status(404).json({ error: "Item size not found." });

  await db.query(
    `
    INSERT INTO par_levels (item_size_id, par_bottles, level_bottles, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT(item_size_id)
    DO UPDATE SET
      par_bottles = excluded.par_bottles,
      level_bottles = excluded.level_bottles,
      updated_at = CURRENT_TIMESTAMP
    `,
    [itemSizeId, parBottles, levelBottles]
  );

  res.status(204).send();
});

app.get("/api/counts", async (req, res) => {
  const parsed = countsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Provide date and area (FOH/BOH)." });
  }

  const { rows } = await db.query(
    `
    SELECT
      s.id AS size_id,
      s.is_tracked,
      i.area_type,
      i.name AS item_name,
      s.size_label,
      s.volume_ml,
      COALESCE(c.full_bottles, 0) AS full_bottles,
      COALESCE(c.partial_percent, 0) AS partial_percent
    FROM item_sizes s
    JOIN items i ON i.id = s.item_id
    LEFT JOIN inventory_counts c ON c.item_size_id = s.id AND c.count_date = $1
    WHERE i.area_type = $2
    ORDER BY s.is_tracked DESC, i.name, s.volume_ml DESC
    `,
    [parsed.data.date, parsed.data.area]
  );

  res.json(rows);
});

app.post("/api/counts", async (req, res) => {
  const parsed = countSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid count payload." });

  const { itemSizeId, countDate, fullBottles, partialPercent } = parsed.data;
  const size = await db.query("SELECT id FROM item_sizes WHERE id = $1", [itemSizeId]);
  if (!size.rows.length) return res.status(404).json({ error: "Item size not found." });

  await db.query(
    `
    INSERT INTO inventory_counts (item_size_id, count_date, full_bottles, partial_percent, updated_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    ON CONFLICT(item_size_id, count_date)
    DO UPDATE SET
      full_bottles = excluded.full_bottles,
      partial_percent = excluded.partial_percent,
      updated_at = CURRENT_TIMESTAMP
    `,
    [itemSizeId, countDate, fullBottles, partialPercent]
  );

  return res.status(204).send();
});

app.get("/api/reorder", async (req, res) => {
  const date = req.query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: "Provide date in YYYY-MM-DD format." });
  }

  const { rows } = await db.query(
    `
    SELECT
      i.id AS item_id,
      i.name AS item_name,
      i.case_size,
      i.area_type,
      v.name AS vendor_name,
      s.id AS size_id,
      s.size_label,
      s.volume_ml,
      p.par_bottles,
      p.level_bottles,
      COALESCE(c.full_bottles, 0) AS full_bottles,
      COALESCE(c.partial_percent, 0) AS partial_percent
    FROM item_sizes s
    JOIN items i ON i.id = s.item_id
    JOIN vendors v ON v.id = i.vendor_id
    LEFT JOIN par_levels p ON p.item_size_id = s.id
    LEFT JOIN inventory_counts c ON c.item_size_id = s.id AND c.count_date = $1
    WHERE s.is_tracked = 1
    ORDER BY v.name, i.name, s.volume_ml DESC
    `,
    [date]
  );

  const report = rows.map((row) => {
    const onHand = Number(row.full_bottles) + Number(row.partial_percent) / 100;
    const hasParLevel = row.par_bottles !== null && row.par_bottles !== undefined;
    const bottlesNeeded = hasParLevel ? Math.max(0, Number(row.par_bottles) - onHand) : 0;
    const casesToOrder = hasParLevel ? Math.ceil(bottlesNeeded / Number(row.case_size)) : 0;

    return {
      vendor: row.vendor_name,
      areaType: row.area_type,
      item: row.item_name,
      size: row.size_label,
      volumeMl: Number(row.volume_ml),
      caseSize: Number(row.case_size),
      parLevelBottles: row.par_bottles,
      levelBottles: row.level_bottles,
      hasParLevel,
      onHandBottles: Number(onHand.toFixed(2)),
      bottlesNeeded: Number(bottlesNeeded.toFixed(2)),
      suggestedCasesToOrder: casesToOrder,
    };
  });

  res.json(report);
});

app.get("/api/pricebook/summary", async (_req, res) => {
  const [ingredients, recipes, recipeLines, conversions, yields, densities, drinkCatalog, foodCatalog, syrupCatalog] =
    await Promise.all([
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
  res.json({
    ingredients: pick(ingredients),
    recipes: pick(recipes),
    recipeLines: pick(recipeLines),
    conversions: pick(conversions),
    yields: pick(yields),
    densities: pick(densities),
    drinkCatalog: pick(drinkCatalog),
    foodCatalog: pick(foodCatalog),
    syrupCatalog: pick(syrupCatalog),
  });
});

app.post("/api/pricebook/sync-catalog", async (_req, res) => {
  try {
    const stats = await syncPricebookToCatalog(db);
    return res.json({ ok: true, stats });
  } catch (_error) {
    return res.status(500).json({ error: "Failed to sync price book into item catalog." });
  }
});

app.get("/api/pricebook/recipes", async (_req, res) => {
  const { rows } = await db.query(`
    SELECT recipe_name, recipe_type, status, batch_yield_qty, batch_yield_unit, batch_cost, price_per_yield_unit
    FROM pricebook_recipes
    ORDER BY recipe_name
  `);
  res.json(rows);
});

app.get("/api/pricebook/recipe-lines", async (req, res) => {
  const recipeName = String(req.query.recipeName || "").trim();
  if (!recipeName) {
    return res.status(400).json({ error: "Provide recipeName query parameter." });
  }
  const { rows } = await db.query(
    `
    SELECT recipe_name, ingredient_name, qty, unit, line_cost, notes
    FROM pricebook_recipe_lines
    WHERE recipe_name = $1
    ORDER BY id
    `,
    [recipeName]
  );
  res.json(rows);
});

app.get("/api/recipe-builder/options", async (req, res) => {
  const recipeId = Number(req.query.recipeId || 0);
  const [itemsResult, recipesResult] = await Promise.all([
    db.query(`
      SELECT
        i.id,
        i.name,
        v.name AS vendor_name,
        i.area_type,
        s.size_label,
        s.volume_ml,
        s.unit_cost
      FROM items i
      JOIN vendors v ON v.id = i.vendor_id
      JOIN item_sizes s ON s.item_id = i.id AND s.is_tracked = 1
      ORDER BY i.name
    `),
    db.query("SELECT id, name FROM recipe_builder_recipes ORDER BY name"),
  ]);

  const items = itemsResult.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    vendorName: row.vendor_name,
    areaType: row.area_type,
    trackedSizeLabel: row.size_label,
    trackedVolumeMl: Number(row.volume_ml),
    trackedUnitCost: row.unit_cost === null ? null : Number(row.unit_cost),
  }));

  const recipes = recipesResult.rows
    .map((row) => ({ id: Number(row.id), name: row.name }))
    .filter((row) => !recipeId || row.id !== recipeId);

  res.json({ items, recipes });
});

app.get("/api/recipe-builder/recipes", async (_req, res) => {
  const recipes = await db.transaction(async (tx) => {
    const base = await getRecipeBaseRows(tx);
    const enriched = [];
    for (const recipe of base) {
      const totalCost = await calculateRecipeCost(tx, recipe.id);
      enriched.push({ ...recipe, totalCost });
    }
    return enriched;
  });
  res.json(recipes);
});

app.post("/api/recipe-builder/recipes", async (req, res) => {
  const parsed = recipeCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid recipe payload." });

  try {
    const { rows } = await db.query(
      `
      INSERT INTO recipe_builder_recipes (name, category, status, yield_qty, yield_unit, notes, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      RETURNING id
      `,
      [
        parsed.data.name,
        parsed.data.category,
        parsed.data.status,
        parsed.data.yieldQty ?? null,
        parsed.data.yieldUnit ?? null,
        parsed.data.notes,
      ]
    );
    return res.status(201).json({ id: Number(rows[0].id) });
  } catch (error) {
    if (normalizeSqlError(error) === "UNIQUE") {
      return res.status(409).json({ error: "A recipe with that name already exists." });
    }
    return res.status(500).json({ error: "Failed to create recipe." });
  }
});

app.get("/api/recipe-builder/recipes/:id", async (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) {
    return res.status(400).json({ error: "Invalid recipe id." });
  }

  const recipe = await db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `
      SELECT id, name, category, status, yield_qty, yield_unit, notes, created_at, updated_at
      FROM recipe_builder_recipes
      WHERE id = $1
      `,
      [recipeId]
    );
    if (!rows.length) return null;

    const lines = await getRecipeLines(tx, recipeId);
    const totalCost = await calculateRecipeCost(tx, recipeId);
    return {
      id: Number(rows[0].id),
      name: rows[0].name,
      category: rows[0].category,
      status: rows[0].status,
      yieldQty: rows[0].yield_qty === null ? null : Number(rows[0].yield_qty),
      yieldUnit: rows[0].yield_unit || null,
      notes: rows[0].notes || "",
      createdAt: rows[0].created_at,
      updatedAt: rows[0].updated_at,
      totalCost,
      lines,
    };
  });

  if (!recipe) return res.status(404).json({ error: "Recipe not found." });
  res.json(recipe);
});

app.put("/api/recipe-builder/recipes/:id", async (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) {
    return res.status(400).json({ error: "Invalid recipe id." });
  }

  const parsed = recipeUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid recipe payload." });

  try {
    const result = await db.query(
      `
      UPDATE recipe_builder_recipes
      SET name = $1, category = $2, status = $3, yield_qty = $4, yield_unit = $5, notes = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      `,
      [
        parsed.data.name,
        parsed.data.category,
        parsed.data.status,
        parsed.data.yieldQty ?? null,
        parsed.data.yieldUnit ?? null,
        parsed.data.notes,
        recipeId,
      ]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Recipe not found." });
    return res.status(204).send();
  } catch (error) {
    if (normalizeSqlError(error) === "UNIQUE") {
      return res.status(409).json({ error: "A recipe with that name already exists." });
    }
    return res.status(500).json({ error: "Failed to update recipe." });
  }
});

app.put("/api/recipe-builder/recipes/:id/lines", async (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) {
    return res.status(400).json({ error: "Invalid recipe id." });
  }

  const parsed = recipeLinesReplaceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid recipe lines payload." });

  for (const line of parsed.data.lines) {
    if (line.lineType === "RECIPE" && line.ingredientRecipeId === recipeId) {
      return res.status(400).json({ error: "A recipe cannot reference itself." });
    }
  }

  try {
    await db.transaction(async (tx) => {
      const recipeExists = await tx.query("SELECT id FROM recipe_builder_recipes WHERE id = $1", [recipeId]);
      if (!recipeExists.rows.length) throw new Error("RECIPE_NOT_FOUND");

      await tx.query("DELETE FROM recipe_builder_lines WHERE recipe_id = $1", [recipeId]);

      let sortOrder = 1;
      for (const line of parsed.data.lines) {
        await tx.query(
          `
          INSERT INTO recipe_builder_lines
          (recipe_id, sort_order, line_type, ingredient_item_id, ingredient_recipe_id, quantity, unit, direction_text, cook_temperature, cook_temperature_unit, time_value, time_unit, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `,
          [
            recipeId,
            sortOrder,
            line.lineType,
            line.ingredientItemId ?? null,
            line.ingredientRecipeId ?? null,
            line.quantity ?? null,
            line.unit ?? null,
            line.directionText ?? null,
            line.cookTemperature ?? null,
            line.cookTemperatureUnit ?? null,
            line.timeValue ?? null,
            line.timeUnit ?? null,
            line.notes ?? null,
          ]
        );
        sortOrder += 1;
      }

      await tx.query("UPDATE recipe_builder_recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [recipeId]);
    });
    return res.status(204).send();
  } catch (error) {
    if (error.message === "RECIPE_NOT_FOUND") {
      return res.status(404).json({ error: "Recipe not found." });
    }
    return res.status(500).json({ error: "Failed to save recipe lines." });
  }
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/catalog", (_req, res) => res.redirect("/item-catalog"));
app.get("/add-item", (_req, res) => res.redirect("/item-catalog"));
app.get("/item-catalog", (_req, res) => res.sendFile(path.join(__dirname, "public", "item-catalog.html")));
app.get("/add-vendor", (_req, res) => res.sendFile(path.join(__dirname, "public", "add-vendor.html")));
app.get("/areas", (_req, res) => res.sendFile(path.join(__dirname, "public", "areas.html")));
app.get("/counts", (_req, res) => res.sendFile(path.join(__dirname, "public", "counts.html")));
app.get("/reorder", (_req, res) => res.sendFile(path.join(__dirname, "public", "reorder.html")));
app.get("/par-levels", (_req, res) => res.sendFile(path.join(__dirname, "public", "par-levels.html")));
app.get("/recipe-builder", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "recipe-builder.html"))
);
app.use((_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

async function start() {
  try {
    await db.init();
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Bar inventory app (${DB_CLIENT}) running on http://localhost:${PORT}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to start app:", error);
    process.exit(1);
  }
}

start();
