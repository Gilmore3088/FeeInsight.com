# 2026-10-20: live fees stay on superseded copies the newer-copy check never reaches
**What happened:** The Oct 20 data audit found 6,033 live fees at 1,376 banks read from a copy that
Magellan has superseded (`superseded_by_id`); for 3,484 of them the newer copy also has live fees,
so both copies are live at once (#2477). Samples: bank 58 "Replacement Debit" $40 (old) and $5
(new); bank 2 "Non-Bank of America ATM Fee" $5 and $2.50.
**Cause:** Hamilton's newer-copy check judged each pair once, and a v1 decision was never judged
again, so the identity guards added later (#2117/#2118/#2121) never reached settled pairs. A prod
dry run (read-only, 2026-10-20) of the check over every pair found that this explains only a small
part: 772 pairs reachable, 474 of them unrecognized (the newer copy states under half of the older
copy's fees, so nothing retires), 8 fees retired at 2 institutions. A re-price rule ("named only at
other prices") was tried and dropped: 0 fees in the dry run, and review showed it could retire a
price the page still states (a dropped decimal point, a bare figure, a waiver threshold).
**Fix:** this PR judges every v1 pair again under v2 (8 retirements, 0 restores). The bulk is open on
#2477: unrecognized pairs, and newer copies that never published.
**Lesson:** measure a takedown rule on prod before building it out: the dry run showed the rule
reached none of the fees it was meant for.
**Guard:** `src/lib/agents/hamilton/newer-copy-retire.db.test.ts` ("judges a pair decided under v1
again under v2", "keeps an already-decided v2 pair closed").
