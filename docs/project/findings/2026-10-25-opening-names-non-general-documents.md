# 2026-10-25: a document's opening names what it is

**Lesson:** Read what a document says it is before taking its fees as the institution's general
personal schedule. A document whose first lines title it a loan, card or line-of-credit disclosure,
or say it applies to youth, teen or student accounts, is not that schedule, whatever its address
says and even when its fees carry deposit names (NSF, monthly fee). A youth word in the address
alone decides nothing: youth pages often carry the general schedule.

**What happened:** #1944 found live prices set by documents that are not the general schedule:
- TD Bank (institution 12): `td-fit-account-guide-acc-en.pdf` opens "TD Fit Personal Unsecured
  Consumer Loan Disclosure". It gave a live $0 monthly fee and a $0 NSF fee. TD's deposit schedule
  has no NSF fee.
- Arbor Financial (7322): `Volt Disclosures 4.pdf` opens "The following additional disclosures
  apply to the Volt Teen Banking & Volt Banking accounts". It gave a $0 NSF fee and a $0 overdraft
  transfer. Arbor's general schedule charges $35 NSF and a $5 transfer (issue).
- A TD learning article's overdraft fees, the issue's third example. These were already taken down
  under `article_page` on Oct 17-18 (#1774, closed), so this PR does not cover them.

**Cause:**
- Magellan's companion finder (`discover.second_document`) chose the TD Fit guide (companion
  attempts 8601 and 8608) and the youth schedules. The fee-page check (`find-validate.ts`) judged a
  candidate by its address and its fee lines.
- The shared classifier `src/lib/non-deposit-document.ts` (#1442) read only the address and title.
  The TD Fit address has no loan word, and an address youth word is unsafe: GTE's
  `/go-student-checking` carries 27 general fees.
- Rosetta typed the TD Fit guide as `fee_schedule`, so nothing downstream asked again.

**Fix (#1944):**
- New in the shared classifier: `documentOpeningKind(text)` with its Postgres twin
  `documentOpeningKindSql`.
  - It reads the first three non-empty lines of a text's first 2,000 characters.
  - A loan opening: a line, or two adjacent lines, that titles a loan, card or line-of-credit
    disclosure or agreement. It excludes overdraft lines of credit and business card agreements.
  - A youth opening: a title on line 1 or 2 ("Youth Member Fee Schedule", "Teen Checking
    Addendum"), or a subject line saying the disclosures apply to a youth, teen or student account.
    A negated or "all accounts" line does not count.
  - JS and SQL agree on all 23 fixtures (prod VALUES check, 0 mismatches).
- Magellan:
  - `find-validate.ts` refuses such a candidate, PDF or HTML (`loan_document`,
    `youth_account_document`).
  - The companion finder refuses one too (`SECOND_DOCUMENT_FINDER` v5,
    `DISCOVERY_METHOD_VERSION` v7).
- Darwin's live re-check `darwin.non_deposit_document` v4:
  - It reads each live fee's document opening (newest completed `agent_source_texts`).
  - New rules: `loan_titled_document` and `youth_account_document`. Each is counted on its own
    behind `OPENING_DOCUMENT_TAKEDOWN_LIVE`, off until James's yes on the count.
  - Hamilton's publish gate asks the same reason with the same switch.

**Dry run (prod, read-only, Oct 25):**
- The opening rules match 48 live fees on 18 documents at 16 institutions:
  - `loan_titled_document`: 41 fees on 16 documents (card and VISA disclosures, a HELOC packet,
    TD Fit);
  - `youth_account_document`: 7 fees on 2 documents (Arbor's Volt disclosures, a Youth Fee Schedule).
- Before v4, the re-check matched none of the 48.
- None of the 18 documents has an address-named kind.

**Not done here:**
- Arbor has no other live NSF fee. Taking the Volt fees down leaves a gap until Magellan finds its
  current general schedule.
- Hamilton's depth query does not yet read the opening. This is harmless while the sub-switch is
  off.
