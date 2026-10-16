# Knox Agent Guide

Knox owns conservative raw fee extraction.

## Authority

- Knox reads `agent_source_texts`.
- Knox writes source-grounded rows to `raw_fee_observations`.
- Knox may emit review signals when normalized text has no usable source-grounded fee candidates.
- Knox may flag ambiguity, lineage gaps, policy conflicts, and outliers for Darwin/operator review.

## Required Behavior

- Extract only rows supported by normalized source text and source-document lineage.
- Preserve institution ID, source document ID, source URL/key, extraction confidence, canonical hints, amount/frequency/conditions, and outlier flags.
- Emit aggregate Hamilton Monitor signals for inserted raw observations and no-candidate review states.
- Keep rows provisional until Darwin verifies them.
- Re-review thin documents: a text with fewer than 5 Knox fees (`KNOX_REEXTRACT_MAX_FEES`) is
  extracted again each time `extract.rules` moves to a new version (see "When Knox reads a text
  again" below); the raw-row dedupe index keeps fees found before from being inserted twice.
- The rules live in `rules.ts` (`extract.rules`; bump `KNOX_RULES_STRATEGY.version` in
  `specialists.ts` when they change, and add the version to the history below). Patterns are
  ordered most specific first; monthly maintenance and minimum balance come last. On a line,
  the first amount is the fee; a later amount is another fee only when words naming one sit
  just before it.
- Knox reads each text once per rules version: the extract step never picks a text that has an
  `extract.rules` attempt at the current version for the same institution and text hash
  (`pipeline_attempts`). A text whose document has no Knox row carrying its `text_hash=` (in
  `conditions`) is read; a text read before is read again only for the reasons listed below.
  When a Rosetta re-read changes a document's text, Knox extracts the new text and retires the
  unverified rows it took from the older text (`needs_darwin_verification` removed,
  `superseded_by_reread` added). Rows Darwin already verified are left alone.
- The raw-row dedupe index is (document, lowercased name, amount, `fee_audience`)
  (`raw_fee_observations_knox_agentic_dedup_idx`, migration
  `20270110000040_fee_audience_integrity.sql`), so one document may hold the same name and price
  once per audience. A traced read that meets a row of the same key held as `unclassified` or
  `untraced` takes it over (`knox_promoted_from_held`); any other existing row is left as it is.
- One document per page. When Magellan stores a newer copy of a page (`superseded_by_id`,
  `magellan/current-copy.ts`), Knox stops reading the older copy once the current copy has
  a text. Each extract step also retires up to 2,000 unverified rows from older copies
  (`needs_darwin_verification` removed, `superseded_by_newer_copy` added), but only for a
  category Knox has already read from the current copy, so a fee the newer read misses
  still goes to Darwin. Verified rows are left alone; live fees a newer copy dropped are
  Hamilton's (`hamilton/newer-copy-retire.ts`).
- An older copy's rows never stop the current copy from being read: a page re-fetched with
  the same text used to be skipped as "already extracted under another document", so it was
  never read again by a newer rules version.
- Banks of $10B or more in assets (`KNOX_REREAD_ASSET_FLOOR`) have each current page re-read
  once per rules version, ahead of other texts. The rules re-check only reaches documents
  with live fees, so a large bank's missing fee otherwise waited for a new copy of its page.
  Among them, a bank with no live overdraft fee goes first, then the page Knox read longest
  ago: ordered by newest text alone, each version bump (ten on Oct 8) restarted the same banks
  and the tail, GreenState among them, was never reached.
- A priority bank (`KNOX_PRIORITY_REREAD_IDS`) or state market leader with no live overdraft
  fee has its current page re-read once per rules version too, so a rules fix for a missed
  overdraft reaches it. `asset_size` is in thousands, so the $10B floor misses most state
  leaders.
- Exact fees go to Darwin with `needs_darwin_verification`. Waived fees keep their price
  and a `waivable` flag. A free fee ("Free", "No charge" or $0 next to a recognized fee
  name) is stored at $0 with `knox_review:zero` and `needs_darwin_verification`, so Darwin
  can verify it as a real $0 price. Ranges, percentages and priced lines no rule
  recognizes are stored with `knox_review:<shape>` (plus `amount_max:` / `percent:`) and
  without `needs_darwin_verification`, so Darwin never verifies them as exact amounts.

## When Knox reads a text again

The extract step (`textArtifactQuery` in `extract.ts`) picks texts that are completed and not
already read at the current rules version. With the attempt log in place (not in a dry run), a
text Knox has read before is picked again when any one of these holds:

1. Thin: the document has fewer than 5 Knox rows (`KNOX_REEXTRACT_MAX_FEES`).
2. Missing fees: Hamilton's rules re-check (`hamilton/rules-recheck.ts`) recorded fees today's free
   team reads from this document that are not live (`missing_fees` above 0 under the current
   `knoxFreeSignature()`).
3. Large bank: the bank has $10B or more in assets (`KNOX_REREAD_ASSET_FLOOR`, `asset_size` in
   thousands) and the document is a page's current copy.
4. Older copy still live: an older copy of this page still carries a live fee.
5. Stale read: the current copy has no `extract.rules` attempt at v26 or later
   (`KNOX_STALE_READ_BELOW_VERSION`).
6. Lineup gap: the current copy has a `monthly_maintenance` row with no account name, or with
   neither the balance that avoids it nor its waiver, and no attempt at v51 or later
   (`KNOX_LINEUP_READ_BELOW_VERSION`).
7. Priority bank: the bank is in `KNOX_PRIORITY_REREAD_IDS` or is a state market leader, the
   document is its current copy, and the bank has no live overdraft fee. A run for one institution
   (Atlas's read-now runs) uses that institution alone as the list and drops the overdraft
   condition.

Triggers 4 to 7 need Magellan's current-copy columns (`currentCopySchemaReady`). Every pick still
skips an older copy whose current copy has a text, and a text already read under another document
id of the same bank (an older copy's rows never block the current copy). Bayes's replay ledger
counts the current copies these triggers would pick with the same query (`countKnoxRereadsDue`,
`countKnoxRules` in `bayes/manifests.ts`); a current copy that matches none keeps its older read.

## Rule-change gate

`answer-key-gate.test.ts` scores the free team plus Darwin's rule checks (the set the rules
re-check keeps live) against 43 hand-checked Texas schedules (`__fixtures__/texas-answer-keys.json.gz`,
26 used while writing rules, 17 held out). CI fails a change that loses a right fee or adds a
wrong read. When a change really improves Knox, raise the floors in the same PR; lower one only
with the reason in the PR. Baseline at v12: 436 right of 454 reads (96.0%), 436 of 772 key fees
found (56.5%); held out: 41 of 47 (87.2%), 41 of 99 found. At v14: 455 of 473 (96.2%), 455 found;
held out 43 of 49, 43 found.

Texas is the test bed; `state-answer-key-gate.test.ts` holds the same gate on 38 schedules from
CA, FL, GA, IL, MI, MN and NY (`__fixtures__/state-answer-keys.json.gz`, never used to write
rules), with a floor per state. Baseline at v12: 665 right of 724 reads (91.9%), 665 of 1,215 key
fees found (54.7%); 56 of the 59 wrong reads are the right price under another category. At v14:
677 of 736 (92.0%), 677 found (55.7%).

## Rules versions (`extract.rules`)

v14 added names the keys showed held as unclassified (account closing, reactivation, domestic
wires without a direction, child support, legal orders, negative balance, audit confirmations,
IRA custodial, document copies) and a checking account's own monthly price ("Opportunity Checking
| $10 per month"). Returned mail and foreign item collection stay unclassified: the Texas keys and
the taxonomy file them differently, and Knox waits for one answer.

v15 (rules 15, table 5, families +1) came from Rosetta's look at two live stacked pages. A line
that only qualifies the name above it ("(for each overdraft item paid)", "(up to $1,000)", "If
checks are not on order") no longer becomes the fee's name or breaks the name/price pair
(`qualifiesName` in `layout.ts`). Table headings may run to 10 words, so "ATM fees per transaction
– At non-Wells Fargo ATMs" names the "Cash withdrawals - Within U.S." row under it; "At <Bank>
ATMs" without non/other is the bank's own machines and is not out-of-network. Also read: "Debit
Card (replacement or PIN)" and "Deposited checks (and other items) returned unpaid". At v15:
Texas 460 of 478, held out 43 of 49; seven states 681 of 739. Hold statements, special statement
cutoff, account activity printouts and a debit card's own monthly charge have no taxonomy
category (the keys file them as unmapped), so Knox still leaves them out. A rules
change scores both gates; a fix that helps Texas and hurts another state fails.

v16 (rules 16) fixes the category errors found in the live seven-state and Texas measures:
"Int'l" and "out of country" wires are international (a "domestic/int'l" price stays
domestic), "International Wire Out" is outgoing, checkbook balancing is account research
rather than check printing, and a name that opens with NSF is NSF when only a condition
mentions an overdraft ("NSF Fee (fee applies when overdraft is created)"); a combined
"NSF/Overdraft" fee stays overdraft. At v16: Texas 461 of 478; seven states 683 right, 55 wrong.

v17 (rules 17) adds Knox's self-check: every free find, and every $0 row, is checked against
its text with the shared accuracy check (`checkFeeAgainstSource`, the rule Darwin applies
before publishing). A find that doesn't trace is held for review as `untraced`
(`knox_review:untraced`) instead of going to Darwin, where it would be rejected as
`not_in_source`; a later specialist that reads the same fee under a traceable name keeps it.
Each specialist run records `self_check_failed`. Since v17 the gates count only reads that
pass the self-check, which is what can be published: Texas 444 of 459 (main at v16 scored 444
of 459 on that basis), held out 43 of 49; seven states 660 of 708 (main: 659 of 707). The same PR
widens the shared check for layouts it missed (a price on the line after a dot leader,
FREE/NONE on a flattened line, a note line between name and price, a daily cap), which lifts
the gates to Texas 446 of 461 and seven states 665 of 713 with no new wrong reads.
v17 also tidies every fee name (`tidyFeeName` in `layout.ts`): table separators, dot
leaders, bullets, list markers ("b.") and a neighbouring cell's unit ("Per Item", "/Item",
"N/C") are not part of the name. Category, price and excerpt are unchanged. Hamilton's
supersede match and the rules re-check restore compare tidied names, so a line live under
an older untidy name is still the same line. In the 117-document live sample, untidy names
fell from 136 to 3; gates and the dry run are unchanged.

v18 (rules 18) reads low-balance account rows and their prose. A checking account row priced
monthly with a balance condition that the maintenance guard keeps out (money market) is the
account's `minimum_balance` fee, named by the row's condition. A sentence that prices a fee
and says it applies when the balance falls below a figure ("A club fee of $8.00 ... if the
balance ... falls below $3,000") is a `minimum_balance` fee named by the fee's words and the
condition; the fee and condition must share one sentence, and the price is never the balance.
New name patterns cover "Average Daily Balance below", "Low-balance fee", "Below minimum
balance" and misspelled "MININUM BALANCE FEE". A comparison sign ("< $2,500") makes a figure a
condition. Prose maintenance fees keep the bank's own words ("Maintenance fee") so the shared
check can trace them. Wires: "Non-Domestic Wire" and an international wire with no direction
are outgoing international; one price for "Domestic or International" is the domestic one. A
figure followed by "par" or "required" ("$5 par in Primary Savings is required") is a
requirement, not a fee. Gates: Texas 452 of 467 (v17: 446 of 461), held out 43 of 49, seven
states 673 of 720 (v17: 665 of 713).

v19 (rules 19) fixes large banks' overdraft rows. "Overdrafts Paid" and "Overdrafts (OD)" are
overdraft (the plural names the fee only when it opens the name or a fee word follows it); an
insufficient-funds item the bank pays ("Item Paid") is overdraft. A fee written as a sentence ("We
charge a fee of $37.00 each time we pay an overdraft") is named by what it charges for
("Overdraft fee (each time we pay an overdraft)"); "one ... per day" stays in the name, because
the daily-cap categories hold dollars. On a dot-leader line with two prices, lowercase words
after the first price are its terms and the title before the second price is the second fee's
name. Fee cards tiered by the item's value ("Fee Type" / "charged a fee based on the value of
the item" / "Greater than $5.00: $5.00") are read per tier, and a price whose next cell is
prose ("$30.00 | ... unless you opt in") is never named by that prose. The shared check now
reads such a price line under its name and accepts a tier named by its own band. Gates unchanged.

v20 (rules 20) files "ATM Foreign Transaction Fee" (and "ATM – Foreign Transaction", "Debit ATM
Foreign Transaction") as `atm_non_network`: it is what a customer pays at another bank's ATM, not
a card's foreign transaction fee. "ATM/Debit Card International/Foreign Transaction Fee" and
"Debit/ATM Foreign Transaction" name the card and are unchanged.

v21 (rules 21) reads more percentage-fee lines (see "Percentage fees" below): the card's currency fee under its other names
("Foreign Transactions", "International Point of Sale Fee", "Cross-Border Assessment",
"International Service Assessment", "Multi currency"), coin counting under "Coin Counter",
"Coin Machine", "Loose Coin" and "Count and roll coins", and a rate whose dollar minimum follows
it ("Cash Advance | 3% of each advance ($5.00 minimum)"). Flat gates and the live dry run are
unchanged; on the answer keys Knox reads 20 rates, 18 keyed and 2 real fees the keys leave out.

v22 (rules 22, family experts +1) reads the overdraft layouts that left several of the largest
banks with a stored overdraft fee that was never live:
- a fee charged to customers in a sentence ("Customers are charged a fee of $30 each time an
  overdraft transaction is paid"), even after a question that names it;
- one-line PDF dot-leader schedules: a period inside a leader no longer ends a sentence, and
  a leader row ends after its price ("Overdrafts fee (per item)……………$36");
- a long description row whose only other cell is its price ("Overdraft Fee Assessed when ...
  per day. | $36.00"), named by the row's title. The shared check reads the same row the same
  way;
- a row's price cell repeating the price in the same cell is not a second fee;
- "Overdrafts Returned" is NSF, and "Maximum daily Overdraft ... fees" is the daily cap.

Answer keys: Texas 454 of 468 (main 452 of 467), held out 45 of 50 (43 of 49), seven states
674 of 720 (673 of 719). Live dry run: 1,414 of 1,437 kept, the same fees as main.

v23 (rules 23, table 6) reads two layouts the audit found missing fees:
- labeled fee cards, one field per line ("Fee TypeCourtesy Pay Overdraft Fee" / "Description..." /
  "Fee$5.00"), as ESL prints them. The card's name and price are joined into one row before
  any specialist reads the text, and the shared check (`joinLabeledFeeCards` in
  `source-check.ts`) joins them the same way. A card never takes the next card's price;
- a two-column schedule flattened row by row, where the right column's fee heading ends a
  left-column row ("• Business | $5.00 | Overdrafts (OD)") and its bulleted sub-rows follow
  ("• Personal | $36.00"), as Trustmark prints NSF and overdraft. A two-cell sub-row belongs to
  the heading only directly under it or its last sub-row; a line with both columns places it by
  position; a right-column row of its own ends the heading. The shared check reads such a
  heading only over a bulleted line under it.

Answer keys and the live dry run are unchanged from v22. The shared check accepts exactly the
same (name, amount) pairs as before across the answer-key and live texts (5,678 of every read
name tried at every price in its document).

v24 (rules 24, with category guard v13) keeps a loan's late fee out of the overdraft category and an
"Int'l" wire out of the domestic ones. v23 was taken on main by the table-row headings, so this rule
shipped as v24.

v25 (rules 25) reads one-line PDF schedules, where a whole page of dot-leader rows is stored as one
line ("Stop Payment………………. $35.00 Over $300 USD……. $40.00 Dormant Account Fee……. $7.00/Month").
The shared check used to split that line after every period, including the last period of a dot
leader, so each fee's name and price landed in different pieces. Knox's specialists read the fees
and then held them as untraced (West Shore Bank: stop payment, cashier's check, dormant, overdraft,
garnishment, late charge). The shared check no longer splits inside a leader. Also, a two-dimension size in
inches ("10.5x10.5 Inch") is a safe deposit box, even under the next section's heading, and a name
no longer starts with the previous row's bare price ("100.00 Overdraft (items paid)").

Answer keys: Texas unchanged, held out unchanged, seven states 675 of 721 (674 of 720). Live dry
run: 1,413 of 1,437 kept, the same fees as main. The shared check, tried on every read name at every
price in its document, drops 7 wrong pairs (a name taking the next row's price), adds 1 right pair,
and adds 1 wrong pair. The wrong pair is "Tracer placed on International Wire" at $10: the name's
stem "place" also matches inside "Replacement" in a nearby row. That substring weakness is older
than this change.

Also from v25, a page's current copy is read again once per rules version while an older copy of the
page still carries live fees. On 2026-10-07, 898 live fees on older copies were missing from their
current copy's Knox rows, though the current text still showed the amount. Most of those current
copies had last been read at rules v1 to v7, and none of the re-read triggers reached them. 1,017
current copies qualify. 211 of the 898 are read already, on a second document that holds the same
text. Knox reads a text once, so their current copy has no rows of its own.

v26 (rules 26) folds the held groups James chose to fold (decision card, Oct 7 2026) into the
category the taxonomy already gives them (`FOLDED_PATTERNS`): returned mail, bad address, fax
and excess withdrawals into account research; collection items and foreign checks into check
cashing; loan cancellation, credit reports and UCC filings into loan origination; loan
refinancing and document fees into other lending. The answer keys left these lines "unmapped",
so the gate re-files them the same way. At v26: Texas 486 right of 500 reads; seven states 712
of 759; no new wrong reads. Dry run on 13,383 held lines: 1,622 get a category (1,559 by the
fold). Membership, phone transfer, credit card, uncollected funds and returned statement fees
stay held.

v27 (rules 27) reads two-column schedules where the right column's footnotes run beside a left-column
heading ("Wire Transfer Fees | being returned NSF."). A two-cell line with no price, whose left cell
looks like a heading and whose right cell opens lowercase or with a footnote number, now sets the
heading, so "Domestic Outgoing | $35.00" under it is an outgoing domestic wire. A stop payment
heading also lends itself to the item it stops ("Online per check"). One price whose name joins NSF
and overdraft ("NSFs/Overdrafts", "Overdraft or NSF") is filed under both, as the answer keys file
it. A balance an account requires ("Minimum Daily Balance Requirement | $1,000") is never held as a
fee, and an "Insufficient Funds Transfer" from savings is an overdraft protection transfer, not an
overdraft. Found on First National Bank Alaska (doc 19925), which was 2 headline fees short of a
report. Answer keys: Texas and held-out unchanged, seven states 713 right (712), the same 47 wrong.
Live dry run: the same 1,412 of 1,437 kept. Across the 117 live-sample documents it adds 7 reads,
each checked against its line, and moves one $2.50 transfer from NSF to overdraft protection.

v28 (rules 28) never reads a limit as a price. A name that ends on a limit ("Zelle transfer limit",
"Mobile Deposit Checks are limited to", "VISA Gift Cards: Maximum card load", "Cash Advance Fee
(maximum", "Zelle (Daily Limits)") states the most a customer may move, not what they pay
(`namesALimit` in `layout.ts`). A cap category keeps its cap ("Overdraft and NSF Daily Maximum"), a
fee for going past a limit keeps its price ("Over Limit", "Limit Violation"), and a fee's own note
keeps it a fee ("Mobile Deposit Fee (daily limits apply)"). The paid reader rejects the same rows
(`limit_not_fee`). The shared check now also reads a price under a dollar written "$.50" or "75¢",
and the paid reader counts those lines and skips an older copy of a page whose current copy has a
text, as the free reader already did. A family expert names a fee after the previous fee's note
("Check printing – (fee depends on style) Temporary check – $.20" is a temporary check). Answer
keys: Texas 500 right (495), the same 15 wrong; held-out 48 right (47); seven states unchanged.
Live dry run: 1,419 of 1,437 kept (1,418), nothing lost.

v29 (rules 29) tidies names that ran on into their price. A short name loses the connector before
the price ("Visa Lost/Stolen Replacement Card Fee of", "Non-Bank of America ATM Fee for",
"Debit Card Replacement A fee of") and a leading article ("A minimum balance fee" becomes "Minimum
balance fee"), and a "None" or "Free" cell between two names is the previous row's price, so the name
starts after it (`tidyFeeName`). A sentence of more than eight words keeps its ending, because the
category guard reads "required to avoid a minimum balance fee of" as a fee. Answer keys: Texas 501
right (500), the same 15 wrong; held-out 49 right (48); seven states unchanged. Live dry run: 1,419
of 1,437 kept, the same fees.

v30 (rules 30) narrows the fold after checking prod's first v26 pass (three extract runs, 01:51 to
02:02 UTC Oct 7: 60 lines categorized, 527 set aside). Six of the 60 went to the wrong home: a
collection fee on charged-off accounts and a collection phone call are debt collection, not a
check sent for collection; a funds transfer requested by phone or fax is not a fax fee; a credit
report to open an account is not a loan fee. Those lines now stay held. Each extract step also
re-reads lines it promoted from held that Darwin has not verified (`recheckPromotedRows`): one
today's rules no longer file under the same category goes back on hold, leaves Darwin's queue,
and is logged as `wrong` (`knox.held_withdrawn:raw:<id>`), never deleted. Promoted lines Darwin
already verified are Hamilton's rules re-check's to take down.

The same v30 also reads two more limit wordings as ceilings, not prices: a limit that "will increase
to" a figure ("the Overdraft Privilege limit will increase to $1,500") and a limits row with a
"($/#)" note ("Daily ATM Limits ($/#) $505"). Both reached raw rows from v29's first run on prod.
Answer keys unchanged; live dry run: 1,419 of 1,437 kept, the same fees. This change (#350) merged
after the fold change (#336) had already set the version to 30 and did not bump it again, so both
read under v30.

v31 (rules 31) reads a cap on what the bank pays back ("The maximum rebate per 12-month cycle $240",
ATM surcharge rebates) as a limit, not a fee. It reached raw rows on v30's first prod run (03:21 UTC
Oct 7), which otherwise showed none of v30's limit wordings and no dangling names in 362 reads.
Answer keys unchanged; live dry run: 1,419 of 1,437 kept, the same fees.

v32 (rules 32, from Space Coast CU's page, Oct 7):
- "Incoming Wires" and "Outgoing Wires" read in the plural.
- "(Outside U.S.)" is an international wire.
- An account named with the balance it must keep ("Money Market Savings Account (below $2,500) | $15/mo.") is that account's low-balance fee.
- When two fees' names share a row before one price ("Returned Check | Verification of Deposit | $20"), the price and the name are the nearest fee's.
- A name that closes a parenthesis it never opened ("SCCU for using a non-SCCU ATM) | $60") is the end of a wrapped line, not a fee.
- Answer keys: TX 503 right / 15 wrong (unchanged), 7 states 721 / 47 (was 719 / 47). Live dry run: 1,418 of 1,437 kept, the same as v31.
- "... to avoid a minimum balance fee of $3.95" is read as the $3.95 fee, not the balance thresholds (Security First Bank of ND).
- A price followed by "when performed at an ATM we do not own or operate" keeps that clause in its name. It is read only once the category guard accepts the name; today the guard refuses "Deposits/Withdrawals" as an ATM fee (Pathfinder).
- "Account Link Overdraft Protection | $10" is an overdraft protection transfer, not an overdraft fee (Spencer Savings).
- A figure from a worked example ("Example: Assume you establish a bill pay payment ... in the amount of $100") is not a fee. Hamilton's limit guard flags live ones as `worked_example` and takes them down after its second look (Northwest Bank's $100 bill pay, plus 2 more on Oct 7). Confirmed takedowns become Knox takedown lessons (PR 393).
- Current pages last read before v26 are read again once (`KNOX_STALE_READ_BELOW_VERSION`; 5,474 pages at 4,265 banks on Oct 7). Market leaders and `KNOX_PRIORITY_REREAD_IDS` (report-gap banks, Space Coast) go first.
- Not read yet, because the shared source check can't trace them: safe-deposit-box size grids (sizes on one row, prices on the next) and a price that wraps to the start of the next row ("Returned Check ... | $20" / "$30 | ...").

v33 (rules 33) names overdraft fees from their section heading or a term defined above them; see
"Fees named by page context" below.

v34 (rules 34, from the $10B+ banks with no live overdraft fee, Oct 8):
- "You still pay a fee of $35 per item for overdrawing your account, but ..." is the overdraft fee; a sentence fee's clause ends at ", but" / ", and" (Park National).
- "Insufficient Funds Charge (Paid)" beside "(Returned)" is the overdraft fee (WaFd; guard v29 refiles it the same way).
- A promoted held line whose stored name does not say its category ("You still pay") takes the name today's rules read.
- "Per transaction" (and "transactions") is a unit cell, so "Overdraft Fee - Items Paid3 | Per transaction | $20.00" is the overdraft fee, not an unnamed price (Banc of California).
- A change the bank says it already made ("We've lowered Overdraft Paid Item fees from $38 to $30") is today's price at the later figure. A change still to come ("will", "effective", "beginning") stays a held range (Pinnacle).
- The held re-check also re-reads range lines that say a price was changed, and promotes one only at its stored amount (the lower end), so a raised price stays held.

v35 (rules 35, from the state top-10 banks with no live overdraft fee, Oct 8):
- A fee name that opens a note and wraps onto the next line or two, with its price alone below ("Overdraft Fee (per item, ... in person withdrawal," / "ATM withdrawal, ... per day.)" / "$36.00"), is that fee at that price, named by its first line (`wrappedNamePrices`, MVB). The shared source check reads the run-on note as a qualifier between the name and the price.

v36 (rules 36, same lane, Oct 8):
- A price printed between a two-line name's lines ("Overdraft Fee³ - All Checking and Savings Accounts" / "$33" / "(Including Money Markets)") is that fee at that price, when the line below only finishes the name's note (`centeredNamePrices`, Starion).
- Footnote marks read onto a price alone on its line ("$334, 5" for "$33⁴,⁵") are dropped when they count up from the price's last digit and each is printed as a numbered footnote (`stripPriceFootnoteMarks` in `source-check.ts`, which Knox and the shared source check both apply). A single mark ("$331") stays: nothing tells it from a price.

v37 (rules 37, same lane, Oct 8):
- A sentence fee may say "a one-time fee of", "a per-item fee of" or "a flat fee of", and a cap after its clause (", not to exceed $180 per day") is cut from the name, not read as a second price in it ("We will charge you a one-time fee of $36 each time we pay an overdraft, not to exceed $180 per day", Guaranty).

v38 (rules 38, same lane, Oct 8):
- A threshold in a cell of its own ("Courtesy Pay | Over $5 | Per occurrence | $32", Lighthouse) no longer hides the fee's name from the classifier, and stays in the name with its figure ("Courtesy Pay (over $5)"), which is how the shared source check tells it from a tier.
- "Privilege Pay" is an overdraft name, so one price for "NSF, Privilege Pay, & Uncollected Funds Fee" (Arkansas FCU) files as the overdraft fee, like "NSF/Overdraft".

v39 (rules 39, from the $10B+ banks with no live overdraft fee, Oct 8):
- "OD" and "O/D" followed by the fee's own word ("OD Privilege", "OD Fee-Item Paid", "Paid Item O/D Fee") name the overdraft fee. Before, such a line was read as no fee at all, not even held (GreenState's "OD Privilege* ... | $29.00/Item"). 29 banks' texts have such a line, 10 of them with no live overdraft fee.
- "Continued OD Charge", "Consecutive Day OD Fee" and "Daily OD Fee" are the continuous overdraft charge, as the spelled-out names already were.
- "NSF/OD Charges | $30" is the price for both the NSF and the overdraft item, like "NSF/Overdraft" (v27).
- The held re-check takes $10B+ banks' held lines first, as Knox's re-reads do; a full pass over about 19,000 held lines takes about 12 hours at 300 a step.

v40 (rules 40, from the state top-10 banks with no live overdraft fee, Oct 8):
- "Paid Item Fee" is the overdraft fee ("We may charge you a Paid Item Fee of $30.00 if we pay an item that exceeds your Ledger Balance", Northeast Bank). A combined "NSF paid item fee/NSF returned item fee" stays with NSF.
- A sentence that charges a fee by its own Title Case name ("We may charge you a Return Item Fee of $30.00") is named by that title, not by the sentence around it.

v42 (rules 42, from Marketing's outreach batch, Oct 8; v41 is left for the Top 50 branch):
- A paid NSF item is the overdraft fee: "Paid nonsufficient funds (NSF)" (Saco & Biddeford), "NSF Share Draft (Honored)" (Bluestone FCU), "Paid Consumer & Business NSF Items" (NIH FCU). A returned or unpaid one stays NSF.
- A long name that ends in a note keeps its title: "Overdraft Fee* - each debit or check presentment paid (Consumer Accts: 5 max total OD or Returned Item fees daily)" was named "5 max total OD or Returned Item fees daily" and filed as NSF (BankIowa).
- In a table row, a last text cell that only lists what an overdraft covers ("Checks (Share Drafts), Online Payments, & ACH", "For Debit Card Transactions including ATM, POS") does not name the price; the overdraft cell before it does (Los Angeles FCU).
- A price row named only by its threshold ("Per Item greater than $10.01 | $30 per item") belongs to the priceless fee line just above it (NIH FCU).
- A run for one institution (Atlas's read-now runs) reads its current page again once per rules version while it has no live overdraft fee, as state leaders' runs do since v40.

v43 (rules 43, Oct 8):
- One price for the paid and the returned NSF item ("NSF Paid Item Fee/Returned Item Fee (items over $10) | $32", Pinnacle Bank Wyoming) is the overdraft price too, like "NSF/Overdraft". Before, Knox filed it as NSF and both guards rejected it, so the fee went nowhere.

v44 (rules 44, Oct 8):
- Knox writes a fee's frequency on new reads with the shared reader (`src/lib/fee-frequency.ts`):
  the words right after the fee's own price, or its name when nothing follows. Hamilton's publish
  step fills blank live rows with the same reader.

v45 (rules 45, Collection Items, Oct 8):
- An item sent for collection, or a foreign or Canadian check or item handled for deposit ("Collection Item", "Items Sent for Collection", "Foreign Check Processing"), files as `collection_item`, not check cashing (James, Oct 8: "Own type"). Cashing a foreign check is still check cashing and a returned one is still a returned item. The pattern is `COLLECTION_ITEM` in `src/lib/fee-fold.ts`, shared with the category guard and Hamilton's fold step.

v46 (rules 46, from Origin Bank's overdraft rows, Oct 8):
- A paragraph wrapped across lines is read as its sentences: a line joins the one above when neither is a table row, the one above is at least 40 characters and ends mid-sentence, and the line starts in lower case. Read line by line, "we will charge you an overdrawn account fee of $10.00 on the 5th consecutive" was named by the line above it and filed as a $10 overdraft fee, and "overdrawn $5 / or less" lost the words that make $5 a threshold (Origin Bank, whose fragment-named overdraft rows were live).
- After a general "fees and charges", a price is named by what follows "including": "Normal bank fees and charges, including returned item charge/overdraft item charge of $35.00" is "Returned item charge/overdraft item charge". "NSF for each presentment, including if the same item is presented" keeps its name.

v47 (rules 47, Oct 8; merged with v48 in #696):
- A fee's frequency comes from its own row first (`settledFrequency`): a period word that sits
  only in another priced cell ("per year" on the row above "Reverse Stop Payment Request $20") no
  longer sets it.

v48 (rules 48, Oct 8):
- A fee-change notice's row ("Fee through | Fee as of", "Money Orders | $2.00 | $5.00") is read at
  its newest column (`newestColumnText`), and the shared source check reads it the same way, so
  the old price no longer goes live (Jeanne D'Arc CU).

v49 (rules 49, Oct 8):
- A monthly fee with no account name takes it from its own name or the heading above it
  (`lineup.ts`).

v50 (rules 50, Oct 8):
- A personal per-item-paid row under an overdraft heading; see "Fees named by page context" below.

v51 (rules 51, Oct 8):
- A monthly fee also takes the balance that avoids it, its waiver and the opening deposit from its
  account's lines. Current copies with a monthly fee row missing them are read again once
  (`KNOX_LINEUP_READ_BELOW_VERSION`, trigger 6 above).

v52 (rules 52, Oct 8):
- Frequency is settled by the frequency fill's rule (`settledFrequency`), with fee-frequency v4
  wording.

v53 (rules 53, Oct 8):
- A fax service is document reproduction, the fold's home for it (`FAX_SERVICE`).

v54 (rules 54, Oct 8):
- A copy charged by the page is document reproduction, even under research (`PER_PAGE_COPY`).

v55 (rules 55, Oct 8):
- A monthly fee's lineup is never read from a neighbour: the next account's fee line, another
  account's clause of a one-line footnote, or a fee heading above "Money Market" (`lineup.ts`).

v56 (rules 56, Oct 8):
- Balancing or reconciling a checkbook is account research (`CHECKBOOK_RECONCILIATION`).

v57 (rules 57, Oct 8):
- A long table row is traced by its short cells, and a name drops a details cell, an "N/A" cell
  and a leading "Otherwise,"; "to avoid $3 paper statement fee" is named after its price (Arvest,
  Old National).
- A fee whose own row traces reads its frequency from that row, not from a window that stops at
  the price ("... four (4) OD fees per day ... | $17.00 | per item" is per item).

No rules release used v58: #843 moved the version from 57 to 59.

v59 (rules 59, Oct 8):
- A "Cross-Border Banking" bundle or package is an account, so its fee is the account's
  maintenance fee, not the card's currency fee (`CROSS_BORDER_BUNDLE`; RBC, TD, BMO).

v60 (rules 60, Oct 8):
- A threshold parenthetical keeps its figure in the name ("Cashier's Checks ($10,000.01 and
  Over)"), a "Name" column label is dropped, and "In addition to the ... Fee" keeps its words
  (`nameFrom`, `tidyFeeName`).

v61 (rules 61, Oct 8):
- Adjusting an ATM deposit or dispute is account research, not a network ATM fee
  (`ATM_ADJUSTMENT`).

v62 (rules 62, Oct 9):
- A dot-leader line's name wrapped over lines above it is read whole (`joinWrappedLeaderNames`),
  "Domestic Outgoing (client only) .... $25.00 per wire" is a wire, and one source line read by two
  specialists is one fee, whatever each named it (`sameFee`; Northern Trust).

v63 (rules 63, Oct 9):
- A safe deposit box size glued after another fee's name starts its own line (doc 20570).

v64 (rules 64, Oct 9):
- A box table printed sideways, sizes over prices, is read one box per line (SCCU 8109).

v65 (rules 65, Oct 9, customer audience):
- Every read carries a customer audience (`fee_audience`: consumer, business, both or unknown),
  the words that show it (`audience_evidence`) and how the fee is treated (`fee_treatment`), from
  `feeApplicability` in `src/lib/fee-audience.ts`. Only the fee's own name, or an excerpt with one
  price or a completed price change, counts as evidence; unknown never means consumer.
- A completed statement that NSF fees were eliminated for one audience, optionally with the price
  changed for the other ("We've eliminated Non-sufficient Funds (NSF) Returned Item fees for
  consumer clients and lowered them from $38 to $30 for business clients", Pinnacle), is read as
  two NSF fees: $0 for the first audience and the new price for the second
  (`scopedFeeStatements`). A notice still to come, or one with any other clause, is not split.
- Two specialists' reads are the same fee only when their audience matches too, and a joined
  NSF/overdraft price is filed under both categories per audience.
- The held re-check does not promote a line from such a sentence (`recategorizeHeld`): one row
  cannot become two audiences, so the document's re-read writes them. Pinnacle (47) heads
  `KNOX_PRIORITY_REREAD_IDS` for that re-read.

Stored excerpt, #1394 (Oct 15, no version change, so no document is re-read for it): the
`excerpt="..."` Knox stores with an extracted fee holds only the fee's own cells of a two-column
line (`own-cells.ts`): the cell at its price that names it best, the price-less label cells before
it, and the period or condition cells after it. West Shore Bank's $40 outgoing international wire
was stored with the zipper-bag cell beside it. A tie, or no cell at the price, keeps the whole line;
held and rate rows, and the audience read, still use the whole line. Rows stored earlier keep the
whole line.

Rules 65, subordination (Oct 15, no version change): Knox reads a subordination fee as
`legal_process` (James, Oct 15, reversing Oct 8; `fee-taxonomy.ts`). Hamilton's rules re-check
counts that read as reproducing a live subordination still filed as `other_lending_fee` until the
fold's switched re-file moves it, so no live fee comes down for the change.

Rules 65, #1291 re-file check (Oct 14, no version change): three reads the re-file restore's
hand check found wrong, from their real lines.
- "Maximum Daily OD/NSF Fees $210 per day" is the overdraft daily cap, not a continuous
  overdraft fee ("OD" and "O/D" now count after "maximum daily", raw 406368).
- "Overdrafts Covered by Courtesy Transfer | $5.00 per item" is the overdraft protection
  transfer; the page prints its overdraft fee on its own line (raw 158607).
- An NSF-led name for an item returned or paid ("NSF Return/Paid Item Fee for Chkg. & Sav",
  Kewanee, raw 131332, beside its own "Overdraft Fee | $25.00") is the NSF fee. One price written
  "NSF Paid Item Fee/Returned Item Fee" (v43, Pinnacle) is still the overdraft price.
- A bare "Overdrafts" priced per transfer is the share transfer that covers them ("Share
  Transfer for\nOverdrafts - $2.00 per transfer", raw 112570). A bare "Overdrafts" priced per
  item is still the overdraft fee.

v72 (#1099, Oct 16): a loan's own servicing fees from Deming's answer-key misses (`rules.ts`, other lending).
- A loan, lease or mortgage payment made by phone, by debit or credit card, or by ACH ("Loan Payment
  by Phone Fee (ACH) | $15.00", "Loan payment by debit card fee") is other lending.
- A returned loan, lease or mortgage payment ("Returned Loan Payment Fee", "Bad Check Fee (Returned
  Mortgage Payment)") is other lending. A bare "returned payment", "returned item" or "returned check"
  names no loan and stays NSF or returned item.
- Not in v72: an amortization schedule (live as a document copy at two banks; the production key
  files it as lending) and a loan coupon book (the seven-state key leaves it unfiled) wait for a call.

v71 (#1100 gap 3, Oct 15): each checking product's monthly fee in an account comparison table, read by
its column (`extract.account_table` v1, `account-table.ts`; see Extraction Passes).
- "Monthly Service Fees | $0 | $5 | $10" under "Account | Great Checking | Better Checking | Best
  Checking" is three monthly fees, named by product ("Better Checking Monthly Service Fees"). The
  shared source check traces each with the same rule (`accountTableRow`); it can only turn a fail
  into a pass.
- Only checking columns, only the fee row, only under a header naming one product per price column.
  The guard's exclusions are unchanged (James to decide, #1100).
- Not read (#1438 review): a header one cell short whose first cell is a label ("Features | Simply
  Checking | Rewards Checking" over a row with three prices), a header of buttons or repeated cells
  ("Open Online | Open Account | Open Account"), a fee-change notice's dated columns ("fee through
  12/31"), and a table that sets big banks' accounts beside others ("US Bank Smartly Checking").
- In a cell, a balance or opening figure is skipped ("$25 minimum daily balance or $8" is $8), and so
  are a discount and a $0 that holds only under a condition ("$0 with $500 balance / $12" is $12). A
  cell with two fee figures left ("$7 + $0.40 per debit") is not read; the row's other cells still are.
- The header is the topmost row in the run above the fee row that names a product in every price
  column; a "Key Features" or "Best For" row is never the header ("No NSF Fees for overdrawing
  Account" is not a product). A header one cell short is read only when its first cell is a product.
  Cells that read as sentences, taglines or buttons are not products; MMDA and saver columns are left out.
- The run of rows above the fee row ends at an earlier fee row, so a table stacked under another of
  the same width keeps its own header; two product headers with different columns in one run are
  not read.
- Product names lose footnote marks, quotes, codes and arrows, and only an exact tagline or prose
  after the account word ("CLASSIC CHECKING Most Popular", "Open a Basic Account" is "Basic
  Account"). A tail that names an audience or variant stays ("Interest Checking for Ag", "Basic
  Checking - Senior", any "for …" tail), and so do a product's own words and digits ("Open Road
  Checking", "Tier3 Checking"). A table whose header names a business, commercial, ag or nonprofit
  account is not read. The shared check's table fallback reads the newest fee-change column, as Knox does, and
  passes only a consumer name the category guard files as monthly maintenance.
- Answer keys: Texas 551 to 552 right (Texas Capital), 14 wrong unchanged; held out 54 / 4 unchanged;
  seven states unchanged at 797 / 41.

v70 (#1100, Oct 15): monthly maintenance and low-balance fees the account expert (`extract.family.account` v5) missed.
- A low-balance charge with no fee word is the minimum balance fee when the price on its own line is
  charged by the period ("$5.00 per month", "/Month"): "Low balance $ 5.00 per month", "Savings
  Balance Less than $300.00 ... $6.00 per month", "Money Market minimum balance violation* $9.00 per
  month", "Savvy Spending - Minimum Balance $4.95/Month if the minimum ... is not met".
- A fee stated in a sentence is named by its own words when the price is charged by the statement
  cycle or month: "... A low balance fee of $6.95 will be imposed every statement cycle if ..." is
  "Low balance fee"; "... we will impose a maintenance fee of $7.50 once during the statement cycle"
  is "Maintenance fee".
- In the account family, a capitalized tail after prose names the fee ("... is not met Enriched
  Spending - Minimum Balance $6.95/Month").
- A price is no threshold when "minimum" closes the figure before it ("Monthly Service Charge Below
  $500.00 minimum $5.00 per Month"), when it follows "low balance", or when it follows "Minimum
  Balance" and is charged by the month. The shared source check (`isThreshold`) reads the same three.
- The guard's exclusions for savings, money market, club and business accounts are unchanged
  (James to decide, #1100).
- Answer keys: Texas 545 to 551 right, 14 wrong unchanged; held out 53 to 54, 4 wrong unchanged;
  seven states 791 to 797 right (CA 140 to 141, FL 116 to 117, GA 161 to 164, NY 42 to 43), 41
  wrong unchanged. Monthly maintenance with minimum balance: 47 to 57 of 105 key fees found; 43 to 50
  of 87 when the key leaves out the savings, money market, club and business lines the guard excludes.

v69 (#1102, Oct 15): a price line with no name of its own takes its name from the heading above it.
- A heading is a short line (up to four words, capitalized, no price or digit) that names a fee
  ("Monthly service fee:") or the wire family ("Wire Transfers"). A singular "Fee" or "Charge"
  heading counts only with a colon. It reaches four lines down, and the next priced line's glued
  heading ("... $5.00 Stop Payments") replaces it.
- The line under it is read only when nothing else read or held it, it has one price, ten words or
  fewer, no rate, no sentence, no second labelled column, a label of four words or fewer without its
  own colon, and passes the Darwin checks. Under a single-fee heading the label must be lowercase.
- A heading is crossed, and names nothing more, once a row under it reads another kind of fee or
  holds a self-named "... Fee" row it cannot classify.
- Answer keys: Texas 537 to 545 right, 14 wrong unchanged; held out 53 / 4 unchanged; seven states
  788 to 791 right (CA 137 to 140, MN 110 to 111), 41 wrong unchanged.

v68 (#1102, Oct 15; held as v66 until #1334 took v67): priced lines with no "fee" or "charge" that Knox dropped without a record.
On the 62-bank answer key (run 9), 333 of the 987 key fees missing from live data were lines in our
stored text of the key document with no Knox row at that price; 240 of them had no fee word.
- Name rules for fee-schedule labels seen at several banks, placed after every other rule so they
  only claim lines nothing else names:
  - account research: "Research (per hour)", "Record Research", "Account Reconcilement", "Balancing".
    A bare "RESEARCH" heading cell is not one.
  - notary acts ("notarization", "notarial"); a night drop.
  - safe deposit boxes: "Duplicate Key", "Key Deposit / Replacement", "Box Inventory", a size after
    the word that rents it ("Annual Rent Size 3×5"), sizes with prime marks ("03″x05″x22″"), and a
    box size alone in its cell ("RESEARCH | 5 x 10 | $100").
  - document reproduction: additional or duplicate statements, "Copy of ...". A copy of a title is
    left out.
  - deposit or account verification; a loan's due date change; sweep transfers and "OD protection
    transaction" (overdraft protection transfer); "continuous negative balance"; "insufficient item".
  - wider existing rules: "Rushed" and "plastic" cards, "CHECKCARD" and Visa card replacement,
    "check images", "Bill-pay", "subpoenas", "legal proceedings", "check reorder".
- Left out because the keys file them another way: account printouts (the seven-state keys leave
  them unfiled), other skip-payment wordings (late fees in the keys; v5's "skip-a-pay" stays a lending
  fee), and loan payments by phone or card (unfiled in the seven-state keys).
- A "FREE" (or "None") cell in a row of account columns is one column's price. "Stop Payment | FREE
  | $25 | $25" reads $25 and holds $0 (`zero`). The free cell no longer becomes the fee's name.
- A `label | price` row (or `label | Free`) that no rule names is held as `unclassified` in a fee
  schedule (one that names itself so, or where the rules read 5 or more fees) instead of dropped.
  It is not held when its label is a balance, an opening deposit or minimum, a rate or yield, a
  limit, loan size, example or total, or the figure is over $2,500 (`nonFeeReason`). These rows fill
  the 10 unclassified places per document only after the lines that say "fee".
- Every priced line no rule names that is neither read nor held is counted by reason
  (`DroppedLineReason`): per document in the extract attempt's `dropped_lines`, and per step in the
  extract step's `dropped_priced_lines`.
- Gates: Texas 515 right / 14 wrong (main at v67, with #1365) to 537 / 14 (held out 53 / 4, unchanged); seven states 744 / 41
  to 787 / 41. No right read was lost and no wrong read was added in either gate.
- Box sizes priced per year ("2×5 | $ 25/Year") are named by the size, never by the unit left
  after the price ("/Year"); a size with no word ("2×5") stays unread unless a heading names it.
- A transfer's step ("made in increments of $50", "in multiples of $100") is never the fee
  (`isConditionAmount`); main read "overdraft protection transfers ... increments of $100" as a
  $100 overdraft.
- 62-bank key, stored texts of the key documents, free team reads plus $0 rows with a category
  (Oct 15): 1,371 of 2,321 key fees found before, 1,451 after (59.1% to 62.5%); precision 1,229 of
  1,414 distinct reads to 1,301 of 1,487 (86.9% to 87.5%). 73 of the 80 newly found fees are not live today.
- Production sample (Oct 15): 300 random texts of the 9,140 texts a bump re-read on Oct 15: 34 new reads
  (19 texts), 148 new holds (136 unclassified, 9 untraced, 3 at $0), none of main's reads lost.

Rules 65, #1196 (Oct 14, no version change, so no document is re-read for it):
- A price whose decimal point the PDF text dropped ("Dormant accounts | $15 00 per month
  Nonsufficient funds | $35 00", Addition Financial) gets its point back before the line is read
  (`withDroppedDecimalPoints`): "00" cents always, other cents only when the text drops the point
  on "00" prices too and the cents end their cell. The cents no longer open the next fee's name
  ("00 per month Nonsufficient funds").
- #1305, same function: cents followed by a footnote star end their price ("$1 50* after 8/mo"
  is $1.50, the star never a digit), and a point kept with a space after it is the same dropped
  point ("$29. 95/ea ch" is $29.95). Each shape is counted on its own, and cents after ". " must
  end their cell, so "$500. 10-year draw period" and "below $100. 19 and over" stay two numbers.
- On a line with two fees, the unit right after the first price ("per month", "/hr", "each") is
  that price's: the second fee's name and frequency are read from after it, and the second fee is
  not dropped as a repeat of the first price.

v67 (rules 67, Oct 15, #1334; v66 was held for the #1102 dropped-lines fix, which shipped as v68): no rule changes. The bump does not re-read every text: as with
v68, a text Knox read before is read again at the new version only when it fires one of the
triggers in "When Knox reads a text again" above, so the dropped-decimal reads above (#1196,
#1305) reach the pages Knox read before them that a trigger picks:
"Loan Skip A Pay Fee .... $29. 95/ea ch" (Xplore, doc 12872) is read at $29.95 and "ATM
Transactions (per item) | $1 50* after 8/mo" (Members 1st, docs 13851 and 32358) at $1.50, where
the stored reads said $29 and $1. The source check reads those prices the same way
(`withDroppedDecimalPoints` now lives in `src/lib/custom-report/source-check.ts`). Free: rules only.

## Held lines and the re-checks after each extract

A new rules version also reaches lines older versions held. Knox does not extract a text twice
under one rules version, and the raw-row dedupe index (then document, name, amount; audience was
added in v65) stopped a categorized fee from replacing the held row, so a held line stayed held
after the rules learned it. Now each extract step re-reads up to 300 held unclassified lines
from the document's current text with today's rules (`held-recheck.ts`): a line priced at the same amount takes the category and goes to Darwin
(`knox_promoted_from_held`); the rest get `knox_recheck:extract.rules:v<N>` and wait for the next
version. A categorized insert that meets a held row takes it over the same way.
Each re-read is logged in `pipeline_feedback` under `knox.held:raw:<id>` (the versions that read
it and the outcome). A line still uncategorized after three versions is set aside
(`knox_set_aside`), never deleted, and later versions keep re-reading it.

After the extract itself, each extract step runs these passes in order (`run-store.ts`):

- `recheckPromotedRows`: lines promoted from held that Darwin has not verified go back on hold when
  today's rules no longer file them under the same category (see v30).
- `recheckHeldRows`: up to 300 held lines re-read with today's rules (above).
- `recheckUntracedRows`: up to 100 rows held as `knox_review:untraced` (the self-check could not
  trace them), $10B+ banks first, whose `text_hash` is a completed text of their document. Each text
  is read again with today's free team. A row goes to Darwin (`needs_darwin_verification`,
  `knox_promoted_from_untraced`) only when today's team reads a traced fee with the row's own name,
  amount and category; the rest get `knox_untraced_recheck:extract.rules:v<N>` and wait for the
  next version. Before this pass the dedupe index kept the held row in place of a later traced
  read (Arvest's "Overdraft (OD) - Paid Item" $17, raw 449097, 9 Oct). Nothing is deleted.
- `recheckSupersededRows`: up to 100 rows a re-read retired (`superseded_by_reread`) that Knox's paid
  reader produced (`knox_paid_extraction`), on a page's current copy and not verified, across all
  lanes. Each is read again from the document's newest completed text with today's free team. A row
  goes back to Darwin (`knox_promoted_from_superseded`, its audit text taking the current text's
  hash) only when today's team reads a traced fee with the row's own name, amount and category and
  the bank has no live fee of that category at that price (a live twin, `published_fee_catalog`).
  The rest get `knox_superseded_recheck:extract.rules:v<N>`. Paid rows only, so a row comes back
  when two independent readers agree. `SUPERSEDED_RECHECK_LIVE` is on; set off, the pass is a dry
  read: rows are marked `knox_superseded_would_promote:v<N>` and nothing goes to Darwin. Before
  this pass, the dedupe index kept the retired row and dropped the new text's identical read
  (Northern Trust's $25 overdraft, raw 457013, 9 Oct).
  A second pass in the same step (`source: "free"`, #1093 step 2, approved by James 2026-10-12)
  applies the same test to free-pass rows, 200 a pass: the rows a re-read retired before #1147
  let a new read take its row back (1,626 at 361 banks on 12 Oct, 51 of them with no live fee).
  Only one reader agrees here, so Darwin's free checks, the shared source check among them,
  decide what goes live; the 9 Oct dry read of 17 free rows was 11 of 17 right against source.
  The step's detail reports it as `superseded_free_recheck`.
- `refileSupersededRows` (#1093, `SUPERSEDED_REFILE_LIVE`, switched on by James Oct 15): a free-pass
  row a re-read retired that today's free team reads with the same name and amount under another
  category. The superseded re-check needs the old category, so it leaves these retired, and the
  dedupe index kept the re-read from writing its own row (Oregonians CU's "Card Replacement" $10,
  retired as atm_non_network, read today as card_replacement). On, the row goes to Darwin under
  today's category (old `canonical_hint:` flags dropped, `knox_refiled_from:<old>` kept for
  reversal), unless a live twin of today's category stands or Darwin already judged the row for
  something other than its category (Darwin does not judge a row twice at one version). The pass
  also repairs unverified rows a re-read took over whose first `canonical_hint:` flag is stale
  (`knox_stale_hint_repaired`). Off, every extract step reads a read-only sample of 25 (a new
  sample each hour) and a dry-run extract reads every candidate; neither writes. The step's
  detail reports it as `superseded_refile`.
- A re-read that takes over a row (`knox_reread_took_over`, `knox_promoted_from_held`) drops the
  row's old `canonical_hint:` flags. Darwin reads the first such flag, so before this a fee today's
  rules filed under a new category was judged under the old one: 12 of the 54 take-overs by 14 Oct
  ("Wire Transfer - International" $45 judged as an overdraft fee).
- `recheckHeldRates`: held percentage lines (below).
- `fileHeldByName` (#1102, up to 300 per extract step, scoped to the run's lane): one decision per
  held name, across banks. A line held as unclassified whose exact name (`lessonName`) has a
  person's label goes to Darwin under the labelled category ("No category fits" moves nothing).
  With no label, a name that says fee or charge is settled when at least 90% of its live rows
  (`published_fee_records`, flat, not rolled back) sit in one category (`SETTLED_NAME_MIN_SHARE`)
  at 5 or more banks (`SETTLED_NAME_MIN_BANKS`; 10 for a name of two words or fewer,
  `SETTLED_TWO_WORD_MIN_BANKS`, so "Statement Fee" at 3 banks is not), and its held lines go to
  Darwin under that category ("Credit Card Rush Fee", rush card; "Early Closure Fee", early
  closure). Set-aside lines are read too, since the decision is new and the rules are not. A line
  moves only when:
  - its name key still names something once digits go (a box size's key is only "x");
  - for a store decision, the name says fee or charge ("Minimum Balance" is a requirement), is
    not a bare "Closing Fee" or a wire fee with no direction, and the price is not $0 (the zero
    path's to judge);
  - today's name classifier does not read the name as another category (a subordination live as
    other lending files as legal process);
  - the line is not a rate or a bundle price ("4 for $2"), states no requirement ("to avoid",
    "required", "must maintain", "minimum balance to open"), and is not one column of a table of
    accounts or networks ("| None | $7.00 | $10.00 | $10.00");
  - its price is the line's first price after the name, with no other fee's name between them
    (`priceUnderName`: "$10.00/month ... | Paper Statement Fee | $2.50" and "Overdraft Transfer Fee
    (... | Inquiry Fee12. . . . $1.00" stay held);
  - for a store decision, the line's wording does not contradict the category (a loan, HELOC,
    mortgage, line of credit, title, lien or collateral word outside a lending category; copy,
    photocopy or research filed as a paper statement: `lineContradictsCategory`), the clause that
    holds the price does not read as another fee ("A $25 fee will be assessed for early
    withdrawals" under a maintenance name: `priceClauseNamesOtherFee`), and the price sits inside
    the category's live p5 to p95, weighted by row ("Early closure fee of $500" stays held);
  - Darwin's category guard and price range accept it. A person's label skips the store-only
    checks.
  A moved line keeps its name and amount and carries `knox_name_filed:<label|store>` and
  `canonical_hint:<key>`; Darwin still decides, and Hamilton's rules re-check keeps the fee live
  while its name and price trace in its own text. A line a decision covers that cannot move gets
  the week's mark (`knox_name_file_checked:k<key version>:<ISO week>`); when a lane's pass reads every candidate,
  its other held lines get it too, so the rest of the week's steps read only new held lines and the
  live-fee join has nothing to probe. Settled names come from a hash join of live fees on the held
  lines' own names, as printed and without footnote marks ("1Monthly fee" reaches the live "Monthly
  fee"; `NAME_FILE_KEY_VERSION` v2, which the week mark carries, so lines marked under v1 are read again), and labels from the feedback table's unique dedupe key. Step detail:
  `held_name_file`. On 15 Oct 2026 (read-only, after the second review of #1385): 161 held lines
  matched a settled name, 71 would move at 40 banks in 26 states (38 of them set aside), and none
  had a label yet.
- `previewHeldNameRules` (#1102, off until James switches it on): the held-name rules
  (`HELD_NAME_PATTERNS` in `rules.ts`) file unclassified names that say their own category at
  many banks: "Stop Pay Fee", "Reconveyance Fee", a bare "Early Closure Fee" row, a club
  withdrawal fee, a closure inside a window of a year or less, a returned or undeliverable
  statement (account research, as `fee-fold.ts` files returned mail), a mailed member statement,
  an IRA closeout or withdrawal, and a box size written with prime marks ("3″x5″"). They come
  after every other rule. A loan's, HELOC's, mortgage's or certificate's early closure, a window
  over a year, and a bare "Wire Transfer Fee" (about 1 in 5 say incoming or international after
  the price) stay held. While `KNOX_HELD_NAME_RULES_LIVE` is false, each extract step reads every
  held line whose excerpt could match (`HELD_NAME_PREFILTER_SQL`) and reports in
  `held_name_preview` how many only these rules price at the row's own amount, and how many of
  those pass Darwin's category guard and trace on their own line. It writes nothing. On
  14 Oct 2026, 638 lines at 299 banks passed both checks (436 set aside), and a hand check of
  20 found 20 right. Switching on takes a rules version bump in the same change: new reads
  file these names, `recheckHeldRows` sends the held lines to Darwin with
  `knox_held_name_rule`, and Hamilton's rules re-check reads them the same way. With the
  switch on, the answer-key gates read Texas 520 right / 15 wrong (511 / 14 off) and seven
  states 761 / 41 (744 / 41). To reverse it, switch off with another version bump:
  `recheckPromotedRows` puts unverified promotions back on hold, and the rules re-check
  takes down the live ones it no longer reproduces.
- `consumeRereadRequests` (#1511, `KNOX_REREAD_FEEDBACK_LIVE`, off): Darwin's re-read requests for
  live fees named by a sentence fragment (below).
- Batch review (`batch-review.ts`, below).

Percentage fees (`percent.ts`). A held "1% of the transaction" line goes to Darwin as a rate fee
(`amount_kind = 'percent'`, `rate_percent`, optional `rate_min_amount` / `rate_max_amount` /
`rate_basis`, `amount` NULL, flag `knox_rate_fee`) only when its category publishes rates
(`percentFeeAllowed` in `src/lib/percent-fees.ts`, the list Darwin applies) and the rate traces
with the shared `checkRateAgainstSource`. A balance transfer rate is filed under cash_advance.
It stays held when the line is an interest or dividend rate, says "up to", states two different
rates, falls outside the category's range, or has no clean name. Names come from the category's
own words ("A 1% Currency Conversion Fee will be assessed on" is "Currency Conversion Fee"). New
texts get this in the extract pass; rows held before it are re-read by `recheckHeldRates`
(`knox_rate_recheck:v2`, 100 per extract step). v2 (#1102): a rate stated as a share of what it
charges ("1% of transaction amount") traces without the word "fee", and check cashing and
international ATM fees publish as rates.

## Learning reader (`lessons.ts`)
Each extract step reads lessons from the shared learning store (`pipeline_feedback`): a fee name
(lowercase, letters only) that the category guards rejected under one category at 2 or more banks
and never verified there, while the same name was verified under one other category at 2 or more
banks and never rejected there ("Overdraft Transfers": overdraft -> od_protection_transfer). When
today's rules file that exact name under the rejected category, Knox files it under the verified
one and flags the row `knox_lesson:<wrong>-><right>`; Darwin still checks it. Hamilton's rules
re-check treats a read under the rejected category as reproducing such a row, so the lesson is
not undone. Lessons grow as Darwin and Hamilton record corrections; no rules version bump is
needed, and they apply to texts read from then on. Dry runs don't read the store.

**Per-bank memory.** A bank's own verdicts are enough for that bank: a name rejected under one
category and verified under another at the same bank, with no verdict the other way there, is
re-filed at that bank only (369 lessons at 307 banks, 6 Oct 2026). The bank's lesson comes
first, then a person's label, then the global lessons.

**Weekly labels (`label-queue.ts`, /admin/knox/labels).** Names the store can't settle on its
own (rejected at 2 or more banks and never verified, or judged both ways), and names Knox holds
as unclassified at 2 or more banks (#1102; only names that read as a fee's name, "Membership
Fee" or "Lost Passbook Fee", never a fragment such as "we will charge"), are listed for a
person, 25 at a time, most banks first. A label also sends the held lines with that name to
Darwin (`fileHeldByName`). A label is a `name_label` row in the store; from the
next extract Knox files that exact name under the labelled category from any other. "No category
fits" only takes the name off the queue. A label that agrees with the rules stops a global
lesson from moving the fee.

Lessons v3 learn from restores. A fee Hamilton restored after a takedown (`restored_after_takedown`,
from the second look or the restore bar) counts as verified under the category it came back with,
and a takedown under that same category no longer counts against the name. A takedown under another
category stands, since a fee taken down as a domestic wire and restored as an international wire
confirms the lesson. Knox reads only the category kinds: `unreproduced`, `not_on_schedule`,
`wrong_amount` and `threshold` say nothing about a category and are often restored. On prod (Oct 7)
this adds 30 lessons (28 per-bank, mostly international wires and overdraft transfers) and drops none.

Takedown lessons (`takedown-lessons.ts`). Knox reads Hamilton's second-look confirmations
(`takedown_confirmed` from the source check, limit guard and business-schedule check) for fees
still down with no live twin. When it reads the same bank, name and price again, usually from a
new copy of the page, it writes the row held (`knox_review:taken_down`,
`knox_lesson:taken_down:<check>`) and does not send it to Darwin. The row is kept, never dropped.
First-look takedowns (`not_on_schedule`, `wrong_amount`, `threshold`, `unreproduced`) do not teach,
because many are restored. The extract event carries `takedown_lessons_loaded` and `takedown_holds`.
Before this, in the 48 hours to Oct 7 05:50 UTC, Knox re-read 208 taken-down fees, sent 49 back to
Darwin, and 6 were published again.

Live name tidy (`name-retidy.ts`, Oct 7): names Knox stored before it tidied reads ("Stop Payment |
Item", "/mo. | Dormant Fee", "An overdraft fee of") are re-tidied on live rows, a batch of banks per
publish step. A rename must keep the fee tracing in its own schedule and passing the category guard;
the old name goes to `pipeline_feedback` (`name_retidied`, weight 0, so it never counts as a lesson).

`isCutoffName` (publish's `cutoff_name` hold) has a narrow live twin beside it, `liveFragmentName`
(#1443), built from the same regex pieces: a dangling joining word (lower-case "a/an/the" only;
not "above" or "each"), a dangling "up to" or "per", "will" or "you", or a leading "+" with no fee
noun after it. Darwin's live name re-check applies it to live fees (`darwin/live-fragment-check.ts`,
see Darwin's AGENTS.md). A change to either shape list is checked against both. Since #1443 a
pronoun only inside a parenthetical is no live fragment (`liveFragmentShape` keeps the raw shape),
and `gluedSentenceHead` gives the fee name a fragment opens with ("Overdraft Fee You will be
charged ..." is "Overdraft Fee"), which Darwin renames the live fee to through `writeLiveRenames`,
the same write path the tidy uses (feedback row first, update guarded on the old name).

## Darwin's re-read requests (`reread-feedback.ts`, #1511)

Darwin's live fragment check (`darwin/live-fragment-check.ts`) writes one `pipeline_feedback` row of
kind `knox_reread_requested` per live fee whose name is a `sentence_end` fragment it cannot rename
("Paper statement fee for the" $2): evidence `kept_live: true` when the fee stays live (`reread`),
none when it came down because a gate refused its amount (`fragment_reread`). Each extract step,
after the held-line passes, reads these requests (`consumeRereadRequests`, `knox.reread_feedback`):

- The line is read again from the newest completed text of the fee's own document with today's
  free team (`runFreeSpecialists`). Rules only, no provider call: the pass is part of the
  deterministic extract step and never waits on provider budget. It finds the line by the fee's
  price and Darwin's fragment (`evidence.fee_name`): an excerpt holding the fragment as whole
  words, or the same name. Knox's raw name is not a key (a short raw name such as "Service charge"
  is in every line at that price, so another fee could lend its name), and a fragment under three
  words is settled `ambiguous`.
- Outcomes: `renamed` (kept live: the live fee takes today's proper name through
  `writeLiveRenames`, the old name kept in `pipeline_feedback`), `sent_to_darwin` (taken down:
  today's read goes in as a raw row with `needs_darwin_verification` and `knox_reread_feedback`,
  so the fee comes back only through Darwin's checks), `already_read` (Knox already holds that
  read), `name_changed` (the guarded rename touched nothing: the live name changed since the read;
  `writeLiveRenames` returns the fees it renamed), and the unresolved ones: `same_name`,
  `not_found`, `no_text`, `other_category`, `ambiguous`, `refused` (category guard or
  `checkFeeAgainstSource`), `live_twin` (another live fee of the bank has the proper name at that
  price), `held_taken_down` (the read repeats a takedown Hamilton confirmed, `takedownLessonFor`:
  written held as `knox_review:taken_down`, as the extract does), plus `stale` (the request no
  longer applies). A failed write (`refused` by `write_failed` or `live_twin_check_failed`) is
  settled unresolved too, so it never holds the head of the queue; a rules bump reads it again.
- What a re-read yields: the free team is deterministic, so a line Knox already read from the same
  text at the current rules version comes back under the same name ("Bank sending the wire may
  charge a fee of" $15 is read as itself at v70). Such a request is settled `same_name`
  ("unresolved: same name under today's rules"). A better name comes only from a line read at an
  older rules version, a newer text of the document, or a later rules version.
- Each request is settled once per pass version and Knox rules version: one `pipeline_feedback`
  row of kind `knox_reread_resolved` (reported by Knox, weight 0, so never a lesson), dedupe key
  `knox.reread_feedback:req:<request id>:v<pass>:rules<N>`, evidence with the outcome. The request
  row is not marked: Darwin upserts it again on each pass of the live table, which would wipe a
  mark. A rules bump makes every request pending again once; nothing loops within a version.
- `KNOX_REREAD_FEEDBACK_LIVE` false (default): only a one-bank extract run reads the requests: it
  counts that bank's pending ones (by kind and documents; `pipeline_feedback_institution_idx`) and
  reads up to 3 read-only (`KNOX_REREAD_FEEDBACK_SAMPLE`), reporting what it would do in one
  `knox.reread_feedback` event (only while requests are pending) and in the step detail
  `reread_feedback`. A state or all-bank lane skips it (`skipSample`, detail `skipped: true`):
  `pipeline_feedback` has no index on `kind`, so the count was a full scan every step, and the same
  sample was read again each time. Nothing else is written. On: 25 a step
  (`KNOX_REREAD_FEEDBACK_BATCH`), claimed first with `FOR UPDATE ... SKIP LOCKED` so two lanes
  never take the same request; the pending count is read only when the claim found work. A dry
  run writes nothing.
- The switch-on PR should come with a partial index,
  `pipeline_feedback (id) WHERE kind = 'knox_reread_requested'`, so every lane's claim and count
  read only the requests (a migration, so it needs James's approval).
- `rereadFeedbackCountSql()` is the read-only count of pending requests by kind, documents and
  banks, and of settled requests by outcome.

## Batch review (`batch-review.ts`)

After every 500 Knox reads (raw rows, oldest first), once they are 24 hours old (Darwin,
publish and Hamilton's 12-hour second look have had them), the extract step scores the
batch and writes it to `pipeline_feedback` (`check_name = 'knox.batch_review'`):

- error rate = (Darwin rejected + taken down for a read reason) / judged. Reads Darwin has
  not judged, reads Knox held for review, and reads a newer Knox version replaced
  (`rules_recheck_unreproduced` only) are counted but not judged.
- each miss is a `batch_miss` row (dedupe `knox.batch_review:raw:<id>`), and each batch is one
  `batch_error_rate` row with the rate, the answer-key check (banks with a confirmed key) and
  the five most common miss patterns (miss, reason, category, three examples).
- Knox's own learning still comes from `wrong_category` (`lessons.ts`) and
  `takedown_confirmed` (`takedown-lessons.ts`); the patterns are where the next rule fix
  starts. At most two batches per step; the first review starts 72 hours back.

## Calibrated confidence (`calibration.ts`, shadow)
Knox's confidence is a fixed formula (0.82 to 0.94), so every read clears Hamilton's 0.8 floor.
Each extract step reads how many of Knox's fees published in the last 14 days are still live,
by the strategy that read them and their category, and writes the formula's value blended with
that survival (weighted as 20 fees) into the audit text as `calibrated_confidence=`. The step
reports `calibration_groups` and `calibrated_below_publish_floor`. `extraction_confidence` is
unchanged until someone reviews the calibrated values; switching it over is a separate change.

## Layout spotting (`layout-signature.ts`)
Each extract attempt records the text's layout signature (`table/short`, `leaders/short`,
`sentences/long`, `split/short`, `plain/long`, ...) and how many lines carry a price. The step's
`layouts` detail counts texts per signature and how many read thin (fewer than 5 fees from 5 or
more priced lines), so a layout the rules miss shows up as one group instead of scattered bad
documents.

## Extraction Passes

Knox reads one whole document at a time. The free team runs first; the paid pass runs
only on what the free team could not read.

- Pass 1, free (`extract.rules`, `rules.ts`): line rules. A threshold, cap, limit, rate base
  or refundable deposit ("balances below $2,500", "up to $29", "maximum of $175", "($1,000 Limit)")
  is never read as the fee. New
  patterns map only to existing canonical keys and each has a fixture in `rules.test.ts`.
- Pass 1 reads a price's name from the words nearest before it: in a flattened table row
  the nearest cell ("STOP PAYMENT ORDER | NOTARY FEE | $6.00" is a notary fee), widened
  only across bare direction or unit cells. Words after a price never classify it unless
  the line opens with the price and says it is a fee, or the line states an account's
  monthly service charge in prose ("otherwise $8 service charge per statement cycle",
  "avoid the $10 monthly fee"; `maintenanceFromProse`, guarded like Darwin). A free in-network ATM or an
  allowance ("two per year: Free", "2 free cashiers checks monthly") or a condition
  ("Monthly Service Charge if any of the following qualifications are met", "to waive") is not
  a $0 price (v13). All three specialists follow the
  same rules, and table and family rows whose name opens mid-sentence (agreement prose
  in columns) are skipped.
- Pass 2, free and heavier (`specialists.ts` runs the team and merges its finds):
  - `extract.table` (`table-rows.ts`): pairs table cells, a name line with the price on
    the next line, and dot-leader rows whose price slid onto the next line. A heading is
    borrowed only by a bare direction or unit ("Wire Transfers" + "Incoming Domestic").
    `tableRowsFromText` is the only adapter over Rosetta's output (today the " | " cell
    lines in `normalized_text`); re-point it when Rosetta stores structured rows.
  - `extract.account_table` (`account-table.ts`, #1100 gap 3): an account comparison table's
    monthly fee row, one fee per product column ("Monthly Service Fees | $0 | $5 | $10" under
    "Account | Great Checking | Better Checking | Best Checking"). Each read is named by its
    column's product (`withAccountName`: "Better Checking Monthly Service Fees"), so it traces
    to one cell. The rule lives in `custom-report/account-table.ts`, and the shared check traces
    the same reads with it (`accountTableRow`, only for `monthly_maintenance` or no key, and only
    after the normal check fails). It reads only checking columns (no savings, share, money
    market, club, IRA, HSA or certificate column), only the fee row (never opening deposit or
    balance rows), and only under a header row whose rows in between have the table's width. A
    free cell is held as a $0 fee. A short header that opens on a label, a row of buttons or
    repeated cells, dated fee-change columns and a comparison with big banks' accounts are not
    read; a balance figure in a cell is skipped (v71 history).
  - `extract.family.<family>` (`families.ts`): one expert each for overdraft/NSF, wires,
    ATM/card, account maintenance/statements, checks, and the remaining services. They
    read price windows across a document, including PDFs flattened to one line: tiers
    ("2nd and subsequent items"), daily caps (`od_daily_cap` / `nsf_daily_cap`), waivers,
    ranges and FREE/NONE.
  - Every pass 2 row must pass Darwin's category guard and amount envelope before it is
    kept. A later specialist adds a fee only when no earlier one has the same fee.
    Pass 2 rows carry `knox_specialist:<strategy>`.
  - Each specialist is logged in `pipeline_attempts` as its own strategy, with
    `foldIntoPlaybook: false`. The team total is logged as `extract.rules`, which drives the
    re-extract gate and the paid pass's selection.
- Pass 3, paid (`extract-paid` step, a provider step; `paid-extract.ts`, `extract.paid`). It runs
  only on a text the free team has already read at the current rules version. It selects up to
  `PAID_PASS_ITEMS_PER_RUN` texts whose latest `extract.rules` attempt at the current version, for
  the same institution and text hash, found fewer than 5 fees (`KNOX_REEXTRACT_MAX_FEES`) and that:
  - have at least 15 priced lines (`PAID_MIN_PRICED_LINES`, counted in SQL and again by
    `pricedLineCount`);
  - are not an older copy of a page whose current copy has a text;
  - have no `extract.paid` attempt for the same text hash, except attempts that failed for a
    temporary reason (`timeout`, `network_error`, `http_429`, `http_5xx`, `budget_blocked`), which
    a later run tries again.

  It makes one `paidModelCall` per document and keeps a returned row only when (`groundPaidRow`):
  - it has a name, a canonical key that exists and an amount from $0 to $2,500;
  - it does not name a limit (`limit_not_fee`);
  - its source line (with the amount on it), or its name and amount, appear in the text;
  - the shared check (`checkFeeAgainstSource`) reads the amount as that fee.

  Kept rows go in like rule rows, with `knox_paid_extraction` added; a $0 row is stored as a free
  fee for Darwin. When a row is kept, the rows from the document's older text are retired first. A
  budget, stop or circuit error ends the pass before the call and writes no attempt, so the text
  stays eligible; any other call error records its outcome. Each attempt records its cost.

## Boundaries

- Do not write `verified_fee_observations` or `published_fee_records`.
- Do not mark data as verified or public-ready.
- Do not use provisional rows for verified benchmark scoring.

## Daily health check (contract)

`agent-health.ts` runs with the daily scoreboard step and stores these numbers in
`pipeline_scoreboard_snapshots.detail.agent_health`, next to yesterday's. A broken rule, or any
number that moved more than 25% since yesterday, is named in the scoreboard step's summary.
Change this table and `agent-health.ts` in the same PR.

| Rule | Number | Holds when |
|---|---|---|
| Steps do not fail | `stepsFailed` (24 h) | 0 |
| Each text is extracted once per rules version | `repeatExtractions` (same institution and text hash, current `KNOX_RULES_STRATEGY`, 24 h) | 0 |

Also recorded, without a rule: `stepsCompleted`, `spendUsd`, `rawExtracted`, `textsExtracted`, `evidenceMismatch`.

## Fees named by page context (`context-names.ts`, v33)

- Under an overdraft or NSF section heading, a per-item price with no fee name of its own
  ("$38 fee for each item or transaction paid") is named from the heading: "Overdraft fee for
  each item or transaction paid". Only a Title Case heading or one ending in ":" counts; the
  nearest heading that names a fee owns the price.
- "this $33 fee" is named by the term defined on a line just above ("Bounce Protection Paid
  Item Fee: ..."), with the sentence's own words after it so the shared source check reads the
  price on its line. How often the line lets it be charged is a cap, not its frequency.
- A line saying its fee is being eliminated or will no longer be charged holds no fee.
- The Reg E notice sentence "We will charge you a fee of up to $35.00 each time we pay an
  overdraft" is read as the overdraft fee. The shared source check still reads "up to $35.00"
  as a threshold, so it is held as untraced until that check changes (accuracy thread).
- v50: in a two-column schedule flattened row by row, a "Personal ........ $10 per item paid"
  cell under an "Overdrafts / Non-Sufficient Funds (NSF)" heading cell is the personal overdraft
  fee: "Overdraft - personal, per item paid" (a returned item is "NSF - personal, ..."). Footnote
  numbers after the heading ("(NSF)10, 12") are dropped. A business row, or one priced "paid or
  returned", is not read (Amerant Bank, a $10B bank with no live overdraft fee).

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `KNOX_ACCOUNT_TABLE_STRATEGY` | `extract.account_table` | v1 | `knox/account-table.ts` |
| `KNOX_BATCH_REVIEW_VERSION` | — | v1 | `knox/batch-review.ts` |
| `KNOX_CALIBRATION_VERSION` | — | v2 | `knox/calibration.ts` |
| `HELD_RATE_RECHECK_VERSION` | — | v2 | `knox/held-recheck.ts` |
| `NAME_FILE_KEY_VERSION` | — | v2 | `knox/held-recheck.ts` |
| `KNOX_LAYOUT_SIGNATURE_VERSION` | — | v1 | `knox/layout-signature.ts` |
| `KNOX_LESSONS_VERSION` | — | v3 | `knox/lessons.ts` |
| `LINEUP_CORRECT_STRATEGY` | `knox.lineup_correct` | v2 | `knox/lineup-correct.ts` |
| `NAME_RETIDY_STRATEGY` | `knox.name_retidy` | v19 | `knox/name-retidy.ts` |
| `KNOX_PAID_STRATEGY` | `extract.paid` | v2 | `knox/paid-extract.ts` |
| `KNOX_RULES_STRATEGY` | `extract.rules` | v72 | `knox/specialists.ts` |
| `KNOX_REREAD_FEEDBACK_STRATEGY` | `knox.reread_feedback` | v1 | `knox/reread-feedback.ts` |
| `KNOX_TABLE_STRATEGY` | `extract.table` | v6 | `knox/table-rows.ts` |
| `TAKEDOWN_LESSONS_VERSION` | — | v1 | `knox/takedown-lessons.ts` |
