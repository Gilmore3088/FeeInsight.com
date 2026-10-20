# 2026-10-20: a fee a newer copy re-prices stayed live beside the new price
**What happened:** The Oct 20 data audit found 6,033 live fees at 1,376 banks read from a document
that a newer copy of the same page had superseded; for 3,484 of them the newer copy also had live
fees, so both copies were live at once (#2477). Samples: bank 58 "Replacement Debit" $40 (old) and
$5 (new), both live; bank 2 "Non-Bank of America ATM Fee" $5 and $2.50; old generic "Monthly
Service $6" beside the newer copy's per-account monthly fees.
**Cause:** Hamilton's newer-copy check retired a fee only when the newer copy dropped its line. A
fee still named there at another price was `still_named` and left to the publish step's price
change, which never replaced it when the identities differed (an unassigned product, another
frequency). Pairs decided under v1 were never judged again, so no later rule reached them.
**Fix:** a fee the newer copy names only at other prices (`repricedByNewerCopy`) is retired once a
live fee of its category, audience overlapping, was read from the newer copy, and the newer copy
is recognized as the same schedule; v2 judges every v1 pair again through the publish step's own
sweep. A free fee, a line naming the fee without a price, or an old amount printed anywhere in the
newer copy keeps the fee.
**Lesson:** "still named" is not "still stated": a check that keeps every fee whose name survives
keeps every stale price. Retire on the price the current page prints, once its replacement is live.
**Guard:** `src/lib/agents/hamilton/newer-copy-retire.test.ts` ("retires a fee the newer copy
re-prices…" and the four keeps), `src/lib/agents/hamilton/newer-copy-retire.db.test.ts` ("retires a
fee the newer copy re-prices once the newer copy's price is live", "judges a pair decided under v1
again under v2").
