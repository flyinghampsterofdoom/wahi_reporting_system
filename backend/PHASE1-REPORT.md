# Phase 1 implementation report

The backend/domain foundation is implemented as an isolated server-side service library.
No workbook data was imported. No HTTP listener, Toast integration, production UI or
deployment was added. The root legacy application is unchanged.

## 1. Exact files added or changed

All paths below are new files relative to this report's `backend/` directory. No existing
tracked repository file was modified. The pre-existing untracked root `.DS_Store` was not
changed by this work. Local `backend/node_modules/` is ignored by the existing gitignore.

| File | Purpose |
|---|---|
| `package.json` | Isolated package, pinned pg/Zod dependencies and test/migration/check commands |
| `package-lock.json` | Reproducible dependency lock |
| `index.js` | Read-only initialization and exported service factory |
| `check.js` | Read-only migration readiness CLI |
| `migrate.js` | Explicit transactional/checksummed migration runner |
| `migrations/001_domain.sql` | Initial normalized PostgreSQL schema, indexes, constraints and history guards |
| `auth.js` | Capabilities and allowlisted operational serializers |
| `service.js` | Validated commands and read contracts, authorization and transactional audit |
| `domain/exact.js` | Exact decimal-input/rational arithmetic |
| `domain/history.js` | Effective-time and recorded-time selection |
| `domain/measurements.js` | Universal and ingredient-specific conversion graph |
| `domain/costing.js` | Recursive costing, labor, partial results and cycle validation |
| `domain/state.js` | Explicit domain collections |
| `repository/schema.js` | PostgreSQL field mapping |
| `repository/postgres.js` | Snapshot reads and serialized transactional writes |
| `repository/memory.js` | Transactional unit-test adapter |
| `test/helpers.js` | Synthetic fixtures and deterministic clocks |
| `test/domain.test.js` | 29 domain/service acceptance tests |
| `test/postgres.test.js` | 7 actual PostgreSQL integration/configuration tests |
| `README.md` | Setup, architecture, assumptions, boundaries and retained migration decisions |
| `CONTRACTS.md` | Exact command/read/response contracts |
| `PHASE1-REPORT.md` | This completion report |

## 2. Migration/schema

Version `001_domain.sql` creates 17 domain tables inside `wahi_v2`:

- ingredients, suppliers, purchase_options, recipes, menu_items
- bases, yields, measurements, recipe_revisions, recipe_lines, recipe_steps
- prices, labor, labor_rates, selling_prices, menu_mappings, audit

The runner separately creates the schema_migrations checksum ledger. Foreign keys protect
ingredient, supplier, purchase, recipe and menu references. Checks cover positive yields,
package quantities, measurement quantities and nonnegative money/time. Revision lookup and
dependency indexes support effective/recorded time and recipe references. Database triggers
reject mutation/deletion of revision history, recipe revision children, immutable purchase
options/recipe identities and audit events. Application commands enforce scoped revision
corrections, semantic ownership and graph consistency under a write lock.

Migrations ran only in disposable test PostgreSQL clusters. The new runtime startup path
only checks readiness. It performs no DDL, backfill, price correction or user reset.

## 3–4. Modules and service/API contracts

The service exposes ingredient, supplier, purchase option, recipe, source-yield,
measurement, pricing, labor and menu commands; read operations provide ingredient/recipe
views, conversion, cost, historical facts, audit and menu selling-price/mapping views.
See CONTRACTS.md for each method, field, authorization rule and result shape.

This is a backend service API, not a public HTTP API. Principal authentication must be
provided by a future trusted transport/session adapter. No caller-supplied HTTP role is
accepted because no HTTP boundary is exposed. This phase implements role/capability
enforcement; it does not implement a new user directory, login or session lifecycle.

## 5. Units and measurements

All required mass, US customary volume and count units are supported. Weight ounces and
US fluid ounces have distinct identifiers. Ambiguous `oz` is rejected. Operational labels
(fluid/mass dash, drop, pump, scoop, packet, piece, barspoon, splash and extensible op:name)
have no global factors. Ingredient observations connect them and connect physical
dimensions. Paths retain evidence IDs; missing/conflicting/invalid requests are explicit.
Measurements never transfer to another ingredient or a processed output automatically.

## 6. Ingredients and source yields

Universal stable ingredient identities support descriptive metadata, category/tags,
archival, timestamps and audited edits. Source relations can save without numeric yields.
Independent pineapple outputs carry independent theoretical cost relationships; there is
no co-product allocation. Incomplete yields return missing_yield and propagate downstream.

## 7. Purchasing and history

Multiple immutable package/supplier options may belong to one ingredient. Supplier may be
unspecified. Effective cost-basis selection chooses the option explicitly. Prices append
exact NUMERIC amounts with currency, actor, effective/recorded timestamps, provenance,
note and optional supersession. Backdated evidence and as-known-at queries are supported.
Undated evidence remains queryable but is not guessed into a cost timeline.

## 8. Recipes

