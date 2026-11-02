# 2026-11-02: Knox gave a free-services item the next column's price (Mountain Star FCU "Fax Service" $5)

**What happened:** James's Nov 2 review found Mountain Star FCU (institution 4467, document 38274) publishing
"Fax Service" $5 (raw 935219, verified 206116, published 159428). The bank's PDF prints Fax Service as one
of its free services. The $5 is the price of the money market account's excess checks, printed in the
next column.

The stored text (36365, `read.pdf_layout`, Oct 19, before Rosetta's layout v6) flattens a side-by-side fee
table row by row:

```
statement | Instant Issue | Other Free Services: Anytime, Notary
$10.00 | Service, Signature Guarantee, Unlimited
Debit Card
Membership Fee $3.00 | Check Writing, Balance Inquiries,
Money market | Fax Service
$5.00
excess check
```

Knox's price windows read the line above a lone price as its name, so "Fax Service" took the "$5.00" below
it (excerpt `Money market | Fax Service / $5.00`, specialist `extract.family.services`). The shared check
(`checkFeeAgainstSource`) traced the pair as "Money market | Fax Service | $5.00": `feeRow` gives a name
line the price printed under it. Darwin verified it and Hamilton published it.

**Why the existing rules missed it:**
- The shared check already ends a row at another name between a name and its price ("Fax Service" /
  "Notary" / "$5.00" never gives Fax Service the $5), but here the other label ("Money market") is a cell
  of the name's own line, not a line between.
- It already never prices a line that says free from the line below (`ZERO_WORDS` in `feeRow`), but the
  free word is on the list's heading, three lines above, not on the name's line.
- Nothing read the list: "Fax Service" is the last item of "Other Free Services:", carried on through the
  right column ("Check Writing, Balance Inquiries," ends with a comma, so the next cell is still an item).

**Fix:** the input side first. Rosetta's layout v6 (PR #2948, merged) keeps each cell of a side-by-side
table in its own table, so a new read of this PDF no longer prints the two columns on one line; the replay
of past `pdf_layout` texts waits behind `PDF_CELL_REPLAY_LIVE` (off). This change is Knox's side and its
live re-check, for texts already stored and for any reader that flattens columns again:
- `src/lib/free-list-item.ts` (`freeListItemRead`, pure): a priced fee is refused when the line the shared
  check traced joins a printed line that does not print the amount to a price from another line, and on
  that printed line the fee's name is an item of a list of free services. The list opens at a line's last
  cell (or a line of its own) whose label before a colon says free or no charge and names what is listed
  ("Other Free Services:", "NO CHARGE TO CUSTOMERS FOR THE FOLLOWING SERVICES:"), never "Toll-Free ...",
  "Free Checking", a sentence ("ATM. There is no fee ... Foreign Transaction Fees:") or a note. It runs on
  through that column while its cells carry commas, through the item after a cell that ends with one; a
  figure, a closing colon, a footer, a blank line or a cell with no comma after one that did not end with
  one ends it. It reads the shared check's traced line; it is no second accuracy check.
- Knox rules v169 (`knox/specialists.ts`; v167 is #2958's, v168 the second backlog dry run's fix): a
  read it matches is held untraced (dropped reason `free_list_item`), never sent to Darwin.
- Darwin's verify refuses one as `free_list_item` (rejected), on `sourceLineFor`'s traced line. The shadow
  lab's verify does the same.
- Darwin's live re-check (`darwin/free-list-item-check.ts`, `darwin.free_list_item` v1) reads every live
  flat priced fee whose stored line is stacked (a name line, " / ", the price line) on a text that prints a
  list heading, and reports matches. Behind `FREE_LIST_ITEM_TAKEDOWN_LIVE` (off), a match goes through the
  12-hour second look and is archived, never deleted. Admin-corrected fees are never read.

**Sample (prod stored texts, read-only, Nov 2; main f840641 vs this branch, `runFreeSpecialists`):**

| Sample | Texts | Reads, main | Reads, branch | Lost | Added | Frequency changed |
|---|---|---|---|---|---|---|
| `read.pdf_layout` multi-column texts (40+ cell breaks), 36365 and 50 others drawn at random, 30 that mention free or no charge | 51 | 1,272 | 1,271 | 1 | 0 | 0 |
| Every text a live priced fee cites that prints a free-services heading (`FREE_LIST_HEADING_SQL`) | 207 | 2,454 | 2,453 | 1 | 0 | 0 |

The one lost read in both is 36365's "Fax Service" $5, now held untraced. Checked against the stored text:
it is wrong (the item of "Other Free Services"; the $5.00 is "Money market ... excess check"). The same
text's "Inactive" $10 (`Copies | *Inactive` / `$10.00` / `account fee`), the same stacked shape with no
list, is kept.

**Answer-key gates** (frozen keys, main vs branch): Texas 586 right / 11 wrong, unchanged; seven states
926 / 29, unchanged (re-checked on top of Knox v168 at origin/main 81f367b3937: 927 / 28, unchanged); every key's reads identical. Category errors do not rise and recall does not move.

**Live dry run (prod, read-only, Nov 2):** the population is every live flat priced fee on the 207 texts
that print a heading (1,365 fees, any stored line), each judged by `findFreeListItems` on its own text.
1 matches: 159428, Mountain Star's Fax Service $5. The step's own read (stacked stored lines only) selects 39
of the 1,365 and matches the same 1, so the pre-filter misses none here. Hand-check: the 1 match is right
(above). A sample of 20 takedowns cannot be drawn, because there is 1. In its place the 37 list item cells
the reader found on those texts (14 texts) were read by hand: 35 are items of a free list; 2 are not
("All Accounts" under "FREE services:", a column heading, text 16762; "www.cudollar.org" under "Go to the
following website to find no-fee ATMs:", text 26787). Neither names a live priced fee, so neither is a
takedown.

**Not covered:** a name on a line that says free whose price the shared check finds another way than
`feeRow` (a dot-leader row, a two-column re-read): the first version read that too, but its dry run needed
every live text that prints "free" (about 1,000 texts, 11.6 MB), so it was dropped rather than shipped
uncounted. The shared check's `feeRow` already refuses the common shape (test in
`src/lib/free-list-item.test.ts`).

**Agent lesson:** knox/issue-1092-free-list-item-priced-elsewhere, darwin/issue-1092-free-list-item-refused

**Guard:** `src/lib/free-list-item.test.ts`, `src/lib/agents/knox/free-list-item.test.ts`,
`src/lib/agents/darwin/free-list-item-check.test.ts` (switch off writes nothing), and the golden-set
sweep replay `darwin.free_list_item` with its switch-gate probe.
