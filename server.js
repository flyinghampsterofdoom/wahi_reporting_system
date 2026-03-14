const express = require("express");
const path = require("path");
const { z } = require("zod");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const vendorSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().optional().default(""),
  email: z.string().trim().email().or(z.literal("")).optional().default(""),
  corporateNumber: z.string().trim().optional().default(""),
  representativeName: z.string().trim().optional().default(""),
  representativePhone: z.string().trim().optional().default(""),
  representativeEmail: z
    .string()
    .trim()
    .email()
    .or(z.literal(""))
    .optional()
    .default(""),
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

const parLevelsQuerySchema = z.object({
  area: z.enum(["FOH", "BOH"]),
});

const parLevelUpsertSchema = z.object({
  itemSizeId: z.number().int().positive(),
  parBottles: z.number().nonnegative().nullable(),
  levelBottles: z.number().nonnegative().nullable(),
});

const countsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  area: z.enum(["FOH", "BOH"]),
});

const areaSchema = z.object({
  name: z.string().trim().min(1),
});

const areaAssignmentSchema = z.object({
  itemId: z.number().int().positive(),
  areaId: z.number().int().positive(),
});

function hasExactlyOneTrackedSize(sizes) {
  return sizes.filter((size) => size.isTracked).length === 1;
}

app.get("/api/vendors", (_req, res) => {
  const rows = db.prepare("SELECT id, name FROM vendors ORDER BY name").all();
  res.json(rows);
});

app.post("/api/vendors", (req, res) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid vendor payload." });
  }

  try {
    const result = db
      .prepare(
        `
        INSERT INTO vendors
        (name, address, email, corporate_number, representative_name, representative_phone, representative_email)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        parsed.data.name,
        parsed.data.address,
        parsed.data.email,
        parsed.data.corporateNumber,
        parsed.data.representativeName,
        parsed.data.representativePhone,
        parsed.data.representativeEmail
      );
    res.status(201).json({ id: result.lastInsertRowid, name: parsed.data.name });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Vendor already exists." });
    }
    return res.status(500).json({ error: "Failed to create vendor." });
  }
});

app.get("/api/areas", (_req, res) => {
  const rows = db.prepare("SELECT id, name FROM areas ORDER BY name").all();
  res.json(rows);
});

app.post("/api/areas", (req, res) => {
  const parsed = areaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid area payload." });
  }

  try {
    const result = db
      .prepare("INSERT INTO areas (name) VALUES (?)")
      .run(parsed.data.name);
    return res.status(201).json({ id: result.lastInsertRowid, name: parsed.data.name });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Area already exists." });
    }
    return res.status(500).json({ error: "Failed to create area." });
  }
});

app.delete("/api/areas/:id", (req, res) => {
  const areaId = Number(req.params.id);
  if (!Number.isInteger(areaId) || areaId <= 0) {
    return res.status(400).json({ error: "Invalid area id." });
  }

  const exists = db.prepare("SELECT id FROM areas WHERE id = ?").get(areaId);
  if (!exists) return res.status(404).json({ error: "Area not found." });

  db.prepare("DELETE FROM areas WHERE id = ?").run(areaId);
  return res.status(204).send();
});

app.get("/api/item-area-assignments", (_req, res) => {
  const rows = db
    .prepare(
      `
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
      `
    )
    .all();
  res.json(rows);
});

app.post("/api/item-area-assignments", (req, res) => {
  const parsed = areaAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid area assignment payload." });
  }

  const { itemId, areaId } = parsed.data;
  const itemExists = db.prepare("SELECT id FROM items WHERE id = ?").get(itemId);
  const areaExists = db.prepare("SELECT id FROM areas WHERE id = ?").get(areaId);
  if (!itemExists) return res.status(404).json({ error: "Item not found." });
  if (!areaExists) return res.status(404).json({ error: "Area not found." });

  try {
    db.prepare("INSERT INTO item_area_assignments (item_id, area_id) VALUES (?, ?)").run(
      itemId,
      areaId
    );
    return res.status(201).json({ itemId, areaId });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Assignment already exists." });
    }
    return res.status(500).json({ error: "Failed to create assignment." });
  }
});

app.delete("/api/item-area-assignments", (req, res) => {
  const parsed = areaAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid area assignment payload." });
  }
  const { itemId, areaId } = parsed.data;
  db.prepare("DELETE FROM item_area_assignments WHERE item_id = ? AND area_id = ?").run(
    itemId,
    areaId
  );
  res.status(204).send();
});

app.get("/api/pricebook/summary", (_req, res) => {
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
  res.json(summary);
});

app.get("/api/pricebook/recipes", (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT recipe_name, recipe_type, status, batch_yield_qty, batch_yield_unit, batch_cost, price_per_yield_unit
      FROM pricebook_recipes
      ORDER BY recipe_name
      `
    )
    .all();
  res.json(rows);
});

