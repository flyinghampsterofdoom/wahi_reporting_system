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
  measureType: z.enum(["FLUID", "WEIGHT", "EA"]).optional().default("FLUID"),
  purchaseUnit: z.enum(["CASE", "BOTTLE"]).optional().default("BOTTLE"),
  purchaseCost: z.number().nonnegative().nullable().optional(),
  sizes: z
    .array(
      z.object({
        sizeLabel: z.string().trim().min(1),
        sizeAmount: z.number().positive(),
        sizeUnit: z.string().trim().min(1),
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
  measureType: z.enum(["FLUID", "WEIGHT", "EA"]).optional().default("FLUID"),
  purchaseUnit: z.enum(["CASE", "BOTTLE"]).optional().default("BOTTLE"),
  purchaseCost: z.number().nonnegative().nullable().optional(),
  sizes: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        sizeLabel: z.string().trim().min(1),
        sizeAmount: z.number().positive(),
        sizeUnit: z.string().trim().min(1),
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

function roundTo(value, places = 4) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function applyPurchasePricing(caseSize, purchaseUnit, purchaseCost, sizes) {
  if (purchaseCost === null || purchaseCost === undefined) return sizes;
  const tracked = sizes.find((size) => size.isTracked);
  if (!tracked) return sizes;

  let perBottle = Number(purchaseCost);
  if (purchaseUnit === "CASE") {
    perBottle = Number(purchaseCost) / Number(caseSize);
  }

  return sizes.map((size) =>
    size.isTracked
      ? {
          ...size,
          unitCost: Number.isFinite(perBottle) ? roundTo(perBottle, 4) : roundTo(size.unitCost ?? null, 4),
        }
      : size
  );
}

function normalizeSizeUnit(unit) {
  const raw = String(unit || "").trim();
  if (!raw) return "mL";
  const lower = raw.toLowerCase();
  if (lower === "ml") return "mL";
  if (lower === "l") return "L";
  if (lower === "fl oz" || lower === "floz") return "fl oz";
  if (lower === "qt" || lower === "quart" || lower === "quarts") return "qt";
  if (lower === "gal" || lower === "gallon" || lower === "gallons") return "gal";
  if (lower === "oz") return "oz";
  if (lower === "lb" || lower === "lbs") return "lb";
  if (lower === "g") return "g";
  if (lower === "kg") return "kg";
  if (lower === "ea" || lower === "each") return "ea";
  return raw;
}

function toLegacyVolumeValue(measureType, sizeAmount, sizeUnit) {
  const amount = Number(sizeAmount);
  const unit = normalizeSizeUnit(sizeUnit).toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return 1;

  if (measureType === "FLUID") {
    if (unit === "ml") return Math.round(amount);
    if (unit === "l") return Math.round(amount * 1000);
    if (unit === "fl oz" || unit === "oz") return Math.round(amount * 29.5735);
    if (unit === "qt") return Math.round(amount * 946.352946);
    if (unit === "gal") return Math.round(amount * 3785.411784);
    return Math.round(amount);
  }
  if (measureType === "WEIGHT") {
    if (unit === "g") return Math.round(amount);
    if (unit === "kg") return Math.round(amount * 1000);
    if (unit === "oz") return Math.round(amount * 28.3495);
    if (unit === "lb") return Math.round(amount * 453.592);
    return Math.round(amount);
  }
  return Math.round(amount);
}

function toFluidOz(sizeAmount, sizeUnit) {
  const amount = Number(sizeAmount);
  const unit = normalizeSizeUnit(sizeUnit).toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === "fl oz" || unit === "oz") return amount;
  if (unit === "ml") return amount / 29.5735;
  if (unit === "l") return (amount * 1000) / 29.5735;
  if (unit === "qt") return amount * 32;
  if (unit === "gal") return amount * 128;
  return null;
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
      i.measure_type,
      i.purchase_unit,
      i.purchase_cost,
      v.id AS vendor_id,
      v.name AS vendor_name,
      s.id AS size_id,
      s.size_label,
      s.size_amount,
      s.size_unit,
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
        measureType: row.measure_type || "FLUID",
        purchaseUnit: row.purchase_unit || "BOTTLE",
        purchaseCost:
          row.purchase_cost === null || row.purchase_cost === undefined ? null : roundTo(row.purchase_cost, 2),
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
      sizeAmount:
        row.size_amount === null || row.size_amount === undefined ? Number(row.volume_ml) : Number(row.size_amount),
      sizeUnit: row.size_unit || "mL",
      volumeMl: Number(row.volume_ml),
      unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : roundTo(row.unit_cost, 4),
      isTracked: Number(row.is_tracked) === 1,
    });
  }
  const items = [...grouped.values()].map((item) => {
    const tracked = item.sizes.find((size) => size.isTracked);
    const trackedUnitCost = tracked?.unitCost ?? null;
    let trackedCostPerUnit =
      tracked && trackedUnitCost !== null && tracked.sizeAmount
        ? Number((trackedUnitCost / tracked.sizeAmount).toFixed(6))
        : null;
    let trackedCostPerUnitLabel = tracked?.sizeUnit || "unit";
    let trackedCostPerFloz = null;
    if (item.measureType === "FLUID" && tracked && trackedUnitCost !== null) {
      const flozAmount = toFluidOz(tracked.sizeAmount, tracked.sizeUnit);
      if (flozAmount && flozAmount > 0) {
        trackedCostPerFloz = Number((trackedUnitCost / flozAmount).toFixed(6));
        trackedCostPerUnit = trackedCostPerFloz;
        trackedCostPerUnitLabel = "fl oz";
      }
    }
    return { ...item, trackedUnitCost, trackedCostPerUnit, trackedCostPerUnitLabel, trackedCostPerFloz };
  });

  res.json(items);
});

