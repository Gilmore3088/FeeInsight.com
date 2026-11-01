# 2026-10-27: a percentage charge's minimum or maximum was published as a flat fee

**Lesson:** "4% of advance (min. of $5)" and "Non-Member ($10 Max) | 5% of Total" cost the
percentage; the dollar figure is the least or most the charge can be. Read it as the rate with the
figure as its `rate_min_amount` or `rate_max_amount`, never as a flat fee, and refuse a flat fee whose
only row in the schedule makes its amount such a bound.

**What happened (#2067):** grouping the week's amount errors by text layout (#2582) left a class the
shared check still passed: a minimum or maximum printed beside a percentage, read as the fee's flat
price. The figure is on the fee's own row, so `checkFeeAgainstSource` traced it, and every later check
that leans on it passed it too. Greater-of floors ("$5 or 3%, whichever is greater") were already
Knox v118's (#1615); min/max wording was not. Knox v135 still read four of the live examples from their
stored texts as flat fees (inst 8693's "Visa® cash advance ($50 maximum) | 3% of each", inst 7936's
"Non-Member ($10 Max) | 5% of Total", inst 1552's "Garnishments (Minimum charge of $50.00, maximum
charge of $100.00) 10.000% of Amount Paid to Court", inst 4376's "Coin Counting Fee | 5%/$10. Max.");
the others were read by earlier versions and stayed live.

**Cause:** no rule told a bound from a price, in Knox's read or in the shared check.

**Fix:**
- `src/lib/rate-bound.ts` (`rateBoundOf`) decides: the fee's own figure (the first at its amount after
  its name on the line) carries min/max wording right before or after it, and a percentage sits in the
  same clause (120 characters, at most one cell break, no other price between unless it is the other
  bound). A balance or payment ("$1,500 minimum balance", "Minimum payment: 3.00% or $20.00") and an
  interest, reward or cash-back rate ("4% cash back ... A maximum of $10.00") do not count.
- Knox v136 holds such a read as the percentage, as v118 holds a floor, so the rate pass files the rate
  fee with the bound as its minimum or maximum where the category publishes rates. `rateFeeFromHeld`
  now also reads a bound stated just before the rate ("(Minimum of $3.00) 3.00%") and "$10. Max.".
- The shared check refuses such a fee as `rate_bound` unless another row prices it flat on its own
  (`withoutRateBoundRow`). The refusal is behind `SOURCE_CHECK_RATE_BOUND` (off by default):
  switched on, every caller that acts on live fees can take these fees down, which needs James's yes.
- Hamilton's source check v27 re-checks every institution, counts the live fees the refusal would take
  down (`rate_bound`, `rate_bound_samples` in its `hamilton.source_check` event) and, with the switch
  off, carries on exactly as v26 did. The rules re-check keeps a fee v136 no longer reads while the
  shared check (switch off) still traces it and the category guard passes it (its second look), so the
  Knox bump takes nothing down either.

**Dry run (prod, read-only, Oct 27):** 44 live flat fees have min/max wording and a percentage in
their stored Knox line; across the stored texts, 993 live flat fees sit on a line (APR, APY, dividend and LTV lines aside) with min/max wording
beside their amount and a percentage, 67 of them on a line that also carries the first word of the
fee's name. Run through the shared check on the fee's stored lines, 17 at 17 institutions are refused
as `rate_bound` (13617, 20370, 21948, 32970, 40319, 42088, 44294, 47480, 50916, 51579, 68096, 82016,
95234, 130060, 133556, 140649, 161450). Each of the 17 was read against its stored text: all 17 are a
percentage charge's bound on the fee's only row (17 of 17). The rest are kept: the fee is priced on a
row of its own (138069 "Non-Member Check Cashing $10.00" beside "Non-Member Corporate Check 2% of check
amount ($10.00 minimum)"), its own figure stands alone (56202 "Skip-A-Payment ... $ 30", 151896 "$5.00
checking account overdraft fee"), or the figure is a reward or a loan term (125948, 148603). Not counted:
a bound whose name and figure sit on different lines of a joined row; the 7 such lines found all belong
to fees priced on a line of their own.

**Not covered:** "$5 or 3% (max $50)" with no min/max word on the $5 (22904), "with $25 Minimum &
$70" cut before its "Maximum", a bound two cells away from its percentage (33685's "Loan Late Charge
(1% of payment) | Every type of Loan ... | $15.00 Minimum $30.00 Maximum"), and paid reads, which take
the shared check's default (switch off).

**Guard:** `src/lib/rate-bound.test.ts`, `src/lib/custom-report/rate-bound-check.test.ts`,
`src/lib/agents/knox/rate-bound-read.test.ts`, `src/lib/agents/hamilton/source-check.test.ts`, the
planted case `amount_rate_bound` in `src/lib/agents/deming/planted-errors.ts`. **Agent lesson:**
hamilton/issue-2067-rate-bound-is-not-traced; Knox's reading lesson is
knox/issue-2067-percentage-minimum-is-no-flat-fee (sibling PR).
