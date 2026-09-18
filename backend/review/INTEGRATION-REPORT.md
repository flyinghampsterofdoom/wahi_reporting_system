# Integration / Owner Review Report

The implemented v2 functionality is available for owner review at:

**http://127.0.0.1:4317**

This is an isolated, persistent local staging environment on the owner's Mac, using the
real validated domain/inventory services and a dedicated PostgreSQL cluster. It is not a
static mockup or a deployment over production. Review credentials are in
`backend/review/.runtime/ACCESS.md`; use `owner` for Admin. See README.md for the walkthrough.
Development stops at this milestone pending owner feedback.

## Repository state and audit before integration

The checkout began at `eb4222d` (Add cup units to recipe editor), with `backend/` and a
pre-existing `.DS_Store` untracked and no tracked-file modifications. The remote is
`https://github.com/flyinghampsterofdoom/wahi_reporting_system.git`. No commit, push or
production deploy was performed during this milestone.

Inspected the four requested backend reports/contracts and the actual domain, inventory,
authorization, repository and migration implementation. Verified the 130-test baseline
through the complete suite as integration proceeded. Also inspected root server.js/db.js,
package scripts/dependencies, frontend routing and JavaScript, Git state, environment-variable
names, and local SQLite schema/role metadata through read-only access. No legacy startup or
import command was run.

A checksum baseline covers root server/db/package files, all existing public frontend files,
and data.db plus its WAL/SHM files. Final comparison reports **zero changed files**. Root
tracked Git diff is also empty. The baseline is in `legacy-baseline.json`.

## Existing application and deployment topology

The repository's existing app is a single Express web process serving standalone HTML pages
and one shared vanilla-JavaScript app.js/styles.css. Pages and API calls share an origin.
The server directly queries the SQLite/PostgreSQL adapter; legacy costing also uses numeric
floating-point and workbook-derived source tables. V2 has intentionally separate identities,
exact arithmetic, services and the `wahi_v2` PostgreSQL schema.

Legacy configuration discovered in code:

- `PORT`: defaults to 3000.
- `DB_CLIENT`: defaults to sqlite; postgres uses `DATABASE_URL`.
- `DB_PATH`: defaults to the repository's data.db when SQLite is selected.
- `NODE_ENV`: affects secure legacy cookie behavior.

Legacy authentication uses users/auth_sessions, scrypt password hashes, hashed opaque session
tokens, and an HttpOnly cookie. Its declared roles are Admin/Manager/Staff; v2 additionally
supports Lead. Startup runs schema and business-data mutation logic and upserts an admin
account with a hard-coded password. Several legacy API handlers are not protected by the
page-login middleware. These findings make directly starting/reusing that server unsafe for
this isolated review milestone. They were documented, not changed or tested against live data.

Existing catalog, vendor, areas, counts, par/reorder, recipe builder, recipe books, source
references and account/security functionality remain untouched on the original application.

Owner-supplied deployment links:

- Render project: https://dashboard.render.com/project/prj-d6q3jvtm5p6s73aiatag
- Existing live app: https://wahi-reporting-system.onrender.com

The live URL was inspected read-only and displayed the legacy “Login | Bar Inventory” page,
consistent with this repository. No production login or internal-data API request was made.
The Render dashboard redirected to Render sign-in, and the available browser did not have an
authenticated Render session. There is no checked-in Render blueprint or staging configuration
and no configured Render connector. Therefore live service IDs, deployment commit, auto-deploy
settings, database connections, disk setup, instance tier and preview-environment capability
remain **unverified**. Repository-supported topology is not proof of the live database choice.

## Integration approach and why

The approach was documented before implementation in APPROACH.md. A separate loopback Node
HTTP adapter serves a responsive review UI and calls the existing DomainService, including
`service.inventory`. A dedicated private PostgreSQL cluster holds synthetic review records.
No legacy module is imported into the adapter, no routes are replaced, and no legacy credentials
or data are copied.