app.post("/api/items", async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid item payload." });

  const { name, vendorId, caseSize, areaType, measureType, purchaseUnit } = parsed.data;
  const purchaseCost = roundTo(parsed.data.purchaseCost ?? null, 2);
  const sizes = applyPurchasePricing(caseSize, purchaseUnit, purchaseCost, parsed.data.sizes).map((size) => ({
    ...size,
    unitCost: roundTo(size.unitCost ?? null, 4),
  }));
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
        "INSERT INTO items (name, vendor_id, case_size, area_type, measure_type, purchase_unit, purchase_cost) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [name, vendorId, caseSize, areaType, measureType, purchaseUnit, purchaseCost]
      );

      const id = Number(inserted.rows[0].id);
      for (const size of sizes) {
        await tx.query(
          "INSERT INTO item_sizes (item_id, size_label, size_amount, size_unit, volume_ml, unit_cost, is_tracked) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [
            id,
            size.sizeLabel,
            size.sizeAmount,
            normalizeSizeUnit(size.sizeUnit),
            toLegacyVolumeValue(measureType, size.sizeAmount, size.sizeUnit),
            roundTo(size.unitCost ?? null, 4),
            toBoolInt(size.isTracked),
          ]
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

  const { name, vendorId, caseSize, areaType, measureType, purchaseUnit } = parsed.data;
  const purchaseCost = roundTo(parsed.data.purchaseCost ?? null, 2);
  const sizes = applyPurchasePricing(caseSize, purchaseUnit, purchaseCost, parsed.data.sizes).map((size) => ({
    ...size,
    unitCost: roundTo(size.unitCost ?? null, 4),
  }));
  if (!hasExactlyOneTrackedSize(sizes)) {
    return res
      .status(400)
      .json({ error: "Exactly one bottle size must be marked as Track Item Size." });
  }

  try {
    await db.transaction(async (tx) => {
      const item = await tx.query(
        "SELECT id, source_system, source_key FROM items WHERE id = $1",
        [itemId]
      );
      if (!item.rows.length) throw new Error("ITEM_NOT_FOUND");

      const vendor = await tx.query("SELECT id FROM vendors WHERE id = $1", [vendorId]);
      if (!vendor.rows.length) throw new Error("VENDOR_NOT_FOUND");

      await tx.query(
        "UPDATE items SET name = $1, vendor_id = $2, case_size = $3, area_type = $4, measure_type = $5, purchase_unit = $6, purchase_cost = $7 WHERE id = $8",
        [name, vendorId, caseSize, areaType, measureType, purchaseUnit, purchaseCost, itemId]
      );

      const sourceSystem = String(item.rows[0].source_system || "");
      const sourceKey = String(item.rows[0].source_key || "");
      if (sourceSystem === "pricebook" && sourceKey.startsWith("ingredient:")) {
        const ingredientId = Number(sourceKey.split(":")[1]);
        if (Number.isInteger(ingredientId) && ingredientId > 0) {
          await tx.query(
            "UPDATE pricebook_ingredients SET buy_price = $1 WHERE id = $2",
            [purchaseCost, ingredientId]
          );
        }
      }

      const existing = await tx.query("SELECT id FROM item_sizes WHERE item_id = $1", [itemId]);
      const existingIds = new Set(existing.rows.map((r) => Number(r.id)));
      const keepIds = new Set();

      for (const size of sizes) {
        if (size.id) {
          if (!existingIds.has(size.id)) throw new Error("SIZE_NOT_FOUND");
          await tx.query(
            "UPDATE item_sizes SET size_label = $1, size_amount = $2, size_unit = $3, volume_ml = $4, unit_cost = $5, is_tracked = $6 WHERE id = $7 AND item_id = $8",
            [
              size.sizeLabel,
              size.sizeAmount,
              normalizeSizeUnit(size.sizeUnit),
              toLegacyVolumeValue(measureType, size.sizeAmount, size.sizeUnit),
              roundTo(size.unitCost ?? null, 4),
              toBoolInt(size.isTracked),
              size.id,
              itemId,
            ]
          );
          keepIds.add(size.id);
        } else {
          const inserted = await tx.query(
            "INSERT INTO item_sizes (item_id, size_label, size_amount, size_unit, volume_ml, unit_cost, is_tracked) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
            [
              itemId,
              size.sizeLabel,
              size.sizeAmount,
              normalizeSizeUnit(size.sizeUnit),
              toLegacyVolumeValue(measureType, size.sizeAmount, size.sizeUnit),
              roundTo(size.unitCost ?? null, 4),
              toBoolInt(size.isTracked),
            ]
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
      s.size_amount,
      s.size_unit,
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
      s.size_amount,
      s.size_unit,
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
      s.size_amount,
      s.size_unit,
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
      sizeAmount: row.size_amount === null || row.size_amount === undefined ? null : Number(row.size_amount),
      sizeUnit: row.size_unit || null,
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

app.get("/api/admin/conversions", async (_req, res) => {
  const { rows } = await db.query(`
    SELECT id, unit, unit_type, to_base, source_row, source_file
    FROM pricebook_conversions
    ORDER BY unit
  `);
  res.json(
    rows.map((row) => ({
      id: Number(row.id),
      unit: row.unit,
      unitType: row.unit_type || "",
      toBase: row.to_base === null ? null : Number(row.to_base),
      sourceRow: row.source_row === null ? null : Number(row.source_row),
      sourceFile: row.source_file || "",
    }))
  );
});

app.put("/api/admin/conversions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid conversion id." });

  const schema = z.object({
    unit: z.string().trim().min(1),
    unitType: z.string().trim().optional().default(""),
    toBase: z.number().positive(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid conversion payload." });

  const result = await db.query(
    "UPDATE pricebook_conversions SET unit = $1, unit_type = $2, to_base = $3 WHERE id = $4",
    [parsed.data.unit, parsed.data.unitType, parsed.data.toBase, id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Conversion not found." });
  return res.status(204).send();
});

app.get("/api/admin/yields", async (_req, res) => {
  const { rows } = await db.query(`
    SELECT
      id,
      product_name,
      source_ingredient,
      purchase_unit,
      source_per_price,
      yield_unit,
      yield_value,
      price_per_yield_unit,
      key_value,
      verified_by,
      verified_date,
      notes
    FROM pricebook_yields
    ORDER BY product_name, id
  `);

  res.json(
    rows.map((row) => ({
      id: Number(row.id),
      productName: row.product_name || "",
      sourceIngredient: row.source_ingredient || "",
      purchaseUnit: row.purchase_unit || "",
      sourcePerPrice: row.source_per_price === null ? null : Number(row.source_per_price),
      yieldUnit: row.yield_unit || "",
      yieldValue: row.yield_value === null ? null : Number(row.yield_value),
      pricePerYieldUnit: row.price_per_yield_unit === null ? null : Number(row.price_per_yield_unit),
      key: row.key_value || "",
      verifiedBy: row.verified_by || "",
      verifiedDate: row.verified_date || "",
      notes: row.notes || "",
    }))
  );
});

app.put("/api/admin/yields/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid yield id." });

  const schema = z.object({
    productName: z.string().trim().min(1),
    sourceIngredient: z.string().trim().optional().default(""),
    purchaseUnit: z.string().trim().optional().default(""),
    sourcePerPrice: z.number().nonnegative().nullable().optional(),
    yieldUnit: z.string().trim().optional().default(""),
    yieldValue: z.number().nonnegative().nullable().optional(),
    pricePerYieldUnit: z.number().nonnegative().nullable().optional(),
    key: z.string().trim().optional().default(""),
    verifiedBy: z.string().trim().optional().default(""),
    verifiedDate: z.string().trim().optional().default(""),
    notes: z.string().trim().optional().default(""),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid yield payload." });

  const result = await db.query(
    `
    UPDATE pricebook_yields
    SET
      product_name = $1,
      source_ingredient = $2,
      purchase_unit = $3,
      source_per_price = $4,
      yield_unit = $5,
      yield_value = $6,
      price_per_yield_unit = $7,
      key_value = $8,
      verified_by = $9,
      verified_date = $10,
      notes = $11
    WHERE id = $12
    `,
    [
      parsed.data.productName,
      parsed.data.sourceIngredient,
      parsed.data.purchaseUnit,
      parsed.data.sourcePerPrice ?? null,
      parsed.data.yieldUnit,
      parsed.data.yieldValue ?? null,
      parsed.data.pricePerYieldUnit ?? null,
      parsed.data.key,
      parsed.data.verifiedBy,
      parsed.data.verifiedDate,
      parsed.data.notes,
      id,
    ]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Yield not found." });
  return res.status(204).send();
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
        i.measure_type,
        s.size_label,
        s.size_amount,
        s.size_unit,
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
    measureType: row.measure_type || "FLUID",
    trackedSizeLabel: row.size_label,
    trackedSizeAmount:
      row.size_amount === null || row.size_amount === undefined ? null : Number(row.size_amount),
    trackedSizeUnit: row.size_unit || null,
    trackedUnitCost: row.unit_cost === null ? null : roundTo(row.unit_cost, 4),
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
app.get("/admin-reference", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-reference.html"))
);
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
