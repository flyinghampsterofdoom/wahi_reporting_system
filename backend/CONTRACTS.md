# Application service contracts

All calls are server-side JavaScript. No HTTP endpoint accepts arbitrary principal claims.
`actor = { id: string, role: 'ADMIN' | 'MANAGER' | 'LEAD' | 'STAFF' }` is supplied only by a
trusted authenticated adapter. Missing/unknown principals fail with `code: unauthenticated`;
insufficient capability fails with `code: forbidden`. IDs are UUIDs. All numeric monetary
and quantity inputs are decimal strings; binary JavaScript numbers are rejected.

## Writes

`await service.execute(actor, command, input)` returns `{id, changeId}` and, when created,
`measurementKey` or `componentKey`. Audit and state changes commit together or both roll back.
Unknown input properties fail validation. Validation failures are Zod errors; reference,
temporal collision and correction errors reject the promise. Cycles reject with
`code: 'cycle', cyclePath: [ingredientId, ..., ingredientId]`.

Every command requires `provenance: {kind, reference?}`. Kinds: manual, website,
purchase_order, invoice, vendor_quote, manual_verification, historical_workbook, other.
`note` is optional and protected metadata. Revision commands also accept `effectiveAt`
(timezone-bearing ISO string, explicit null for undated evidence, or omitted for now),
`supersedesId` and `active` (default true). Recorded time, actor and change ID are server-owned.

| Command | Domain fields |
|---|---|
| createIngredient | name; optional description, category, tags |
| updateIngredient | ingredientId, name, active; optional description, category, tags |
| createSupplier | name; optional contact |
| createPurchaseOption | ingredientId, label, contentQuantity, contentUnit; optional supplierId, sku |
| createRecipe | name, outputIngredientId |
| createMenuItem | name; optional active |
| updateMenuItem | menuItemId, name, active |
| selectBasis | ingredientId, kind; purchaseOptionId for purchase or recipeId for recipe |
| setYield | ingredientId, sourceIngredientId; nullable sourceQuantity/sourceUnit/outputQuantity/outputUnit |
| addMeasurement | ingredientId, fromQuantity/fromUnit, toQuantity/toUnit; measurementKey for subsequent revisions |
| reviseRecipe | recipeId, nullable outputQuantity/outputUnit, lines[], optional steps[] |
| addPrice | purchaseOptionId, amount, currency |
| setLabor | ingredientId, kind fixed/time; componentKey for revisions; nullable outputQuantity/outputUnit; fixed amount/currency or time minutes/department |
| setLaborRate | department FOH/BOH, amount (per hour), currency |
| setSellingPrice | menuItemId, amount, currency |
| setMenuMapping | menuItemId, recipeId, quantity, unit |

`lines[] = {ingredientId, quantity: decimal|null, unit: unit|null}`. Each gets a stable line
ID within that revision. `steps[]` is an ordered array of instruction strings. Prior lines
and steps remain immutable; new revisions receive new line and step IDs.

Measurement quantities and complete yield/package quantities must be positive. Recipe
quantity and prices may explicitly be zero. Optional unknown numeric facts are null.
`measurementKey` and `componentKey` identify one revision stream and cannot change owner.

## Reads

| Method | Access and result |
|---|---|
| ingredient(actor, ingredientId) | All roles; allowlisted descriptive ingredient or null |
| recipe(actor, recipeId, context?) | All roles; metadata, selected revision quantities and steps or null |
| menu(actor, menuItemId, context?) | All roles; identity, active flag, selected sellingPrice, selected recipe mapping. Admin/Manager additionally receive internalCost when mapped |
| convert(actor, request) | All roles; typed conversion result |
| cost(actor, request) | Admin/Manager; typed cost result |
| history(actor, collection, subjectId) | Admin/Manager; original protected revision records, including undated/superseded evidence |
| audit(actor, entityId) | Admin/Manager; protected before/after change events for that exact record ID |

`context = {at?, knownAt?, currency?}` defaults to server now/now/USD. `at` selects business
effective time; `knownAt` selects recorded knowledge. Dates must carry a time zone.
An older knownAt can intentionally hide a later recorded retroactive change.

