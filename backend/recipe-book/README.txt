CURRENT RELEASE PREPARATION: READY FOR DEPLOYMENT. See RELEASE.txt and release/PROCEDURE.txt.
An empty Recipe Book is valid. Confidential pilot data is kept in ignored local fixtures.
Prior phase reports below are historical; they do not impose launch content quotas.

CURRENT IMPLEMENTATION: Phase 5 local refinements are implemented on approved a63767d.
The historical Phase 1–2 contract below remains the design record. See PHASE4.txt for the
Builder endpoints and local uploads. See PHASE5.txt, acceptance/WORKFLOW.txt and
PRODUCTION-READINESS.txt for current acceptance status and outstanding release requirements.
Migration 032 is allocated to Recipe Builder; inspect shared refs before allocating 033+.

WAHI RECIPE BOOK PHASES 1–2 CONTRACT

Development base: 0d23a5f963cb18bf165797ce200709f0b14237ee.
This module is a service-facing publication system. It never calls DomainService.execute,
reviseRecipe, selectBasis, inventory mutation, or Toast mutation. Source lookup and readiness
inventory perform SELECTs only. Runtime startup never migrates, seeds or provisions stations.

DATABASE AND DOCUMENT CONTRACT
Migration 031_recipe_book_foundation.sql creates recipe_book_entries, recipe_book_drafts,
recipe_book_versions, recipe_book_events and recipe_book_media. It also extends the existing
named-user role constraint and protects station usernames. All prior migration files are
unchanged. The generic domain repository mapping is unchanged: it cannot persist these tables.

Entry IDs are independent stable UUIDs. source_recipe_id optionally points to an existing
costing recipe without creating or changing its output identity. An entry always has an
explicit on_menu/off_menu classification. No create/import/publish operation chooses On Menu.
Drafts have a validated structured JSONB document; arrays carry display order. Ingredients
store separate id, ingredientId (nullable for custom service-only items), name snapshot,
quantity decimal string, unit and notes. Instructions have independent IDs and text. This
uses the same document shape as immutable publications, avoiding two competing projections.
It is not a single free-text ingredient-line field. Future costing integration must explicitly
resolve custom identities/units; this module does not create ingredient catalog definitions.

schemaVersion=1 is defined in contracts.js and document.schema.json. The JSON Schema describes
structure; contracts.document additionally enforces total/depth/identity/source-pair and
publication completeness rules. Quantities use bounded nonnegative decimal strings, not
binary floating-point numbers. Unknown quantities/units remain null in drafts. Publishing
requires ingredients with known quantities and units plus preparation, garnish and glassware
instructions. An explicit 'No garnish' instruction is valid. Missing photographs are allowed.
Unknown fields, malformed references and unapproved photo IDs are rejected.

Nested components carry stable local IDs, type, editable visibleTitle, optional paired
sourceRecipeId/sourceRevisionId, outputQuantity/outputUnit snapshots, collapsed, structured
ingredients/instructions and children. Names and instructions are copied; publication does
not dereference current source names/formulas. Repeated source recipes in separate branches
are allowed; ancestor source cycles are not. Limits: depth 8, 200 components, 100 children per
node, 200 ingredient/instruction records per node, 1,000 records across the document. The
source-expansion adapter additionally caps recipe recursion at six levels and 100 recipes.
Oversized/unresolvable source graphs fail explicitly; no missing content is invented.

The source adapter selects the current applicable revision according to existing effective/
recorded-time and supersession semantics, or an explicitly selected historical revision.
Nested prepared-output recipes are copied recursively, with their own revision/yield and
production instructions. They are collapsed by default. Parent ingredient usage quantities
remain separate from the child's batch yield; no implied batch scaling or costing occurs.

An ingredient-only source is a valid starting point: lack of source preparation is expected,
not a migration/data-quality defect. Management writes preparation, garnish and glassware in
the service draft through the Phase 4 Builder. Do not fabricate or reconstruct instructions,
and never write these additions back into domain recipe_steps or costing revisions.

