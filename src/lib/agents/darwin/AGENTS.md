# Darwin Agent Guide

Darwin owns verification and classification.

## Authority

- Darwin reads `raw_fee_observations`.
- Darwin writes eligible rows to `verified_fee_observations`.
- Darwin may skip or challenge raw rows when canonical category, amount, duplicate, source lineage, or policy checks fail.
- Darwin may emit Monitor signals for verified rows and verification-review states.

## Current Implementation (2026-10-06, verify.rules version 3)

`darwin/verify.ts` checks, in order, and records the first failure as a reason code:

| Code | Rule | Decision |
|---|---|---|
| `missing_canonical` | a valid canonical hint | rejected |
| `missing_name` | a non-empty fee name | rejected |
| `category_mismatch` | for the guarded categories, the fee name names its category and not a different fee (`src/lib/fee-category-guard.ts`); a name that names a neighbouring guarded category is re-filed there first (`refileCategory`) | rejected |
| `missing_lineage` | a source URL or stored document key | rejected |
| `invalid_amount` | an amount; $0 only with Knox's `knox_review:zero` flag | rejected |
| `outside_envelope` | a positive amount inside its category's range: hand-set (`envelopes.ts`), else learned (`learned-envelopes.ts`), else $0.01-$2,500 | needs_review |
| `not_in_source` | the fee is stated in the stored text of the document Knox read it from (`checkFeeAgainstSource`, the shared accuracy check; a tiered price counts) | rejected |
| `peer_outlier` | pass 2: not far outside the state's peer range (below); a district or national comparison never holds | needs_review |
| `duplicate_in_batch` | the same fee line (institution, category, amount, frequency, stored document) already verified in this batch | duplicate |
| `duplicate_verified` | the insert did not conflict with an existing verified row | duplicate |
| `category_lesson_pending` | the fee name does not match a category lesson the shared guard has not learned yet (`DARWIN_CATEGORY_HOLDS` in `verify.ts`); Darwin never re-files a row itself, so the row waits for the guard | needs_review |

- Each decision records `category_guard_version`; when `CATEGORY_GUARD_VERSION` rises, rows rejected
  as `category_mismatch` or held as `category_lesson_pending` under an older guard are selected
  once more. The hold list (2026-10-09) carries "Bond return items" $35 filed `nsf` (raw 246460), a
  returned deposited item the v57 guard let through; the lesson went to Accuracy, and the entry
  leaves the list in the change that teaches the guard.
- `not_in_source` (2026-10-06) runs the same check Hamilton's live-fee source check runs, so a
  fee the bank's schedule does not state is stopped before it is verified instead of being
  published and then taken down. It joined version 3 without a bump: a bump re-selects every
  decided row, and rows once held as `duplicate_in_batch` would be verified as second copies.
  Each decision also records `source_check_version` (`DARWIN_SOURCE_CHECK_VERSION`, 2026-10-09):
  when it rises, `not_in_source` rejections stamped lower (or unstamped) are read once more, so a
  fix to the shared source check reaches the rows it was made for. Before that a `not_in_source`
  rejection was final; 1,126 rows at 499 banks were waiting on fixes already live (Northern Trust's
  wrapped-name $25 overdraft, raw 457013, among them).
- The in-batch duplicate key names the stored document (`DARWIN_BATCH_KEY_VERSION` 2,
  2026-10-07). Version 1 named the URL, so a fee on a bank's current copy of a page was held
  as a duplicate of the same fee on an older copy and never verified. A version 1 duplicate on
  a current copy with no verified twin on that same document is selected once more.
- Every decision is written to `pipeline_attempts` (stage `verify`, fingerprint
  `raw:<fee_raw_id>`) with `decision` and `reason_code`; a row decided under this rule
  version is never selected again, so skipped rows cannot starve the batch.
- Review signals carry `reason_counts` keyed by code, and the category range for
  `outside_envelope` rows.
