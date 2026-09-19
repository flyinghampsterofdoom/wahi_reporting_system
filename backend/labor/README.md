# Time Management v1

The labor subsystem is separate from domain/costing state and named authentication accounts. Toast supplies jobs, employee GUID/job relationships, and time entries. Employee names, contact details, wages, tips, and scheduled shifts are not persisted here. Toast credentials are decrypted only server-side; the client issues authentication POSTs and labor/restaurant GETs, never Toast business-data writes.

`labor.read` and `labor.refresh` are granted to Manager and Admin. `labor.configure` is Admin-only. Existing authentication, CSRF and session-generation checks protect all routes. Policy changes and their secret-free audit entries are transactional.

## Policy

No default week, target, or job classification exists. Admin selects a weekday and its first effective business date. Subsequent rule changes must be future-dated and cannot intersect existing target weeks. A transition to another weekday truncates the preceding interval at the transition; the displayed range identifies any shorter interval. Targets belong to an explicit starting date. Revisions change only the selected week and preserve prior versions; optimistic concurrency rejects stale saves. Copy previous week fills a form and requires an explicit save.

Job assignments resolve by the time entry's job GUID and Toast business date. Initial classification can cover imported history, but subsequent assignments must start on a future day later than the existing policy. They never reinterpret earlier days. Explicit Excluded and incomplete Unassigned remain separate. Unknown historical job references are retrieved by GUID, including archived jobs.

## Hours and refresh

Completed hours are Toast `regularHours + overtimeHours`. Never subtract breaks again from these authoritative values. The parser preserves the original JSON numeric lexemes for exact arithmetic. Open shifts use exact elapsed milliseconds through their successful synchronization timestamp, subtract observed unpaid breaks, and retain paid breaks. Missing/ambiguous breaks, overlapping intervals, invalid dates or open entries older than 36 hours are unresolved, with a visible incomplete-total warning. No extrapolation occurs after the snapshot; final Toast hours replace provisional hours at the next sync.

Toast business dates are authoritative for attribution. Restaurant timezone/cutoff determine the current business date with DST-aware `Intl` handling. Neither a payroll-week start nor a default cutoff is guessed. Changes to the configured restaurant identity or observed timezone/cutoff fail closed for review rather than mixing incompatible history.

Manual synchronization is shared and limited to one attempt per minute by a PostgreSQL advisory lock and persisted timestamp. The open current-week dashboard refreshes every five minutes. Historical weeks refresh only on explicit request. There is no background Toast traffic when the dashboard is not open. Metadata refreshes at most daily. A sync fetches at most seven business dates, including archived/missed-break records, and upserts by GUID in one transaction. Successful complete-date responses reconcile missing/deleted records. Failure retains the previous cache and marks it unavailable/stale. Unexpected pagination fails closed rather than publishing partial totals. No extra rate-limit retries occur in a browser render.

Dashboard queries are scoped to the selected interval, one target revision, relevant classification versions, and small job metadata; they never load inventory/costing state or contact Toast. Display rounds hours/percentages to one decimal only after exact aggregation. Percentages can exceed 100%; a zero target yields an undefined percentage and positive over-hours. Missing coverage yields unavailable, never a fabricated zero. Cached current-week data older than ten minutes is visibly stale; old historical snapshots retain their sync timestamp.

Toast reference: [Labor reports](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistPayroll.html), [time entries](https://doc.toasttab.com/openapi/labor/operation/timeEntriesGet/), [rate limits](https://doc.toasttab.com/doc/devguide/apiRateLimiting.html).
