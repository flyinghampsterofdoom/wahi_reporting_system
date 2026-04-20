const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { z } = require("zod");
const { createDbClient, DB_CLIENT } = require("./db");
const { syncPricebookToCatalog } = require("./lib/pricebook-sync");

const app = express();
const PORT = process.env.PORT || 3000;
const db = createDbClient();
const scryptAsync = promisify(crypto.scrypt);

const SESSION_COOKIE_NAME = "wahi_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_ROLES = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  STAFF: "STAFF",
};

app.use(express.json());

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const resetOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
  newPasswordConfirm: z.string().min(1),
});

const adminChangePasswordSchema = z.object({
  newPassword: z.string().min(1),
  newPasswordConfirm: z.string().min(1),
});

const adminCreateUserSchema = z.object({
  username: z.string().trim().min(1),
  role: z.enum([AUTH_ROLES.ADMIN, AUTH_ROLES.MANAGER, AUTH_ROLES.STAFF]),
  password: z.string().min(1),
  passwordConfirm: z.string().min(1),
});

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
  densityId: z.number().int().positive().nullable().optional(),
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
  densityId: z.number().int().positive().nullable().optional(),
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

function parseCookies(cookieHeader) {
  const map = new Map();
  String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const eq = part.indexOf("=");
      if (eq <= 0) return;
      const key = part.slice(0, eq);
      const value = part.slice(eq + 1);
      map.set(key, decodeURIComponent(value));
    });
  return map;
}

function getCookie(req, name) {
  return parseCookies(req.headers.cookie).get(name) || null;
}

function toSqlTimestamp(dateValue) {
  return new Date(dateValue).toISOString().slice(0, 19).replace("T", " ");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function safeTimingEqual(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function isStrongEnoughPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

async function hashPassword(password, existingSaltHex = null) {
  const salt = existingSaltHex ? Buffer.from(existingSaltHex, "hex") : crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, 64);
  return {
    passwordSalt: salt.toString("hex"),
    passwordHash: Buffer.from(derived).toString("hex"),
  };
}

async function verifyPassword(password, passwordSalt, expectedHash) {
  if (!password || !passwordSalt || !expectedHash) return false;
  const { passwordHash } = await hashPassword(password, passwordSalt);
  return safeTimingEqual(passwordHash, expectedHash);
}

function setSessionCookie(res, token) {
  const secureCookie = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    role: row.role,
  };
}

async function createSessionForUser(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const expiresAt = toSqlTimestamp(Date.now() + SESSION_TTL_MS);
  await db.query(
    "INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt]
  );
  return token;
}

async function revokeSessionByToken(token) {
  if (!token) return;
  await db.query(
    "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND revoked_at IS NULL",
    [hashSessionToken(token)]
  );
}

async function resolveAuthUser(req) {
  const token = getCookie(req, SESSION_COOKIE_NAME);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const { rows } = await db.query(
    `
    SELECT u.id, u.username, u.role
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP
    LIMIT 1
    `,
    [tokenHash]
  );
  if (!rows.length) return null;
  return publicUser(rows[0]);
}

async function requireAuth(req, res, next) {
  const user = await resolveAuthUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required." });
  req.authUser = user;
  return next();
}

function requireRole(...roles) {
  const valid = new Set(roles);
  return (req, res, next) => {
    if (!req.authUser) return res.status(401).json({ error: "Authentication required." });
    if (!valid.has(req.authUser.role)) return res.status(403).json({ error: "Insufficient permissions." });
    return next();
  };
}

function buildLoginRedirect(req) {
  const nextUrl = encodeURIComponent(req.originalUrl || "/");
  return `/login?next=${nextUrl}`;
}

async function requirePageAuth(req, res, next) {
  const user = await resolveAuthUser(req);
  if (!user) return res.redirect(buildLoginRedirect(req));
  req.authUser = user;
  return next();
}

async function ensureInitialAdminAccount() {
  const username = "justinrawlinson";
  const password = "Password";
  const { passwordHash, passwordSalt } = await hashPassword(password);
  await db.query(
    `
    INSERT INTO users (username, role, password_hash, password_salt, updated_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    ON CONFLICT(username)
    DO UPDATE SET role = excluded.role, password_hash = excluded.password_hash, password_salt = excluded.password_salt, updated_at = CURRENT_TIMESTAMP
    `,
    [username, AUTH_ROLES.ADMIN, passwordHash, passwordSalt]
  );
}

