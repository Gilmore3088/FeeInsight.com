# 2026-10-25: prepaid and gift card sections inside a bank's own schedule were read as account fees

**Lesson:** A card program is not only its own document. A general fee schedule can end with a
prepaid, payroll, gift or travel card section, and its rows are the card's fees, not the deposit
account's. Classify by the section a fee is printed in, not only by the document's address.

**What happened:** #1908 (SchoolsFirst FCU, institution 6741) found 10 live fees from its payroll
card disclosure. That class was already closed on `main` by the document-level rule: the shared
classifier's `card_program` kind (`src/lib/non-deposit-document.ts`), Darwin's
`card_program_document` re-check (switched on 2026-10-18) and Hamilton's publish gate. A read-only
check on 2026-10-25 found no live fee left on a card program's own document except 4 purchase or
reload prices, which stay on purpose. SchoolsFirst's payroll card rows are down, and its $22 Standard
Overdraft and NSF (raw 951515 and 951514, doc 20747) are live as 155319 and 155318 since
2026-10-20 01:40 UTC.

The same class inside a general schedule was not closed. Navy Federal's
`/membership/fees-and-charges.html` (doc 26712, then 39026) prints "Prepaid and Gift Cards" /
"Visa® Gift Cards" / "GO Prepaid Cards" sections after its deposit fees. Knox read "Lost/Stolen
Card" $5 as `card_replacement` and the GO Prepaid card's "Visa/PLUS Network ATM ... cash
withdrawal and balance inquiry" $1 as `atm_non_network`. They were taken down by hand on Oct 18
(#1905), and every re-read of the page published them again (Oct 20 and Oct 21, "source_mismatch:
#1905 (re-read of #122351)" and "(re-read of #129718)"). The output was fixed three times and the
step that made the error was never changed.

**Why the $22 overdraft and NSF were missing (#1908, read-only):** the October 7 read of mk360-fees.pdf
(raw 307805) kept only the last wrapped line of the overdraft bullet as its name, "(NSF) available
balance and paid" $22. It was never verified, and the NSF bullet got no raw row. That was the wrapped
fee-bullet reading problem in [2026-10-19-wrapped-fee-bullets](2026-10-19-wrapped-fee-bullets.md).
After that fix, the October 20 re-read gave "Standard Overdraft" and "NSF" at $22, which Darwin
verified and Hamilton published. No further pipeline change is needed for it.

**Fix (input and process first):**
- One shared rule, `src/lib/custom-report/card-program-section.ts`: a price row sits in a card
  program section when the first non-row line above it is a card program heading. A heading is
  short, has no "|", is not bulleted, names a prepaid, payroll, gift or travel card with the word
  card, names no debit card, deposit account, credit card or business, holds no row value
  ("varies", "see", "free") and does not end in a singular fee word. A bare price right under it
  ("Gift Cards" / "$3.50") makes it a stacked row label instead, and so does a priced card row
  right above it that it wraps from ("... Reloadable Card/ Visa $5.00" / "Travel Card"). A line
  that says "no" ("No Purchase Fee VISA Travel Money Cards & Gift Cards") is a perk, not a heading.
  The walk covers at most 20 non-empty lines. A row that names an account or a deposit service
  (including share, draft, dormancy, payment, package, perks and loan) stays the account's, and a
  row labelled only by audience, unit or purchase ("Members | $3", "Per card $2.50", "Initial:
  $12.00") is the card's purchase price and stays.
- Knox v116 leaves those rows out of the text before any specialist reads it
  (`withoutCardProgramSections`), keeping the card's purchase, issue or reload row.
- Darwin re-checks live fees with the same rule (`src/lib/agents/darwin/card-program-section-check.ts`).
  Its switch is the code constant `CARD_PROGRAM_SECTION_TAKEDOWN_LIVE`, on since 2026-10-25 with
  James's yes: all 12 dry-run fees were read against the bank's text and are the card's, so it qualifies
  under the sampled-clean rule (DECISIONS 2026-10-20). It reads at most hourly and uses the shared
  12-hour second look. It reads only texts that name a card program, through a plain alternation,
  newest text first, choosing the documents before joining their fees once (about 6 s for all 1,985
  such documents); a read that hits its 2,000-document limit says `truncated`. The line test runs in
  JS. It takes a fee down only when every line that prints the fee's name
  at its price is in such a section, and it keeps card purchase and reload prices.

**Dry run (prod, read-only, 2026-10-25, `cardProgramSectionFeesSql` with the final rule and the
plain-alternation prefilter, run in two document-id ranges for the SQL tool's 60-second limit):** 12
live fees on 9 documents at 9 institutions would come down (51427, 57593, 63387, 71190, 71191,
110683, 113630, 139329, 139330, 139331, 146563, 148100), each read against the bank's text and the
card's fee. 35 card purchase or reload prices in such sections stay. 1,985 of the 8,913 documents
behind live fees name a card program and are read. On the latest copies of those documents, Knox
v116 leaves out only card program rows (card fees, card prices with a plain label such as "Travel
EMV Card", and non-fee lines such as a copyright footer under a card heading).
Earlier drafts of the rule also matched 9 account fees, and every one of them led to a narrower rule:
USSFCU's "Reloadable cards Separate schedule Varies" row label, Evolve's "Pre-Paid Services Charges",
Bronco's bulleted "• Travel Card" from a second column, UCCU's "Visa Gift Card Fee" label, and
two-column interleaving at ELGA and Bank Pinnacle. Each now has a test.

**Not fixed here:** a fee stated as a rate (SchoolsFirst's 0.2% currency conversion) is not in the
Darwin re-check, which reads dollar fees. Knox v116 does leave a rate row in a card section out of
new reads.

**Guard:** `src/lib/custom-report/card-program-section.test.ts`, `src/lib/agents/darwin/card-program-section-check.test.ts`
and `src/lib/agents/knox/card-program-section.test.ts`
**Agent lesson:** knox/issue-1908-card-program-sections-are-not-account-fees
