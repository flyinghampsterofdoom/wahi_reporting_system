# Google authorization loss — separate read-only investigation

Investigated November 17, 2026 Pacific / November 18 UTC, after completing the warning-placement fix. Production queries used explicit repeatable-read **READ ONLY** transactions. No application login, Google API request, refresh attempt, reconnection, credential/configuration update, schedule change or deployment was performed. Render configuration and deployment history were read only.

## Conclusion

The current disconnection is consistent with a real Google refresh-grant rejection, not a timeout or quota failure being mistaken for revocation. The exact reason Google invalidated the grant is not retained. **Seven-day expiry of an external OAuth app in Testing is the leading explanation, not a confirmed Cloud configuration finding.** A separate destructive application behavior made recovery harder: the automatic invalid-grant handler calls the full manual-disconnect routine, which also deletes the independent OpenAI key and confirmed business mapping.

The November 1 release remains live: `dep-dbjs94rbc2fs73dnrqkg`, code `56074c6cd0e753158dc21c715e3c55a228a39a5b`. Render lists no deployment between that release and the November 5 failure, or afterward. All existing environment values, including the database URL and integration encryption key, match the protected November 1 baseline. The local UI fix is **not deployed**.

## Verified chronology

All Pacific times below are PST except the October 29 rows, which are PDT.

| Evidence | Exact stored UTC timestamp | Pacific timestamp |
| --- | --- | --- |
| Latest successful OAuth authorization-code exchange (`oauth_connected`) | October 29, `15:35:25.080Z` | October 29, `08:35:25.080 PDT` |
| Migration removed Wahi's arbitrary connection deadline | October 29, `15:55:42.449Z` | October 29, `08:55:42.449 PDT` |
| Latest authenticated Google Reviews API page checkpoint, page 12 of the completed traversal | November 4, `18:00:16.946Z` | November 4, `10:00:16.946 PST` |
| That successful traversal completed, 565 distinct reviews | November 4, `18:00:24.377Z` | November 4, `10:00:24.377 PST` |
| First failing traversal started | November 5, `18:00:37.074Z` | November 5, `10:00:37.074 PST` |
| First recorded automatic authorization invalidation: `provider_disconnected`, actor `review-oauth-worker` | November 5, `18:00:37.488Z` | November 5, `10:00:37.488 PST` |
| Failing scheduled work recorded complete with `review_google_reconnect_required` | November 5, `18:00:37.498Z` | November 5, `10:00:37.498 PST` |

The page checkpoint is the closest durable evidence of a successful authenticated request. The transport accepts that page only after HTTP 200, validation and a database checkpoint. It is not an independently logged network-response timestamp. Likewise, `37.488Z` is the exact persisted disconnect audit timestamp, not a separately measured Google-response arrival time. The failed traversal received no pages and made one attempt. Earlier October connection errors were rate-limit errors, not this authorization-loss episode.

November 6–17 scheduled runs failed locally with `review_provider_disconnected`. They do not demonstrate additional Google revocations or fresh token-exchange errors: the saved provider was already disabled.

## Refresh behavior and evidence limits

The deployed `accessToken` implementation reuses an unexpired access token, then renews it using the stored refresh token under an advisory lock. A successful exchange persists the new access token, keeps a non-rotated refresh token and leaves the grant connected. The November 1 protected baseline contains a usable refresh token and an access-token expiry of November 1 at `19:00:00.642Z`. Successful authenticated traversals through November 4 therefore demonstrate that renewal continued beyond that saved access token's lifetime. The application does not append an audit event for every successful refresh, so individual refresh timestamps and a complete per-exchange history cannot be reconstructed.

Only the **HTTP 400 plus `error: invalid_grant`** branch invokes `disconnect({id:'review-oauth-worker',role:'ADMIN'},'google')`. That actor/event is present at the failure timestamp, followed by the corresponding reconnect-required work error. Transport exceptions, HTTP 429, HTTP 5xx, `invalid_client` and `unauthorized_client` use different error paths and do not invoke this automatic destructive disconnect. The transport also has no disk response cache that could manufacture this branch.

This is strong code-and-audit evidence that Google rejected the refresh grant. The original HTTP body, `error_description`, `error_subtype` and Google request identifier were not retained; a particular user revocation, policy action or Google-side expiry cannot be conclusively attributed. `connection_error` is currently NULL because the full disconnect routine clears it. Provider `updated_at` still shows November 1 because this routine does not update that field; it is not evidence that the November 5 mutation did not occur.

