# 2026-10-16: a fee's evidence on public pages quoted its name, not its price
**What happened:** James's review of the /fees explorer (#1652): 1NB Bank's monthly maintenance read
"$7.97" beside the evidence "Account Fees: The monthly service charge", with no price, account or
condition. The explorer quotes `fee_name` and the reader-cleaned `conditions`; no column holds a
fee's evidence line. On Oct 16 (read-only), 79,501 of 79,913 live dollar fees showed no amount in
that text. Knox's stored line (`excerpt="..."` in `raw_fee_observations.extraction_note`) prints the
price for 77,346 of 78,300 Knox rows; 954 lines do not (940 of them end at Knox's 180-character cut,
mostly dot leaders before the price), and the 1,614 imported (`migration_v10`) rows have no stored
line. In every one of those 2,568 the row's own stored text prints the amount somewhere, except one
imported row with no document (Bay Cities CU 11764). The $7.97 is not a printed price: it is the
explorer's per-institution value, the median of 1NB's two live rows ($5.95 Carefree Checking and
$10.00 NOW Checking), both correct.
**Cause:** No stored evidence line; pages fell back to the fee name. Knox's excerpt is an audit note
cut at 180 characters, and Darwin's twin match reads it (`verify.ts`), so it is not rewritten.
**Fix:** `src/lib/fee-evidence.ts` (pure) and `getFeeEvidence` in
`src/lib/data-store/fee-evidence.ts` (read-only): each listed fee's line from the shared
`checkFeeAgainstSource` on its own document, the account heading above it, or Knox's stored line
when it prints the price; null means unverified. A conditional waiver ("Service fee waived if
either of the following:") is never a $0 price. The page lane swaps it in for the quoted name.
**Lesson:** A quote shown as evidence must print the number it supports; test that, not that a
quote exists. A per-institution median is not a price a bank prints and must never sit beside one
row's evidence.

**Guard:** `src/lib/fee-evidence.test.ts:147` (1NB Bank's evidence line prints the fee's own price, account and condition instead of the bare fee name; line 250 gives no evidence when no line prints the price, as for the $7.97 median)
