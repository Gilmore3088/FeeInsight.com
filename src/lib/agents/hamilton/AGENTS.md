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
- Implementation is a separate step that runs only after management chooses an amount:
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
  objective holds until the reader gives another. No provider calls.
- Every fee answer plays four roles (James, 2026-10-06): Inquisitive Economist, Rigorous
  Consultant, Artistic Data Engineer, Technical yet Clear Writer. `buildFeeAnswer`
  (`workspace/answer.ts`) returns `HamiltonAnswer {headline, claims, drivers, exhibit,
  question, evidenceLevel, provenance}`; `evaluateFourRoles` (`workspace/four-roles.ts`)
  checks an answer against all four, and the chat prompt carries `HAMILTON_ROLES`.
- The bank's own numbers arrive by answer or upload. `POST /api/hamilton/uploads` reads a
  CSV or XLSX (fee income, item counts, waivers, affected accounts by GL line) and returns
  what was read; unmatched lines are listed, never guessed, and the file is not stored.
  Nothing is used until `POST /api/hamilton/uploads/apply`, which saves the figures to
  memory with the upload named as their source.
- `POST /api/hamilton/decisions/[id]` records the amount management chose (Hamilton never
  chooses), with its implementation plan and watch conditions (a competitor change, a
  5% peer-median move, a regulator release). A watch that trips is logged once as
  `watch_tripped`. The ledger (`GET /api/hamilton/decisions`) is a sum over decisions;
  dollars count only from options chosen on institution evidence.
- Decisions, their event log, client-given facts and uploads are kept in
  `hamilton_decisions`, `hamilton_decision_events`, `hamilton_institution_memory` and
  `hamilton_uploads`. A client fact is never edited in place: a new value supersedes it
  (`superseded_at`), so the history of what the bank told Hamilton survives.
- The workspace builders are deterministic and make no provider calls.

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
- Use `recordHamiltonMonitorSignal` for Monitor writes so source metadata preserves `evidence_policy`, `provider_call_queued`, and lineage. Provider-originated competitor/movement signals must state an explicit evidence policy and cannot silently queue provider automation.

## Publishing (publish.rules version 2)

- `hamilton/publish.ts` publishes only Darwin-verified rows (`agentic_darwin_verified`)
  with no blocking flag, a valid canonical key, a fee name, source lineage, Darwin's
  verification event id, confidence at or above the threshold (0.8 by default), and an
  amount inside the category range in `darwin/envelopes.ts`. $0 is published only when
  Darwin flagged the row `zero_fee`.
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
  `publish_min_institution_fees`, 1 turns it off). Thinner institutions' rows are held:
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

## Duplicate Collapse

Before each publish step, `duplicate-collapse.ts` closes live rows that repeat another
live row exactly (same institution, canonical key, variant, frequency, amount and fee
name). The newest copy stays live; the others get `rolled_back_reason = 'duplicate of
#<kept id>'`, the run's batch id, and a `hamilton.duplicates_collapsed` run event. Rows
that differ in name or amount are separate fee lines and are left alone.

## Rules Re-check

In state-lane (or single-institution) publish steps, `rules-recheck.ts` re-runs Knox's
free team (`runFreeSpecialists` plus Darwin's rule checks) on the text each live Knox
fee came from. A fee comes down only for that same text: when it is gone, the fee stays
live and the source check judges the document's newer text (step detail `kept_text_gone`).
Before a fee comes down, a second look must fail too: the fee's name and price no longer
trace in that text (`checkFeeAgainstSource`), or the category guard rejects its name. A fee
that passes the second look stays live (`disputed` in the attempt, `kept_disputed` in the
event) for the next Knox version to settle; one that fails carries both reasons, the
verified row's flags holding `rules_recheck_unreproduced:second_look:<verdict>`.
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
also comes back. Every restore here, and in the newer-copy check, leaves a
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
`rules_recheck_restored:<same_read|text_gone|restore_bar>`, and the event counts
`restored_by_reason`.

Each read is filed under the category Darwin files it under (`refileCategory`, strategy
version 3, 2026-10-07). Before that, a fee Darwin re-filed from Knox's hint, such as First
National Bank Alaska's "Insufficient Funds Transfer (Savings Overdraft)" (hint overdraft,
filed as an overdraft protection transfer), was read under the hint, failed the category
guard there, and was taken down as unreproduced: 140 fees at 128 banks on 2026-10-07.

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
Hamilton's checks beside how many Knox read. The hourly scheduler
tick wakes sleeping state lanes that still have unchecked live fees (source check or
rules re-check), so a new rule reaches every state within hours.

## Marketing

Hamilton also runs the monthly marketing loop (score, write, draft, send on approval).
See `src/lib/agents/marketing/AGENTS.md`.

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
