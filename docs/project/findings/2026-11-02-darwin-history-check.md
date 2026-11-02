# 2026-11-02: Darwin verified a fee without comparing it with the bank's earlier value

**What happened:** The Pipeline wiring audit (Nov 2, Gap 9) found that no pipeline step compared a
new fee with the same bank's earlier value for that fee. Darwin's verify checks a fee's name,
category, amount range, peers and its own stored text. It never asks whether the bank's live price
for the same fee is very different. Prior-value logic existed only after publication: the
competitor alerts and the Monthly Pulse (`judgeFeeChange`, `src/lib/report-assemblers/monthly-pulse.ts`)
and Hamilton's supersede rule. So a fee read at $15 where the bank's live price had been $35, or at
$0 where the bank charges $30, was verified whenever its own text printed the number somewhere the
source check accepted.

**Measured (prod, read-only, 2026-11-02, fees verified in the 14 days to Nov 2, dollar amounts):**
- 28,967 verified fees with an amount; 14,413 had a live published value for the same institution,
  category, audience and product (`product_name`) when they were verified.
- Most of those priors came from the same stored document: a sibling line, which the source check
  already judged. Counting only priors from another document: 9,006 fees had one, and 7,550 of them
  matched a prior exactly.
- How far the other 1,456 sat from their nearest prior: 195 under 1.25x, 164 at 1.25-1.5x, 235 at
  1.5-2x, 300 at 2-3x and 420 at 3x or more. Another 142 were $0 against a charge, or the reverse.
- At 1.5x: 1,094 fees (at 455 institutions, counted with units) sat 1.5x or more from every prior
  from another document. Up to 54 more, at a close amount, had a different stated unit (monthly
  against per item).
- Proxy for sibling lines (a plain substring test, not the source check): for 1,015 of those 1,094,
  the new fee's own stored text prints the prior's dollar amount somewhere, which suggests the new
  copy still holds the prior's line and the new fee is a second line rather than a change. "$30"
  also matches "$300", so this proxy overcounts siblings.
- Real price changes the change log calls like-for-like (`fee_change_records.like_for_like`): only
  10, so they cannot set the threshold by themselves.

- **With the same fee name** (the rule as shipped, `sameFeeName`): 5,418 of the 9,006 had a prior
  under the same name from another document, 5,302 of them at exactly the same amount. Only **80
  fees (at 47 institutions)** sat 1.5x or more from every same-name prior (58 at 2x or more, 24 $0
  against a charge, or the reverse). Re-run 2026-11-02 with the query under "Queries used"; the
  unnamed form of the same query still returns 1,094 (at 439 institutions).

**Live fees the re-check could take down (dry run, prod, read-only, 2026-11-02):** the live
cohort selector (`historyCohortSql()`, which carries the name match in SQL) matches **166 live
fees at 113 institutions**. Before the name rule it matched 1,488 at 695 (0.21 s, the reviewer's
run). The count query is under "What would move it", generated from the code; with the name match
it took 3.0-4.5 s on prod (a hash semi-join over all published rows), against 0.21 s without. That
is the upper bound: every fee in it has an earlier value at publish, under the same name and from
another document, that it sits 1.5x or more from. The share the re-check would actually take down
is the share the text test fails, and it comes from the recheck's `historyLive` shadow
(`wouldHold / read`) before the switch goes on. In the name-rule sample below, 9 of 20 fail it.

