# Fee audience repair: completion ledger

Owner: ChatGPT, at James's explicit request to manage implementation and release through completion.
PR: #986. Branch: `fix/pinnacle-fee-audience-integrity`.
Status: IN PROGRESS. Draft, unmerged, unreleased. No production data correction or application rollout has been performed by this repair.

This ledger records receipts, not assertions of future success. The exact source decisions and 32-row lineage table are in `2026-10-10-pinnacle-audience-repair.md`. Read fresh branch, checks and database preconditions before writing. Preserve unrelated Hamilton reliability work.

## October 10, 2026 09:05 Hong Kong continuation

- Rechecked PR #986 at head `93dca493ef733e2c76f80974ff8b8e67f18de2ef`: Actions run `38005873294` completed SUCCESS. App job `114074412199` passed guards, focused tests, TypeScript, lint, the full suite and all three ordinary pipeline E2E tests. SQL job `114074412343` passed the isolated PostgreSQL audience-migration assertions. This certifies that head only.
- `6c134e70e25dbcbab91e4f8ae2837811e4c8492b`: `derived-analytics.ts` now applies the shared sourced consumer/both statistics boundary to fee concentration. Real $0 rows remain eligible for institution prevalence while contributing $0 to dollar totals; business/unknown and unsourced rows no longer enter that population.
- `5d2baace6902dac9c9a6e6e29336a85d354b9f41`: added regressions proving the consumer/source SQL boundary is used in both concentration reads and a genuine zero-fee category still counts in prevalence. This new head requires fresh CI; no pass is claimed yet.
- Re-read `wire-fee-data.ts`: it delegates to the state/national fee indexes, which already use the statistics contract, so no duplicate SQL filter was added there.
- The existing hourly Pinnacle Release task remains enabled and has been refreshed with the new head, exact green receipt, migration-version collisions (#990/#991), #939 overlap, and remaining acceptance gates. No duplicate automation was created.
- No production database write, merge, deployment, provider activation, outreach send, permission change or branch deletion in this continuation.

## October 10, 2026 Hong Kong-time continuation: completed branch work

- Re-read root/agent instructions, CLAUDE.md, current checkpoint, PR, runbook and ledger. Initial head `6e9fd954ab632c71d8cfdf31cc75d0236ab7bc9a`, base `1b5de13cd5b2e61ff6ca64047222b6c90888d39b`. James renewed authorization; no extra permission gate was invented.
- `95417545be5f8a9a9f3a603a2cdd4bb26d556dd9` and `773d6ae01d17b9385648890484d074154f527e6f`: preserve the completion ledger at this dated path and remove the undated filename that failed the repository guard. PR pointer updated; guard unchanged.
- `de5c0fc989c4a40f52fe15ccec47be9c772c472f`: alias-safe shared consumer/source SQL boundary; statistics counts use valid priced samples; real zero retained; method version 6 and public-read cache namespace `consumer-audience-v2`. Missing, blank, negative and non-finite prices and invalid institution IDs do not manufacture sample size.
- `67aabd1b03138f457897e5e67e1e26a715221605`: consumer-eligible benchmark source links and rate comparison scope; common five-institution floor including local export median; labeled all-audience institution rates retained. Added regressions. REMOVED temporary `.github/workflows/fee-audience-review.yml`.
- `8687c2169d62c6a9aa06e5fefb471a695c805b32`: local competitors use sourced consumer/both and correct overdraft tier; local fee-move cards require a live same-audience consumer successor and non-quarantined predecessor, preserving the original like-for-like and pending-takedown controls. Added regressions.
- `6d6cc81c4039d8d5c7eba87ebb7607a59ef258c3`: market-study fee boundary and highest overdraft tier; zero remains zero, missing eligible fee data does not erase real branch/deposit membership. Added loader regressions.
- `4d20e68b416a0aa0395425fee1e85720a7753a51`: competitive report candidates require consumer/source eligibility before their existing source-text check. Kept cap, name-binding, amount/zero and takedown safeguards and geographic membership intact. Added loader regression.
- `2a97828ecda0e8309918e92b48338b7ea5c1aa1f`: public category summaries/details and guide extremes use consumer/source eligibility. A free tier plus a paid tier is not counted as an institution that charges nothing. Three public price-move readers require a live same-audience pair; audit/snapshot history remains all-audience. Added regression tests; this commit's CI must be checked.
- Re-read all 32 screening publications and both diagnosed Pinnacle publications from production. Independently attempted every source and recorded exact row decisions, conditions and missing evidence in the runbook. No blanket consumer label or guessed replacement amount.

## CI receipts

| Commit | Actions run | SQL job | Application job | Observed result |
|---|---|---|---|---|
| `6e9fd954` | 37995582941 | 114040651691 | 114040651362 | SQL passed. App failed dated-filename guard; later tests skipped. Fixed, not waived. |
| `773d6ae0` | 37996478671 | 114043747108 | 114043747350 | Both passed, including full suite and ordinary E2E. |
| `67aabd1b` | 37997681802 | 114047778760 | 114047779021 | SQL, focused tests, TS, lint and full suite passed at inspected checkpoint; E2E then in progress. Later 8687 full pass contains this code. |
| `8687c216` | 37998289976 | 114049796391 | 114049796599 | Both PASSED; guard, focused tests, TypeScript, lint, full suite and ordinary E2E all successful. |
| `4d20e68b` | 37998793604 | 114051491150 | 114051491068 | Both PASSED; guard, focused tests, TypeScript, lint, full suite and ordinary E2E all successful. |
| `2a97828e` | Fetch current run | Not yet recorded | Not yet recorded | New code commit, not yet certified at this ledger write. |

Local source was obtained from the temporary workflow's ordinary GitHub artifact for commit `1181f8bebb75c9a91f77416292a97eb31f05fbc8` (run 37993316807, artifact 11646141114), and compared against later commits. The local environment has no installed project test dependencies or PostgreSQL server. No local full-suite or local SQL success is claimed; the executed validation receipts above are GitHub CI.

## Source decision progress — not applied corrections

Runbook now contains all 32 exact publication/raw/verified/document IDs with source URLs and row-level decisions. Tally: 21 supported business-scope decisions; three supported category/amount-binding/unit corrections (Webster, Woori, NewBank interim-statement unit); three false-positive audience associations (NewBank paid item and two Lebanon purpose-restricted free services); Montecito's category remains unresolved; four sources remained inaccessible (OceanFirst, Luana, Plains Commerce, Southern Bank of Tennessee).

PDF text-only versus successful image inspection is explicitly recorded. Webster/Renasant/Montecito parsed-versus-rendered revision discrepancies are NOT represented as matching source versions. These dispositions require properly bound artifacts and current preconditions before any correction. None of the 32 was marked production-fixed by this review.

## Precise blocker observed; do not misdiagnose as permission/authentication

The Fee Insight connection successfully returned schema and the exact production records. A later READ-ONLY aggregate coverage/operator-control request was blocked by the tool because it could not determine safety status. It was not retried through another tool, connection or disguised query. James's authorization is already sufficient; this tool refusal is not a request for him to authorize routine work again.

Consequences: fresh aggregate coverage counts and current operator-control values remain unavailable. The preceding multi-statement SQL response returned only the last schema result; do not infer that earlier count/control results were received. Do not claim controls are enabled, coverage is zero, or safe production rollout was established. A prior rollback-only preview assertion call was also blocked; only the actual CI SQL assertions count as executed.

## Database state last established

- Use ONLY Fee Insight `link_6ac94ace565081919e3e56f293e260e7`, production `rmhwbbjjctzfaqjyhomu`, existing preview `zqjwpjujroahhqtncycv`.
- Production had no dedicated audience columns at the successful schema read; migrations 40/41 were not applied there.
- Pinnacle publication 97662 -> verified 110743 -> raw 321488; 97663 -> verified 110744 -> raw 321489; source document 21164 at https://www.pnfp.com/Overdraft. Both original $30 publications were still present at the exact-row read. Re-read before any future write.
- Preview migration history previously showed `20270110000040 fee_audience_integrity` and `20270110000041 pinnacle_audience_correction`. Preview had ZERO institutions, raw observations, publications and catalog rows. This is NOT a successful production-data rehearsal.
- Actual `fee_change_records` columns include `previous_fee_published_id` and `new_fee_published_id`, `previous_amount`, `old_amount`, `new_amount`, `like_for_like`, `fee_category` and `canonical_fee_key`. Do not invent `old_fee_published_id`.
- No production write, merge, deployment, message send, credential reset, grant change or paid provider activation in this continuation.


## October 10 continuation: Darwin second-source audience integrity

- Re-read PR #986 and Darwin's nested AGENTS.md before editing. Starting head for this change set: `bf9bdb2391ac4d61d354105c94f9547fa9510249`.
- Latest previously verified head `93dca493ef733e2c76f80974ff8b8e67f18de2ef` passed Actions run `38005873294`: app job `114074412199` and SQL job `114074412343`, including guards, focused tests, TypeScript, lint, full suite, ordinary E2E and PostgreSQL audience assertions.
- `8c3540e3184fdb6017b2cfe3bb05add855f4e559`: Darwin second-source evidence now carries `fee_audience`, rejects unknown applicability, and only treats same-audience or compatible `both` evidence as corroboration. Strategy version bumped to v2 so this semantic change is auditable.
- `9830e37fbd5c8558d94798148e7dc229b4851a4a`: verifier passes the candidate row's audience into the corroboration check.
- `0dcffe7c10a111df68083e1ec08efe9b9f9eae06` and `ec1a0067e7cff061beef9da1e3082e5a60487b2f`: regression coverage proves business/unknown copies cannot corroborate consumer fees, `both` may corroborate consumer, and compatible disagreement remains non-blocking evidence.
- `f650c24bb2a2072683aba6f2fbc96a3477f73029`: Darwin operating guide updated to the v2 audience contract.
- This change does not alter production data. Final-head CI is required before this gate is considered passed.
- The previously attempted edit of `tests/e2e/production-schema.sql` remains tool-safety-blocked and was not retried through another route. Passing E2E from the prior head is preserved as a receipt, but the known caught schema-warning noise remains open.


## October 10 continuation: downstream reader and alert hardening

- Reconciled #986 with current main `102036807c82dcd9ac656ea8afe0e709c3cab651` using merge commit `71a3754e82f991f019395ff226c464d1cb9b7f82`; comparison then showed #986 44 commits ahead and 0 behind main. Backlog-control files from merged #987 were preserved.
- Reviewed all six overlapping #939 paths and left an owner coordination comment. Correctness contract: preserve #986 consumer/both eligibility and genuine zero; layer #939's account/presentation work on top. In particular, do not reintroduce `amount > 0` or omit audience checks in profile headline selection.
- Commented on #990, #991 and #984 with the migration-collision handoff: #986 preview already has audience migrations at 40/41, production has not been changed by #986, and current main had no 42/43 filenames. Proposed preserving applied #986 preview history and moving only confirmed-unapplied payment migrations to later unique versions after their owners verify applied history. No payment branch was modified.
- `314a417b` / `145c4dca`: guide extremes now contribute one value per institution; overdraft uses the highest tier, other categories the institution median, with consumer/source eligibility and zero retained.
- `f17557ca` / `46b25ed9`: state/county visual fee comparisons use sourced consumer/both evidence, real zeroes and the highest overdraft tier; branch/deposit geography remains unchanged.
- `b90ea6f6` / `bdc56230`: saved-institution guide fees use the same consumer/source/tier contract.
- `142cb934`, `8d7c61a0`, `a3fe9c68`: Hamilton price studies use consumer/both evidence and retain zero where mathematically meaningful; inferred-volume denominators remain positive-only but exclude business/unknown rows.
- `e6e4b2fa` / `ff61eb22`: public fee-revenue research reduces each institution/category to one consumer-applicable value, retains zero, and requires three distinct fee categories before including an institution.
- `e80e947e`, `a1f891b2`, `d638e534`, `a744cc3b`: publication signals carry fee audience and explicit consumer-applicable category keys; fee alerts fail closed on business/unknown/legacy signals and fill newly published amounts from consumer evidence only. No alert/email send occurred.
- `226d29e6`: competitor alerts use consumer own-fee values and the shared live same-audience price-move predicate.
- `a4f3100a` / `a72cbf2c`: Pro digest movements and snapshot fee rows are consumer-applicable; business/unknown movement signals are ignored.
- `759c1899`: local-market answer own fees use the shared consumer/source contract.
- `902a7a41` / `60bd7c14`: the shared fee-movement confirmation query itself now requires old/new rows to have the same known audience, closing cross-audience false movements before downstream consumers.
- `3b8a2da9` / `20121186`: city fee comparisons and averages use consumer/both sourced evidence, preserve zero, and use the highest overdraft tier.
- Actions run `38017987435` on an earlier head passed focused agentic tests and SQL assertions but failed TypeScript. Exact errors: `verifiedFee.fee_audience` widened to `string` in `hamilton/publish.test.ts`, and Pro digest passed an `unknown` value to `isConsumerFee`. Fixed on the current branch by `f14976ff` (literal audience typing) and `68b69c58` (explicit runtime narrowing). This run did NOT reach lint/full-suite/E2E; do not call it green.
- Authorized Supabase migration-history read resolved the 40/41 collision direction: production `rmhwbbjjctzfaqjyhomu` ends at `20270110000039 lead_report_refund`; FeeInsight preview `zqjwpjujroahhqtncycv` has `20270110000040 fee_audience_integrity` and `20270110000041 pinnacle_audience_correction`. Receipt posted to #990, #991 and #984. Preserve #986's applied preview 40/41; payment owners should move their confirmed-unshipped migrations to later unique versions and rerun combined schema/application checks. This is not itself a release approval.
- Payment owners have now moved their conflicting migration filenames to `20270110000042_pro_checkout_intents.sql` (#990) and `20270110000043_payment_email_outbox.sql` (#991); their recorded test runs `38017367898` and `38017549315` are green. This clears the filename collision, but combined-schema verification with #986 is still required before release.
- Earlier app run `38017987435` exposed test-only TypeScript widening and Pro-digest audience typing; fixed by `f14976ff` and `68b69c58`.
- Run `38018147925` then passed SQL assertions, focused tests, TypeScript and lint but full suite failed only because `competitor-alerts.test.ts` mocked `sql` without its existing `unsafe` helper after the production query adopted the shared consumer price-move predicate. The production logic itself was not weakened. `22c4d267b5da5c4bad0bf277fac14d654df221ec` updates that mock and asserts the consumer/same-audience predicate; current-head CI must certify it.
- `c52192a2` / `7d30dee8`: institution-directory fee focus/sort now uses sourced consumer/both evidence, preserves a genuine zero, and applies the same one-value-per-institution tier rule instead of selecting the raw lowest catalog row.
- No production database mutation, deployment, provider activation, or outreach send was performed in this continuation.


## Remaining acceptance gates

### 1. Final-head CI and regression integrity
- [x] Fix naming guard without weakening it.
- [x] Full suite, ordinary E2E and SQL assertions passed through 4d20e68b.
- [x] Remove temporary source-snapshot workflow.
- [ ] Check 2a97828e and every subsequent final-head CI; fix actual failures.
- [ ] Review E2E schema warning noise and simplify the unnecessary Maple discovery expectation map back to the literal original assertion. Preserve tests and production safeguards.
- [ ] Reconcile current main and inspect final diff/reviews; no concurrent-overwrite or unrelated Hamilton changes.

### 2. Evidence-backed coverage and remaining consumer paths
- [x] Central statistics/filter and counts; benchmark export/source/rate boundary; local-market competitors/moves; market-study; competitive reports; public category readers/move feeds implemented with regressions (latest code CI still required).
- [ ] Finish `derived-analytics.ts`, state-expert `memory.ts`, Darwin `peer-checks.ts`, all related call sites and stored peer memories. Read nested instructions before editing agent code. Business/unknown observations must not be judged against consumer baselines.
- [ ] Verify `wire-fee-data.ts` delegated reads and all report/outreach consumers, including runtime claims from old generated assets; no outreach send.
- [ ] Align remaining minimum-sample consumers such as regulatory-watch local comparisons. Audit guide extreme ranking duplicates/tier semantics separately from audience filtering.
- [ ] Evidence-backed existing-record classification/backfill, with artifacts and audit. Unknown stays unknown; URL/product-name/neighboring-row guesses are not consumer evidence.
- [ ] Measure before/after institution/category coverage; show valid sample sizes and insufficient evidence. Do not use zero or stale numbers where the query was blocked.

### 3. Data disposition
- [x] Every exact screening ID has a row-specific source-review result or explicitly recorded evidence gap.
- [ ] Apply each justified correction/no-change disposition/quarantine with current source and lineage safeguards, preserving frequency, conditions and history. Review completion is not production remediation.
- [ ] Correct Pinnacle through the real extraction -> verification -> publication path. No synthetic success events or direct verified-$0 insert.
- [ ] Prove old Pinnacle observations cannot republish, and preserve the 2022 policy effective date without creating a new bank-change alert.

### 4. Release and live proof
- [ ] Validate populated preview behavior with real assertions and relevant application routes; distinguish empty preview limitations and respected safety blocks.
- [ ] All final checks/reviews and migration-order gates pass; then merge and perform additive reversible database/application rollout through normal workflows.
- [ ] Honor operator stops, provider budgets and safety blocks; no credential exposure or public access grants.
- [ ] Invalidate/regenerate affected caches, reports and UNSENT outreach safely; send nothing.
- [ ] Live institution 47 and relevant endpoints show consumer NSF $0 eliminated, business NSF $30 and overdraft $30/both, with proper provenance.
- [ ] Final verified-completion receipt to James; only then disable the hourly continuation.

## Continuation rules

Use the existing hourly task, not a duplicate. Execute a concrete next unfinished item each run when permitted, keep current receipts in this ledger/PR, and report only material milestones, a genuinely new actionable blocker or verified completion. No repeated permission requests, no fabricated test results, no green-draft-PR completion claim. The current tool safety block does not prevent independent repository work.
