# 2026-10-25: a fee's section heading, and what its name names, decide its category

**Lesson:** A fee's own words are not enough to file it. A bare return charge printed under a foreign
check or collection heading is a deposited item coming back unpaid, not the member's NSF fee; a late
fee whose name names the safe deposit box is the box's, not a loan's; a transfer to another account
at the same bank is not a wire. Read the section the line is printed in and what the name points at
before filing it by its name.

**What happened:** The #1912 live check found fees that traced to their own lines at their own prices,
so the shared source check (`checkFeeAgainstSource`) passed them, but under the wrong category:

- U.S. Bank 75929 "Returned Check Fee" $35 (doc 20724) sits under "Foreign Check Collection
  (incoming/outgoing)", after "Courier Fee", "Initiation Fee" and "Tracer Fee | $50.00". It was live
  as NSF beside the bank's own NSF fee.
- BankUnited 56558 "Returned Items" $25 and 109208 "Return Items" $25 (institution 64, doc 15894) sit
  under "COLLECTIONS" and "FOREIGN CHECK CLEARING". Both were live as NSF; a later read already has
  "Return Items" $25 live as a returned deposited item (157215).
- Five safe deposit box late fees were live as the lending late payment fee by name: 36020 "Safety
  Deposit Box-Late Fee" $1, 152482 "Safe Box Late Fee - Per Month after 3 months" $5, 153210 "Safety
  Deposit Box Late Payment" $7.50, 155092 "Late charge for safety deposit box rental after 10 days"
  $10, 159317 "SDB Late Payment" $10. Guard v87 read a box section only for bare late names and left
  box-named ones to the fold's name split, but the guard itself passed them as late payments.
- M&T's book transfer (145046) was already refused by guard v88 (#2628).

**Cause:** Knox files a fee by its name, and the category guard judged an NSF or late payment by its
name too. Nothing read the section heading above an NSF row, and the late payment rule excluded only
skipped loan payments.

**Fix (guard v90):** `collectionSectionReturn` (`src/lib/custom-report/collection-section-return.ts`)
walks up from the fee's line through collection rows only (courier, initiation, tracer, cash letter,
foreign, Canadian, clean or documentary collections) to a collection heading: a short unpriced line,
or the capitalised first cell of a row whose next cell is a name. An NSF, overdraft or other heading,
a sentence or another fee's row ends the walk, a second column is never read under the first one's
heading, and every priced place of the name must sit in the section. Hamilton's live guard, its
takedown restore and Darwin's verify read it from the fee's stored text (`withCollectionSection`);
the NSF fee fails and re-files to `deposited_item_return` when that type accepts the name. The late
payment rule now refuses a box-named late fee (`SAFE_DEPOSIT_BOX_NAME`) and re-files it to
`safe_deposit_box`.

**Dry run (read-only, Oct 25, every live fee in the touched categories):**

| category | live fees | still ok | re-file in place | second look (fail) |
|---|---|---|---|---|
| nsf | 4,002 | 3,999 | 1: 75929 -> deposited_item_return | 2: 56558, 109208 (live twin 157215) |
| late_payment | 1,102 | 1,097 | 1: 159317 -> safe_deposit_box | 4: 152482, 153210, 155092 (each beside its own live box copy: 42022, 74905, 117030); 36020 ($1, under the box type's $5 floor) |
| wire_domestic_outgoing | 2,975 | unchanged by v90 | 0 | 0 (v88 already refuses 145046) |

Every mover traces on its own stored text under its new category (`checkFeeAgainstSource`). Of 148
live NSF return names whose text prints a collection heading within 30 lines, the section reading
moved only these 3 and 85872 ("Returned Items, each - Within U.S./Outside U.S.", under "Collections*"),
which the returned deposited item type does not accept, so it stays. Among the 289 earlier NSF
takedowns the restore reads, none changes. The guard catch-up re-checks every live fee on the bump
(`hamilton.guard_catch_up` keys on `CATEGORY_GUARD_VERSION`).

**Guard:** `src/lib/custom-report/collection-section-return.test.ts`, the v90 cases in
`src/lib/fee-category-guard.test.ts` and `src/lib/agents/hamilton/category-guard.test.ts`, and two
late payment cases in the hard-document gate.
**Agent lesson:** `darwin/issue-1912-section-and-name-decide-category`,
`knox/issue-1912-heading-decides-a-plain-return`.
