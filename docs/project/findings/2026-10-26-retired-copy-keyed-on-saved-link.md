# 2026-10-26: the retired-document check read the saved link, not the page the bank is fetched at

**What happened:** Hamilton's current-copy check also judges live fees whose document is no longer
any of its bank's sources ("retired", `retiredCopiesSql` in `hamilton/current-copy.ts`). It paired
such a document only with the newest read copy stored under `institution_sources.fee_schedule_url`.
The plain fetch asks for the profile's remembered address first (`fetch.ts`,
`profile_canonical_source_url ?? fee_schedule_url`) and stores each copy under its final address,
which it then remembers. So where the remembered page differed from the saved link, a retired
document was judged against a one-off saved-link copy (`magellan/saved-link-fetch.ts`) instead of
the page Magellan keeps fresh, or not judged at all when the saved link had never been captured.

Bayes's count of the same selection (`countCurrentCopyPairs`) also failed every time: its `live`
CTE never selected `product_name`, which the `stale` CTE has read since #2179 (Oct 19), so the
query stopped with `column live.product_name does not exist`. No database test ran it.

**Fix:** this PR. The current copy is the newest read copy at the fetch target (remembered
address, else saved link); the saved link's copy stands in only when the fetch target has none.
Neither address counts as retired. The count's `live` CTE selects `product_name`. A new database
test (`current-copy.db.test.ts`, in CI's e2e list) runs the pairing and the count.

**Dry count (prod, read-only, SELECT only, 2026-10-26):** today's keying pairs 2,924 live fees on
retired documents; the corrected keying pairs 3,274. 779 live fees (53 documents, 48 banks) are
paired differently: 350 newly paired and 429 paired with another document; none lose their
pairing. A pairing is only the start: a fee is flagged only when the current copy is the same
schedule and no longer states it, and `CURRENT_COPY_CONFIRM_LIVE` is still false, so nothing is
taken down by this change.

**Lesson:** a check that asks "what does the bank serve today?" must read the address the bank is
actually fetched at, the same expression the fetch uses, not the link a person saved.

**Agent lesson:** hamilton/issue-1200-retired-key-is-the-fetch-target
