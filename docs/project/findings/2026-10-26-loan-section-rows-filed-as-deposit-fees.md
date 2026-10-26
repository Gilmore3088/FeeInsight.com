# 2026-10-26: loan section rows filed as deposit account fees

**Lesson:** A row printed in a loan section of a general fee schedule ("Equity Loan", "LOAN FEES",
"HELOC - Home Equity Line of Credit") is the loan's fee, even when its words sound like an account's
(a returned check, a service charge). Read the section before filing a row under NSF, overdraft or
monthly maintenance.

**What happened (#1905):** Navy Federal's `/membership/fees-and-charges.html` (institution 4956, doc
39026, read by Knox on Oct 21) prints:

    Equity Loan
    Fee | Amount
    Home Equity Line Check returned (due to non-sufficient funds) | $29.00
    Returned loan payment | $29.00
    ...
    Tax Service Charge | $25.00

Knox filed the returned check as the account's NSF fee (raw 1001697) and the tax service charge as the
account's monthly maintenance fee (raw 1001702, from "service charge"). Darwin verified both because
each traces to its own line at its own price, and both went live (154634, 154635). The same fees from
the page's earlier copy (doc 26712, Oct 10) were already live as other lending fees (122342, 122343).
No check covered this: the NSF guard refuses a name with "loan" but not home equity, HELOC or line of
credit, "Tax Service Charge" names no loan at all, and nothing read the heading above the row.

**Cause:** Knox files a fee by its own words. The card program section rule (#1908) reads the section
above a row, but only for card programs.

**Fix:** `loanSectionFee` (`src/lib/custom-report/loan-section-fee.ts`) walks up from the fee's line
over the section's rows (price rows, a column header, "No charge" cells) to the first other line. That
line must be a loan section heading: at most 60 characters and six words, no cell bar, bullet or
sentence end, names a loan, mortgage, home equity line, HELOC or line of credit, ends on a section word,
and names no deposit, card or business product. A bare price right under it makes it a stacked row
label. Only deposit categories are read (`LOAN_SECTION_DEPOSIT_KEYS`; stop payment excluded, since a
"Loans" column heading can sit over a deposit stop payment), a row naming a deposit account or service
keeps its read, and every line printing the name at its price must sit in such a section.

- Knox v122 re-files such a read as `other_lending_fee` (`loanSectionFeeRead`). Fees move when their
  banks are next read; the stale-read floor stays at v97.
- Darwin's live re-check (`darwin/loan-section-check.ts`, `darwin.loan_section`) reads 400 documents a
  step after a cursor. Its switch `LOAN_SECTION_TAKEDOWN_LIVE` is off until James's yes on the dry run.

**Dry run (prod, read-only, Oct 26, `loanSectionFeesSql`, all institutions):** 8 live fees at 7
institutions. Each was read against its stored text and is the loan's fee.

| fee | institution | doc | name | amount | category | heading |
|---|---|---|---|---|---|---|
| 22210 | 6626 | 14538 | Non-Sufficient Funds (NSF) | $20 | nsf | Private Education Line-of-Credit |
| 104589 | 8599 | 9129 | NSF Line of Credit Checks (Per Presentment) | $14 | nsf | LOAN FEES |
| 110081 | 5524 | 16920 | Payment Return Item | $20 | nsf | Loan |
| 112985 | 4598 | 25897 | Return Check Payment | $10 | nsf | Loan Fees |
| 127645 | 6963 | 37345 | Returned Check | $25 | nsf | HELOC - Home Equity Line of Credit |
| 139498 | 7300 | 32073 | Returned Item | $30 | nsf | Loans |
| 154634 | 4956 | 39026 | Home Equity Line Check returned (due to non-sufficient funds) | $29 | nsf | Equity Loan |
| 154635 | 4956 | 39026 | Tax Service Charge | $25 | monthly_maintenance | Equity Loan |

Rejected during the sizing: a stop payment under a two-column "Loans" heading (61850, the reason stop
payment is excluded) and a returned item under the prose line "line of credit." (81625).

**Not covered here:** the Knox bump does not take the 8 down by itself. The rules recheck keeps an
unreproduced fee that still traces and passes the category guard as disputed, and this PR changes
neither the source check nor the guard.

**Guard:** `src/lib/custom-report/loan-section-fee.test.ts`, `src/lib/agents/knox/loan-section-fee.test.ts`,
`src/lib/agents/darwin/loan-section-check.test.ts`, `src/lib/agents/darwin/loan-section-check.db.test.ts`.
**Agent lesson:** `knox/issue-1905-loan-section-rows-are-loan-fees`, `darwin/issue-1905-loan-section-recheck`
