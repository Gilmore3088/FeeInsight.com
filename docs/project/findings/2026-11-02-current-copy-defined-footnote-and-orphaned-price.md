# 2026-11-02: The current-copy check flagged two fees its current copy still prints

**What happened:** James asked why the waiting `*_LIVE` switches were not on. Before turning on
`CURRENT_COPY_CONFIRM_LIVE` (#2072, PR #2809), we sampled 20 live fees with a pending current-copy
first look that v5 fails again, using seed `sw-2026-11-02` (prod, read-only, Nov 2). We judged each
against the bank's stored current copy. 18 were right takedowns (the price changed, the fee left the
newer schedule, or the live fee was a misread). 2 are still printed:

- Oregon State FCU, fee 99824, in-branch cash advance $15. The current copy (doc 39738) prints
  "In-branch cash advance service fee …… $154": $15 with footnote 4. The page defines footnote 4
  ("4 Service fee is charged on cash advances …"), but it is the only place that mark is used, so it
  is glued to no word. `withoutGluedFootnoteMarks` knew a mark only from words it is glued to
  ("check2", "transaction2"), so it left the 4 on and v5 judged the fee `still_named` at $154.
- Y-12 FCU, fee 138008, Account Research $25. The current copy (doc 36629) is a two-pair table whose
  right-hand label wrapped below its price: "Stop Payment fee | $32.00 each* | $25.00 per hour / 1-hour"
  / "Account Research fee" / "minimum". `wrappedRowWitness` read a price above the label only when it
  opened its line, so the $25 in the row's last cell was missed.

The first report also counted Zia CU's fee 45384 as wrong. A full read of its current copy (doc 41684)
shows the fee table is there, and the "Money Order/Cashier's Check Fee $3.00" row is gone, so that
takedown is right. That makes the sample 18 of 20, not 17.

**Cause:** Two layout readings were narrower than the pages they read: a footnote mark was known only
from the words it is glued to, and a wrapped row was known only when its price opened the line above.

**Fix:** `CURRENT_COPY_STRATEGY` v6 (`src/lib/agents/hamilton/current-copy.ts`). Every pair is judged
again, and nothing is taken down while `CURRENT_COPY_CONFIRM_LIVE` is off.
- `withoutGluedFootnoteMarks` (`src/lib/custom-report/glued-footnote-price.ts`): if the page already
  glues marks to words at least twice, a digit is also a mark when the page defines it as a footnote,
  on a line that opens with the digit and a capitalised sentence.
- `wrappedRowWitness`: a table line ending in two price cells has an orphaned last price, and that
  price is the price of the unpriced label below it.

Both readings withhold the verdict (`unproven`) and never state a price. The fee's first look then
clears as could_not_judge at weight 0.

**Not done:** A local v6 re-judge of all 49 pending fees needs about 690,000 characters of stored text
(62 documents). That is more than can pass through a session's SQL tool. The v6 re-run on prod reads
them itself: with the switch off it writes first looks and run events only, and its failing samples
are the next sample.

**Guard:** `src/lib/agents/hamilton/current-copy.test.ts` ("current-copy check v6") and
`src/lib/custom-report/glued-footnote-price.test.ts`, using both rows' stored lines. Agent lesson:
hamilton/issue-2072-current-copy-read-the-page-own-footnotes-and-cells.
