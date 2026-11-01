# 2026-10-26: a small-overdraft $0 band went live as the bank's overdraft price
**What happened:** #1882 asked whether the institutions whose highest live overdraft price is $0 really
charge nothing. On Oct 26, 18 did (live fees 28126, 50956, 107723, 23284, 115291, 93436, 85606, 56781,
78514, 152915, 34738, 139529, 84053, 108088, 116439, 99261, 153746, 139005), every one a Knox free read.
Read against the text Knox read (the extraction note's artifact), 15 are $0s the schedule states for the
whole fee ("No-Fee Overdraft | Free", "Overdraft/NSF Fee We do not charge a fee for this service
$0.00", SoFi's and nbkc's "Overdraft Fee $0", Stearns's "We will not charge NSF Fees", "Overdraft fees
are not charged on this account"). 3 are one band of a priced overdraft:
- 108088 (institution 6056): "Safety Net Overdraft | $0 if the negative balance is $5 or less. $10 if
  the negative balance is $5.01 to $20. $35 per item** if negative balance is $20.01 or greater."
- 116439 (7358): "Privilege Pay ACH, Check, Debit Card | $0 for items ≤ $5"; the account terms charge
  "A fee of $30 for overdrawing your account".
- 99261 (7374): "Item paid in overdraft fee (Courtesy Pay) | N/C" over "Negative account balance
  $0-$9.99", then "Item paid in overdraft fee (Courtesy Pay) | up to 19.00" over "... $10.00 or more".

**Cause:**
- Knox's free read (`readSegment` in rules.ts) takes the first figure after the name and tests only
  the name for a condition (`notAZeroPrice`), so a $0 whose own cell goes on to price the fee, or whose
  band sits on the next line, went to Darwin as a free fee. The priced band rows were held as ranges.
- Darwin's conditional-$0 test (`conditionalZero`) reads the next cell as the fee's price only when it
  has at most four words (`isPriceCell`), so the Safety Net cell counted as no price and the recheck
  passed it (verify.recheck v5, Oct 19). "ACH, Check, Debit Card" split the Privilege Pay name at its
  commas, and the Courtesy Pay band is on another line, so neither is seen there either.

**Fix:** one shared test, `bandedZeroOf` (`src/lib/banded-zero.ts`), for overdraft, NSF and continuous
overdraft $0s. It finds the $0 is not the fee's price when its own cell prints a price above $0
(`own_cell`), when the line prints a price straight after the name so the free word is the next
column's (`own_row_price`, "Overdraft Fee | $12.00 | Free"), or when the text prints the name with a $0
on one row and a price on another and one of them or the line after states a band (`priced_twin_row`).
- Knox v122 holds such a free read as a range for review (`knox_banded_zero:<kind>`) in
  `insertHeldCandidate`, the one path every free read takes, so it never reaches Darwin as a free fee.
- Darwin's banded $0 re-check (`darwin/banded-zero-check.ts`) reads every live $0 in those categories
  with the same test; its switch `BANDED_ZERO_TAKEDOWN_LIVE` is off.
- Without band words, two rows of one name are two accounts' or audiences' prices and the $0 stays:
  Renasant's consumer "Non-Sufficient Funds Fee (Returned Item) | No Fee" beside the business "$36.00
  Each" (98972) is a real free fee.

**Scope (read-only, Oct 26, the check's own SQL):** of 139 live $0 overdraft, NSF and continuous
overdraft fees, 4 match at 4 institutions: the 3 above and 149658 (5667, "Overdraft Fee | $12.00 |
Free", beside the live $12 overdraft fee 16766). Each was read against its stored text and is not the
fee's price. Fixture `src/lib/agents/darwin/__fixtures__/banded-zero-live-2026-10-26.json`.
Two other live $0 overdraft fees are wrong for other reasons and stay out of this check: 96107 (7041,
"Withdrawals (Courtesy Pay Fee may apply) | Free" is an own-network ATM withdrawal filed as overdraft)
and 97606 (161, "Overdraft fee is $0" is one checkless account's feature beside the bank's $36 fee).

**Agent lesson:** knox/issue-1882-a-zero-band-is-not-the-fee
**Agent lesson:** darwin/issue-1882-zero-overdraft-needs-its-whole-cell
**Guard:** `src/lib/banded-zero.test.ts`, `src/lib/agents/darwin/banded-zero-check.test.ts`,
`src/lib/agents/darwin/banded-zero-check.db.test.ts`
