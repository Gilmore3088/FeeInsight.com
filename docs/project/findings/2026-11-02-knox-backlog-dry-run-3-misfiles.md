# 2026-11-02: The third re-read backlog dry run found column labels, a dividend threshold and an online service read as fees

**What happened:** after Knox v168 and v169 fixed the second dry run
(`2026-11-02-knox-backlog-dry-run-2-misfiles.md`), a third read-only dry run for
`KNOX_REREAD_BACKLOG_LIVE` took 40 more texts from the backlog (rb3) at 5cd565cbe43 (Knox v169, guard
v108). Each text was read with that head's Knox (`currentVariant`), passed through the Darwin verify and
Hamilton publish checks that can be replayed, and compared with the live fees on its document. Four
reads were wrong against the bank's own stored text:

- River Town FCU (institution 6757, doc 41792): the page's responsive table prints its column headings
  inside every cell for phones: "Returned Check (Service / Item) | $10 (Fee) | Per item
  (Terms/Conditions)" under "Category | Service / Item | Fee | Terms/Conditions". Knox kept the label in
  every name. "Returned Check (Service / Item)" $10 stayed NSF beside the page's own $25 NSF (the label's
  "Item" made it no plain returned check), and "Statement Copy (Service / Item)" $2 matched the check copy
  rule's "copy ... items" and filed as check_image.
- Peninsula Community FCU (4447, doc 41842): "If your average daily balance is below $100.00 ($5.00 for
  accounts held by those under 18 years of age), no dividends are earned" was read as a $5 minimum
  balance fee. Live 73916 is the same wrong read from an earlier copy of the page.
- Cinfed FCU (6561, doc 41914): "Cinfed Connection Monthly Service Fee | FREE", the last row under
  "Online Fees" beside "Online Banking Monthly Service Fee | FREE", was read as $0 monthly maintenance.
- Morton Community Bank (273, doc 40112): "Cashier's Check more than $1,000 (MCB customers only)" / "$2.00"
  was named "Cashier's Check more than (MCB customers only)", and "Money Orders $1,000 or less (MCB
  customers only)" / "$1.00" was named "Money Orders or less (MCB customers only)". The names are not the
  page's words, so the shared check could not find the rows.

**Why (root cause):**

- Knox has no notion of a column heading echoed into a cell. Its name builders keep a trailing
  parenthetical as part of the name, which is right for a name's own note ("Counter Checks (5)") and
  wrong for a heading the page repeats.
- Knox's low-balance rule reads "below $X" as a minimum balance charge, and no rule read the sentence for
  whether it charges anything. Darwin's verify passed 73916 because `checkFeeAgainstSource` answered
  `tiered_fee` on the sentence and `statedInOwnSource` (verify.ts) counts `tiered_fee` as stated; with no
  traced line (`sourceLineFor` returns null for it), the later checks saw only Knox's excerpt, and none
  of them read a dividend sentence.
- The guard's v84 online-section rule (`heading_above`, `genericMonthlyCharge`) only covers generic names
  ("Monthly Service Charge"). A branded service name ("Cinfed Connection") names no service word, so
  Knox filed it as an account's monthly maintenance.
- Knox's name builders drop every dollar figure outside a threshold parenthetical as the price, including
  a threshold a comparison word ties to the name.

**Fix (Knox v170; guard unchanged at v108):**

- `src/lib/agents/knox/column-label-echo.ts` (`withoutColumnLabelEchoes`), the first rewrite on the
  text: a cell's trailing "(Label)" is removed only when the label is a whole cell of a heading row above
  (two or more cells, no figure, within 150 lines) and a cell after the row's first carries an echo too.
  A label has no digit and at most four words. "Business Checking/Draft Fee (monthly) | $ | 5.00" under a
  "Monthly" column keeps its note (the first version stripped it; the non-first-cell rule fixed that).
- `src/lib/dividend-threshold.ts` (`dividendThresholdSentence`): the sentence that prints the amount says
  no dividend or interest is earned below it and names no charge word. Knox drops the read
  (`dividend_threshold`); Darwin's verify and the shadow lab refuse it. "If below $5,000, a $10 monthly fee
  will be assessed, and no dividends are earned" names its charge and stays.
