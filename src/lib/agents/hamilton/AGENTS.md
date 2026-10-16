# Hamilton Agent Guide

Hamilton is the last agent in the pipeline and the one people meet. It has four faces,
all built on the same live published fees, and one rule across them: every output can be
retraced without asking Hamilton (see Audit trail).

## Hamilton's faces (James, 2026-10-06 00:08 UTC)

1. **Fee verifier and publisher.** Publishes Darwin-verified fees and keeps the live
   catalog honest: category guard, outlier rollback, duplicate collapse, rules re-check
   and source check (sections below). Accuracy is the share of live fees whose amount and
   category match the bank's own current schedule.
2. **Research publisher.** Writes the national and district reporting from the live
   catalog and the economic layers: the National Fee Index, state indexes, peer briefs
   and the Monthly Pulse (`src/lib/report-engine`, report types in `types.ts`). Reports
   are queued as `report_jobs` and live in `published_reports` once published.
   Before a job is complete, the free `report-reconcile` step recomputes every fee figure
   it prints from `published_fee_catalog` (rates from `published_fee_rate_catalog`) under
   the statistics contract (`report-engine/reconcile.ts`, #1066). A figure more than one
   cent or one institution off (a whole-scope total: more than 5 or 0.5%, whichever is
   larger, with the drift recorded; the Pulse's 30-day "institutions added" count is not a
   total and keeps the one-institution rule), printed with no live value, or a printed fee change that is
   no longer live fails the job, with each figure and why on `data_manifest.reconciliation`;
   Publish refuses a job without a reconciliation that tied out.
3. **Industry expert and research assistant.** Answers questions about fees, regulation
   and the economy with cited facts, at every data layer the project holds: national,
   Fed district, regional, state, regulatory and institutional. Overdraft and NSF are
   reported separately wherever a filing separates them (NCUA does; the bank call
   report combines them on one line, which Hamilton always says).
4. **Decision-support workspace for paid clients** (`src/lib/hamilton/workspace`). See
   the next section.

## Decision-support workspace (James, 2026-10-05 23:27 UTC)

Hamilton supports the decision; it does not make it.

- Flow: research, explore, model, decide, implement. The Briefing surfaces what is worth
  a look (market position, competitor moves, revenue shifts); salience orders items and
  never implies a price direction.
- Never tell the institution to raise, lower or drop a fee, and never offer to "approve a
  recommendation". Model the prices the reader asks about; the tested price is always
  the reader's.
- Every scenario is labeled with its evidence level: `market` (position and
  per-1,000-items arithmetic, no dollar total), `working_estimate` (the bank's reported
  income for that fee line divided by its published fee), or `institution` (items and
  waiver rate the bank gave Hamilton). The scenario names the one figure that would
  move it up a level.
- The implementation plan for a tested price (Simulate, `hamilton/implementation-plan.ts`):
  notice (Reg DD / NCUA Part 707 30 days for an adverse change, Reg E 21 days for EFT
  fees, the overdraft opt-in notice), approvals, systems, earliest effective date and
  monitoring. The compliance caveat is always shown.
- An opinion is given only when the reader explicitly asks, after they pick the
  objective (revenue, customer treatment or competitive position), and it names that
  objective.
- The Ask bar is `POST /api/hamilton/ask` (`ask-service.ts`, pure logic in
  `workspace/ask.ts`). It returns `{kind, shortAnswer, pageChange, answer?, scenario?,
  opinion?, question?, savedFact?, decisionId}` with kinds research, scenario, saved_fact,
  deliverable_draft, opinion and clarifying_question. A reply to Hamilton's question is
  sent back as `answer: {fieldKey, value}` and saved to memory. Each exchange is logged to
  the fee's open decision (question_asked, scenario_tested, answer_given); a remembered
  objective holds until the reader gives another. The Ask answer itself makes no provider
  calls. What a question is about is read one way for the Ask bar, the memo and the answer
  eval (`resolveAskIntent`, #1077): a fee it names (or the open decision's fee), else the
  whole-schedule overview or the fee-income answer when it asks for one. A question that is
  none of these keeps no fee: Hamilton never answers it for a fee the reader did not name (it
  once answered such segment questions for overdraft).
- The written memo over that answer is a separate, paid route: `POST
  /api/hamilton/ask/memo` (`answerAskMemo` in `ask-service.ts`, `hamilton/memo.ts`),
  premium or admin only. It takes the same body as the Ask bar (plus an optional
  `savedAnalysisId`) and rebuilds the storyline on the server, never from the browser. Each
  memo model call logs one `research_usage` row (agent `hamilton-memo`), so memos count in
  the daily Pro quota (`hamilton/quota.ts`). When that count cannot be read, the quota fails
  closed: a capped reader makes no paid call; a team seat with no cap stays allowed. Memo
  spend has its own route id and budget line, `api.hamilton.ask.memo` (`MEMO_ROUTE_ID`).
  It returns `written`, `withheld` or `unavailable`, and logs a Pro request (`ask_memo`).
- Every fee answer plays four roles (James, 2026-10-06): Inquisitive Economist, Rigorous
  Consultant, Artistic Data Engineer, Technical yet Clear Writer. `buildFeeAnswer`
  (`workspace/answer.ts`) returns `HamiltonAnswer {headline, claims, drivers, exhibit,
  question, evidenceLevel, provenance}`; `evaluateFourRoles` (`workspace/four-roles.ts`)
  checks an answer against all four, and the chat prompt carries `HAMILTON_ROLES`.
- The answer eval on live data (`hamilton/answer-eval.ts`, step `hamilton-answer-eval`,
  cron every two hours, `/api/admin/crew/answer-eval`) asks the quality-bar questions of a fresh spread
  of real banks and credit unions (two per charter and asset tier) through the Ask path,
  scores each with the quality bar and four-roles eval, and checks that a regulation answer
  names the institution's own regulator, lists the Regulatory Wire's recent items for it when
  the Wire holds any (`wireFailures`, #1090), and a state question names its state. Read-only, no
  provider calls; the step detail lists the weakest questions and the commonest failures.
  A run stops at its time budget, so each run asks the day's sampled institutions that no earlier
  run reached today first (`institutionsAskedToday`), and the day's runs together cover the sample (#1076).
  It first replays the questions Pro readers really asked in the last 90 days (the `pro.ask`
  ledger keeps each question and short answer; saved analyses keep the rest) through today's
  engine. `detail.pro` counts how many meet the bar and how many Hamilton still asks back on,
  and lists every one that falls short. A replayed answer about a fee the question did not
  ask about fails as "answers a different subject" (`offSubjectFailure`). Questions stay in our own database only.
- The paid answer eval (`hamilton/paid-answer-eval.ts`, provider step `hamilton-paid-answer-eval`,
  cron once a day, `/api/admin/crew/answer-eval-paid`, #1079) writes at most five memos a day
  (James, 2026-10-15) over free answers that carry a storyline: Pro readers' questions first, then
  quality-bar questions for sampled institutions. Form is "the memo was written" (it passed the
  memo's own checks); correctness is `reconcileMemoText`: the answer's values tie to live
  `published_fee_catalog` rows and every dollar figure in the memo ties to a live value. Each
  sample is reserved before its first model call (a `paid_eval.sample_reserved` run event, a
  conditional insert outside the step transaction that refuses past five today), so blocked calls,
  lost usage rows and killed functions still count; the provider stop and each path's budget line
  (`api.hamilton.ask.memo`, `api.hamilton.simulate`, `api.research.hamilton`, `api.reports.generate`)
  hold every call.
  One of the five (when unused today) is a Simulate read (`hamilton/simulate-read.ts`, the same
  prompt the `/api/hamilton/simulate` route streams): the first sampled answer's fee is tested at
  the median of the first peer layer with a full band, in the order local, state, charter and size,
  Fed district, national (or $5 above a fee already there). Form
  is the shared evidence gate (`checkAnswerEvidence`: every figure traces to the numbers given, no
  advice); correctness, for a read that passed form and states a figure, is `reconcileSimulateText` over
  the same live rows: the read's own figures only, with the tested price as an anchor (so a gap from
  it ties) and the bank's current fee held to its live row (#1414). Reservations
  carry their path and are taken under the day's advisory lock, so a day holds at most one Simulate,
  one written answer and one report, and never more than five samples, even when two runs overlap
  (#1414, #1418).
  One more (when unused today) is a written answer (`hamilton/written-answer-read.ts`, the same
  prompt, tools, output cap and step limit as `/api/research/hamilton` on the Analyze screen,
  Pricing focus, the sampled institution as the reader's own), on the first sampled question with
  research, with no saved peer set; the call stops at 180 s and the ledger records every step's
  tokens. Form is the route's evidence gate (`writtenAnswerCheck`, which also counts a figure the
  typed question names, and an asset-tier bound stated as a size range or threshold, as traced: #1425); correctness, for an answer that
  passed form and states a figure, is `reconcileWrittenText`: each dollar figure in the text is a
  live value, recomputed statistic or gap for the asked fee, or money its tools read from sources
  other than the fee catalog (call reports, national data). A fee price a catalog tool returned
  still has to match the live catalog.
  One more (when unused today) is a report's answer page (`hamilton/report-answer-read.ts`): the
  Reports screen's own inputs (`hamilton/report-inputs.ts`, shared with `reports/actions.ts`) for
  the first one or two answered institutions the screen would write a paid report for, Peer
  Benchmarking template, last three months, no reader or saved peer group. Only the first verified
  draft is written (up to two calls; the live report's one partner-review rewrite would not fit
  the run), so its form rate is a floor: form is the figure check plus the partner review;
  correctness re-reads the page's fee comparison the way the screen does and checks each verified
  fee the page names still has the bank's amount and peer median it was given. It catches a page
  built on values the catalog no longer holds, not a figure put on the wrong fee inside the page.
  The screen's defaults apply (consulting tone, balanced goal, provisional-first). Nothing is saved.
  The goal scorecard shows "Memo (paid)", "Simulate (paid)", "Written answer (paid)" and "Report
  (paid)", each from the newest run in the window that measured it, with that run's date (#1414).
  It asks 17 questions (q26, the NSF regulation question, since #1079; q31, fee income against
  peers, and q32, what competitors in the county charge, since #1084). Every answer is also
  scored on correctness (`hamilton/answer-correctness.ts`, the `report-reconciliation` check for
  one answer): the bank's own value and every peer, layer and local-competitor value is its
  live value in `published_fee_catalog` under the statistics contract, each printed median and
  quartile recomputes from those values within a cent, and every dollar figure in a sentence
  sourced to the catalog is one of those values or the gap between two. `detail.correctness`
  and `detail.pro.correctness` count checked and correct answers; the goal scorecard shows the
  latest eval's form and correctness rates per path (`goal.hamilton_answer_eval_latest`). Not yet
  checked: percentages and counts, and the whole-schedule overview's peer medians (accepted as
  printed). The paid paths (written answer, memo, simulate, reports) are not sampled until James
  sets a daily provider budget for it.
- The Pro written answer (`/api/research/hamilton`, tools in `research/agents.ts`) reads, among
  its read-only tools, `getLocalCompetitors` (shared with chat, `research/tool-local-competitors.ts`),
  `queryFeeRevenueCorrelation` (its `peers` view compares one institution's service charge
  income with a peer group's median on the same quarter and filer, `research/fee-income-peers.ts`),
  `queryDistrictData` and `queryStateData` (#1084). The reader's saved default peer set
  (`getActivePeerSet`) is in its prompt; the answer's identity snapshot names it as the peer
  baseline only when a tool call used it (the `peers` view with the set's filters).
- The bank's own numbers arrive by answer or upload. `POST /api/hamilton/uploads` reads a
  CSV or XLSX (fee income, item counts, waivers, affected accounts by GL line) and returns
  what was read; unmatched lines are listed, never guessed, and the file is not stored.
  Nothing is used until `POST /api/hamilton/uploads/apply`, which saves the figures to
  memory with the upload named as their source.
- The ledger (`GET /api/hamilton/decisions`, `/pro/monitor`) lists decisions and where each
  stands; the five deliverables are built from them. Recording the amount management chose,
  its implementation plan, its dollar effect and the watches that would reopen it were built
  but never reachable from Pro, and were removed (#1083, James 2026-10-15). The
  `hamilton_decisions` columns `chosen_amount`, `chosen_by` and `watch_conditions` stay in the
  database and are no longer read.
- The monthly briefing (`/pro/intelligence?view=institution`) shows "Since last quarter": the
  two newest copies the `briefing-refresh` step keeps in `hamilton_briefing_snapshots`,
  compared by `diffBriefings` (`getQuarterlyChanges`). With one copy it says when the first
  comparison comes.
- Decisions, their event log, client-given facts and uploads are kept in
  `hamilton_decisions`, `hamilton_decision_events`, `hamilton_institution_memory` and
  `hamilton_uploads`. A client fact is never edited in place: a new value supersedes it
  (`superseded_at`), so the history of what the bank told Hamilton survives.
- A regulation answer reads the Regulatory Wire (`workspace/wire.ts`, #1090): federal rules
  from the bank's own federal regulator and the CFPB whose tracker topics bear on the fee
  (published in the last 365 days, still open for comment, or with an effective date no more
  than 365 days back, future dates included), fee bills in its state (an action in the last two years),
  consumer-law enforcement actions by its federal regulator or against an institution in its
  state (last three years; state orders carry no subject on file, so they are left out), and
  its state regulator's fee posts from the last 365 days. The enforcement read puts the
  regulator, the state and the consumer-law test in its SQL (`CONSUMER_LAW_PG`), so its row
  limit never hides the bank's own actions (#1254). State codes are upper-cased once and
  compared upper case on both sides. One of each kind leads the storyline's watch list, each
  with its date and link; all of them sit in the research page's regulation section. Nothing
  is interpreted. OCC orders have no document link in the OCC export, so OCC lines link to the
  OCC enforcement search page.
- A state regulator's post comes from `reg_articles` but is tagged `kind: "state_post"`.
  Only federal releases (`isFederalRelease`) fill the storyline's news slot or appear in a
  watch list that is not about regulation (#1254).
- The workspace builders are deterministic and make no provider calls; the memo route
  above is the paid exception.

## Audit trail (James, 2026-10-06 00:08 UTC)

Regulatory work needs a defensible position, so nothing Hamilton produces is a black box.

- Every workspace output (Briefing, Research, Scenario, Implementation plan) carries a
  `Provenance` (`workspace/types.ts`): engine version, when it was built, evidence
  level, the peer group and its size, the newest date each data source contributed,
  every source (table or rule, with links), every assumption in plain words, and each
  client-given figure with who gave it and when.
- Each peer value names the schedule documents it was read from (`sourceDocumentIds`,
  `documentUrls`) and when it was published, so any figure can be traced to the bank's
  own document.
- Bump `WORKSPACE_ENGINE_VERSION` whenever a builder's math or wording changes, so a
  saved output names the engine that made it.
- When a decision event is saved, its provenance is saved with it, so the record shows
  what Hamilton showed at the time, not what it would show today.
- Pages show the provenance in a "How this was built" disclosure under each output, and
  deliverables carry it as an appendix.
- Never fill a gap with an invented number. A missing input stays missing and is named.

## Authority

- Hamilton publishes eligible `verified_fee_observations` into `published_fee_records` and the `published_fee_catalog` read model.
- A percentage fee (`amount_kind = 'percent'`, `rate_percent` set, amount NULL) publishes only in a
  category listed in `PERCENT_FEE_RANGES` (`src/lib/percent-fees.ts`: foreign transaction, cash
  advance, coin counting, late payment) and inside that range. It appears in `published_fee_rate_catalog`, not in
  `published_fee_catalog`, counts toward a bank's 3 fees and toward headline coverage, traces
  by its rate (`checkRateAgainstSource`), and is skipped by the rules re-check, whose free
  readers state dollar amounts only.
- Hamilton reads selected institution context, evidence policy, peer baseline metadata, financial context, Monitor signals, and refresh jobs.
- Hamilton may generate public-safe, Pro-grade, or internal/admin analysis depending on audience and access control.

## Category guard (issue #51)

- The guard checks fee names only: for the 13 report categories a name must name its
  category and not describe a different fee. Amounts are the envelopes' job
  (`darwin/envelopes.ts`, applied by Darwin and by the outlier rollback below).
- `hamilton/publish.ts` runs the category guard (`src/lib/fee-category-guard.ts`) before
  publishing; a verified row that fails it is skipped and marked `review_status =
  'rejected'` with a `category_guard:<code>` flag so it is never re-selected.
- The `category-guard` step (`hamilton/category-guard.ts`) rolls back live
  `published_fee_records` that fail the guard: soft delete only (`rolled_back_at`,
  `rolled_back_by_batch_id = category-guard-run-<id>`, `rolled_back_reason =
  category_guard:<code>: ...`), rejects their verified rows, and refreshes the fee index. Every
  publish step runs it (up to 100 rollbacks a step), so a guard change takes effect on its own;
  Atlas details -> Catalog repair still starts it by hand, and a `dry_run` run reports counts and
  samples and writes nothing.

## Required Behavior

- Use the shared Hamilton request contract: `institutionId`, `intent`, `evidencePolicy`, `audience`, and optional workspace context.
- Build institution context through `src/lib/hamilton/institution-briefing.ts`.
- Separate verified, provisional, under-review, and empty evidence states.
- Refuse generic consulting briefs when evidence is empty or too thin; return diligence/source-validation paths instead.
- Persist report/scenario metadata for evidence policy, peer baseline source/label, fallback reason, peer-set ID, and selected-institution evidence counts.
- Persist selected-institution source/source-label metadata on reports, scenarios, and watchlist rows.
- Emit publication, refresh, and fee-movement Monitor signals with canonical institution IDs.
- A fee-movement signal (which alerts watchers) carries only moves `confirmFeeChange` confirms against both pages' text: same page, same fee name, old text states the old price, new text states the new price and not the old. A re-read of the same edition or a new copy that pairs a fee with a neighbouring price is listed as `unconfirmed_movements` on the publication signal and alerts no one.
- Use `recordHamiltonMonitorSignal` for Monitor writes so source metadata preserves `evidence_policy`, `provider_call_queued`, and lineage. Provider-originated competitor/movement signals must state an explicit evidence policy and cannot silently queue provider automation.

## Publishing (publish.rules version 3)

- `hamilton/publish.ts` publishes only Darwin-verified rows (`agentic_darwin_verified`)
  with no blocking flag, a valid canonical key, a fee name, source lineage, Darwin's
  verification event id, confidence at or above the threshold (0.8 by default), and an
  amount inside the category range in `darwin/envelopes.ts`. $0 is published only when
  Darwin flagged the row `zero_fee`.
- Every published fee links to the bank's own document (#1342): a row with no source document,
  or no http(s) link from its verified row or its document, is refused (`sourceLinkSkipReason`
  in `hamilton/source-link.ts`). A stored file key alone is not a link. When the verified row has
  no URL, the fee takes its document's (`publishSourceLink`); refresh-copy does the same.
- `published_by_adversarial_event_id` holds Darwin's verification event id, the gate
  that actually ran.
- One live price per fee: when the same institution, canonical key, variant and
  frequency is published at a new amount, the prior live row is closed
  (`rolled_back_at`, `rolled_back_by_batch_id`, `rolled_back_reason = 'superseded by
  #<id>'`) and the change is written to `fee_change_records` (`increase`/`decrease`).
  Closed rows stay in `published_fee_records` as history; `published_fee_catalog` shows
  only live rows. An amount already live on any line for that fee is skipped.
- A price change is recorded only when it really happened: the same fee line (same
  normalized name) at a new amount in a newer source document (`source_documents.crawled_at`).
  Other lines of the same schedule, or differently named lines from another document,
  publish side by side with no change record. A row from an older document than a live
  line is skipped (`Older document than the live price`). When either document lists that
  name at both prices (two products or tiers), the new line publishes beside the old one
  and no change is recorded (`listsBothPrices`).
- Document age is compared only within one stream (`src/lib/agents/companion-streams.ts`):
  the main fee link with its own earlier copies, each companion page (one account's page,
  a courtesy pay PDF) with its own. A fee from Freedom Checking's page never supersedes or
  outdates Value Checking's line, or the main schedule's; it publishes beside them.
- Within a stream, only a newer copy of the same page supersedes or outdates a line
  (`feePageKey` in `page-key.ts`: host without "www.", path without dates and version
  words). A consumer schedule's price never replaces the business schedule's. Rows a
  different page superseded before 8 Oct come back through the restore bar
  (`cross-page-restore.ts`, each publish step), unless they are business-schedule fees
  beside a live consumer fee, which the business-schedule rule keeps down.
- Each publish step rolls back live fees read from companion pages Magellan retired as not
  a consumer fee page (`companion-retire.ts`, reason `companion_page_retired`, up to 500 a
  step) and rejects their verified rows, so they never publish again. Pages retired for a
  dead link keep the fees they gave.
- Insert and supersede share one SAVEPOINT; the change record, prior-row read, signals
  and guide flags each have their own, so an optional write that fails never aborts the
  run transaction.
- Every decision is written to `pipeline_attempts` (stage `publish`, fingerprint
  `verified:<fee_verified_id>`); a decided row is never selected again.
- An institution publishes only once it has at least 3 distinct fees (canonical keys)
  live or ready to publish (`HAMILTON_PUBLISH_MIN_INSTITUTION_FEES`; run param
  `publish_min_institution_fees`, 1 turns it off). It is one count with the catalog view
  (#1072): "live" is not rolled back and not quarantined (`CATALOG_DEPTH_LIVE_SQL`, the view's
  own test), and "ready" is a verified row this rule version has not decided yet (the same
  filter the selection uses), so a row already rejected at publish or taken down never makes
  a bank look deep. `publish.test.ts` reads the newest migration that defines the view and
  fails if its count drifts from this one. Thinner institutions' rows are held:
  not published and not written to `pipeline_attempts`, so they publish on the run
  where Knox's later finds bring the institution to the minimum. The step detail lists
  them as `held_thin_institutions`. The gate applies to new publishes only; it does not
  close rows already live. Readers get the same rule from `published_fee_catalog`, which
  shows a bank's live fees only while it has at least 3 distinct fees live (migration
  20270110000000): a bank that takedowns leave thinner drops off the site and returns on
  its own at 3. Agents that need every live row read `published_fee_records`.
- Batches take whole source documents (`agents/document-batch.ts`), oldest first, so a
  document's fees publish together; Darwin batches the same way. A batch can exceed the
  limit by one document.
- Dry runs read the prior live row and report the same skips, movements and supersedes
  as a real run, without writing.
- A fee line the bank removed from a newer copy of its page comes down (Newer-copy
  check below).

## Publish step order

Every `publish`, `publish-index` and `publish-context` step (`src/lib/agents/run-store.ts`)
takes the `agents.hamilton.publish` advisory lock, then runs these sweeps in this order in one
transaction. A takedown is a soft rollback (`rolled_back_at`, batch `agentic-run-<run id>`
unless named, the reason below); a dry run reports and writes nothing. Sections below give
the detail.

1. Outlier restore (`restoreOutliersNowInRange`, `outlier-rollback.ts`): brings back an
   outlier takedown whose amount is inside today's range, unless the bank already shows that
   fee at that amount. No reason written; it clears one.
2. Off-taxonomy restore (`restoreFeesNowInTaxonomy`, `off-taxonomy-rollback.ts`): brings back
   a takedown whose category is in the taxonomy today, on the same terms.
3. Taxonomy fold (`taxonomy-fold.ts`): re-files fees under the 15 retired categories; one with
   no home comes down on its second look, `taxonomy_fold:<reason>`.
4. Outlier rollback (`outlier-rollback.ts`): a positive amount outside its category range,
   `amount_outside_category_range`.
5. Off-taxonomy rollback (`off-taxonomy-rollback.ts`): a category not in the fee taxonomy,
   `category_outside_taxonomy`.
6. Limit guard (`limit-guard.ts`): a transaction limit read as a price, on its second look,
   `limit_as_fee:<reading>: <detail>`.
7. Business schedule (`business-schedule.ts`): a business-schedule fee beside a live consumer
   fee, on its second look, `business_schedule: consumer fee #<id>`.
8. Same-line duplicates (`same-line-duplicates.ts`): a fee the 9 Oct same-line re-decide
   published beside an older live line of itself, on its second look,
   `same_line_duplicate: live fee #<id>`; it comes back when the older line is no longer live.
9. Other bank's document (`other-bank-document.ts`): a fee from another institution's site,
   on first look, `other_bank_document: <host>`; a host that does not name the bank, on its
   second look, `unconfirmed_document_host: <host>`.
10. Eval verdicts (`eval-verdicts.ts`): the complete-record eval's critical rows on first look,
    `eval_critical:<verdict>`; the name rules learned from them (a rebate as an ATM fee, a
    "no fee for" or waiver sentence as a $0 fee, and others) on their second look,
    `not_a_fee:<rule>`.
10b. Account type hold (`account-type-hold.ts`, #1100 gap 1, James Oct 16): monthly maintenance
    is the consumer checking account's fee. A live monthly maintenance fee of a savings, money
    market, club, business or IRA/HSA/CD account (`accountTypeOf` in `src/lib/account-type.ts`:
    the fee's name when it says checking, then the lineup product, then the fee's name; a
    disclosure title such as "Truth in Savings", a perk such as "Health Savings Card" and the
    bank's own name name no account) comes down, `account_type_hold: <type> (#1100)`, and
    its verified row stays verified with `account_type:<type>`; publish skips a flagged row
    (`publishSkipReason`). A verified, unpublished row of such an account is flagged before
    publish reads it. A row the guard refused only for its account words goes back to verified,
    held, when it passes every check with those words set aside and traces in its own text;
    otherwise it stays rejected with the flag. A checked row with no type and a lineup
    product gets `account_type_checked:v1` and is not read again; a row with no product is read
    again on every step, since a later Knox read can fill its product. One event per run names every row.
    A fee a hand check found wrongly typed stays live through `ACCOUNT_TYPE_KEEP_LIVE` (one line per
    fee with its reason; 28834 first).
    A failed read or write writes nothing; the error is kept in `detail.account_type_hold.error`
    and as a `step.warning` run event.
10a. Hand fixes James approved, fixed lists checked against the live row before each write:
    `hand-amount-corrections.ts` (#1334, cut cents corrected in place) and
    `cut-name-duplicates.ts` (#1196): a cut-name row that repeats a clean live row at the same
    institution, category and price comes down while the clean row is still live,
    `cut_name_duplicate: live fee #<kept id>`, and its verified row is rejected
    (`hand_rejected:cut_name_duplicate`). Each run that changes a row writes one event naming them.
    `hand-takedowns.ts` (James, Oct 16, DECISIONS.md): up to about 25 live fees, each confirmed
    wrong on amount or category against its bank's own stored text and checked by a reviewer, as
    one entry each (first: #1496's two fax fees). A row comes down only while it still reads as
    listed (institution, category, name, price), checked in the read and again in the `UPDATE`,
    with the entry's reason (`source_mismatch: #<issue>`); its verified row is rejected
    (`hand_rejected:hand_takedown`), a feedback row and one run event name it, and a ledger line
    goes on #1026. In both lists a failed read or write never fails the publish: the step detail
    carries its `error` and the run gets a `step.warning` event.
11. Article page (`article-page.ts`): a fee read from an article, on its second look,
    `article_page: #<document id>`.
12. Product page (`product-page.ts`): a $0 benefit bullet Knox's free reader took from a
    product page, on its second look while `PRODUCT_PAGE_TAKEDOWN_ON` (on since 9 Oct),
    `product_page: #<document id>`. The address rule is the one Magellan and Rosetta use
    (`isProductPageUrl`, `learning/fee-page.ts`, #1053): services, rates and cost pages are
    no longer product pages.
12a. Product page against the schedule (`product-page-conflict.ts`, James 2026-10-13): a live
    dollar fee from a product page whose bank's schedule documents list the same category only
    at other prices; the schedule wins. Per-account and multi-item categories are left out
    (`PER_ACCOUNT_CATEGORIES`). Off (`PRODUCT_PAGE_CONFLICT_LIVE`): first looks are logged and
    nothing comes down until a hand check of 10 finds 9 right; then a PR turns it on and a
    conflict comes down on its second look, `product_page_conflict: #<doc> at $x vs schedule $y`.
    A tier's own schedule (premium, private-banking, BankOn: Darwin's `tier-perk.ts` address and
    name tests) is not the bank's schedule and is left off the schedule side (#1397); a pending
    flag the check no longer raises on a live fee is cleared (`takedown_cleared`).
13. Cross-page conflict (`cross-page-conflict.ts`): one product priced differently on two
    current pages (or two editions of one document); the older one comes down on its second
    look, `cross_page_conflict: #<older doc> older than #<newer doc> (fee <id>)` (or `older
    edition of`).
14. Category guard (`category-guard.ts`): a name that contradicts its category, up to 100 a
    step, batch `category-guard-run-<run id>`, `category_guard:<code>: <reason>`; it also
    re-files a live fee under the type its name names.
15. Guard requeue (`guard-requeue.ts`): a verified row the guard rejected at publish and never
    published is re-read once per guard version; one today's guard passes goes back to
    verified (flag `category_guard_requeued:g<version>`). No rollback.
16. Companion retire (`companion-retire.ts`): fees from companion pages Magellan retired as not
    a consumer fee page, `companion_page_retired`.
17. Duplicate collapse (`duplicate-collapse.ts`): exact repeats of a live row,
    `duplicate of #<kept id>`. Near-name repeats (#1302) are live since 2026-10-15
    (`NEAR_NAME_COLLAPSE_LIVE`): reported in step detail `near_name_collapse` and closed as
    `duplicate of #<kept id> (near name)`.
18. Frequency fill (`frequency-fill.ts`): sets a live fee's frequency from its own schedule row
    (fills a blank, corrects or clears one read from another fee's row), logged to
    `pipeline_feedback` (check `hamilton.frequency_fill`). v11 (#1196): an NSF or overdraft fee
    stored as monthly is checked against its own line (`perEventPeriodCheck`);
    an overdraft program the bank sells by the month keeps its period, a period the fee's own
    price states ("NSF | $23.00/Month") is held, `frequency_hold: <why>`, and any other period is
    cleared. A hold is the only rollback; clearing `rolled_back_at` restores it. #1196 (Oct 14,
    no version change): a blank NSF fee is never filled with a period (`perEventFrequency`), so
    the fill no longer sets "monthly" that the v11 check clears on the next pass (5 live NSF fees
    went round that loop on Oct 14). v12 (#1301): NSF fees stored as annual or daily are checked
    too. v13 (#1339): NSF, overdraft and returned-item fees are per item (James, Oct 15), so an
    overdraft or `deposited_item_return` fee stored as monthly, annual, quarterly or daily goes
    through the same check; a daily cap ("Max 4 per day", "6 per day") or a waiver is not the
    fee's frequency. A continuous overdraft fee stored by the month or year takes daily when its
    own words say daily, keeps a period the words after its price state, else is cleared
    (`continuousOverdraftPeriodCheck`). A blank monthly-maintenance fee takes monthly only when
    its own name or line says month or "per statement cycle" (`maintenanceMonthlyFill`).
    v14 (#1339): every value the fill writes, blank or stated, must be one its own per-event
    check keeps, so a correction is a fixed point (v13's per_item and daily corrections were
    written back two minutes later by the next pass). Feedback keys name the version
    (`hamilton.frequency_fill:v<N>:fix:<id>:<from>:<to>`), because `pipeline_feedback` upserts
    on its key and an old key was silently overwritten. The excerpt is read from
    `COALESCE(extraction_note, conditions)`.
    Overdraft plan hold (#1360, no version change, `OVERDRAFT_PLAN_HOLD_LIVE` off): an overdraft
    program the keep above leaves monthly was, in every case checked on the bank's own page, an
    optional plan, not the overdraft fee. With the switch on it is held (`frequency_hold: an
    optional overdraft plan ...`) when its bank has another live overdraft fee charged per item
    (or blank) above $0; a bank's only overdraft row keeps it (92746, James's call). Off, each step
    lists them in `frequency_plan_would_hold`. Oct 16 dry run: 1 (Selco's 143753, $10 a month,
    beside its $25 per-item Courtesy Pay).
19. Newer-copy check (`newer-copy-retire.ts`): a fee line gone from a newer copy of its page,
    `newer_copy_drops_fee:#<newer document id>` (`NEWER_COPY_RETIRE_LIVE` is true; false makes
    it a shadow run).
20. Identical copy (`moveRowsToIdenticalCopy`, `refresh-copy.ts`): when the current copy's
    text is identical to the superseded one, the superseded copy's fee rows move to it. No fee
    is published or taken down.
21. Refresh copy (`refreshFeesFromCurrentCopy`, `refresh-copy.ts`): a live fee the current copy
    states at the same amount moves to that copy in place (v2, #1068): the live row takes the
    current copy's verified row as its lineage and keeps its id, name and published date. Before
    v2 a new row was written and the old one closed as `refreshed by #<new id>`.
22. Current-copy check (`current-copy.ts`): a fee the current copy no longer states, on its
    second look (confirmations off while `CURRENT_COPY_CONFIRM_LIVE` is false),
    `not_on_current_copy:#<current document id>`.
23. Rules re-check (`rules-recheck.ts`, state-lane or single-institution steps only): a Knox
    fee today's rules no longer read from its text, on its second look,
    `rules_recheck_unreproduced`; it also restores its own past takedowns.
24. Name retidy (`retidyLiveFeeNames`, `knox/name-retidy.ts`): a run-on live name takes its
    tidy name, up to 100 banks a step; the old name is a `name_retidied` feedback row. No
    rollback.
25. Account names (`account-names.ts`): a live "Monthly Service Fee" takes the account heading
    above it, up to 40 banks a step (`name_account_added` feedback row). No rollback.
26. Lineup correct (`correctStoredLineups`, `knox/lineup-correct.ts`): lineup values stored
    before Knox v55 that came from a neighbouring account are corrected from the stored text,
    up to 200 documents a step (`lineup_corrected` feedback row). No rollback.
27. Restore re-check (`restore-recheck.ts`): fees an older re-check restored with no check get
    the restore bar; one that fails comes down on its second look,
    `rules_recheck_restore: <bar reason>`. Then the lost re-check restore
    (`lost-recheck-restore.ts`, #1071): a fee the re-check took down on Oct 5-11, before #1022,
    with no live row at its institution, category and amount is judged once by the restore bar
    on its document's newest text, up to 300 a step. One that passes comes back (flag
    `rules_recheck_restored:lost_restore`) and its bank is due for the source check; one that
    fails or has no text stays down. Every judged row is flagged `lost_recheck_restore_judged`.
28. Change pairing (`change-pairing.ts`): older `fee_change_records` get their two rows and
    `like_for_like`, up to 500 a step. No rollback.
29. Cross-page restore (`cross-page-restore.ts`): a fee another page's price superseded comes
    back over the restore bar (flag `cross_page_supersede_restored`).
30. Publish (`runHamiltonPublish`, `publish.ts`): the rules above; a prior live row at a new
    price closes as `superseded by #<id>`.
31. Source check (`takeDownUntraceableFees`, `source-check.ts`): up to 120 institutions,
    `source_check_untraceable:<reason>`; restores earlier takedowns that now trace, except those on `SOURCE_CHECK_KEPT_DOWN` (each with its issue, logged as `kept_down`; 36542, #1369).
32. Imported twins (`linkImportedFeesToTwins`, `source-check.ts`): an imported live fee with no
    document is pointed at its twin row that has one, up to 100 a step. No rollback.
33. Feedback sync (`syncPipelineFeedback`, `learning/feedback-sync.ts`): this step's takedowns
    and restores go into the shared learning store.
34. Index refresh (`refreshFeeIndexCache`): not on a dry run; forced when the step published,
    took down or restored fees, folded or re-filed a category, or set a frequency.

## Newer-copy check

Magellan stores each changed fetch of a page as a new `source_documents` row (same
institution and URL). Every publish step, `newer-copy-retire.ts` takes up to 25 older
documents that still have live fees and a newer, different copy Rosetta has read, and
checks each fee against the newest copy (`newerCopyVerdict`). A fee is retired only when
the reader finds it in the older copy, finds no row naming it in the newer copy, and
neither its name, nor the words of its older row, nor its non-generic name words appear
anywhere in the newer copy; a newer copy that only glues rows together or drops the price
column keeps its fees. Nothing is retired unless the newer copy still states at least half
(and at least 2) of the older copy's fees, so a navigation page or redesign retires
nothing. Retired rows get `rolled_back_reason = 'newer_copy_drops_fee:#<newer document
id>'` and the run's batch id, and their verified row is rejected; a later copy that states
the fee again restores it. Fees still named at a new price stay live: the price change
belongs to the publish step once Knox reads the newer copy. Each pair is checked once
(attempt log, stage `publish`, strategy `hamilton.newer_copy_check`, fingerprint
`v1:<older>:<newer>`). The shared learning store skips these takedowns, since the bank
changed the page and Knox and Darwin read the older copy correctly.
`NEWER_COPY_RETIRE_LIVE = false` turns the check into a shadow run that only logs.

## Current-copy check

`current-copy.ts` (`secondLookFeesNotOnCurrentCopy`, after `refresh-copy.ts` in each publish
step) takes the live fees still on a superseded copy of their page that the current copy has
no verified row for (2,784 of 9,816 such fees, 7 Oct). Each is read against the current copy's
text with `newerCopyVerdict`. A fee the current copy restates stays live. A fee it names at
another price, or no longer carries, gets a first look under check `hamilton.current_copy` and
comes down only on its second look, archived as `not_on_current_copy:#<current document id>`
with its verified row rejected. A fee the older copy's own text does not state is never
judged, and neither is a current copy that restates fewer than half (or fewer than two) of the
older copy's fees. The feedback sync records no lesson against Knox or Darwin for these.
`CURRENT_COPY_CONFIRM_LIVE` stays false (first looks only) until a hand check of 20 flags
finds at least 18 really stale. The first hand check (7 Oct, 19:00 UTC) found 14 of 20 first
looks still stated on the current page, in layouts the verdict missed (a name over its price,
one price of several on a row) or at $0 ("FREE"). The verdict (`currentCopyVerdict`) now
counts a fee as stated when the current page follows a piece of its name with its price
(`priceFollowsName`) or the shared source check traces it, and never judges a $0 row.
Confirmations stay off until a new hand check passes. `refresh-copy.ts` moves up to 1,000
fees a step.

## Outlier Rollback

Before each publish step, `outlier-rollback.ts` rolls back live `published_fee_records`
rows whose positive amount is outside the Darwin range for their category
(`darwin/envelopes.ts`): `rolled_back_reason = 'amount_outside_category_range'`, the run's
batch id, and a `hamilton.outliers_rolled_back` run event. Explicit $0 fees are left alone.
Clearing `rolled_back_at` restores a row a human confirms is real; widen its range in the
same change so the next run does not roll it back again.

## Limit Guard

Each publish step, `limit-guard.ts` rolls back live dollar fees whose figure is a transaction
limit, not a price (`rolled_back_reason = 'limit_as_fee:<reading>: <detail>'`, the run's batch
id, a `hamilton.limit_guard_rolled_back` event), and `publishSkipReason` refuses new ones. Only
figures of $100 or more, read three ways: the name ends on the limit ("Bill Payment Limits (per
24 Hours)", "the limit is"); Knox's excerpt puts limit wording next to the figure ("$2,500
Limit", "($500 Maximum)", "($2,000 daily"); or the figure is $250 or more in a category whose
schedules print transfer and load limits (Zelle, mobile deposit, bill pay, cash advance, gift
card, prepaid reload). Over-limit fees are fees and are never matched; a daily cap category is a
limit by design, so only a name that caps no fee counts there. First dry run (7 Oct, prod): 22
live fees, all transfer, deposit or load limits.

A live fee comes down only on its second look (`second-look.ts`, check `hamilton.limit_guard`):
its first failure is logged `takedown_pending` in `pipeline_feedback`, and it comes down when the
guard fails it again on another run at least 12 hours later; a fee that passes in between is
logged `takedown_cleared`. A limit takedown the current guard no longer fails comes back each step
(`restorePassingLimitTakedowns`), unless the bank already has the same fee live, with a
`hamilton.limit_guard_restored` event and the source check's restore marker.

## Business Schedule

Each publish step, `business-schedule.ts` looks at live fees read from a business-only document
(the address names business, commercial, corporate or treasury and not personal or consumer, as
`isBusinessOnlyLink`). A business fee beside a live consumer fee of the same bank and category
comes down on its second look (check `hamilton.business_schedule`): `rolled_back_reason =
'business_schedule: consumer fee #<id>'`, the verified row rejected with the `business_schedule`
flag. A business fee with no consumer fee beside it stays live until Magellan finds the consumer
schedule. The lesson is Magellan's: one `wrong_document` row per document (stage discover); the
feedback sync writes no Knox or Darwin lesson for these. A takedown whose consumer fee is no
longer live comes back. First dry run (7 Oct, prod): 1,028 business-sourced live fees at 91
banks, 61 beside a consumer fee.

## Other Bank's Document
Each publish step, `other-bank-document.ts` looks at live fees read from a document on another
institution's own website (its host is another bank's `website_url` host and not this bank's,
`magellan/other-bank-host.ts`). Such a fee comes down on the first run that sees it, its first
look logged (check `hamilton.other_bank_document`; James, Oct 8: no 12-hour wait), unless the document's text names this bank's own website or
city: `rolled_back_reason = 'other_bank_document: <host>'`, the verified row rejected with the
`other_bank_document` flag, the link added to the bank's rejected sources and cleared from its
fee link (unless a correction locked it), and one Magellan `wrong_document` lesson per document.
First dry run (8 Oct, prod): 323 live fees at 16 banks; 308 at 15 banks fail (Peoples Bank of
Rock Valley IA showed Peoples Bank of Bellingham WA's 22 fees).

The same step also checks documents on a host that is neither this bank's website nor another
institution's (check `hamilton.unconfirmed_document_host`, admin audit Oct 9). A shared file
host (`SHARED_CONTENT_HOST_PATTERN`), a host sharing the website's name, a link a person locked by
correction, or a text naming the bank's website, its name, its city or the bank's own name all
pass. The rest go through the 12-hour second look and then come down the same way, with
`unconfirmed_document_host: <host>`, the `unconfirmed_document_host` flag and failure reason
`magellan_unconfirmed_document_host`. First dry run (9 Oct, prod): 1,894 live fees on such hosts,
277 at 17 banks failing.

## Article Page

`article-page.ts`: a page whose address has an article segment (articles, blog, stories,
news) and does not name a schedule is an article (`isArticlePage`). Its prices are national
averages or examples, not the bank's price: Space Coast CU's $4.73 ATM fee came from a blog
post (its schedule says $2.50). Publish never puts such a row live; a live one comes down only
on its second look (check `hamilton.article_page`), archived as `article_page: #<document id>`,
with the lesson going to Magellan. MTC Federal CU's real schedule, /articles/schedule-of-fees/,
is not an article.

**Qualifier pairs, check 4 (#1314, Oct 15).** `linesApartOnPage` keeps two names apart only when the
shorter one is printed at the price clear of every place of the longer: a shorter name found only
inside the longer lines ("Funds (NSF)" in "Non-Sufficient Funds (NSF) $25", "Order" under a "Money
Order" heading) or one line printed twice ("Less than Minimum Balance Fee $10.00/year", twice) is
one fee. The words between a name and its price never run through "of" or a deposit label ("Monthly
Fee $0 Initial Deposit $10"; other labels such as "Minimum Balance" are not yet guarded) or stop on
the first digits of a larger amount ("$10,000" is not $10). An identical skip decided before check 4
beside a live line of its own document whose name is its name with one or two qualifier words in
front, or the other way round, is decided again (`QUALIFIER_RESELECT_SQL`; James on Oct 15: "ACH
stop payment could be a second fee"). The page check decides; the SQL only narrows the rows. A
re-decided row's wide identical check reads its own document's lines and another document's line
only under the same name (an older crawl of the same schedule); another document's line under
another name is a different printed line.

## Duplicate Collapse

Before each publish step, `duplicate-collapse.ts` closes live rows that repeat another
live row exactly (same institution, canonical key, variant, frequency, amount and fee
name). The newest copy stays live; the others get `rolled_back_reason = 'duplicate of
#<kept id>'`, the run's batch id, and a `hamilton.duplicates_collapsed` run event. Rows
that differ in name or amount are separate fee lines and are left alone.

**Near names (#1302).** Two live rows of one document, category, variant and amount whose names
differ only by punctuation, case, a plural, a leading article or a trailing "fee" ("Stop
Payment" / "Stop Payment ......", "Cashier's Check" / "Cashier’s Check"), or by one qualifier word
in front ("Research fee" / "Account Research fee"), are one fee only when the page says so:
`linesApartOnPage` must find no two printed lines at the price (the same check the publish step
uses, #1303), and at least one name must be printed with the price. Frequencies and audiences
must agree or be unstated. The copy kept states its audience, then its frequency, then is the
one printed at the price, then is newest. Doc 14695 prints "Stop Payments, each ... $35" and
"Stop Payment, each ... $35" in two copies of its schedule, so both stay. A fee the page prints
once under its personal schedule heading and once under its business one stays two fees too
(`printedInPersonalAndBusinessSchedules`; Valley's doc 23731, "Visa® Gift Cards, each: $4.25.").
This sweep reads up to 25 documents' stored text per step. James turned
`NEAR_NAME_COLLAPSE_LIVE` on on 2026-10-15: each step reports `near_name_collapse` (pairs, apart
on page, not printed, no text, would close, samples) and closes the repeats. Rollback: clear
`rolled_back_at` on rows whose `rolled_back_reason` ends in `(near name)`.

**Page copies (#1439, shadow).** One schedule stored under several addresses ("?print=1", "www.",
"%20", a mirror) is several documents, so a line of it went live once per copy.
`page-copy-collapse.ts` groups live rows of one institution, category, variant and exact amount
read from different documents of one page (`feePageKey`) under the same or a near name. It never
keeps a replaced copy (`superseded_by_id` set) when the copy that replaced it, or a current copy of
the same address, is in the group; a replaced copy of one address is not ranked below a current copy of another, which may be
an older edition. Then it keeps the latest edition: by the
editions the texts state when every copy in the group states one (the latest "effective" date not
after the read, so an announced change does not count), else by when each was last read or
re-confirmed (`GREATEST(last_checked_at, crawled_at)`); equal editions fall to the later read. The
kept document's stored text must print the kept name at the price, and the two documents must print
mostly the same prices (distinct dollar amounts overlapping at 0.8 or more, `sameScheduleText`),
since `feePageKey` keys "?id=101" and "?id=202" alike. Prices survive a two-column PDF read in
another order ("$ | 30.00"); a fee-change letter or a "popular fees" page stays apart. Two
documents for different audiences are never copies: the audience named in the URL path or query
(camel case split), else the one the text keeps naming (three or more mentions and three times the
other, "business day" not counted, so a menu or footer link decides nothing). A pair the kept text
prints as two lines, or under both a personal and a business heading, stays two fees. Frequencies
and audiences must agree or be unstated. A row read from a copy that a newer copy replaced (`superseded_by_id`
names the kept row's document) pairs with the kept row under another name that shares a word
(#1348): the newer copy reading "Temporary checks" as "Temporary checks (sheet of 3 checks)" is one
line, and closes on the same tests unless the newer copy prints both names as lines of their own. A
line the newer copy dropped ("Money Order" beside "Temporary checks") shares no word and never
pairs; a box size counts as a word ("Safe Deposit Box - 3x5" / "3 x 5"), and two names that each
give a size must share one ("Safe Deposit Box - 3x10" / "Safe Deposit Box 3 x 5" never pair). A partner of the same name is taken first, then a near name, then a renamed one. `renamed`
in the step detail counts these pairs, closed or kept, and `renamed_samples` lists those that close. Up to 25 institutions per step, picked by the run id; each
step reports `page_copy_collapse` (live, institutions, pairs, apart on page, unproven, other
document, renamed, would close, samples, and `error` when the read or the close failed). `PAGE_COPY_COLLAPSE_LIVE` stays
off until James approves the dry-run counts. Rollback: clear `rolled_back_at` on rows whose reason
ends in `(copy of the page)`. A closed copy is not restored if its kept copy later comes down; like
the other collapses, that is a gap to close before this goes live.

**At publish (#1069 step 1, shadow).** Each row the publish step is about to publish is checked
against its live copies with the exact collapse's own test (`exact-duplicate.ts`: institution,
category, variant, value and name; frequency classes that agree; the copy kept states its
audience, then its frequency, then is newest). A row the collapse would close is counted as
`would_refuse`, and a row it would keep, closing the older copy, as `would_replace`. Both are
reported in the step's `publish_duplicate_check`, with `closed_by_late_collapse` for agreement.
While `PUBLISH_REFUSE_DUPLICATES_LIVE` is false nothing is refused; turning it on (skip reason
`Exact duplicate of live fee #<id>`) needs James's OK.

**At publish (#1069 step 2, shadow).** The rows a publish step is about to decide are read, once
per batch, with three sweeps' own SQL in their `"verified"` scope (`publish-sweep-rules.ts`):
another bank's document (`otherBankFeesSql`), an unconfirmed host that does not name the bank
(`unconfirmedHostFeesSql`), and a business schedule's fee beside the bank's live consumer fee in
its category (`businessScheduleFeesSql`; a footnote-only business fee stays the sweep's, since it
needs the page read). The sweeps and publish share one builder per rule, so they cannot disagree;
the sweeps stay the live re-check and this check takes nothing down. A row a sweep would take down
is counted in the step's `publish_sweep_check` (`would_refuse`, `by_rule`, samples, and `error`
when a read failed; a failed read refuses nothing). While `PUBLISH_REFUSE_SWEEP_RULES_LIVE` is
false nothing is refused; turning it on (skip reason `Refused at publish, a sweep would take it
down: <the sweep's reason>`) needs James's OK.

## Rules Re-check

In state-lane (or single-institution) publish steps, `rules-recheck.ts` re-runs Knox's
free team (`runFreeSpecialists` plus Darwin's rule checks) on the text each live Knox
fee came from. A fee comes down only for that same text: when it is gone, the fee stays
live and the source check judges the document's newer text (step detail `kept_text_gone`).
Before a fee comes down, a second look must fail too: the fee's name and price no longer
trace in that text (`checkFeeAgainstSource`), or the category guard rejects its name. A fee
that passes the second look stays live (`disputed` in the attempt, `kept_disputed` in the
event) for the next Knox version to settle; one that fails carries both reasons, the
verified row's flags holding `rules_recheck_unreproduced:second_look:<verdict>`. A fee Knox
filed by its name (`knox_name_filed:`, a person's label or the store's settled name; #1102) has
no rule read to reproduce, so it passes while its name and price trace in its own text and the
guard accepts it, and is not counted as disputed.
A live fee whose category and price the current rules no longer read is rolled back
(`rolled_back_reason = 'rules_recheck_unreproduced'`, the run's batch id) and its
verified row is rejected so the next publish does not bring it back. Up to 25 documents
per step; each document is re-checked once per Knox version signature (attempt log,
stage `publish`, strategy `hamilton.rules_recheck`). Knox's paid fees and fees from
other sources are never touched; a document with no stored text keeps its fees. A
document states each fee once: of live rows with the same category and price, the
newest stays. The attempt's `missing_fees` counts fees today's rules read from the
document's latest text that are not live; Knox extracts such a text again, so a rules
fix adds what it newly reads (Texar's $20 and $35 overdraft tiers), not only removes.

The re-check also undoes its own takedowns (strategy version 2). A fee it took down comes
back (verified row too) when today's rules read it again from its text under the same name,
category and price, it still traces to that text (`checkFeeAgainstSource`), and no live fee
of the institution has that category and price. Knox cannot bring that fee back itself:
re-extracting would insert the same raw row, which the raw-row dedupe index (document, name,
price) refuses. A fee read again under a new name returns the normal way, through Darwin.
Documents whose live fees were all taken down are re-checked too. Step detail:
`rules_recheck_restores`. A fee an earlier re-check judged against a text other than its own
comes back only over the restore bar (below) judged against the document's newest text
(`newer_text`). Before 7 Oct it came back with no check (`text_gone`, 84 fees on prod);
`restore-recheck.ts` gives each of those the restore bar on its newest text: one that clears
it is marked `rules_recheck_restore_checked`; one that fails is archived on its second look
(check `hamilton.rules_recheck_restore`, reason `rules_recheck_restore: <bar reason>`, verified
row rejected, flag `rules_recheck_restore_failed`). Knox's lessons, label queue and calibration
ignore the `restored_after_takedown` rows of `text_gone` restores. Every restore here, and in the newer-copy check, leaves a
`restored:<fee id>:<run>` marker attempt under the source check's strategy
(`markRestoredForSourceCheck`), so the bank is source-checked again even though no newer
fee id appeared.

Past takedowns whose own text still states the fee (made before the second look existed)
come back only over the restore bar (`restore-guard.ts`, strategy version 4, James 7 Oct):
the second look passes, Darwin's category model files the name under the fee's own category
with probability at least 0.8 (and, for a name joined across a pipe, files its first cell
there and disputes no other cell), the text states the fee's price on its own row, and the
row is not a $0 price, a minimum balance, a refundable deposit, a limit, a markup on a cost,
a sentence cut before its figure, or a copy of an item filed as the item. Without the model
nothing comes back this way. Every restore's verified row carries
`rules_recheck_restored:<same_read|newer_text|restore_bar>` (`text_gone` on older rows), and the event counts
`restored_by_reason`.

Each read is filed under the category Darwin files it under (`refileCategory`, strategy
version 3, 2026-10-07). Before that, a fee Darwin re-filed from Knox's hint, such as First
National Bank Alaska's "Insufficient Funds Transfer (Savings Overdraft)" (hint overdraft,
filed as an overdraft protection transfer), was read under the hint, failed the category
guard there, and was taken down as unreproduced: 140 fees at 128 banks on 2026-10-07.

## Taxonomy Fold (top 50, James 2026-10-08)

`taxonomy-fold.ts` runs in the publish step after the off-taxonomy restore. It reads live
and verified fees still filed under one of the 15 categories retired from `FEE_FAMILIES`
(`RETIRED_CATEGORIES` in `src/lib/fee-fold.ts`) and re-files each by its name, and for a
bare name by the 200 characters of schedule text before it. A move happens only when the
category guard and amount envelope accept the fee in its new category
(`passesDarwinChecks`); it updates the verified and published rows and writes a
`category_fold` row to `pipeline_feedback` (check `hamilton.taxonomy_fold`, which Knox does
not learn from). A live fee no rule can place goes through `secondLook`: flagged on the
first run, and rolled back (batch `taxonomy-fold-run-<id>`, reason `taxonomy_fold:`) once
the flag is 12 hours old, while `TAXONOMY_FOLD_ARCHIVE_NO_HOME` is on. James turned it on
after seeing the list of 248 (Oct 8, "drop them"); with it off they would stay live and be
counted as `noHomeHeld`. `refileCategory` applies the same rules to new reads, so Knox can
keep hinting the retired keys. Publish skips a fee still under a retired key.

The same step applies the live splits (`SPLIT_CATEGORIES`): fees in a live category whose name
belongs to another type move there, under the same guard and range test. Fold v17 (`FOLD_RULES_VERSION`, 16 until the switch is on; James, Oct 15,
#1398: "Add both") gives excess withdrawals (`excess_withdrawal`) and returned mail
(`returned_mail`) their own types, dark until `RESEARCH_SPLIT_LIVE` is on. While it is off,
returned statements leaving paper statements, excess activity leaving other lending and the hand
re-files (21141 and 77918 renamed in place, 44516) all still go to account research, the paper
statement and e-statement rules match exactly as before (a "return to paper statements" charge
still goes to account research), and nothing moves out of it. Once on, a return to paper
statements charge is a paper statement fee, never returned mail. Every step writes a dry run of the switched split to its detail,
`taxonomy_fold.pendingResearchSplit`, over at most 2,000 rows (`RESEARCH_SPLIT_PREVIEW_LIMIT`;
`capped` when it hits the limit; the publish step's `research_split_full_count` param reads every
row for the exact count): `wouldMove` and `wouldMoveLive`, `byRoute`
(`account_research->excess_withdrawal`, `account_research->returned_mail`), the ones the new
type's guard or range would refuse (`refused`, `refusedByRoute`, which stay research), and ten
samples per route; the publish summary names the counts. Once on, account research's own excess
withdrawal and returned mail fees (`EXCESS_WITHDRAWAL`, `RETURNED_MAIL` in `fee-fold.ts`) move by
name. Account research keeps research, reconciliation, balancing, charge-off and ATM adjustment
charges.

`HAND_REFILES` in the same file re-files or renames listed live fees in place (James approved
each batch: #1299, #1304, #1196). A row moves only while it is still under its listed category
at its listed price, and a rename is done once the live name reads as listed, so a re-run
changes nothing. An in-place rename that carries an `oldName` runs only while the live name is
exactly that old name, so it runs once and never replaces a better name a later read or retidy
gave the fee. Each move writes a `pipeline_feedback` row with the old and new name, and the
run gets one `hamilton.taxonomy_fold.hand_refile` event naming every row and its after-state.

## Source Link Repair

`hamilton/source-link.ts` (#1342), step `source-link-repair`, started by hand from Atlas details
(dry run first; `runSourceLinkRepair`). Never runs on its own. A live fee with no source URL at
any tier takes its own document's `document_url` when that document is the institution's and,
when the fee carries a stored file key, the same file; the verified row takes it too. Any other
is taken down with `rolled_back_reason = 'source_link_untraceable: <why>'`. Each change writes
one `pipeline_feedback` row (check `hamilton.source_link`, kind `missing_lineage`, evidence
`action`, `from`, `to`, `verified_filled`) in the same transaction, and a
`hamilton.source_link_repair` run event. Reverse a fill by setting `source_url` back to NULL (and
the verified row's when `verified_filled`); reverse a takedown by clearing `rolled_back_at`,
`rolled_back_by_batch_id` and `rolled_back_reason`. The feedback sync skips these takedowns: the
lesson is publish's, not Knox's read. A live write that fails fails the step with
the error text and rolls its transaction back (#1349); it never reads as a completed step with 0
links. Frequency fill does the same in its own `frequency-fill` step. Inside the publish step it
runs in a savepoint (`fillFrequenciesInPublish`): a failed write undoes the fill's writes, the
publish carries on, and the error is kept in `frequency_fill_error` and a `step.warning` event.

## Source Check

Every live fee must be stated in the bank's own stored schedule. After publishing, every
publish step runs `source-check.ts` on up to 120 institutions not checked since their
newest live fee: its own state's (or institution's) first, then any state's to fill
the batch, institutions never checked first. A new strategy version (bumped whenever
the shared reader changes) re-checks every institution and restores fees an older
reader took down that now trace. Each live fee, from any source,
goes through `checkFeeAgainstSource` (`src/lib/custom-report/source-check.ts`, the same
rule the report gate uses): one row of the document names the fee and states the
amount as its price, not a limit. When one line carries several fees (a flattened
schedule), each price belongs to the words since the previous price. A Knox fee answers to its own document. An imported
fee with no usable document is relinked to another stored document of the institution
that states it. A fee that still can't be traced is taken down
(`rolled_back_reason = 'source_check_untraceable:<reason>'`, the run's batch id; clear
`rolled_back_at` to restore it) and its verified row is rejected. Fees an earlier version
took down are re-checked with their institution and restored, with their verified row,
when they now trace (version 2 restored correct fees v1 took down from flattened lines). Each pass logs a
`hamilton.source_check` event and one attempt per institution, folded into the bank's
playbook (as are the rules re-check's), so its record shows how many of its fees survive
Hamilton's checks beside how many Knox read. The scheduler tick
(`/api/admin/agents/tick`, cron every 5 minutes in `vercel.json`) runs the nationwide lane
sync once an hour, on the tick in the first 5 minutes of the hour
(`shouldRunNationwideLaneSync`). That sync wakes sleeping state lanes that still have
unchecked live fees (source check or rules re-check, `wakeLanesWithUncheckedLiveFees`), and a
woken lane with backlog runs again every 60 minutes (`STATE_LANE_BACKLOG_RETRY_MINUTES`), so a
new rule reaches every state within hours.

## Studies (James, 2026-10-07 05:03 UTC "Build it all")

Statistical studies on the joined data, stored so Hamilton can cite a result and place one
institution in it (`src/lib/agents/hamilton/studies`). One run a day
(`/api/admin/crew/studies`), one step per study; a step stores only when its data period is new.

- Tables: `hamilton_studies` (read the `is_current` row per `study_key`),
  `hamilton_study_placements` (an institution against its peers), `inferred_fee_volume`.
- `fee_dependence`: fee share of revenue every year since 2010, banks and credit unions side by
  side, never pooled (their definitions differ), closed institutions included.
- `local_income`, `market_concentration`, `fee_income_share`: price studies on live fees.
  Cross-sectional only: fee prices are a current snapshot (fee moves over time are artifacts), so
  a result describes how prices differ across institutions, never what a change would do.
- `inferred_items_paid`: reported overdraft/NSF income divided by the published fee, a range,
  always labeled inferred. Credit unions 2024 only (NCUA retired the lines); banks once RIAD H032
  loads ($1B+ banks, overdraft and NSF together).
- Nothing from a study is published on the site or sent until James says so.
- Pro readers see two studies (James, Oct 12, #1082): `fee_dependence` and `inferred_items_paid`,
  each with a note on how it was calculated (`PRO_STUDIES` in `src/lib/hamilton/workspace/studies.ts`).
  The three price studies stay stored and off every Pro surface (briefing, Ask's briefing, the
  exported brief) until reviewed: their effects are weak and a reader could take them as what a
  change would do.

## Marketing

Hamilton does not run the marketing loop. The monthly marketing steps (`marketing-score`,
`marketing-write`, `marketing-states`, `marketing-send`) run as agent `growth`
(`STEP_OWNER` in `src/lib/agents/narrate.ts`). See `src/lib/agents/growth/AGENTS.md`
and `src/lib/agents/marketing/AGENTS.md`.

## Boundaries

- Public Hamilton must be consumer-safe and cannot expose admin-only operational details.
- Pro Hamilton may provide consulting workflows, but must label provisional-first analysis and verified-only benchmark/export data.
- Internal Hamilton may expose broader operational context only behind admin/analyst access control.
- Do not rely on free-text institution names as workspace identity.

## Daily health check (contract)

`agent-health.ts` runs with the daily scoreboard step and stores these numbers in
`pipeline_scoreboard_snapshots.detail.agent_health`, next to yesterday's. A broken rule, or any
number that moved more than 25% since yesterday, is named in the scoreboard step's summary.
Change this table and `agent-health.ts` in the same PR.

| Rule | Number | Holds when |
|---|---|---|
| Steps do not fail | `stepsFailed` (24 h) | 0 |
| Hamilton's spend stays inside its daily cap | `spendUsd` vs. `agent:hamilton` `hard_daily_microusd` | ≤ cap |

Also recorded, without a rule: `stepsCompleted`, `liveFees`, `sourceChecks`, `banksNotSourceChecked` (banks whose newest live or source-check-taken-down fee the current source check has not seen).

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `ACCOUNT_NAME_STRATEGY` | `hamilton.account_names` | v1 | `hamilton/account-names.ts` |
| `CURRENT_COPY_STRATEGY` | `hamilton.current_copy_check` | v2 | `hamilton/current-copy.ts` |
| `EVAL_VERDICT_VERSION` | — | v7 | `hamilton/eval-verdicts.ts` |
| `FREQUENCY_FILL_VERSION` | — | v14 | `hamilton/frequency-fill.ts` |
| `GUARD_REQUEUE_STRATEGY` | `publish.guard_requeue` | v1 | `hamilton/guard-requeue.ts` |
| `NEWER_COPY_STRATEGY` | `hamilton.newer_copy_check` | v1 | `hamilton/newer-copy-retire.ts` |
| `HAMILTON_PUBLISH_STRATEGY` | `publish.rules` | v3 | `hamilton/publish.ts` |
| `REFRESH_COPY_STRATEGY` | `hamilton.refresh_copy` | v2 | `hamilton/refresh-copy.ts` |
| `RULES_RECHECK_STRATEGY` | `hamilton.rules_recheck` | v4 | `hamilton/rules-recheck.ts` |
| `SOURCE_CHECK_STRATEGY` | `hamilton.source_check` | v16 | `hamilton/source-check.ts` |
| `SOURCE_LINK_VERSION` | `hamilton.source_link` | v1 | `hamilton/source-link.ts` |
| `FEE_DEPENDENCE_VERSION` | — | v1 | `hamilton/studies/fee-dependence.ts` |
| `PRICE_STUDY_VERSION` | — | v1 | `hamilton/studies/index.ts` |
| `INFERRED_VOLUME_VERSION` | — | v2 | `hamilton/studies/inferred-volume.ts` |
