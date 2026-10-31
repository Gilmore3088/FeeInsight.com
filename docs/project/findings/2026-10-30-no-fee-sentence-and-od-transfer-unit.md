# 2026-10-30: Hamilton proof run, two Knox misreads (a deposit after a no-fee sentence; an overdraft transfer filed as overdraft)

## (a) ESL FCU's $1 opening deposit live as a $1 monthly fee

**What happened:** Live fee 68597 (ESL FCU, institution 6843, document 21968, text 18587) is a $1
`monthly_maintenance` fee named "It’s easy to open. It makes banking more convenient. There are no
minimum balance requirements or monthly service fees." The page reads: "There are no minimum
balance requirements or monthly service fees. And you can get started with only a $1 deposit."
The $1 is the opening deposit; the page charges no monthly fee.

**Cause (Knox extraction):** The paragraph is under 280 characters, so it is read as one segment.
The rules pass names a price by the nearest fee words before it (`classifyNearest`), which were
"monthly service fees" in the sentence before the price's. The guard that drops a line saying a fee
is not charged (`NEGATIVE_FEE_LANGUAGE`) allows at most two words between "no" and "fee", so "no
minimum balance requirements or monthly service fees" passed. The account family expert's price
windows read it the same way (its `NEGATIVE_NAME` has the same two-word limit). Widening that guard
on the whole line is wrong: it would drop 3 correct live fees whose line also says "no ... or ...
fee" (67404, 77951 "There are no minimum balance requirements and the monthly fee is $3.95", 88733).

**Fix (Knox v143):** `priceAfterNoFeeSentence` (`knox/rules.ts`), asked by the rules pass and the
family experts: a price is not read when its whole sentence, before and after it, names no fee and
an earlier sentence on the line says "no ... fees" with no condition after it. A conditional
no-fee sentence ("No monthly service fee with an average daily balance of $750+. Otherwise, it's
only $9.75/month", live 139379) waives a fee the next sentence prices, and is read as before.

**Live re-check:** `darwin/no-fee-sentence-check.ts`, behind `NO_FEE_SENTENCE_TAKEDOWN_LIVE`
(off). Hamilton's rules re-check would not take 68597 down after the v143 bump: its name and price
still trace in the text, so the second look keeps it as "disputed".

**Dry run (prod, read-only, Oct 30):** the check's SQL pre-filter selects 19 live flat fees whose
stored line has "no ... fee/charge" then a sentence break before a price (fixture
`src/lib/agents/darwin/__fixtures__/no-fee-sentence-live-2026-10-30.json`). 1 matches: 68597. The
other 18 name their fee in the price's own sentence ("If not met $5 Service Charge", "Paper
Statement fee is $3"), state a condition (139379, 140267), or are table rows.

**Agent lesson:** knox/proof-run-2026-10-30-no-fee-sentence-is-not-a-price
**Guard:** `src/lib/agents/knox/no-fee-sentence-price.test.ts`, `src/lib/agents/darwin/no-fee-sentence-check.test.ts`

## (b) Flagstar's linked-account overdraft transfer live as an overdraft fee at $0

**What happened:** Live fees 83142 and 159833 (Flagstar, institution 33, documents 21266 and
39765) are `overdraft` at $0, named "Linked Account (Deposit Overdraft (OD) Protection) transaction
fee". The guide's row reads "Linked Account (Deposit Overdraft (OD) Protection) transaction fee | No
charge", so $0 is right; the category is wrong. The same guide prints its overdraft fee on its own
row ("Overdraft Charge (each) | $10.00").

**Cause (Knox categorisation):** The `od_protection_transfer` patterns look for "overdraft
protection", "OD protection", "linked account ... overdraft protection" or "overdraft ...
transfer". "(OD)" between "Overdraft" and "Protection" broke every one, and "transaction" is not
"transfer", so the row fell through to the `overdraft` pattern. In the same class, rows priced by
the transfer were filed by their short name: "Overdraft | $5.00/Transfer" (Notre Dame FCU, 4944),
"Overdraft Fee | $10.00/Transfer" (Acadian FCU, 5114), "Overdraft Fee ... $10 / transfer" (5072),
"Overdraft (O/D) Protection | $12.00 per automatic transfer to a checking account from a savings
account" (386). Each of those schedules prints its paid-overdraft or NSF fee on another line. #1291
read a per-transfer unit only for a bare "Overdrafts" name. The family expert also cut "Overdraft
Transfer from Rediline Overdraft Loan" to "Rediline Overdraft Loan" (5020) and filed that as overdraft.

**Fix (Knox v143, table pass v11):** `classifyPatternKey` reads "Overdraft (OD|O/D|ODP)
Protection" as "Overdraft Protection"; `overdraftPricedPerTransfer` files any overdraft name priced
per transfer as the transfer (rules pass, table pass and overdraft family expert); "transfer from /
to cover overdraft" is the transfer; the family expert keeps the row's own words when they name the
transfer.

**Live re-check:** `darwin/od-transfer-refile-check.ts`, behind `OD_TRANSFER_REFILE_LIVE` (off).
It re-reads each candidate's stored line with today's free Knox team and re-files in place (price
unchanged, nothing taken down).

**Class count and dry run (prod, read-only, Oct 30):** 3,403 live `overdraft` fees; 121 have
"transfer", "sweep" or "protection" in the name or stored line. The check's pre-filter (live, flat,
stored line says one of them) selects 123 on Oct 30 (fixture
`src/lib/agents/darwin/__fixtures__/od-transfer-live-2026-10-30.json`); one candidate was rolled back
Oct 31, so 9 of 122 candidates live today:
- `refile` 9 at 7 institutions: 83142, 159833 (33), 45105 (386), 125311, 125312 (4944), 136182
  (5114), 141330 (5072), 64609 "Transfer from Overdraft Loan | FREE" (6770), 46595 (5020).
- `per_item` 1: 51252 "Overdraft Protection / $30.00 per item", a paid-overdraft program that the
  older bare-name rule (`^overdraft protection$`, unchanged here) would read as a transfer. The check
  never moves a fee its line prices per item; the bare-name rule itself is left for a Knox follow-up.
- `still_overdraft` 1 (105614), `not_read` 112: paid-overdraft programs ("Courtesy Pay Overdraft
  Protection", "Bounce Protection") and lines that only mention transfers as debit types.
- Not moved, though worth a look: 109666 "Savings Overdraft / $0 No Transfer Fee for Savings Overdraft
  Transfer" (18) and 79931 "$25.00 for every transfer that has to be made to cover overdrafts" (5976)
  read nothing at their price today.

**Agent lesson:** knox/proof-run-2026-10-30-overdraft-transfer-is-not-overdraft
**Guard:** `src/lib/agents/knox/overdraft-transfer-category.test.ts`, `src/lib/agents/darwin/od-transfer-refile-check.test.ts`
