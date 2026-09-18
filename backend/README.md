# Wahi Phase 1 backend

An isolated PostgreSQL-oriented domain/service foundation. This directory does not load
the legacy server, legacy database adapter, Toast, or any workbook. No production UI
or HTTP listener is included. Existing root commands continue to belong to the legacy
application; do not use them to start this backend.

## Install and verify

```sh
npm --prefix backend ci --ignore-scripts
npm --prefix backend test
```

Tests use synthetic records only. The PostgreSQL integration suite creates its own
temporary cluster with a private Unix socket and no TCP listener, applies migrations
there, then stops/removes that cluster. It never connects to an existing server.
The default binary directory is `/opt/homebrew/opt/postgresql@16/bin`; set
`WAHI_TEST_PG_BIN` to an equivalent installed PostgreSQL binary directory elsewhere.
Node 22+ is required. The integration tests fail rather than silently skip when
PostgreSQL is unavailable. Do not run `initdb` tests as root.

## Explicit database setup

Create a dedicated local development database separately. Set `WAHI_DATABASE_URL`
to that database, then deliberately run:

```sh
npm --prefix backend run migrate -- --apply
npm --prefix backend run check
```

The CLI refuses remote hosts for Phase 1. It does not consult `DATABASE_URL`, `DB_PATH`,
or the legacy configuration. Migrations create only the `wahi_v2` schema. Nevertheless,
use a dedicated database: localhost alone is not proof that a database is disposable.
Never run this against a production tunnel or the legacy database.

`001_domain.sql` is a checked-in versioned migration. The runner applies pending files
inside a transaction, records checksums and rejects changed/unknown applied files.
Do not edit an already deployed migration; add a subsequent migration. No down command
is provided because destructive rollback is not appropriate for retained history.

`openBackend()` validates migration metadata with SELECT only and returns a service
plus `close()`. It never creates tables, seeds data, resets users or corrects prices.

```js
const { openBackend } = require('./backend');
const { service, close } = await openBackend();
// service calls here, supplied an authenticated server-side principal
await close();
```

## Architecture

- `domain/exact.js`: BigInt rational arithmetic. Inputs are decimal strings. PostgreSQL
  stores exact NUMERIC values. Intermediate conversions and nested costs do not round.
  Response amounts are decimal strings rounded half away from zero to 12 places.
- `domain/measurements.js`: standard mass/US-volume/count conversions plus per-ingredient
  observations and operational measures. The resolver finds paths, retains evidence IDs,
  and rejects inconsistent reachable paths. Observations are treated as exact declared
  ratios; there is no tolerance averaging or automatic precedence between conflicting facts.
- `domain/history.js`: effective-time selection with an optional recorded-time cutoff.
- `domain/costing.js`: purchase/source/recipe traversal, separate labor, partial results,
  and temporal mixed-graph cycle validation.
- `service.js`: validated application commands, references, authorization, audit creation
  and safe operational projections. All important mutations and audit insertions share
  one repository transaction.
- `repository/postgres.js`: normalized persistence, repeatable-read snapshots and a
  transaction advisory lock serializing domain writers before graph validation.
- `repository/memory.js`: isolated transactional test adapter, not production persistence.

The service API is the Phase 1 backend contract. A future HTTP/session adapter must
authenticate callers and derive principals from trusted server-side identity data.
Never pass a role supplied by an HTTP request body/header directly into this service.
No new login, user directory or session implementation is included. `users.manage`
is reserved to Admin; legacy authentication is deliberately not reused.

## Data and temporal rules

Stable identities: ingredients, suppliers, purchase options, recipes, menu items.
Recipe lines and steps belong to immutable recipe revisions. Purchase options are
immutable package definitions; a package change creates another option and a dated
basis selection. Recipe output identity is also immutable.

Append-oriented revisions cover cost bases, yields, measurements, recipes, purchase
prices, labor components/rates, menu selling prices and menu-to-recipe mappings.
PostgreSQL triggers prohibit update/delete of these histories and audit events.
Descriptive ingredient/menu edits and archival update their identity record and produce
before/after audit events. Historical numeric evaluation uses revisions, not current
descriptions. Archived identities remain referencable for history.

Effective timestamps default to the injected server clock; recorded timestamps always
come from that clock. Admin/Manager may explicitly backdate with provenance. Explicit
`effectiveAt: null` retains undated evidence but excludes it from resolved timelines.
This is essential for later migration: August 4, 2026 is a workbook snapshot date,
not a fabricated effective date. Unknown-period evidence needs an approved activation
policy before it can produce a current cost.

At a requested effective time, the latest applicable fact is used. No price is projected
back before its first effective record. `knownAt` limits which recorded facts were known.
Same-effective-time corrections require `supersedesId`, retaining the original. The
referenced record must be in the same scope and effective time and not already superseded.
Changed effective dates are represented by explicit withdrawal (`active:false`) and
new revisions, rather than silently moving historical records. Historical evaluations
use the present engine version; persisted report snapshots/engine-version replay belong
to the later reporting phase.

Cycle validation checks all effective boundaries, including future changes. Undated
conceptual dependency links are also conservatively checked before later activation.

## Cost rules