A single entry.version is the optimistic concurrency token for all mutations. Requests send
expectedVersion; responses return the new version. Entries lock FOR UPDATE. Publishing requires
confirmed=true for that exact entry version, validates the saved draft, appends an immutable
version, updates the selected pointer, and appends audit atomically. Draft edits never alter
the selected version. Publication does not change menu_status. Classification changes neither
the document nor publication pointer. Service archival hides the entry from ordinary published
reads while retaining drafts and versions. Recovery copies a selected prior version into the
draft; it neither republishes nor unarchives automatically. Database triggers reject UPDATE/
DELETE of publications and events. Event history includes user attribution and draft snapshots.

PERMISSIONS AND HTTP CONTRACT
Admin/Owner: recipes.view/edit/publish/archive (archive includes restore/recovery).
Manager: recipes.view/edit/publish. Lead and Staff: recipes.view. BOH: existing waste-only role.
RECIPE_ONLY: recipes.view only. Services recheck current active database role inside their
transaction; mutation reads lock the actor against concurrent access changes.

Existing origin/CSRF checks and no-store authenticated response policy remain. Routes:
GET /api/recipe-book/contract — view permission; offline policy and scoped authenticated lease.
GET /api/recipe-book/published[?id=UUID&menuStatus=all|on_menu|off_menu] — current published content.
GET /api/recipe-book/entries[?q=title] — management list including drafts/archives.
GET /api/recipe-book/draft?id=UUID — edit permission.
GET /api/recipe-book/history?id=UUID — edit permission; immutable versions and audit.
GET /api/recipe-book/sources?q=title — edit permission; case-insensitive existing domain lookup.
GET /api/recipe-book/source?id=recipeUUID[&revisionId=UUID] — edit permission; copied component.
POST /api/recipe-book/create — {document, menuStatus, sourceRecipeId?}.
POST /api/recipe-book/save — {id, expectedVersion, document}.
POST /api/recipe-book/publish — {id, expectedVersion, confirmed:true}.
POST /api/recipe-book/classify — {id, expectedVersion, menuStatus}.
POST /api/recipe-book/archive — {id, expectedVersion, archived:boolean}; Admin only.
POST /api/recipe-book/recover — {id, expectedVersion, versionId}; Admin only.
Not found returns 404, unauthorized access 403, unauthenticated 401, stale versions 409.
No endpoints for costing synchronization, automatic source refresh, uploads or AI extraction exist.

STATIONS
Admin provisions well.one / well.two through existing Users & Access after separate production
provisioning approval. No migration/startup code inserts either identity. SQL and account-service
checks enforce RECIPE_ONLY for designated usernames and prevent renaming them. Existing global
no-user-deletion policy plus the station guard prevents destructive deletion. Reset/recovery
remains under existing Admin setup-code controls. Admin may disable/re-enable/revoke sessions.
Two browsers/profiles have independent sessions; tabs in one profile share authentication cookies.

Every RECIPE_ONLY authenticated request is checked against a default-deny HTTP allowlist BEFORE
other application routes. Permitted: GET me, published, contract; POST logout. Drafts, sources,
history, account-management endpoints and all unrelated APIs/URLs are forbidden, regardless of
forged role/preview flags. The client forces Recipe Book on login/session restoration/URL changes;
its primary navigation contains only Recipe Book. Account-security links are hidden for stations.
The Phase 2 page is a foundation destination, not the completed bartender service interface.

MEDIA AND OFFLINE CONTRACTS FOR PHASES 3–4
No storage provider, paid service or external account is selected or configured. Media metadata
reserves private object keys, content SHA-256, MIME type, dimensions and approval. The media architecture must
use immutable object keys and a private object-store adapter compatible with Render; present
provider configuration, costs and retention for owner approval before connecting it. Approval
must precede publication references. Media delivery must check that the asset is approved and
belongs to an authorized selected publication; do not expose unrestricted bucket access or
import originals. Add only that explicitly reviewed media route to the station allowlist.

