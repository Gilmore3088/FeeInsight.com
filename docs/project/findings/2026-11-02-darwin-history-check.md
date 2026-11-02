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

**Not measured:** the precision sample and the live count were not run. The Supabase tool refused
further queries after a confirmation prompt went unanswered (see the note at the end). Both are
listed under "What would move it" with the queries to run.

**Cause:** Darwin's rules judge each fee against its own document. Nothing in verify read the
bank's published history, and the checks that do read it run after publication and decide only
alerts and reports.

**Fix (`src/lib/agents/darwin/history-check.ts`, `HISTORY_RULE_VERSION` v1):**
- Verify compares every fee the rules accept with the bank's live published values for the same
  institution, category, audience and product, read from another stored document.
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

**Guard:** `src/lib/agents/darwin/history-check.test.ts` (the rule, verify with the switch off and
on, the standing-decision roll-back, and the live re-check's read-only report).

**Agent lesson:** darwin/gap-9-compare-with-the-banks-own-history

**What would move it (before the switch goes on):**
1. Read the shadow counts: verify's `historyCheck` (step result) and the recheck's `historyLive`
   report, which run with this code and the real support test on the stored texts.
2. Sample about 20 `jump` verdicts against their stored texts with `checkFeeAgainstSource` and by
   eye. For each, ask whether the new amount matches the bank's current schedule and whether the
   prior's still does, to estimate precision.
3. Count the live cohort (read-only):
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
`greatest(a/b, b/a)` against the nearest prior. The sibling-line proxy is `position('$' || amount
in normalized_text)` on the new fee's newest completed text. The change-log spread is over
`fee_change_records` increases and decreases, grouped by `like_for_like`.

**Process note:** one exploratory statement in this dry run was `SELECT setseed(...); CREATE TEMP
TABLE IF NOT EXISTS _dummy(x int);`. That is a session-scoped temporary table with no rows, not a
prod table, and it ends with the session. A follow-up `DROP` to tidy it asked for confirmation, got
no answer and timed out, and the tool then refused further calls for the session. No prod row was
read for writing or changed.