function roundTo(value, places = 4) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function defaultBaseUnitForType(unitType) {
  const type = String(unitType || "").trim().toLowerCase();
  if (type === "volume") return "fl oz";
  if (type === "weight") return "g";
  if (type === "count" || type === "each") return "ea";
  return "";
}

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

  const volumeUnits = new Set([
    "ml",
    "l",
    "fl oz",
    "floz",
    "oz",
    "qt",
    "quart",
    "quarts",
    "gal",
    "gallon",
    "gallons",
    "cup",
    "cups",
    "tbsp",
    "tablespoon",
    "tablespoons",
    "tsp",
    "teaspoon",
    "teaspoons",
    "pt",
    "pint",
    "pints",
  ]);
  const weightUnits = new Set(["g", "gram", "grams", "kg", "oz wt", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds"]);
  const eachUnits = new Set(["ea", "each", "x", "count"]);

  if (volumeUnits.has(unit)) return "VOLUME";
  if (weightUnits.has(unit)) return "WEIGHT";
  if (eachUnits.has(unit)) return "EACH";
  return "OTHER";
}

function recipeUnitFactor(unit, category) {
  const normalized = normalizeRecipeUnit(unit);
  if (!normalized) return null;

  if (category === "VOLUME") {
    const map = {
      "fl oz": 1,
      floz: 1,
      oz: 1,
      ml: 1 / 29.5735,
      l: 33.8140227,
      qt: 32,
      gal: 128,
      cup: 8,
      cups: 8,
      tbsp: 0.5,
      tablespoon: 0.5,
      tablespoons: 0.5,
      tsp: 1 / 6,
      teaspoon: 1 / 6,
      teaspoons: 1 / 6,
      pt: 16,
      pint: 16,
      pints: 16,
      quart: 32,
      quarts: 32,
      gallon: 128,
      gallons: 128,
    };
    return map[normalized] ?? null;
  }

  if (category === "WEIGHT") {
    const map = {
      g: 1,
      gram: 1,
      grams: 1,
      kg: 1000,
      oz: 28.349523125,
      ounce: 28.349523125,
      ounces: 28.349523125,
      lb: 453.59237,
      lbs: 453.59237,
      pound: 453.59237,
      pounds: 453.59237,
    };
    return map[normalized] ?? null;
  }

  if (category === "EACH") {
    const map = {
      ea: 1,
      each: 1,
      x: 1,
      count: 1,
    };
    return map[normalized] ?? null;
  }

  return null;
}

function convertRecipeQuantity(quantity, fromUnit, toUnit) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty)) return null;

  const from = normalizeRecipeUnit(fromUnit);
  const to = normalizeRecipeUnit(toUnit);

  if (!from && !to) return qty;
  if (!from || !to || from === to) return qty;

  const toCategory = recipeUnitCategory(to);
  const fromCategory = recipeUnitCategory(from);
  const category = toCategory !== "OTHER" ? toCategory : fromCategory;
  if (category === "OTHER" || (toCategory !== "OTHER" && fromCategory !== "OTHER" && toCategory !== fromCategory)) {
    return null;
  }

  const fromFactor = recipeUnitFactor(from, category);
  const toFactor = recipeUnitFactor(to, category);
  if (!fromFactor || !toFactor) return null;

  return (qty * fromFactor) / toFactor;
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

function toCups(quantity, unit) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const converted = convertRecipeQuantity(qty, unit || "cup", "cup");
  return converted === null || converted <= 0 ? null : converted;
}

