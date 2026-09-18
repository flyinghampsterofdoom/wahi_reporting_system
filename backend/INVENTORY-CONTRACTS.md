# Physical inventory service contracts

Access through `service.inventory` on the existing `DomainService`, including the service
returned by `openBackend()`. This is a local server-side API, not an HTTP endpoint.
The existing trusted authenticated adapter supplies `{id, role}`. Inventory methods do
not grant access to costing, purchasing, protected history or the general audit API.

All quantities are decimal **strings**, including whole numbers. All IDs are UUIDs.
Unit identifiers use the existing canonical measurement vocabulary. For example,
`op:bottle` and `op:container` are ingredient-specific operational units; bare `bottle`
and `case` do not introduce global conversions. Sort orders and versions are integers.

## Configuration

`await service.inventory.execute(actor, command, input)` returns `{id, changeId}` and
`version` when the target is versioned. Each mutation creates a transactional audit event.
An optional `provenance: {kind:'manual', reference?}` may accompany any command; ordinary
count entry defaults to manual provenance so employees need only enter quantities.

| Command | Required/optional inputs |
|---|---|
| createLocation | `name`; optional `description`, `area`, `sortOrder` (0) |
| updateLocation | `locationId`, `expectedVersion`, `name`, `active`; optional description/area/sortOrder |
| configureItem | `ingredientId`, `baseUnit` |
| assignItem | `ingredientId`, `locationId`, `countUnit`; optional `sortOrder` |
| updateAssignment | `assignmentId`, `expectedVersion`, `countUnit`, `active`; optional `sortOrder` |

Configuration requires `inventory.configure` (Admin/Manager). The optional area is a
configurable string such as FOH or BOH, not a separate inventory system or seeded enum.
Names need not be unique: identity is always the stable UUID.

An inventory item references one existing Ingredient. Its explicit base unit is immutable,
so historical quantities can always be aggregated in that unit. Configuration does not
create a purchase option or alter existing purchase contents. An item/location pair has
one reusable assignment identity; archive/restore through versioned `updateAssignment`.
Location/assignment updates are complete replacements for their configurable fields;
omitted optional fields take their documented defaults, not PATCH semantics.

Missing conversion evidence does not prevent assignment. New assignments and new sessions
require active references. Archiving an assignment removes it from new sheets. Archiving
a location prevents new sessions there. Existing sheets keep their original ordered item
snapshot and may be completed even if their location/assignment/item is subsequently
archived. Historical submitted observations remain available and correctable.

## Counting workflow

All four roles have `inventory.count`. Drafts belong to the employee who started them;
only that employee can enter or submit the draft. Managers can inspect others' sheets
and correct submitted observations; they cannot silently take over another employee's
draft.

1. `locations(actor, {includeInactive?: false})` returns locations in sort order (stable
   ID breaks ties), with name, description, area, active flag and version.
2. `countSheet(actor, locationId)` returns the active location and ordered expected items.
   Items include assignment ID/version, ingredient ID/name, count unit and base unit.
3. `execute(actor, 'startCount', {locationId, observedAt, notes?})` starts a draft and
   freezes the location label and ordered assignment/item snapshot.
4. `session(actor, sessionId)` retrieves the sheet, current entries and missing item IDs.
5. `execute(actor, 'enterCount', {sessionId, ingredientId, quantity, unit,
   expectedRevisionId, observedAt?})` appends an entry or draft revision. Use null for
   `expectedRevisionId` on the first entry, then the current observation ID on later edits.
6. `execute(actor, 'submitCount', {sessionId, expectedVersion,
   expectedObservationIds})` submits exactly the entry revisions the employee reviewed.
   Send every current observation ID from the sheet. Concurrent entry changes cause a
   conflict rather than an unseen submission.

`observedAt` is an explicit timezone timestamp for when the human physically counted.
A per-entry timestamp may differ from the session's nominal timestamp. There is no
schedule or inventory-day requirement. Future physical observations are rejected. The
existing timestamp validation allows milliseconds and rejects invalid calendar dates.

Entries may use any supported canonical unit; the assignment unit is the sheet default.
The first entry records its actual unit, observation time and conversion snapshot. Later
edits to that observation change its quantity only, preserving the unit/time/evidence.
Negative values, numeric JS values, malformed decimals, NaN and infinity are rejected.
Explicit zero is a valid observation. Missing entries are not zero.

Partial and empty sheets may be submitted. They preserve exactly what was counted, and
list omitted ingredients explicitly. A newer partial sheet does not erase an older
observation of an omitted item. The old observation retains its real time and age.
Drafts are excluded from all location/overall observation summaries.

## Submitted corrections and history

`execute(actor, 'correctCount', {observationId, expectedRevisionId, quantity, reason})`
requires `inventory.correct` (Admin/Manager). The observation ID may identify an earlier
record in that session/item stream; `expectedRevisionId` must identify its current head.
A nonblank reason is mandatory. Each correction stores the replacing quantity, original
unit/time/conversion evidence, correcting actor, recorded time and `supersedesId`.
Original observations and intermediate revisions remain immutable.

A stale version returns `code: 'revision_conflict'`. Reload and review the current value;
no automatic overwrite/retry should discard another employee's edit. A correction to an
older sheet does not change when its physical observation occurred and cannot overtake
a newer physical observation merely because it was entered later.

