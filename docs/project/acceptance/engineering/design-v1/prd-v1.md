# FeeInsight Verification Program — PRD

> A verifiable definition of “done” across FeeInsight engineering and banking data operations

**Status:** DRAFT  /  FOR REVIEW.  **Date:** 2026-11-06.

## 1. Product summary

FeeInsight Verification Program is a GitHub-native engineering workflow that requires independently grounded tests, reproducible evidence and clear ownership before a software change is called complete. It uses the existing Claude/Codex toolchain, FeeInsight skills, GitHub Actions and operational Deming/Bayes/Atlas data. It does not install NMHP or introduce new third-party agent software.

The program addresses a recurring failure mode: changes may be implemented and merged without sufficiently proving that they detect their original defect, preserve unrelated banking data, or correct the deployed pipeline. A green build is a necessary but not always sufficient result.

> **Product status** PRD describes proposed behavior; no new controls are represented as currently active. Repository rules and tests already present are called out explicitly.

## 2. Problem and user value

| Stakeholder | Today's pain point | Desired outcome |
| --- | --- | --- |
| Owner / operator | Unclear whether a claimed fix works in production; repeated verification requests | One truthful status with auditable evidence and remaining blockers |
| Builder / developer | Requirements drift; repeated repair; ambiguous “done” | Stable contract, fast scoped tests, clear ownership and release path |
| Independent reviewer | Often sees the builder's narrative instead of an independently formulated test | Own failure-first challenge, exact commit and reproducible findings |
| Data quality reviewer | Fixed case may not represent whole population; older records remain wrong | Golden/adversarial checks and Bayes replay settlement receipts |
| Future customer / product lead | Wrong fees or inconsistent report figures reduce trust | Correct, source-backed output with measured and disclosed limitations |

## 3. Product goals and success measures

| Goal | Proposed KPI / target | Baseline status |
| --- | --- | --- |
| G1 — Independent proof | 100% of R2/R3 merges have valid RED, GREEN and separate exact-head review | To measure; existing instructions not enough |
| G2 — Prevent recurrence | Every confirmed eligible defect gets a permanent regression case and owner lesson | Current skill exists; denominator not verified |
| G3 — Honest production status | 0 changes marked production-verified without deploy SHA plus sufficient outcome evidence | To implement |
| G4 — No new third-party platform | 0 new NMHP installs, paid services or new production credentials for MVP | Design constraint |
| G5 — Efficiency | Median verification CI overhead target ≤15% vs current workflow | Target requires pre-pilot baseline |
| G6 — Operational completeness | Affected count reconciles to done + queued + excluded + not-counted | Bayes exists; cross-release reporting TBD |

Targets above are design objectives, not measured FeeInsight performance. Baselines are established in Milestone M0 and reviewed before enforcing additional required checks.

## 4. Scope and releases

| Release | Included | Explicitly excluded |
| --- | --- | --- |
| MVP (M0-M2) | Contract/risk/skill routing; failure-first test proof; current CI reuse; PR evidence summary; one data-pipeline pilot | No NMHP, production mutations, additional service, ruleset change by automation |
| Enforced (M3) | Exact-head independent approval, protected agent policy paths and required verification check | No bypass of separately authorized production/security boundaries |
| Operational (M4-M5) | Deploy receipts, Deming/Bayes observed impact, status reporting for data correctness and replay | No duplicate Deming implementation or new fee publication API |

## 5. Personas and primary use journeys

### 5.1 Operator: “Did the fix actually work?”

1. Open one issue/PR and read affected agent, risk tier, source-of-truth and acceptance contract.
2. See RED proof on the old SHA, GREEN at the PR head, external reviewer verdict and CI conclusion.
3. After deployment, see measured outcome from Deming, run health from Atlas and replay completeness from Bayes.
4. If any proof is missing, see BLOCKED or PRODUCTION_UNVERIFIED with owner and next safe action—not a celebratory PASS.

### 5.2 Builder: “Fix the class of failure”

1. Read the requirements and tests established by another role before touching the implementation.
2. Use diagnosing-bugs/tdd and the owning runtime agent guide; produce one scoped repair and update agent lessons.
3. Run quick local tests and open a single PR when evidence is ready; CI executes broader checks once.
4. Resolve independent findings in the same PR; final code head is reviewed again before merge.

### 5.3 Reviewer: “Find what the builder missed”

1. Inspect source evidence and known failure modes independently, not just the builder explanation.
2. Write or validate behavioral test assertions, edge cases, input provenance and failure signatures.
3. Review exact changed files and tests at the final SHA; identify false positives and unresolved gaps.
4. Submit signed review via separate GitHub identity or leave it advisory when identity separation is unavailable.

