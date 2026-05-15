function normalizeText(value) {
  return String(value || "").trim();
}

function inferAreaType(location) {
  const loc = normalizeText(location).toUpperCase();
  if (loc.includes("BOH") || loc.includes("BACK")) return "BOH";
  return "FOH";
}

function toSizeLabel(sizeValue, purchaseUnit) {
  const value = Number(sizeValue);
  const unit = normalizeText(purchaseUnit);
  if (!Number.isFinite(value) || value <= 0) return "Tracked";
  if (!unit) return String(value);
  return `${value}${unit}`;
}

function normalizeSizeUnit(purchaseUnit) {
  const unit = normalizeText(purchaseUnit).toLowerCase();
  if (!unit) return "mL";
  if (unit.includes("ml")) return "mL";
  if (unit === "l" || unit.includes("liter")) return "L";
  if (unit.includes("fl oz") || unit.includes("fluid ounce")) return "fl oz";
  if (unit === "oz") return "oz";
  if (unit === "lb" || unit === "lbs") return "lb";
  if (unit === "kg") return "kg";
  if (unit === "g" || unit.includes("gram")) return "g";
  if (unit === "ea" || unit.includes("each")) return "ea";
  return normalizeText(purchaseUnit);
}

function inferMeasureTypeFromUnit(sizeUnit) {
  const unit = normalizeSizeUnit(sizeUnit).toLowerCase();
  if (unit === "lb" || unit === "kg" || unit === "g") return "WEIGHT";
  if (unit === "ea") return "EA";
  return "FLUID";
}

function toVolumeMl(sizeValue, purchaseUnit) {
  const value = Number(sizeValue);
  const unit = normalizeSizeUnit(purchaseUnit).toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return 750;

  const is = (...tokens) => tokens.some((t) => unit === t || unit.includes(t));
  if (is("ml", "milliliter", "milliliters")) return Math.max(1, Math.round(value));
  if (is("l", "liter", "liters", "litre", "litres")) return Math.max(1, Math.round(value * 1000));
  if (is("cl", "centiliter", "centiliters")) return Math.max(1, Math.round(value * 10));
  if (is("oz", "fl oz", "fluid ounce", "fluid ounces")) return Math.max(1, Math.round(value * 29.5735));
  if (is("gal", "gallon", "gallons")) return Math.max(1, Math.round(value * 3785.41));
  if (value >= 10) return Math.max(1, Math.round(value));
  return 750;
}

function toPurchaseFormat(purchaseUnitText) {
  const unit = normalizeText(purchaseUnitText).toLowerCase();
  if (unit.includes("case")) return "CASE";
  return "BOTTLE";
}

async function getOrCreateVendor(tx, vendorName, stats) {
  const cleanName = vendorName || "Unknown Vendor";
  const existing = await tx.query("SELECT id FROM vendors WHERE name = $1", [cleanName]);
  if (existing.rows.length) return Number(existing.rows[0].id);

  const inserted = await tx.query("INSERT INTO vendors (name) VALUES ($1) RETURNING id", [cleanName]);
  stats.vendorsCreated += 1;
  return Number(inserted.rows[0].id);
}

async function getOrCreateArea(tx, areaName, stats) {
  const cleanName = normalizeText(areaName);
  if (!cleanName) return null;

  const existing = await tx.query("SELECT id FROM areas WHERE name = $1", [cleanName]);
  if (existing.rows.length) return Number(existing.rows[0].id);

  const inserted = await tx.query("INSERT INTO areas (name) VALUES ($1) RETURNING id", [cleanName]);
  stats.areasCreated += 1;
  return Number(inserted.rows[0].id);
}

async function assignAreaIfNeeded(tx, itemId, areaId, stats) {
  if (!areaId) return;
  const existing = await tx.query(
    "SELECT id FROM item_area_assignments WHERE item_id = $1 AND area_id = $2",
    [itemId, areaId]
  );
  if (existing.rows.length) return;
  await tx.query("INSERT INTO item_area_assignments (item_id, area_id) VALUES ($1, $2)", [itemId, areaId]);
  stats.assignmentsCreated += 1;
}

