# Google Reviews Intelligence — implementation and activation gates

This module uses Wahi's existing CommonJS runtime, PostgreSQL storage, authenticated server and management shell. The November 1 implementation continues from the completed UI release on `codex/reviews-intelligence`. It adds the dashboard/explorer and dedicated OpenAI administration without reconnecting Google or enabling customer-content processing.

The synthetic runner denies external network access. The hosted connection remains restricted to its verified Google OAuth/metadata capability; OpenAI diagnostics have a separate owner-triggered transport. Migration 034 and all new UI changes remain local and undeployed. Source rights, provider activation, background-worker composition and deployment require separate decisions. The historical phase documentation below describes the foundation; see the November 1 section for current additions and limits.

## Run the isolated local preview

From the repository root:

```sh
node backend/review-intelligence/local.js
```

Open [the synthetic dashboard](http://127.0.0.1:4318/#reporting/reviews). Accounts are `admin`, `manager` and `staff`; their deliberately public **synthetic-only** password is `Synthetic-Local-Review-Only-2026!`. These accounts exist only in this disposable local preview and do not grant access to existing Wahi accounts or production.

The runner requires the existing PostgreSQL 16 binaries at `/opt/homebrew/opt/postgresql@16/bin`; `WAHI_TEST_PG_BIN` can select another installed directory. It creates a new owner-private temporary directory, starts PostgreSQL with a Unix socket and no TCP listener, applies local migrations, seeds 70 synthetic reviews, classifies 60 text reviews with mocks, publishes a release and discovers a parking proposal. HTTP binds only `127.0.0.1:4318`. It does not consume `WAHI_DATABASE_URL`, hosted credentials, or `backend/review/.runtime`.

Stop with Ctrl+C. Normal shutdown stops and removes only this runner's disposable database. Each fresh launch starts a fresh demo; this is not the persistence/deployment runner for a future live installation. Durable checkpoint recovery is implemented and tested at the repository/worker level against an existing database.

## Review workflow

Admin and Manager can open Reporting → Review Intelligence. Select a category/date range and weekly/monthly grouping. The dashboard shows distinct review volume, average rating, category mentions, mention frequency, classification coverage, sentiment counts, comparisons, sample warnings and exact evidence. Full calendar months compare with the previous full calendar month; other date ranges compare with the preceding equal-length range. Weeks start Sunday; posting dates use America/Los_Angeles.

Admin can inspect a category proposal's evidence and approve/reject it with a reason. Approval creates a new taxonomy/configuration and leaves the published analysis unchanged. Separately authorize historical reclassification, process pending mock jobs, then publish the completed release. Manager cannot perform these actions; staff receive no review navigation or data access.

Admin controls also configure synthetic source/derived retention, surviving aggregates, missing-review purging and identity/hash erasure. Purging runs every minute in the local runner, and read-time expiry prevents expired evidence appearing before a purge completes. These settings are engineering fixtures, not a grant of Google rights.

## Code and storage

- `google.js`: documented-format validation, identity-free projections, synthetic adapter and live-collection denial.
- `repository.js`: local-only PostgreSQL access, short transactions and independent worker exclusion.
- `ingestion.js`: durable page staging/checkpoints, resumable scans, distinct-ID reconciliation, version promotion and missing/reappearing observations.
- `provider.js`: strict structured-output request contract, evidence validation and deterministic fixture provider. `mock:gpt-6-luna` is a provenance marker, not a real model response.
- `classification.js`: independently recoverable jobs/attempts, leases, bounded retries, cached results, proposal evidence/approval and audited manual retry.
- `service.js`: authenticated role checks, synthetic policy configuration, taxonomy/configuration versions and Admin historical reprocessing authorization.
- `reporting.js`: versioned publication, immutable release membership, daily metrics, hierarchical review deduplication and reporting.
- `retention.js`: expiry, deletion propagation, numerical-only survival tests, withdrawal of ineligible releases and identity erasure.

Migration `028_review_intelligence.sql` creates 19 `wahi_v2.review_*` tables. Large review histories stay outside general domain collection reads. Only the isolated preview and disposable test clusters have received this migration.

## Local API

All endpoints are under `/api/reporting/reviews`, and are enabled only when an explicitly local review service is supplied to the existing server. Hosted runtime requests are denied even if a service is supplied. Existing session, same-origin and CSRF checks apply.

| Method and suffix | Purpose | Role |
| --- | --- | --- |
| GET base | Report with `start`, `end`, `category`, `grain` | Admin, Manager |
| GET `/status` | Checkpoints, classification states/failures, simulated usage, policy/config | Admin, Manager |
| GET `/proposals` | Proposals and available supporting evidence | Admin, Manager |
| POST `/classify` | Process active-config jobs; optional `limit`, default 10 for real provider / 1000 for mock | Admin |
| POST `/discover` | Find supported recurring unmodeled categories | Admin |
| POST `/decide` | `{id, approve, reason}` | Admin |
| POST `/reprocess` | `{configId, reason}`; queue eligible retained history | Admin |
| POST `/retry` | `{id, reason}`; authorize another bounded attempt cycle | Admin |
| POST `/publish` | Publish a complete inventory/configuration, optionally `configId` | Admin |
| POST `/retention` | Configure synthetic policy with optimistic `expectedVersion` | Admin |
| POST `/purge` | Reconcile expiry/deletion | Admin |

The same `startScan`/`ingest` worker accepts `SyntheticGoogleAdapter` or the guarded `GoogleReviewsAdapter`; arbitrary adapters are rejected. The Admin-only Google synchronization endpoint accepts a run ID, never arbitrary source payloads or URLs.

## Tests

```sh
node --test backend/test/review-intelligence.test.js backend/test/review-providers.test.js
npm --prefix backend test
```

The focused tests create their own private PostgreSQL cluster and clean it up. Existing regression tests retain their established disposable-database/private-fixture conventions. See the acceptance report and captured results for the verified run.

Live activation requires explicit owner authorization and reviewed runtime wiring. These retention settings and saved credentials cannot enable network access. See `GOOGLE-REVIEW-INTELLIGENCE-PHASE-3A-ACCEPTANCE-REPORT.md` at the repository root.


## Provider preparation API

All routes below are under `/api/reporting/reviews`, require Admin and a valid session, and POSTs additionally require the existing Origin/CSRF checks. Manager remains reporting-only. Phase 3B adds Administration → Google Business Profile with secure credential entry and paginated business discovery. The older processing-preparation endpoints remain documented below; content operations are blocked by the new connection-only runtime.

| Method and suffix | Purpose |
| --- | --- |
| GET `/providers` | Sanitized settings, rights and activation metadata; never credentials/tokens |
| POST `/providers/{google,openai}/configure` | `{expectedVersion,config,credentials?}`; encrypts credentials and disables processing |
| POST `/providers/{google,openai}/rights` | `{expectedVersion,status,reference,expiresAt}`; records approval separately and disables processing |
| POST `/providers/{google,openai}/activate` | `{expectedVersion,authorizationReference}`; checks independent transport, source rights and provider readiness |
| POST `/providers/{google,openai}/disconnect` | Removes encrypted credentials; Google disconnection also disconnects OpenAI |
| POST `/oauth/start` | Session-bound five-minute state + PKCE authorization URL; disabled with default transport |
| GET `/oauth/callback` | Static no-referrer landing page strips query parameters, then uses same-origin authenticated CSRF-protected POST |
| POST `/oauth/callback` | One-use state/actor/session/environment/version validation and encrypted token exchange |
| POST `/google/accounts`, `/google/locations` | Paginated merchant metadata discovery before ingestion activation |
| POST `/google/prepare` | `{resource,name}` for an empty location; marks real-source boundary and invalidates provider settings |
| POST `/source-rights` | Finite retention policy + approval reference/expiry; cannot grant underlying legal permissions |
| POST `/google/sync` | `{runId?,maxPages?}` starts/resumes the existing checkpoint/reconciliation engine |
| POST `/openai/select-config` | Snapshots active model, prompt, pricing and taxonomy for subsequent jobs |

`ReviewIntegrations` takes an explicit server-held base64 32-byte encryption key, expected callback origin and environment; no browser response exposes the key. The disposable runner generates an ephemeral key per launch. Persistent live operation will require separately reviewed secret-manager/key-lifecycle wiring. Google configuration requires project number, exact registered callback URI, account/location IDs and confirmed identity exclusion. Credentials are client ID/secret, then an OAuth access/refresh token stored by the callback. Google configuration changes erase old OAuth tokens. OpenAI configuration requires model, output limit, request/monthly limits in USD millionths, input/output/cached/cache-write rates in USD millionths per million tokens, pricing date and prompt version. Changing any provider configuration requires fresh rights approval and activation.

Budget reservations persist before dispatch. Pending/uncertain reservations continue counting against the monthly ceiling. Cache writes use a conservative uncached rate bound. Timeouts and crashed dispatches require explicit Admin recovery; invoices are not reconciled automatically. All live transports are disabled by default; request bodies cannot select or enable a transport. Only trusted server composition can inject a transport. Mock `test_only` rights are accepted exclusively by the explicitly injected `mock-http` transport.


## Phase 3B: persistent OAuth and business discovery

Run `node backend/review-intelligence/persistent.js` from the repository root, then open `http://127.0.0.1:4318/#admin/google`. This creates/opens its own owner-private `backend/.google-local` PostgreSQL cluster and stable key. It does not use `WAHI_DATABASE_URL`, `backend/review/.runtime`, or a disposable acceptance database. Private local login instructions are in `.google-local/ACCESS.md`; never paste credentials into chat. All state survives normal shutdown/restart; Ctrl+C stops the runner/database without deleting them. Another process on port 4318 is never replaced. Stop the disposable synthetic runner before using this default port.

The Admin form saves project number, Client ID, Client Secret and the exact callback `http://127.0.0.1:4318/api/reporting/reviews/oauth/callback`. Connect Google authorizes OAuth and business metadata until disconnect or Google invalidation and requires the owner to complete consent. Access tokens renew on demand using the encrypted refresh token; no periodic manual consent is required by Wahi. After callback success, explicitly load/select an account, load locations, and confirm the intended business name/address. Confirmation preserves authorization. Configuration changes involving OAuth client/project/secret/redirect and Reconnect require fresh consent and invalidate prior identity discovery/mapping. Disconnect removes tokens/state/discovery/mapping but retains encrypted client credentials for reconnection. Missing encryption keys are not silently replaced when ciphertext exists.

The persistent transport permits only OAuth token POSTs and account/location metadata GETs. Content rights remain separate and unknown; this runtime blocks review ingestion, OpenAI and Business Profile modifications regardless of saved credentials or mappings. It has no scheduled Google polling. The synthetic runner retains its default network denial and existing fixture workflow. Connection credential entry is blocked in a disposable synthetic runner.

Admin API under `/api/reporting/reviews/connection`:

| Method/suffix | Function |
| --- | --- |
| GET base | Sanitized connection state, public client configuration, confirmed mapping and audit |
| POST `/configure` | `{expectedVersion,projectNumber,clientId,clientSecret?,redirectUri}` |
| POST `/authorize` | `{reference,callbackRegistered?}`; persistent OAuth/metadata authorization only (production requires callback acknowledgment) |
| POST `/refresh` | Verify locally stored token state/refresh expired token; no review access |
| POST `/accounts` | `{cursor?}`; account names/IDs/types/roles/status, discovery ID and next cursor |
| POST `/locations` | `{accountId,cursor?}`; requires current discovered account |
| POST `/select-location` | `{discoveryId,accountId,locationId,confirmedName,confirmedAddress,confirmed:true}` |
| POST `/disconnect` | Remove OAuth tokens and identity-bound state; retain client application credentials |

All POSTs require the existing session/Origin/CSRF checks. Discovery pages expire after one hour for mapping eligibility and are cleaned on subsequent discovery. A location's Google verification status is shown as unavailable when the chosen metadata API does not return it; account verification is not substituted for location verification.

Run focused tests with `node --test backend/test/review-intelligence.test.js backend/test/review-providers.test.js backend/test/review-connection.test.js`; run regressions with `npm --prefix backend test`. The connection tests use private temporary PostgreSQL databases and mocked provider HTTP, including full runtime restarts. See the root Phase 3B acceptance/handoff report for results and pending live-owner steps.

## Phase 3C: hosted connection-only integration

The hosted runtime now opens Review Intelligence on the existing verified production PostgreSQL pool, uses the existing WAHI_INTEGRATION_KEY_BASE64 with provider/location/environment authenticated encryption context, and reuses UserAccounts/NamedSessionStore and the existing secure production cookie/CSRF checks. No local credentials are copied. Hosted initialization creates only an empty review foundation with unknown content rights; no customer reviews, provider credentials or synthetic fixtures are seeded.

The production callback is `https://wahi-reporting-system.onrender.com/api/reporting/reviews/oauth/callback`. Administration → Google Business Profile uses that HTTPS origin. Before Connect Google, the owner must register the exact callback for the OAuth client and confirm registration in the UI. The backend independently requires this registration acknowledgment for production connection authorization. The existing Cloud project/client can be reused when configured for that redirect.

Hosted operation remains connection-only: token exchange/refresh and account/location metadata discovery are allowed after explicit Admin authorization; review ingestion, content approval/retention changes, category discovery, reprocessing and OpenAI calls are blocked. Outbound transport independently rejects review/OpenAI/modification URLs. No review scheduler is started. Manager can view the empty/published report interface and Staff/Recipe-only accounts cannot access Review Intelligence.

Migration 030 is necessary alongside 028/029 to preserve Phase 3B's independent connection authorization, discovery provenance and identity generation. The production release retains existing 031/032 Recipe Book migrations and excludes unrelated undeployed migrations 021 and 024–027. Recovery instructions and private backup evidence are recorded in the owner-local Phase 3C deployment report; never commit database dumps, credentials or private fixtures.

## Persistent authorization update — October 29, 2026

Migration `033_google_persistent_authorization.sql` removes fixed deadlines from still-active enabled grants, with an audit record retaining the previous deadline. It does not revive expired/disabled grants, replace credentials, change the confirmed mapping, or grant content rights. Existing explicit finite authorizations remain guarded until this migration; new UI authorizations have no deadline. All previous migrations are unchanged.

Connection status exposes sanitized `hasRefreshToken`, `reauthorizationRequired` and `notification` fields. Expired access tokens renew automatically on demand; manual status refresh validates the refresh grant with Google. A confirmed `invalid_grant` disconnects and creates an Admin alert. Transient failures and rejected application credentials preserve the grant. API/quota failures do not request consent. The Admin shell shows detected reauthorization alerts on navigation (cached up to one minute); there is no email sender, background health monitor, ingestion scheduler or AI processing. Connection health does not itself prove Business Profile API access.

Google can still invalidate refresh tokens, including for apps in Testing status. Confirm the actual OAuth client's publishing status and project quota in Google Cloud. The user-visible client configuration must not be changed merely to fix a quota error: doing so invalidates identity-bound connection state.

This persistence correction requires the normal production backup, recovery rehearsal and owner deployment authorization.

## November 1 implementation

Continue from the deployed UI baseline on `codex/reviews-intelligence`, not the older dirty primary checkout. `034_review_controls.sql` is additive and must receive normal backup/recovery review and explicit deployment approval. It has only been applied to disposable local databases.

Reporting → Review Intelligence now has separate Overview and Review Explorer views. Explorer performs intersected filters, deterministic sorting, total count and pagination in PostgreSQL, capped at 50 per response. Detail reads enforce location, role and retention before exposing original content, existing replies and current-config AI evidence. AI output v2 adds evidence-validated dishes, drinks, staff mentions and suggestions; v1 results remain readable. Explicit historical reanalysis creates a new immutable configuration instead of deleting or replacing old interpretations.

Administration → Integrations → OpenAI stores credentials through existing environment-bound authenticated encryption. Key values never return in status/configuration/audit responses. A metadata-only connection check lists account-available models; a separate, explicitly confirmed synthetic structured-output probe verifies the chosen model without customer content. The probe reserves against both per-request and monthly limits; uncertain dispatches retain reservations. Model identifiers are account-selected, not hardcoded. Prices are administrator-entered dated estimates, not live invoice reconciliation.

`reviewAdminHTTP` is separately constrained to OpenAI diagnostic endpoints. Hosted composition permits owner-triggered diagnostics after deployment; the synthetic preview denies all external requests. This does not broaden the verified Google OAuth transport. Production `connectionOnly` remains true, so review collection and actual AI processing remain blocked.

`work.js` stores idempotent manual work requests. `worker.js` runs bounded background batches only when a trusted runtime independently grants capabilities. `automation.js` persists disabled-by-default intervals and checks provider/source gates on dispatch. The synthetic local runner enables manual fixture work; no production worker is started. Source API failures preserve raw history; real-location absence alone does not mark historical records for deletion. Source expiry remains enforced by approved retention policy.

Owner activation decisions are separate: verify permitted retention/AI processing (including third-party transfer and identity handling), agree finite retention and approved pricing/model/budgets, explicitly authorize each collection/analysis/scheduling capability, and separately authorize deployment. No browser collector or response publisher is included. Reviewer identity remains excluded pending a source policy allowing it.