- A verified $0 row carries the `zero_fee` flag, which is what lets Hamilton publish it.
- Pass 2 (`peer-checks.ts`, free, rows the rules accept), each its own strategy in
  `pipeline_attempts` (stage `verify`, fingerprint `raw:<fee_raw_id>`):
  - `verify.peer_range` v2: a positive amount below p25 / 3 or above p75 * 3 of its
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
  - `verify.second_source` v1: the same fee in another stored document of the same
    bank (an older copy or a sister document). Same amount: outcome `ok` and the
    verified row gets the `second_source_agrees` flag. Different amount only:
    `evidence_mismatch`, recorded as evidence, never blocking. Re-measured 2026-10-06
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
  Disputes are meant for the Claude adjudicator (layer 3), Darwin's only paid call,
  billed to `ANTHROPIC_API_KEY_DARWIN`. The model also trains on the hand-checked
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
  has every held fee judged again with release on.
  v13 (2026-10-08): v12 released 198 fees by 10:08 UTC (130 live). A hand check of 20 live ones
  found 18 right, 1 wrong ("/hr incl. reproduction", Legal Process Compliance $20/hr, released as
  document reproduction) and 1 arguable (a $5 draft copy named "account research fee may apply)").
  A name starting with "/" or ending in an unopened ")" now stays held (`name_fragment`).
  v12 (2026-10-08): v11 released 1,637 fees (219 live by 03:48 UTC). A hand check of 20 live ones
  found 18 right: "Monthly Fee $50.00" above "Night Deposit Bag $10.00" passed as the account's
  monthly fee and a $5 "Returned check fee" passed as NSF. A passing fee now stays held when the
  category guard rejects its name, when a bare "Monthly Fee" sits among a business service's rows,
  or when a plain returned check or item under $10 is filed as NSF (`releaseHoldReason`, attempt
  detail `hold_reason`). Category guard v21 rejects business services' monthly fees (remote
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
- Guard v29 also files "Insufficient Funds Charge (Paid)" (beside "(Returned)") as the overdraft fee, and re-files it there from NSF (WaFd).
  fees charged a day ("Overdraft Item Fee (Maximum of 5 Charged Per Day)"); a cap priced in the
  note or named outside it ("Overdraft Fee (maximum charge per day)", "Overdraft Daily Cap") stays out.
- Guard v34 (2026-10-08; v31 and v33 went to the Accuracy rules in PRs 659 and 662) files paid and honored NSF items ("Paid nonsufficient funds (NSF)", "NSF Share Draft (Honored)", "Paid Consumer & Business NSF Items") as the overdraft fee, and re-files them there from NSF. One price for the paid and the returned item ("NSF Paid Item Fee/Returned Item Fee") counts as both, like "Returned item/overdraft".
- Guard v35 (2026-10-08) accepts a per-item overdraft or NSF fee whose note states the daily cap: a dollar cap above the row's own price ("NSF Returned Item(s) Charge (NSF charge maximum of $100 per day)" $25, First State Bank of Rosemount), and a cap note that names the returned items sharing it ("Overdraft Fee ... (Consumer Accts: 5 max total OD or Returned Item fees daily)", BankIowa).
- Guard v36 (2026-10-08) changes no rule: PRs 665 and 668 both shipped v35, so rows rejected between their deploys are re-checked under both.
- Guard v42 (2026-10-08; v40 and v41 are Accuracy's, PR 682) files an NSF item marked paid after a dash or in brackets ("NSF Fee Charge - Paid (per item)", "Nonsufficient Funds Fee-Paid", "Insufficient Funds Charge (Check Paid, Per Item)") as the overdraft fee and re-files it there from NSF; "per non-paid item", "Paid from other ... account" and "We will not assess ..." stay out. "Overdraft Privilege Standard or Extended Coverage" names the program, not an extended overdraft fee.
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
| Darwin keeps up | `undecided` (Knox rows waiting for the current verify version) | ≤ 500 (`DARWIN_VERIFY_MAX_LIMIT`) |
| Fees Darwin passed survive the bank's own schedule | `sourceCheckTakedowns / published` (24 h) | ≤ 5% |

Also recorded, without a rule: `stepsCompleted`, `spendUsd`, `decided`, `passed`.
