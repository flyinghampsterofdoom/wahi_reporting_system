# Waste Tracking — owner review

**Production update:** Waste Tracking was subsequently authorized, deployed and verified. See the [production deployment report](../waste-production-20261101/deployment-report.md). The notes below preserve the original pre-deployment review.

Implemented on `codex/waste-tracking`, based on `c31fd71`. **Ready for owner review; not deployed.** All screenshots and preview records are synthetic. The original workspace and deployed Reviews integration were not changed.

## Try the employee experience

Open [Waste Log](http://127.0.0.1:4321/#waste). Private sign-in details are in `/tmp/wahi-waste-preview-20261101/ACCESS.md`; passwords are deliberately excluded from this repository.

- Sign in as **ari** (Staff) for the bar/floor workflow or **mo.boh** (BOH) for the kitchen workflow.
- Tap a common item, adjust quantity/unit, tap a reason, and record. Notes are optional. The confirmation offers Undo for 30 seconds.
- Search for **Mai Tai**, **Pineapple juice**, **Huli huli sauce**, **Double pork bowl**, and **Seasonal special** to see drinks, fluid ounces, preparation outputs, mapped menu servings, and explicit unknown costs.
- Sign in as **manager** to open [Dashboard](http://127.0.0.1:4321/#waste/dashboard) or [History](http://127.0.0.1:4321/#waste/history). Open an event to inspect the original and any correction, then try a correction with a reason.

The preview uses a persistent, isolated PostgreSQL fixture. Browser reloads and server restarts retain its accounts, records and audit history. Start/restart it from the worktree with `node backend/waste/preview.cjs`; it requires local PostgreSQL 16 at the documented Homebrew path and listens only on loopback. No production URLs, integration secrets, Google calls, OpenAI calls, or scheduled workers are used. Do not start a second copy while port 4321 is occupied.

[Open the screenshot gallery](handoff.html).

## Delivered behavior

Employee entry includes live catalog search, six common items ranked by event count over a rolling 90 days, item-specific units, all seven standardized reasons, optional notes, authenticated attribution and a server timestamp. A pending submission survives reload and can be retried with its original request ID. Double taps and retries cannot create a second event.

Ingredients, recipe outputs and menu items retain their existing identities. Mapped menu items honor the existing portion mapping; unmapped menus can be recorded with unknown cost. The established BOH Drink-category restriction is retained; FOH includes bar items. Ordinary employees cannot access management reporting or historical corrections.

Management receives searchable and filterable history, sorting across the full result before pagination, event details, append-only manager corrections and voids, and original values preserved in audit history. Historical legacy reasons remain recognizable rather than being reassigned to a new label.

Costs use the existing exact costing and conversion engine, captured at entry. Subsequent ingredient price changes cannot recost earlier events. Quantity corrections retain the frozen cost basis; unit changes reconstruct costs known at the original recording time. Unknown costs remain explicit. Reports separate frequency, quantities/units and cost/currencies. The dashboard includes trend, category, reason, employee and FOH/BOH breakdowns, most frequent and highest-cost items, recent events and descriptive changes versus the preceding equal period. Changes are a count comparison, not a statistical significance claim.

Waste does not adjust inventory, add AI, create Kashew integration, or introduce a separate FOH database. Individual attribution follows the signed-in Wahi account; a shared account records that shared identity, so personal attribution requires named accounts.

## Verification

- **806 regression tests passed**, zero failures or skips, including real PostgreSQL persistence, immutable history, concurrent correction/retry conflicts and the complete existing Wahi suite. The established private workbook-derived test fixtures are required locally and remain excluded from the public repository.
- An upgrade test installs the exact schema through migration 035, then applies 036/037 twice safely. It confirms original waste rows, user records, credential records and the Reviews automation row are preserved, including its 10:00 daily setting. Legacy reason and frozen-cost correction behavior are verified.
- **15 layout views** across desktop 1440×1000, tablet 820×1180 and phone 390×844: no browser errors or horizontal page overflow.
- **Five end-to-end browser workflows passed:** touch double tap and audited Undo with stable keyboard focus; lost committed response followed by reload/retry; fractional manager correction retaining employee/original costs/audit; whole-result sorting and next-page navigation; unmapped menu with unknown cost.
- **15 accessibility checks** across log, entry, history, correction dialog and dashboard: zero axe WCAG A/AA violations in the Waste content. This supplements visual and keyboard checks; it is not a complete accessibility certification.
- Synthetic domain benchmark with **1,000 catalog items and 5,000 events**: catalog 35–49 ms, sorted history 55–70 ms, 30-day dashboard 59–70 ms across five local runs. This in-memory measurement excludes HTTP/database latency and is not a hosted performance guarantee. One local browser submission confirmed in 36 ms.

Machine-readable evidence: [verification](verification.json), [layouts](browser-initial.json), [workflows](workflow-browser.json), [accessibility](accessibility.json), [performance](performance.json).

## Production release plan — approval pending

The owner brief requires review before Waste deployment. Prior Google Reviews deployment approval does not authorize this separate release. No production deployment, migration, account change, provider configuration change or schedule change has occurred for Waste.

After owner approval:

1. Confirm the approved release commit and existing Render service/database identity. Take the established database backup and retain the runtime encryption-key backup separately. Capture baseline waste/account counts and Reviews automation settings without exposing secrets.
2. Use the existing `backend/deploy/README.md` deployment flow. Apply only additive migrations **036_waste_history.sql** and **037_waste_menu_items.sql** using the configured pre-deploy migration command. Do not import or reset production data, edit prior migration checksums, change provider settings, or change the Reviews schedule.
3. Verify health, named-user login and role boundaries, catalog search/units, one authorized waste entry and Undo, management history/dashboard, correction audit and frozen costs. Check pre-existing data, integrations and the Reviews 10:00 America/Los_Angeles automation row against the baseline.
4. Retain the release evidence and update CORE with actual deployed commit and post-deploy checks. If release verification fails, stop further writes and follow the existing backup/recovery procedure. Do not delete append-only events/revisions or attempt an improvised destructive down-migration. A restore requires a coordinated maintenance window and explicit handling of writes since backup.

No remaining implementation decisions are required for local review. Production release approval and post-deploy verification remain outstanding.