app.get("/api/pricebook/recipe-lines", (req, res) => {
  const recipeName = String(req.query.recipeName || "").trim();
  if (!recipeName) {
    return res.status(400).json({ error: "Provide recipeName query parameter." });
  }
  const rows = db
    .prepare(
      `
      SELECT recipe_name, ingredient_name, qty, unit, line_cost, notes
      FROM pricebook_recipe_lines
      WHERE recipe_name = ?
      ORDER BY id
      `
    )
    .all(recipeName);
  res.json(rows);
});

app.get("/api/items", (_req, res) => {
  const rows = db
    .prepare(
      `
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
        s.is_tracked
      FROM items i
      JOIN vendors v ON v.id = i.vendor_id
      JOIN item_sizes s ON s.item_id = i.id
      ORDER BY v.name, i.name, s.volume_ml DESC
      `
    )
    .all();

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.item_id)) {
      grouped.set(row.item_id, {
        id: row.item_id,
        name: row.item_name,
        caseSize: row.case_size,
        areaType: row.area_type,
        vendor: {
          id: row.vendor_id,
          name: row.vendor_name,
        },
        sizes: [],
      });
    }
    grouped.get(row.item_id).sizes.push({
      id: row.size_id,
      sizeLabel: row.size_label,
      volumeMl: row.volume_ml,
      isTracked: Boolean(row.is_tracked),
    });
  }

  res.json([...grouped.values()]);
});

app.post("/api/items", (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid item payload." });
  }

  const { name, vendorId, caseSize, areaType, sizes } = parsed.data;
  if (!hasExactlyOneTrackedSize(sizes)) {
    return res
      .status(400)
      .json({ error: "Exactly one bottle size must be marked as Track Item Size." });
  }

  const insertItem = db.prepare(
    "INSERT INTO items (name, vendor_id, case_size, area_type) VALUES (?, ?, ?, ?)"
  );
  const insertSize = db.prepare(
    "INSERT INTO item_sizes (item_id, size_label, volume_ml, is_tracked) VALUES (?, ?, ?, ?)"
  );
  const vendorExists = db.prepare("SELECT id FROM vendors WHERE id = ?");

  const tx = db.transaction(() => {
    const vendor = vendorExists.get(vendorId);
    if (!vendor) {
      throw new Error("VENDOR_NOT_FOUND");
    }

    const itemResult = insertItem.run(name, vendorId, caseSize, areaType);
    for (const size of sizes) {
      insertSize.run(
        itemResult.lastInsertRowid,
        size.sizeLabel,
        size.volumeMl,
        size.isTracked ? 1 : 0
      );
    }

    return itemResult.lastInsertRowid;
  });

  try {
    const itemId = tx();
    return res.status(201).json({ id: itemId });
  } catch (error) {
    if (error.message === "VENDOR_NOT_FOUND") {
      return res.status(404).json({ error: "Vendor not found." });
    }
    return res.status(500).json({ error: "Failed to create item." });
  }
});

