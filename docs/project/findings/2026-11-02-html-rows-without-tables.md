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
- **Price-first rows** put the label before the price.
- **Long cells:** a label's heading stays on the row and its description goes on the next line. A
  second price block in one cell keeps its own line; River City's notary row would otherwise lose
  its $0.
- **Tests:** 53 near-miss tests on synthetic HTML (`html-row-pairing.test.ts`), plus 3 tests for the
  switch itself: off by default, the default read unchanged while off, tables and lists unchanged when on.

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
3. HTML gets its own reader version. Flipping the switch alone re-reads nothing; only pages read
   after it get the new text. A `ROSETTA_READ_VERSION` bump would replay every primary-reader
   current copy, PDFs included (`reader-replay.ts`), at 4 a run. An HTML-only version needs the
   read attempt to record it and the replay lane's due test to read it. That is a live change to the
   read selection SQL, with database tests, so it is not in this PR.
4. James runs the switch dry-run audit, section 8. It counts current HTML documents
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