Local staging was the safest immediately usable option because it requires no unverified
Render changes, cloud billing, public exposure or production-schema access. The app preserves
v2 isolation and provides real workflow persistence. Physical-tablet/remote review would need
an authenticated, separately reviewed HTTPS staging arrangement; this milestone does not
silently expose the local service over the network.

## Files added/changed

All implementation files in this milestone are additions. Existing backend domain/service
files, migrations, root application files and production frontend files are unchanged.

Added under `backend/review/`:

- `.gitignore` — excludes private runtime data and credentials.
- `APPROACH.md` — pre-implementation audit and integration decision.
- `auth.js` — review-only scrypt account helpers.
- `server.js` — loopback HTTP/session/API adapter and safe serializers/errors.
- `runtime.js` — explicit isolated setup/start/stop controls.
- `seed.js` — labeled synthetic records through existing service commands.
- `public/index.html` — review login and application shell.
- `public/style.css` — responsive desktop/tablet styling.
- `public/app.js` — operational workflow UI using the adapter.
- `README.md` — access, walkthrough, operational limits and rollback commands.
- `BROWSER-ACCEPTANCE.md` — executed browser workflow evidence.
- `legacy-baseline.json` — preservation checksums, without database contents or credentials.
- `TEST-RESULTS.txt` — final full-suite output.
- `INTEGRATION-REPORT.md` — this report.

Also added `backend/test/review-http.test.js` with 11 transport/authentication tests.
Ignored local `.runtime/` contains the PostgreSQL cluster, logs, account hashes, credentials,
PID and setup marker. It is not served by the web application or included in Git.

## UI and API surfaces

The responsive interface provides login/logout, overview, location selection, count entry,
review/submission, current and historical sheets, corrections, location breakdowns and derived
overall inventory. The count flow uses a large decimal entry field, named item selection,
Save & next, Skip and a review step. Missing entries never become zero. Managers can see
original/corrected quantities, correcting user, reason and timestamps.

Location management exposes creation, ordering, active/archive state, inventory base-unit
configuration and item/location assignments. Catalog controls expose existing ingredients,
suppliers, purchase packages/prices, cost-basis selection, source yields, measurements,
labor components/rates, recipe revisions, menu identities/prices/mappings, historical cost
queries and protected fact audits. These are review controls for implemented services, not
new business features or new FOH/BOH recipe-display systems.

The adapter has same-origin `/api` endpoints for login/me/logout, allowlisted catalog reads,
protected internal data, inventory/domain commands, locations/sheets/history/overall, cost,
recipe/ingredient and audit/history reads. Domain and inventory writes call their existing
validated execute methods. Quantities remain strings; client-side numeric arithmetic is
limited to UI order/version/date/age display, not authoritative costing or count totals.

## Authentication and authorization

Four explicitly synthetic accounts map to Admin, Manager, Lead and Staff. This is a separate
review authentication adapter, not a replacement or migration of working production login.
User IDs/roles are resolved server-side. Request-supplied role/actor claims do not grant access.

Passwords are stored as scrypt hashes; private local credentials are owner-readable. Random
session cookies are HttpOnly and SameSite=Strict; server-side sessions expire in eight hours
and are revoked on logout/restart. Loopback HTTP cookies deliberately do not use Secure;
this configuration must not be promoted to public hosting without HTTPS adaptation.
Mutation requests require matching Origin, JSON content type and a session-specific CSRF token.
Host validation rejects foreign hostnames. Login attempts are rate limited. Only three explicit
public asset paths are served; runtime/private files are inaccessible. SQL errors, stacks and
rejected input values are not returned to the browser.

Existing capability checks remain authoritative. Lead/Staff can perform their own counts and
read operational data, but cannot retrieve internal cost/purchasing/audit/history payloads,
configure inventory or correct submitted observations. Manager/Admin retain management and
correction capabilities; department labor rates remain Admin-only. UI visibility follows those
capabilities but is not the security boundary.

## Database, demo data and environment actions

