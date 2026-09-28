# Wahi derived labor targets — corrected release candidate

**READY FOR DEPLOYMENT — not deployed or pushed.** Audited September 28, 2026.

## Release lineage

Worktree: `/Users/justinrawlinson/Desktop/Wahi_derived_labor_rc`.
Branch: `codex/rc-wahi-derived-labor-targets`.
Original production baseline: `94098f45f07c433a6ecbc6f574dc689f00e493e6`.
Actual current production/shared RC: `c2ec81f700841e047d60610967d31503fddbb871`.

Read-only Render inspection found c2ec81f already live as deployment `dep-datcnslg1s2s738sfno0` on service `srv-d6q3l46a2pns73bbs7v0`; both remote deployment and original RC branches also resolve to c2ec81f. Therefore this candidate appends one correction commit rather than rewriting shared/deployed history. It remains descended from 94098f45. The old RC is superseded as the recommended release candidate, but remains live until a separately authorized deployment. No deployment or production configuration write was performed for this correction.

The commit containing this report is the resulting RC. Its immutable SHA and exact current-production and original-baseline release ranges are recorded after commit in [release-identity.json](../../Wahi_derived_labor_rc_evidence/release-identity.json). The [previous readiness report](LABOR-PACE-RC-RELEASE-READINESS.md) is unchanged historical evidence; its reconciliation description does not describe this corrected candidate.

## Implementation and persistence

Each department's seven Sunday–Saturday daily decimal strings are authoritative. Weekly target is their exact sum. The shared validator uses integer decimal units, avoiding floating-point reconciliation errors. Settings displays the one-decimal read-only total immediately on input; the example 20+15+15+18+20+27+35 displays 150.0, then Wednesday 22 displays 154.0. There are no editable weekly fields or daily-versus-weekly difference/mismatch checks.

New target requests accept only both seven-day arrays and the optimistic revision ID. Manual weekly fields, missing/partial arrays, negative or invalid values are rejected. Explicit 0 is valid; blank, null, missing and sparse values are incomplete. All-zero weeks are valid configuration, with an undefined percentage when the cumulative denominator is zero; hours and variance remain visible. No values are distributed or invented.

The existing single Save targets action requires complete arrays for both departments. Their calculations are independent; incomplete unsaved edits do not overwrite the last saved configuration. A single append-only target revision stores both arrays and their server-derived weekly snapshots in one SQL INSERT inside the existing advisory-locked transaction, together with audit events. Audit failure rolls back everything; revision conflicts reject stale writers. Reload reproduces the arrays and totals. The API cannot accept an independently edited weekly value.

Current/future full-week reads derive weekly totals from any complete existing daily arrays, so a pre-correction stored weekly value cannot override them. Missing daily arrays retain the stored weekly value only as legacy context; Labor Pace for that department and Overall is unavailable. Raw history is not rewritten. Past full weeks continue resolving stored effective-week snapshots, and partial/custom non-full-week ranges remain actuals only. New saved totals are historical snapshots for later reports; today's configuration cannot redefine completed weeks.

## Pace and preserved behavior

For each department: actual classified Toast hours Sunday through the present synchronization divided by the sum of configured Sunday-through-current-business-day allotments, multiplied by 100. The entire current day enters at the existing restaurant business-day boundary; there is no time-of-day prorating. Overall divides summed FOH/BOH actual hours by summed FOH/BOH cumulative allotted hours. Overall weekly target likewise sums the derived department weekly totals.

Existing restaurant timezone, 4:00 closeout, Sunday week start, Toast synchronization, open-shift estimates, exclusions, Unassigned handling and historical actuals are preserved. The three dashboard cards and weekly remaining-hour context remain in place. BOH Drink exclusion is unchanged.

## Migration and initial state