One effective cost basis per ingredient: `purchase`, `source`, `recipe`, or `labor_only`.
The last is an explicit foundation for legacy frond labor without inventing a purchased
material, production duration or department. No competing buy/make method is selected
implicitly. No cheapest-supplier or inventory-average policy is implemented.

Source/yield quantities may be incomplete. Creating a source relation selects the source
basis; creating a recipe revision selects its recipe as its output ingredient's basis.
Changing a nonmatching existing basis is audited. Same-effective conflicts require an
explicit correction rather than arbitrary overwrite.

Labor components are allocated over an explicit output quantity/unit. Fixed labor uses
an explicit amount/currency; time labor uses minutes and the applicable FOH/BOH hourly
rate. No component means no labor charge. An incomplete configured component creates
a blocker. Nested material/labor subtotals remain separate. No currency conversion is
assumed: mismatched currencies yield an unresolved result.

Complete cost is null when any required dependency is unresolved. Known subtotal includes
only quantities that can be validly costed and scaled. If output scaling itself is missing,
the unscalable batch subtotal is not presented as a known cost of the requested quantity.
Component counts refer to direct material/source lines plus local configured labor
components; unresolved nested components carry their own ingredient and line paths.

Explicit zero prices are resolved. Missing prices are null/blockers. No spreadsheet
fallback, missing-yield-one assumption, guessed conversion, borrowed density, omitted
unknown input or zero-cycle fallback exists.

## Authorization

Admin/Manager: internal cost read/write and domain mutation. Admin alone: labor rate
settings and the reserved users.manage capability. Lead/Staff: authenticated operational reads and their own inventory count entry/submission.
Other domain writes remain denied. Inventory configuration/history/correction capabilities
are reserved to Admin/Manager; see INVENTORY-CONTRACTS.md.

Operational ingredient/recipe/menu serializers are allowlists. They omit cost metadata,
provenance, prices, rates and audits. Customer menu selling price is explicitly allowed.
Internal-cost history and audit APIs require internal_cost.read, even for a mixed event.
Recipe steps/descriptions are operational prose, not a place to import legacy cost-bearing
notes. A future import must split restricted legacy notes into protected provenance.

## Migration decisions retained for the next phase

- Authoritative file: Wahi Price Book V2.080426.xlsx; no runtime access or import here.
- Workbook `oz` maps to `fl_oz_us`, never `oz_wt`. There is no ambiguous `oz` unit.
- Pineapple, Dash retains its source and missing yield. Fresh ginger is not remapped.
- Drop factors become separately attributed observations for each affected ingredient.
- Water can be explicitly priced at zero but is never added to recipes automatically.
- Fronds retain fixed labor evidence `$25 / 180 each`; time/department remain unknown.
- Updated Pricing is implemented selling price; previous ActualPrice is historical evidence.
- Fish and Chips, Four is archived; Two and Three have independent identities. No inferred
  predecessor or price lineage. Competitor prices are not Wahi prices.
- Excel cached line costs may be reconciliation evidence only. After migration acceptance,
  runtime truth resides entirely in PostgreSQL.

## Deliberate Phase 1 limits

No workbook migration, Toast, UI, production deployment, production authentication adapter,
FX engine or report snapshot store. No changes to root application or legacy data.
The current PostgreSQL adapter loads a consistent complete domain snapshot per operation
and serializes writes. This favors correctness and reviewability for the initial catalog;
targeted loading/caching and finer locking can follow measured scale requirements without
changing domain contracts. Direct SQL writers must not bypass the application transaction
protocol. Use dedicated application credentials and controlled migration credentials when
a deployment phase is approved.

## Adversarial validation

See [VALIDATION-REPORT.md](VALIDATION-REPORT.md) for the September 18 validation, exact
repair inventory, 89 passing tests and remaining migration blockers. The additive
`002_validation_guards.sql` migration adds finite numeric constraints, revision-stream
collision/supersession guards and identity archival support. Existing history stays intact.

`setArchived` archives/restores ingredients, suppliers, purchase options, recipes and menu
items with audit. New direct archived selections fail; historical costs still resolve.
Inactive yield/recipe revisions do not automatically change the selected cost basis.
Timestamp inputs now reject invalid calendar dates and precision beyond milliseconds.

Do not treat validation success as lossless-migration readiness: Egg Roll Wraps has an
unknown package size, which the approved required-contents purchasing contract cannot
represent as a typed purchase fact. No package size or new business rule was invented.

## Physical inventory foundation

`service.inventory` provides configurable locations, per-item/location count-sheet ordering,
draft/submitted physical counts, audited corrections and derived cross-location summaries.
It uses existing Ingredient identities and exact conversion arithmetic. Observations retain
their physical time and frozen conversion evidence. Missing counts/conversions stay explicit.

The additive `003_inventory_foundation.sql` migration is explicit and isolated. No physical
count totals are stored as independent authoritative quantities, and no inventory-position
ledger is implemented. See [INVENTORY-CONTRACTS.md](INVENTORY-CONTRACTS.md) for API usage and
[INVENTORY-REPORT.md](INVENTORY-REPORT.md) for the 130-test result and implementation details.
