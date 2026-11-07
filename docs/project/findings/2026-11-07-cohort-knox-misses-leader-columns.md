# 2026-11-07: Knox did not read right-column rows of two-column PDF schedules printed as dot-leader cells

**What happened:** answer-key score run 117 (scorer v3, Nov 7) listed 45 Knox misses on James's scored cohort
(Austin Bank 395, Rabun County Bank 2267, Tandem FCU 4888, Metro North FCU 5410, Geovista FCU 6109, Utility
District FCU 7229, Springfield City Employees FCU 7815). Each miss was looked up in the bank's current stored text
(`agent_source_texts`, superseded documents left out, SELECT only), and Knox v184 was run on that text locally
(Knox, Darwin verify and Hamilton's publish gate from the shadow lab's current variant, no DB writes, no provider
calls). Counted against the confirmed answer key on the key's own document, local Knox v184 matched 124 of 185 key
rows; the score run's list and the local run differ for some rows (Geovista's $1 fax, $4.95 low-balance fee and
$0.75 ATM balance inquiry are read locally), so the causes below are from the local run.

**Root cause (the class fixed):** two-column PDF schedules print each cell as a whole dot-leader row
("Mobile Banking .....FREE | Incoming (each) ..... $15.00"). Knox's column reader (`columnHeadingRows`, v102) pairs
only separate "name | price" cells, so a right column's own heading ("| Wire Transfer", "| Wire transfers
(outgoing)") never named the bare rows under it. On Utility District's page the left cell "Check printing……(varies by
style)" also lent its name to the right cell's $20, so Knox read a $20 check printing fee (Darwin refused it) and the
domestic wire was lost. A box size written with the times sign ("3×10 | $55.00") had no letter, so Knox found no
usable name, and the shared source check matched only "x" sizes.

**Fix (Knox v186, table pass v14):**

- A leader cell pairs as its name and price for the column headings (`leaderPair` in `column-heading-rows.ts`).
- A leader cell priced in words in brackets is a closed row (`closedLeaderCell` in `layout.ts`): the rules pass reads
  each side on its own (`closedLeaderSplit`; a free row keeps its v76 reading), and neither the table pass nor the
  family experts' price windows (`priceWindows`) give its name the next cell's price; name tidying starts after it.
- "3×10" is a usable name (`usableName`). The shared check reads "×" sizes as sizes, and reads a one-word leader row
  in the right column ("| Domestic......$20.00") as that column's cell. Both only add traces.

**Dry run (stored texts, read-only):**

| Set | Fees gained | Live fees lost | New wrong fees |
| --- | --- | --- | --- |
| Cohort (8 current texts, 7 banks) | 5 (key rows matched 124 to 129 of 185) | 0 | 0 |
| Nov 3 slice (180 texts, 66 banks: the 62 answer-key banks and 4 more) | 8 | 0 | 0 |

The 8 slice gains are the 5 cohort fees (Rabun's 3×10 on its older text 38571) and Bank of Gueydan's 3×10, 5×10 and
10×10 boxes (text 20531, not an answer-key bank; each checked against its line). Every gained fee passes
`checkFeeAgainstSource` on its stored text.

Frozen gates: the golden set moves from 1341 to 1345 of 1766 expected fees (precision 1388/1447 to 1392/1451), with
0 lost and no member publishing more known-wrong fees. The 4 gains are Utility District's two wires, a 3×10 box
(state 12752) and a 3×5 box (live audit 2454). The shadow-lab ratchet gains the same 4, and the golden and ratchet
baselines are regenerated. The Texas and seven-state answer-key gates hold their floors.

**Misses not fixed, and why:**

- Retired categories (`RETIRED_CATEGORIES`): the key files Austin's 7 balance inquiries, Geovista's $0.75 ATM balance inquiry (Knox files it `atm_non_network`, the fold's home) and Metro North's free balance inquiries, Tandem's IRA early withdrawal
  ($100, `ira_distribution`, Knox files `ira_termination`), and Tandem's and Geovista's free e-statements
  (`estatement_fee`) under types the taxonomy has retired. Knox's reads match today's taxonomy; scorer v3 does not
  fold retired key rows, so they score as misses forever. That is a scorer change, not Knox.
- Split categories: Geovista's "Bad Address" $5 and Metro North's "Return Mail" $5 are keyed `account_research`;
  Knox files `returned_mail` (#1398). Scorer v5 (`keyFeesForVersion`) folds these; run 117 used v3.
- #2278 direction review: Austin's "International (each)" $50 sits under a bare "Wire Transfer" heading with no
  direction; the root-approved review declines it.
- Deliberately held by an existing rule: a bare "Wire Transfer Fee" (Tandem $25, `RECALL_FAMILY_PATTERNS` note),
  loan coupon books, free allowances ("first two draft copies free" keyed $0; decision 2026-11-04), a unit-only
  sub-label under a left heading ("Per copy", "Per hour" under "Account Research", `needsHeading`).
- Category choices that would re-file live fees (each needs its own Darwin live re-check, so not in this PR): Rabun's
  "Account Subpoena / Research / Balancing" (live `legal_process`, keyed `account_research`), Utility District's
  "Monthly fee ... balance of below $100" (live `monthly_maintenance`, keyed `minimum_balance`), Springfield's "NSF
  Deposit Fee" (read `nsf`, refused by Darwin; keyed `deposited_item_return`), Tandem's "Returned Check & Stop Payment
  Fee" (live `nsf`; keyed both `deposited_item_return` and `stop_payment`).
- Not yet read, no rule names them: Tandem's "Statement Fee | $2.00 per mailing" (paper statement), Springfield's
  "Pin Number | $ 2.50", Utility District's "Loan finance fee" $50 and "2nd Checking account (per month)" $6 (a
  right cell is not read when the line's first price files nothing, or files another fee and the right cell's words
  file nothing), Geovista's "Vista Choice per month" $6, "Simple Checking (without a monthly deposit)" $1,
  "Transaction History/Statement" $3 and "(Series) $35.00", Austin's Bill Pay and Deposits rows under single-column
  headings and its "Greater of 10% or $5.00" coin counting.

**Seen, not changed:** in a shortened copy of Utility District's lines the shared check traces "Wire transfers
(outgoing): Foreign" at $5, the PIN replacement price on the heading's own line, before and after this change. The
full stored text does not show it. Left as an open item on the shared check.

**Lesson:** a two-column PDF cell is often a whole dot-leader row; read it as the name and price pair it prints, let
the right column's own heading name its bare rows, and treat a cell priced in words as a closed row whose name never
takes the next cell's price.

**Guard:** `src/lib/agents/knox/leader-column-rows.test.ts`

**Agent lesson:** knox/cohort-misses-2026-11-07-a-leader-cell-is-a-whole-row

Outputs (texts, answer key rows, before and after runs): `/mnt/project-files/data-quality/cohort-knox-misses-2026-11-07/`.
