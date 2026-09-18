# Phase 1 adversarial validation — September 18, 2026

Validation and authorized backend repairs are complete. **89 tests pass, 0 fail, 0 skip.**
This is not approval to migrate authoritative data. A concrete lossless-migration gap
remains: Egg Roll Wraps has no package size, while the approved purchase contract requires
defined package contents. No business rule was relaxed to accommodate that record.

## Defects and exact repairs

| Defect | Repair |
|---|---|
| Positive PostgreSQL NUMERIC checks admitted NaN and positive infinity | New migration adds finite-value checks to every numeric domain column; existing positive/nonnegative checks remain. |
| Database revision streams could admit identical effective times outside service validation | New insert triggers reject collisions unless explicitly superseding a record in the same scope and effective time. Existing unique supersession constraints prevent two successors. |
| Supplier, purchase-option and recipe archival were absent | Added active flags and audited `setArchived` for all five identity collections. Package facts and recipe identity remain immutable; only lifecycle fields can change. |
| New writes could select archived direct references | Service reference validation rejects archived identities. Existing relationships remain available to historical costing. Explicit archival/restoration and existing ingredient/menu metadata edits may access archived records. |
| Direct operational aliases could equate fluid and mass dash | Dash observations must anchor directly to their declared volume or mass family. Both remain ingredient-specific; crossing physical dimensions still requires that ingredient's bridge. |
| Undated evidence could hide a dated dependency cycle | Validate dated graphs independently, then also validate the graph with undated conceptual links. |
| Invalid calendar dates normalized silently; submillisecond instants truncated | Reject impossible calendar dates and precision beyond milliseconds. Accepted timezone timestamps normalize to UTC. |
| Correction of an inactive fact could audit a null previous value | Audit the actual explicitly superseded row. |
| Withdrawing an unused yield/recipe could alter the purchase basis | Inactive revisions no longer trigger automatic source/recipe basis selection. |
| Missing price hid a missing measurement on the same purchase line | Check price and conversion independently; return both blockers, and add material cost only when both resolve. |

The original `001_domain.sql` was not edited. Repairs use the additive
`002_validation_guards.sql` migration, applied only to disposable test databases.

## Exact files changed in this validation

Modified:

- `backend/service.js`
- `backend/domain/history.js`
- `backend/domain/costing.js`
- `backend/repository/schema.js`
- `backend/repository/postgres.js`
- `backend/test/postgres.test.js`
- `backend/README.md`
- `backend/CONTRACTS.md`

Added:

- `backend/migrations/002_validation_guards.sql`
- `backend/test/adversarial.test.js`
- `backend/VALIDATION-REPORT.md`
- `backend/test-results.txt`

The backend was already untracked at the beginning of this validation; this inventory
compares with the Phase 1 implementation, not a committed backend baseline. The existing
untracked root `.DS_Store` was left alone. Git reports no tracked legacy-file changes.

## Tests and results

Command: `npm --prefix backend test`.

Final result: **89 tests, 89 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**.
Recorded duration: **1442.241084 ms**. Raw output is in `backend/test-results.txt`.
There were previously 36 tests; this pass adds **53**:
**45 adversarial domain/service tests and 8 PostgreSQL tests**.

There are now **15 tests in the PostgreSQL suite**: 14 exercise a real PostgreSQL cluster,
and one checks connection configuration. All pass. The suite uses a temporary PostgreSQL
16 cluster, private Unix socket, no TCP listener, then stops and removes it. It does not
connect to the existing local server. Migrations, idempotence, unchanged legacy sentinel,
exact numeric persistence, immutable history, transactional audits, archival, direct SQL
constraints, supersession and concurrency are exercised.

### Coverage of the requested scenarios

