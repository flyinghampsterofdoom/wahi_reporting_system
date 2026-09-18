# Inventory Foundation implementation report

Implemented locally within `backend/`. **130/130 tests pass**, with no failures or skips.
The original 89 tests remain passing. Added **41 inventory tests**: 33 service/domain tests
and 8 real PostgreSQL integration tests. The PostgreSQL test file now contains 23 tests:
22 exercise the temporary real database, plus one connection-configuration test.

The final complete-suite command was `npm --prefix backend test`; recorded duration was
**1929.955709 ms**. Full output is retained in `backend/inventory-test-results.txt`.

## Architecture

Inventory references existing universal Ingredient identities. Locations are configurable,
ordered, active/inactive and optionally associated with a named operational area. The same
model supports FOH and BOH. Item/location assignments define sheet membership and walk order.
An explicit per-item base unit provides a consistent aggregation target without inferring
purchase contents or modifying purchasing rules.

A count session captures an employee, physical observation time, notes and a snapshot of
its location and ordered items. Draft entry edits append observation revisions. Submission
freezes the sheet's entries as physical history. Partial sheets are valid; omissions remain
missing observations. Later sheets can count only some items without erasing older observations
of the others. Managers/Admins correct submitted quantities through immutable successor rows.

Overall inventory is a read-time sum of effective location observations. No authoritative
overall row, writable total or perpetual inventory position was introduced. Missing or
conflicting observations/conversions keep the overall null while retaining a known subtotal.
Each location's actual observed time and age remain visible. Archived locations with recorded
quantities remain included visibly; archival never pretends the goods moved or disappeared.

## Schema and migrations

Added only `backend/migrations/003_inventory_foundation.sql`. Prior migrations are unchanged.
It creates five tables in the isolated `wahi_v2` schema:

| Table | Purpose and protection |
|---|---|
| inventory_items | Unique existing ingredient plus explicit immutable base unit. No duplicate ingredient definition. |
| inventory_locations | Name, description, optional area, sort order, active flag, timestamps and optimistic version. |
| inventory_assignments | Unique ingredient/location pair, default count unit, local order, active flag, timestamps and version. |
| count_sessions | Location, employee ID, observed time, draft/submitted status, submission time, notes, frozen sheet snapshot and version. |
| inventory_observations | Exact entered quantity/unit, physical and recorded times, actor, original/replacement link, correction reason and frozen conversion evidence. |

Foreign keys retain ingredient/location/session references. Positive version checks and
unique assignment/root/supersession constraints prevent ambiguous identity/revision streams.
Numeric checks reject negative, NaN and infinite quantities. Database triggers prohibit
rewriting observations/base units, deleting inventory history, changing assignment identity,
or editing session contents outside the draft-to-submitted transition. Revision triggers
preserve observation identity, unit, time and conversion evidence.

The migration was applied only to the disposable PostgreSQL test cluster. No existing
local server, authoritative data store, legacy schema or production database was migrated.
Startup still checks migration metadata with reads only; applying migrations is explicit.

## Files added and changed

Added:

- `backend/inventory/service.js`
- `backend/repository/inventory-schema.js`
- `backend/migrations/003_inventory_foundation.sql`
- `backend/test/inventory-helpers.js`
- `backend/test/inventory.test.js`
- `backend/INVENTORY-CONTRACTS.md`
- `backend/INVENTORY-REPORT.md`
- `backend/inventory-test-results.txt`

Changed:

- `backend/auth.js` — inventory capabilities, preserving existing protected capabilities.
- `backend/service.js` — exposes `service.inventory` using the same repository and clock.
- `backend/domain/state.js` — adds inventory collections to transactional state.
- `backend/repository/schema.js` — includes inventory persistence mappings.
- `backend/repository/postgres.js` — persists snapshot/conversion JSON and permitted configuration/session updates.
- `backend/test/postgres.test.js` — adds migration expectation and eight inventory integration tests.
- `backend/README.md` — inventory overview and current authorization description.
- `backend/CONTRACTS.md` — link to complete inventory contracts.

No original test assertion was weakened. The migration-list expectation was extended for
migration 003. Existing purchasing validation, exact arithmetic, historical costing and
protected-cost serialization contracts remain intact. The pre-existing backend directory
is untracked; this inventory is relative to the completed validation phase, not a committed
backend baseline. Git reports no tracked changes outside `backend/`.

## API and authorization

Complete method signatures, fields, errors, examples and conservative defaults are in
`backend/INVENTORY-CONTRACTS.md`.

The existing service now exposes:

- `service.inventory.execute(actor, command, input)` for configuration/counting/correction.
- `locations`, `countSheet`, `session`, `sessions`, `locationObservations`, and `overall`.

Commands are createLocation, updateLocation, configureItem, assignItem, updateAssignment,
startCount, enterCount, submitCount and correctCount.

| Capability | Roles |
|---|---|
| inventory.count | Admin, Manager, Lead, Staff |
| inventory.configure | Admin, Manager |
| inventory.history | Admin, Manager |
| inventory.correct | Admin, Manager |

