# 2026-10-09: A flagged fee's page was never fetched again before its second look
**What happened:** a Hamilton check that fails a live fee logs `takedown_pending` and takes the
fee down on a second look 12 hours later, so a fresh read of the page can clear it first. At
9 Oct 02:27 UTC, 1,012 live fees at 435 banks had such a flag. Since each bank's first flag,
Magellan had fetched 12 of those banks, and 5 had a new document (prod read).
**Cause:** Magellan's 12-hour re-fetch runs only in a state's full pass, which is monthly. The
hourly backlog pass fetches only new links and links last fetched over 30 days ago, so the
second look judged the copy fetched before the flag.
**Fix:** a bank with a live flagged fee since its last fetch is now picked by the next fetch,
backlog or full, first after new links (`selectCandidates` in `src/lib/agents/magellan/fetch.ts`).
`stateHasDocumentBacklog` counts it, so the lane runs hourly, and
`wakeLanesWithPendingSecondLooks` wakes a sleeping lane. A fetch stamps `last_crawl_at`, so each
bank is fetched once per flag. 419 fetchable banks matched the new selection on prod (read-only, before merge).
**Lesson:** a wait that exists so new evidence can arrive needs something that fetches that
evidence within the wait.
