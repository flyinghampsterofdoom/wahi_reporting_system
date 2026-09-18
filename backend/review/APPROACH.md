# Owner-review integration approach (before implementation)

Repository starts at eb4222d, with untracked backend/ and a pre-existing .DS_Store; no
tracked modifications. Existing frontend is public/*.html + shared app.js/styles.css,
served by the root Express server. APIs and pages use the same origin. Root db.js selects
SQLite (default, data.db) or PostgreSQL (DB_CLIENT=postgres, DATABASE_URL). PORT defaults
3000; DB_PATH and NODE_ENV also affect behavior. Authentication uses users/auth_sessions,
scrypt passwords and hashed opaque cookies; legacy roles are ADMIN/MANAGER/STAFF, not LEAD.
Startup runs schema/data mutations and upserts a fixed admin password. Many legacy API
handlers are not guarded by the page-auth middleware. Do not expose this process as v2.

Existing vendor/catalog/area/count/par/reorder/recipe-builder/recipe-book/security/source
reference workflows remain on the original app. No existing file or runtime is replaced.
No Render blueprint, deployment scripts, credentials or staging connection were found.
The repository supports a single web process backed by SQLite or PostgreSQL; live Render
service/database IDs, tier, environment and topology cannot be established from these files.
No claim is made to have inspected live Render state.

Chosen review topology: loopback-only Node HTTP adapter -> validated DomainService ->
dedicated private PostgreSQL cluster containing synthetic wahi_v2 data. Serve a separate
responsive review UI on that adapter. Provision explicitly, never migrate/seed at normal
server startup. Keep private runtime data and credentials ignored and owner-readable.
No connections to DATABASE_URL, the legacy DB, or an existing PostgreSQL server.

Authentication is isolated review-only scrypt accounts for the four existing v2 roles,
not a replacement/migration of legacy authentication. Sessions are server-owned opaque
HttpOnly cookies, with same-origin/CSRF enforcement. All service calls derive the principal
from the authenticated session. Keep internal projections capability-restricted.

This local staging avoids production writes, network exposure, cloud cost and irreversible
infrastructure changes. It is available on the owner's workstation; tablet layout can be
reviewed in responsive mode. Remote/physical-tablet access would need separately verified
HTTPS staging configuration. No production deployment is necessary or performed.

Rollback: stop the review HTTP process and its private PostgreSQL cluster. Keep the review
data directory to preserve feedback; legacy operation is unaffected. No production rollback,
credential migration, schema deletion or workbook import is involved.
