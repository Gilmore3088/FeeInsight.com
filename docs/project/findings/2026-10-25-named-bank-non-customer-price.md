# 2026-10-25: a non-customer price that names the bank made a free notary fee look conditional

**Lesson:** A price for people who are not the bank's customers is another party's price, not a
condition on the customer's $0, even when the bank prints its own name in the phrase ("$5.00 charge
for non-F&M customers"). Only a capitalised name that is not a condition word counts, so "$5 for
non-eStatement customers" stays a condition. Before an older-live re-check goes on, run it over
every older live row and read each failure against the bank's own text.

**Agent lesson:** darwin/issue-1568-named-bank-non-customer-price

**Guard:** `src/lib/agents/darwin/verify.test.ts` ("conditionalZero on run-on lines": 13219 moved
to the free list, plus named-bank and condition-word cases) and
`src/lib/agents/darwin/verified-recheck.db.test.ts` (the default now gives an older live row its
first look only).

**What happened:** `DARWIN_RECHECK_OLDER_LIVE` (#1568) was off, so the verified recheck never read
the 3,266 live fees verified under older `verify.rules` versions. A read-only dry run on Oct 25 ran
main's `recheckAssessment` over all of them against their stored `agent_source_texts`. Five failed,
all `conditional_zero`. Four are right. The fifth is F&M Bank (institution 2279), published 13219,
"Notary Fee" $0. The bank's text reads "Notary Fee ($5.00 charge for non-F&M customers)
....No Charge". The $0 is the customer's price. `NON_CUSTOMER_PRICE` in
`src/lib/agents/darwin/verify.ts` recognised "non-customers" and "non-members" but not a name
between "non-" and "customers", so the $5 read as the price the customer falls back to. A #1571 test
(Oct 16) had pinned 13219 as conditional.

**Fix:** `withoutNamedNonCustomerPrice` in `verify.ts` drops a price that sits within 25 characters
of "non-<Name> customers/members/clients/account holders" when the name is capitalised and is not
one of `CONDITION_WORDS`. `conditionalZero` is the one rule, shared by `postSourceCheck` (verify and
the recheck) and the conditional-$0 resolver (`conditional-zero-resolve.ts`), so all three stay the
same. `checkFeeAgainstSource` (`src/lib/custom-report/source-check.ts`) matches amounts and has no
conditional-$0 rule, so it needs no change.

**Dry run after the fix (prod, SELECT only, Oct 25):** the same 3,266 rows (id list, row fields and
all 1,667 latest texts checked identical by md5 to the first run) give 4 failures, all
`conditional_zero`, each read against the bank's text:

| Published | Institution | Fee | Bank's text | Right? |
|---|---|---|---|---|
| 10808 | 2033 | Service charge (NOW Account, minimum daily balance $1,000) $0 | "minimum daily balance of $1,000 ... No Charge"; "below $1,000 ... $10.00*" | Yes |
| 11756 | 8434 | Express Checking Monthly Fee $0 | "$0 with e-Statements and Direct Deposit ... – $5 ... – $10" | Yes |
| 11772 | 8434 | 1st Checking Monthly Fee $0 | "$0 with e-Statements. Without e-Statements – $5." | Yes |
| 11923 | 8434 | Dividend Checking Monthly Fee - Waived $0 | "Dividend Checking Monthly Fee: $5. $0 with average daily balance of $1000." | Yes |

For 11923 the recheck traced the line to the cashier's check row of the same document, not the fee's
own line; the verdict still holds on the fee's own line and stored condition.

All 48 pending `darwin.verified_recheck` flags sit on fees that are already down, so
`DARWIN_RECHECK_SECOND_LOOK_LIVE` confirms nothing today. With both switches on, those 4 fees are
flagged on the first look and come down only if a run 12 hours later fails them again.
`DARWIN_RECHECK_SAME_STEP_TAKEDOWN` stays off. Of the conditional-$0 holds (1 row), none has a
named-bank non-customer clause, so the looser rule releases none.