## 6. Functional requirements

Priority: P0 = required for MVP correctness/security; P1 = required before broad rollout; P2 = planned improvement. “Acceptance” refers to observable externally verifiable outcomes, not self-declared model completion.

| ID | Pri | Capability | Acceptance criterion |
| --- | --- | --- | --- |
| FR-01 | P0 | Create one verification contract per change | Versioned JSON associates GitHub issue, scope, risk and source authority; invalid/missing fields fail validation. |
| FR-02 | P0 | Deterministically classify risk | Highest applicable changed-path/behavior tier wins; policy files and financial/security changes cannot be down-classified. |
| FR-03 | P0 | Map required existing skills to scope | Contract records skills; Knox/Rosetta/Darwin and Hamilton cases route to their documented skill/checks. |
| FR-04 | P0 | Record traceable acceptance criteria | Each R2/R3 requirement has unique ID, expected behavior, authority and at least one stable test ID. |
| FR-05 | P0 | Prove behavioral RED on baseline | Detached old-code run fails on expected assertion; setup failure, timeout or missing dependency is rejected. |
| FR-06 | P0 | Prove GREEN at PR head | Same test identity passes at current SHA and required existing tests pass without unauthorized skips. |
| FR-07 | P0 | Use existing CI rather than duplicate suites | New evidence check composes with app-tests, while unit, DB and quality suites still execute once. |
| FR-08 | P0 | Never trust authored success narratives | Trusted workflow reads GitHub run evidence; hand-written PASS in PR body does not count. |
| FR-09 | P1 | Enforce independent exact-head review | Distinct reviewer identity; reviewed SHA equals head; new push invalidates prior approval. |
| FR-10 | P1 | Protect critical agent instruction paths | Changes in AGENTS.md, CLAUDE.md, skills, CI/security files require policy review and cannot use docs-only shortcut. |
| FR-11 | P0 | Keep findings actionable and nonduplicative | Review finding includes severity, file/line or reproducible artifact, disposition and root-cause issue/owner. |
| FR-12 | P0 | Preserve production authorization rules | Migration, production-data mutation, new permission, paid-provider activation or outreach cannot proceed under routine merge authority. |
| FR-13 | P1 | Provide a single change evidence summary | PR displays links to contract, red/green, CI, review, release and live evidence with explicit missing statuses. |
| FR-14 | P1 | Connect deployed commit to observed status | Release has deploy SHA/environment; absence prevents production-verification claim. |
| FR-15 | P1 | Use Deming as measured quality source | Quality output references fixed cohort/version, evidence and timestamp; self-scoring implementation changes have separate test review. |
| FR-16 | P1 | Use Bayes for replay settlement | Affected/done/queued/excluded/not-counted disclosed; partial replay remains visible until settled. |
| FR-17 | P1 | Preserve agent lessons and regression history | Root-cause bug fix adds permanent test and role-lessons.ts update; holdouts remain excluded from tuning. |
| FR-18 | P1 | Support explicit blocked/unknown states | Required tests skipped, proof missing or environment unavailable must not be reported as PASS. |
| FR-19 | P2 | Offer aggregated engineering scorecard | Trend independently verified coverage, recurrence, review latency, proof failures and CI cost. |
| FR-20 | P2 | Validate UI journeys separately | For UI work use buyer-journey-mapper, UX/UI auditor and Playwright with screenshots/console/request evidence. |
| FR-21 | P1 | Enable policy versioning and audit | Record accepted contract versions and review events; modifications invalidate affected proofs. |
| FR-22 | P1 | Make rollback and regressions visible | On observed regression, show SHA, owning agent, affected units and reopen/rollback decision; no auto-mutation. |

## 7. Security, privacy and governance requirements

| ID | Control | Acceptance / policy evidence |
| --- | --- | --- |
| SEC-01 | Zero new third-party agent framework | No NMHP runtime, unreviewed GitHub App or paid monitoring vendor in MVP. |
| SEC-02 | No secrets in untrusted PR evaluation | Read-only minimal token and isolated database; CI blocks use of prod secrets/fork code together. |
| SEC-03 | Agent credential isolation | Builder gets scoped branch capability; reviewer read-only or separate review identity; no shared self-approval. |
| SEC-04 | Protect policy-changing files | Independent authorized review for workflow, CODEOWNERS, skill, permission, prompt and security changes. |
| SEC-05 | Treat source documents as untrusted data | Bank PDF and web text cannot override prompts or execute shell commands; injection fixtures must pass. |
| SEC-06 | Freeze expected values from independent authority | Official source/confirmed human/answer key; no model-generated truth labels or holdout leakage. |
| SEC-07 | Separate sensitive approvals | SQL migrations, production data, auth, permissions, spending and outreach retain current explicit authorization. |
| SEC-08 | Record audit trail and revocations | Exact SHA, actor, timestamp, artifact hash, reason for exception; stale sign-off invalidated. |