Recipes link to output ingredients. Immutable revisions own explicit output yield,
ingredient lines and ordered steps. Nested prepared ingredients traverse the same domain
engine. Missing quantities/yields are unresolved. No water or other input is invented.

## 9. Labor

Fixed allocated labor and minute-based FOH/BOH labor are separate from material costs.
Rates and allocations are effective-dated. Only Admin can manage central rates. No
component adds no charge; an incomplete configured component blocks complete cost. The
labor_only basis accommodates frond labor without fake purchasing or inferred time.
Nested costs preserve material/labor subtotals.

## 10–11. Resolver and partial costs

The engine traverses selected purchase/source/recipe dependencies, conversions and labor
using requested effective and recorded context. Exact rational intermediate arithmetic
prevents floating-point and repeated-rounding drift. API serialization rounds to 12 decimal
places; it does not feed those rounded amounts into parent calculations.

Resolved zero is distinct from null. Partial results include completeCost:null,
knownSubtotal, materialSubtotal, laborSubtotal, direct resolved/total component counts,
fact references and actionable dependency/line paths. No spreadsheet-cost, quantity,
yield-one, cycle-zero or guessed-density fallback is implemented.

Cycles are rejected during writes at all effective boundaries, including future and
undated conceptual relationships. Writes serialize before reading/checking the graph.
Evaluation independently detects cycles and returns the cycle path.

## 12. Audit and provenance

Important writes append grouped before/after audit events inside the same transaction.
Actor and recording time are server-owned. Provenance supports the approved source kinds.
PostgreSQL integration tests deliberately fail audit insertion and prove the associated
price insertion is rolled back. Corrections preserve original records and events.

## 13. Authorization

Admin/Manager receive internal_cost.read/write and domain.write. Admin alone receives
labor_rates.manage and reserved users.manage. Lead/Staff have operational reads only.
Allowlisted public views omit nested internal costs and protected metadata. Menu selling
price remains available to Lead/Staff. Cost/history/audit reads are separately gated.

## 14. Tests and exact results

Command: `npm --prefix backend test`

Final executable-code verification: **36 tests, 36 passed, 0 failed, 0 skipped, 0 cancelled,
0 todo**. Reported duration: **971.141542 ms** on this workstation. Documentation-only
files were added after that passing run.

Coverage includes all required standard and cross-dimension conversions; ingredient-local
fluid/mass dashes; count bridges; exact pineapple cost; incomplete yield persistence and
downstream resolution; missing physical bridges; zero-water distinction; explicit purchase
selection; multi-generation costs; fixed/time/incomplete labor and historical labor rates;
historical prices, yields, recipes, measurements and purchasing selections; retroactive
recording/as-known history; corrections; unknown dates; partial counts/subtotals; direct,
indirect, mixed, future and undated cycles; evaluation defense; atomic audit; role-specific
serialization and selling prices; archived independent menu identities; and database
migration/idempotence, rollback, history guards, reload and concurrent-writer behavior.

No authoritative workbook values were read by or fed into this test suite. Fixtures use
deliberately synthetic acceptance examples.

## 15. Assumptions

- CommonJS JavaScript matches this repository; Zod validates runtime contracts and results
  use explicit status discriminants. TypeScript was not required for this phase.
- Quantity/money inputs are decimal strings. Returned decimal amounts have 12 places.
- USD is the default requested currency, overridable explicitly; FX is not inferred.
- Admin/Manager can intentionally backdate with required provenance. Other domain writes
  are restricted to those roles until a broader permission matrix is approved.
- Recipe lines plus local labor components define direct component counts.
- Conflicting observation ratios are flagged exactly; measurement tolerance policy is not
  invented. Original observations and their evidence remain intact.
- One recipe identity owns each prepared output ingredient. Alternative sourcing/costing
  uses an explicit basis selection rather than implicit selection heuristics.

## 16–17. Remaining decisions and deviations

No material conflict with the approved backend domain requirements was found. No Toast,
workbook migration or UI work was substituted for backend work.

Before exposing this service over a network, the transport/authentication/session design
and deployment credential separation must be selected and reviewed. This phase provides
capabilities and trusted-principal service contracts, not login/user administration flows.
Report snapshots/engine-version replay, external Toast mappings, migration reconciliation
and production-scale loading/caching remain subsequent work. The PostgreSQL adapter uses
whole-domain snapshots and a coarse write lock deliberately; this is a correctness-first
foundation rather than an unmeasured scaling claim.

The explicit labor_only basis is the implementation representation for approved fixed
frond-labor evidence. It creates no inference about source material, duration or department.

## 18–20. Boundaries confirmed

- No production deployment, push or Render change occurred.
- No legacy data was destroyed, modified or migrated; legacy application files are unchanged.
- No authoritative workbook was modified or imported.
- Excel is not a runtime dependency of this backend. Its dependency tree contains pg and
  Zod, and normal domain operations use PostgreSQL only.
- No Toast integration, reporting UI or production UI was built.
- No further phase has been started.