`history` collections and subject IDs: bases/yields → ingredientId;
measurements → measurementKey; recipeRevisions → recipeId; prices → purchaseOptionId;
labor → componentKey; laborRates → department; sellingPrices/menuMappings → menuItemId.

### Conversion

Request: `{ingredientId, quantity, fromUnit, toUnit, ...context}`.

Units: g, kg, oz_wt, lb; mL, L, fl_oz_us, tsp_us, tbsp_us, cup_us, pint_us, quart_us,
gallon_us; each. Operational names: dash_fluid, dash_mass, drop, pump, scoop, packet,
piece, barspoon, splash. Additional ingredient-scoped operational labels use `op:name`.
Operational labels confer no conversion factor on their own.

Results:
- `{status:'resolved', amount:decimal, measurementIds:UUID[]}`
- `{status:'unresolved_missing_measurement', ingredientId, fromUnit, toUnit, requiredBridge:{from,to}}`
- `{status:'conflicting_measurement', ingredientId, fromUnit, toUnit, measurementIds:UUID[]}`
- `{status:'invalid_request', message}`

### Cost

Request: `{ingredientId, quantity, unit, ...context}`. Example response:

```json
{
  "status": "unresolved",
  "completeCost": null,
  "knownSubtotal": "3.870000000000",
  "materialSubtotal": "3.870000000000",
  "laborSubtotal": "0.000000000000",
  "resolvedComponents": 7,
  "totalComponents": 8,
  "blockers": [{"reason": "missing_yield", "ingredientId": "<dash-id>", "path": ["<cocktail-id>", "<dash-id>"], "sourceIngredientId": "<pineapple-id>", "linePath": ["<line-id>"]}],
  "references": ["<fact-ids>"],
  "at": "2026-09-18T12:00:00.000Z",
  "knownAt": "2026-09-18T12:00:00.000Z",
  "currency": "USD"
}
```

A resolved zero has `status:'resolved'` and `completeCost:'0.000000000000'`.
Blockers include missing_cost_basis, missing_purchase_option, missing_price, missing_yield,
missing_recipe_revision, missing_recipe_inputs, missing_recipe_quantity,
unresolved_missing_measurement, conflicting_measurement, incomplete_labor,
missing_labor_rate, missing_labor, currency_mismatch and cycle. Conversion blockers include
the attempted units and missing physical dimensions. Cycle blockers include cyclePath.
Dependency paths are stable IDs so the future UI can resolve localized names independently.

## Validation corrections

`setArchived` accepts `{collection, entityId, archived, provenance, note?}`. Collection is
one of ingredients, suppliers, purchaseOptions, recipes, menuItems. Admin/Manager may
archive or restore them. New writes reject archived direct references. Existing historical
relationships remain resolvable. Suppliers, purchase options and recipes now carry active
flags; purchase contents and recipe output identity remain immutable. Archive state is
current metadata with audit, not a dated lifecycle revision.

An inactive yield/recipe revision does not automatically change the selected basis.
Purchase costing enumerates both missing-price and missing-conversion blockers when both
apply. Dash observations anchor fluid dashes to volume and mass dashes to mass.

Timestamps require valid calendar values and at most three fractional-second digits.
Effective and known-at comparisons are inclusive. Same-effective-time revisions require
explicit matching-scope supersession; database triggers also enforce this rule.
Measurement ratios are exact with zero tolerance. Serialization rounds to 12 decimal
places, half away from zero, without changing internal exact arithmetic.

Purchase contents remain required. Unknown package size cannot yet be stored as a typed
purchase option; see VALIDATION-REPORT.md for the verified Egg Roll Wraps migration gap.

## Physical inventory

The additive `service.inventory` API is documented in
[INVENTORY-CONTRACTS.md](INVENTORY-CONTRACTS.md). Staff/Lead may count and submit their own
inventory sheets through dedicated capabilities; existing cost, audit and domain-write
restrictions remain unchanged. Inventory never changes purchase package-size requirements.