## 8. Change risk and skill-routing requirements

| Risk | Eligible changes | Mandatory checks |
| --- | --- | --- |
| R0 | Copy-only, inert markdown | Low-risk validation; policy files do not qualify |
| R1 | UI, non-financial business logic | Contract + unit/journey evidence + exact-head review + normal CI |
| R2 | Fee pipeline, analytics, reports, classification | Independent red/green + adversarial/golden + source evidence + observed impact |
| R3 | Auth, payments, secrets, data mutation, migrations | R2 + threat model + protected owner authorization + isolated rehearsal |

### 8.1 Routing matrix for named skills

| Change owner | Triggered skills / agents | Expected proof |
| --- | --- | --- |
| Knox/Rosetta | tdd, adversarial-document-testing, error-to-test | Correct fee extraction from frozen source; negative examples caught |
| Darwin | source-evidence-audit, fee-taxonomy-regression, tdd | Supported verification; source/category/rejection accuracy |
| Hamilton | report-reconciliation, fee-evaluation | Printed fee and derived calculations independently tied to live data |
| Atlas/Bayes | diagnosing-bugs, recover, audit-data | Retry, replay, blocked states and counts independently checked |
| Deming | data-quality-audit, error-to-test | Frozen quality measures/holdouts stable; change impact observable |
| Hoovie | audit-data, data-quality-audit, Supabase skills | Source contract, schema identity, completeness and freshness |
| UI | buyer-journey-mapper, ux-ui-auditor, playwright-ux-simulator | Mobile/desktop screenshots and runnable navigation findings |

## 9. User-facing status and information model

The MVP evidence view is a PR template/check summary, not a new product dashboard. A later internal page may present the same data if it adds genuine decision value. Status uses the same meaning across issue, PR, release and operator reports.

| State | Meaning | What user can do |
| --- | --- | --- |
| DRAFT / CONTRACT_REVIEWED | Scope is being specified / frozen | View requirements and test coverage |
| RED_PROVEN / GREEN_PROVEN | Relevant failure detected at base / fixed at current head | Open run and assertion logs |
| REVIEWED / MERGEABLE | Independent exact-head review and controls satisfied | See reviewer identity, blockers, check URLs |
| DEPLOYED | Specific SHA in named environment | See deployment receipt |
| OPERATIONALLY_VERIFIED | Measured result and replay evidence sufficient | Inspect Deming/Bayes/Atlas references |
| PRODUCTION_UNVERIFIED | Tests/merge may pass; real outcome not established | See missing evidence, owner and due action |
| BLOCKED / REGRESSED | Required proof absent or new defect detected | See reason and recommended safe next step |

## 10. Non-functional requirements

| Area | Requirement | Acceptance method |
| --- | --- | --- |
| Reproducibility | Required proof yields same assertion on same commit/fixture/seed | Repeat test on pinned baseline and head |
| Reliability | No false green when check missing/timeout/skip | Injected skip and infra failure scenarios |
| Performance | Avoid repeated full suites; target ≤15% CI median overhead | Baseline/after CI minutes comparison |
| Maintainability | Skill contracts reference existing canonical files; no second truth store | Change impact reviews and architecture tests |
| Security | No extra production credentials; minimal GitHub permissions | Workflow permission/static secrets review |
| Observability | All significant states carry actor, SHA, timestamp and evidence link | Trace one pilot PR end to end |
| Accessibility | Future dashboard if built meets keyboard, contrast and screen reader expectations | Playwright/a11y audit; not required for MVP PR summary |
| Availability | When external provider is unavailable, workflow fails closed and resumes without guessing | Simulate Codex/API outage and verify blocked state |

## 11. Acceptance and UAT scenarios

