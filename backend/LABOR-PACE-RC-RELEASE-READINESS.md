# Wahi Labor Pace — isolated release candidate

**READY FOR DEPLOYMENT**

Prepared September 28, 2026. This status applies to the isolated RC described here, not the original mixed workspace. No deploy, push, merge or production modification was performed. The earlier audit remains unchanged in the original workspace.

## Release identity

- Production baseline: `94098f45f07c433a6ecbc6f574dc689f00e493e6`.
- Branch: `codex/rc-wahi-labor-pace`.
- Worktree: `/Users/justinrawlinson/Desktop/Wahi_labor_pace_rc`.
- Structure: exactly one dedicated implementation commit directly on the baseline, containing this report. Its full SHA and immutable release range are recorded in the external [release identity](../../Wahi_labor_pace_rc_evidence/release-identity.json), generated after committing this report. Resolve locally with `git rev-parse codex/rc-wahi-labor-pace`.
- Exact diff: [release.diff](../../Wahi_labor_pace_rc_evidence/release.diff), generated from baseline to the committed RC.
- Read-only Render deployment inspection confirmed `dep-daq0prvavr4c73eiaofg` is live at the baseline SHA on service `srv-d6q3l46a2pns73bbs7v0`.

## Isolation and preservation

The worktree was created directly from the full production SHA, without merging the mixed branch. Labor-specific patches were applied to six existing source/test files; shared asset-registration and migration-test lines were edited directly in their production versions. Three existing feature files were added unchanged from the reviewed implementation, and a production-schema migration rehearsal test was added for this RC.

All 174 other production-tracked files are byte-identical to the baseline. In particular, the account implementation/UI, existing SQL migrations, BOH waste service/UI, and production Drink regression tests were compared against baseline bytes. The nine existing-file diffs were inspected for Labor Pace scope. The RC contains no account-deletion code, no 021 migration, no older BOH files, no unrelated formatting or refactoring, and no private fixtures or generated output in the commit.

The original mixed workspace's 233 tracked/untracked nonignored file hashes were captured before work and verified afterward. Its files and earlier reports were not changed. Creating the new branch/worktree changes shared Git metadata only.

## Exact files in this release

| File | Reason |
| --- | --- |
| `backend/labor/model.js` | Independent department pace and summed-hour Overall calculation |
| `backend/labor/service.js` | Daily inputs in existing target revisions; current-week pace projection |
| `backend/migrations/023_labor_daily_allotments.sql` | Add nullable daily-allotment columns only |
| `backend/review/public/labor-allotments.js` | Shared exact decimal reconciliation and weekday labels |
| `backend/review/public/labor-ui.js` | Existing cards and Admin settings display/validation |
| `backend/review/public/leadership-summary.js` | Canonical current-week pace summaries |
| `backend/review/public/index.html` | Load shared validation asset |
| `backend/review/server.js` | Register that asset; no other server change |
| `backend/test/labor-pace.test.js` | Calculation, boundary, validation and UI coverage |
| `backend/test/labor.test.js` | Persistence, historical, HTTP/UI-handler and restart coverage |
| `backend/test/labor-release-migration.test.js` | Disposable production-schema upgrade rehearsal |
| `backend/test/postgres.test.js` | Add only 023 to the existing migration expectation |
| `backend/test/reports.test.js` | Pace summary and asset regression expectations |
| `backend/LABOR-PACE-RC-RELEASE-READINESS.md` | This requested release report |

## Migration graph and rehearsal

Baseline schema files are **001–020, 022**; head before release is `022_waste_log.sql`. The RC adds only **023_labor_daily_allotments.sql**; head after release is **023**. The 021 gap is legitimate: the production runner sorts and runs existing migration files and does not require contiguous identifiers. It already supports the production gap.

023 depends on `labor_standing_targets` from 011, not on 021. It adds nullable `foh_daily` and `boh_daily` JSONB columns. No prior SQL was rewritten or renumbered. No UPDATE, allocation default, redistribution, or equal seven-day division occurs. Weekly targets and their revisions are preserved; existing daily values are SQL NULL immediately after migration.

The new rehearsal builds a disposable PostgreSQL database by running the baseline's unchanged SQL files and recording their actual checksums, then seeds weekly targets and synchronized labor dates. The actual RC migration runner applies exactly `['023_labor_daily_allotments.sql']`. It preserves target rows and all baseline ledger entries; schema readiness succeeds, a second migrate is a no-op, and `users.deleted_at` remains absent. The service safely reports missing pace with existing weekly context. Valid daily configuration persists through a new service instance and produces the Tuesday denominators 32 FOH, 60 BOH and 92 Overall.

No production database was connected to or altered. The graph above is the actual verified production commit's migration graph, not a fresh read of the live database ledger. A future deployment should compare live ledger checksums with this exact artifact as its normal preflight.

## Labor Pace behavior retained

For each department independently:

`pace % = observed classified actual hours since Sunday / sum(configured daily allotments Sunday through current business day, inclusive) × 100`

There is no time-of-day prorating. The entire current day's allocation enters at the configured business-day boundary. The Tuesday example is tested: 10 + 10 + 12 = 32, with actual 16 yielding 50.0%; 20 yields 62.5%; 32 yields 100.0%; 36 yields 112.5%.

Overall adds department actual hours and department cumulative allotments, then divides; it never averages their percentages. Daily configuration must contain all seven nonnegative values and exactly equal its weekly target. Validation uses exact decimal arithmetic, not a tolerance. Missing, partial, below-target and above-target configurations suppress that department's pace and Overall. A valid other department remains usable. Weekly-target changes revalidate retained allocations. A valid zero cumulative allotment has an undefined percentage and explicit zero-hours wording, without division by zero.

