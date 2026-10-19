# 2026-10-19: a re-pointed fee link is never fetched, so old documents stay live
**What happened:** James asked why the agents were not finding stale fees his live checks found
(Cedar Falls, #1945). On prod (read-only, Oct 19), 8,385 live fees cited 543 documents that are no
longer any of their bank's sources: not the saved fee link, not a companion page, not a
non-rejected additional source, and never marked superseded. For 220 of those documents (206
banks) the bank's saved fee link had never been fetched at all, although each bank was fetched in
the last 30 days. Across active banks, 308 (204 with live fees) had a saved link that is a
different page from the address the fetch actually asks for, and no copy of it.
**Cause:** two gaps. (1) Magellan's plain fetch asks for the profile's remembered address before
the saved link (`magellan/fetch.ts`, `profile_canonical_source_url ?? fee_schedule_url`). When a
person, an answer key or a registry load re-points the saved link, the old remembered address keeps
answering, so the new link is never fetched (#1881; #1883 fixed only a person's explicit extract).
(2) Hamilton's current-copy check judged only documents superseded in place at the same address,
so a schedule that moved to a new address left the old document's fees live with nothing checking
them.
**Fix:** this PR. `magellan/saved-link-fetch.ts` fetches a never-fetched saved link once as a copy
beside the remembered one, changing nothing on the bank. `hamilton/current-copy.ts` judges retired
documents against the newest read copy at the current link, only when that copy is the same page
or a newer dated edition. Both ship switched off (fetch: report only; current-copy confirmations
were already off); turning them on is James's call.
**Lesson:** a check that keys on "same address" misses every schedule that moves. When a source
link changes, the fetch must ask for the new link, and every live fee must trace to a document that
is still one of the bank's sources.
