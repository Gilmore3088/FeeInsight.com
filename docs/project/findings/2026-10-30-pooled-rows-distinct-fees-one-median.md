# 2026-10-30: "pooled rows" at M&T and Navy Federal are distinct fees blended into one median

**Lesson:** An institution's value for a category is only a real price when its rows are the same
fee. Rows for different accounts, loans or services that land in one category without a name that
tells them apart are blended into one median, often a price nobody is charged. Fix it at the input
(read which account or section each row belongs to, retire a superseded copy's row) before the
statistic, and never by averaging.

**What happened (Hamilton proof run, Oct 30):** the run flagged "pooled rows" at M&T (institution 21)
and Navy Federal (4956). Neither is rates pooled with dollar amounts: neither bank has a row in
`published_fee_rate_catalog`, and every row in `published_fee_catalog` is `amount_kind = 'flat'`. It
is several live rows in one category, which the per-institution value (`institutionValue`, the
median of the institution's own amounts, `src/lib/fee-institution-value.ts`) blends:

| Bank | Category | Live rows | Median |
|---|---|---|---|
| M&T | monthly_maintenance | 68598 $4.95, 91563 $14.95, 91564 $24.95, all named "Monthly Maintenance Charge", no account | $14.95 |
| Navy Federal | other_lending_fee | 154641 $0 "Returned loan payment fee" (Checking Line of Credit section, doc 39026); 148629 $29 "Returned loan payment" (Equity Loan, doc 39026); 122342 $29 "Home Equity Line Check returned"; 122343 $25 "Tax Service Charge" (both doc 26712, superseded by 39026) | $27.00 |
| Navy Federal | late_payment | 122341 $20 "Late payment fee", 122340 $29 "Consumer loan late fee" | $24.50 |
| Navy Federal | stop_payment | 122338 $20 single item, 122339 $25 range or series | $22.50 |

**Causes (three, none shared with the Global FCU NSF finding of the same day):**
1. M&T, Knox drops the account (input). The page (doc 14550, text 3233) is a card per account:
   "MyWay Banking from M&T®" ... "Monthly Maintenance Charge" / "$4.95/month", then "MyChoice Plus"
   ... "$14.95/month", then "MyChoice Premium" ... "$24.95/month" (and "EZChoice" ... "$0/month",
   not live). Knox's lineup reader names a fee by an account heading only when the heading has an
   account word (`distinctAccountName` in `knox/lineup.ts`: checking, savings, share ...); none of
   M&T's brand names does, so all three rows go live with the same generic name and no
   `account_product_type`. Re-run on Knox v140 (Oct 30): still read unnamed. An Oct 6 paid read had
   named them ("Monthly Maintenance Charge (MyChoice Plus)") but did not go live.
2. Navy Federal, a superseded copy's rows stay live (input). 4 of its live fees come from copies
   15428 and 26712, which Magellan superseded with 39026; they stay beside the current copy's rows
   (#2477). Read-only, Oct 30: 5,740 live fees at 1,473 institutions come from a superseded copy;
   887 of them sit beside a live fee in the same category, at a different amount, from the newer copy.
3. One category holds several fees (statistic). Other lending is a catch-all, and late payment and
   stop payment hold a fee per product or per item count. The statistic takes the median of whatever
   rows are live. Read-only, Oct 30 (excluding overdraft, which takes the highest tier): 9,101 of
   61,257 live institution-category groups at 3,311 institutions hold two or more different amounts,
   and in 6,609 the plain median is a price no row has. These counts are before the #1911
   product-exception filter (`statisticsRows`), so they are an upper bound. How to show several
   accounts' fees (range, entry-level account) is the open design question on #1060.

**Fix:** none in this PR. Each cause has an open issue: Knox account names on card pages (#1100,
monthly maintenance reading), superseded-copy rows (#2477), and the statistic over several
products (#1060, waiting on James's choice of comparison point; #1911 for named exceptions).
Navy Federal's misread rows are also on #1905.

**Guard:** none yet; each issue above names its own.