Phase 3 delivers three persistent columns: alphabetical navigation/live search on the left,
service ingredients/preparation/garnish/glassware in the center, and the selected recipe's large
photograph on the right. Preserve aspect ratio with contain-style display; do not crop the
reference presentation. Use optimized, version-addressed derivatives. Update the image with
recipe selection and prevent stale responses from showing a different recipe's image. A missing
photo shows a placeholder. Image delivery must enforce published-recipe authorization for each
request, with RECIPE_ONLY access limited to images of authorized published versions.

Phase 4 delivers management upload from device, local preview before save, replacement/removal,
recipe association, and live recipe/image preview inside the visual drag-and-drop Builder.
Accept JPEG, PNG and WebP. The server must check declared type, actual byte format and successful
image decode; impose encoded-byte, dimension and decoded-pixel limits. Reject malformed or
mismatched files. Generate appropriately sized bartender derivatives, preserve secure originals
and immutable asset IDs, and retain every asset referenced by a historical published version.
Replacing/removing a draft image must not mutate old publications or their objects. Missing
photos produce an explicit Builder completion warning, never a publication failure.

A narrow disposable local fixture-media adapter may support Phase 3 acceptance before management
upload exists. It must exercise the same publication/authorization/media-ID contract and real
image delivery, without selecting a production provider. It is not an upload implementation.
These contracts allow Phase 4 to add uploads without rebuilding the Phase 3 image component.

No browser data persistence is implemented in Phase 2. offlineLease defines a maximum 12-hour
window capped by current session expiry (existing sessions last eight hours), account/environment/
authorization-generation isolation, and mandatory clearing on logout/account switch. The published
index exposes publication IDs and menu classifications; Phase 3 must compare the complete fresh
index after reconnection to replace changed versions and remove archived/withdrawn items. Retain
only published documents and approved photos. Drafts, audits, costs and originals are excluded.
Phase 3 must display an Offline indicator and last successful content refresh time. Revocation
cannot be observed during disconnection; cached access ends at the lease/session deadline and
must clear immediately when reconnection reports revocation or an authorization failure. Expired
leases never authorize offline reads. The shell itself/service-worker caching belongs to Phase 3.

SHARED RENDERER
recipe-renderer.js works in browser and Node. It escapes text, renders quantity and unit before
regular-weight names, preserves decimal display strings, labels standard sections, and supports
native collapsed/expanded recipe components. The shared CSS applies a fixed whole-item left
margin (not first-line indentation), including wrapped instructions, garnish, glassware and notes.
It is ready to be consumed by the live visual preview and service layout in later phases.

MIGRATION NAMESPACE AND FUTURE COLLISION RESOLUTION
001–020,022–023: approved live immutable manifest. 021: reserved account deletion.
024–027: reserved local historical Toast. 028–030: reserved statistics. 031: Recipe Book foundation.
Subsequent Recipe Book work must inspect shared refs/namespace before allocating 032 or later.
Do not fill gaps, rename preserved files or reuse their numbers. Future integration must preserve
exact filenames/checksums, review dependency order and role constraints, merge source at hunk
level, and rehearse the combined manifest on fresh and upgraded disposable databases. If a
number was independently allocated to different SQL, stop for owner resolution; retain existing
applied files and add a new reconciliatory migration after the highest reserved number. Do not
rewrite a deployed checksum. Account-deletion acceptance must specifically extend/test station
protection against soft deletion; that excluded policy is not imported here. Statistics acceptance
must merge its Admin capabilities/routes without weakening the station default-deny gate.

VERIFICATION AND OPERATIONS
Run: node --test backend/test/*.test.js (Node 22+, PostgreSQL 16 binaries available locally).
Private ignored workbook fixtures are required by the existing full suite. Tests create isolated
clusters with private Unix sockets and no TCP listener; they never use production connection URLs.
recipe-book.test.js covers lifecycle, row locking, database immutability, audit rollback, recovery,
publication/menu independence, source freezing, nesting validation, named well sessions, server
access denial, renderer escaping, offline leases and protected-table/costing equality.
readiness.inventory(pool) opens a repeatable-read READ ONLY transaction; output is private.
Production schema migration and account provisioning require separate authorization. Because
startup checks the exact manifest, reverting to the bare older build after 031 requires a reviewed
compatibility build; do not drop service history or use destructive downgrade SQL.