Checks use capabilities, not new role-name branches. Employees edit/submit only their own
drafts and retrieve their own sheets. Managers/Admins can inspect all historical sheets
and correct submitted entries. All roles can read operational location/overall information.
Protected cost, purchase and audit capabilities are unchanged. Tests recursively inspect
Staff/Lead operational responses, exercise rejected configuration/correction/history/audit
requests, and verify internal prices are absent. No HTTP/authentication adapter was added;
principals still come from the existing trusted server-side boundary.

## Audit and concurrency

Every inventory mutation writes an audit event in the same repository transaction. Events
retain actor, previous/new value, recorded/observed timestamps, provenance and change ID.
Corrections additionally require and retain a nonblank reason. General audits remain
restricted through the existing internal-cost capability, because that API contains mixed
sensitive domain records.

All PostgreSQL writes acquire the existing advisory transaction lock before reading.
Location and assignment changes compare `expectedVersion`. Count entry/correction compares
`expectedRevisionId`; initial entries require null. Submission compares both session version
and the complete reviewed observation-ID set. Independent entries can succeed, while stale
same-observation edits fail explicitly. Unique database revision links provide an additional
barrier against competing successors.

Real PostgreSQL tests verify:

1. Two employees count separate locations simultaneously and derive the exact combined total.
2. Distinct entries on one draft survive concurrent writes; competing same-entry edits conflict.
3. Competing Manager/Admin corrections yield one success and one revision conflict, preserving the original.
4. Location archival racing a correction preserves historical sheets, quantities and names.
5. Forced audit failure rolls back a submitted-observation correction.
6. Fractional conversion snapshots survive repository reopening and subsequent conversion changes.
7. Numeric constraints, immutable observations, session retention and immutable base units are enforced.
8. Forced submission-audit failure leaves the draft unsubmitted and excluded from overall totals.

## Exact quantities, conversions and history

Decimal quantities enter as strings and persist as NUMERIC. The existing conversion resolver
uses the ingredient's effective measurements at the physical observation time, with recorded
knowledge available at entry. The result freezes an exact rational conversion factor,
measurement IDs and context, or an explicit missing/conflicting-conversion blocker.

Overall summation and quantity corrections use exact rational arithmetic. API decimal fields
use the existing 12-place presentation policy, while additional numerator/denominator fields
retain exact results, including very small values that display as zero at that scale.
The 3.4 + 6 + 12 bottle case produces exactly 21.4, represented as 107/5.

Subsequent conversion changes cannot reinterpret historical counts. Quantity corrections
reuse their observation's original conversion evidence. Effective reads compare physical
observation times, not when a correction happened. `knownAt` reproduces original quantities
before later corrections and excludes not-yet-submitted sheets. Configuration audit history
also preserves as-known coverage when a location assignment is later archived.

## Assumptions and explicit unresolved cases

- Inventory base units are explicitly configured and immutable in this foundation. Changing
  an established base unit requires a future reviewed rebase workflow; it is not guessed.
- Assignment count units are defaults. Employees can enter another supported canonical unit;
  its meaning must resolve through existing measurements or remain explicitly unresolved.
- Operational `op:bottle`/`op:container` quantities are not automatically mapped to purchase
  packages. If an item is counted and aggregated in bottles, explicit bottle base-unit
  configuration is sufficient. Bottle-to-volume needs ingredient-specific evidence.
- Observation revisions correct quantities only. Original unit/time/conversion cannot change
  under a numeric correction. A future evidence-revision workflow is not implemented.
- Historical unresolved conversions remain unresolved when new measurement evidence arrives.
  Newly taken counts can use the new evidence; old facts are not silently reinterpreted.
- No predetermined inventory day, freshness threshold or aging exclusion is imposed. The API
  exposes timestamps, ages, coverage and mixed-time metadata. Future observations are rejected.
- Partial/empty submission is allowed; omission never means zero. Existing drafts retain their
  sheet snapshot when configuration is subsequently archived.
- Independent observations tied at the newest physical timestamp produce an explicit conflict.
  No employee priority or last-write-wins counting policy is invented.
- Archived locations with observations remain in totals, visibly inactive. No transfer,
  consumption, waste or removal is inferred from archival.
- User IDs are retained text values, matching existing audit actor handling. Historical reads
  require no live-user lookup, so later account archival cannot cascade-delete observations.
  This phase does not add a user directory or user-archival workflow.
- Location/assignment configuration history is recorded-time audit history, not a separate
  backdated operational lifecycle. Summaries identify their coverage basis explicitly.
- The existing whole-state PostgreSQL adapter and global write lock remain. Tests establish
  correctness, not production throughput or performance for an unbounded count history.

No new business-data blocker prevents using this physical inventory foundation with explicit
configuration. **The Egg Roll Wraps purchase-size issue remains unresolved and unchanged.**
Unknown inventory conversions are valid saved states with actionable blockers, not invented
package sizes, prices, yields or conversion factors.

## Scope confirmation

No workbook migration or edits, Toast integration, theoretical/automatic depletion, transfers,
par levels, ordering suggestions, purchase-order generation, variance, waste integration,
scheduling, notifications, tablet UI, FOH/BOH screens, production deployment, Render changes,
frozen UI edits or legacy-system changes were performed. No authoritative overall inventory
count or perpetual position ledger was created. All implementation and tests are local;
fixtures are synthetic.