| Area | Evidence |
|---|---|
| Package versus serving | Four new rum tests cover 750 mL, 1 L, 1.75 L and 6 × 750 mL. A 750 mL/$18 bottle costs **$1.06464706425** for 1.5 US fl oz. Contents are explicit; no universal case conversion exists. |
| Physical conversion | Existing reverse volume-to-mass tests plus new pound/cup and tablespoon/cup/gram/pound tests verify missing bridges, exact ratios and inverse paths. |
| Dash/drop | Ingredient isolation, separate dash families, alias rejection and independently attributed 0.00113636 fl oz/drop observations. An unmeasured ingredient stays unresolved. |
| Different-dimension yield | One whole pineapple yields 4.84 cups chopped; a 3 fl oz portion uses ordinary volume conversion after the yield, with no density or coproduct allocation. |
| Pineapple Dash | Existing acceptance tests preserve missing yield and references, retain subtotal, propagate null complete cost and resolve after yield entry. |
| Ginger | New weight-purchase case propagates missing conversion through a source preparation, recipe and menu. Adding Ginger's own measurement resolves it; identity remains unchanged. |
| Water | Explicit zero survives recipe, history and audit. Missing purchase price remains a blocker. No water line is inserted. |
| All blockers and nesting | Three distinct blockers propagate through three recipes with scaled known subtotal and ingredient/line paths. Another test reports missing price and measurement together on one line. |
| Labor | Exact $25/180 allocation, 18-minute time labor, nested derived labor and own recipe labor combine once. Existing missing-rate, incomplete-labor and absent-labor tests remain passing. |
| Effective rates | BOH $20 August and $23 September, then a September 18 entry effective September 12; both business and recorded clocks are retained. |
| Time boundaries/gaps | Six parameterized before/at/after tests cover price, yield, measurement, recipe, labor rate and selling price. Five additional actual-cost tests keep the parent basis available while the required fact begins September 1; August 15 stays unresolved. |
| Retroactivity | September 20 price entry effective September 10 preserves original evidence, before/after amount and as-known selection. |
| Conflicts | Explicit same-time supersession; database collision/scope rejection; 200g versus 240g conflict; exact-equivalent precision agrees and genuinely unequal ratios conflict. |
| Precision | Six nested fractional recipes, repeating allocations, extremely small positive amounts and large monetary values retain exact internal results. |
| Invalid input | Nine malformed/negative/non-finite input cases; zero-denominator and timestamp rejection; direct SQL tests reject invalid purchase/yield/measurement quantities and money. |
| Recipe history | Old revisions, lines and steps remain unchanged; modifying a returned view does not mutate stored history. Historical revisions continue producing their applicable costs. |
| Archive/identity | All five identity types archive without erasing costs/history; new direct archived selections fail. Fish Four, Three and Two have independent IDs and prices, with no inferred lineage. |
| Authorization | Recursive operational-response checks, every command denied for Lead/Staff before payload parsing, protected audit/history/cost reads denied, selling prices visible; Admin/Manager internal reads work. |
| Audit/concurrency | Injected audit failures roll back single and grouped writes. Concurrent price, yield, recipe and basis changes reject identical effective times and retain both distinct-time revisions. Existing concurrent cycle test remains passing. |

## Precision and rounding policy

Both quantities and money enter as decimal strings, at most 100 characters. JavaScript
numbers, exponent notation, malformed decimals and non-finite values are rejected.
PostgreSQL stores input NUMERIC values exactly; internal calculations use reduced BigInt
rational numbers with no fixed decimal scale or intermediate rounding. Fractional labor
and nested conversions therefore retain repeating values exactly.

Cost and conversion response amounts are decimal strings rounded **half away from zero
to 12 decimal places**, only at serialization. Stored price/history inputs retain their
source decimal value. A future display may round currency to cents deliberately, but must
not feed displayed amounts back into costing. Tiny nonzero amounts below half of 10^-12
can display as zero in the current API, although internal multiplication/aggregation
retains them. This is an API limitation for future extremely small unit-price displays,
not an internal zero-cost substitution. Exact-rational API output was not added.

## Effective-date and conflict policy

Facts apply when `effectiveAt <= at` and `recordedAt <= knownAt`; both bounds are inclusive.
The greatest applicable effective timestamp wins. One millisecond before a change selects
the previous fact; exactly at and one millisecond after select the new fact. No earlier
fact means unresolved, with no backward extrapolation. Undated facts remain evidence and
are excluded from numeric evaluation. The filename date never becomes a business date.

The supported service precision is milliseconds, normalized to UTC. Invalid dates and
submillisecond strings are rejected instead of silently changing their meaning. Raw SQL
is an internal persistence interface, not the public timestamp-validation interface.

Within a revision stream, identical effective times require an explicit unsuperseded
`supersedesId` with matching scope/time. Original evidence remains intact. Different
measurement keys may coexist; differing implications produce an explicit conflict.

Measurement tolerance is **zero**: observations are exact declared ratios. `200` and
`200.000000000000` agree, as do 1 cup and 16 tablespoons with equal gram totals. `200` and
`200.000000000001` conflict. No path-order preference, averaging or undocumented epsilon
was introduced. If rounded observations should be treated as equivalent within a
physical tolerance, that is a business-policy decision still to make before migration.

## Authorization, audit and concurrency findings

The service boundary protects internal costs for Admin/Manager. Lead/Staff operational
responses contain no internal price, cost, labor, provenance, audit or cost-blocker payload.
Operational conversion explanations contain physical units and measurement IDs only.
Supplier/purchase-option object read endpoints and a debug endpoint do not exist; attempting
to access them through protected history fails authorization. Audit payloads contain full
sensitive before/after values and are protected accordingly. Unauthorized writes fail
before input validation can echo sensitive payload details.