| Scenario | Acceptance criteria |
| --- | --- |
| UAT-01: seeded wrong-fee case | Independent RED correctly rejects bad output, GREEN confirms fix, Deming measures later |
| UAT-02: fake RED setup error | Gate rejects missing module/timeout as invalid proof |
| UAT-03: review SHA drift | New commit after review revokes mergeability until reviewed again |
| UAT-04: docs-only policy edit | Edited .claude/skills/... or AGENTS.md triggers policy gate despite Markdown |
| UAT-05: missing real database | Required DB test is NOT_TESTED/BLOCKED, not a green success |
| UAT-06: partially reprocessed cohort | Bayes shows queued/not-counted; release cannot claim operational verified |
| UAT-07: malicious document instruction | Input treated only as source content; agent cannot execute embedded directions |
| UAT-08: protected action | New SQL migration or permission change requires explicit owner authorization |
| UAT-09: mixed UI + pipeline change | Risk escalates to highest tier and both relevant specialist skill groups run |
| UAT-10: reviewer same account | AI assessment recorded but cannot satisfy separate-identity approval |

## 12. Prioritized product backlog and rollout

| Sprint / milestone | Epics and user outcomes | Exit condition |
| --- | --- | --- |
| M0 — Inventory | Record current policy, CI timing, skill inventory; pick representative Knox/Darwin issue | Baseline and owner approved; read-only |
| M1 — Define | Contract JSON schema, policy mapping, PR template, changed-path guard | Tests for schema, risk classifier, owner policy; no production write |
| M2 — Demonstrate | Independent RED/GREEN evidence in trusted CI, existing gate aggregation | Pilot catches bad change and accepts repaired change |
| M3 — Enforce | Separate GitHub identity/reviewer, ruleset protection, protected policy paths | Owner authorizes settings; stale review and tamper cases fail |
| M4 — Observe | Deployment SHA → Deming/Atlas/Bayes evidence links and status | One complete end-to-end operational receipt |
| M5 — Expand | Hamilton reports/UI contracts; measure time, recurrence and false blocks | Measured before/after results and staged adoption |

## 13. Release gates and definition of done

- Definition of code done: correct scope, frozen acceptance criteria, meaningful RED and GREEN where required, green trusted CI, independent exact-head review, no unresolved blocker and appropriate approvals.
- Definition of data impact done: deployed SHA, attributable runtime run, measured quality outcome, and Bayes settlement/explicit exclusion when reprocessing is required.
- Definition of not done: a successful build with missing independent review, a skipped required test, an unmeasured production result, or a partial catch-up described as complete.
- Only a clean code PR that does not cross existing separately controlled boundaries may use the repository's standing routine merge authorization.

## 14. Dependencies, assumptions and risks

| Category | Risk / dependency | Mitigation or owner decision |
| --- | --- | --- |
| GitHub permissions | Existing ruleset only shows app-tests required; other protection not fully confirmed | Inspect/approve rule settings before claiming independence enforced |
| Shared identity | Claude/Codex may post using one owner identity | Require separate reviewer identity or human approval for security-relevant gates |
| Skills as markdown | Untrusted instructions can alter AI behavior | Protect prompt/skill paths, treat their changes as code-adjacent |
| Evidence coverage | Deming shadow lab omits some parser/provider steps | Explicit seam coverage; NOT_TESTED where replay cannot reach |
| CI minutes | Full e2e and quality suites cost time | Reuse existing runs, baseline overhead, avoid duplicate suites |
| Production authority | Reading live cohorts may be restricted; reruns risk fee state | Begin read-only; explicit user approval for changes/migrations |
| Golden/holdout correctness | Model scores could be misleading or holdouts contaminated | Independent fixed references; do not train on holdouts |

## 15. Decisions requested before enforcement

1. Choose the distinct GitHub reviewer identity or require human owner review for R2/R3 until independent authorization can be enforced.
2. Authorize a scoped GitHub rule/CODEOWNERS change only after a working proof-only pilot has been demonstrated.
3. Choose contract/evidence artifact retention period and the minimum operational verification window for each kind of bank-data change.

## 16. Source registry and limitations

This PRD is based on FeeInsight main branch as accessed 06 Nov 2026: README.md, CLAUDE.md, AGENTS.md, .github/workflows/test.yml, .claude/skills/, src/lib/agents/deming/AGENTS.md, src/lib/agents/bayes/AGENTS.md, docs/project/README.md and the accessible main GitHub ruleset (#25335023). The supplied NMHP_WHITEPAPER.pdf is a case study motivating independent review, not evidence of universal results or a requirement to install its software.

Known uncertainties: live runtime health and deployed revision were not audited for this document; reviewer approvals beyond the inspected active ruleset were not established; artifact retention, actual existing CI baseline and separate reviewer identity are undecided. Implementation must preserve the current FeeInsight data semantics and migration protections rather than assuming a new schema.

