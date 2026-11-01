# Reviews Intelligence Phase 2 — verified production release

Production: https://wahi-reporting-system.onrender.com/reviews/knowledge

Render deployment **`dep-dbjs94rbc2fs73dnrqkg`** serves **`56074c6cd0e753158dc21c715e3c55a228a39a5b`**, live November 1, 2026 at 23:02:25 UTC. The owner explicitly approved production deployment after reviewing the working preview. Health returns HTTP 200 and all three knowledge-page assets match the tested source. The connected deployment branch points to this verified code; automatic deployment remains off.

## Released behavior

The standard Reviews entry opens the improved knowledge dashboard using existing Wahi authentication and Admin/Manager permissions. The existing review explorer, synchronization and processing controls remain accessible through **Review explorer & sync**.

Compact strengths and concerns, hierarchy-aware unique-review support, explicit aspect sentiment, cautious pattern labels, normalized comparisons, supporting review navigation, item context and conservative staff recognition are live. Comparisons distinguish observations from established trends and label serious individual allegations as unverified feedback requiring human review. No new taxonomy, identity mapping, chat interface or autonomous operational action was added.

The audit covers all 30 reviews in the approved 90-day window: 21 text reviews and nine rating-only records. Thirty immutable approval records preserve the judgments; four cases have targeted observation corrections. Corrections are a version- and result-hash-guarded read overlay, not an overwrite of original customer feedback, AI results, publication history or metrics. Original and owner-approved interpretations are selectable, and original AI observations remain available in review details. Repeated approval is idempotent; a different payload for the same batch or a changed source/result is rejected.

The dashboard evidence correction aligns supporting quotes with topic hierarchy and polarity, retaining balanced support and removing the opposite-polarity fallback. Topic charts now use proportional SVG widths under the existing strict content policy. Dates use Pacific posting days.

## Tests

- **829 regression tests passed**, zero failed or skipped. Eight new hosted-interpretation tests cover exact overlays, immutable history and source expiry, changed-version isolation, roles, atomic validation, retries and normal authenticated HTTP routes. Tests use isolated synthetic databases.
- **21 live desktop/tablet/phone views passed** across 30/90/365-day summaries, evidence, audit, review detail and knowledge status. There were zero page errors, content-policy errors, horizontal overflow or scoped axe WCAG A/AA violations. These automated checks supplement visual/keyboard review and are not a full manual accessibility certification. Browser automation used headless Playwright-managed Chromium and disposable contexts.
- **Six live workflows passed:** five negative Food Quality citations; prior-period citations/date scope; four approved corrections with original results retained; complete audit filters; standard-navigation redirect and classic explorer with proportional bars; disabled optional synthesis and unchanged configured limits.
- Independently checked positive and negative evidence membership in each preset. Current windows contain **10 / 30 / 119 reviews** for 30 days / 90 days / 12 months respectively. All checked praise quotes are positive, all concern quotes are negative, and all belong to the selected period. Full retained history remains 565 reviews and 440 text assessments; the reporting windows intentionally contain smaller populations.
- **Five live role checks passed:** Manager can read the dashboard/audit/source/status but cannot approve corrections or activate synthesis; Staff, Lead, BOH and RecipeOnly are denied management review data. All five temporary named verification accounts were disabled and sessions revoked. No existing employee account was impersonated or reconfigured. No operational Waste or inventory test entries were added in this release.

## Backup and recovery

A fresh pre-deployment custom-format PostgreSQL backup was created at **2026-11-01T22:45:21Z** and restored into an isolated local cluster. All **131 original tables** had identical row fingerprints, with 835 archive entries. The 12,867,697-byte archive has SHA-256 `a1cf226eee0f8ad1f652622ff1c26a54267586c3ec91c34a563572a789f6a60f`.

The media archive restored all **40 database-recorded media objects**. All **120 underlying production media files** still match the restored archive byte for byte. Database/media archives and recovery metadata have verified protected copies outside the repository; the production integration encryption key is stored separately. Customer text, review identifiers, credentials, dumps and production screenshots remain private.

Only additive migration **038_review_interpretations.sql** was applied by the existing pre-deploy process. It adds immutable interpretation metadata and a read projection; migrations 001–037 are unchanged. Migration and all 30 approvals were rehearsed against the fresh restored database. Original source/results/publication data remained unchanged, repeat migration was a no-op, and production schema checksums pass. Assessment text is erased by the existing retention worker when its source/result expires; expired source evidence is not exposed.

Compatibility recovery commit **`c4a3310`**, pushed on **`codex/reviews-knowledge-rollback-20261101`**, preserves the previous production runtime plus the additive migration manifest and assessment-retention cleanup. It passed schema validation, owner login and existing Waste, Recipes and Reviews access on the upgraded restored database. No rollback or destructive restore was needed or executed. In an incident, preserve and reconcile writes/audit since backup, retain the encryption key and use the established recovery procedure; do not improvise a down-migration or remove immutable history.

## Preservation and synthesis status

All **131 original tables** were compared after deployment: **124 retained identical fingerprints**. The remaining seven contain only the new migration ledger entry, approved-interpretation/normal retention audit appends, normal authentication counters/owner login time and the five disabled verification accounts with their setup/security records. All original review audit rows are unchanged.

All **49 original user profiles and credentials** remain unchanged apart from normal owner last-login time. Original setup-token and security-audit records are preserved. Existing operational data, Waste history, recipe data and media are unchanged.

All **565 synchronized reviews**, **440 original AI results**, source versions, historical releases, membership/metrics, provider settings, Google OAuth credentials/mapping, OpenAI credentials/model/pricing/budgets, processing attempts, work requests and spending reservations retained identical fingerprints. All 11 environment values are unchanged. Workflow reports **440 analyzed, zero awaiting and zero failed**. No Google reconnect, key rotation, model probe, historical reprocessing or new paid job occurred.

Daily Google synchronization and automatic individual-review analysis remain enabled at **10:00 AM America/Los_Angeles**. The automation row is unchanged; next due is **November 2, 2026 at 10:00 AM PST / 18:00 UTC**.

**Deterministic knowledge reporting is active. Optional 90-day OpenAI synthesis remains disabled.** Its status page has read-only estimates and no activation control; unsupported synthesis writes are denied. This deployment made **zero additional OpenAI calls and incurred $0 additional processing spend**. Existing per-request/monthly limits and individual-review processing remain intact. Separate authorization and implementation validation would be needed for paid synthesis activation.

**Outstanding deployment or data-integrity issues: none.** The original dirty workspace and existing owner previews are preserved. Verified release results are recorded in CORE as a collaborative project note.

Machine-readable evidence: [verification.json](verification.json). Earlier audit/design report: [OWNER-REVIEW.md](../reviews-knowledge-20261101/OWNER-REVIEW.md).