No schema change or new migration is required from live c2ec81f: it already includes 023 and nullable daily JSONB columns. Existing weekly numeric columns remain necessary for historical snapshots. No rows or columns are removed or rewritten. Existing weekly-only production targets survive, daily arrays remain NULL, and Labor Pace requires configuration until Admin saves intended days. No equal distribution occurs.

The migration regression also rehearses original baseline 001–020,022 to 023, proves prior targets/ledger preserved and no account-deletion migration, then proves migration rerun is a no-op. This is cumulative-release evidence; the correction itself has no pending SQL migration.

## Files changed by correction

- `backend/labor/model.js`: current derived weekly projection and daily-only pace validation.
- `backend/labor/service.js`: strict daily-only input, atomic derived persistence, current-versus-historical target selection.
- `backend/review/public/labor-allotments.js`: exact sum and completeness validation without reconciliation.
- `backend/review/public/labor-ui.js`: read-only live weekly totals, required daily fields, incomplete feedback and daily-only save payload.
- `backend/review/public/leadership-summary.js`: corrected unavailable-configuration wording.
- `backend/test/labor-pace.test.js`: calculation, immediate UI, independence, explicit zero, missing and exact-sum coverage.
- `backend/test/labor.test.js`: strict API, derived persistence/reload, atomic rollback, legacy/current/history and partial-configuration tests.
- `backend/test/labor-release-migration.test.js`: derived-only save in preserved migration rehearsal.
- `backend/DERIVED-LABOR-TARGETS-RC-READINESS.md`: this audit.

All other tracked implementation files were byte-compared to c2ec81f. Migrations, server, auth/account, Toast synchronization, waste code and existing Drink tests are unchanged. No code from the mixed development workspace was merged; private fixtures, dependencies, browser harness and generated output are excluded from the commit. Scope details are in [scope-audit.json](../../Wahi_derived_labor_rc_evidence/scope-audit.json).

## Verification results

| Check | Result |
| --- | --- |
| `npm --prefix backend test` | 603 passed, 0 failed, 0 skipped |
| `node --test backend/test/labor-pace.test.js backend/test/labor.test.js backend/test/reports.test.js backend/test/labor-release-migration.test.js` | 141 passed, 0 failed, 0 skipped |
| `node --test backend/test/waste-drink-http.test.js backend/test/waste.test.js backend/test/postgres.test.js` | 59 passed, 0 failed, 0 skipped |
| Local Chrome + real HTTP/PostgreSQL acceptance | Passed; zero frontend errors |
| `git diff --check` | Passed |

Focused coverage includes beginning-of-day zero new actuals, midday accumulation, exactly/over 100%, summed Overall, new day/week and DST closeout, incomplete/invalid arrays, explicit/all-zero days, exact decimal sums, independent departments, manual-total rejection, save/reload and process restart, stale writers and rollback, existing weekly-only initial state, current daily sums superseding old totals, historical effective-week targets, custom actuals-only ranges, Toast open shifts/exclusions/unassigned and summaries. Full and dedicated Drink suites verify exclusion remains intact.

Browser acceptance used synthetic local data only: verified no editable weekly targets; FOH 150.0→154.0 immediately while BOH stays 100.0; blank versus explicit zero; save/reload; FOH 16/35, BOH 15/10 and Overall 31/45=68.9%. Screenshots were visually reviewed and preserve the existing layout. Logs and screenshots are in [release evidence](../../Wahi_derived_labor_rc_evidence/). Earlier browser harness setup failures (overlong local socket path, then navigation without reloading authenticated state) were fixed in the local harness; final browser acceptance passed without product changes.

## Operational considerations

No implementation blocker remains. Admin must enter intended daily values; old weekly targets are never used to fabricate them. An already-open old Settings page may submit the obsolete weekly fields and receive validation failure; reload the page after eventual deployment. The save unit remains both departments together, although their sums and pace calculations are independent. A rollback to c2ec81f is schema-compatible but restores the obsolete editable-weekly workflow, so this corrected candidate should be used for the next release. No deployment is included in this task.
