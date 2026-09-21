# Hosted Wahi runtime

Build: `npm ci --prefix backend --omit=dev`

Pre-deploy: `node backend/deploy/runtime.js --migrate`

Start: `node backend/deploy/runtime.js`

Health: `GET /healthz` (database readiness; no authentication/configuration data).

Required server environment: `WAHI_DATABASE_URL`, `WAHI_PUBLIC_ORIGIN` (HTTPS origin), `WAHI_ENVIRONMENT` (`production` or `staging`), `WAHI_INTEGRATION_KEY_BASE64` (32 random bytes encoded in base64), `WAHI_AUTH_USERS_JSON` (array of scrypt account hashes with id, username, role, salt, hash). `PORT` is supplied by Render. Do not put plaintext passwords in the account array. Initial account generation uses `review/auth.js` server-side; transfer a generated password privately to its owner. These hashes bootstrap existing accounts only on the first named-user migration. PostgreSQL users are authoritative afterward; changing the environment array does not reset passwords, overwrite profiles or remove named users. Admin-issued setup/reset codes now establish credentials transactionally.

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

## Named users, setup and recovery

`wahi_v2.users` is authoritative after one-time bootstrap, preserving existing account IDs, hashes and credential generations. Existing Owner sessions survive this migration. Bootstrap timestamps describe creation of the directory record; an older account creation date and last login are not fabricated. `WAHI_AUTH_USERS_JSON` remains validated bootstrap configuration and is never reapplied after the directory marker exists. Do not roll back to an environment-authoritative runtime against the named-user database.

Administration → Users & Access is guarded by `users.manage` and Administration capability checks. Roles retain the existing capability presets. Mutations recheck the current actor inside the serialized transaction. The UI never supplies authoritative capabilities or audit actor identity.

Usernames are trimmed, ASCII lowercase, 3–64 characters, start with a letter/digit, and otherwise allow letters, digits, dots, underscores and hyphens. Login uses the same normalization. Usernames remain unique across disabled accounts. Email is optional, trimmed and fully lowercased under an explicit case-insensitive recovery-identity policy; non-null email is unique across all accounts, including disabled accounts. Admin-entered email is unverified. Changing it clears verification. Verification uses separate hashed, single-use, exact-address tokens.

Active account creation and explicit setup/reset issuance generate 32 random bytes (256 bits), base64url encoded. Only SHA-256 token hashes are stored. Codes expire in 24 hours, are displayed once in the successful response, and are never returned by list/detail/history. The recipient manually opens `/#account-setup` and POSTs the code and a 12–128 character password. Manual codes do not appear in URLs. Emailed bearer links use URL fragments, which are not sent in HTTP access logs; token material never appears in security audit. Disabled creation issues no code; enable then explicitly issue one.

Password establishment consumes the token, stores salted scrypt credentials, rotates the session generation, revokes all account sessions and appends security audit events in one transaction. Concurrent use has one winner. Invalid, expired, superseded, consumed or disabled-account codes receive neutral errors. No authenticated session is granted; the user logs in normally. Issuing a new code also revokes sessions and invalidates earlier codes, but leaves the old password usable until successful reset. Disabling an account immediately blocks both login and existing sessions. Access/status changes revoke sessions and pending codes; re-enabling does not resurrect either.

`user_security_audit` is append-only and contains no password/hash/token/session material. Session revocation, account/profile/access changes, issuance and password establishment/reset are transactional with required audit. Session insertion locks the current account/generation and refuses an authentication candidate made stale by a concurrent access or password change. Existing logout, session expiry and private response cache rules remain intact.

An Admin may not disable or demote their own account. Disabling/demoting the last active Admin with an established password is prohibited; an account awaiting setup does not count as a usable replacement. Serialized administration prevents concurrent actions from bypassing the rule. Accounts cannot be destructively deleted; disable them to preserve history.

Future email delivery can deliver the existing one-time credential to its recipient without changing consumption or reset semantics. Email verification requires its own future verified-address flow; entering an email does not verify it. Resend sending and public email-account workflows are documented below.

Named Wahi users are not Toast employees or generic FOH/BOH logins. Future optional linkage belongs in a separate association with stable Wahi user and external employee identities, independent of credential creation. No employee records, matching or association was created in this phase.


## Transactional account email (Resend)

Administration → Integrations → Resend manages the sender name/address, enabled
state, replace-only API key, Test Email, and recent delivery metadata. The key is
AES-256-GCM encrypted in the existing integration store using the existing runtime
key and environment/provider-specific authenticated context. No new environment
secret or source-code credential is required. This is sending only: there is no
receiving, DNS management, or scheduled reporting implementation.

`WAHI_PUBLIC_ORIGIN` is also the canonical HTTPS email-link origin. Links use
opaque tokens in fragments, immediately removed from browser history after page
load, then submitted through same-origin JSON POST. No arbitrary redirects,
Host-header-derived links, email addresses, or user IDs are embedded in links.
Setup and verification expire in 24 hours; emailed reset expires in 1 hour.
Manual Admin-issued codes retain their 24-hour lifetime. Manual and email
setup/reset share one supersession chain. Setup does not verify an address.
Verification is a distinct affirmative mailbox-holder action and binds the exact
normalized address. Email/access changes invalidate outstanding credentials.

Recovery requires an active, password-established user with a verified email.
Public responses are uniform, with a 500 ms minimum response time and provider
delivery outside the response path. In-memory delivery work holds plaintext only
for the live request; there is no persistent plaintext-token queue. Issuance,
delivery-request metadata, and security audit commit together before sending.
Acceptance is recorded separately and never represented as inbox delivery.
Timeouts/uncertain sends are `unknown`; requested records older than two minutes
are shown as unknown (including process interruption). Failures store only fixed
sanitized categories. Operators can issue a fresh link after cooldown; no retry
retrieves a prior plaintext token. Do not add generic request-body logging.

Durable hashed rate-limit keys enforce one email per account/purpose per minute,
five per hour, five recovery requests per normalized address per hour, 200 public
recovery requests per socket/network bucket per ten minutes, 100 email-token
attempts per bucket per minute, and three Admin test emails per minute. Socket
buckets deliberately do not trust requester-supplied forwarding headers and may
be shared behind the Render proxy. Existing manual-token/login limits remain.
Account security supports own-address verification resend and password change;
email changes remain Admin-managed. All password changes revoke sessions and
outstanding password-reset credentials transactionally with security audit.

Provider API: https://resend.com/docs/api-reference/emails/send-email