- `src/lib/service-monthly-charge.ts` v3 (`onlineServiceMonthlyFee`): a fee named monthly or maintenance,
  naming no account, whose own line sits under a section title for online, electronic or digital
  services ("Online Fees", "Electronic Service Fees", "Personal Online Banking Fees"). The section is the
  first line above that is not a row, table rule or column word. The fee's line must be printed once in
  the page: Finex CU (8593) prints "Fee Amount" under every card, and without that rule its live "Axcess
  Cashback Plus maintenance fee" (128838, line "FEE AMOUNT / $5.00") found the first "Fee Amount" under
  the page's "Electronic Service Fees" tab. A feature line ("Free Online Banking") is no section title.
  Knox drops the read (`online_service_monthly`); Darwin's verify and the shadow lab refuse it.
- `src/lib/agents/knox/threshold-name.ts` (`withThresholdFigures`): a rename only, after every reader.
  The figure goes back where the read's own excerpt prints it beside the comparison words, only when the
  name holds that slot once, does not print the figure and the figure is not the read's price. The
  category is unchanged, and the new name is kept only where Darwin's checks still pass it. A first
  version kept the figure in Knox's name builders; it moved categories and the answer-key gates fell
  (Texas 584 right against a floor of 586), so it was replaced.
- Darwin's live re-check `darwin.not_account_fee_line` v1 (`not-account-fee-line-check.ts`) reads live
  fees with the same two shared rules behind `NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE` (off). It is wired into
  the Darwin run, the sweep replay, the switch gate and the takedown-reason map.
- The guard is not changed: its online rule is a category rule on generic names, and Knox now refuses
  the branded case before the guard sees it.

**Live fees (read-only, Nov 2, prod `rmhwbbjjctzfaqjyhomu`, SELECT only):**

- The re-check's own query selected 493 live candidates: 12 whose stored line carries the no-earnings
  words, and 482 monthly maintenance fees on 335 texts that print an online services section title (one
  fee in both). Judged with the module's own `findNotAccountFeeLines` on those texts, 2 match:
  - 73916, Peninsula Community FCU, minimum_balance $5 (dividend threshold).
  - 152003, University of Virginia Community CU (7445), "Monthly fee" $0 under "Personal Online Banking
    Fees" (line "| Monthly fee | No charge |").
- With the switch off both are reported only. The other 11 rows with the no-earnings words do not match
  (their sentence names a charge, or the fee's amount is not in the no-earnings sentence) and stay.
- The column-label shape is printed by 7 current texts (Banterra 389, Heart of Louisiana FCU 5488, Gulf
  Coast Educators FCU 4975, St. Johns Bank 2440, Co-Op FCU 8046, Bluestone FCU 4715, River Town); no live
  fee name at those institutions carries an echoed label, so no live fee moves through it.

**Re-run after the fix:**

- The 40 rb3 texts, v169 vs v170: rows passing publish 684 -> 682, all 682 tracing (681 before).
  - All four wrong reads are gone. River Town's reads are all renamed without the label (22 rows out, 20
    in); its returned check is now `deposited_item_return` and its statement copy `document_reproduction`.
  - Morton's two rows keep their thresholds and now trace on their own lines.
  - The run now reproduces live 99652 and 122565 (River Town) and no longer reproduces 73916. No right
    read was lost.
- 60 fresh random stored texts (seeded, rb3 texts excluded), main (Knox v168 when measured) vs v170: 691 reads each. 5
  reads are renamed only, each keeping a threshold (Hawaiian FFCU x2, Marquette Savings x3), and each now
  traces (src ok 685 -> 690). No read held, dropped or added; verify unchanged.
- Answer-key gates: no read added or lost, renames only; the Texas, seven-state, golden and ratchet
  gates pass.

**Lesson:** read a row as the bank prints it for a reader: a repeated heading is not the name, a balance
that earns nothing is not a charge, and a service's monthly fee is not an account's.

**Guard:** `src/lib/agents/knox/backlog-dry-run-3.test.ts` (Knox reads on the real lines for each class) and `src/lib/agents/darwin/not-account-fee-line-check.test.ts` (Darwin's verify refusals, live re-check and switch).
**Agent lesson:** knox/backlog-dry-run-3-2026-11-02-label-dividend-online-threshold
**Agent lesson (Darwin):** darwin/backlog-dry-run-3-2026-11-02-tiered-trace-not-proof

**#2963 review fixes:**
- The dividend rule now splits clauses at any ";" and at a spaced dash, and it counts a price per unit ("per month", "each", "/month") as a charge. A fee followed by a no-dividend note is no longer dropped.
- The online-section scan now stops at a line naming an account, or at a heading printed as a one-cell row. An account's maintenance fee further down an online page stays.
- Overlap with open #2953, which covers a similar service-monthly class with its own heading module: this PR covers only an online, electronic or digital section title. #2953 must reconcile with `onlineServiceMonthlyFee` when it is rebased (it is stale at Knox v165).
