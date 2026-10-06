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

v16 (rules 16) adds Knox's self-check: every free find, and every $0 row, is checked against
its text with the shared accuracy check (`checkFeeAgainstSource`, the rule Darwin applies
before publishing). A find that doesn't trace is held for review as `untraced`
(`knox_review:untraced`) instead of going to Darwin, where it would be rejected as
`not_in_source`; a later specialist that reads the same fee under a traceable name keeps it.
Each specialist run records `self_check_failed`. Since v16 the gates count only reads that
pass the self-check, which is what can be published: Texas 443 of 459 (main at v15 scored 443
of 459 on that basis), held out 43 of 49; seven states 658 of 709 (main: 657 of 708). The held
`untraced` rows show where the shared check can't yet read a layout (a price on the line
after a dot leader, FREE/NONE on a flattened line, a note line between name and price).

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
