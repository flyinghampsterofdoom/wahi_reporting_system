# Item-centric catalog correction — owner review

Local URL: http://127.0.0.1:4317/#catalog

The existing synthetic review environment was updated in place. Production/Render, the workbook, the legacy application, and the validated domain/inventory implementation were not changed. The owner's existing `Item Test 1` remains intact. No migration or new operational feature was added.

## Changes

- Catalog now opens to searchable item cards, with active/all/inactive filtering, workflow classification, category and inventory configuration status. Search matches name, description and category without navigating away.
- Add Item asks Purchased or Prepared first. Purchased forms collect identity, category, state, package contents, supplier, currency and price. Prepared forms collect identity, component rows, yield and preparation steps. Optional explicit physical measurements and fixed/time labor use existing contracts.
- Save Item is atomic: the review adapter runs the existing validated commands against a transaction-local state, then commits their combined result through the existing repository transaction. Invalid prices, conversions, references, cycles or recipes roll back the entire operation and its audits.
- Item pages assemble purchasing, explicit conversions, source yields, recipe/components/yield, current material/labor/total costs, supported common derived costs, linked menu selling prices, inventory count units and location assignments. No conversion is inferred from a package label.
- Edit Item preserves the universal ingredient identity. Price and recipe changes append effective-dated records; package changes create a replacement package and basis revision. Identity changes retain before/after audits. Existing physical measurement and labor streams remain editable through item-scoped Advanced settings.
- Calculator, history/audit, effective-date controls and less common settings are progressively disclosed. Existing source-yield, labor, menu, supplier and rate controls remain available. Admin-only rate permissions remain enforced.
- Item-page inventory controls configure an unset count aggregation unit and create/update existing location assignments using the existing inventory service, including expected assignment versions.
- Amounts display at two decimal places (four for common per-unit costs), using string/BigInt rounding. Exact backend arithmetic and returned cost values are unchanged.

## Files

Modified: `backend/review/server.js`, `backend/review/public/app.js`, `backend/review/public/style.css`, `backend/test/review-http.test.js`.

Added: `backend/review/items.js`, `backend/test/review-items.test.js`, this report and `backend/review/ITEM-TEST-RESULTS.txt`.

No schema, migrations, domain service contracts, domain arithmetic, history rules, authorization capabilities, repository implementation or inventory contracts changed. Two review-only HTTP adapter endpoints were added: authenticated `GET /api/item?id=…` and authorized, CSRF-protected `POST /api/item/save`. The existing catalog projection adds a safe workflow label. Staff/Lead receive an allowlisted operational item projection with no purchasing costs, costing results, labor allocations or cost-bearing history.

## Validation

Complete automated suite: **152 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. All original 141 tests remain. Full output: `ITEM-TEST-RESULTS.txt`.

Eleven added automated tests cover purchased creation, exact cost and measurement attachment, location attachment, prepared/nested recursive costing and labor, price/recipe revision preservation, unresolved packages, whole-form rollback, Staff/Lead restrictions, inactive restoration, new HTTP endpoint authorization and principal rejection, backdated pricing, and cycle/inactive-component rejection.

Executed browser smoke checks against the running private PostgreSQL review environment:

- Search `lime` returns only Demo Lime; searching the synthetic Bacardi returns its own card.
- Purchased creation produces its detail page showing 750 mL bottle, USD 14.50 and derived US fluid ounce cost.
- Prepared creation uses that purchased item at 100 mL, outputs 100 mL and calculates USD 1.933333333333 before display rounding.
- Editing prepared yield to 200 mL and marking it inactive saves successfully; inactive catalog filtering returns it; component quantity remains 100 mL and per-unit cost adjusts.
- Adding an explicit 1 bottle = 750 mL measurement displays it on the correct item.
- Configuring a bottle inventory unit and assigning Demo Bar works from the item page.
- Tablet editor visually inspected at 768 × 1024; document/main width 753 px (scrollbar accounted for), no page horizontal overflow; touch controls remain usable. Temporary viewport reset at handoff.

Browser smoke data is retained, clearly labeled `Demo UI Bacardi — synthetic smoke` and `Demo UI Batch — synthetic smoke` (the batch is inactive). These checks are executed acceptance checks, not an unattended browser test suite.

## Existing limitations retained

- Purchasing requires positive known package contents. An incomplete item can be saved without a package/price; a package label is not persisted until package contents are valid. The form explicitly says this. Egg Roll Wraps' unknown size and $0 evidence were not imported or reinterpreted.
- There is no separate persisted Purchased/Prepared type. Labels derive from existing recipe/cost-basis records. Legacy source-yield and labor-only records retain accurate labels and their Advanced controls rather than being forcibly converted.
- Existing package records are immutable through the supported command set. Editing package facts creates a new option and effective basis; previous packages/evidence remain accessible. Current price cannot be erased by clearing the field; blank means no new price fact.
- Existing measurement/labor components are revised in Advanced settings. The simple editor's optional measurement/labor sections add components; they do not silently replace previously recorded streams.
- Costing currently requests USD. Other currencies retain their existing unresolved currency behavior; no exchange rates are fabricated. Unsupported common unit costs are omitted; the principal current cost always shows blockers when unresolved.
- Inventory aggregation units remain immutable after configuration. Inactive ingredients cannot be newly selected as recipe components; an existing inactive reference remains visible and must be resolved before a new recipe revision can be saved.
- Browser review remains local to this Mac. No Render deployment or remote tablet access was configured.

Development stops here for owner review.