app.put("/api/items/:id", (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: "Invalid item id." });
  }

  const parsed = itemUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid item payload." });
  }

  const { name, vendorId, caseSize, areaType, sizes } = parsed.data;
  if (!hasExactlyOneTrackedSize(sizes)) {
    return res
      .status(400)
      .json({ error: "Exactly one bottle size must be marked as Track Item Size." });
  }
  const vendorExists = db.prepare("SELECT id FROM vendors WHERE id = ?");
  const itemExists = db.prepare("SELECT id FROM items WHERE id = ?");
  const updateItem = db.prepare(
    "UPDATE items SET name = ?, vendor_id = ?, case_size = ?, area_type = ? WHERE id = ?"
  );
  const fetchExistingSizes = db.prepare(
    "SELECT id FROM item_sizes WHERE item_id = ?"
  );
  const updateSize = db.prepare(
    "UPDATE item_sizes SET size_label = ?, volume_ml = ?, is_tracked = ? WHERE id = ? AND item_id = ?"
  );
  const insertSize = db.prepare(
    "INSERT INTO item_sizes (item_id, size_label, volume_ml, is_tracked) VALUES (?, ?, ?, ?)"
  );
  const deleteRemovedSizes = db.prepare(
    "DELETE FROM item_sizes WHERE item_id = ? AND id = ?"
  );

  const tx = db.transaction(() => {
    if (!itemExists.get(itemId)) throw new Error("ITEM_NOT_FOUND");
    if (!vendorExists.get(vendorId)) throw new Error("VENDOR_NOT_FOUND");

    updateItem.run(name, vendorId, caseSize, areaType, itemId);

    const existingIds = new Set(fetchExistingSizes.all(itemId).map((row) => row.id));
    const keptIds = new Set();

    for (const size of sizes) {
      if (size.id) {
        if (!existingIds.has(size.id)) throw new Error("SIZE_NOT_FOUND");
        updateSize.run(
          size.sizeLabel,
          size.volumeMl,
          size.isTracked ? 1 : 0,
          size.id,
          itemId
        );
        keptIds.add(size.id);
      } else {
        const inserted = insertSize.run(
          itemId,
          size.sizeLabel,
          size.volumeMl,
          size.isTracked ? 1 : 0
        );
        keptIds.add(inserted.lastInsertRowid);
      }
    }

    for (const existingId of existingIds) {
      if (!keptIds.has(existingId)) {
        deleteRemovedSizes.run(itemId, existingId);
      }
    }
  });

  try {
    tx();
    return res.status(204).send();
  } catch (error) {
    if (error.message === "ITEM_NOT_FOUND") {
      return res.status(404).json({ error: "Item not found." });
    }
    if (error.message === "VENDOR_NOT_FOUND") {
      return res.status(404).json({ error: "Vendor not found." });
    }
    if (error.message === "SIZE_NOT_FOUND") {
      return res.status(400).json({ error: "One or more sizes were invalid for this item." });
    }
    return res.status(500).json({ error: "Failed to update item." });
  }
});

app.post("/api/items/:id/tracked-size", (req, res) => {
  const itemId = Number(req.params.id);
  const itemSizeId = Number(req.body?.itemSizeId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: "Invalid item id." });
  }
  if (!Number.isInteger(itemSizeId) || itemSizeId <= 0) {
    return res.status(400).json({ error: "Invalid item size id." });
  }

  const itemExists = db.prepare("SELECT id FROM items WHERE id = ?").get(itemId);
  if (!itemExists) return res.status(404).json({ error: "Item not found." });

  const sizeExists = db
    .prepare("SELECT id FROM item_sizes WHERE id = ? AND item_id = ?")
    .get(itemSizeId, itemId);
  if (!sizeExists) {
    return res.status(404).json({ error: "Selected size does not belong to this item." });
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE item_sizes SET is_tracked = 0 WHERE item_id = ?").run(itemId);
    db.prepare("UPDATE item_sizes SET is_tracked = 1 WHERE id = ? AND item_id = ?").run(
      itemSizeId,
      itemId
    );
  });

  try {
    tx();
    return res.status(204).send();
  } catch (_error) {
    return res.status(500).json({ error: "Failed to update tracked item size." });
  }
});

