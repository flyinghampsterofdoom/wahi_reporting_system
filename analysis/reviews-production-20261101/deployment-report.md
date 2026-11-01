# Reviews Intelligence — production activation, November 1, 2026

Live: https://wahi-reporting-system.onrender.com/#reporting/reviews

Deployed code: `9d374accc2a3043031e958e511562ff36a5f6924` on Render. The owner explicitly approved deployment and live Google activation in this chat. Google Reviews remains Priority #2; Waste Tracking remains Priority #3 next.

The daily Google synchronization and automatic OpenAI analysis are enabled at **10:00 AM America/Los_Angeles**, with daylight saving transitions handled by the existing scheduler. The first scheduled occurrence after activation is November 1, 2026 at 10:00 AM PST / 18:00 UTC. Manual **Sync & Analyze Now**, separate historical cost preview, pause/resume, failure recovery, explicit full reanalysis and automatic dashboard refresh are live.

Verified production results:

- Google advertises **566 reviews** at approximately **4.4 stars**. Two complete API traversals returned the same **565 unique review IDs** over 12 pages. The dashboard distinguishes the listing total from retrievable coverage; no unavailable review was invented or treated as a deletion.
- All **440 text reviews** have stored `gpt-6-luna` assessments: 439 analyzable results and one insufficient-information abstention. The other **125 reviews are rating-only** and caused no AI call.
- Full-history reporting covers all **565 reviews**, with **100% text-processing coverage**, zero awaiting jobs and zero current classification failures. Reporting does not invent sentiment for rating-only or insufficient-information reviews.
- Independently revalidated all 440 stored results against the source: **2,518 topic observations** and **4,023 exact evidence quotes**. Structured feedback covers named dishes/drinks/staff, explicit compliments and complaints, customer suggestions and operational problems. These observations can overlap; validation is not a broad semantic accuracy benchmark.
- Total recorded estimated/reserved production cost: **$0.134220**, including initial diagnostics and failed attempts. Configured ceilings remain **$10/month** and **$0.05/request**. This is application accounting, not invoice reconciliation: settled usage estimates total $0.116614; five API-rejected schema attempts retain $0.017606 in conservative reservations because no usage was returned.

Verification and recovery:

- **791 regression tests passed**, zero failures. Tests cover daily Pacific scheduling across DST, durable/coalesced work, provider independence, historical recovery, budgets, roles, publication, source coverage discrepancies and renewable retention.
- Real OpenAI checks included representative synthetic feedback and quoted, multiline, Unicode/emoji content. The selected model was preserved.
- Final release checked through Playwright-managed headless Chromium on desktop, tablet and phone: dashboard and OpenAI settings, six views, zero page errors and no horizontal overflow. Production screenshots remain private.
- Live manual unchanged synchronization completed with **zero new reviews, zero updates, zero extra AI analysis**, unchanged budget usage, **565 source records and 565 versions**.
- Live pause/resume and recovery verified. The initial historical pass produced 431 valid assessments and nine rejected responses. Recovery resolved all nine while preserving the original 431 result IDs and attempt counts. Failed attempts remain in audit/spending history. Persistent name-to-passage mismatches used an audited recovery constraint citing the complete original review; evidence and name checks remained unchanged.
- The live dashboard refreshed after publication with **one document load**, no reload and no page errors.

The Responses request now constrains topics to active taxonomy IDs and cites trusted source passage IDs. The backend resolves those IDs to exact original text and UTF-16 offsets before validating the result. This avoids putting arbitrary customer punctuation/control characters into schema enums and prevents fabricated source quotes. Source and independently generated analytical records remain separate. Existing valid results were preserved through the transport improvement.

Preservation and rollback:

- Fresh full database backup restored with matching fingerprints across **128 tables**; 808 archive entries. The media archive restored and verified all **40 recorded files**.
- Additive migrations **034 and 035** rehearsed against the restored database; existing data preserved, repeat migration a no-op. Production migration checksums pass.
- All **99 checked business-data tables** remain unchanged. All **44 accounts**, credential hashes/generations and account fields remain unchanged except normal login timestamps.
- Existing Google OAuth client, refresh token, connection generation, persistent authorization and confirmed location mapping match the backup. No reconnection or encryption-key rotation occurred. Existing environment values and media storage were preserved; automatic deployment remains off. The connected deployment branch was advanced to the verified code.
- Compatibility rollback: `7aebf9edac554fb9e75b6f6148f01870a1813ba4`, branch `codex/reviews-rollback-20261101`. It includes the additive migration manifest and passes the upgraded schema check. Routine rollback does not drop tables or migration records; it stops content processing while preserving credentials/data.
- Source/evidence retention renews on successful daily observation without another AI call for unchanged text; outages still expire content. Current settings use 30-day renewable source/evidence retention and preserve stable deduplication identity and numerical aggregates. Source/provider activation records are valid through November 1, 2027 and enforced by the runtime.

Backups, credentials, customer review content, operator diagnostics and production screenshots are private ignored artifacts. None are included in this public repository. The local persistent preview and its saved credentials were preserved.

Implementation reference: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Schema adherence constrains output choices; source validation still determines what can be stored and published.