No domain schema/migration was added or changed. Explicit setup applied existing migrations
001–003 only to a **new isolated review cluster**. PostgreSQL listens on a private Unix socket
under `.runtime/`, using port identifier 55441, with TCP disabled. HTTP listens only on
127.0.0.1:4317. Runtime directories are 0700 and credentials are 0600. Setup and seeding are
explicit, not application-startup side effects. Normal restart checks schema readiness and
retains review data. It does not read DATABASE_URL, DB_PATH or production configuration.

Seed data consists of eight clearly marked Demo ingredients, one recipe/menu item, four
locations, explicit example measurements, prices, allocated labor, assignments and four
historical count sheets. All records are synthetic fixtures, not workbook or production data.
They demonstrate rum bottles, limes, explicit zero-cost water, an incomplete garnish yield,
a Ginger-style missing conversion and differently aged location counts.

Two browser acceptance sheets were subsequently recorded and retained with identifying notes.
The Staff Bar count records 22 bottles corrected to 2.2 plus 14 limes, with garnish uncounted.
The Lead Walk-In count records 1.75 cups of ginger with an unresolved conversion. The current
demo rum total is consequently 20.2 bottles; initial seeded observations totaling 21.4 remain
in history. No records were deleted to hide testing.

No Render, Git hosting, DNS, public tunnel, production environment, production user or existing
database changes occurred. The private review HTTP process and database are currently running.

## Verification

Complete automated suite: **141 tests; 141 passed; 0 failed; 0 cancelled; 0 skipped; 0 todo**.
Command: `npm --prefix backend test`. Duration: **2010.657167 ms**.
All 130 pre-integration tests remain passing. Eleven new HTTP tests cover login, principal
spoofing, Origin/CSRF enforcement, both restricted roles, full count/correction/history/overall
flow, draft ownership, Admin-only labor rates, error sanitization, private-file exclusion,
logout and Host validation. No existing assertions were weakened.

The PostgreSQL suite remains 23 tests: 22 actual isolated-database integration tests and one
connection-configuration test, all passing. HTTP tests use the transactional memory repository
for focused transport coverage. Browser end-to-end acceptance uses the persistent **real
PostgreSQL review app** and covers Staff/Lead counting, Manager correction, Owner costing,
restart persistence and tablet layout. See BROWSER-ACCEPTANCE.md. Browser error inspection
returned no errors after the Lead submission workflow.

Legacy checksums and tracked-file diff show no change. Legacy runtime behavior was preserved
by isolation rather than by starting its mutation-prone server or running production tests.

## Known limitations and blockers

- Render staging settings cannot be verified without an authenticated dashboard/connector.
  The supplied public Render URL still serves the legacy application, not this review build.
- Access is local to this Mac; the server is intentionally not reachable from another tablet
  or machine. Tablet layout was tested in a 768×1024 browser viewport.
- Login sessions are in memory; restarting the review process requires login again. Counts
  and domain changes persist in PostgreSQL. No production identity migration was attempted.
- The review UI covers the central implemented workflows, not every possible advanced domain
  command option. For example, same-effective-time supersession and unit/time rebasing are
  not new general-purpose administrative workflows here. Backend contracts remain unchanged.
- Existing whole-state repository reads/global write serialization are retained. This milestone
  is not a production scaling or public-security certification.
- Egg Roll Wraps still lacks an approved package size. No size was invented and no purchasing
  constraint was weakened. Unknown measurement conversions stay unresolved.

## Rollback and stopping point

From the repository root, run `node backend/review/runtime.js stop`. This stops only the
verified review HTTP process and its private PostgreSQL cluster, preserving review data for
later feedback. Restart with `node backend/review/runtime.js start`. No production rollback,
legacy restoration or destructive schema operation is required. Do not use root npm start
for this app. No reset/delete command was introduced.

Owner review is now the finish line. No Toast, theoretical depletion, transfers, variance,
par levels, suggested ordering, purchase orders, waste integration, scheduling, labor pacing,
cut reports, messaging/email reporting, new BOH/FOH systems, future recipe-display features,
additional reports, workbook migration or production deployment was implemented.
