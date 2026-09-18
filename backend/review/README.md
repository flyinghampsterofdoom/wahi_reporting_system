# Wahi local owner review

Open **http://127.0.0.1:4317** on this Mac.

Logins are in `.runtime/ACCESS.md` (owner-readable, ignored by Git). Use `owner` for Admin,
`manager` for Manager, `lead` or `staff` to review restricted employee workflows. These are
separate review-only credentials, not production accounts. Every screen is labeled demo.

The review app is currently running. Data is retained in its dedicated PostgreSQL cluster.
After a reboot or an intentional stop, from the repository directory:

```sh
node backend/review/runtime.js start
```

To stop the review HTTP server and private database without deleting data:

```sh
node backend/review/runtime.js stop
```

Initial provisioning, already completed on this Mac:

```sh
node backend/review/runtime.js setup
```

Setup is explicit. Once provisioned, it does not reseed or reset accounts. Normal startup
only checks migrations. Existing counts survive stop/start; browser login sessions do not.
Do not use root `npm start` to start this review app: that launches the legacy application.

## Suggested owner walkthrough

1. Log in as Staff. Choose Count a location, Demo Bar, and enter an observation time.
2. Enter rum and lime quantities with Save & next. Skip a garnish if it was not counted.
3. Review the sheet and submit. Missing items remain uncounted, not zero.
4. Log out and log in as Manager. Open Count history, select the sheet, and correct a
   quantity with a reason. Expand history to see the original and replacement.
5. Open Inventory. Inspect the location breakdown, different ages and derived total.
6. Select Demo Ginger to see an intentionally unresolved cups-to-grams conversion.
7. As Owner, open Locations & items to edit location ordering and item assignments.
8. Open Catalog & costing. Cost 1.5 US fl oz of Demo White Rum: 1.06464706425 USD.
   Demo Cocktail remains incomplete because Demo Pineapple Garnish lacks a yield.

Browser acceptance tests left two clearly labeled synthetic count sheets in history:
a Staff Bar count (22 bottles corrected to 2.2, plus 14 limes and an uncounted garnish),
and a Lead Walk-In count (1.75 cups of ginger, conversion unresolved). The initial rum
fixture total was 21.4 bottles. After the recorded test correction, the effective demo
total is 20.2 bottles. The original observations have not been deleted or reset.

This milestone exposes existing functionality only. There is no stock-position ledger,
Toast connection, transfer, variance, ordering, reporting system or workbook migration.
The real Egg Roll Wraps package-size blocker is unchanged.

## Isolation and limits

- HTTP binds only `127.0.0.1:4317`; use that exact URL, not localhost or the Render URL.
- PostgreSQL uses a private Unix socket under `.runtime/`, port identifier 55441, no TCP
  listener. It never reads DATABASE_URL, DB_PATH or the existing PostgreSQL cluster.
- Runtime directory is owner-only (0700); credentials/account files are 0600 and Git-ignored.
- Four review accounts use scrypt hashes. Sessions use opaque HttpOnly SameSite=Strict
  cookies, expire after eight hours, and are revoked on logout. A restart logs everyone out.
- Mutation requests require the correct Origin and a session-specific CSRF token. Roles
  come from server-owned accounts, never request body/header claims.
- The interface is responsive and tested at a tablet viewport. A different physical tablet
  cannot reach this Mac's loopback URL. Remote access needs separately authenticated and
  reviewed HTTPS staging infrastructure. No public tunnel was opened.
- This is a review adapter, not a production authentication migration or deployment design.

Run the complete backend plus HTTP integration suite:

```sh
npm --prefix backend test
```

The latest report is `INTEGRATION-REPORT.md`; automated output is `TEST-RESULTS.txt`.
