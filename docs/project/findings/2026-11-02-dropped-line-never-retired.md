# 2026-11-02: A fee line a newer copy of the page drops stays live

**Lesson:** A takedown gate tied to a moving target never opens. Darwin's stale-copy check could call
a fee dropped only after Knox had read the current copy at today's rules version, and the rules move
almost daily. It also needed the current copy to carry half of the older copy's live fees, which a
bank that removes a whole block of fees never does. Prove a dropped line from the stored texts and keep
Knox's read as a veto.

**What happened:** Live-site audit draw 275762 flagged fee 103684 at Olympia Federal (institution
1020): "Tax Registration" $81, `other_lending_fee`, cited at olyfed.com/rates/, name not found on the
page. The fee was read on Oct 9 from copy 23786 by the paid reader. The Nov 2 copy, 41830 (same
address, 61,555 characters against 61,378), replaced the HELOC section's third-party list (Recording
Fees $350, Escrow Fee $500, E-Recording Fee $10, Flood Determination $17, Tax Registration $81,
Foreclosure Prevention Fee $80 and others) with one line: "These fees generally total between $1,487
and $3,432." Six live fees from that list still cite copy 23786. None of the six is admin-corrected.

Why it survived (prod, read-only, Nov 2):
- Copy 41830 was fetched at 05:54 UTC and Knox has not read it yet (no extract attempt), so the check
  gives `waiting_reread`. That alone would clear in time.
- Once Knox reads it, the drop would need a v163 read to still count. On Nov 2, 25 of 2,186 superseded
  copies with live flat fees had a current copy read at v163. 1,424 had a read at v97 or later but below
  v163, 117 a read below that, 286 none, and 330 no stored text. Knox re-reads such a current copy once
  per rules version from a backlog, and the rules went v156 to v163 that day. The 15 most recent
  `darwin.stale_copy` passes recorded one `dropped` verdict.
- Even at v163, the six fees fall to `not_same_schedule`: of the copy's 8 judged live fees, 2 are still
  printed and 6 dropped, below the 50% the same-schedule test asks for.
- "A dropped line" was already a retire reason (`stale_copy_dropped`, switch `STALE_COPY_RETIRE_LIVE`
  on). No switch was off, and no age, size or category guard applied.

**Fix:** Darwin `stale-copy-check.ts` v3.
- Behind `STALE_COPY_DROPPED_LINE_LIVE` (shipped off, turned on after the re-run below): Knox's read of the current copy counts from Knox's
  stale-read floor (v97) and never below the fee's own read version. A same-address current copy that
  still prints 60% of the older copy's lines is the same page, even when it carries few of the old
  copy's live fees.
- Always (these only keep fees live): a would-be drop stays live when the current copy still prints the
  fee's name (whole, its head before a bracket or comma, a slash part, or a long unbroken run of it) and
  its price anywhere (`named_and_priced`); when a live fee read from the current copy has its category
  and amount (`restated`); or when the two copies come from different addresses (`not_same_page`).

**Dry run (prod, read-only, Nov 2):** The 2,186 superseded copies with live flat fees, their 6,855
live fees and the stored texts of the 1,449 copy pairs Knox has read at the floor, judged with
`judgeStaleCopyDocument` at Knox v163.
- Switch off: no drops (322 `waiting_reread`).
- Switch on, Knox floor only: 27 drops. Read against the stored current text, 9 were still printed: a
  price above its name in a two-column PDF, an interleaved PDF table, a table flattened column by
  column, a name stored as `Levy &amp; Garnishment`, a name glued to its neighbour's words, a Regions
  schedule fetched from a moved address. Adding the same-page text test brought 6 more, and 1 of them
  was still printed: a $10 monthly fee renamed "plus tax maintenance fee".
- Switch on, with the guards: 15 drops at 11 institutions. All 15 are absent from the current copy's
  stored text: 5 rows removed outright, 4 rows ULFCU's new fee table leaves out, 4 lines re-priced
  ($0.25 to $1, $575 to $675, $2.50 to $5.00, $15 to $25), and 2 misreads of a flattened Fidelis
  schedule that a clean table replaced. The guards also keep 5 true drops live (re-priced lines whose
  name and some other price still appear, and two Regions lines on the moved copy): they miss, they never
  take a printed fee down.
- Olympia's six fees are not in the 15 because copy 41830 is unread. Judged as if Knox had read it at
  v120, all six drop with the switch on and none with it off. All six are absent from 41830's text.