function gramsPerCupFromDensity(gramsPerCup, cupsPerLb) {
  const gpc = Number(gramsPerCup);
  if (Number.isFinite(gpc) && gpc > 0) return gpc;
  const cplb = Number(cupsPerLb);
  if (Number.isFinite(cplb) && cplb > 0) return 453.59237 / cplb;
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
      i.measure_type AS ingredient_measure_type,
      i.source_system AS ingredient_source_system,
      rr.name AS ingredient_recipe_name,
      tis.unit_cost AS ingredient_item_cost,
      tis.size_amount AS ingredient_size_amount,
      tis.size_unit AS ingredient_size_unit,
      d.grams_per_cup AS ingredient_density_grams_per_cup,
      d.cups_per_lb AS ingredient_density_cups_per_lb
    FROM recipe_builder_lines l
    LEFT JOIN items i ON i.id = l.ingredient_item_id
    LEFT JOIN item_sizes tis ON tis.item_id = i.id AND tis.is_tracked = 1
    LEFT JOIN pricebook_densities d ON d.id = i.density_id
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
    ingredientMeasureType: row.ingredient_measure_type || null,
    ingredientSourceSystem: row.ingredient_source_system || null,
    ingredientItemCost:
      row.ingredient_item_cost === null || row.ingredient_item_cost === undefined
        ? null
        : Number(row.ingredient_item_cost),
    ingredientSizeAmount:
      row.ingredient_size_amount === null || row.ingredient_size_amount === undefined
        ? null
        : Number(row.ingredient_size_amount),
    ingredientSizeUnit: row.ingredient_size_unit || null,
    ingredientDensityGramsPerCup:
      row.ingredient_density_grams_per_cup === null || row.ingredient_density_grams_per_cup === undefined
        ? null
        : Number(row.ingredient_density_grams_per_cup),
    ingredientDensityCupsPerLb:
      row.ingredient_density_cups_per_lb === null || row.ingredient_density_cups_per_lb === undefined
        ? null
        : Number(row.ingredient_density_cups_per_lb),
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

async function getRecipeMeta(tx, recipeId, metaCache = new Map()) {
  const id = Number(recipeId);
  if (metaCache.has(id)) return metaCache.get(id);

  const { rows } = await tx.query(
    "SELECT id, yield_qty, yield_unit FROM recipe_builder_recipes WHERE id = $1",
    [id]
  );

  const meta =
    rows[0] && rows[0].id
      ? {
          id: Number(rows[0].id),
          yieldQty:
            rows[0].yield_qty === null || rows[0].yield_qty === undefined
              ? null
              : Number(rows[0].yield_qty),
          yieldUnit: rows[0].yield_unit || null,
        }
      : null;
  metaCache.set(id, meta);
  return meta;
}

function parseSourceLineCost(notes) {
  const text = String(notes || "");
  const match = text.match(/LineCost:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseSourceNameFromNotes(notes) {
  const text = String(notes || "");
  const match = text.match(/Source:\s*([^|]+)/i);
  if (!match) return null;
  const value = String(match[1] || "").trim();
  return value || null;
}

function yieldUnitPrice(row) {
  const direct = Number(row.price_per_yield_unit);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const sourcePerPrice = Number(row.source_per_price);
  const yieldValue = Number(row.yield_value);
  if (Number.isFinite(sourcePerPrice) && Number.isFinite(yieldValue) && yieldValue > 0) {
    return sourcePerPrice / yieldValue;
  }
  return null;
}

async function getYieldRows(tx, yieldCache = new Map()) {
  if (yieldCache.has("all")) return yieldCache.get("all");
  const { rows } = await tx.query(`
    SELECT product_name, source_ingredient, source_per_price, yield_unit, yield_value, price_per_yield_unit
    FROM pricebook_yields
  `);
  yieldCache.set("all", rows);
  return rows;
}

async function ingredientYieldLineCost(tx, line, yieldCache = new Map()) {
  const qty = Number(line.quantity ?? 0);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const rows = await getYieldRows(tx, yieldCache);
  if (!rows.length) return null;

  const sourceName = normalizeLookupName(parseSourceNameFromNotes(line.notes));
  const ingredientName = normalizeLookupName(line.ingredientItemName);
  const unit = line.unit || null;

  const pricedCandidates = [];
  for (const row of rows) {
    const unitPrice = yieldUnitPrice(row);
    if (unitPrice === null) continue;
    const yieldUnit = row.yield_unit || null;
    const qtyInYieldUnit = convertRecipeQuantity(qty, unit || yieldUnit, yieldUnit);
    if (qtyInYieldUnit === null || !Number.isFinite(qtyInYieldUnit)) continue;

    const productName = normalizeLookupName(row.product_name);
    const sourceIngredient = normalizeLookupName(row.source_ingredient);
    let priority = 99;
    if (sourceName && sourceName === productName) priority = 1;
    else if (sourceName && sourceName === sourceIngredient) priority = 2;
    else if (ingredientName && ingredientName === sourceIngredient) priority = 3;
    else if (ingredientName && ingredientName === productName) priority = 4;
    if (priority === 99) continue;

    pricedCandidates.push({
      priority,
      cost: qtyInYieldUnit * unitPrice,
    });
  }

  if (!pricedCandidates.length) return null;
  pricedCandidates.sort((a, b) => a.priority - b.priority);
  return pricedCandidates[0].cost;
}

function trackedIngredientBaseQuantity(line) {
  const measureType = String(line.ingredientMeasureType || "").toUpperCase();
  const amount = line.ingredientSizeAmount;
  const unit = line.ingredientSizeUnit;

  if (measureType === "FLUID") {
    return toFluidOz(amount, unit);
  }
  if (measureType === "WEIGHT") {
    return convertRecipeQuantity(amount, unit || "g", "g");
  }
  if (measureType === "EA") {
    return convertRecipeQuantity(amount || 1, unit || "ea", "ea") ?? 1;
  }
  return null;
}

function ingredientLineCost(line) {
  const qty = line.quantity ?? 0;
  if (!Number.isFinite(qty) || qty <= 0 || line.ingredientItemCost === null) {
    return null;
  }

  const measureType = String(line.ingredientMeasureType || "").toUpperCase();
  const isPricebookSource = String(line.ingredientSourceSystem || "").toLowerCase() === "pricebook";

  if (isPricebookSource && line.ingredientSizeUnit) {
    const qtyInSizeUnit = convertRecipeQuantity(qty, line.unit || line.ingredientSizeUnit, line.ingredientSizeUnit);
    if (qtyInSizeUnit !== null) {
      return qtyInSizeUnit * line.ingredientItemCost;
    }
  }

  const baseQtyPerTracked = trackedIngredientBaseQuantity(line);
  if (!baseQtyPerTracked || baseQtyPerTracked <= 0) return null;

  if (measureType === "FLUID") {
    const qtyFloz = convertRecipeQuantity(qty, line.unit || "fl oz", "fl oz");
    if (qtyFloz === null) return null;
    const costPerFloz = line.ingredientItemCost / baseQtyPerTracked;
    return qtyFloz * costPerFloz;
  }

  if (measureType === "WEIGHT") {
    let qtyGrams = convertRecipeQuantity(qty, line.unit || "g", "g");
    if (qtyGrams === null) {
      const gramsPerCup = gramsPerCupFromDensity(
        line.ingredientDensityGramsPerCup,
        line.ingredientDensityCupsPerLb
      );
      const qtyCups = toCups(qty, line.unit || "cup");
      if (gramsPerCup && qtyCups) {
        qtyGrams = qtyCups * gramsPerCup;
      }
    }
    if (qtyGrams === null) return null;
    const costPerGram = line.ingredientItemCost / baseQtyPerTracked;
    return qtyGrams * costPerGram;
  }

  if (measureType === "EA") {
    const qtyEa = convertRecipeQuantity(qty, line.unit || "ea", "ea");
    if (qtyEa === null) return null;
    const costPerEa = line.ingredientItemCost / baseQtyPerTracked;
    return qtyEa * costPerEa;
  }

  return null;
}

async function calculateRecipeLineCost(
  tx,
  line,
  path = new Set(),
  totalCache = new Map(),
  metaCache = new Map(),
  yieldCache = new Map()
) {
  const qty = line.quantity ?? 0;
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const sourceLineCost = parseSourceLineCost(line.notes);

  if (line.lineType === "INGREDIENT") {
    const yieldBased = await ingredientYieldLineCost(tx, line, yieldCache);
    if (yieldBased !== null) return Number(yieldBased.toFixed(4));
    if (line.ingredientItemCost === null) {
      if (sourceLineCost !== null) return Number(sourceLineCost.toFixed(4));
      return 0;
    }
    const derived = ingredientLineCost(line);
    if (derived !== null) return Number(derived.toFixed(4));
    if (sourceLineCost !== null) return Number(sourceLineCost.toFixed(4));
    return Number((qty * line.ingredientItemCost).toFixed(4));
  }

  if (line.lineType === "RECIPE" && line.ingredientRecipeId) {
    const nestedMeta = await getRecipeMeta(tx, line.ingredientRecipeId, metaCache);
    if (!nestedMeta) return 0;

    const nestedCost = await calculateRecipeCost(tx, line.ingredientRecipeId, path, totalCache, metaCache, yieldCache);
    const yieldQty = nestedMeta.yieldQty && nestedMeta.yieldQty > 0 ? nestedMeta.yieldQty : 1;
    const qtyInYieldUnit =
      convertRecipeQuantity(qty, line.unit || nestedMeta.yieldUnit, nestedMeta.yieldUnit) ?? qty;
    const derived = Number(((qtyInYieldUnit / yieldQty) * nestedCost).toFixed(4));
    if (derived > 0) return derived;
    if (sourceLineCost !== null) return Number(sourceLineCost.toFixed(4));
    return derived;
  }

  return 0;
}

async function calculateRecipeCost(
  tx,
  recipeId,
  path = new Set(),
  totalCache = new Map(),
  metaCache = new Map(),
  yieldCache = new Map()
) {
  const id = Number(recipeId);
  if (totalCache.has(id)) return totalCache.get(id);
  if (path.has(id)) return 0;

  const nextPath = new Set(path);
  nextPath.add(id);

  const lines = await getRecipeLines(tx, id);
  let total = 0;

  for (const line of lines) {
    const lineCost = await calculateRecipeLineCost(tx, line, nextPath, totalCache, metaCache, yieldCache);
    total += lineCost;
  }

  const rounded = Number(total.toFixed(4));
  totalCache.set(id, rounded);
  return rounded;
}

app.use(async (req, res, next) => {
  const lowerPath = String(req.path || "").toLowerCase();
  if (!lowerPath.endsWith(".html")) return next();
  if (lowerPath === "/login.html") return next();
  return requirePageAuth(req, res, next);
});

app.use(
  express.static(path.join(__dirname, "public"), {
    index: false,
  })
);

app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid login payload." });

  const { rows } = await db.query(
    "SELECT id, username, role, password_hash, password_salt FROM users WHERE username = $1 LIMIT 1",
    [parsed.data.username]
  );
  if (!rows.length) return res.status(401).json({ error: "Invalid username or password." });

  const row = rows[0];
  const isValid = await verifyPassword(parsed.data.password, row.password_salt, row.password_hash);
  if (!isValid) return res.status(401).json({ error: "Invalid username or password." });

  const token = await createSessionForUser(Number(row.id));
  setSessionCookie(res, token);
  return res.json({ user: publicUser(row) });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  return res.json({ user: req.authUser });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const token = getCookie(req, SESSION_COOKIE_NAME);
  await revokeSessionByToken(token);
  clearSessionCookie(res);
  return res.status(204).send();
});

app.post("/api/auth/reset-password", requireAuth, async (req, res) => {
  const parsed = resetOwnPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid reset payload." });

  if (parsed.data.newPassword !== parsed.data.newPasswordConfirm) {
    return res.status(400).json({ error: "New password and confirmation must match exactly." });
  }
  if (!isStrongEnoughPassword(parsed.data.newPassword)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const userId = Number(req.authUser.id);
  const current = await db.query("SELECT password_hash, password_salt FROM users WHERE id = $1 LIMIT 1", [userId]);
  if (!current.rows.length) return res.status(404).json({ error: "User not found." });

  const validCurrent = await verifyPassword(
    parsed.data.currentPassword,
    current.rows[0].password_salt,
    current.rows[0].password_hash
  );
  if (!validCurrent) return res.status(401).json({ error: "Current password is incorrect." });

  const { passwordHash, passwordSalt } = await hashPassword(parsed.data.newPassword);
  await db.query(
    "UPDATE users SET password_hash = $1, password_salt = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
    [passwordHash, passwordSalt, userId]
  );
  return res.status(204).send();
});

app.get("/api/auth/users", requireAuth, requireRole(AUTH_ROLES.ADMIN), async (_req, res) => {
  const { rows } = await db.query(
    "SELECT id, username, role, created_at, updated_at FROM users ORDER BY role, username"
  );
  return res.json(
    rows.map((row) => ({
      id: Number(row.id),
      username: row.username,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  );
});

app.post("/api/auth/users", requireAuth, requireRole(AUTH_ROLES.ADMIN), async (req, res) => {
  const parsed = adminCreateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid user payload." });

  if (parsed.data.password !== parsed.data.passwordConfirm) {
    return res.status(400).json({ error: "Password and confirmation must match exactly." });
  }
  if (!isStrongEnoughPassword(parsed.data.password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const { passwordHash, passwordSalt } = await hashPassword(parsed.data.password);
    const { rows } = await db.query(
      `
      INSERT INTO users (username, role, password_hash, password_salt, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING id, username, role, created_at, updated_at
      `,
      [parsed.data.username, parsed.data.role, passwordHash, passwordSalt]
    );
    return res.status(201).json({
      id: Number(rows[0].id),
      username: rows[0].username,
      role: rows[0].role,
      createdAt: rows[0].created_at,
      updatedAt: rows[0].updated_at,
    });
  } catch (error) {
    if (normalizeSqlError(error) === "UNIQUE") {
      return res.status(409).json({ error: "Username already exists." });
    }
    return res.status(500).json({ error: "Failed to create user." });
  }
});

app.post("/api/auth/users/:id/password", requireAuth, requireRole(AUTH_ROLES.ADMIN), async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "Invalid user id." });

  const parsed = adminChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid password payload." });
  if (parsed.data.newPassword !== parsed.data.newPasswordConfirm) {
    return res.status(400).json({ error: "New password and confirmation must match exactly." });
  }
  if (!isStrongEnoughPassword(parsed.data.newPassword)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const target = await db.query("SELECT id FROM users WHERE id = $1 LIMIT 1", [userId]);
  if (!target.rows.length) return res.status(404).json({ error: "User not found." });

  const { passwordHash, passwordSalt } = await hashPassword(parsed.data.newPassword);
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE users SET password_hash = $1, password_salt = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
      [passwordHash, passwordSalt, userId]
    );
    await tx.query("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1", [userId]);
  });
  return res.status(204).send();
});

app.use("/api", async (req, res, next) => {
  if (req.path.startsWith("/auth/")) return next();
  return requireAuth(req, res, next);
});

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
      i.density_id,
      i.purchase_unit,
      i.purchase_cost,
      v.id AS vendor_id,
      v.name AS vendor_name,
      d.ingredient_name AS density_ingredient_name,
      s.id AS size_id,
      s.size_label,
      s.size_amount,
      s.size_unit,
      s.volume_ml,
      s.unit_cost,
      s.is_tracked
    FROM items i
    JOIN vendors v ON v.id = i.vendor_id
    LEFT JOIN pricebook_densities d ON d.id = i.density_id
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
        density:
          row.density_id === null || row.density_id === undefined
            ? null
            : {
                id: Number(row.density_id),
                ingredientName: row.density_ingredient_name || "",
              },
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
  const densityId = parsed.data.densityId ?? null;
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
      if (densityId !== null) {
        const density = await tx.query("SELECT id FROM pricebook_densities WHERE id = $1", [densityId]);
        if (!density.rows.length) throw new Error("DENSITY_NOT_FOUND");
      }

      const inserted = await tx.query(
        "INSERT INTO items (name, vendor_id, case_size, area_type, measure_type, density_id, purchase_unit, purchase_cost) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [name, vendorId, caseSize, areaType, measureType, densityId, purchaseUnit, purchaseCost]
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
    if (error.message === "DENSITY_NOT_FOUND") {
      return res.status(404).json({ error: "Density not found." });
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
  const densityId = parsed.data.densityId ?? null;
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
      if (densityId !== null) {
        const density = await tx.query("SELECT id FROM pricebook_densities WHERE id = $1", [densityId]);
        if (!density.rows.length) throw new Error("DENSITY_NOT_FOUND");
      }

      await tx.query(
        "UPDATE items SET name = $1, vendor_id = $2, case_size = $3, area_type = $4, measure_type = $5, density_id = $6, purchase_unit = $7, purchase_cost = $8 WHERE id = $9",
        [name, vendorId, caseSize, areaType, measureType, densityId, purchaseUnit, purchaseCost, itemId]
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
    if (error.message === "DENSITY_NOT_FOUND") return res.status(404).json({ error: "Density not found." });
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
    SELECT id, unit, unit_type, base_unit, to_base, source_row, source_file
    FROM pricebook_conversions
    ORDER BY unit
  `);
  res.json(
    rows.map((row) => ({
      id: Number(row.id),
      unit: row.unit,
      unitType: row.unit_type || "",
      baseUnit: row.base_unit || defaultBaseUnitForType(row.unit_type),
      toBase: row.to_base === null ? null : Number(row.to_base),
      sourceRow: row.source_row === null ? null : Number(row.source_row),
      sourceFile: row.source_file || "",
    }))
  );
});

app.post("/api/admin/conversions", async (req, res) => {
  const schema = z.object({
    unit: z.string().trim().min(1),
    unitType: z.string().trim().optional().default(""),
    baseUnit: z.string().trim().optional().default(""),
    toBase: z.number().positive(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid conversion payload." });

  try {
    const { rows } = await db.query(
      `
      INSERT INTO pricebook_conversions (unit, unit_type, base_unit, to_base)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [
        parsed.data.unit,
        parsed.data.unitType,
        parsed.data.baseUnit || defaultBaseUnitForType(parsed.data.unitType),
        parsed.data.toBase,
      ]
    );
    return res.status(201).json({ id: Number(rows[0].id) });
  } catch (error) {
    if (normalizeSqlError(error) === "UNIQUE") {
      return res.status(409).json({ error: "Conversion unit already exists." });
    }
    return res.status(500).json({ error: "Failed to create conversion." });
  }
});

