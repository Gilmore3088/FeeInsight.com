# 2026-10-20: a Knox reader fix never reaches the live fees it was written for
**What happened:** #1838 (Oct 18) fixed Knox's read of price-first rows ("| **$20** | Key Deposit |",
Valley Strong CU) so that each row keeps its own price. Two days later, live fees from the same
kind of layout were still at the next row's price, for example doc 2491 (inst 7982): "Overdraft
Transfer (per item)" at $30 where its own row prints $3 (30894), "Replacement Debit Card" at $30
where its row prints $10 (74628), and the levy at the garnishment row's $20 (141206). Colby's
cell-less list (doc 37839) went live on Oct 18, after #1838, with "3”x5”" at $19 and "4”x5”" at $21
(99157, 99158): the fix covered rows with cells, and this list has none.
**Cause:** two gaps.
1. Nothing re-reads the old live fees. #1838 left the stale-read floor at v78, so no page was read
   again. The Knox rules re-check (`hamilton.rules_recheck` v4) runs once per Knox signature per
   document, at 25 documents a publish step. On Oct 20 it had re-checked 47 of the 8,301 documents
   with live Knox fees under the signature then current (`extract.rules@90,extract.table@7,...`),
   at about 1,523 re-checks a day spread over 9 signatures. Each Knox version bump starts a new
   signature, so the backlog never clears.
2. The shared check let the wrong price through. `checkFeeAgainstSource` matched a fee's words
   against any line printing its amount. "Overdraft Transfer (per item)" matched "$30 | Overdraft
   NSF (per item)", and "Rental of 3 × 5 Box" matched the 5 × 5 row. So Darwin verified the
   misread, publish accepted it, and Hamilton's source check kept it live.
**Fix:** this PR.
- The shared check now refuses a price while the fee's own row (a row named exactly as the fee)
  prints another price (`ownRowRefusal`), and refuses a sized fee that matched a row of another
  size (`sizeMismatch`).
- `SOURCE_CHECK_STRATEGY` v19 re-checks every institution through the existing source-check pass,
  with the 12-hour second look and takedowns on the ledger.
- Knox v91 reads cell-less price-first lists and range rows one fee per line (`inPriceFirstListRun`,
  `layout.ts`).
**Still open:** reader fixes that change a price still depend on the source-check bump to reach live
fees. The rules re-check cannot keep up while each Knox version restarts it. On the Knox tracker
(#1092): re-check live fees from the documents a fix touches, not every document under each new
signature.
**Lesson:** a reader fix is not done when new reads are right. Its live re-check has to reach the
fees the old read already published, and the shared check has to refuse the error on its own.

**Guard:** `src/lib/custom-report/source-check-layout.test.ts` ("a fee never traces to its neighbour's price (#1827)") and `src/lib/agents/knox/specialists.test.ts` ("v91 reads a cell-less price-first list one fee per line")
