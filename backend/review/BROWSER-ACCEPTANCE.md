# Browser acceptance — September 18, 2026

Executed through the browser against the real local PostgreSQL-backed app, not static
mockups. These checks supplement the automated Node HTTP/service/PostgreSQL suite.

Passed:

- Staff login shows operational navigation without management/history/cost controls.
- Start Demo Bar, retain the chosen physical observation time, and see ordered items.
- Enter 22 bottles, Save & next, enter 14 limes, Save & next, skip garnish.
- Review explicitly shows the missing garnish; submit successfully. The submitted Staff
  sheet has no correction controls or protected audit payload.
- Log in as Manager; open that submitted sheet and correct 22 to 2.2 with a reason.
  Effective quantity changes, and revision count increases from two to three observations.
- Restart the review HTTP server and private PostgreSQL cluster without data loss.
  Login is required again as intended for in-memory sessions.
- Log in as Owner; inventory shows 2.2 + 6 + 12 = 20.2 bottles and individual timestamps,
  ages, location breakdown and the warning that observations were made at different times.
- Owner catalog costing: 1.5 US fl oz of the synthetic 750 mL/$18 rum package returns
  1.06464706425 USD from the validated backend, with distinct material/labor subtotals.
- Location/assignment management controls are visible to Owner.
- At a 768 × 1024 tablet viewport, inventory and count entry have usable controls and no
  page-width overflow. The navigation strip scrolls when necessary. Quantity entry is large
  and uses a decimal input mode, rather than a spreadsheet-style grid.
- Lead login lacks management/history controls. Start Demo Walk-In, enter 1.75 cups of
  ginger, review and submit. Missing conversion remains visible without losing the count.
- Browser error log inspection after the Lead workflow returned no errors.

These are executed browser acceptance checks, not an added Playwright CI suite. The 11
HTTP integration tests are reproducible with the existing npm test command and cover
authentication, authorization, CSRF, account isolation, workflow, corrections/conflicts,
error sanitization and private-file exclusion.

The browser-created records are intentionally retained as labeled synthetic review
history. No production browser form, Render configuration or live application data was
modified. The Render dashboard redirected to its sign-in page; only the public live login
page was inspected.
