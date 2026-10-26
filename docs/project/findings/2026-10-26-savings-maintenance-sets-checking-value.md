# 2026-10-26: a money market account's own monthly charge set M&T's checking value
**What happened:** M&T Bank (institution 21) has four live monthly maintenance fees: $4.95, $14.95
and $24.95 from its checking schedule (document 14550) and $20 from its Preferred Money Market product
page (published 109815, raw 491668, document 24707, text 21879). All four had no account
(`product_name` NULL). Statistics rule 11 takes the median of an institution's rows in a category,
and treated no account-priced row as an exception, so M&T's monthly maintenance value was $17.475,
not its checking median of $14.95 (#1912).

**Cause:** two gaps. Knox's `accountProductFor` (`knox/lineup.ts`) read the account only from the
row label or model read, an account table's column, an account heading within 12 lines and the fee's
own name. The $20 was read from "The $20 monthly maintenance charge is waived if:" under the heading
"Understanding the monthly maintenance charge"; the line above, "The M&T Preferred Money Market
account has a $20 monthly maintenance charge.", names the account as the sentence's subject, and
nothing read it. And rule 11 never set a non-checking account's own fee apart: on Oct 26, 91 live
statistics rows in monthly maintenance and minimum balance already named a savings, money market,
certificate, IRA, HSA or club account, and 40 of them pooled into 37 institution values beside
checking or unassigned rows.

**Fix:**
- Knox v126: `accountSubjectProduct` reads, as the last resort, the account a sentence on the fee's
  line or the line above names as subject at the fee's own price. No page title or address is read
  (M&T's page lists five other savings products).
- Statistics method 23 (rule 11, `fee-product.ts` `isProductException` / `productExceptionSql`, with
  `account-kind.ts` and its SQL twin): in monthly maintenance and minimum balance, a savings, money
  market, certificate, IRA, HSA or club account's row is an exception, so the bank's value rests on its
  checking and unassigned rows; with none, its rows count as before. A stored name that names no
  account ("Truth in Savings"), or that also says checking, share draft or demand or names loans
  ("Money Market Checking", "Share and Loan Accounts"), is not read as one: `accountKind`'s
  money-market-first order is for Knox's heading reads and would set checking prices aside. Rows stay live and listed. Dry run (prod,
  read-only, Oct 26): 40 rows leave 37 values, 27 values at 27 institutions change.
- `correctAccountSubjects` (`knox/account-subject-correct.ts`) fills live NULL rows, behind
  `KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE` (off), only in bank- or state-scoped extract steps. Dry run
  (prod, read-only, Oct 26): of 2,929 live NULL rows in the two categories, 50 sit on texts with a
  subject sentence and 4 qualify: M&T 109815 ("M&T Preferred Money Market"), The Peoples Bank 131221
  ("Regular savings", minimum balance, its only row there, so its value stays $5), Fort Worth City FCU
  137327 ("Fresh Start checking") and Aberdeen Proving Ground FCU 153281 ("Member Protect Checking").
  Once applied, M&T's value becomes $14.95.

**Lesson:** a fee with no account counts as the bank's checking price, so read the account its own
sentence names, and keep a savings account's own fee out of the checking value.

**Agent lesson:** knox/issue-1912-account-named-in-fee-sentence
**Guard:** `src/lib/agents/knox/account-subject.test.ts`, `src/lib/agents/knox/account-subject-correct.test.ts`, `src/lib/account-kind.test.ts`, `src/lib/data-store/fee-stats.test.ts`
