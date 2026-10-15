# Darwin Agent Guide

Darwin owns verification and classification.

## Authority

- Darwin reads `raw_fee_observations`.
- Darwin writes eligible rows to `verified_fee_observations`.
- Darwin may skip or challenge raw rows when canonical category, amount, duplicate, source lineage, or policy checks fail.
- Darwin may emit Monitor signals for verified rows and verification-review states.
- Darwin owns re-checking live fees against today's rules (James, 2026-10-15). A rule added at Knox,
  Darwin or publish joins Darwin's live re-check in the same PR, with a dry-run count of the live
  fees it would take down. Takedowns go through the shared second look and the run ledger
  (`docs/project/DECISIONS.md`, 2026-10-15).
  The Oct 15 re-file of excess withdrawals and returned mail out of account research (#1398) has
  no Darwin-only live pass yet: its live re-check is Hamilton's fold step (`taxonomy-fold.ts`,
  every publish step), which reads every live and verified account research fee whose name the
  split might move and, while `RESEARCH_SPLIT_LIVE` is off, writes the would-move count by route
  with samples to `detail.taxonomy_fold.pendingResearchSplit` and moves nothing. Moves only
  re-file; none takes a fee down. Once on, live fees under the two new types are guarded by the
  category guard's live sweep.

## Current Implementation (2026-10-12, verify.rules version 3)

`darwin/verify.ts` checks, in order, and records the first failure as a reason code:

| Code | Rule | Decision |
|---|---|---|
| `missing_canonical` | a valid canonical hint | rejected |
| `missing_name` | a non-empty fee name | rejected |
| `category_mismatch` | for the guarded categories, the fee name names its category and not a different fee (`src/lib/fee-category-guard.ts`); a name that names a neighbouring guarded category is re-filed there first (`refileCategory`). Guard v62 (#1100) also reads the row's own source line: a monthly maintenance row whose line charges its price per withdrawal, debit, transaction, transfer or item fails, and one charged per activity over a limit is re-filed to account research first (`refileFromLine`; to excess withdrawals instead, once `RESEARCH_SPLIT_LIVE` is on, when the line names savings, money market or share withdrawals, transfers or debits) | rejected |
| `missing_lineage` | a source URL or stored document key | rejected |
| `percent_not_publishable` | a fee stated as a rate ("1.1% of the transaction") is filed under a category that publishes rates (`PERCENT_FEE_RANGES` in `src/lib/percent-fees.ts`: foreign transaction, cash advance, coin counting, late payment); elsewhere a rate is often an interest rate, not a fee. A rate that passes needs `rate_percent` and no dollar amount (else `invalid_amount`) and a rate inside that category's range (else `outside_envelope`), and its source check is `checkRateAgainstSource` | rejected |
| `invalid_amount` | an amount; $0 only with Knox's `knox_review:zero` flag | rejected |
| `outside_envelope` | a positive amount inside its category's range: hand-set (`envelopes.ts`), else learned (`learned-envelopes.ts`), else $0.01-$2,500 | needs_review |
| `not_in_source` | the fee is stated in the stored text of the document Knox read it from (`checkFeeAgainstSource`, the shared accuracy check; a tiered price counts) | rejected |
| `peer_outlier` | pass 2: not far outside the state's peer range (below); a district or national comparison never holds | needs_review |
| `duplicate_in_batch` | the same fee line (institution, category, amount, frequency, stored document) already verified in this batch | duplicate |
| `duplicate_verified` | the insert did not conflict with an existing verified row | duplicate |
| `category_lesson_pending` | the fee name does not match a category lesson the shared guard has not learned yet (`DARWIN_CATEGORY_HOLDS` in `verify.ts`); Darwin never re-files a row itself, so the row waits for the guard | needs_review |
| `retired_category` | after the source check: the category is not one the top-50 fold retired (`RETIRED_CATEGORIES` in `src/lib/fee-fold.ts`); Hamilton never publishes a retired type, so Darwin never verifies into one | rejected |
| `conditional_zero` | after the source check: a $0 fee whose own schedule line (or Knox's excerpt) carries a non-zero price ("FREE with e-statements, else $6.95 per month"); the charge is the fee, so the $0 reading waits for a re-read | needs_review |
| `tier_perk_zero` | after the source check: a $0 fee is not from one account tier's own schedule (a premium, private-banking or BankOn fee page, known by its address or title) and is not named for such an account (`tier-perk.ts`, #1397: one large bank's live overdraft, NSF, stop payment and wire fees were the $0s of its private-banking Premium Account); a priced row on that schedule is still verified | rejected |
| `name_rule` | after the source check: the name and line pass Hamilton's live-fee name rules (`ruleFor` in `hamilton/eval-verdicts.ts`: rebate, no-fee or waiver sentence, balance threshold, merchant payer, two fees on one line, rate bound, price in name); the rule and why are in the reason text | rejected |
| `insert_failed` | the database accepted the verified row; a refused insert holds that row so the rest of the batch still runs (#1113) | needs_review |

- Each decision records `category_guard_version`; when `CATEGORY_GUARD_VERSION` rises, rows rejected
  as `category_mismatch` or held as `category_lesson_pending` under an older guard are selected
  once more. The hold list (`DARWIN_CATEGORY_HOLDS`) is empty. Its one entry, "Bond return items"
  $35 filed `nsf` (raw 246460, 2026-10-09), left when guard v58 learned that a returned bond or
  coupon filed as NSF is a returned deposited item.
- A Knox category change is a reason to judge a row again (#1295, `category-change.ts`): new
  category, new decision. A row qualifies only when Knox marked it as re-read (`knox_reread_took_over`,
  `knox_stale_hint_repaired`, or `knox_refiled_from:<old>` from #1291), it waits for Darwin
  unverified, no decision was judged under today's category or today's `refileCategory` of it, and
  each decision was made under an earlier Knox category. A decision says so by its `knox_category`
  (recorded from #1295 on). An older one needs proof from the row's flags: a `knox_refiled_from:`
  or `knox_stale_hint_repaired` marker (written when Knox's category changes on a row Darwin had
  judged), or a judged category that is another `canonical_hint:` flag still on the row. Without
  proof the decision may be an older Darwin re-file of today's category, and the row is left
  alone: raw 132922, "Collection Items (plus any bank fees)" $20, a plain take-over filed
  `collection_item` and judged `check_cashing`, while today's re-file keeps `collection_item`.
  The same free checks decide, the shared source check among them, and the new decision records
  today's category, so a row is judged once per category. Switched on Oct 15 (#1093, James's
  yes; `DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE = true`): up to 100 a step join the batch. Each verify
  step, a dry run included, writes the candidate count, their earlier reasons and a 25-row sample
  to `detail.category_change_rejudge`; the read runs in a savepoint, so a failed count never fails
  the step, and a dry run judges nothing. The switched-off dry run (Oct 14 16:16 to Oct 15 09:26,
  336 steps) found 10 candidates; all 10 match their bank's schedule in amount and today's
  category: 6 had been judged under the neighbouring column's fee, 4 fax fees under
  `account_research`. Measured Oct 14 (after #1291 merged): 0 rows qualify; the SQL
  selection reads 1 row (132922), which the proof rule leaves alone. The 8 take-over rows with a
  stale first flag qualify once #1291's repair (inside its switched-off re-file pass) runs, and the
  re-file pass adds its rows when it is on. The 216 rows #1093 step 2 sent back carry the category
  they were rejected under, so this rule does not reach them.
- `not_in_source` (2026-10-06) runs the same check Hamilton's live-fee source check runs, so a
  fee the bank's schedule does not state is stopped before it is verified instead of being
  published and then taken down. It joined version 3 without a bump: a bump re-selects every
  decided row, and rows once held as `duplicate_in_batch` would be verified as second copies.
  Each decision also records `source_check_version` (`DARWIN_SOURCE_CHECK_VERSION`, 2026-10-09):
  when it rises, `not_in_source` rejections stamped lower (or unstamped) are read once more, so a
  fix to the shared source check reaches the rows it was made for. Before that a `not_in_source`
  rejection was final; 1,126 rows at 499 banks were waiting on fixes already live (Northern Trust's
  wrapped-name $25 overdraft, raw 457013, among them).
- `retired_category`, `conditional_zero` and `name_rule` (2026-10-09, `postSourceCheck` in
  `verify.ts`) run after the source check on the line it matched. UAT's hand check of the first
  36 rows the `not_in_source` re-select verified found 16 of a random 20 right: three were $0
  readings of "free if you meet a condition, else $2.50-$6.95" lines, one a package list verified
  into the retired `estatement_fee` type. The same checks are Hamilton's publish-time rules, so a
  row that would come down after publishing now stops before it is verified.
- A `conditional_zero` hold is settled by the next verify step (`conditional-zero-resolve.ts`,
  #1115; James approved rules a-c, 2026-10-13), up to 200 a step, each as a `verify.rules` verdict:
  (a) a duplicate when the same document has a priced verified fee in its category; (c) verified
  at $0 (flag `darwin_conditional_zero_released`) when the bank's own schedule, not a product page,
  prices it free on its own line with no other dollar figure, outside overdraft, NSF, monthly
  maintenance and minimum balance, and not on one account tier's own schedule (`tier-perk.ts`,
  #1397); (b) otherwise rejected, for Knox's next read of the line.
- `verify.recheck` (`verified-recheck.ts`, version 3, 2026-10-15) ends every learning verify step
  by reading up to 200 rows `verify.rules` v3 verified (the rows the `not_in_source` re-select
  verified first, then newest first), once each under `postSourceCheck` and, from version 3, the
  tier-perk test (`tier_perk_zero`, #1397). A failing row that is
  not live is rejected with an `outlier_flags` entry `darwin_recheck:<code>[:<rule>]`; a live one
  is archived in the same step (`published_fee_records` rolled back with that reason, batch
  `darwin-recheck-<run>`, never deleted), the verified row rejected with the same flag and the
  public read cache cleared, once `DARWIN_RECHECK_SAME_STEP_TAKEDOWN` is on (James, 11:55 UTC
  2026-10-09: "stop waiting 12 hours. go"). While it is off (the default) the live row is flagged
  `takedown_pending` through the shared second look (`darwin.verified_recheck`), which is the dry
  read: the switch turns on by PR once UAT has hand-checked 10 flagged rows and found at least 9
  right (version 1 scored 7 of 10 at 12:19 UTC; the three misses are below). A $0's conditional
  price is read from the fee's own table cell (`ownSegment`) and, inside a cell that lists several
  "Label: value" pairs, from the fee's own label; not from a neighbour's cell in the same row, the
  other product columns of a comparison table ("Monthly fee | $0 | $5* | $0"), a non-member or
  non-customer price ("$0 - Members $5 - Non-Members"), or the deposit that opens the account
  ("$1 minimum opening requirement"). Version 2 also re-reads the rows version 1 rejected (flag
  `darwin_recheck:*`): one that passes now is restored to verified with the flag removed; a live
  row that passes now has its pending second-look flag cleared (`takedown_cleared`). Each row
  records a `verify.recheck` attempt (fingerprint `verified:<fee_verified_id>`), so a row is read
  once per recheck version and the pass never starves the batch. Never a hand UPDATE.
- The in-batch duplicate key (`batchKey` in `verify.ts`, `DARWIN_BATCH_KEY_VERSION` v4) is the
  institution, category, amount (or rate), frequency, stored document, the fee's own source line
  and its audience. Version 1 named the URL, so a fee on a bank's current copy of a page was held
  as a duplicate of the same fee on an older copy and never verified; version 2 (2026-10-07)
  named the stored document. Version 3 added the source line, so two products' fees with one
  price on one document (SCCU's money market and interest checking at $15/mo.) are two fees,
  while one line read twice is still one. Version 4 (2026-10-09) added the fee's audience
  (`fee_audience`, `unknown` when unset), so a consumer and a business fee are not duplicates of
  each other. A duplicate recorded under an older key version on a current copy with no verified
  twin on that same document is selected once more.
- Darwin decides each verified fee's audience (#1059; James, Oct 13). A label Knox read on the
  fee's own line stands. A fee Knox left `unknown` takes Knox's context suggestion
  (`knox/audience-context.ts`, via `darwin/audience.ts`), in this order: the schedule's address,
  then the section heading above the fee's line, then its title, a schedule that prices nothing
  for businesses (consumer), or a schedule that also prices business items and does not limit
  the fee (both). In a schedule that also prices business items, a heading for all accounts
  gives both, and a heading naming one audience leaves the fee `unknown` unless it is a business
  heading under a business schedule title: on unseen schedules those headings agreed with a blind
  reading on 14 of 36 fees (#1059, Oct 14). A business heading never takes the consumer default.
  The evidence is written as `darwin:<source>: <words>`, and migration 20270110000047 lets the
  audience trigger keep a `darwin:` decision on the verified row (every other verified write
  still inherits the raw row's audience). The decision is the audience the batch duplicate key,
  the consumer peer check and the second-source check read, and it is recorded on the
  `verify.rules` attempt (`fee_audience`, `audience_evidence`).
- The audience relabel (`audience-relabel.ts`, step `audience-relabel`, #1059 step 3) gives the
  same decision to live fees verified as `unknown` before migration 20270110000047, reading each
  document's newest text. A fee it cannot decide stays `unknown`. No provider calls. Each step
  reads at most `AUDIENCE_RELABEL_DOCUMENTS_PER_STEP` documents (by document id, after the
  run's `after_document_id`) and reports `next_after_document_id` and `remaining_documents`; the
  tick queues the next batch from that cursor until none remain. `AUDIENCE_RELABEL_MODE` is `off`
  until James switches it, in its own PR:
  - `off`: the tick queues one dry run a day over a sample of documents (md5 order by day) that
    counts decisions by audience and evidence source, and writes nothing.
  - `dry_run_full` (shipped, the gate before live): the same cursor chain as live over every
    document, one batch per tick, key chain `darwin:audience-relabel:dry:v1:after:<cursor>`,
    writing nothing but each batch's counts. The last batch adds the chain's totals to its detail
    (`dry_run_totals`) and writes an `audience_relabel.dry_run_totals` event. Live waits until the
    totals show unknown at most 10%, and consumer, both and business each within about 5 points
    of the sample's 70.5 / 23.3 / 2.2. A run does what it was queued for (`params.mode`).
  - `live`: before any write, each fee's old value is recorded as an `audience_relabeled` row in
    `pipeline_feedback` (weight 0). Then the verified row takes the `darwin:` decision, and the
    live published row is touched so the trigger copies it.
  - `rollback`: every recorded fee still carrying the relabel's evidence goes back to `unknown`
    with its old evidence, and the trigger copies the raw row's audience back (the old value),
    in batches of `AUDIENCE_RELABEL_ROLLBACK_PER_STEP`.
  Live and rollback refuse to start (the tick queues nothing, and a step that finds the trigger
  without `darwin:` fails) until migration 20270110000047 is present. On a random 150 of the
  7,949 documents (1,509 of the 77,268 live unknown fees, 14 Oct 2026), it decided 1,064
  consumer, 351 both, 33 business and left 61 unknown.
- Every decision is written to `pipeline_attempts` (stage `verify`, fingerprint
  `raw:<fee_raw_id>`) with `decision` and `reason_code`; a row decided under this rule
  version is never selected again, so skipped rows cannot starve the batch.
- Which rows are due is one SQL test, `darwinDueSql` (`darwinStandingDecisionSql` for the
  decision part) in `verify.ts`, read by the selection, the state-lane scheduler's backlog check
  and the daily health check (#1052, 2026-10-14). Before, the scheduler and health counted only
  rows with no decision, so a row due again after a guard bump in a state with nothing else to do
  never woke a lane: 26 rows in Puerto Rico and Guam waited from Oct 9 and Oct 13.
- Review signals carry `reason_counts` keyed by code, and the category range for
  `outside_envelope` rows.
- A verified $0 row carries the `zero_fee` flag, which is what lets Hamilton publish it.
- Pass 2 (`peer-checks.ts`, free, rows the rules accept), each its own strategy in
  `pipeline_attempts` (stage `verify`, fingerprint `raw:<fee_raw_id>`):
  - `verify.peer_range` v3: consumer fees only. The peer levels are consumer prices, so a fee
    whose audience is not `consumer` or `both` (business or unknown) is not compared at all
    (2026-10-09); its source check and second-source check still run. A positive consumer
    amount below p25 / 3 or above p75 * 3 of its
    state peers (asset-size tier level when it has 8+ institutions, else the state-wide
    level) is held as `needs_review` with reason code `peer_outlier` and the range in
    the reason and in the review signal's `peer_outliers`. When the state has fewer than
    8 peers the comparison falls back to the bank's Fed district, then the nation (same
    tier-then-all rule; levels from the live catalog, cached an hour per instance). A
    fallback comparison is recorded (`peer_scope`, `peer_held: false`) but never holds:
    the 2026-10-06 audit found half of the state-level holds were real prices, and every
    fee reaching pass 2 is already stated in the bank's schedule. Outcome
    `evidence_mismatch` when outside, `ok` when inside. Step detail:
    `peer_fallback_checks`, `peer_fallback_outliers`. On the 24 hours to 2026-10-06
    13:30 UTC, 11,637 of 28,039 approvals had no state comparison; the fallback covers
    all but a handful, and about 1,500 of them sit outside the wider range.
  - `verify.second_source` v2: the same fee in another stored document of the same
    bank (an older copy or a sister document) only when customer applicability is
    compatible. Consumer rows accept consumer or both-audience corroboration; business
    rows accept business or both; unknown rows do not receive second-source confidence.
    A business-only fee can never corroborate a consumer fee. Same compatible amount:
    outcome `ok` and the verified row gets the `second_source_agrees` flag. Different
    compatible amount only: `evidence_mismatch`, recorded as evidence, never blocking. Re-measured 2026-10-06
    13:30 UTC: before the schedule check (`not_in_source`), published fees whose second
    copy disagreed were pulled within 8 hours at 22% (77 of 346) against 8.5% (571 of
    6,709) when it agreed; since, 1.9% (2 of 108) against 2.7% (5 of 183). The schedule
    check closed the gap, so a disagreement stays evidence.
- Layer 2, learned category check (`category-model.ts`, free, shadow mode):
  `verify.category_model` v1 is a naive Bayes model over fee-name word stems and word
  pairs, trained on the live published catalog (cached an hour per instance), so it
  improves as wrong fees are taken down. It records, for every row with a category,
  the probability of Knox's category and its own best guess. Below 0.05 the outcome is
  `evidence_mismatch` (disputed); it never changes the decision yet. Step detail:
  `category_model_disputes`. On the 43 Texas answer keys it disputed 20 of 61 wrong
  approvals and 16 of 268 right ones, and its guess matched the key for 14 of the 20.
  Disputes are meant for the Claude adjudicator (layer 3), one of Darwin's two paid passes
  (the other is the release review, below), both billed to `ANTHROPIC_API_KEY_DARWIN`. The model also trains on the hand-checked
  answer-key fees in the shared learning store (`pipeline_feedback`, kind `answer_key`).
- Layer 3, Claude adjudicator (`adjudicate.ts`, step `verify-paid`, a provider step after
  `classify`, shadow mode): `verify.adjudicate` v1 sends Claude only the fees the free
  layers disagree on: approved fees the category model disputes, and category-guard
  rejects where the model is at least 0.9 sure of another category the guard accepts.
  25 fees per call, at most 10 calls per run, `PIPELINE_PAID_VERIFY_MODEL` (default
  Haiku 4.5), billed to Darwin's key under `agent:darwin`, which is fail-closed until its
  caps are set. Each verdict (is it a fee, which category) is recorded per fee with its
  side (`knox`, `model`, `other`, `not_a_fee`); it never changes a decision yet. On live
  data at 2026-10-06 07:20 UTC, 23 approvals and 477 rejects qualified.
  v2 (2026-10-07) sends each fee with the schedule rows around it (`scheduleContext`) and
  the shared source check's verdict on its amount (`price_check`), and re-reads v1's
  disagreements. Scored against the 81 answer-key texts, v1 was right on 27 of the 37
  disagreements at key banks (Knox on 2); its misses mostly took a neighbouring row's
  price or a balance threshold as the fee
  (`/mnt/project-files/darwin/adjudicate-vs-answer-keys-2026-10-07.md`).
- Paid calls only when they can act (#1111 step 1, PR #1126, 2026-10-12): `verify-paid` pays for the release
  review only while `DARWIN_RELEASE_ACTS` is on, and for the adjudicator only while
  `DARWIN_ADJUDICATE_SHADOW` is on (off: its verdicts never change a decision). With both off,
  as now (releases paused 2026-10-08), the step makes no model call, spends $0 and says which
  pass it skipped; the free verdict score still runs. In October the two passes had spent
  $9.02 (812 calls) and $3.98 (778 calls) on verdicts that changed nothing. A capped
  measurement run passes `measure: true` to make the calls anyway.
- Verdict score (`verdict-score.ts`, runs at the end of `verify-paid`, no model call): the
  category review's and the release review's verdicts at answer-key institutions are scored
  against the hand-keyed schedules (`answer-key-fees.json`, compacted from the Knox
  fixtures) in chunks of 20 decided verdicts, per review and per prompt version; a version
  below the newest one seen gets no more verdicts, so its open chunk is closed as a partial
  chunk (`detail.partial`, read with `decided`; 2026-10-09, after the release review went v11
  to v17 in a day and no version reached 20). Each chunk is a `verify.verdict_score` attempt
  (`detail.review`, `review_version`, `right`, `wrong`, `hit_rate`, `knox_right`, `misses`),
  outcome `ok` at 19/20 or better. Each miss is a `pipeline_feedback` row (kind
  `review_wrong`, check `darwin.verdict_score`), and both reviews read their own recent
  tuning-key misses for the categories in a batch as lessons. Holdout-key misses are recorded
  at weight 0 (`lesson: false`) and never read back, so `detail.holdout.hit_rate` measures the
  review on fees it was never corrected on (2026-10-09; before that, 29 holdout misses had
  been fed back as lessons). Coverage is small: about 5% of the
  category review's verdicts and 15 release reviews (to 2026-10-07) fall at keyed banks.
- Held fees (`release-held.ts`, after each verify step, up to 200 per step): every fee
  held as `outside_envelope` or `peer_outlier` is checked against the bank's stored schedule
  with `checkFeeAgainstSource`. Not stated: `reject`. Stated but outside the hand-set range:
  `keep` for a person (Hamilton's publish gate uses that range). Stated only as a tier, or
  filed under a category the category model disputes: `keep`. Same fee already verified:
  `duplicate`. Otherwise `review`: in the next `verify-paid` step, before the adjudicator and
  from the same call budget, `release-review.ts` (`verify.release_review`) has Claude read the
  fee beside its schedule line and release it only if it is a price the bank charges, fits
  the category it was filed under (the prompt lists the names the taxonomy files there), and
  the amount is the price, not a cap or a misread number. Released rows carry the
  `darwin_released_hold` flag so the whole release can be found and rolled back.
  A state lane whose state has fewer held fees than its call budget fills the rest with the
  oldest held fees from any state (2026-10-07: Utah's lane had 1 while about 1,000 waited elsewhere).
  Recorded passes (`releaseRecordedPasses`, strategy `verify.release_recorded`, each extract-free
  `verify` step): the review never picks a fee with a v17 attempt again, so the 421 fees v17 passed
  while the release did not act would stay held even with `DARWIN_RELEASE_ACTS` on. This pass
  releases them after today's free holds, under its own switch (`DARWIN_RECORDED_RELEASE_ACTS`, on since Oct 15),
  so the other release paths stay verdicts-only. Three holds were added after a hand check of 20
  found 19 right (Oct 15), and they hold in the review too:
  - `business_activity_row`: a business account's "Per Each ..." activity row filed outside
    account research (raw 418400, "Per Each ATM Withdrawal" $0.25 filed as an out-of-network ATM
    fee).
  - `frequency_word_disagrees`: an allowance's period stored as the fee's ("Over 3 per Year"
    stored annual), or a period word that contradicts a stated frequency.
  - `glued_or_cut_name`: a glued header ("Account Fees: ..."), a glued column (": no", "Notary:
    Outgoing") or a cut-off ending.
  Off, the step detail (`recorded_pass_release`) counts what would release and what is held, by
  category, and nothing is written. Switched on, the first step is a dry run that writes one
  ledger row (fingerprint `darwin:recorded-release:dry-run:v1`) with those counts; a step of
  another run at least 4 minutes later (the next tick) releases. A rollback of the batch reads the
  `verify.release_recorded` v1 attempts with outcome `ok` (`detail.fee_verified_id`).
  A second hand check of the 402 left to release found 15 of 20 right (Oct 15; overdraft 4 of 6,
  NSF 1 of 3, maintenance 5 of 6). Four more holds, in the review too:
  - `footnote_in_price` (also): the line's only price, whole with no cents, ending in 1 to 3,
    held as a peer outlier, and still plausible for its category without the last digit
    ("Monthly Service Charge: $31" for $3 plus footnote 1, raw 459372); or a superscript digit
    after the price.
  - `overdraft_transfer_as_od_nsf`: an item paid by an overdraft transfer filed as NSF or overdraft
    (raw 151073, filed as NSF; it is `od_protection_transfer`).
  - `band_as_price`: a band or threshold read as the price ("Lessthan $5.00", raw 437275; "$1,000 or
    over"), or a name cut at the band word.
  - `two_column_glue`: a name holding a second fee's name that another row prints as its own fee
    (raw 296682), a row's short band and price cells (40 characters or fewer, opening on a band
    word) printed again under another fee's name (raw 432124), or two headings and their two prices
    on one line with the fee's price not under its own heading (raw 169723, a levy given the
    account-closure price).
  Every other overdraft and NSF pass in the batch waits for a person (`overdraft_nsf_for_person`,
  `RECORDED_RELEASE_PERSON_CATEGORIES`). The third hand check scored 18 of 20. Its two misses
  hold, and two good fees the glue check held (whole sentences repeated in a product table, raw
  206385 and 512869) now release. `maintenance_without_context` (recorded passes only) holds a
  maintenance price with no rows around it, already a peer outlier: "Monthly Service Fee $29.95" on
  every Wilson & Muir page (raw 538902), a business cash management fee. On 15 Oct: 387 of 421
  would release, 34 held (11 glued or cut name, 7 frequency word, 5 overdraft/NSF for a person, 3
  two-column glue, 3 maintenance without context, 2 band as price, 1 footnote, 1 overdraft
  transfer, 1 business activity row).
  v1 released on the schedule check alone; its dry run on 2026-10-06 (1,997 of 4,128 held
  fees) had 12 of 20 hand-checked releases right. v2 adds the gates above. v3 (James chose
  "Reject only", 2026-10-06 16:49 UTC) acts on rejects (`DARWIN_RELEASE_REJECTS_ACT`): each
  writes a `darwin.release` note of kind `not_on_schedule` to `pipeline_feedback` and leaves
  the held pile. Those fees were never live, so nothing comes down. v4 (James, 2026-10-07:
  scrapping is a last resort, looked at more than once, logged, never deleted) takes two
  looks: the first "not stated" is `reject_pending` (logged, no note, still held); at least
  `DARWIN_REJECT_SECOND_LOOK_HOURS` later the fee is read again against its own document and
  the bank's current copy, and only a second "not stated" is a final `reject` with its note.
  A fee found on the schedule replaces an earlier reject note with a `restored` one
  (`stated_on_later_look`). Raw rows, attempts and notes are never deleted. Releases stay a dry run
  while `DARWIN_RELEASE_ACTS` is false; switching it on needs James's word and a version bump,
  and writes released fees as `darwin_verified` notes. Step detail: `held_release`.
  `verify.release_review` v5 (2026-10-07) is versioned on its own: a hand check of 20 v4
  verdicts had 17 right; the prompt now says a stop payment's removal and an expedited
  version of a service do not fit the service's category, and "Cost plus $8" is not a price.
  The review also reads lessons from `pipeline_feedback` (2026-10-07): for each category in
  a batch, the 3 latest live fees Hamilton's category checks took down as wrongly filed and
  the 2 latest takedowns a later check restored, each with its schedule line. A new takedown
  or restore is in the next review's prompt with no code change. The source check's amount
  judgements are left out until they hold up (of 20 read against the full page, 4 were real
  prices wrongly taken down and 3 unreadable). The review also reads the 3 schedule rows on each
  side of a fee's line (`scheduleContext`), since a price can belong to the next row or column.
  Each review attempt's detail records `lessons` (how many were in its prompt).
  v6 (2026-10-07): a second hand check of 20 v5 passes had 16 right, with two overdraft-protection
  transfers passed as overdraft. Each item now lists `not_these` (the categories the guard's
  re-file rules move its category's fees to), and a fee whose name plus line `refileCategory`
  moves elsewhere never passes (attempt detail `refiles_to`).
  v7 (2026-10-07): a hand check of 20 v6 passes had 17 right (a "Smart Safe" cash device passed
  as safe deposit box rent, a $65 box read with its footnote as $651, a bare "overdrafts $5.00"
  from jumbled rows). The prompt names all three.
  v8 (2026-10-07): a hand check of 20 v7 passes had 17 right (an incoming wire priced "$2.95 (FEE
  WAIVED)", an NSF check re-clear filed as NSF, an online-wire monthly fee filed as monthly maintenance).
  The prompt names all three. `scheduleContext` no longer anchors on a bare price row ("$5.00"),
  which had shown one item the rows around a different fee.
  v9 (2026-10-07): a hand check of 20 v8 passes had 18 right (an "Emergency Card Replacement" passed
  as card replacement, and a $10 rush card read from "Debit Card Replacement Rush Order | $10 $75").
  The prompt names emergency service and two prices in one row.
  v10 (2026-10-07): a hand check of 20 v9 passes had 18 sure right (an "Overnight Fee (Business Bill
  Pay)" passed as bill pay; a $2.75 "Return Check Item" beside a $30 returned-check fee is unclear).
  A fee whose name says it is the expedited, rush, overnight, emergency or same/next/second-day
  version of a service now never passes outside a premium category such as `rush_card`
  (`premiumServiceMisfiled`, attempt detail `premium_service`).
  v11 (2026-10-08): releases on (`DARWIN_RELEASE_ACTS`, James, "Turn on" at 02:16 UTC) after a
  hand check of 20 v10 passes had 19 right and 1 arguable. A passing fee becomes a verified row
  flagged `darwin_released_hold`, so the whole release can be found and rolled back. The bump
  has every held fee judged again with release on (paused again after v13, below).
  v12 (2026-10-08): v11 released 1,637 fees (219 live by 03:48 UTC). A hand check of 20 live ones
  found 18 right: "Monthly Fee $50.00" above "Night Deposit Bag $10.00" passed as the account's
  monthly fee and a $5 "Returned check fee" passed as NSF. A passing fee now stays held when the
  category guard rejects its name, when a bare "Monthly Fee" sits among a business service's rows,
  or when a plain returned check or item under $10 is filed as NSF (`releaseHoldReason`, attempt
  detail `hold_reason`).
  v13 (2026-10-08): v12 released 198 fees by 10:08 UTC (130 live). A hand check of 20 live ones
  found 18 right, 1 wrong ("/hr incl. reproduction", Legal Process Compliance $20/hr, released as
  document reproduction) and 1 arguable (a $5 draft copy named "account research fee may apply)").
  A name starting with "/" or ending in an unopened ")" now stays held (`name_fragment`).
  Releases off again (2026-10-08 21:30 UTC, James, "Pause" on the release card) after a hand
  check of 20 released v13 fees scored 17 (the three misses v14 names): `DARWIN_RELEASE_ACTS` is false in `release-held.ts`, so the review
  records verdicts only, and with #1111 step 1 (above) `verify-paid` does not pay for it at all
  until releases are back on or a run passes `measure: true`. They stay off until a fixed
  review's 20-fee check scores 19 or better. The review went on to v17 with releases off
  (`DARWIN_RELEASE_REVIEW_STRATEGY` in `release-review.ts`):
  v14 (2026-10-08): a hand check of 20 released v13 fees found a merchant's fee for a member's
  NSF check released as NSF, a $5 "Overdraft Protection Fee" beside a $25 Courtesy Pay fee
  released as overdraft, and an early-closure fee read as "$251 | 1" ($25, footnote 1); those
  stay held (`charged_to_merchant`, `small_overdraft_protection`, `footnote_in_price`).
  v15 (2026-10-08): James set the bar as the complete record, frequency included; a fee whose
  frequency says the opposite of its schedule line stays held (`frequency_contradicts_line`;
  "Excess activity charge - $5.00 each after 6" had been released as monthly).
  v16 (2026-10-08): the first 200-fee complete-record eval found frequency blank on 48% of live
  fees although the line said "each" or "per month", and 25 of 31 bad names were dot leaders,
  footnotes, bullet text, table headers or two-column glue. A released fee takes its frequency
  from the words after its own price when they point one way (`frequencyFromLine`), and those
  name shapes stay held (`name_fragment`).
  v17 (2026-10-09): names cut from a sentence or a table ("Inactive fee: This account may be
  subject to an Inactive fee of") stay held when Knox's `isCutoffName` finds a cut-off shape
  (`name_fragment`); Knox's retidy v6 gives the live ones their tidy name.
  Category guard v21 rejects business services' monthly fees (remote
  deposit scanners, IntraFi/ICS, per-location fees) as monthly maintenance and deposited checks
  coming back as NSF, so Hamilton's category guard takes the live ones down after its second look.
  Guard v22 (2026-10-08) also fails a returned check or item under $10 filed as NSF when the same
  schedule prices NSF separately at $15 or more (`schedule_contradicts`; Dean Co-operative Bank).
  Guard v23 drops the $10 ceiling (any price below the schedule's NSF fee). Once Hamilton takes such
  a fee off NSF, the classify step's `verify.schedule_refile` re-files its verified row as
  `deposited_item_return` (flag `darwin_schedule_refiled`, attempt detail from/to), and Hamilton
  publishes it as an RDI through its normal checks.
  Guard v24 (2026-10-08) rejects statement-copy and photocopy fees ("Statement Copy Fee",
  "Returned Item Photocopy", "Copy of ...") filed as overdraft or NSF, even under a section heading.
  Guard v29 (2026-10-08) accepts a per-item overdraft or courtesy pay fee whose own note counts the
  fees charged a day ("Overdraft Item Fee (Maximum of 5 Charged Per Day)"); a cap priced in the
  note or named outside it ("Overdraft Fee (maximum charge per day)", "Overdraft Daily Cap") stays out.
- Guard v29 also files "Insufficient Funds Charge (Paid)" (beside "(Returned)") as the overdraft fee, and re-files it there from NSF (WaFd).
- Guard v34 (2026-10-08; v31 and v33 went to the Accuracy rules in PRs 659 and 662) files paid and honored NSF items ("Paid nonsufficient funds (NSF)", "NSF Share Draft (Honored)", "Paid Consumer & Business NSF Items") as the overdraft fee, and re-files them there from NSF. One price for the paid and the returned item ("NSF Paid Item Fee/Returned Item Fee") counts as both, like "Returned item/overdraft".
- Guard v35 (2026-10-08) accepts a per-item overdraft or NSF fee whose note states the daily cap: a dollar cap above the row's own price ("NSF Returned Item(s) Charge (NSF charge maximum of $100 per day)" $25, First State Bank of Rosemount), and a cap note that names the returned items sharing it ("Overdraft Fee ... (Consumer Accts: 5 max total OD or Returned Item fees daily)", BankIowa).
- Guard v36 (2026-10-08) changes no rule: PRs 665 and 668 both shipped v35, so rows rejected between their deploys are re-checked under both.
- Guard v42 (2026-10-08; v40 and v41 are Accuracy's, PR 682) files an NSF item marked paid after a dash or in brackets ("NSF Fee Charge - Paid (per item)", "Nonsufficient Funds Fee-Paid", "Insufficient Funds Charge (Check Paid, Per Item)") as the overdraft fee and re-files it there from NSF; "per non-paid item", "Paid from other ... account" and "We will not assess ..." stay out. "Overdraft Privilege Standard or Extended Coverage" names the program, not an extended overdraft fee.
- The guard is at v65 (`CATEGORY_GUARD_VERSION` in `src/lib/fee-category-guard.ts`). The notes for
  v43 to v65 are the version comments above that constant, not this guide; v58 is the bond-return
  lesson above. v65 (James, Oct 15, #1398) adds guard rules for `excess_withdrawal` and
  `returned_mail` (amount envelopes $1 to $50 in `envelopes.ts`), re-files research filed under
  either back to account research. Once `RESEARCH_SPLIT_LIVE` is on, an over-limit activity charge
  on a monthly maintenance row's own line (`refileFromLine`) that names savings, money market or
  share withdrawals, transfers or debits goes to `excess_withdrawal`; until then, and for every
  other activity charge, it still goes to account research. Nothing is filed under either new key
  while the switch is off.
- Learning store: every verify decision except duplicates and category rejects (the
  publish-step sync writes those) is written to `pipeline_feedback` as a judgement on
  Knox's read (`darwin/feedback.ts`; step detail `feedback_written`, null when skipped).
- The ranges in `envelopes.ts` are hand-set and deliberately wide. Categories without one
  get a learned ceiling (`learned-envelopes.ts`): three times the 95th percentile of the
  banks' median live amount, for categories priced by 30+ banks, lending fees excepted;
  the floor stays $0.01 because per-page and per-item prices of a few cents are real.
  Darwin alone applies it (Hamilton's publish gate and outlier rollback keep the
  hand-set ranges, so it never takes a live fee down). Step detail:
  `learned_envelope_holds`; the decision's attempt records `amount_envelope` with its
  source. On the 24 hours to 2026-10-06 13:30 UTC it would have held 35 of about 5,500
  approvals in its 19 categories; in a sample most were limits, thresholds and examples
  read as the fee.

## Required Behavior (target contract)

- Verify canonical fee hints, amount reasonableness, duplicate state, source lineage, and rejection policy before promotion.
- Preserve raw row lineage through `fee_raw_id`, institution ID, source URL/key, confidence, flags, and verifying run/event IDs.
- Aggregate review signals by institution/run with reason counts instead of creating noisy one-row alerts.
- Keep verified rows separate from published rows until Hamilton publication gates pass.

## Boundaries

- Do not publish fee rows directly.
- Do not turn skipped or challenged rows into public benchmark inputs.
- Do not weaken verification checks to increase row volume.

## Daily health check (contract)

`agent-health.ts` runs with the daily scoreboard step and stores these numbers in
`pipeline_scoreboard_snapshots.detail.agent_health`, next to yesterday's. A broken rule, or any
number that moved more than 25% since yesterday, is named in the scoreboard step's summary.
Change this table and `agent-health.ts` in the same PR.

| Rule | Number | Holds when |
|---|---|---|
| Steps do not fail | `stepsFailed` (24 h) | 0 |
| Darwin keeps up | `undecided` (Knox rows the verify step would select now: never decided, or due again after a guard, source-check, envelope or batch-key change; `darwinDueSql` in `verify.ts`) | ≤ 500 (`DARWIN_VERIFY_MAX_LIMIT`) |
| No week-old waits | `waitingOver7d` (due rows sent to Darwin over 7 days ago with no first decision at this rule version) | 0 (`DARWIN_MAX_FIRST_DECISION_DAYS`) |
| Fees Darwin passed survive the bank's own schedule | `sourceCheckTakedowns / published` (24 h) | ≤ 5% |

Also recorded, without a rule: `stepsCompleted`, `spendUsd`, `decided`, `passed`.

The pool of Knox rows flagged for Darwin and not verified (`pool`) is split three ways, and the
parts add up to it:
- `undecided`: due now (the "Darwin keeps up" number above).
- `heldForReview`: not due, and the latest `verify.rules` decision is a hold the release review
  looks at (`outside_envelope`, `peer_outlier`; `DARWIN_HELD_REASON_CODES`). Split by the latest
  `verify.release` verdict: `heldKeep`, `heldReview`, `heldDuplicate`, `heldReject`, and
  `heldNoVerdict` (none yet, or a first "not stated" look waiting for its second).
- `finalRejects`: not due, with a standing decision that is not a hold. Darwin owes these
  nothing until a rule version changes, so they are in no waiting number.

`audienceCorrection` counts rows the audience trigger refuses; they are neither due nor decided.
On 15 Oct (03:46 UTC): pool 16,351 = 7,340 due + 6,094 held (4,121 keep, 886 review, 809 duplicate, 278
reject) + 2,917 final rejects.

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `AUDIENCE_RELABEL_VERSION` | `darwin.audience_relabel` | v1 | `darwin/audience-relabel.ts` |
| `DARWIN_ADJUDICATE_STRATEGY` | `verify.adjudicate` | v2 | `darwin/adjudicate.ts` |
| `DARWIN_CATEGORY_MODEL_STRATEGY` | `verify.category_model` | v1 | `darwin/category-model.ts` |
| `DARWIN_PEER_STRATEGY` | `verify.peer_range` | v3 | `darwin/peer-checks.ts` |
| `DARWIN_SECOND_SOURCE_STRATEGY` | `verify.second_source` | v2 | `darwin/peer-checks.ts` |
| `DARWIN_RELEASE_STRATEGY` | `verify.release` | v4 | `darwin/release-held.ts` |
| `DARWIN_RECORDED_RELEASE_STRATEGY` | `verify.release_recorded` | v1 | `darwin/release-review.ts` |
| `DARWIN_RELEASE_REVIEW_STRATEGY` | `verify.release_review` | v17 | `darwin/release-review.ts` |
| `DARWIN_SCHEDULE_REFILE_STRATEGY` | `verify.schedule_refile` | v1 | `darwin/schedule-refile.ts` |
| `DARWIN_VERDICT_SCORE_STRATEGY` | `verify.verdict_score` | v1 | `darwin/verdict-score.ts` |
| `DARWIN_RECHECK_STRATEGY` | `verify.recheck` | v3 | `darwin/verified-recheck.ts` |
| `DARWIN_VERIFY_STRATEGY` | `verify.rules` | v3 | `darwin/verify.ts` |
| `DARWIN_SOURCE_CHECK_VERSION` | — | v2 | `darwin/verify.ts` |
| `DARWIN_BATCH_KEY_VERSION` | — | v4 | `darwin/verify.ts` |
