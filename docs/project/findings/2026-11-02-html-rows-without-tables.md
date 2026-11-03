# 2026-11-02: HTML fee rows built from divs lose the pairing of label and price

**What happened:** `read.html_dom` writes a `<table>` row on one line ("Overdraft | $35") and pairs a
`<dt>` with its `<dd>`. Many fee pages lay their rows out with divs instead: ARIA rows
(`role="row"` over `role="cell"`), grid rows (Bootstrap `.row > .col-md-4`, Kadence and Gutenberg
columns) and flex rows. The reader treated each cell as its own block, so the label and the price
landed on separate lines and Knox paired neither. This is class R2 in
`2026-11-02-lab-misses-by-root-cause.md`. On the source-bytes re-read
(`2026-11-02-lab-replays-source-bytes.md`), 41 of the hand-labelled R2 misses were still missed.

**R2 was partly mislabelled:** 13 of the 41 are on three pages whose label and price already share a
line, so DOM pairing cannot reach them:
- Tandem FCU (state:2001, 8 misses) and First State Bank and Trust (state:2017, 4) are real `<table>`
  rows.
- Crow Wing Power CU (state:10272, 1) prints `<br>` lines that put the price first
  ("$20.00 - Wire Transfer").

All 13 are missed downstream, at Knox's read or Darwin's verify. The other 28 are separate DOM blocks:
- River City Bank (state:5608, 13): Kadence two-column rows, with a description paragraph under the label.
- Peach State FCU (state:10358, 12): Bootstrap rows of three `col-md-4` cells. Each cell carries a
  mobile-only copy of its column header (`d-md-none`).
- Northern Communities FCU (state:12030, 3): ARIA rows.

**Fix:** `src/lib/agents/rosetta/html-row-pairing.ts`, behind `HTML_ROW_PAIRING_LIVE` (off).
- **What joins:** only positive DOM evidence: an ARIA row whose children are all cells, a grid row
  whose children all carry column classes, or a flex/grid row that is neither stacked nor wrapping.
  Two lines that merely sit next to each other never join.
- **Grid and flex rows** must also read as one fee: a cell that starts with a price ("$", "No charge",
  a bare "Free"), and another cell that is a label with no price outside parentheses. They are capped
  at 4 cells, and a cell holding a table, list or inner row disqualifies the row.
- **Price-first rows:** only the leading prices move, in their order, to sit right after the label
  ("$35 | Overdraft fee | $30 per item after the first" reads "Overdraft fee | $35 | $30 per item
  after the first"). A price-first row with two labels ("$35 | Overdraft | $30 | Stop payment") is not
  joined, because a label-first line would hand each label the other's price (review of #2951).
- **Long cells:** a label's heading stays on the row and its description goes on the next line. A
  second price in one cell, as its own block or after a `<br>`, keeps its own line ("Wire fees | $25
  domestic outgoing", then "$45 international"); River City's notary row would otherwise lose its $0.
- **Tests:** 57 near-miss tests on synthetic HTML (`html-row-pairing.test.ts`), plus 3 tests for the
  switch itself: off by default, the default read unchanged while off, tables and lists unchanged when on.
  `shadow-lab/html-row-pairing-publish.test.ts` pins 7 joined rows that state no fee ("Open an account
  | $300 bonus", "Minimum balance to avoid fee | $1,500", ...) and checks today's pipeline publishes
  none of them, so a later Knox change that starts reading one fails there first.

**Measured** with shadow-lab experiment `html-row-pairing` (`source-replay.test.ts`, on the 38
reproduced documents, same keys, today's pipeline on both sides):

| Measure | Switch off | Switch on |
|---|---|---|
| Re-read recall | 897 / 1,187 (75.6%) | 913 / 1,187 (76.9%) |
| Keys lost | | 0 |
| R2 misses still missed | 41 | 27 |
| Published fees not in the answer key | 30 | 32 |

- **Keys gained (16):**
  - state:5608: atm_international:250, bill_pay:695, card_replacement:1000, counter_check:100,
    legal_process:15000, od_protection_transfer:500, rush_card:5000, safe_deposit_box:12500,
    stop_payment:3000.
  - state:10358: account_research:2500, atm_non_network:50, bill_pay:595, dormant_account:500,
    excess_withdrawal:1000, monthly_maintenance:1000, monthly_maintenance:500.
  - 14 of them are R2 misses.
- **The two new publications outside the key**, each checked by hand against River City's page:
  - Right: "Excessive Withdrawal Fee | $15 for each excessive item" (excess_withdrawal $15). The key
    does not list it.
  - Wrong: "Monthly Maintenance Fee | No charge", under the heading "Consumer Online Banking Services
    and Mobile Banking Fees", published as the account's monthly_maintenance $0. It is the online
    banking service's fee.
- Northern Communities' Skip-a-Pay $35 was already published outside the key; only its line changed.
- **The 14 separate-block misses still missed** are now paired lines, and Knox or the publish gate
  misses them. Two examples: Northern Communities' "Deposited or Cashed Item Returned Unpaid |
  $20.00" (other_line_same_price), and Peach State's $35 returned deposited item (cutoff-name hold).
- **The frozen-text lab, the ratchet, the quality gates and the golden gate do not move**
  (`test:shadow-lab` with the experiment: current and experimental equal on every measure). They
  replay text that has already been read.

**Before the switch flips:**
1. The Knox PR that holds a $0 maintenance row whose heading names online banking, mobile banking or
   bill pay merges. The wrong publication is a heading problem: a `<table>` row with the same words
   publishes it the same way today.
2. The source replay with the switch on shows 0 wrong publications.
3. Done (`2026-11-02-html-reader-version.md`): HTML has its own reader version,
   `HTML_READ_VERSION`. The PR that flips the switch bumps it from 1 to 2 in the same change
   (`reader-replay.test.ts` fails otherwise), so the flip replays current `read.html_dom` and
   `read.js_fallback` copies once and no PDF. Flipping the switch without the bump would re-read
   nothing; a `ROSETTA_READ_VERSION` bump instead would replay every primary-reader copy.
4. James runs the switch dry-run audit, section 8 (9 if the Knox PR's own section 8 lands first;
   whichever lands second renumbers). It counts current HTML documents
   (`read.html_dom`, `read.js_fallback`) and the live fees on them, as exposure. It cannot count
   which stored texts would change, because the HTML bytes are in the document vault and the audit
   reads only the database. Rosetta's lost-text rule keeps any stored text unless the new one lists
   at least as many fees.

**Lesson:** a fee row is not always a table row. Read the row structure the markup states, ARIA
roles and grid columns included, but join only on that markup; pairing lines by adjacency had netted
-3 on the frozen text.

**Guard:** `src/lib/agents/rosetta/html-row-pairing.test.ts`,
`src/lib/agents/deming/shadow-lab/source-replay.test.ts` (experiment `html-row-pairing`),
`src/lib/agents/deming/switch-dry-runs/run.test.ts`. Agent lesson: rosetta/issue-1092-pair-a-dom-row.
