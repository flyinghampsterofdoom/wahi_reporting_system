# Catalog / recipe management UX correction

Review: http://127.0.0.1:4317/#catalog and http://127.0.0.1:4317/#recipes

## UI changes

Items and Recipes now have separate primary navigation. Locations replaces the former navigation label “Locations & items”; its existing inventory configuration functions remain intact. Counting screens retain their task-oriented layout.

Items uses a compact semantic table: item, type, category, purchase package or cost quantity/yield, current cost, inventory location count, and status. Staff/Lead do not receive internal costs or purchase-cost projections. Rows open existing item details, with keyboard-accessible links. Search, active/all/inactive, type, category/uncategorized, sort field and ascending/descending controls work together. No per-record cards remain in the catalog.

Recipes uses a separate compact table with name, category, yield, authorized current batch cost, linked selling prices, and recipe status. It supports search, category/uncategorized, active/all/inactive, and sorting. Category selectors follow configured display order. Overflow is contained within focusable table regions; controls wrap at tablet widths.

Recipe detail assembles formula rows, linked component items, yield, instructions, material/labor/total cost and blockers, selling prices, and cost percentages. Percentages use the actual mapped menu portion, not an arbitrary batch cost, and exact rational arithmetic. Missing prices, zero prices, currency mismatches or unresolved costs produce no fabricated percentage. History is collapsed. Edit Recipe uses the existing append-only revision contract. Formula editing returns to the recipe page. Recipe archival uses its existing lifecycle command and is separate from output-item archival.

Add Recipe can use an existing output item without a recipe, or invoke the existing atomic prepared-item/formula creation workflow to create both. The new-output workflow also assigns the selected recipe category in the same atomic save. Output-item category and recipe category are explicitly labeled separately. No new operational recipe-display features were built.

## Backend assessment and conservative extension

Before changes, recipes already had independent IDs, immutable output-item links, versioned formulas and direct recipe reads. Ingredient category was only a free-text field; recipes had no stable category identity, category lifecycle or ordering mechanism. Reusing that text field would not satisfy the requested guarantees.

Migration `004_recipe_categories.sql` therefore adds:

- `recipe_categories`: stable UUID, name, sort order, active state and creation/update timestamps. Changes are transactionally audited; deletion and identity changes are blocked.
- `recipe_category_assignments`: recipe/category references using existing effective-dated revision metadata. Assignments are append-only, with the same revision-stream/supersession protections as other domain facts. Null category means explicitly uncategorized. Foreign keys restrict deletion.

Three domain commands were added: `createRecipeCategory`, `updateRecipeCategory`, and `setRecipeCategory`. They require `domain.write` (Manager/Admin). Assignment backdating uses existing capability checks. New assignments to inactive categories are rejected. Archiving a category retains existing assignments, recipe records and audit evidence. Renames retain prior names in before/after audits, available through the category History control. No preset category taxonomy is seeded.

No changes to recipe identity/output links, recipe formula contracts, costing arithmetic, purchasing, inventory observations, correction history, or existing migrations were needed. Repository mappings include the two new collections. Only category descriptive metadata is permitted to update in place; assignment history is immutable in memory-service usage and PostgreSQL.

`GET /api/management` is an authenticated, role-aware read projection supplying both tables and recipe details. Cost computation and percentage calculation remain server-side. Staff/Lead receive operational recipes and selling prices but no internal cost, purchase-cost, or percentage fields. Existing CSRF, Host, Origin and server-side command authorization remain in force.

The explicit local review `runtime.js migrate` action validates the isolated review marker and targets its existing private Unix-socket PostgreSQL database. Only migration 004 was applied to that database. Startup still checks schema rather than silently applying migrations. Nothing was deployed or migrated on Render/production.

## Recipe/output relationship and navigation policy

Every recipe retains its original `outputIngredientId`. Prepared outputs remain selectable in other recipes, preserving recursive costing and cycle protection. Recipe pages link directly to output items and each component.

The Items default table excludes an output linked to an active menu when it is neither configured for inventory nor used as an input in a current recipe/source yield. Such finished outputs remain in Recipes and remain addressable by their output-item link. Outputs used as inputs or inventory items remain in Items too. This rule uses real relationships, not demo names or invented categories.

There is no existing explicit “finished dish versus prep component” metadata flag. An unlinked recipe output cannot be reliably classified as a finished menu dish, so it remains in Items as a prepared output. No classification field or taxonomy was invented. Existing recipe and output-item active states are independent; the Recipes table displays recipe state, while Items displays item state.

## Files changed

- `backend/domain/state.js`
- `backend/service.js`
- `backend/repository/schema.js`
- `backend/repository/postgres.js`
- `backend/migrations/004_recipe_categories.sql` (new)
- `backend/review/management.js` (new)
- `backend/review/items.js`
- `backend/review/server.js`
- `backend/review/runtime.js`
- `backend/review/public/index.html`
- `backend/review/public/app.js`
- `backend/review/public/style.css`
- `backend/review/public/management-ui.js` (new)
- `backend/review/public/table-model.js` (new)
- `backend/test/management.test.js` (new)
- `backend/test/postgres.test.js`
- `backend/test/review-http.test.js`
- This report and `backend/review/MANAGEMENT-TEST-RESULTS.txt`.

The existing PostgreSQL migration assertion was extended to expect migration 004; no existing tests were removed or skipped.

## Validation

Complete suite: **163 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. Original 152 tests remain passing. Complete output is in `MANAGEMENT-TEST-RESULTS.txt`.

Eleven added tests cover atomic recipe/category creation, configurable category lifecycle and audits, immutable PostgreSQL category assignment history and restricted deletion, recipe/output projection, nested prep costing, exact menu-portion percentages, invalid/zero/currency cases, Manager authorization, Staff/Lead restrictions, item search/filter/sorting, recipe search/category filters, uncategorized filtering, and semantic compact-table rendering. Existing HTTP tests now also check the new projection under Admin/Staff/Lead sessions.

Executed browser checks (read-only against existing review data): separate Items/Recipes navigation; compact item table; item search for Lime; independent recipe table; recipe search and descending sorting; empty configurable category controls; Demo Cocktail formula, yield, linked output, existing USD 16 selling price and unresolved garnish-yield blocker. At 768 × 1024, recipe table and wrapped controls fit without page overflow (viewport/page 768px, table 718px). No new fake business records or category seeds were created. Browser checks complement the automated tests; they are not an unattended browser suite.

## Retained limitations

- Categories begin empty; Manager/Admin create their own taxonomy. Category lifecycle was exercised in isolated automated-test databases, not by adding fake categories to the review environment.
- Category historical names are in audit history; ordinary lists display their current names, including an inactive indicator.
- Table sorting covers name, category, status, and item type. Client-side filtering is intended for hundreds of records; no server pagination or large-scale indexing redesign was added.
- Recipe names/output links remain immutable under existing recipe identity contracts. Edit Recipe changes formula/yield/steps through revisions; recipe status and category are managed separately. Creating a recipe identity against an existing output can leave it incomplete until its first formula revision is saved, as permitted by the existing backend.
- Existing purchasing unknown-size validation, USD costing/currency blockers, inventory unit immutability, and Egg Roll Wraps' unresolved package size remain unchanged.
- Local review only. No workbook migration, new production taxonomy, Render deployment, operational recipe screens or other fenced features.

Development stops for owner review.