app.put("/api/admin/conversions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid conversion id." });

  const schema = z.object({
    unit: z.string().trim().min(1),
    unitType: z.string().trim().optional().default(""),
    baseUnit: z.string().trim().optional().default(""),
    toBase: z.number().positive(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid conversion payload." });

  const result = await db.query(
    "UPDATE pricebook_conversions SET unit = $1, unit_type = $2, base_unit = $3, to_base = $4 WHERE id = $5",
    [
      parsed.data.unit,
      parsed.data.unitType,
      parsed.data.baseUnit || defaultBaseUnitForType(parsed.data.unitType),
      parsed.data.toBase,
      id,
    ]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Conversion not found." });
  return res.status(204).send();
});

app.delete("/api/admin/conversions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid conversion id." });
  await db.query("DELETE FROM pricebook_conversions WHERE id = $1", [id]);
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

app.get("/api/admin/densities", async (_req, res) => {
  const { rows } = await db.query(`
    SELECT id, ingredient_name, grams_per_cup, cups_per_lb
    FROM pricebook_densities
    ORDER BY ingredient_name
  `);

  res.json(
    rows.map((row) => ({
      id: Number(row.id),
      ingredientName: row.ingredient_name || "",
      gramsPerCup: row.grams_per_cup === null ? null : Number(row.grams_per_cup),
      cupsPerLb: row.cups_per_lb === null ? null : Number(row.cups_per_lb),
    }))
  );
});

app.put("/api/admin/densities/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid density id." });

  const schema = z.object({
    ingredientName: z.string().trim().min(1),
    gramsPerCup: z.number().nonnegative().nullable().optional(),
    cupsPerLb: z.number().nonnegative().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid density payload." });

  const result = await db.query(
    `
    UPDATE pricebook_densities
    SET ingredient_name = $1, grams_per_cup = $2, cups_per_lb = $3
    WHERE id = $4
    `,
    [parsed.data.ingredientName, parsed.data.gramsPerCup ?? null, parsed.data.cupsPerLb ?? null, id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Density not found." });
  return res.status(204).send();
});

const recipeBookQuerySchema = z.object({
  book: z.enum(["Prep", "Final", "Syrup", "Drinks"]),
});

app.get("/api/recipe-books", async (req, res) => {
  const parsed = recipeBookQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Provide book as Prep, Final, Syrup, or Drinks." });
  const { book } = parsed.data;

  const rows = await db.transaction(async (tx) => {
    const recipes = await tx.query(`
      SELECT id, name, category
      FROM recipe_builder_recipes
      ORDER BY name
    `);
    const overrides = await tx.query(
      "SELECT recipe_name, retail_price FROM recipe_book_pricing WHERE book_type = $1",
      [book]
    );
    const overrideMap = new Map(overrides.rows.map((row) => [row.recipe_name, row.retail_price]));

    function categoryToBook(category) {
      const normalized = String(category || "").trim().toLowerCase();
      if (normalized === "drink" || normalized === "drinks" || normalized === "cocktail" || normalized === "cocktails") {
        return "Drinks";
      }
      if (normalized === "syrup" || normalized === "syrups") return "Syrup";
      if (normalized === "final" || normalized === "food") return "Final";
      return "Prep";
    }

    const totalCache = new Map();
    const metaCache = new Map();
    const result = [];
    for (const row of recipes.rows) {
      if (categoryToBook(row.category) !== book) continue;
      const liveCost = await calculateRecipeCost(tx, Number(row.id), new Set(), totalCache, metaCache);
      const cost = roundTo(liveCost ?? 0, 4);
      const retailPriceRaw = overrideMap.has(row.name) ? overrideMap.get(row.name) : null;
      const retailPrice = roundTo(retailPriceRaw === null || retailPriceRaw === undefined ? null : Number(retailPriceRaw), 2);
      const profit = retailPrice === null ? null : roundTo(retailPrice - cost, 2);
      const margin = retailPrice && retailPrice > 0 ? roundTo(((retailPrice - cost) / retailPrice) * 100, 2) : null;
      result.push({
        recipeId: Number(row.id),
        recipeName: row.name,
        book,
        cost,
        retailPrice,
        marginPercent: margin,
        profit,
      });
    }

    return result;
  });

  res.json(rows);
});

app.put("/api/recipe-books/:book/:recipeName/retail", async (req, res) => {
  const book = String(req.params.book || "");
  if (!["Prep", "Final", "Syrup", "Drinks"].includes(book)) {
    return res.status(400).json({ error: "Invalid recipe book." });
  }
  const recipeName = decodeURIComponent(String(req.params.recipeName || "")).trim();
  if (!recipeName) return res.status(400).json({ error: "Invalid recipe name." });

  const parsed = z
    .object({ retailPrice: z.number().nonnegative().nullable().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid retail payload." });

  await db.query(
    `
    INSERT INTO recipe_book_pricing (book_type, recipe_name, retail_price, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT(book_type, recipe_name)
    DO UPDATE SET retail_price = excluded.retail_price, updated_at = CURRENT_TIMESTAMP
    `,
    [book, recipeName, parsed.data.retailPrice ?? null]
  );

  return res.status(204).send();
});

app.get("/api/recipe-builder/options", async (req, res) => {
  const recipeId = Number(req.query.recipeId || 0);
  const payload = await db.transaction(async (tx) => {
    const [itemsResult, recipesResult, yieldsResult] = await Promise.all([
      tx.query(`
        SELECT
          i.id,
          i.name,
          v.name AS vendor_name,
          i.area_type,
          i.measure_type,
          i.density_id,
          d.ingredient_name AS density_ingredient_name,
          d.grams_per_cup AS density_grams_per_cup,
          d.cups_per_lb AS density_cups_per_lb,
          s.size_label,
          s.size_amount,
          s.size_unit,
          s.unit_cost
        FROM items i
        JOIN vendors v ON v.id = i.vendor_id
        LEFT JOIN pricebook_densities d ON d.id = i.density_id
        JOIN item_sizes s ON s.item_id = i.id AND s.is_tracked = 1
        ORDER BY i.name
      `),
      tx.query("SELECT id, name, yield_qty, yield_unit FROM recipe_builder_recipes ORDER BY name"),
      tx.query(`
        SELECT product_name, source_ingredient, source_per_price, yield_unit, yield_value, price_per_yield_unit
        FROM pricebook_yields
      `),
    ]);

    const totalCache = new Map();
    const metaCache = new Map();
    const recipes = [];
    for (const row of recipesResult.rows) {
      const id = Number(row.id);
      if (recipeId && id === recipeId) continue;
      const totalCost = await calculateRecipeCost(tx, id, new Set(), totalCache, metaCache);
      recipes.push({
        id,
        name: row.name,
        yieldQty: row.yield_qty === null || row.yield_qty === undefined ? null : Number(row.yield_qty),
        yieldUnit: row.yield_unit || null,
        totalCost,
      });
    }

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
      densityId: row.density_id === null || row.density_id === undefined ? null : Number(row.density_id),
      densityIngredientName: row.density_ingredient_name || null,
      densityGramsPerCup:
        row.density_grams_per_cup === null || row.density_grams_per_cup === undefined
          ? null
          : Number(row.density_grams_per_cup),
      densityCupsPerLb:
        row.density_cups_per_lb === null || row.density_cups_per_lb === undefined
          ? null
          : Number(row.density_cups_per_lb),
    }));

    const yields = yieldsResult.rows.map((row) => ({
      productName: row.product_name || "",
      sourceIngredient: row.source_ingredient || "",
      sourcePerPrice: row.source_per_price === null || row.source_per_price === undefined ? null : Number(row.source_per_price),
      yieldUnit: row.yield_unit || null,
      yieldValue: row.yield_value === null || row.yield_value === undefined ? null : Number(row.yield_value),
      pricePerYieldUnit:
        row.price_per_yield_unit === null || row.price_per_yield_unit === undefined
          ? null
          : Number(row.price_per_yield_unit),
    }));

    return { items, recipes, yields };
  });

  res.json(payload);
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

    const totalCache = new Map();
    const metaCache = new Map();
    const lines = await getRecipeLines(tx, recipeId);
    const linesWithCost = [];
    for (const line of lines) {
      const lineCost = await calculateRecipeLineCost(tx, line, new Set([recipeId]), totalCache, metaCache);
      linesWithCost.push({
        ...line,
        lineCost,
      });
    }
    const totalCost = await calculateRecipeCost(tx, recipeId, new Set(), totalCache, metaCache);
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
      lines: linesWithCost,
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

app.post("/api/recipe-builder/import", async (req, res) => {
  const parsed = z.object({ recipeName: z.string().trim().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid recipe import payload." });
  const recipeName = parsed.data.recipeName;

  try {
    const result = await db.transaction(async (tx) => {
      const sourceRecipeRows = await tx.query(`
        SELECT recipe_name, recipe_type, status, batch_yield_qty, batch_yield_unit
        FROM pricebook_recipes
      `);
      const sourceRecipeByNormalizedName = new Map();
      for (const row of sourceRecipeRows.rows) {
        const key = normalizeLookupName(row.recipe_name);
        if (key && !sourceRecipeByNormalizedName.has(key)) {
          sourceRecipeByNormalizedName.set(key, row);
        }
      }

      const builderRecipeRows = await tx.query("SELECT id, name, yield_unit FROM recipe_builder_recipes");
      const builderRecipeByNormalizedName = new Map();
      for (const row of builderRecipeRows.rows) {
        const key = normalizeLookupName(row.name);
        if (key && !builderRecipeByNormalizedName.has(key)) {
          builderRecipeByNormalizedName.set(key, {
            id: Number(row.id),
            yieldUnit: row.yield_unit || null,
          });
        }
      }

      async function getOrCreateRecipeReference(refRecipeName) {
        const normalized = normalizeLookupName(refRecipeName);
        if (!normalized) return null;
        if (normalized === normalizeLookupName(recipeName)) return null; // no self-reference

        if (builderRecipeByNormalizedName.has(normalized)) {
          return builderRecipeByNormalizedName.get(normalized);
        }

        if (!sourceRecipeByNormalizedName.has(normalized)) return null;
        const src = sourceRecipeByNormalizedName.get(normalized);
        const inserted = await tx.query(
          `
          INSERT INTO recipe_builder_recipes (name, category, status, yield_qty, yield_unit, notes, updated_at)
          VALUES ($1, $2, $3, $4, $5, '', CURRENT_TIMESTAMP)
          RETURNING id
          `,
          [
            src.recipe_name,
            src.recipe_type || "General",
            src.status || "Draft",
            src.batch_yield_qty ?? null,
            src.batch_yield_unit ?? null,
          ]
        );
        const created = {
          id: Number(inserted.rows[0].id),
          yieldUnit: src.batch_yield_unit || null,
        };
        builderRecipeByNormalizedName.set(normalized, created);
        return created;
      }

      const itemRows = await tx.query("SELECT id, name FROM items");
      const itemsByNormalizedName = new Map();
      const normalizedItemEntries = [];
      for (const row of itemRows.rows) {
        const key = normalizeLookupName(row.name);
        if (key && !itemsByNormalizedName.has(key)) {
          itemsByNormalizedName.set(key, Number(row.id));
        }
        if (key) normalizedItemEntries.push({ key, id: Number(row.id) });
      }

      const sourceMapRows = await tx.query(`
        SELECT pi.ingredient_name, i.id AS item_id
        FROM pricebook_ingredients pi
        JOIN items i
          ON i.source_system = 'pricebook'
         AND i.source_key = ('ingredient:' || pi.id)
      `);
      const itemsBySourceIngredient = new Map();
      for (const row of sourceMapRows.rows) {
        const key = normalizeLookupName(row.ingredient_name);
        if (key && !itemsBySourceIngredient.has(key)) {
          itemsBySourceIngredient.set(key, Number(row.item_id));
        }
      }

      function findItemIdForIngredient(ingredientName) {
        const normalized = normalizeLookupName(ingredientName);
        if (!normalized) return null;

        const direct =
          itemsBySourceIngredient.get(normalized) ||
          itemsByNormalizedName.get(normalized) ||
          null;
        if (direct) return direct;

        const includesMatches = normalizedItemEntries.filter(
          (entry) => entry.key.includes(normalized) || normalized.includes(entry.key)
        );
        const uniqueIds = [...new Set(includesMatches.map((m) => m.id))];
        if (uniqueIds.length === 1) return uniqueIds[0];

        return null;
      }

      async function findRecipeReferenceForIngredient(ingredientName) {
        const normalized = normalizeLookupName(ingredientName);
        if (!normalized) return null;

        const direct = await getOrCreateRecipeReference(ingredientName);
        if (direct) return direct;

        const withoutParens = ingredientName.replace(/\([^)]*\)/g, " ");
        const stripped = normalizeLookupName(withoutParens);
        if (!stripped || stripped === normalized) return null;
        return getOrCreateRecipeReference(stripped);
      }

      const existing = await tx.query("SELECT id FROM recipe_builder_recipes WHERE name = $1", [recipeName]);
      let recipeId;
      if (existing.rows.length) {
        recipeId = Number(existing.rows[0].id);
      } else {
        const source = await tx.query(
          `
          SELECT recipe_name, recipe_type, status, batch_yield_qty, batch_yield_unit
          FROM pricebook_recipes
          WHERE recipe_name = $1
          `,
          [recipeName]
        );
        if (!source.rows.length) throw new Error("RECIPE_NOT_FOUND");

        const inserted = await tx.query(
          `
          INSERT INTO recipe_builder_recipes (name, category, status, yield_qty, yield_unit, notes, updated_at)
          VALUES ($1, $2, $3, $4, $5, '', CURRENT_TIMESTAMP)
          RETURNING id
          `,
          [
            source.rows[0].recipe_name,
            source.rows[0].recipe_type || "General",
            source.rows[0].status || "Draft",
            source.rows[0].batch_yield_qty ?? null,
            source.rows[0].batch_yield_unit ?? null,
          ]
        );
        recipeId = Number(inserted.rows[0].id);
      }

      await tx.query("DELETE FROM recipe_builder_lines WHERE recipe_id = $1", [recipeId]);
      const sourceLines = await tx.query(
        `
        SELECT ingredient_name, qty, unit, line_cost, notes
        FROM pricebook_recipe_lines
        WHERE recipe_name = $1
        ORDER BY id
        `,
        [recipeName]
      );

      let order = 1;
      let matchedItems = 0;
      let matchedRecipeRefs = 0;
      let unmatchedItems = 0;
      for (const line of sourceLines.rows) {
        const ingredientName = String(line.ingredient_name || "").trim();
        const matchedRecipe = ingredientName
          ? await findRecipeReferenceForIngredient(ingredientName)
          : null;
        const ingredientRecipeId = matchedRecipe ? matchedRecipe.id : null;
        const ingredientItemId =
          ingredientRecipeId || !ingredientName ? null : findItemIdForIngredient(ingredientName);
        const lineType = ingredientRecipeId ? "RECIPE" : "INGREDIENT";
        const normalizedUnit =
          lineType === "RECIPE"
            ? resolveRecipeReferenceUnit(line.unit ?? null, matchedRecipe?.yieldUnit ?? null)
            : line.unit ?? null;
        if (ingredientName) {
          if (ingredientItemId) matchedItems += 1;
          else if (ingredientRecipeId) matchedRecipeRefs += 1;
          else unmatchedItems += 1;
        }

        const lineNotes = [ingredientName ? `Source: ${ingredientName}` : null, line.notes || null, line.line_cost !== null && line.line_cost !== undefined ? `LineCost: ${line.line_cost}` : null]
          .filter(Boolean)
          .join(" | ");

        await tx.query(
          `
          INSERT INTO recipe_builder_lines
          (recipe_id, sort_order, line_type, ingredient_item_id, ingredient_recipe_id, quantity, unit, direction_text, cook_temperature, cook_temperature_unit, time_value, time_unit, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL, NULL, NULL, $8)
          `,
          [
            recipeId,
            order,
            lineType,
            ingredientItemId,
            ingredientRecipeId,
            line.qty ?? null,
            normalizedUnit,
            lineNotes || null,
          ]
        );
        order += 1;
      }

      await tx.query("UPDATE recipe_builder_recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [recipeId]);
      return {
        recipeId,
        matchedItems,
        matchedRecipeRefs,
        unmatchedItems,
        totalLines: sourceLines.rows.length,
      };
    });

    return res.json({
      id: result.recipeId,
      recipeName,
      matchedItems: result.matchedItems,
      matchedRecipeRefs: result.matchedRecipeRefs,
      unmatchedItems: result.unmatchedItems,
      totalLines: result.totalLines,
    });
  } catch (error) {
    if (error.message === "RECIPE_NOT_FOUND") {
      return res.status(404).json({ error: "Recipe not found in imported recipe catalog." });
    }
    return res.status(500).json({ error: "Failed to import recipe into recipe builder." });
  }
});

app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/", requirePageAuth, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/catalog", (_req, res) => res.redirect("/item-catalog"));
app.get("/add-item", (_req, res) => res.redirect("/item-catalog"));
app.get("/item-catalog", requirePageAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "item-catalog.html"))
);
app.get("/add-vendor", requirePageAuth, (_req, res) => res.sendFile(path.join(__dirname, "public", "add-vendor.html")));
app.get("/areas", requirePageAuth, (_req, res) => res.sendFile(path.join(__dirname, "public", "areas.html")));
app.get("/counts", requirePageAuth, (_req, res) => res.sendFile(path.join(__dirname, "public", "counts.html")));
app.get("/reorder", requirePageAuth, (_req, res) => res.sendFile(path.join(__dirname, "public", "reorder.html")));
app.get("/par-levels", requirePageAuth, (_req, res) => res.sendFile(path.join(__dirname, "public", "par-levels.html")));
app.get("/recipe-books", requirePageAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "recipe-books.html"))
);
app.get("/admin-reference", requirePageAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-reference.html"))
);
app.get("/recipe-builder", requirePageAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "recipe-builder.html"))
);
app.get("/recipe-create", requirePageAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "recipe-create.html"))
);
app.get("/security", requirePageAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "security.html"))
);
app.use(requirePageAuth, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

async function start() {
  try {
    await db.init();
    await ensureInitialAdminAccount();
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
