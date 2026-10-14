# SCCU's schedule lost 7 of its 18 priced fees between read and publish (Oct 9, 2026)

Space Coast Credit Union (8109) had 11 live fees. Its one-page schedule (doc 13776, Fee-Schedule.pdf)
prints 18 priced fees that fall in the 50 categories, plus a $2 external transfer that has no category.
Seven were lost for three reasons:

1. **Darwin's in-batch duplicate key.** "Money Market Savings Account (below $2,500) | $15/mo." and
   "Interest Checking (below $1,500) | $15/mo." are both minimum_balance, $15, monthly, on one
   document. The key (institution, category, amount, frequency, document) made the second a
   duplicate of the first (`duplicate_in_batch`, raw 313807). Batch key v3 adds the fee's own source
   line. The same line read twice, as when Knox runs twice on one document, is still one fee. Rows
   held under an older key are re-checked once when no verified twin shares their line.
2. **A box table printed sideways.** "... | 3x5 | 5x5 | 3x10 | 5x10 | 10x10" sits over "... | $60 |
   $80 | $90 | $110 | $185". Knox read $60 as the ATM line's fee (raw 158238, held) and missed the
   other four. Knox v64 (`withSidewaysBoxTable`) writes each size and the price under it as its own
   line, and allows one blank line between the rows. Live documents with this layout: 13776 (SCCU, 5
   boxes), 15639 (Houston FCU, 6) and 14622 (1st Federal Savings Bank of SC, 4). All 15 v64 reads
   match their source. Gates are unchanged: seven states 744/42, Texas 511/14, CA 133/6.
3. **Not fixed: a price on the line under its name.** The schedule prints "Returned Check |
   Verification of Deposit | $20" over "$30 | (Business/Quality Assurance/Expedited)". The $30
   belongs to Returned Check. Knox read "Returned Check | Verification of Deposit" at $20 (raw
   158236, rejected) and Verification of Deposit at $20, which is right. A reader for a price on the
   next line is the same gap as doc 20570's.

Levies and Writs is live as per_item (53353). The frequency fill corrected it at 00:01 Oct 9, and
only the raw row still says monthly.
