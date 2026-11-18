# Google authorization warning — UI correction

The warning is now owned by the Google Reviews page instead of the shared navigation shell. Both the current knowledge page and the classic review explorer display the existing authorization notification with an **Open Google connection** link. The existing connection settings and reconnect controls are unchanged. Admin-only status access remains Admin-only.

The shared shell no longer requests or renders Google status. Review-specific holders live inside their page content. A delayed or superseded response cannot attach to another page or resurrect a warning after navigation, sign-out or holder replacement. A temporary status-read failure does not invent a new disconnected state. The knowledge page retains its notice across period filters and internal navigation.

Verification, November 17, 2026:

- 42 focused regression tests passed, zero failures/skips: warning state/race coverage plus existing navigation, HTTP, knowledge and private-preview tests.
- 12 browser checks passed using disposable Playwright-managed headless Chromium contexts at desktop 1440×900 and mobile 390×844. Recipe Book navigation/reload makes no Google-status request and has no Google warning. Reviews navigation, back, refresh, filter changes, warning removal for healthy status, delayed-response isolation and Manager/RecipeOnly boundaries passed. Zero page errors or tested warning overflow.
- Browser checks used an in-memory synthetic application only. No production writes, provider requests, reconnect, credential change, ingestion action or deployment occurred.
- Tests used the original shared regression lock, a 512 MiB Node heap, 16 MiB nursery, at most two test files and a 1536 MiB aggregate RSS ceiling. Browser peak aggregate RSS was 754,188,288 bytes.

Storage: the owner explicitly confirmed the November 17 permanent ceiling of 150 GB and authorized this narrow Wahi worktree/test exception because the installed launcher has no Wahi route. Existing working copy reused; no new worktree, dependency installation, database clone or backup destination. Temporary browser contexts were closed and the synthetic server stopped.

This correction is local and verified. **Production deployment remains unauthorized and was not performed.** Connection diagnosis follows separately.
