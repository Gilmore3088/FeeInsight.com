# 2026-10-14: a re-read that changes a fee's category kept the old category for Darwin

**What happened:** Re-measuring #1093 on production (read-only SQL, 14 Oct). Of the 54 rows a
re-read took over since #1147, 12 carried the old category flag first; 8 of them never verified,
and Darwin kept rejecting them for category under the old flag ("Wire Transfer - International"
$45 at institution 7114 judged as `overdraft`, raw 126752, rejected `category_mismatch` on every
run from 5 to 14 Oct). Separately, retired free-pass rows that today's rules read under a new
category stayed retired: Oregonians CU (document 13279) has "Card Replacement" $10, "Incoming
Wires" $10 and "Bad Address/Returned Mail" $10 retired as `atm_non_network`, `nsf` and
`monthly_maintenance`; today's rules read them as `card_replacement`, `wire_domestic_incoming`
and `account_research`, and none is live.

**Cause:** Two places treat the category as part of the fee's identity when it is not:
- `insertCandidate`'s conflict update kept the row's old flags and appended the new read's, and
  Darwin's `canonicalHintFrom` takes the first `canonical_hint:` flag.
- `recheckSupersededRows` (#1148) only restores a row when today's read has the row's own
  category, while the dedupe index is (document, name, amount, audience): a re-read under a new
  category could neither write its own row nor be picked up by the restore pass.

**Fix:** #1093 PR (this one): the take-over drops old `canonical_hint:` flags; a new
`refileSupersededRows` pass re-files those rows under today's category, off until James approves
it, with a read-only sample on the run ledger meanwhile.

**Lesson:** A row's category is a reading, not part of its key. Any code that merges a new read
into an existing row must replace the category flag, not append to it, and a restore that matches
on category must say what happens when the category changed.

Also measured: most retired free-pass rows that are not live were rejected by Darwin before the
re-read retired them (668 of 721 on a current document), so the original "1,646 lost" count was
mostly Darwin rejections, not re-read losses.

**Agent lesson:** knox/pr-1291-reread-replaces-hint