## Probable cause

The grant was issued October 29 and first failed at the daily run seven days later, November 5. Access was successful on day six. Google documents a seven-day refresh-token expiry for external apps with publishing status **Testing**, except narrowly scoped identity-only grants; Wahi requests `business.manage`, which is outside that exception. This timing strongly fits that rule. Wahi does not store the Google OAuth consent-screen publishing status, and it was not inspected or changed during this investigation. Other Google-side invalidation remains possible. [Google's refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

The evidence does not support a deployment-time credential loss, encryption-key rotation, missing persistence volume, exhausted Wahi authorization deadline, or ordinary transient error misclassified as this disconnection.

## October 29 correction remains in effect

Migration `033_google_persistent_authorization.sql` removed the still-active November 28 deadline without reviving disabled or expired grants. Production audit retains the former deadline `2026-11-28T15:35:15.157+00:00`; current `connection_expires_at` is **NULL**, as it was in the November 1 backup. Installed migration checksums match the live manifest. Commit `0f564dc` is an ancestor of the current production release, and nullable-deadline semantics remain in the deployed guard/status code.

That change removed Wahi's arbitrary 30-day authorization expiry. It could not override Google's refresh-token lifecycle, consent publishing status or revocation policies. The October deployment report explicitly made that distinction. The previous application deadline was also weeks after this failure, so it cannot explain November 5.

## Credential persistence and unintended effects

Read-only decryption and comparison against the existing protected November 1 archive confirmed:

- The **same Google client ID and client secret** remain decryptable under the unchanged production key. Secret values were neither logged nor copied into the report.
- Google access/refresh tokens are now absent, connection generation increased from 11 to 12 and provider version from 8 to 9. The audit and deployed disconnect logic explain that deliberate invalidation; this is not unexplained persistence loss.
- The owner-confirmed business mapping was present in the November 1 baseline and is now absent.
- The OpenAI key was present in that baseline and is now absent. Its model, pricing and budgets remain unchanged. Both providers were disabled and their processing-rights status changed to unknown by the same Google disconnect routine.
- The explicit business-selection endpoint prevents changing identity when review records already exist. Recovery must preserve/recover the existing approved mapping safely, rather than resetting or reimporting the 565 records.

These changes predate this investigation. Nothing was restored, reenabled or reauthorized here.

## Recommended correction — not applied

1. Verify the OAuth app's audience/publishing status in Google Cloud. If it is external and in Testing, complete the appropriate production-publishing requirements before an owner-authorized new grant. Do not rotate the existing client merely to reconnect.
2. Separate automatic Google grant invalidation from explicit administrative disconnect. On a confirmed invalid grant, block Google ingestion and invalidate unusable Google token use while preserving the independent OpenAI credential/configuration, approved business mapping and historical data. Keep temporary failures recoverable without asking for new consent.
3. Record safe renewal/invalidation diagnostics: success/failure timestamp, endpoint category, HTTP status, allowlisted OAuth error/subtype and request identifier where available. Record the actual cause before invalidation; never log token values, client secrets or arbitrary response bodies.
4. Plan an explicitly approved, non-destructive recovery of the existing mapping and missing OpenAI credential, then owner-controlled Google consent if required. Revalidate the existing provider approvals and perform a bounded read/scheduled-sync check only when authorized. Keep historical analysis; no forced reprocessing or new model spending is required merely to repair authorization.
5. Deploy the independently verified warning-placement correction only after production deployment authorization. Backend invalidation changes require their own implementation, tests and review; they were not bundled into the UI fix.

## Preserved state and operational impact

The database still contains **565 review records and 440 analytical results**. Provider settings and those counts were identical before and after the investigation. No source record, analysis, credential, mapping, integration setting or scheduled task was changed by this work.

The schedule remains enabled at **10:00 AM America/Los_Angeles** for synchronization and automatic analysis. Its next saved occurrence is November 18, 2026, `18:00Z` / `10:00 PST`. **Scheduling is intact, but ingestion is blocked by the existing disconnected provider**; the last successful synchronization was November 4. This report does not claim ingestion has been restored.

Private raw audit/configuration evidence and read-only verification remain in the existing ignored runtime directory. No new database clone, backup destination, provider request, paid inference or production change was created.