This is server-side service validation, not production authentication certification.
A trusted adapter must supply principals; callers must never be allowed to supply arbitrary
roles. No HTTP/session adapter exists in Phase 1. Operational free text can contain whatever
an authorized author writes, so later migration must keep cost-bearing notes in protected
provenance rather than recipe instructions or public descriptions.

Domain writes and audits share one transaction and change ID. Forced audit errors roll
back both domain facts and implicit basis records. A PostgreSQL advisory transaction lock
serializes writers before reading the graph. Same-effective concurrent changes produce
one success and one explicit collision, not row-order selection. Distinct-time changes
both survive and preserve prior records. Database triggers add protection for revision
collisions, but direct SQL still does not replace service authorization, cycle checks,
unit validation or automatic audit creation. Deployment credentials and adapter design
remain future work.

## Migration readiness, without importing

The listed catalog sizes are structurally representable: 206 purchased ingredient
identities, 186 recipe identities, 1,013 lines across recipes, 56 source/yield relationships
and 42 ingredient-specific measurements. There is no total-catalog row limit. The service
caps a single recipe revision at 1,000 lines; 1,013 total lines across 186 recipes does not
exceed that bound. This is a schema/contract assessment, not an import or reconciliation
of those records, nor a full-scale performance certification.

| Workbook fact | Representation/readiness |
|---|---|
| Purchased ingredients, vendor/SKU/name/location | Ingredient plus explicit purchase option; nullable supplier; SKU/label and ingredient metadata can retain descriptive facts. |
| Recipes/lines/steps | Ingredient references, explicit nullable quantities/yield and ordered immutable steps. |
| 56 yields and missing yields | Source reference survives null numeric yield; costs remain unresolved. |
| 42 densities | Ingredient-specific observed quantities/units, provenance, dates and revision identity. |
| Ginger Fresh | Existing identity/recipe references and volume quantity retained; missing bridge remains actionable. |
| Food/drink prices | Separate menu identities and selling-price histories. Updated Pricing is the intended implemented value; prior ActualPrice can remain undated reference evidence. Activation date policy remains necessary. |
| Missing vendors | Null supplier is valid; no fictitious vendor needed. |
| Explicit zero | Valid exact price, provided its cost denominator is defined. |
| Drops/dashes | Independent ingredient observations; no shared global factor. |
| Fixed labor | Fixed amount/currency/output allocation without inferred duration or department. |
| Fish Four/Three/Two | Archived Four and independent current Three/Two, without invented mappings or predecessors. |

**Concrete gap:** read-only inspection confirms `Ingredients!A66:J66` contains Egg Roll
Wraps, price 0 in E66, blank size F66, grams in G66 and a cached division error in H66.
The ingredient and references can exist, but a typed PurchaseOption/PurchasePrice pair
cannot preserve that purchase fact while package contents remain unknown. The approved
rule explicitly requires defined package contents. I did not invent a size, reinterpret
the cached error, or make package quantities nullable. A reviewed incomplete-purchase
representation or separate evidence/staging model is needed before a lossless import.

Also, there is no dedicated migration staging/reconciliation store for arbitrary workbook
cells, formulas, cached errors or competitor reference data. Bounded protected provenance
and notes preserve normal fact attribution, not a lossless workbook archive. Those
non-runtime records need a reviewed migration artifact/model if they must enter the new
database. The original workbook remains the source evidence. Unknown effective dates
still need an approved activation policy before imported current costs/prices can resolve.

## Remaining concerns and scope confirmation

- Lossless migration is not yet ready because of the unknown package-size case above.
- Numerical tolerance and activation of undated evidence remain explicit policy choices;
  neither was guessed during validation.
- Whole-state reads and a global writer lock favor correctness over concurrency. No
  production throughput or arbitrary-depth graph performance claim is made.
- Archival is current identity state, audited but not an effective-dated status timeline.
  Historical numeric facts remain resolvable; historical descriptions/status reconstruction
  is not provided by the normal read API.
- Cost evaluation enumerates sibling blockers and simultaneous price/conversion blockers.
  When a parent yield/quantity itself is unknown, deeper unscalable branches may require
  separate inspection after that prerequisite is fixed; no unscalable subtotal is guessed.

No authoritative workbook migration or workbook edit occurred. No Toast work occurred.
No production, UI, Render or deployment work occurred. No legacy application file or data
was modified. No Phase 2 implementation was started. Tests use synthetic records only;
the workbook was opened read-only solely to verify the package-size readiness finding.