- `session(actor, sessionId, {knownAt?})`: the employee may retrieve their own sheet.
  Admin/Manager may retrieve any sheet, including archived locations/items, and receive
  the complete visible operational `revisions` array. Staff/Lead receive effective entries
  without that revision array. Historical `knownAt` excludes later corrections and treats
  a not-yet-submitted sheet as draft.
- `sessions(actor, {locationId?, from?, to?, knownAt?})`: Admin/Manager only, submitted
  historical sheets ordered by observation time descending. From/to filter the session's
  nominal observation time inclusively; per-item times remain available on the sheet.
- General `service.audit` continues to require `internal_cost.read`. Inventory counting
  does not grant access to sensitive mixed-domain audits.

Quantity corrections intentionally cannot change an observation's unit, time or frozen
conversion. No policy for retroactively rebasing measurements is invented. If physical
conversion was unresolved when entered, later configuration does not silently resolve
that historical record. A new physical count can use newly supplied evidence; any future
administrative evidence-revision workflow must be explicit and separately reviewed.

## Location and overall observation queries

- `locationObservations(actor, locationId, {at?, knownAt?})` returns effective observations
  per item for that location, including missing/conversion/conflict status and age.
- `overall(actor, ingredientId, {at?, knownAt?})` derives a location breakdown and sum for
  one ingredient. Neither this sum nor an inventory position is stored or editable.

Both reads require `inventory.count`, and default both timestamps to server now.
`at` limits physical observation time; `knownAt` limits recorded knowledge, submission
visibility and corrections. The most recent physical observation at or before `at` is
selected independently for each item/location. A correction supersedes its original only
when known by the cutoff. Two independent sessions with the same latest observation time
return `conflicting_observations` with both candidates, rather than a row-order winner.

Overall coverage includes assignments active as of `knownAt`, plus locations with retained
submitted observations. Archived locations with actual observations remain in the breakdown
and sum, visibly inactive. Archiving is not a transfer, disposal or zero observation. A
location assigned but never counted contributes `missing_observation` and keeps the overall
quantity null. No configured/observed locations also yields unresolved, not authoritative zero.
Configuration's as-known state is reconstructed from its existing transactional audits;
later assignment archival cannot make an earlier incomplete inventory appear complete.
This is a recorded-knowledge view, not a separately business-effective location lifecycle.

Representative overall fields:

```json
{
  "kind": "physical_observation_summary",
  "ingredientId": "<id>",
  "baseUnit": "op:bottle",
  "status": "resolved",
  "overallQuantity": "21.400000000000",
  "exactOverallQuantity": {"numerator":"107", "denominator":"5"},
  "knownSubtotal": "21.400000000000",
  "exactKnownSubtotal": {"numerator":"107", "denominator":"5"},
  "mixedObservationTimes": true,
  "oldestObservedAt": "2026-09-11T09:00:00.000Z",
  "newestObservedAt": "2026-09-15T14:00:00.000Z",
  "simultaneous": false,
  "coverageBasis": "assignments_as_known_plus_recorded_locations",
  "breakdown": []
}
```

The real breakdown contains each location, its active state, status, observation and
`ageMilliseconds` measured against `at`. Every observation carries actual `observedAt`,
`recordedAt`, actor, entered quantity/unit, conversion evidence, decimal `baseQuantity`
and `exactBaseQuantity`. Unknown observations have null age. Conflicting candidates retain
their own times/evidence. `simultaneous:false` explicitly avoids claiming that the aggregate
is a single simultaneous count, even when recorded timestamps happen to match.

If any location is missing, conflicting or conversion-unresolved, `overallQuantity` and
`exactOverallQuantity` are null. Only resolved locations contribute to known subtotal.
A future UI can use raw ages, oldest/newest dates and mixed times to display warnings.
No freshness threshold, time-based exclusion or operational ordering policy is invented.

## Exact conversion and storage

Conversion uses the existing ingredient-specific resolver at `observedAt`, with knowledge
available when the entry is recorded. It snapshots the exact factor for one entered unit,
measurement IDs, selected dates, from/base units and any unresolved blocker. Counting in
`op:bottle` against an explicitly configured `op:bottle` base needs no bottle-volume guess.
Counting bottles into mL requires an explicitly measured ingredient-specific relationship.
A purchase package does not implicitly define an operational bottle/container conversion.

The factor is stored as integer numerator/denominator strings. Quantities persist as exact
PostgreSQL NUMERIC. Multiplication, corrections and overall sums use BigInt rational
arithmetic. Decimal response fields retain the existing 12-place, half-away-from-zero
presentation policy; additional rational fields preserve even sub-presentation quantities
exactly. Consumers must not re-sum rounded display strings as authoritative totals.

## Errors and persistence boundary

Typed errors include forbidden/unauthenticated, revision_conflict, not_found,
inactive_reference, missing_inventory_unit, not_on_sheet, invalid_state,
invalid_observation_time, immutable_observation and invalid_command. Invalid payloads use
the existing Zod-validation style. Missing physical conversions are saved as explicit
observation blockers rather than thrown away.

Every mutation runs under the existing PostgreSQL transaction advisory lock before reading
state. Unique item/location assignments, unique initial session/item observations and
unique supersession links add database-level protection. Submitted sessions, immutable
observations and base-unit definitions cannot be destructively rewritten. Audit insertion
failure rolls back the whole domain transaction. Production role/session validation and
controlled database credentials remain responsibilities of a future approved adapter.
