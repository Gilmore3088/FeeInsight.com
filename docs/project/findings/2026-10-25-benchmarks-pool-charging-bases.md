# 2026-10-25: benchmarks pooled fees charged on different bases

**Lesson:** A benchmark compares one charging basis per category. Every category needs a stated
basis (a period, or per event), and the medians and the subject's own value must read that one
rule; a second, data-driven idea of "the peers' basis" in one surface lets the surfaces disagree.

**What happened:** #1901 (James's Oct 18 /fees sign-off, gate 1) found a $5 monthly dormant fee
pooled with $5 one-time and per-quarter ones. Stats rule 9 (#1927, Oct 18) fixed five categories
(dormant, minimum balance, monthly maintenance, safe deposit box, IRA administration) and nothing
else. Every other category still pooled explicit monthly, quarterly, annual and daily prices with
per-item ones. Read-only counts on 2026-10-25 of `published_fee_catalog` rows the old statistics
row filter counted: returned mail had 510 rows stated monthly and 376 per item; bill pay 283 monthly and
222 per item plus 80 per occurrence or transaction; document reproduction 244 monthly beside 1,907
per item; overdraft transfer 54 daily beside 649 per item.

Hamilton worked around it with a second rule: `getCategoryChargeBases` took each category's most
common stated basis from the data, and the Pro report and the monthly briefing refused to compare a
category whose leading basis held under 80% of stated rows (`mixed_peer_basis`). On Oct 25 that
held back seven categories (share of the leading basis among stated rows): account research 77%, ACH origination 78%, bill pay 51%, late payment
49%, mobile deposit 79%, night deposit 55% and returned mail 54%. /fees, the benchmark export and
Hamilton's peer values read the statistics row filter and still showed pooled medians for them.

**Cause:** the basis rule listed the categories it covered instead of giving every category a
basis, so a category outside the list had no rule at all. The surface that noticed added its own
measure instead of fixing the shared one.

**Fix:** `fee-comparability.ts` gives every category one basis. The period categories are listed
in `CATEGORY_BASIS` (monthly: dormant, minimum balance, monthly maintenance, paper statement,
returned mail, bill pay; annual: safe deposit box, IRA administration; daily: continuous
overdraft, the daily overdraft cap). Every other category is per event, where a monthly,
quarterly, annual or daily price contradicts it. Per item stays inside a period category (it is
Knox's reading of "each", as in "$45 ea." for a box's yearly rent), except in returned mail and
bill pay, where a per-piece or per-payment fee is a different fee from the monthly one.
`basisMismatchSql` (statistics rule 9) and `basisMismatchReason` (institution page, market
eligibility, and now Hamilton's report comparison) are one rule, checked category by category
against each other. `getCategoryChargeBases`, `mixedBasisCategories` and `mixed_peer_basis` are
gone. `STATS_METHOD_VERSION` 19/20 rebuilds cached index rows.

Measured on approved rows at active institutions that pass every other row rule (78,198 rows,
read-only, 2026-10-25): rule 9 took out 429 rows
before and 2,282 after, so 1,853 more rows at 1,310 institutions in 41 categories leave the
medians and no row comes back. Medians that move (institution-level median, rule 7 not applied):
bill pay $4.00 to $2.50, late payment $20.00 to $22.50, other lending fee $30.00 to $29.95; the
other categories keep their median and some quartiles move (returned mail p75 $7.00 to $7.50,
night deposit p75 $20 to $15). Categories held back as mixed: 7 before, 0 after. No fee row is
written or taken down; each left-out row stays on its bank's page marked "Not compared".

**Not yet known:** whether James wants returned mail and bill pay compared on their monthly basis
(the leading one by institutions) or split into a monthly and a per-event benchmark. Knox's
stated frequency is also wrong on some rows (an allowance such as "after first check per day"
read as daily); those rows now leave the median rather than skew it, and the reading is Knox's.

**Agent lesson:** darwin/issue-1901-one-basis-per-benchmark

**Guard:** `src/lib/fee-comparability.test.ts` ("SQL and client rules agree on every category and frequency")
