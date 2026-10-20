# 2026-10-20: a page that stopped being a fee schedule became its current copy
**What happened:** 162 current copies of fee-schedule pages were read by Rosetta's page check as
`wrong_document` (a landing or navigation page now served at the schedule's address), while the
superseded readable copy still carried the bank's live fees (#2477, read-only prod query
2026-10-20). Knox reads only the current copy, so those pages could never refresh.
**Cause:** Magellan hands the current place back to the page's latest readable copy only for a
thin copy (a bot check, script shell or bare title under 300 characters). A long page that is not a
fee document passed that test and stayed current.
**Fix:** a copy whose text Rosetta judged `wrong_document` is treated like a thin copy at fetch
time, in the readable-copy sweep and in the same-page ranking. No fee is taken down; the readable
copy becomes current again.
**Lesson:** "readable" is not "a fee schedule": a copy that fails the page check must not displace
one that passed it.
**Guard:** `src/lib/agents/magellan/current-copy.db.test.ts` ("hands the place back from a copy
Rosetta judged not a fee document, and keeps a readable current copy").