Admin settings immediately shows each daily total, weekly target, and signed difference. Invalid or incomplete inputs can be saved as visibly invalid configuration, with warnings; they cannot enable a misleading pace. The three dashboard cards retain weekly targets, actuals and remaining/over weekly hours. Copied and scheduled-report summaries use the same projection.

Historical full weeks retain their original weekly-target comparisons. Partial/non-full-week custom ranges remain actual-only; selecting exactly the current full week by custom dates uses current-week pace. Daily revisions follow the existing effective-week target policy and do not reinterpret completed periods as current pace.

Restaurant timezone, closeout hour, Sunday–Saturday boundaries, Toast classification, exclusions, unassigned/deleted entries, unresolved entries, unpaid breaks, and provisional open-shift semantics remain unchanged. Actuals stop at their saved Toast observation. Existing five-minute refresh, one-minute throttle, stale warnings and date-coverage requirements remain: a newly started day needs synchronization before actuals can be presented.

## Test results

All final runs were from the isolated RC, not the mixed source workspace:

| Command | Result |
| --- | --- |
| `npm --prefix backend test` | **597 passed, 0 failed, 0 skipped** |
| `node --test backend/test/labor-pace.test.js backend/test/labor.test.js backend/test/reports.test.js backend/test/labor-release-migration.test.js` | **135 passed, 0 failed, 0 skipped** |
| `node --test backend/test/waste-drink-http.test.js backend/test/waste.test.js backend/test/postgres.test.js` | **59 passed, 0 failed, 0 skipped** |
| Production-schema migration rehearsal | Passed in both full and focused suites; only 023 applied |
| `git diff --check` | Passed |

The 59-test regression run includes three explicit Drink scenarios: HTTP search/common controls and rejected direct submissions; in-memory category/cached common controls/Admin preview and retained history; and PostgreSQL historical/effective-category behavior. These production tests and their implementation were not edited.

Labor tests cover exact, under/over, missing/partial configuration, both valid/invalid department combinations, weighted Overall, >100%, full current-day allocation, daily/weekly rollover, timezone/DST/closeout, save/restart/reload and historical behavior. The release-readiness integration test executes the real UI handlers through an authenticated local HTTP API and restarts the server against disposable PostgreSQL. UI DOM/FormData are simulated; this is not a manual visual-browser inspection.

The initial complete run in the clean worktree failed because two deliberately gitignored legacy workbook fixtures were absent. They were copied read-only from the existing local fixture source into the ignored test directory; no fixture contents enter the commit. A narrow Drink-only PostgreSQL test selection also failed because it omitted that suite's initial migration test; running the complete PostgreSQL suite resolved the setup dependency. Neither required application changes. Dependencies were installed locally from lockfiles. Complete final logs are retained outside the release tree in [the evidence directory](../../Wahi_labor_pace_rc_evidence/). Test counts differ from the mixed workspace because unrelated account-deletion tests are excluded, production Drink tests are retained, and this RC adds a migration rehearsal.

## Post-deployment Admin activation

Immediately after migration, existing weekly targets remain, actuals and weekly comparisons remain usable, and current-week Labor Pace is explicitly unavailable until daily allotments are configured. No production values are invented by this RC.

1. Admin opens **Time Management → Settings**.
2. Confirm the existing FOH weekly target and enter Sunday, Monday, Tuesday, Wednesday, Thursday, Friday and Saturday FOH hours.
3. Repeat for BOH independently. Use the intended operational allotments; do not assume equal distribution.
4. Confirm both daily totals exactly equal their weekly targets, both differences are zero, and both statuses are Valid.
5. Select **Save targets**. Reload Settings and verify all 14 inputs and weekly targets persisted.
6. Open **This Week**, refresh Toast if needed, and verify FOH, BOH and Overall pace against actual hours and the cumulative allotments through today's business date.

## Controlled deployment and acceptance

No push is required to prepare this local RC, so none was performed. A later authorized deployment should first recheck live baseline and migration ledger, verify a database backup, and approve this exact one-commit range. Retain the established deployment configuration. Run the explicit pre-deploy migration from this RC before starting its application; only 023 should be pending. Verify schema readiness, health and authentication before Admin configuration.

Acceptance: verify initial missing-configuration wording; all daily fields and save/reload; independent FOH/BOH percentages and summed-hour Overall; weekly context; under/on/over pace; copied summary; Last Week and partial custom range; excluded/unassigned/open-shift detail; configured closeout and the next Sunday reset. Recheck BOH Drink search/common exclusion and direct submission rejection, plus unchanged account access. No test waste event or invented labor allocation needs to be submitted to production merely to prepare this RC.

## Rollback considerations

The repository supports forward, checksummed migrations, not automatic down migrations. 023 is additive and keeps old weekly fields, but the startup schema checker requires an exact manifest match. **Do not simply redeploy 94098f4 after applying 023:** its migration manifest lacks 023 and startup validation will fail.

Before deploying, prepare a compatibility rollback artifact based on the baseline application while retaining 023 and its ledger recognition; it may leave daily data unused while restoring prior labor presentation. Retain saved daily inputs and audit evidence. Do not delete ledger rows or drop columns as an improvised rollback. A full database restore would require an explicitly approved outage/data-loss decision and a verified backup. No rollback artifact or production action was executed as part of this local RC preparation.
