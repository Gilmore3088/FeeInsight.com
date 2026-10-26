# 2026-10-26: a home equity line's returned check went live as the account's NSF fee

**Lesson:** A deposit fee's words (a returned check, insufficient funds, an overdraft) do not make it
the deposit account's fee when its own name names a loan. A home equity loan or line, a HELOC or a line
of credit prices that loan. Read the product the name names before its fee words, and remember that an
overdraft (protection) line of credit is the checking account's overdraft protection, not a loan.

**What happened:** Navy Federal's fee page (doc 39026) prints "Home Equity Line Check returned (due to
non-sufficient funds) | $29.00" under "Equity Loan". Knox filed the row as the account's NSF fee by its
words, Darwin verified it because it traces to the page at $29, and it went live on Oct 21 as 154634,
beside the same row from the page's earlier copy, 122342, which a hand fold had already moved to
`other_lending_fee` for #1655. The category guard refused a home equity line's stop payment by name
(v80) but read no loan product in NSF or overdraft names. The loan section re-check (#2703,
`loan-section-check.ts`) reads the section heading instead and waits behind its switch. About 6 live
fees carry such a name (count in the PR).

**Fix (guard v97):** `LOAN_LINE_NAME` in `src/lib/fee-category-guard.ts` names a HELOC, a home equity
loan or line, an equity loan or line, or a line of credit that is not an overdraft (protection) or OD
line of credit, in a name that names no checking, savings, share or deposit account (as v80's stop
payment rule). NSF and overdraft refuse such a name, and the guard re-files it to `other_lending_fee`
(`LOAN_LINE_TARGET`), after the transfer and paid-item re-files so those keep their own types.
Hamilton's live guard moves it in place (`RESTORE_REFILES`) unless a live other lending fee at the same
bank and price is its twin: 154634 beside 122342 is not moved and goes to the second look. Darwin's
live re-check runs through the guard catch-up the version bump queues. Dry-run counts are in the PR.

**Guard:** the v97 cases in `src/lib/fee-category-guard.test.ts` and
`src/lib/agents/hamilton/category-guard.test.ts`.
**Agent lesson:** `darwin/issue-1905-equity-line-nsf`
