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
  extracted again each time `extract.rules` moves to a new version; the raw-row dedupe index
  keeps fees found before from being inserted twice.
- The rules live in `rules.ts` (`extract.rules`; bump `KNOX_EXTRACT_STRATEGY.version`
  when they change). Patterns are ordered most specific first; monthly maintenance and
  minimum balance come last. On a line, the first amount is the fee; a later amount is
  another fee only when words naming one sit just before it.
- Knox extracts each text once (keyed on `text_hash=` in `conditions`). When a Rosetta
  re-read changes a document's text, Knox extracts the new text and retires the
  unverified rows it took from the older text (`needs_darwin_verification` removed,
  `superseded_by_reread` added). Rows Darwin already verified are left alone.
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
- Exact fees go to Darwin with `needs_darwin_verification`. Waived fees keep their price
  and a `waivable` flag. A free fee ("Free", "No charge" or $0 next to a recognized fee
  name) is stored at $0 with `knox_review:zero` and `needs_darwin_verification`, so Darwin
  can verify it as a real $0 price. Ranges, percentages and priced lines no rule
  recognizes are stored with `knox_review:<shape>` (plus `amount_max:` / `percent:`) and
  without `needs_darwin_verification`, so Darwin never verifies them as exact amounts.

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

A new rules version also reaches lines older versions held. Knox does not extract a text twice,
and the raw-row dedupe index (document, name, amount) stopped a categorized fee from replacing
the held row, so a held line stayed held after the rules learned it. Now each extract step
re-reads up to 300 held unclassified lines from the document's current text with today's rules
(`held-recheck.ts`): a line priced at the same amount takes the category and goes to Darwin
(`knox_promoted_from_held`); the rest get `knox_recheck:extract.rules:v<N>` and wait for the next
version. A categorized insert that meets a held row takes it over the same way.
Each re-read is logged in `pipeline_feedback` under `knox.held:raw:<id>` (the versions that read
it and the outcome). A line still uncategorized after three versions is set aside
(`knox_set_aside`), never deleted, and later versions keep re-reading it.

v26 (rules 26) folds the held groups James chose to fold (decision card, Oct 7 2026) into the
category the taxonomy already gives them (`FOLDED_PATTERNS`): returned mail, bad address, fax
and excess withdrawals into account research; collection items and foreign checks into check
cashing; loan cancellation, credit reports and UCC filings into loan origination; loan
refinancing and document fees into other lending. The answer keys left these lines "unmapped",
so the gate re-files them the same way. At v26: Texas 486 right of 500 reads; seven states 712
of 759; no new wrong reads. Dry run on 13,383 held lines: 1,622 get a category (1,559 by the
fold). Membership, phone transfer, credit card, uncollected funds and returned statement fees
stay held.

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

Percentage fees (`percent.ts`). A held "1% of the transaction" line goes to Darwin as a rate fee
(`amount_kind = 'percent'`, `rate_percent`, optional `rate_min_amount` / `rate_max_amount` /
`rate_basis`, `amount` NULL, flag `knox_rate_fee`) only when its category publishes rates
(`percentFeeAllowed` in `src/lib/percent-fees.ts`, the list Darwin applies) and the rate traces
with the shared `checkRateAgainstSource`. A balance transfer rate is filed under cash_advance.
It stays held when the line is an interest or dividend rate, says "up to", states two different
rates, falls outside the category's range, or has no clean name. Names come from the category's
own words ("A 1% Currency Conversion Fee will be assessed on" is "Currency Conversion Fee"). New
texts get this in the extract pass; rows held before it are re-read by `recheckHeldRates`
(`knox_rate_recheck:v1`, 100 per extract step).

v21 (rules 21) reads more of those rate lines: the card's currency fee under its other names
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
own (rejected at 2 or more banks and never verified, or judged both ways) are listed for a
person, 25 at a time, most-judged first. A label is a `name_label` row in the store; from the
next extract Knox files that exact name under the labelled category from any other. "No category
fits" only takes the name off the queue. A label that agrees with the rules stops a global
lesson from moving the fee.

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
    router and the re-extract gate.
- Pass 3, paid (`extract-paid` step, `paid-extract.ts`, `extract.paid`). It selects up to
  `PAID_PASS_ITEMS_PER_RUN` texts that have:
  - at least 15 priced lines;
  - fewer than 5 Knox fees after the current free version;
  - no earlier paid attempt for the same `text_hash`.

  It makes one `paidModelCall` per document and keeps a returned row only when:
  - its amount appears in the text, on its source line or next to its name;
  - its canonical key exists.

  Kept rows go in like rule rows, with `knox_paid_extraction` added. A budget, stop or
  circuit error ends the pass cleanly, and each attempt records its cost.

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
| Each text is extracted once per rules version | `repeatExtractions` (same institution and text hash, current `KNOX_EXTRACT_STRATEGY`, 24 h) | 0 |

Also recorded, without a rule: `stepsCompleted`, `spendUsd`, `rawExtracted`, `textsExtracted`, `evidenceMismatch`.

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

v30 (rules 30) reads two more limit wordings as ceilings, not prices: a limit that "will increase
to" a figure ("the Overdraft Privilege limit will increase to $1,500") and a limits row with a
"($/#)" note ("Daily ATM Limits ($/#) $505"). Both reached raw rows from v29's first run on prod.
Answer keys unchanged; live dry run: 1,419 of 1,437 kept, the same fees.