async function upsertTrackedSize(tx, itemId, label, sizeAmount, sizeUnit, volumeMl, unitCost, stats) {
  const existing = await tx.query(
    "SELECT id FROM item_sizes WHERE item_id = $1 AND volume_ml = $2 ORDER BY id LIMIT 1",
    [itemId, volumeMl]
  );

  let trackedSizeId;
  if (existing.rows.length) {
    trackedSizeId = Number(existing.rows[0].id);
    await tx.query("UPDATE item_sizes SET size_label = $1, size_amount = $2, size_unit = $3, unit_cost = $4 WHERE id = $5", [
      label,
      sizeAmount,
      sizeUnit,
      unitCost ?? null,
      trackedSizeId,
    ]);
    stats.sizesUpdated += 1;
  } else {
    const inserted = await tx.query(
      "INSERT INTO item_sizes (item_id, size_label, size_amount, size_unit, volume_ml, unit_cost, is_tracked) VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING id",
      [itemId, label, sizeAmount, sizeUnit, volumeMl, unitCost ?? null]
    );
    trackedSizeId = Number(inserted.rows[0].id);
    stats.sizesCreated += 1;
  }

  await tx.query("UPDATE item_sizes SET is_tracked = 0 WHERE item_id = $1", [itemId]);
  await tx.query("UPDATE item_sizes SET is_tracked = 1 WHERE id = $1", [trackedSizeId]);
}

async function syncPricebookToCatalog(db) {
  const stats = {
    ingredientsRead: 0,
    vendorsCreated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    sizesCreated: 0,
    sizesUpdated: 0,
    areasCreated: 0,
    assignmentsCreated: 0,
  };

  await db.transaction(async (tx) => {
    const ingredients = await tx.query(`
      SELECT id, ingredient_name, vendor, sku, size_value, purchase_unit, per_price, buy_price, location
      FROM pricebook_ingredients
      ORDER BY id
    `);

    for (const row of ingredients.rows) {
      const ingredientId = Number(row.id);
      const ingredientName = normalizeText(row.ingredient_name);
      if (!ingredientName) continue;
      stats.ingredientsRead += 1;

      const vendorId = await getOrCreateVendor(tx, normalizeText(row.vendor), stats);
      const areaType = inferAreaType(row.location);
      const purchaseUnit = toPurchaseFormat(row.purchase_unit);
      const purchaseCost =
        row.buy_price === null || row.buy_price === undefined ? row.per_price ?? null : row.buy_price;
      const sizeUnit = normalizeSizeUnit(row.purchase_unit);
      const measureType = inferMeasureTypeFromUnit(sizeUnit);
      const sourceKey = `ingredient:${ingredientId}`;

      let item = await tx.query(
        "SELECT id FROM items WHERE source_system = $1 AND source_key = $2 LIMIT 1",
        ["pricebook", sourceKey]
      );

      if (!item.rows.length) {
        item = await tx.query(
          "SELECT id FROM items WHERE name = $1 AND vendor_id = $2 ORDER BY id LIMIT 1",
          [ingredientName, vendorId]
        );
      }

      let itemId;
      if (item.rows.length) {
        itemId = Number(item.rows[0].id);
        await tx.query(
          `
          UPDATE items
          SET name = $1, vendor_id = $2, area_type = $3, measure_type = $4, purchase_unit = $5, purchase_cost = $6, sku = $7, source_system = 'pricebook', source_key = $8
          WHERE id = $9
          `,
          [
            ingredientName,
            vendorId,
            areaType,
            measureType,
            purchaseUnit,
            purchaseCost,
            normalizeText(row.sku),
            sourceKey,
            itemId,
          ]
        );
        stats.itemsUpdated += 1;
      } else {
        const inserted = await tx.query(
          `
          INSERT INTO items (name, vendor_id, case_size, area_type, measure_type, purchase_unit, purchase_cost, sku, source_system, source_key)
          VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 'pricebook', $8)
          RETURNING id
          `,
          [
            ingredientName,
            vendorId,
            areaType,
            measureType,
            purchaseUnit,
            purchaseCost,
            normalizeText(row.sku),
            sourceKey,
          ]
        );
        itemId = Number(inserted.rows[0].id);
        stats.itemsCreated += 1;
      }

      const sizeLabel = toSizeLabel(row.size_value, row.purchase_unit);
      const sizeAmount = Number(row.size_value) > 0 ? Number(row.size_value) : 1;
      const volumeMl = toVolumeMl(row.size_value, row.purchase_unit);
      const buyPrice = Number(row.buy_price);
      const unitCost =
        row.per_price === null || row.per_price === undefined
          ? Number.isFinite(buyPrice) && sizeAmount > 0
            ? buyPrice / sizeAmount
            : row.buy_price
          : row.per_price;
      await upsertTrackedSize(tx, itemId, sizeLabel, sizeAmount, sizeUnit, volumeMl, unitCost, stats);

      const areaId = await getOrCreateArea(tx, row.location, stats);
      await assignAreaIfNeeded(tx, itemId, areaId, stats);
    }
  });

  return stats;
}

module.exports = { syncPricebookToCatalog };