app.get("/api/par-levels", (req, res) => {
  const parsed = parLevelsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Provide area as FOH or BOH." });
  }

  const rows = db
    .prepare(
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
      WHERE i.area_type = ?
      ORDER BY i.name, s.volume_ml DESC
      `
    )
    .all(parsed.data.area);

  res.json(rows);
});

app.post("/api/par-levels", (req, res) => {
  const parsed = parLevelUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid par/level payload." });
  }

  const { itemSizeId, parBottles, levelBottles } = parsed.data;
  const sizeExists = db.prepare("SELECT id FROM item_sizes WHERE id = ?").get(itemSizeId);
  if (!sizeExists) {
    return res.status(404).json({ error: "Item size not found." });
  }

  db.prepare(
    `
    INSERT INTO par_levels (item_size_id, par_bottles, level_bottles, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(item_size_id)
    DO UPDATE SET
      par_bottles = excluded.par_bottles,
      level_bottles = excluded.level_bottles,
      updated_at = datetime('now')
    `
  ).run(itemSizeId, parBottles, levelBottles);

  res.status(204).send();
});

app.get("/api/counts", (req, res) => {
  const parsed = countsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Provide date and area (FOH/BOH)." });
  }
  const { date, area } = parsed.data;

  const rows = db
    .prepare(
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
      LEFT JOIN inventory_counts c ON c.item_size_id = s.id AND c.count_date = ?
      WHERE i.area_type = ?
      ORDER BY s.is_tracked DESC, i.name, s.volume_ml DESC
      `
    )
    .all(date, area);

  res.json(rows);
});

app.post("/api/counts", (req, res) => {
  const parsed = countSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid count payload." });
  }

  const { itemSizeId, countDate, fullBottles, partialPercent } = parsed.data;
  const exists = db.prepare("SELECT id FROM item_sizes WHERE id = ?").get(itemSizeId);
  if (!exists) {
    return res.status(404).json({ error: "Item size not found." });
  }

  db.prepare(
    `
    INSERT INTO inventory_counts (item_size_id, count_date, full_bottles, partial_percent, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(item_size_id, count_date)
    DO UPDATE SET
      full_bottles = excluded.full_bottles,
      partial_percent = excluded.partial_percent,
      updated_at = datetime('now')
    `
  ).run(itemSizeId, countDate, fullBottles, partialPercent);

  res.status(204).send();
});

app.get("/api/reorder", (req, res) => {
  const date = req.query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Provide date in YYYY-MM-DD format." });
  }

  const rows = db
    .prepare(
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
      LEFT JOIN inventory_counts c ON c.item_size_id = s.id AND c.count_date = ?
      WHERE s.is_tracked = 1
      ORDER BY v.name, i.name, s.volume_ml DESC
      `
    )
    .all(date);

  const report = rows.map((row) => {
    const onHand = row.full_bottles + row.partial_percent / 100;
    const hasParLevel = row.par_bottles !== null && row.par_bottles !== undefined;
    const bottlesNeeded = hasParLevel ? Math.max(0, row.par_bottles - onHand) : 0;
    const casesToOrder = hasParLevel ? Math.ceil(bottlesNeeded / row.case_size) : 0;

    return {
      vendor: row.vendor_name,
      areaType: row.area_type,
      item: row.item_name,
      size: row.size_label,
      volumeMl: row.volume_ml,
      caseSize: row.case_size,
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

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/catalog", (_req, res) => {
  res.redirect("/item-catalog");
});

app.get("/add-item", (_req, res) => {
  res.redirect("/item-catalog");
});

app.get("/item-catalog", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "item-catalog.html"));
});

app.get("/add-vendor", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "add-vendor.html"));
});

app.get("/areas", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "areas.html"));
});

app.get("/counts", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "counts.html"));
});

app.get("/reorder", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "reorder.html"));
});

app.get("/par-levels", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "par-levels.html"));
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Bar inventory app running on http://localhost:${PORT}`);
});
