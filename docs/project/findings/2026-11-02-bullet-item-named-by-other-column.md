# 2026-11-02: A bullet item named by the other column's text on a two-column page

**What happened:** the live-source audit (draw 275762, partial at 15:30 UTC Nov 2) listed two
published fees whose amount it could not find as the bank's fee. Traced through the tiers
(`published_fee_records` -> `verified_fee_observations` -> `raw_fee_observations`, stored text by
`source_document_id`), they are two different things.

- **54298, Steel Valley FCU (institution 6230), $5.00 `document_reproduction`, named "Rate Schedule.
  The Dividend Period is the period of time at | October 15th and the account will remain open. If you
  | Ph".** Verified 57705, raw 203699, Knox deterministic read of Rosetta artifact 12240 (document
  16793, `truthinsavings.pdf`), Oct 6. The note's excerpt is the line Knox read: "Rate Schedule. The
  Dividend Period is the period of time at | October 15th and the account will remain open. If you | •
  Photocopy Fee ................................$5.00/Copy". The amount and category are right (the
  schedule's photocopy fee is $5.00 a copy); the name is the left column's account disclosure prose.
  The PDF reader joins the two columns of each printed row with " | ", and Knox named the fee from every
  word before the price. Its 120-character name limit counts from the start, so it kept the prose and cut
  the fee's own words to "Ph". The same page has two more live: 54295 "Percentage Yield for that balance
  range will apply to the full | more than six (6) pre-authorized, automatic, or telepho" ($35 legal
  process) and 93059 "Rate Schedule, dividends are calculated by applying a: Items Sent For Collection"
  ($35). The note's `text_hash` (d2fbaf77...) is no longer the artifact's (987ed4d8..., re-read Oct 9
  with another layout); on the stored text Knox main still reads "Rate Schedule. For Shares, Holiday
  Club, Vacation Club: Overdraft Fee", "Other Clubs and Share Draft accounts, there is a minimum: NSF
  Fee" and two more such names. Today's publish holds all three Steel Valley names as `cutoff_name`
  (they are sentences); they went live on Oct 6 and before. A heading glued on the same way ("Abandoned
  Property: Teller Check") reads as a name and passes, and a re-read at the same price never replaces a
  live row (`decidePriorFee`: identical).
- **139172, institution 35 (Zions Bank), $0.00 `nsf`, "Insufficient Funds (NSF) Fee - Returned
  Items": no error found.** Verified 163085, raw 659239, Knox's free read of artifact 19227 (document
  22562, the March 2026 consumer schedule), whose stored row is "Insufficient Funds (NSF) Fee - Returned
  Items | $0.00 | For any transaction the bank returns or declines that will overdraw the account." The
  shared check traces it (`checkFeeAgainstSource` ok on that line), and the live PDF read through a
  plain fetch lists page 1's prices in the order $13.00, $15.95, $20.00, $29.00, $0.00, $10.00, $10.00:
  the $0.00 sits between the paid-item overdraft fee ($29.00) and the overdraft deposit transfer fee
  ($10.00), where the NSF row is. The PDF's text layer prints the labels apart from their amounts, which
  is why the audit's line match missed it. Nothing changes for it here; whether the audit should read
  that layout is the audit's own question.

**Size (prod, read-only, Nov 2):** 36 live fees at 17 institutions have a Knox excerpt with a bullet
cell after another cell and a name with a ": " or " | " join; among them are feature bullets and other
columns' headings ("Unlimited check writing: Stop Payments", "Abandoned Property: Teller Check", "Kids
Club: ATM Convenience Fee", "Primary Share Account: ● On‐Us Non‐Member Check Cashing"). The latest stored
texts of documents with live fees hold 425 lines of the shape in 113 texts at 89 institutions (a regex
upper bound). 85 live names at 45 institutions are a glued name whose last cell their latest page prints
as a bullet item (the retidy's SQL prefilter; how many of them the retidy renames is known only after
its dry run).

**Fix:**
- **Knox v164** (`withBulletCellRows`, `src/lib/agents/knox/bullet-cell-rows.ts`): a line whose later
  cell opens with a list bullet and words, with the line's price in that cell or after it and none
  before it, is read as two: the bullet's item on its own, and the cells before it after the run of
  bullet rows. Below, not above: above, "Stop Payment | • Overnight Check | $14.95" read a $14.95 stop
  payment, and the left column's text between two wire rows cost the second its "Wire Transfers"
  heading. A bare bullet cell, a bullet in the first cell, a price before the bullet and an account's own
  fee (monthly maintenance, minimum balance) keep the line whole. The stored text and the shared check
  are unchanged.
- **Name retidy v28** (`bulletItemName`, `src/lib/agents/knox/name-retidy.ts`): a live name that is such
  an item with the other column's cells glued in front takes Knox's read today (`reReadName`, one name at
  the fee's category and amount in its own text), only when its own page prints that name as a bullet
  item and the dropped words hold no price and no business word. It goes through the retidy's category,
  twin and trace checks and `writeLiveRenames`. It renames; it holds, re-files and takes down nothing, so
  no Darwin re-check or switch is added. Steel Valley's three come first.

**Sample (Knox before and after over prod stored lines, read-only, Nov 2):** 61 lines of the shape: 20
reads keep their amount and category under the bullet cell's own name ("Money Market & Premium Money
Market Account: ● Mailed Paper Statements" -> "Mailed Paper Statements", "Size: Fee: ● ATM Withdrawal
Fee" -> "ATM Withdrawal Fee", "Monthly statements: financial institutions to obtain, verify, and record
1nformat1on: Domestic Wire Transfer- In or Ou" -> "Domestic Wire Transfer- In or Out"), 1 is added ("■
Card Replacement Fee. You may be charged $3 for each replacement Card", a real price whose sentence name
publish holds as `cutoff_name`) and none is lost. Seven longer passages (Steel Valley's current text
and parts of texts 453, 12968, 35762, 20851, 37280 and 16529): 9 renamed, 1 added ("Wire Transfers:
Customer (Outgoing)" $28, the page's own price, from "per presentment** | • Customer (Outgoing) |
$28.00" under "Wire Transfers") and none lost. The
five answer-key fixture texts with the shape read the same. Each changed read was checked against its own
line.

**Agent lesson:** knox/live-audit-2026-11-02-bullet-item-own-row

**Guard:** `src/lib/agents/knox/bullet-cell-rows.test.ts` (Steel Valley's rows on both layouts, the
shared check on the stored text, the lines kept whole, the retidy's renames and refusals).