- Sample: all 15 plus the 6 Olympia fees (21), hand-checked against the stored texts. 21 of 21 are
  absent from the current copy at their amount. The live pages were not fetched: this container's proxy
  refuses them (HTTP 403).

**Switch on (Nov 2, sampled-clean rule):** the dry run was re-run on main (4055bbe8, Knox v163) with the
same read-only pulls: 2,191 superseded copies with live flat fees, their 6,931 live fees, the current
copies' 20,954 live fees and 38,767 raw rows, and the stored texts of the 1,443 copy pairs Knox has read
at the floor (2,561 texts), judged with `judgeStaleCopyDocument`.

| | drops | institutions | twins (already on) |
|---|---|---|---|
| Switch off | 0 (321 `waiting_reread`) | 0 | 41 |
| Switch on | 15 | 11 | 41 |

With the switch on, the guards keep 38 `named_and_priced`, 3 `restated` and 1 `not_same_page` live, and 81
fall to `not_same_schedule`. The 15 are the same fees as the first dry run. Each was read by hand against
the current copy's stored text; all 15 are absent at their amount, and each pair is one address with the
current copy the same schedule (text overlap 0.20 to 0.99; the two low ones, ULFCU 0.27 and Fidelis 0.20,
carry 4 of 8 and 10 of 13 of the older copy's live fees).

| Fee | Inst | Copies | Name, amount | Current copy's stored text |
|---|---|---|---|---|
| 94533 | 7318 | 6648 -> 41389 | Returned Mail (Per Each Occurrence of Returned Mail) $5 | no "mail" anywhere; the row after Dormant Account Letter is now Account Research |
| 49178 | 5747 | 12874 -> 21046 | Debit Card Dispute $10 | no "dispute"; the new fee table lists Debit Card Fee $12 annually |
| 49180 | 5747 | 12874 -> 21046 | Mortgage Loan Application $200 | no $200 line; mortgage fees are Origination 1.50% and Credit Report $20 |
| 49182 | 5747 | 12874 -> 21046 | Skip a Payment Promotion Fee $40 | no skip-a-payment line and no $40 |
| 49183 | 5747 | 12874 -> 21046 | Certified Checks/Credit Union Checks/Telephone Check $5 | gone; only Lost or Stolen Cashier/Credit Union Check $28 and Reissue $29 |
| 144004 | 515 | 15534 -> 41811 | Counter Checks $0.25 | "COUNTER CHECKS / $1 per page (limit 2 pages per visit)"; older "$.25 each" |
| 78206 | 767 | 16363 -> 41457 | Deposited item returned $12 | row removed between Coin counting and Early Closeout Fee; no $12 |
| 53954 | 2957 | 16690 -> 36907 | Go Green Secure Checking Monthly service charge $3 | the Go Green cell "$3 ... falls below $500" and its section sentence are both gone |
| 115075 | 7558 | 25801 -> 38320 | Returned Deposited Items - Charge Back $15 | "Returned Deposited Items - Charge Back \| $25.00" |
| 139689 | 5454 | 31052 -> 41682 | Expedited card Online Services $6 | misread of the flattened old copy ($6 was Bill Pay); clean table: "Up to $75 \| Expedited card"; no $6 |
| 139725 | 5454 | 31052 -> 41682 | Card replacement fee $35 | misread ($35 was Expedited card); clean table: "$10 \| Card replacement fee"; no $35 |
| 107278 | 5534 | 34656 -> 39479 | Cashier's Check: Non-member $10 | only "Cashier's Check/Members \| N/C" |
| 159209 | 2214 | 38387 -> 40408 | Processing Fee $575 | "$675 Processing Fee" (both manufactured-home lines) |
| 164340 | 6256 | 38872 -> 40739 | Statement copy fee $2.50 | "Statement copy fee \| $5.00 per statement" |
| 107864 | 5985 | 39997 -> 41882 | Money Orders $2 | no "money order" anywhere |

Darwin's own guards hold for all 15: none has a correction row (`published_fee_corrections`, any status),
all are live and unquarantined, and each takedown still waits for the shared 12-hour second look before the
archive write, which again skips admin-corrected fees. Olympia's six now cite a newer copy, 42071, which
Knox has not read, so they still wait. The live pages were not fetched (the proxy refuses them); every
check is against the stored texts. Rollback: set `STALE_COPY_DROPPED_LINE_LIVE` to false.

**Still open:**
- Fees on current copies Knox has never read (286 copies) or with no stored text (330) still wait;
  that is the Knox and Rosetta backlog, not this check.

**Guard:** `src/lib/agents/darwin/stale-copy-check.test.ts`
