# Waste Tracking — verified production deployment

Production: https://wahi-reporting-system.onrender.com/#waste

Deployment **`dep-dbjpltcs728c738fjmmg`**, code **`dc13c034714563b671a0bc45fb5f9d063e6efcbf`**, November 1, 2026. The owner explicitly authorized Priority #3 Waste Tracking production deployment in this chat. Render reports the pinned release live, health returns HTTP 200, and the deployed Waste JavaScript/CSS match the tested files exactly. The connected deployment branch now points to this verified code; automatic deployment remains off.

## Release and verification

Employee entry, FOH/BOH catalog search, item-specific units, quantities, seven reasons, optional notes, authenticated attribution, frozen cost snapshots and the 30-second Undo are live. Management history, filters, full-result numeric sorting, auditable corrections/voids and dashboards are live.

- **806 regression tests passed**, zero failures or skips, on the final code. The suite uses isolated PostgreSQL/fixture data rather than destructive tests against production.
- **Six live workflow checks passed:** touch entry/double-tap/Undo; authenticated identity/server timestamp/actual 30-second expiry; manager correction and frozen original cost; history filters/sorting; durable retry without another event; audited void and restored operational totals.
- **Five additional live role checks passed** using temporary named Staff, Lead, BOH, Manager and RecipeOnly accounts. Staff/Lead/BOH could log and Undo their own events but could not read management reporting, correct history or administer users. Manager could report and correct, with no user-administration access. RecipeOnly could not access Waste. Invalid quantities and forged attribution were rejected. All five temporary accounts were disabled and their sessions revoked afterward; no existing employee was impersonated or reconfigured.
- **21 live views** checked on desktop 1440×1000, tablet 820×1180 and phone 390×844, including Waste log/entry/history/detail/dashboard and existing Reviews/OpenAI settings. No browser errors or horizontal page overflow. Playwright-managed headless Chromium and disposable contexts were used throughout.
- **15 Waste accessibility checks** passed with zero axe WCAG A/AA violations in the main Waste content and event dialog. This supplements visual and keyboard checks rather than constituting a complete manual certification.
- Live production had no operational waste entries before release. Six clearly marked verification entries remain auditable and are all voided/undone. Their eight revisions and fourteen domain-audit entries are retained. Active operational waste and estimated-cost totals returned to zero. No inventory adjustment occurred.

Live smoke testing found a correction-form readiness race: Save could be used before the catalog response installed its handler. The initial attempt wrote no correction. The final release disables Save and immediately prevents native submission until initialization completes. A deliberately delayed catalog and early Enter key reproduced the original condition and verified the fix, followed by an actual successful correction. All 806 tests were rerun successfully after this narrowly scoped fix. Ingredient prices were not changed for production testing; price-change isolation is covered by regression, and the live quantity correction retained the exact original unit cost, references, timestamp and employee.

## Backup, migration and recovery

A fresh pre-deployment custom-format PostgreSQL backup was created at **2026-11-01T19:52:18Z**. It restored successfully into an isolated local PostgreSQL cluster, with matching fingerprints across **130 tables** and **824 archive entries**. The 12,849,133-byte archive has SHA-256 `484df88bae6573b4bb9e981090026cbf71b9b9776ba4d2263674a010b45f61a0`.

The separate media backup restored and verified all **40 database-recorded media objects**. After deployment, all **120 underlying media files** still matched the restored archive byte for byte. Protected copies of the database/media archives and recovery metadata are retained outside the repository; the runtime encryption-key backup is stored separately. Copy checksums were verified. Credentials, backups, customer content and production screenshots are not published.

Only migrations **036_waste_history.sql** and **037_waste_menu_items.sql** were applied by the established pre-deploy process. Both were rehearsed against the fresh restored production database, preserved all 129 pre-existing data tables, passed schema/checksum validation, and repeated as a no-op. No import/reset, prior migration edit or destructive down-migration occurred.

Compatibility rollback **`fd5daa9`**, branch **`codex/waste-rollback-20261101`**, is pushed and ready. It preserves the preceding Reviews runtime plus the new migration manifest, and pauses Waste endpoints with HTTP 503 during recovery. Against the restored upgraded database it passed schema checks, owner authentication and published-recipe access. No rollback was needed or executed. A full database restore remains a coordinated recovery operation: preserve/reconcile writes and audit records since the backup, retain the existing encryption key, and follow the established deployment/recovery procedure. Do not delete append-only records or improvise a down-migration.

## Existing data and integrations

Final comparison checked all **129 original data tables**. **120 retained identical row fingerprints**. The other nine reflect only documented verification records, new disabled test accounts, normal authentication counters/sessions/owner login time, and the existing Reviews retention worker's append-only audit events. All original audit rows remain unchanged.

All **44 original user profiles and credential records** are preserved, apart from the owner's normal last-login timestamp. Five additional disabled verification accounts and their security/setup audit remain intentionally auditable. Original setup-token and security-audit records were also checked unchanged. Existing employee activation/onboarding remains owner-managed through Users & Access.

All existing environment values, encrypted integration settings, Google OAuth credentials/confirmed mapping/authorization, OpenAI configuration, review records/results and recorded spending were preserved. Google Reviews code was unchanged. The integration remained readable in all three viewports and continued to report **440 analyzed reviews, zero awaiting and zero failed**.

Daily Google synchronization and automatic OpenAI analysis remain enabled at **10:00 AM America/Los_Angeles**. The existing automation row matched the backup. Its November 1 scheduled run succeeded at 10:00 AM Pacific, before this deployment, and the next occurrence remains **November 2, 2026, 10:00 AM PST / 18:00 UTC**. No provider reconnect, key rotation, model test call, reanalysis or schedule change was performed for Waste deployment.

**Outstanding deployment or data-integrity issues: none.** Original dirty workspace and persistent local previews were preserved. Verified deployment status is recorded in CORE; roadmap order remains unchanged.

Machine-readable results: [verification.json](verification.json). The earlier [synthetic owner-review pack](../waste-20261101/README.md) remains available as implementation/UI evidence.
