# 2026-11-02: The second re-read backlog dry run found Knox reading columns, advice and confirmations as prices

**What happened:** after Knox v166 fixed the first dry run's five wrong reads
(`2026-11-02-knox-backlog-dry-run-misfiles.md`), a second read-only dry run for
`KNOX_REREAD_BACKLOG_LIVE` took 40 more texts from the backlog at origin/main 9d57ee1e1ae (Knox v166,
guard v106). Each text was read with main's Knox (`currentVariant`), passed through the Darwin verify
and Hamilton publish checks that can be replayed, and compared with the live fees on its document and
its older copies (822 live fees). Today's rules would send 214 new rows to Darwin. All traced to their
own line with `checkFeeAgainstSource`, but 7 were wrong against the bank's own stored text, so the
switch stayed off:

- Eglin FCU (institution 5451, doc 13903): its box table reads "BOX SIZE | ANNUALLY | LATE FEE" over
  "3” x 10” x 24” | $35.00 | $6.00". Knox filed each late fee as a second box rent: $6 for the 3x10 box
  and $10 for the 5x10 and 10x10 boxes. The shared check traced the $10 rows to the "$10.00 key
  deposit" sentence.
- Eglin: "COINSTAR® Coin Counting Service | 10” x 10” x 24” | $105.00 | $10.00" (the coin row of the
  left column glued to the box row of the right) was filed as coin counting $105. Live 97753 is wrong
  the same way.
- Financial Health FCU (6465, doc 17979): "Reconcile online for FREE" in the page's "Ways to Avoid"
  table was filed as account research $0. It is advice, not a price. Live 89909 ("Bad Address Charge"
  $0, from "FREE with good | address on file") and 105000 ("Share Draft Copy" $0, from "FREE online")
  are wrong the same way: the same page prints "Bad Address Charge (Monthly) | $12.00" and "Share Draft
  Copy (Picked up) | $1.00".
- First Financial Bank (624, doc 41794): "Returned check charge | $7.00" was filed as NSF. The page
  prints its own "Returned NSF/OD Fee (Insufficient Funds/Overdraft Fee, per item) ... | $32.00".
- Century FCU (7131, doc 42055): "Wire Sent Confirmation: | $5.00 per item" was filed as the outgoing
  domestic wire, beside the bank's own "Outgoing Wire – Domestic | $20.00". Live 131028 is wrong the same way.

