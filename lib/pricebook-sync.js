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

function toVolumeMl(sizeValue, purchaseUnit) {
  const value = Number(sizeValue);
  const unit = normalizeText(purchaseUnit).toLowerCase();
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

async function upsertTrackedSize(tx, itemId, label, volumeMl, unitCost, stats) {
  const existing = await tx.query(
    "SELECT id FROM item_sizes WHERE item_id = $1 AND volume_ml = $2 ORDER BY id LIMIT 1",
    [itemId, volumeMl]
  );

  let trackedSizeId;
  if (existing.rows.length) {
    trackedSizeId = Number(existing.rows[0].id);
    await tx.query("UPDATE item_sizes SET size_label = $1, unit_cost = $2 WHERE id = $3", [
      label,
      unitCost ?? null,
      trackedSizeId,
    ]);
    stats.sizesUpdated += 1;
  } else {
    const inserted = await tx.query(
      "INSERT INTO item_sizes (item_id, size_label, volume_ml, unit_cost, is_tracked) VALUES ($1, $2, $3, $4, 0) RETURNING id",
      [itemId, label, volumeMl, unitCost ?? null]
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
          SET name = $1, vendor_id = $2, area_type = $3, sku = $4, source_system = 'pricebook', source_key = $5
          WHERE id = $6
          `,
          [ingredientName, vendorId, areaType, normalizeText(row.sku), sourceKey, itemId]
        );
        stats.itemsUpdated += 1;
      } else {
        const inserted = await tx.query(
          `
          INSERT INTO items (name, vendor_id, case_size, area_type, sku, source_system, source_key)
          VALUES ($1, $2, 1, $3, $4, 'pricebook', $5)
          RETURNING id
          `,
          [ingredientName, vendorId, areaType, normalizeText(row.sku), sourceKey]
        );
        itemId = Number(inserted.rows[0].id);
        stats.itemsCreated += 1;
      }

      const sizeLabel = toSizeLabel(row.size_value, row.purchase_unit);
      const volumeMl = toVolumeMl(row.size_value, row.purchase_unit);
      const unitCost =
        row.per_price === null || row.per_price === undefined ? row.buy_price : row.per_price;
      await upsertTrackedSize(tx, itemId, sizeLabel, volumeMl, unitCost, stats);

      const areaId = await getOrCreateArea(tx, row.location, stats);
      await assignAreaIfNeeded(tx, itemId, areaId, stats);
    }
  });

  return stats;
}

module.exports = { syncPricebookToCatalog };
