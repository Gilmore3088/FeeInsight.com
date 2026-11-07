# Engineering verification implementation plan and validation

The complete M0–M5 scope remains the objective, with M0–M2 as the first delivery. Continue on [PR #2995](https://github.com/Gilmore3088/FeeInsight.com/pull/2995) for the verification foundation, tied to Foundation #1048 and quality tracker #1026. Later adoption work must reuse or explicitly supersede current issues and PRs before opening another outcome.

The implementation is in progress. All 50 source requirements have traceability. The two contracts have initial frozen identities, and the contract, isolation, evidence, review, source-security, browser-capture and native scorecard mechanisms exist in the working branch. Final candidate freeze and integrated validation, trusted Actions proof, enforcement, production acceptance and broader adoption remain open. File presence and local test results do not complete a milestone.

Independent Codex review has corrected actual authentication/permission risk routing, protected renames, CI rerun freshness and owner-authorization revocation. Local historical pilots have produced behavioral baseline failures and target passes. Hamilton diagnostic runs now exercise the desktop/phone report and research flows, including the actual institution picker and the same saved report in a fresh phone context. The final committed-candidate checks remain the delivery receipt.

M5 browser acceptance remains open: the strict collector retains Next.js request cancellations and blocks those without sufficient navigation or action-completion evidence. Passing functional assertions do not relabel those captures as accepted. Native same-document/action correlation is follow-up adoption work; a broad exception for aborted requests is not part of this bootstrap. The independently frozen private sample is likewise a local diagnostic, with private expectations excluded from tuning, rather than an accuracy or launch acceptance claim.

## Current priorities

1. **Finalize and freeze the foundation contracts.** The R3 `1048.json` contract for the verification system and the separate historical R2 Knox `2285.json` contract both exist with initial frozen identities. Reconcile the Foundation scope and required skills with the complete actual diff and authenticated PR contract marker. Independently review expectations, stabilize the code, then freeze the complete execution chain, fixtures, assertions and tests for the committed target. Any later identity change requires new proof.
2. **Validate the integrated candidate.** Commit the candidate before executing both historical adapters against their exact baseline and target commits. Require the expected behavioral failures at baseline and passing assertions at target; setup failures, missing imports and timeouts cannot count as RED. Frozen offline PDF, HTML and plain-text injection fixtures now exercise actual normalization and actual Knox/Rosetta paid-request paths with stubbed providers and side-effect assertions. Run those tests in trusted Actions and obtain independent acceptance; no live-model obedience score is claimed. Execute the extended desktop/mobile browser journeys against a clean exact candidate and retain successful screenshots and sanitized diagnostics. Live paid-provider activation requires separate authorization; unavailable coverage stays `NOT_TESTED`. Complete the repository checks below and resolve findings in this PR.
3. **Review the concrete bootstrap changes.** Obtain review of the exact current head and the workflow, credential isolation, prompt and policy diff. Claude or Codex is selected for the independent engineering-agent review role; no distinct authorized GitHub reviewer principal is configured. James supplies separate owner sign-off. Independent GitHub approval requires a different authenticated principal when James is also the PR author. Record the review and separately required security authorization before merge; the concrete bootstrap and enforcement proposals are in [activation-proposal.md](activation-proposal.md).
4. **Establish trusted Actions proof.** After authorized bootstrap code lands on `main`, dispatch the registered proof workflow for each target PR and selected contract, demonstrating both pilots. Corroborate run, attempt, job, artifact digest and frozen inputs. Retain artifacts for 90 days and keep `app-tests` separate so existing suites execute once.
5. **Activate enforcement after the proof loop works.** Prepare the exact reviewer policy, CODEOWNERS or ruleset changes, required check and minimal write permission needed for check publication. Demonstrate stale-head, tamper and same-account rejection first. Obtain James's authorization for that concrete security change, then verify the applied settings. Both proposed workflows currently have read-only permissions and enforcement remains disabled.
6. **Produce the first operational receipt.** Freeze a per-change observation policy, bind reviewed PR head to its actual deployed merge SHA, and collect attributable Atlas execution, fixed-cohort Deming results and Bayes settlement. Use seven days as the proposed default, with explicit sample and cadence thresholds. Any needed live rerun or exclusion retains its own authorization. Missing observations remain `PRODUCTION_UNVERIFIED`.
7. **Complete broad adoption and measured outcomes.** Expand independent contracts across pipeline roles, Hamilton reports and UI journeys. The three named UI skills and native read-only sampled scorecard are implemented; actual specialist adoption, independent private holdouts and trusted multi-change scorecard acceptance remain pending. Collect real evidence for time to verified fix, recurrence, false blocks and incremental CI use against the baseline before claiming M5 complete. Uncollected metrics remain unknown rather than inferred from runner seconds or coverage ratios.

Steps 1–2 are the immediate build work. Steps 3–5 have bootstrap dependencies; declaring a new check required before its trusted workflow is available would prevent a valid proof cycle. M4 and M5 implementation may proceed in parallel with read-only preparation, while their acceptance evidence remains dependent on deployment and adoption.

## Milestone status and exit evidence

| Stage | Current status | Exit evidence |
| --- | --- | --- |
| M0 Inventory | Baseline and skill inventory recorded; owner acceptance pending | Reviewed baseline, chosen synthetic pilot and explicit unknown metrics |
| M1 Define | Mechanisms and both initial frozen contracts present; final integration pending | Final frozen contracts plus green schema, risk, skill and protected-path checks for the exact complete diff |
| M2 Demonstrate | Local pilot and trusted collector mechanisms present; trusted demonstration pending | Exact committed baseline RED and target GREEN corroborated by the registered Actions workflow |
| M3 Enforce | Review validation and read-only workflow proposal present; enforcement disabled | Distinct reviewer policy, owner-authorized settings and actual stale-review/tamper rejection |
| M4 Observe | Deployment and runtime evidence readers present; operational acceptance pending | One complete deployed-change receipt with sufficient Deming observations and Bayes settlement where required |
| M5 Expand | Lesson/golden guards, three UI skills, browser capture and native scorecard present; adoption unfinished | Executed pipeline and Hamilton/UI acceptance, independent private holdouts and corroborated multi-change before/after scorecard |

## Validation before delivery

Run the narrow contract, runner, proof, workflow, review, runtime and route tests after the final code and contract freeze. Then run `npm run guard:legacy`, `npm run test:agentic`, `npx tsc --noEmit`, `npm run lint` and the full `npx vitest run` suite. Database tests use an isolated local schema through the existing test workflow. Add focused public institution, submit-source, admin quality and Hamilton browser checks where the final diff affects those flows.

Record final commands, exact commit and CI run links with the PR instead of treating this plan as a test receipt. Source traceability checks all 50 requirements; contract validation must use the final frozen files. Earlier local results do not replace final integrated checks, trusted Actions execution or browser artifacts from the committed candidate.

## Specification coverage

| Source inventory | Count | Source edition |
| --- | --- | --- |
| FR-01–FR-22 | 22 | `design-v1/prd-v1.md` |
| SEC-01–SEC-08 | 8 | `design-v1/prd-v1.md` |
| AT-01–AT-10 | 10 | `design-v1/technical-design-v1.md` |
| UAT-01–UAT-10 | 10 | `design-v1/prd-v1.md` |

`program.json` preserves each original acceptance criterion, its source, stage, implementation/test references and remaining dependency. `program.mjs` pins the exact source SHA256 values and rejects missing/unknown/duplicate requirements, wrong source attribution, altered source bytes, absent tests, unsafe paths, unknown milestones/references and concealed remaining work. Browser references use the repository's real `tests/e2e/**/*.pw.ts` convention; these are Playwright journeys, not Vitest execution claims.

`PLAN_TRACEABLE` establishes this mapping only. It does not execute tests, judge every test's sufficiency, certify independent test authorship or attest that any stage has shipped. The manifest cannot grant external approval by changing a gate to “complete.” Actual test receipts and external state remain separate sources of truth.

## Mechanisms and remaining evidence

| Stage | Implemented mechanism or reference | Evidence still required before the stage's full outcome is claimed |
| --- | --- | --- |
| M0 | Source inventory, deterministic skill inventory and source-linked existing CI baseline | Review baseline suitability and keep unknown business metrics explicit |
| M1 | Versioned contracts, stable requirement/assertion identities, conservative risk/skills routing, protected-document guard | Exact proposed diff and required repository checks |
| M2 | Two isolated historical adapters, parent-owned assertions, artifact/Actions corroboration, actual source/request injection tests, existing CI reuse and evidence summary | Post-bootstrap trusted Actions proof for the exact target and independent source-security acceptance; local RED/GREEN cannot substitute |
| M3 | Authenticated review actor/scope/hash checks, stale review rejection, actionable finding dispositions and read-only audit workflow | Owner approval of concrete security changes, distinct authorized reviewer identity and verified GitHub enforcement |
| M4 | Read-only deployment → Atlas execution → Deming fixed-cohort → Bayes reconciliation chain | Sufficient frozen-window outcomes for an actual deployed merge SHA; authorized replay/exclusions where applicable |
| M5 | Lesson/golden guards, three routed UI skills, exact-build browser capture/assessment and native sampled GitHub scorecard | Independent expanded pipeline/Hamilton/UI contracts, executed desktop/mobile journeys, private holdouts and corroborated multi-change measurements |

The R3 Foundation pilot verifies historical defects in the verification system itself. The R2 Knox pilot verifies a historical extraction behavior. Neither pilot demonstrates current banking-data accuracy, broad product adoption or production correction by itself.

## Revisions made during implementation

- **Independent assertions, compatible baselines.** Both fixed adapters return data only. Expectations and requirement verdicts remain in the trusted parent. This avoids copying modern regression imports into an older commit where a missing module could masquerade as RED.
- **Isolation before execution.** Git tree modes and paths are checked before archive extraction; symlinks, submodules and unsupported paths are rejected. Candidate verifier control files/fixtures are removed from materialized source. Static adapters run with no credentials/network, read-only mounts, CPU/memory/PID limits and bounded output/runtime.
- **Trustworthy receipt identity.** Artifact collection checks the actual main workflow, `historical-proof` job, run attempt, current PR head, frozen input/execution hashes and approved dependency/runtime identity. Authored JSON, local environment flags and injected transports cannot establish authentic Actions provenance.
- **No circular CI dependency.** Existing suites execute once. Proof generation and `app-tests` remain separate during bootstrap. The gate produces read-only audit artifacts and summaries; check publication and protection enforcement remain separately authorized. Authenticated workflow-run resolution rechecks the current PR head and explicit contract rather than trusting an event's absent PR list or another pilot's artifact.
- **Required database execution.** Both app and fixture clients must address the same loopback database before each required group runs. The actual Vitest JSON report must contain every selected file once, with nonempty passing assertion results and no skipped, pending or todo cases. Missing or incomplete execution blocks the existing CI job. Fixture catch-up and pipeline reports retain their separate database identities and run/attempt-bound Actions artifacts. This closes the gap where a selected suite could return exit zero after skipping required cases.
- **Source instructions stay data.** Frozen PDF, HTML and text fixtures reach actual normalizers and Knox/Rosetta request builders with stubbed providers. Trusted system instructions hold the source-data policy and Rosetta task; source bytes stay unchanged. Tests check unintended side effects. Rosetta rejects provider tool-use responses before writing; Knox ignores tool blocks and validates the remaining fee text, accepting supported rows and rejecting unsupported ones. Neither path exposes or executes a tool. Strategy versions, role lessons and the Bayes no-replay declarations capture the prospective change. These are deterministic envelope/containment checks, not a live-model attack success or immunity score.
- **Attributable browser capture.** The three UI skill definitions, `browser-evidence.mjs`, the Hamilton capture helper and real `.pw.ts` journeys are referenced in `program.json`. Verification mode requires a clean committed candidate, fresh production build and matching build identity without server reuse. Diagnostic journeys have run, and successful screenshots and bounded sanitized diagnostics are implemented. Strict event ordinals prevent a preceding load from being misrepresented as a later event. Uncorroborated request cancellations still block final browser acceptance; local captures remain untrusted for Actions provenance.
- **Native sampled scorecards.** `scorecard.mjs` collects authenticated PR, proof, review and job identities for an explicit bounded sample. Coverage includes denominators/exclusions, unavailable evidence is separate from observed failures, and unknown recurrence, billing, overhead and production-lag measures stay `NOT_MEASURED`. The collector does not establish post-bootstrap acceptance until it has real trusted source and change evidence.
- **Actual database lineage.** The current semantic schema was inspected read-only. A prospective `step.execution` event captures the executor's own valid Vercel commit/environment in the step claim transaction. The collector joins that event to the exact successful step; it never infers historical code from request parameters, dates or the API build SHA. No new table or migration is introduced.
- **Bounded operational reads.** The admin-only endpoint has explicit date/key/row limits and a ten-second database-read budget. Missing, truncated, timed-out or unavailable evidence fails closed without starting replacement work.

## Operational policy choices and limits

Production policy keeps the reviewed PR `headSha` separate from its GitHub-confirmed `deployedSha`. It freezes cohort ID/protocol/scorer version, observation bounds, minimum scored institutions/fee samples, precision/recall thresholds, cadence and replay obligations. The proposed default observation window is seven days; any different per-change window needs explicit review rather than an automatic fallback.

Exact deployment identity is conservative: a new production release may reset or prevent a seven-day observation. The first version does not accept descendant commits on the assumption that they are equivalent. An eventual lineage-aware relaxation would require its own reviewed specification and regression evidence.

Bayes's real `not_counted` is a status, not an invented numeric count. Reconciled counted rows require affected = done + queued + excluded, reason totals must match excluded, and queued/not-counted work stays incomplete. Existing ledger reasons are not independent authorization of an exclusion. Bayes never executes a replay; any production rerun retains its own authorization.

Detailed artifacts have ninety-day retention. Expired/deleted artifacts cannot prove a fresh claim. Same-account human sign-off remains owner sign-off; cross-model diversity does not create a separate GitHub principal. A production regression records deployment, owner, affected units and disposition; the system performs no automatic rollback or live correction.

## Remaining activation and acceptance record

The manifest explicitly preserves owner security approval, independent reviewer identity, authentic trusted Actions proof, independent source-security acceptance, deployment observations, authorized runtime reruns, specialist adoption and actual UI journeys, independent private holdouts and expanded verified scorecards. These are not silently replaced by the existence of code files or passing synthetic tests.

The implementation PR and its actual command/CI artifacts are the test record. This document deliberately contains no copied “all checks passed” count. Before calling the full objective achieved, inspect every original requirement against current evidence, including the external activation and broader-adoption items listed in `program.json`.
