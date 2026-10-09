# Fee audience repair: completion ledger

Owner: ChatGPT, at James's explicit request to manage the repair to completion.
PR: #986. Branch: `fix/pinnacle-fee-audience-integrity`.
Status: IN PROGRESS. Not merged, not released, not a completed production correction.

This ledger is a handoff/checkpoint, not proof that the listed gates passed. Update it from current receipts on each continuation; never replace missing evidence with a narrative of success. The detailed 32-record source queue remains in `2026-10-10-pinnacle-audience-repair.md`.

## Verified receipts, October 10, 2026 Hong Kong time

- Live Fee Insight connection works: production `rmhwbbjjctzfaqjyhomu`; preview `zqjwpjujroahhqtncycv`. Use the connection named Fee Insight, not the other Supabase account.
- Re-read production Pinnacle lineage: publication 97662 -> verified 110743 -> raw 321488; publication 97663 -> verified 110744 -> raw 321489. Both refer to source document 21164 at `https://www.pnfp.com/Overdraft`, with the diagnosed mixed-audience NSF and all-client overdraft excerpts intact. The correction migration's preconditions match these reads.
- Pinnacle's official program page was re-opened and still explicitly states consumer NSF eliminated ($0), business NSF $30 and overdraft $30 for both, effective August 1, 2022. This is a data-quality correction, not a newly announced bank fee change.
- Preview migration history contains `20270110000040 fee_audience_integrity` and `20270110000041 pinnacle_audience_correction`. Preview has ZERO institutions, raw observations, publications and catalog rows. Successful schema application is not a production-data rehearsal.
- The original CI E2E failed with empty Vermont peer levels. Source inspection showed each seeded peer had just one category, while the catalog requires three distinct categories. The fixtures also omitted explicit audience and source-document lineage. Do not weaken catalog depth or accept unknown audiences to make a test pass.
- Commit `f60f017914d4d2ef5fe331dbb22938ad04b92921` changes the E2E seed to three categories per peer, creates source-document lineage and consumer applicability, and asserts that 27 sourced consumer fee rows from nine institutions are visible before the pipeline starts.
- For that commit, Actions run `37995139705`: job `114039136578` (`fee-audience-sql`) PASSED. Job `114039135749` (`app-tests`) passed focused agentic tests, TypeScript and lint; full-suite/E2E results were not yet final at this checkpoint. Re-fetch, do not infer success.
- A separate rollback-only preview acceptance script was blocked by the tool's safety-status check before execution. Do not describe it as passed or circumvent that control. The isolated PostgreSQL CI assertions above are the successful test receipt.
- All 32 candidate records were re-read from the production catalog. Their actual identities match the existing runbook (Webster, Pinnacle courier, Renasant, Trustmark, etc.). The list is still a review queue, NOT 32 completed corrections.
- No production database mutation or application deployment was performed in this continuation.

## Ordered acceptance gates

### 1. CI and regression integrity
- [ ] Full current-head CI, including ordinary pipeline E2E, passes.
- [x] Current repair's SQL migration assertion job passed for f60f0179.
- [ ] Review the E2E seed diff; simplify the unnecessary no-op `map` around the Maple discovery expected array back to the original literal expectation. Preserve every test assertion.
- [ ] Remove temporary `.github/workflows/fee-audience-review.yml` before merge.
- [ ] Validate the final head after all further changes, not an earlier passing commit.

### 2. Audience coverage and downstream correctness
- [ ] Evidence-backed classification/backfill for existing observations; unknown stays unknown. A product name, URL path or neighboring row must not silently supply an audience.
- [ ] Measure category/institution coverage before and after. Report sample sizes and suppress insufficient benchmarks instead of manufacturing coverage.
- [ ] Audit ALL remaining comparison consumers, not just `STATS_ROW_FILTER` users. Known paths needing review include `src/lib/data-store/fees.ts` (summaries/extremes/instances), `benchmark-export.ts` (source selection), `custom-report-market.ts`, `derived-analytics.ts`, `local-market.ts`, `market-study.ts`, `wire-fee-data.ts`, and state/national peer calculations in `src/lib/agents/state-expert/memory.ts` and `src/lib/agents/darwin/peer-checks.ts`.
- [ ] Keep operational counts, all-audience institution evidence and consumer benchmark counts distinct; do not blindly replace every catalog query with a consumer filter.
- [ ] Consumer $0 remains in comparisons and display; business prices and unknown applicability cannot become consumer medians or outreach claims.

### 3. Source review and data repair
- [ ] Resolve every one of the 32 exact runbook screening records with a source-backed correction, justified no-change/false-positive disposition, or explicit quarantine plus identified missing evidence. Preserve restrictions and frequency.
- [ ] Particular review: Webster currency-order versus money-order; Woori $30MM/$10MM thresholds versus actual wire prices; Renasant and NewBank adjacent-row binding; Southern Bank of Tennessee adjacent $35; Montecito returned-item category; Lebanon 'Credit Union Business Only' service-purpose false positives.
- [ ] Correct Pinnacle through the real extraction -> verification -> publication flow. No fabricated agent events or direct verified-$0 shortcut.
- [ ] Preserve historical wrong amounts and correction audit; prevent old observations from republishing.

### 4. Release
- [ ] Reconcile current main and migration ordering without overwriting unrelated work.
- [ ] Validate preview migration behavior and relevant application routes against the migrated preview, accurately stating its dataset limitations.
- [ ] All required checks/reviews pass; PR ready and merged.
- [ ] Additive, reversible migrations applied through the normal workflow and application deployed through Vercel; record exact receipts. Do not bypass a blocked tool, reviewer gate, automation stop or provider budget.
- [ ] Invalidate/regenerate affected caches, reports and unsent outreach without sending customer messages or introducing false fee-change alerts.

### 5. Live proof and closure
- [ ] Live Pinnacle: consumer NSF $0/eliminated, business NSF $30, overdraft $30/both; supporting source and lineage visible.
- [ ] Published catalogs and live application endpoints agree.
- [ ] Recheck cannot restore quarantined observations.
- [ ] Affected consumer comparisons and assets are corrected with valid coverage labels.
- [ ] Final receipt sent to James; disable the hourly completion task only after all gates genuinely pass.

## Continuation behavior

An hourly continuation task has been created to execute unfinished work, update this ledger and the PR, and report only completed milestones, new blockers requiring James, or verified completion. It must not spam unchanged status or call a green draft PR a completed repair. Use fresh source/schema/check/deployment reads each time. Stop unsafe writes and complete independent work when a required action is blocked.
