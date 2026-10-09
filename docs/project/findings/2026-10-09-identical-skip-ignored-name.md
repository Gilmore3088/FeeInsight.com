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
- `separateLines` makes two lines of one document separate fees when neither name's words all appear in the
  other's. Filler words like "fee", "per item" and "monthly service charge" are ignored, as are numbers and
  dot leaders.
- A re-read of the same line, or a heading carried in front of it ("Stop payment" / "Stop Payment of Checks
  and ACHs"), stays identical.
- Across documents the same fee is often named differently, so price alone still decides there.
- Only 8019 is re-decided now (`SAME_LINE_RESELECT_IDS`); each new attempt carries `same_line_check`, so the
  re-decision is final. The backlog waits for a 20-row source spot check: about 540 still-verified rows
  have a live same-document row whose name shares no reading with theirs (read-only estimate). A
  first look is mostly separate lines (inquiry vs transfer, purchase vs reload, paid NSF vs paid
  overdraft), with some reworded duplicates ("Return Check Fee" vs "Returned Item Fee").

**Lesson:** a dedupe key needs the fee's identity, not just its value. Price and category alone collapse
distinct lines.
