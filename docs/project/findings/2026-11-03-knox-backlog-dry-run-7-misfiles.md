# 2026-11-03: The seventh re-read backlog dry run found charges filed by a neighbour's words

**What happened:** after Knox v175 fixed the sixth dry run (`2026-11-03-knox-backlog-dry-run-6-misfiles.md`),
a seventh read-only dry run for `KNOX_REREAD_BACKLOG_LIVE` took 40 more backlog texts (rb7) at Knox v175 and
compared every changed read with the bank's own line. It found one wrong row, four doubtful rows and one
duplicate, plus GTE FCU's future-dated schedule (its own finding,
`2026-11-03-closing-edition-line-missed.md`).

- Wrong. Jax Fire FCU (doc 42276, text 40648): "Employment Verification | $256" under "Real Estate Loans"
  was filed account_verification.
- Doubtful. USF FCU (doc 42298, text 40644): "Visa Monthly Paper Statement Fee | $1.25" under "Loans*"
  was filed paper_statement, and the deposit line "Monthly Paper Statement Fee (eStatements are free)
  *Waived for members under 18 and over 65 | $3.00" was not read at all.
- Duplicate. GTE FCU (doc 42265, text 40659): "Overdraft Transfer2,10 | $8.00" was read twice, once as
  overdraft by the rules and once as od_protection_transfer by the table reader. In production the raw
  dedupe index (document, name, amount, audience, line share) keeps only one, whichever comes first.
- Doubtful. Bay State Savings Bank (doc 42280, text 40622): the $7 charge on "Revolution Money Market - New
  Money Only*" took the section heading "Money Market Accounts" as its product.
- Doubtful. San Antonio Citizens FCU (text 40642) and Gulf Winds FCU: rows in a business section read with
  unknown audience.

**Why (root cause):**

- Jax Fire: the account_verification rule listed "employment" with deposit and account verifications, and
  it comes before every lending rule, so a loan's underwriting cost filed as an account fee.
- USF: no rule read whose account a statement fee belongs to, so the card's statement stood in for the
  deposit fee. The deposit line was lost twice over: the starred waiver note in the name's own cell
  ("*Waived for ...") was read as a waiver covering the rest of the line, including the next cell's $3.00,
  and "(eStatements are free)" read as the fee being free.
- GTE: the rules classified "Overdraft Transfer2,10" with the footnote number glued to "Transfer", so the
  transfer rule did not see its word and the overdraft rule took the name; the table reader strips the
  number. The two reads differed in category, so both were kept.
- Bay State: `distinctAccountName` (lineup.ts) saw "New Money Only" after the dash as part of the name, the
  whole did not read as an account, and the section heading won.
- San Antonio and Gulf Winds: a section heading's audience is not a rules matter; it belongs to the
  audience lessons (`KNOX_AUDIENCE_LESSONS_LIVE`, off).

**Fix (Knox v176; v174 and v175 went to PRs #2953 and #2967; table and guard unchanged):**

- rules.ts: employment, employer and income verification (and "verification of employment/income") file
  other_lending_fee, ahead of account_verification, which no longer lists employment.
- credit-card-section.ts `creditCardStatementRead`, applied in specialists.ts to candidates and holds: a
  paper statement read whose own name opens with a credit card (Visa, Mastercard, Amex, Discover, "credit
  card") and names no debit card or deposit account is left out. A deposit fee that only excludes card
  statements ("Paper statement fee (excludes ... Visa)", live 43451 and 14545) names its card later and stays.
- rules.ts `STARRED_WAIVER` and `bracketedWaiverEnd`: a starred waiver note in the name's own cell ends with
  that cell (a star inside a bracket, or one opening the line, is left to the existing rules), and
  `FREE_FOR_NOTE` reads "e-statements are free" as the way to avoid the fee.
- rules.ts `classifyNearest`: the last cell is classified after `stripFootnoteMarks`. So that "Copy of
  Paper Statement3" does not move to paper_statement, the paper_statement rule skips a copy of a statement
  and document_reproduction accepts "copy of a paper/mailed/printed statement".
- lineup.ts `distinctAccountName`: a qualifier after a dash that names no account, audience, fee or rate is
  dropped and the name before it is tried. Review of PR #2969: an age qualifier ("Under 18", "Over 55", "62+",
  "Seniors") stays in the name, so "Premier Savings - Under 18" and "Premier Savings - Over 55" are two products;
  a count, balance or purchase number ("Under 25 Transactions", "Over 25,000") is no age and leaves the bare
  account name.
- Review of PR #2967, folded in: `ITEM_INSUFFICIENT_PAID` reads an insufficient item the bank pays, naming
  no return ("Insufficient Check Paid", "Item Insufficient - Paid", "Insufficient Debit Paid"), as overdraft,
  ahead of the NSF rule; "Insufficient Funds Check Paid" and "Insufficient Items Paid" stay overdraft.
- Darwin's credit card section re-check, v2 (`darwin/credit-card-section-check.ts`): it also reads live
  flat paper statement fees whose own name opens with a credit card, by Knox's name-only rule.

**Live fees (read-only, Nov 3, prod `rmhwbbjjctzfaqjyhomu`, SELECT only):**

- No live fee is an employment or income verification, no live nsf fee is a paid-only insufficient item,
  and no live paper_statement fee is a copy of a statement.
- 2 live paper_statement fees are credit card statements: 94693 "Credit Card Monthly Paper Statement Fee"
  $3 and 135781 "Credit Card Paper Statements" $2. Knox v176 would not read them again; Darwin's v2 re-check
  matches both, and they stay live: the take-down is behind `CREDIT_CARD_SECTION_TAKEDOWN_LIVE` (off) and
  waits for James's yes.

**Re-run after the fix (the dry-run harness, `currentVariant` on the same stored texts, v175 vs v176):**

- rb7: Jax Fire's row is other_lending_fee; USF's Visa statement is gone and the $3.00 deposit fee is read
  (as is rb6's same page, text 37530); GTE's duplicate is gone; Bay State's $7 is "Revolution Money Market".
- rb: one new right read, "Business Account Paper Statement Delivery (e-statements are FREE)" $3.
- rb2: TFed's "Verification of Employment" $79 under "Lending Fees" re-filed to other_lending_fee.
- rb3, rb4 and rb5 do not change for these fixes (the price-first naming fix that rides v176 renames some
  monthly fee reads; see `2026-11-03-price-first-line-name-garbled.md`). Across rb to rb7, with both fixes, the publish reads go from 4,691 to 4,692 and the live fees not
  reproduced stay 286; no right read is lost.

**Left for the Knox tracker:** San Antonio Citizens' and Gulf Winds' business-section audience (a section
heading's audience is the audience lessons' work).

**Guard:** `src/lib/agents/knox/backlog-dry-run-7.test.ts`, `src/lib/agents/darwin/credit-card-section-check.test.ts`.
**Agent lesson:** knox/backlog-dry-run-7-2026-11-03-whose-charge-the-name-says
