# Hosted Wahi runtime

Build: `npm ci --prefix backend --omit=dev`

Pre-deploy: `node backend/deploy/runtime.js --migrate`

Start: `node backend/deploy/runtime.js`

Health: `GET /healthz` (database readiness; no authentication/configuration data).

Required server environment: `WAHI_DATABASE_URL`, `WAHI_PUBLIC_ORIGIN` (HTTPS origin), `WAHI_ENVIRONMENT` (`production` or `staging`), `WAHI_INTEGRATION_KEY_BASE64` (32 random bytes encoded in base64), `WAHI_AUTH_USERS_JSON` (array of scrypt account hashes with id, username, role, salt, hash). `PORT` is supplied by Render. Do not put plaintext passwords in the account array. Initial account generation uses `review/auth.js` server-side; transfer a generated password privately to its owner. Replacing account hashes and redeploying changes authentication; remove existing sessions for that account when revoking access.

The runtime fails closed for missing/invalid configuration or migration checksums. The current database guard permits only the owner-approved Render Wahi database. Production uses schema-qualified `wahi_v2` queries. It never loads review accounts, local runtime files, or spreadsheets. Authentication requires an explicit login; secure host-only HttpOnly SameSite=Strict cookies, same-origin POST and CSRF checks protect authenticated writes. Sessions and login throttles persist in PostgreSQL; only session-token hashes are stored. Administrative access is capability-checked server-side.

Integration secrets use AES-256-GCM with a separate runtime key, never returned by normal APIs. Use a unique key per Wahi environment, protected separately from database backups. Do not change an established key without a re-encryption/recovery plan. Toast is not called by this runtime.

## Initial data import

This is a separate operator action, not a startup step. Extract the authoritative read-only workbook with `import/extract.py`; use `deploy/import.js` `prepare(sourceJson, checkpointJson, activationAt)` to run the validated workbook builder and validate reviewed checkpoint provenance. A checkpoint preserves the entire reviewed domain state, including corrections, effective-dated history, and inventory configuration. It must come from `PostgresRepository.read()` on the verified local source, never from a client request. Integration secrets, accounts and sessions are excluded. Without a checkpoint, `prepare` returns the fresh workbook import.

After explicit schema migration/checksum validation, call `importEmpty(pool,state)` against the approved database. It verifies database identity and refuses any populated domain collection. Insertion uses the existing import/persistence mapping in a single transaction. Verify every collection count and representative/all cost projections against the reviewed source before cutover. Never commit source JSON, snapshots, or credentials to the public repository.

Intentional reimport requires a maintenance window, current v2 database backup, separate encryption-key backup, explicit verified reset of **only wahi_v2**, migrations, and the import step. This destroys subsequent v2 edits/configuration and is not routine deployment. Leave `public` untouched.

## Tests

`npm test --prefix backend` runs the complete suite. Migration/drop/vendor tests use private workbook-derived fixtures at `backend/test/fixtures/`; obtain these through the owner's private development artifacts. They are deliberately not published in the public repository. Tests fail if required fixtures are absent; no tests are silently skipped. PostgreSQL tests use a separate disposable local cluster (`WAHI_TEST_PG_BIN` selects PostgreSQL binaries) and never use the hosted URL.

Render reference: [deploy behavior](https://render.com/docs/deploys), [health checks](https://render.com/docs/health-checks), [environment updates](https://api-docs.render.com/reference/update-env-var).

Current operational views use `/api/views/*`: one statement-level PostgreSQL
snapshot selecting the latest applicable, non-superseded fact per stream. Item
and recipe details restrict the returned graph to the requested identity and its
current dependencies. NUMERIC quantities are serialized as strings. Audit and
import evidence are retrieved separately on explicit history requests.

Resolution caches belong only to a newly loaded request snapshot. There is no
cross-request cost cache or background materialization to invalidate. Future
boundaries and all committed revisions are visible to the next request. Write
transactions and explicit historical reconstruction retain their original paths.

Hosted HTML references content-fingerprinted JS/CSS with immutable public caching.
HTML, unversioned assets and authenticated API responses remain `no-store`.
`Server-Timing: app` reports handler duration without data or SQL text.
