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
- **Knox v164** (`bulletItemRead`, `src/lib/agents/knox/bullet-cell-rows.ts`): a read whose own line has
  a later cell opening with a list bullet and words, with the line's price in that cell or after it and
  none before it, and whose name opens with the cells before the bullet, takes the name Knox's rules give
  the bullet's item alone at the same category and amount, when exactly one such name exists. It renames
  only: no line moves. The name is kept when the cells before the bullet name the read's category ("NSF
  Fee | • Per Item | $30.00"), carry an audience (`AUDIENCE_WORDS`: business, corporate, organization,
  non-customer, non-member and the like: "Business Accounts | • Stop Payment | $30.00"), or the item
  alone reads no such fee ("Wire Transfers | • Outgoing Domestic | $35.00"). A bare bullet cell, a bullet
  in the first cell, a price before the bullet and an account's own fee (monthly maintenance, minimum
  balance) are never renamed. The stored text and the shared check are unchanged.
- **Name retidy v28** (`bulletItemName`, `src/lib/agents/knox/name-retidy.ts`): a live name that is such
  an item with the other column's cells glued in front takes Knox's read today (`reReadName`, one name at
  the fee's category and amount in its own text), only when its own page prints that name as a bullet
  item and the dropped words hold no price and no audience (the same `AUDIENCE_WORDS`). It goes through
  the retidy's category, twin and trace checks and `writeLiveRenames`. It renames; it holds, re-files and
  takes down nothing, so no Darwin re-check or switch is added. Steel Valley's three come first.

**Review of #2952 (Nov 2):** the first version read the bullet's item as a line of its own and moved the
cells before it below the run of bullet rows. An independent review found a false read on Elite Community
CU (institution 7106, document 18405, text 13895), whose left column is itself a wrapping bullet list
("• IRA administration | • Check cashing fee….$1.00" over "fee………$15.00/year | per $100.00"): the moved
cells came back out of place and the priceless "• IRA administration" named the dormant account's
"Accounts……$5/month", a $5 `ira_administration` fee that passed every check (the live IRA fee is $15). The
review also found a lost read on text 15434 ("Debit card PIN rush delivery fee" $15) and wire, NSF and
business lines that lost their heading or label. Every multi-line reader (wrapped bullets, context
headings) depends on the stored line order, so the fix was rebuilt as a rename that leaves the lines alone.

**Sample (Knox before and after, prod stored texts, read-only, Nov 2):**
- Full texts, 20 two-column pages whose both columns are bullet lists (86, 260, 372, 937, 1965, 3192,
  8731, 10540, 11791, 14464, 15827, 16570, 18387, 20290, 20851, 30080, 30302, 30610, 33581, 37280) plus
  Elite Community's 13895, each hash-checked against its `text_hash`: 26 reads renamed, none added, none
  lost, 453 unchanged. 13895 keeps "IRA administration fee" at $15 and reads no $5 IRA fee; its two
  renames are "Loan, IRA, Checking, Certificate: Domestic Wire-In fee" -> "Domestic Wire-In fee" and
  "Savings Account Fees: Money order" -> "Money order". 15434's PIN rush fee is read, renamed from "No
  minimum balance required to earn dividends: Debit card PIN rush delivery fee". 30610's "Money Order
  Research Fee" is no longer a new read.
- The first sample, 61 stored lines of the shape and 7 longer passages: 30 renamed, 1 added ("■ Card
  Replacement Fee. You may be charged" $3, a real price whose glued name had failed a later name check;
  publish holds its sentence name as `cutoff_name`), none lost.
- One rename is partial: text 3192's "Text Messaging: Teller Service at Forrit CU: Item Sent for
  Collection" becomes "Teller Service at Forrit CU: Item Sent for Collection" (three cells, two of them
  bullets; amount and category unchanged). Each changed read was checked against its own line.

**Agent lesson:** knox/live-audit-2026-11-02-bullet-item-own-row

**Guard:** `src/lib/agents/knox/bullet-cell-rows.test.ts` (Steel Valley's rows on both layouts, the
shared check on the stored text, Elite Community's $15 IRA fee and no $5 one, 15434's PIN rush fee, the
wire, NSF, business and non-customer lines that keep their heading, the retidy's renames and refusals).