**Why (root cause, in Knox's reading rules):**

- Knox v76 reads a box size priced in two columns as two prices of the box ("2” x 5” $45.00 $65.00").
  No rule looked at the header above the row, which named the second column a late fee.
- Knox v63 splits a box size cell glued after another fee's name onto its own line, but only a
  two-dimension size with its price in the same cell. A three-dimension, inch-marked size in its own
  cell ("| 10” x 10” x 24” | $105.00") stayed on the coin row, and the coin name took its price.
- The $0 rules (`zero-waiver-row.ts`) knew no-fee sentences and waiver balances but not a page section
  of advice on how to avoid each fee.
- The guard has refused a plain returned check beside a higher NSF fee since v22/v23
  (`returnBesideNsf`, Hamilton's live guard reads the schedule's NSF price from the document's Knox
  rows), but Knox and Darwin's verify never read it. Knox filed the row as NSF because
  `NSF_NAME_INCLUDE` matches "returned check"; the live guard took such fees down after publish. Changing
  `NSF_NAME_INCLUDE` would move every flat-list returned item (485 live NSF rows have a plain return
  name), so the class fix is to apply the guard's own schedule rule where Knox reads the page.
- `WIRE_NOTIFICATION_NAME` (v166) read "notification" and "alert" but not "confirmation".

**Fix (Knox v168, guard v108; v167 is #2958's; the free-list check follows as v169):**

- `src/lib/agents/knox/box-late-column.ts`: under a box header with a late or penalty column, no
  specialist reads a row's late-column price as the box's rent. The late fee itself is not read, since
  no printed name says whose it is. A header with no late label ("Size | Annual | Semi-annual",
  "Size | Members | Non-members") keeps both prices.
- `withBoxSizeCellsSplit` (rules.ts) also splits a three-dimension size cell, its price in the next
  cell, onto its own line. Two inch-marked figures are left alone ("Copies | 8.5” x 11” | $0.25").
  Guard v108 refuses a coin counting name that carries a three-dimension box size (`BOX_SIZE_3D_NAME`)
  and re-files it to safe_deposit_box (`REFILE_RULES`, Hamilton's `RESTORE_REFILES`).
- `zero-waiver-row.ts` adds `avoid_fee_advice`: a $0 whose line sits in a "Ways to Avoid" section and
  whose free word's cell is advice ("for FREE", "FREE with/online/when/if/by/at/through/via"). The
  section heading must be a line of its own that names fees in general ("Ways to Avoid", "How to Avoid
  Fees"). A heading naming one thing ("How to Avoid Paying Interest on Purchases") opens no section. A
  bare free cell stays. Knox holds such a read and Darwin's verify refuses it. Darwin's live re-check
  (`darwin.zero_waiver_row` v2, its pre-filter widened to a free word on a text with that heading) reads
  live ones behind `ZERO_WAIVER_ROW_TAKEDOWN_LIVE` (off).
- `withReturnBesideNsf` (specialists.ts) files a plain returned check or item read as NSF as
  `deposited_item_return` when another read on the same page names the NSF or insufficient-funds fee
  at a higher price ($15 or more). It uses the guard's own rule (`plainReturnBesideNsf`, shared with
  `returnBesideNsf`, which is unchanged). Two cases keep it NSF: an NSF read at the return's own price
  (one fee under two names), and a page that prints its own deposited item return. The first version
  took neither case. The seven-state answer-key gate caught it on key 5918 (IL), whose "Return Check
  Fee | $25.00" sits beside "Non-Sufficient Funds | $25.00", a $30 ACH/ATM NSF and its own "NSF Deposit
  Fee | $30.00".
- `WIRE_NOTIFICATION_NAME` reads "confirmation(s)" with every qualifier skip (with, w/, and, no,
  without, included, in brackets). Knox holds the read; guard v108 refuses it under every wire type,
  with no re-file.

**Live fees (read-only, Nov 2, prod `rmhwbbjjctzfaqjyhomu`, SELECT only):**

- Guard v108, which takes effect through Hamilton's guard catch-up on the version bump. Every live fee
  whose name says "confirm" (27 rows) or carries a box size outside safe_deposit_box (2 rows) was read:
  - 131028 "Wire Sent Confirmation" $5 (wire_domestic_outgoing, doc 28026) fails and comes down. Its
    stored line is "Wire Sent Confirmation: | $5.00 per item".
  - 97753 "COINSTAR® Coin Counting Service: 10” x 10” x 24”" $105 moves to safe_deposit_box. It comes
    down as the twin of the bank's live 46887 ("10” x 10” x 24”" $105).
  - 64741 "Coin Counting NC: 5”x 10”x 24”" $40 (institution 5215, doc 19139) moves the same way. Its
    stored line reads "Coin Counting ..... NC | 5”x 10”x 24” .....", so coin counting is no charge, and
    the bank's live 158517 and 158514 ("Safe Deposit Box 5”x 10”x 24”" $40) are its twins.
  - The other 26 "confirm" rows (audit confirmations, deposit verifications, a wire confirmation fax
    filed as research, a photocopy of a wire confirmation, a chargeback) are outside the wire types and
    pass as before.
- Darwin's zero waiver re-check v2: 3,429 live flat $0 fees, 67 of them on a text with any "how/ways to
  avoid" heading line, 13 on a text with a heading line that names fees in general. Only 2 match, both
  at Financial Health FCU and both wrong on its page: 89909 "Bad Address Charge" and 105000 "Share Draft
  Copy". With the switch off they are reported only.
- The returned check rule changes no guard rule, so no live fee moves through it. For context, 485 live
  NSF fees carry a plain return name; under the guard's existing rule 2 of them fail on Hamilton's next
  guard run (166788 "Returned Item" $15 and 166884 "Returned Item Fee" $25, each beside a $30 NSF read).

**Re-run after the fix:**

- The 40 texts (rb2): new rows 214 -> 208.
  - The six wrong rows are gone: the three late fees, the coin counting $105, "Reconcile online" and
    the wire confirmation.
  - The $7 returned check charge is now read as `deposited_item_return`, the same as the bank's live 99667.
  - The read also stops reproducing live 89909, 105000 and 97753.
  - No other row changed, and no right read was lost.
- The first 42-text sample (rb, at the same main): new rows 119 -> 120.
  - The one new row is a better name for a live $150 box rent ("Safe Deposit Box 10"x10"x21"" for
    "(Plus Pass‐thru Fees and Applicable Exchange Rates): 10"x10"x21"", live 152497).
  - Two returned-item rows now agree with their live deposited-item fees (99627, 116601).
  - Nothing was lost.

- Answer-key gates: the Texas gate is unchanged (586 right / 11 wrong). The seven-state gate goes from
  926 right / 29 wrong to 927 / 28. MN's key 8741 reads "Returned Item Fee | $10/item", beside its own
  "NSF Return Fee | $35/item", as the deposited item return its key files it under, and the floors are
  raised. The golden set's key 8741 row improves the same way (22 -> 23 right), and its baseline is
  regenerated. The shadow lab ratchet locks in the same gain (8741 deposited_item_return $10).
- Measured at 9d57ee1e1ae and re-checked after the rebase onto origin/main 81f367b3937 (#2958, Knox v167,
  guard v107): the answer-key, golden and ratchet gates pass there and the golden and ratchet baselines
  regenerate unchanged.

Still open, not fixed here (each is a checklist line, not a blocker found wrong):

- The guard's v22/v23 rule (`returnBesideNsf`, unchanged) has neither of Knox's two exceptions, because
  Hamilton's schedule read keeps only the highest NSF price. Parthenon FCU (doc 3709) prints "NSF Fee
  $33", "Returned Item Fee $30" and its own "Deposited Item Return Fee $25", and the guard filed the $30
  as the deposited item return (live 99606); Knox reads it as NSF. Giving the guard the same exceptions
  changes a live rule, so it needs its own dry run.
- A box table's late fees are not read at all now. Reading them needs a name that says they are the
  box's late fee.

**Lesson:** read a price by the column it sits under and the cell it sits in. A second column's header,
a box size's own cell and a section of advice each change what the price is, while the row's words
still name a fee.

**Guard:** `src/lib/backlog-misfiles-dry2.test.ts` (Knox reads, guard refusals and re-files, and Darwin's re-check for each class, on the stored lines).
**Agent lesson:** knox/backlog-dry-run-2-2026-11-02-column-advice-confirmation
