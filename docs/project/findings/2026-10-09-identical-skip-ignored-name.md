# 2026-10-09: the identical-fee skip compared price only

**What happened:** UAT found that verified 8019 at Wildfire, "ATM Balance Inquiry (at non-Wildfire ATM)" at $5,
was never published. It had been skipped as "Identical fee already published" because of live 14754,
"ATM Adjustment ......" at $5. These are two lines of the same document, and the bank showed no balance
inquiry fee. On 9 Oct, 26,027 publish.rules v2 rows had been skipped as identical. In 2,420 of them the
live row came from the same document under a different name. Read-only count, taking names as lower-case
words.

**Cause:** `decidePriorFee` treated a verified row as identical to any live row with the same bank, category
and price (`feeValue`). It never looked at the name. When one page lists two fees of one category at the
same price, the first one published hid the second.

**Fix:** this PR.
- `separateLines` treats two lines of one document as separate fees when neither name's words all
  appear in the other's. It ignores filler words, plural and -ing forms, parenthetical asides, and
  names that are page sentences or headers.
- The check applies only to the rows in `SAME_LINE_RESELECT_IDS`, which is just 8019 for now, and each
  of those rows is decided once more. Every new attempt carries `same_line_check`, so that second
  decision is final.
- Source spot checks of 20 rows the check would separate:
  - 13/20 real separate lines on the first version.
  - 10/20 on a fresh sample after one round of tightening.
  - 14/20 on a third fresh sample after another.
- The misses are one fee read twice, worded differently:
  - a footnote vs the table row ("A nonsufficient funds (NSF) charge" / "Returned Item/NSF Fee");
  - a heading vs its continuation ("Monthly Dormancy Fee" / "inactive for six (6) months");
  - a footnote digit glued on ("Inactive Checking3").
- The bar for applying the check to every row, and to the backlog (about 400 rows), is 18 of 20.

**Lesson:** a dedupe key needs the fee's identity, not just its value. Price and category alone collapse
distinct lines.
