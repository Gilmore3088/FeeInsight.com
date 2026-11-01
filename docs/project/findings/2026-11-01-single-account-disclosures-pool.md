# 2026-11-01: single-account disclosures pooled with the general fee schedule

**Lesson:** A short disclosure whose title names one account and that sends the reader to the
general fee schedule prints that account's own prices. Knox now reads its fees as that account's
(behind `KNOX_SINGLE_ACCOUNT_OWNER_LIVE`, off by default), so statistics rule 11 keeps the general
price as the bank's value and lists the account's price beside it.

**What happened (#1911, after the U.S. Bank recovery):** the recovery switch turned on on Oct 31
and U.S. Bank's two Safe Debit fees took their product on Nov 1 00:40 UTC (published 142603 and
142604, `pipeline_feedback` 6945238/6945239; prod read-only, Nov 1). Their values are now $3.00
(ATM) and $5.00 (money order), with the Safe Debit prices listed beside them. The issue's wider
defect, product-specific prices pooled into one institution value, remained for every other layout.
Knox's ownership (`primaryAncillaryProduct`) knew one layout only: an "<Account> Pricing and
Information" title with an "Account terms and fees" block.

On prod (read-only, Nov 1), 1,608 institution/category groups pool different amounts from more
than one document, all with no product. Reading the openings of the documents behind them found
one-page sheets for single accounts beside the general schedule, for example:
- First Federal Community Bank (1170): "First Fed Bank On Account Disclosure" prints the Bank On
  account's out-of-network ATM fee at $2.50 (published 110886); the bank's value pooled it with a
  $4.99 row into $3.745.
- Zing Credit Union (8570): "Information about your Second Chance Checking Account" prints a $2.00
  paper statement fee (127284); the general fee page prints $3.00 (68920), and the value read $2.50.
- Bank of Hawaii (94): "BANKOHANA - LEVEL I CHECKING – Outline of Basic Terms & Conditions" prints
  $1 for a transfer at another bank's ATM (68315), pooled into the ATM value with $3.00 and $5.00.

**Cause:** the ownership rule was written for one bank's layout (#2179), so every other
single-account document's fees read as the bank's general prices. Statistics rule 11 (#2670) can
only set an exception aside when the row carries its account.

**Fix:**
- `singleAccountDisclosure` (`src/lib/agents/knox/ancillary-product.ts`), a second form that
  `primaryAncillaryProduct` accepts: a text of at most 12,000 characters and 30 priced lines whose
  title opens it and names one account (six title shapes seen on prod), that defers to the general
  fee schedule ("refer to our Fee Schedule", "Please see … Fee Schedule"). It refuses when another
  account stands alone as a heading or column, when a title line names another account, when a
  section applies to all accounts (document 18704 prints "Other Service Fees (applicable to all
  accounts)" under a share draft disclosure), or when the name is generic, non-deposit or the
  bank's own. The whole text is the account's block, so Darwin's re-witness (`ownedSourceText`)
  and Hamilton's copy checks narrow to it.
- `withAncillaryProduct` labels from this form only while `KNOX_SINGLE_ACCOUNT_OWNER_LIVE` is on.
  The recovery (`knox.ancillary_owner_correct` v2) plans both forms, applies the pricing-guide form
  as before, and holds single-account changes while the switch is off (listed, not written; the
  attempt fingerprint `v2-sa-off:<text id>` brings the document back once the switch is on).
- No fee is held, rejected, re-filed or taken down: a labelled row stays live and is re-witnessed
  against the same text. Only the institution value changes, through rule 11.

**Dry run (read-only, Nov 1):** 8,134 documents carry a live Knox fee with a positive amount and
no product; 212 of them are short and open with a title shape; 9 qualify. Of the 17 live rows on
those 9 documents with no product, 8 would take their account (account-priced monthly fees are
never assigned). Every mover passes `checkFeeAgainstSource` on its stored text:

| Published | Raw | Inst | Doc | Fee | Amount | Account | Value change |
|---|---|---|---|---|---|---|---|
| 110886 | 502645 | 1170 | 24910 | Out of Network ATM Fee | 2.50 | First Fed Bank On Account | ATM 3.745 to 4.99 |
| 127284 | 591435 | 8570 | 27312 | Paper Statement Fee | 2.00 | Second Chance Checking Account | paper 2.50 to 3.00 |
| 68315 | 285230 | 94 | 20067 | Other than a Bank of Hawaii ATM++ | 1.00 | BANKOHANA - LEVEL I CHECKING | ATM 3.00 to 4.00 |
| 68316 | 285231 | 94 | 20067 | Non-Sufficient Funds Item Paid/Overdraft Fee | 30.00 | BANKOHANA - LEVEL I CHECKING | none (general 30.00) |
| 68317 | 285232 | 94 | 20067 | Non-Sufficient Funds Item Returned/Returned Item Fee | 30.00 | BANKOHANA - LEVEL I CHECKING | none |
| 142782 | 679128 | 94 | 33544 | Stop Payment Order Fee | 35.00 | PERSONAL MONEY MANAGEMENT CHECKING | none |
| 136775 | 649819 | 7949 | 29698 | Option: Overdraft Transfer Fee | 5.00 | Rewards Checking | none (only row) |
| 146751 | 729508 | 8593 | 35063 | Paper Statement Fee | 2.99 | First Checking | none |

**Not yet known / not fixed here:**
- The general rows that now set two of these values are themselves suspect: First Federal's $4.99
  (110884, document 24908) reads "ATM fees of $4.99 or less will be reimbursed", a refund limit,
  not a fee; Bank of Hawaii's $3.00 and $5.00 (68313/68314) come from the EASE account's own
  outline (document 20066), whose title names no account word, so it stays unassigned, and $5 is
  the international fee before its 3%.
- Free ($0) rows are outside ancillary ownership, as in #2179, so Albany Bank's $0 paper statement
  and ATM rows on its account sheets (35511, 35984) and UW Credit Union's Launch Account $0 rows
  (1962) still pool.
- A single-account disclosure that never refers to the general schedule (Trumark's checking
  disclosures, 24554/24555/39544) stays unassigned.

**Agent lesson:** knox/issue-1911-single-account-disclosure-owner

**Guard:** `src/lib/agents/knox/ancillary-product.test.ts` ("single-account disclosures name their
account", real stored texts in `src/lib/agents/knox/__fixtures__/single-account-disclosures/`),
`src/lib/agents/knox/ancillary-owner-correct.test.ts` ("single-account disclosures in the recovery")
