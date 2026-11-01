# 2026-11-01: the price after a counted free allowance was read as "no fee"
**What happened:** the shadow lab (Knox v146) never read these prices, and nothing held them either:
- "Non-CO-OP ATM Transaction | 3 free per month (then $1.50 per)" and "Starter Checks | 4 sheets free
  (then $2.00 per sheet)" (State key 11477);
- "Photocopies & Faxes | First 5 pages free, then $0.50 per page" (State key 4677);
- "Check copies - rush order | 2 free per month + FedEx costs, then $2 per copy + FedEx costs" (State
  key 8034).

Live audit 2538's "Counter Check (3 free then $0.25/check)" was published under the cut name "Counter
Check (3 free then", read by the checks family, not the rules pass.

**Cause:** the rules pass drops a priced line when its words before the price, or the whole row, say
"free" (`NEGATIVE_FEE_LANGUAGE`). It is one word tested on the whole line. v127 (#1918) let one shape
through, a bracketed note before the price ("(3 FREE each month) | $3.50"). The same allowance written in
the price's own cell and joined to the price by "then" still read as "no fee". The shared check
(`checkFeeAgainstSource`) already traced these rows ("5 Free per month" is an allowance there,
`FREE_ALLOWANCE`). The reader alone refused them.

**Fix (Knox v147, admit-only):** `FREE_ALLOWANCE_THEN` in `knox/rules.ts` matches a count of free uses
in the price's cell, joined to the price after it by "then", or by a dash before an "after" price. That
allowance no longer counts as "no fee". The price is read under the name before the allowance, waivable
(only that fee, not the row's other fees), at exactly the frequency base gives the same fee with no
allowance. After three review rounds found unit forms a separate unit list missed ("hourly", "per hr",
"each hour", "per 1/2 hour"), the frequency is made right by construction (review of 35d5ba2): the row is
rebuilt as base would print it and read by base's own frequency and unit readers. Where another price
shares the cell, base itself reads a lowercase next fee's period ("Counter Checks | $2.00, annual fee $10.00"
is annual on main), so there the price keeps only a unit stated right at it, a period word between the two
prices leaves the read out (`allowance_shared_cell_period`), and otherwise it is per item (review of
34a44e3). Darwin's verified frequency (`verifiedFrequency`, the shared fee-frequency reader) reads
every word up to the next price, so where the next fee's name opens with a period word ("$2.00, Annual
Fee $10.00", "$1.00 Hourly Research $25.00") it would publish that period. Admit-only (re-review of
70d2d09): Knox asks the same pure function (moved unchanged to `darwin/verified-frequency.ts`), on the
excerpt `extract.ts` stores (one helper, `storedOwnExcerpt`) and on the whole excerpt, before keeping an
allowance read, and leaves the read out when they disagree
(`allowance_frequency_disagrees`). The same wrong period on rows with no allowance is base behaviour (a
#1092 line). The following stay
dropped, as before:
- a free stretch of time, its time word before or after "free" ("First 6 months free", "2 free months",
  "6 free statement cycles", "first 1 hour free", "5 business days free");
- a figure that a deposit, balance, minimum, limit or requirement follows;
- a rate;
- a row with other free or no-fee words;
- an allowance line with no name of its own (it never takes the fee on the line above);
- an ATM allowance whose own words name no other ATMs ("ATM Transaction Fee | 5 Free Transactions per
  month, then $1.00", unmapped in State key 4677's answers), since it can be the bank's own machines. Only
  the name, the allowance and the clause right after the price count: "$1.00 at our ATMs; $2.00 at other
  ATMs" and "(other institutions may also charge a fee)" do not.

The shared check is unchanged.

**Measured:**

| Measure | Main (v146) | v147 |
|---|---|---|
| Lab answer-key recall | 952 / 1,312 | 956 |
| Lab, all expected fees | 1,318 / 1,766 | 1,322 |
| Lab false publication | 33 / 160 | 33 |
| Seven-state gate (right) | 911 | 915 (CA 162, MI 141) |
| Texas gate (right / wrong) | 589 / 11 | 589 / 11 |

The read diff over all 291 Texas, seven-state and lab texts adds 4 kept reads. It renames one, live
audit 2538's counter check, at the same category and price; that rename is in the lab only. Live,
Hamilton's `nameImprovement` returns `not_an_improvement` for a name that only drops words, so the live
row keeps "Counter Check (3 free then". Nothing kept is removed, re-filed or repriced.

**Not measured:** this session had no production access, so how many live documents print the shape is
not known. The new signature sends live documents through Hamilton's rules re-check, as for every bump.

**Lesson:** a one-word "no fee" guard on a whole line drops every shape of the word it was not written
for. When a shape gets through it, check the same words in the price's own cell, not only the bracketed
note the first fix saw.

**Agent lesson:** knox/issue-1092-price-after-free-allowance
**Guard:** `src/lib/agents/knox/free-allowance-price.test.ts`