**Precision sample, same-name rule (prod, read-only SELECTs, 2026-11-02):** 20 of the 80 same-name
1.5x+ moves, picked by `md5(fee_verified_id || 'gap9-name-sample')`. `historyVerdict` ran on the
lines of both stored texts that print the fee's name or either amount (plus each text's edition
line). Whether the two full texts print the same dollar amounts was computed in SQL on the full
texts.
- **9 held (`jump`).** Right or worth review: 6.
  - Right, stale older edition (3). East West Bank, two box sizes, 225260 ($85 against $170) and
    225238 ($30 against $60): the new copy is a Spanish page dated 4/4/2022, the prior a PDF dated
    1/30/2026 (`older_edition`). Banner FCU "Opportunity Checking" 216271, $5 from a 2020 fee
    schedule PDF against $15 from the current checking page.
  - Worth review, the bank's own pages disagree (3). 705 FCU, 212873 "Overdraft Transfer from Share
    Savings" $10 against $15, and 212882 "Money Order" $2 against $4: an FAQ page against the
    disclosures page. Tyndall 199192 "Inactive Account fee (checking)" $5 against $10: two copies
    with the same "Effective Date: April 10, 2026" (this one ran on excerpts; on the full texts
    `judgeFeeChange` might confirm it).
  - Wrong (3). Frost 222199 "Monthly Service Charge" $15 (Money Market page) against $8 (Personal
    Account page), and Montecito 210026 "Monthly Maintenance Fee" $8 against $0: a generic name on
    two accounts' pages, both prices real. Maui County FCU 208099 "Account Closure" $25: the new fee
    is right, but the live prior, $1.00, is a column misread.
- **11 passed.** 7 right: 2 `change_confirmed` (Conneaut 214712, $10 in 2020 to $15 in 2025; Gala
  223214, $10 to $5 on the same page) and 5 `both_stated` where the two prices are real lines of one
  name (StagePoint "Excessive Withdrawal" $2 share and $25; Hancock Whitney $10 checking and $5
  savings; First National Bank Alaska $20 and $4 against a "No charge" account; Canyon View
  "Cashier's Check" $1, whose prior $15 is the stop-payment line misread).
  4 are `both_stated` passes of a doubtful new value, the case the review asked about: TVFCU 203576
  and 203577 ($0 money order and cashier's check, from a member-tier column of "$4 | $3 | Free |
  Free"), Dynamic FCU 218322 ("Returned Item" $7, which looks like the transfer-fee column of a
  flattened NSF table), and TD 197016 ("Monthly fee" $3, a paper-statement fee). In each, the new
  copy prints the same name at the prior's price too, so the move passes. Five of the 11 passes
  (TVFCU twice, StagePoint, Dynamic, Canyon View) compare two reads of one edition (the same dollar
  amounts in both full texts).
- **Precision of the hold: 6 of 9 right or worth review (3 of 9 plainly right), against 2 of 4
  before the name rule.** The wrong holds that remain are generic names ("Monthly Service Charge")
  across accounts that `productKey` does not separate, and misread priors.
- What the name rule gives up: of the first sample's 4 holds, it keeps Beehive (same name) and
  drops the 2 wrong ones, and also drops one right hold (Forcht "money orders" $0 against "Money
  Order (Customer)" $3). Moves under another name are no longer this check's business.
- Limits: excerpts, not whole texts; n = 20.

**First precision sample, before the name rule (prod, read-only SELECTs, 2026-11-02):** 20 of the
1.5x+ moves from the 14-day set, picked by `md5(fee_verified_id || 'gap9-sample')`. For each one, `historyVerdict` was run on
the lines of both stored texts that print either amount (with the line before) or the fee's own
keyword, and each verdict was judged against the bank's own text. Whether the two full texts print
the same dollar amounts (`same_edition_full`) was computed in SQL on the full texts. None of the 4
holds below depends on it: all 4 fail on name or schedule, before the edition test.
- **16 pass as `both_stated`**, and all 16 are right. Each new fee is another line of the same
  schedule and category as its prior, printed at its own price beside the prior's line: box rent
  against drilling, late fee or lost key; fax against copy; ATM balance inquiry on and off network;
  incoming against outgoing collection items; overdraft transfer against overdraft protection; a $0
  debit-card overdraft beside a $10 paid-item overdraft; "Free Checking" $0 beside a $10
  maintenance fee on another account. No misread sibling passed: in each of the 16, the new amount
  is the one its own line prints. One (214416, a 5"x10" box at $70) could not be confirmed from the
  excerpt, because the new copy's two-column line was cut.
- **4 are held (`jump`, `not_confirmed`)**:
  - Right: 225992, Beehive "Dormant Account" $25 monthly against a live $2 monthly. The line reads
    "$25.00 after 4 Years $2.00/Month thereafter", so the $25 is a one-time charge read as
    monthly.
  - Right to review: 224674, Forcht "money orders" $0, from a Safety Net Checking page ("No charge
    for money orders"), against the bank's $3 Money Order (Customer). The $0 is one account's
    perk, filed as the bank's price.
  - Wrong: 201488, STRFCU "Copy of Statement" $5 against "Xerox copies (per page)" $2 from the
    bank's other fee page. Both are right; they are different fees on different pages.
  - Wrong: 203727, Coteau Valley "Bank Drafts" $5 against "Bank Draft with mailing" $3 from the
    bank's PDF. Different services; the $5 is what the HTML schedule prints.
- **Precision of the hold: 2 of 4.** Both wrong holds compare fees with different names on
  different pages. Both right holds compare the same fee ("Dormant Account" against itself, money
  orders against Money Order). This is why the shipped rule compares only priors under the same
  fee name (the name-rule sample above).
- Limits: the text test ran on excerpts, not whole texts, and n = 20 is small.

**Cause:** Darwin's rules judge each fee against its own document. Nothing in verify read the
bank's published history, and the checks that do read it run after publication and decide only
alerts and reports.

**Fix (`src/lib/agents/darwin/history-check.ts`, `HISTORY_RULE_VERSION` v1):**
- Verify compares every fee the rules accept with the bank's live published values for the same
  institution, category, audience, product and fee name, read from another stored document. The
  name match is `sameFeeName`, now exported from `src/lib/report-assemblers/monthly-pulse.ts`
  (the normalisation `judgeFeeChange` already used: lower-case, punctuation to spaces), with
  `feeNameKeySql` as its SQL twin in the live cohort. A prior under another name is another fee
  of the category, not an earlier value of this one.
- A prior agrees (`consistent`) when it is the same amount, or within `HISTORY_JUMP_RATIO` (1.5x
  either way) at the same or an unstated unit.
- Otherwise the move must be supported by the bank's current copy:
  - `both_stated`: the new fee's own text still prints the prior fee at its prior price (the shared
    source check, `checkFeeAgainstSource`), so the new row is another line of one schedule; or
  - `change_confirmed`: `judgeFeeChange`, the rule the Monthly Pulse and competitor alerts use,
    confirms a change the bank made. That means the same schedule, the old copy prints the old
    price, the new copy prints the new price and no longer the old one, and it is not an older
    edition.
- Anything else is a `jump`. While `DARWIN_HISTORY_CHECK_LIVE` is on, verify holds it as
  `history_jump` (needs_review), the existing review path. The switch is off, so verify only records
  the verdict on its attempt (`detail.history`) and counts it (`historyCheck.wouldHold`).
- Live re-check: the verified recheck's history cohort (`verified-recheck.ts`). It reads live fees
  whose priors at publish (published earlier, still live or closed as `superseded by #<it>`, another
  document) all disagree with them, up to 100 a step, once per rule version. On, a jump fails as
  `history_jump` and goes through the shared 12-hour second look before the fee is archived. Off,
  every fourth run reports a sample read-only (`historyLive`).
- Roll-back: set the switch to false. The standing-decision SQL then re-reads every `history_jump`
  hold, so the holds are released on the next verify.

**Why 1.5x:** ordinary repricing is a few dollars on a $25-$35 fee ($30 to $35 is 1.17x). Under
1.5x the moves are few (359 of 1,456), and most are plausibly real repricing. From 1.5x up there
are more moves, not fewer (955, most of them 2x or more), and the substring proxy above suggests
they are mostly sibling lines and misreads. Those are exactly the cases the support test separates.
A higher threshold (2x: 924 with units) would drop the 1.5-2x band, where a misread neighbour
price ($25 against $15) is still common. The support test decides; the ratio only chooses which
fees must pass it.

**Guard:** `src/lib/agents/darwin/history-check.test.ts` (the rule; verify with the switch off and
on; a failed history read recorded on the row without failing the step; the standing-decision
roll-back; the live re-check's read-only report) and
`src/lib/agents/darwin/history-recheck.test.ts` (switched on: a cohort jump flagged on its first
look and archived on the second).

**Agent lesson:** darwin/gap-9-compare-with-the-banks-own-history

**What would move it (before the switch goes on):**
1. Read the shadow counts: verify's `historyCheck` (step result) and the recheck's `historyLive`
   report, which run with this code and the real support test on the whole stored texts.
2. The hold's precision: 6 of 9 right or worth review under the name rule (3 of 9 plainly right),
   up from 2 of 4. The wrong holds left are generic names across accounts ("Monthly Service
   Charge" on a money market page against a personal account page) and misread priors. Look at
   the shadow's `jump` samples for those two before turning the switch on.
3. The `both_stated` passes of a doubtful value (a member-tier column, a flattened table's
   neighbouring cell) are not this check's to catch; they pass because the copy prints the same
   name at both prices. They belong to the tier and column checks.
4. The live cohort count, read-only (166 at 113 institutions on 2026-11-02 with the name rule,
   3.0-4.5 s; 1,488 at 695 and 0.21 s before it). The name match turns the plan into a hash
   semi-join over all published rows; the recheck selects with `LIMIT 100`, but if its step runs
   slow, an expression index on the normalized name is the fix to try:
   ```sql
   SELECT count(*) FROM published_fee_records p
     JOIN verified_fee_observations v ON v.fee_verified_id = p.lineage_ref
     JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
    WHERE p.rolled_back_at IS NULL AND p.quarantined_at IS NULL
      AND v.review_status IN ('verified','approved')
      AND <historyCohortSql()>;
   ```
   That is the upper bound the live re-check reads; the share it would take down is that count
   times the shadow's `wouldHold / read`.

**Queries used (all SELECT, project rmhwbbjjctzfaqjyhomu):** the 14-day measure joined each
`verified_fee_observations` row (created in the last 14 days, not a percent fee) to the
`published_fee_records` that were live when it was created (`published_at < v.created_at` and not
rolled back before it). It matched on institution, `canonical_fee_key`, `fee_audience` and the
raw `product_name` (lower-cased, trimmed), excluding the row's own lineage. One variant also
required the prior's raw `source_document_id` to differ from the new row's. The ratio was
`greatest(a/b, b/a)` against the nearest prior. The name-rule variant adds
`btrim(regexp_replace(lower(fee_name), '[^a-z0-9]+', ' ', 'g'))` equal on both sides (raw
`fee_name` for the new fee, published `fee_name` for the prior). The name-rule sample's excerpts
were `regexp_split_to_table` lines of each `agent_source_texts.normalized_text` that print the
name or either amount, and its same-edition test compared the sorted `$` amounts of the two full
texts. The sibling-line proxy is `position('$' || amount
in normalized_text)` on the new fee's newest completed text. The change-log spread is over
`fee_change_records` increases and decreases, grouped by `like_for_like`.

**Process note:** one exploratory statement in this dry run was `SELECT setseed(...); CREATE TEMP
TABLE IF NOT EXISTS _dummy(x int);`. That is a session-scoped temporary table with no rows, not a
prod table, and it ends with the session. A follow-up `DROP` to tidy it asked for confirmation, got
no answer and timed out, and the tool then refused further calls for the session. No prod row was
read for writing or changed. The precision sample ran later in plain SELECTs only: no temporary
tables, no DDL.
