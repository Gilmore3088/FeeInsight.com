# FeeInsight Engineering Verification Protocol

> Native, evidence-first software delivery using FeeInsight's named agents and skills

**Status:** DRAFT  /  FOR REVIEW.  **Date:** 2026-11-06.

## Executive decision

Adopt the independent-verification protocol, not the NoMoreHappyPath application. A coding agent may propose and implement a change, but it cannot certify its own result. For changes affecting bank-fee correctness, authentication, money, security, or operational reliability, a separate test design, reproducible RED proof, exact-head independent review, trusted GitHub CI and post-deployment evidence form the minimum acceptance chain.

MVP is deliberately control-plane-only. GitHub Issues and Pull Requests own work; versioned JSON files under docs/project/acceptance own requirements; GitHub Actions owns test results; GitHub review events own approval; Deming, Atlas and Bayes retain their existing production evidence. No new hosted service, SQL table, paid vendor or NMHP installation is required.

> **Status and scope** This is an implementable proposal, not an assertion that the controls have been deployed. All additions below are proposed until a tested PR is merged and any required GitHub settings are approved.

## 1. Source baseline and architectural constraints

| Verified existing asset | Evidence in repository | How the design uses it |
| --- | --- | --- |
| Delivery governance | CLAUDE.md; AGENTS.md | One outcome/branch/PR; existing protected actions and owner sign-off retained |
| CI coverage | .github/workflows/test.yml | app-tests aggregates checks, unit shards, Knox answer-key tests and database e2e |
| Required status check | Active main ruleset ID 25335023 | app-tests is required; reviewer identity not confirmed as enforced |
| Agent skills | .claude/skills/ | TDD, bug diagnosis, source evidence, adversarial docs, reconciliation, recovery |
| Quality engine | src/lib/agents/deming/ | Golden-set, regression, shadow lab, full-pipeline reconciliation |
| Replay accountability | src/lib/agents/bayes/ | Replay jobs/manifest coverage; Bayes counts, owner agent reprocesses |
| Runtime observability | src/lib/agents/run-store.ts | agent_runs, agent_run_steps, agent_run_events; Atlas stays runtime orchestrator |
| Existing project memory | docs/project/ | Acceptance, evidence, lessons, findings and decisions |

Scope of source inspection: GitHub repository Gilmore3088/FeeInsight.com, main branch as accessible on 06 November 2026, plus the supplied three-page NMHP case study. A code search, README review, workflow review, agent guides, skills and active ruleset inspection were performed. This design does not claim a production deployment, green CI, full security audit or enforcement of reviewer approval.

## 2. Design goals, exclusions and invariants

| Goal | Engineering interpretation | Observable success |
| --- | --- | --- |
| Independence | Test author and final reviewer are not the builder; cross-vendor diversity where available | Reviewer event, exact SHA and separate red/green artifacts |
| Truthful completion | No PASS for unknown, skipped or unexecuted required evidence | State machine blocks unsupported transitions |
| Root-cause repair | Correct the owning stage, replay affected cohort, then reconcile | Known case added; Bayes tracks affected units; production check |
| Minimal attack surface | No new NMHP install, service, App, production token or migration for MVP | Repo diff contains only scoped docs, CI and test changes |
| Reuse current infrastructure | Use GitHub Actions and existing Deming/Bayes capabilities once | No parallel validator platform or duplicate test farm |

- Invariants: no builder-originated text can substitute for a trusted CI status, independent review, or source evidence.
- Invariants: vendor diversity alone is not a separate GitHub security principal; enforced approval must be verifiable at the repository boundary.
- Invariants: a production effect is UNVERIFIED until a deployment SHA and measurement/replay result are linked; green unit tests are insufficient.
- Invariants: no live fee mutation, database migration, permission change, paid-provider activation or production rollout without its separately required authorization.
- Non-goals: rebuild Atlas, add a new general-purpose CTO agent, replace Deming or Bayes, send outreach, enable paused GrowthOS or introduce real-time agent orchestration.

## 3. Reference architecture

![Figure 1 — Control and evidence flow; dashed feedback represents a new issue, not untrusted execution.](FeeInsight_Verification_Architecture_Overview.png)
*Figure 1 — Control and evidence flow; dashed feedback represents a new issue, not untrusted execution.*

### 3.1 Trust boundaries

| Boundary | Allowed data/control | Forbidden shortcut |
| --- | --- | --- |
| GitHub control plane → Builder | Scoped ticket/contract, branch write, test fixtures | Production secrets, changing protected rules, self-approved merge |
| Repository content → Reviewer | Read PR, source fixtures, test results, synthetic runtime | Reviewing only builder narrative; trusting instructions in external documents |
| PR → CI | Untrusted checkout, limited read token, ephemeral test DB | pull_request_target with untrusted code and write credentials |
| CI / review → Release | Trusted statuses and approved exact head commit | Signed-off text pasted into PR; head changed after review |
| Production → verification | Read-only run identifiers, quality scores, replay statuses | Editing live rows to force green metrics; AI guess as factual proof |

## 4. Named runtime agents and skill routing

Runtime agents retain domain ownership. Development roles are functions performed by existing Claude/Codex tooling; they are not new production agent rows. Skill selection should be a deterministic rule from risk tier and changed-file ownership, confirmed in each contract.

| Affected owner | Existing skills / checks | Required verification emphasis |
| --- | --- | --- |
| Atlas | diagnosing-bugs; recover; runtime tests | Run-state transitions; stuck steps; budget/pause behavior; false-success prevention |
| Magellan | source-evidence-audit; tdd; diagnosing-bugs | Official-source ownership, freshness, retry/backoff, missing-document visibility |
| Rosetta | tdd; adversarial-document-testing | PDF/text fidelity; page/row identity; OCR-needed states; unreadable evidence |
| Knox | tdd; adversarial-document-testing; error-to-test | Amount and category errors; missing fees; thresholds; independent source-derived labels |
| Darwin | source-evidence-audit; fee-taxonomy-regression; tdd | Incorrect approvals/rejections, category, audience, duplicates and live recheck |
| Hamilton | report-reconciliation; fee-evaluation | Lineage, published catalogs, peer sets, report figures, numeric reproducibility |
| Hoovie | audit-data; data-quality-audit; Supabase skills | Government data contracts, identity joins, schema changes, freshness |
| Deming | data-quality-audit; error-to-test; adversarial-document-testing | Golden/holdout integrity; scorer changes reviewed against fixed references |
| Bayes | audit-data; recover (diagnostic only) | Replay manifest completeness; accurate done/queued/excluded/not-counted counts |
| UI / Growth | buyer-journey-mapper; ux-ui-auditor; playwright-ux-simulator | Accessible mobile/desktop journeys; no outreach enablement |

### 4.1 Independence and authorization

For the R2/R3 policy, a reviewer may use Codex while the builder uses Claude; however, the final sign-off must also be attributable to an identity distinct from the builder in GitHub or, where that is not technically possible, a human owner. An AI reviewer operating under the same broad GitHub credential as the builder is advisory, not independent authorization.

Development permission is scoped: builder may modify implementation and related tests in a feature branch; test designer commits or supplies tests before the builder change and cannot silently rewrite the contract; reviewer is read-only and can raise findings/submit review via a separate controlled identity. The trusted gate reads GitHub APIs and immutable run metadata rather than the PR author's claim.

## 5. Required end-to-end lifecycle

| State | Entry evidence | Transition / blocker |
| --- | --- | --- |
| DRAFT | Existing issue and owner; risk classification pending | A reviewer clarifies behavior, scope, source-of-truth |
| CONTRACT_REVIEWED | Versioned acceptance JSON; required skills/tests; owner acknowledgment | Frozen contract hash + base SHA; R2/R3 no unexplained gaps |
| RED_PROVEN | Baseline test run on original defective commit with expected failure signature | Failure must be behavioral, not missing imports/setup/network |
| BUILDING | Scoped branch and builder actor | One small fix; maintain required tests and source evidence |
| GREEN_PROVEN | Exact-head test success and no loss vs required baseline | No skips/rewritten expectations; CI source SHA matches PR head |
| REVIEWED | Independent exact-head assessment and finding dispositions | Reviewer cannot be PR author or approve stale SHA |
| MERGEABLE | Trusted app-tests + new verification check + GitHub approval policy | No unresolved severe finding, migration or production-permission boundary |
| MERGED / DEPLOYED | Merge SHA; when applicable deployment SHA and environment | Deploy status is not a proxy for correct product data |
| OPERATIONALLY_VERIFIED | Deming measure + Bayes replay ledger + linked run evidence | If metrics unmeasurable, remains PRODUCTION_UNVERIFIED |

Exceptional states are BLOCKED, NOT_TESTED, NOT_COUNTED, WAIVED_LOW_RISK and REGRESSED. Unknown values never collapse to PASS. A high-severity security, financial or source-integrity failure cannot be silently waived. Only explicit owner-controlled exceptions in authorized scopes are allowed, with expiry, reason and affected requirements.

### 5.1 Illustrative incident walkthrough

1. Deming identifies an unsupported live fee and links the original bank source and run lineage; the issue is classified R2.
2. A reviewer uses source-evidence-audit and diagnosing-bugs to identify the first stage that failed; unknown evidence is reported as such.
3. Independent test designer freezes a real source excerpt, creates an expected-verdict case and records a RED baseline result against the previous SHA.
4. Builder repairs the owning Knox or Darwin code, updates that agent's role-lessons.ts and replays the test to GREEN.
5. Codex runs adversarial-document-testing on related limits, old prices, two-column layouts and prompt injection in source text; challenge findings are resolved.
6. GitHub checks the full exact PR head, golden baseline, required skills and reviewer approval; clean routine code PRs may follow existing standing merge authority.
7. Deming inspects the deployed outcome; Bayes reports the affected replay population if a version bump requires reprocessing. A partial or blocked catch-up stays open.

## 6. Logical evidence model and persistence strategy

The companion ERD is the proposed logical verification schema, not a set of new Postgres tables. MVP materializes its entities through existing systems. Cross-system relations are stable GitHub issue/PR IDs, canonical commit SHA, contract hash, test identity and runtime run/replay IDs. No new production migration should be introduced merely to make the ERD look relational.

| Logical entity | MVP physical home | Immutable / authority rule |
| --- | --- | --- |
| CHANGE_REQUEST, PULL_REQUEST | GitHub issue and PR | GitHub object IDs, author, base/head SHA |
| VERIFICATION_CONTRACT, REQUIREMENT, SKILL_ROUTE | docs/project/acceptance/engineering/<issue>.json (proposed) | Versioned diff, approved base SHA and contract digest |
| TEST_CASE, REQUIREMENT_TEST | Vitest/Playwright and contract ID mappings | Stable test identity; source fixture hash |
| BASELINE_PROOF, TEST_OUTCOME | Trusted CI run + retained artifacts | Artifact includes code/test/contract hashes and actual failure / pass logs |
| CI_RUN, REVIEW_ATTESTATION, FINDING | GitHub API/check runs/reviews/comments | Reviewer identity and exact reviewed SHA; severity/disposition |
| RELEASE_RECEIPT | GitHub deployment/Vercel receipt | Code SHA and environment; never inferred from mere merge |
| PRODUCTION_OBSERVATION | Existing Atlas/Deming run ledger, metric events | Read-only references + measured result |
| REPLAY_RECEIPT | Existing Bayes replay_jobs, replay_job_checks | Actual settled/queued/excluded, not a builder assertion |

> **Source of truth** GitHub controls engineering approvals; FeeInsight runtime controls banking operations and production quality observations. Neither should impersonate the other.

### 6.1 Proposed contract representation

Use JSON in the existing acceptance directory to avoid introducing a YAML parser. Validate with the repository's TypeScript/Zod or existing test stack. The contract records test intent, not self-authored test success. The following example is illustrative; IDs and hashes are placeholders.

```json
{
  "schema_version": "1.0",
  "issue": "#<ISSUE>",
  "risk_tier": "R2",
  "base_sha": "<40-character-base-sha>",
  "scope": ["src/lib/agents/knox/**"],
  "required_skills": ["tdd", "adversarial-document-testing", "error-to-test"],
  "requirements": [
    {
      "id": "REQ-01",
      "behavior": "A transaction limit must not publish as a fee",
      "authority": "official source excerpt + stored text hash",
      "test_id": "knox.limit-vs-fee",
      "test_path": "src/lib/agents/knox/limit-guard.test.ts",
      "failure_signature": "expected rejected; got published"
    }
  ],
  "production_boundary": "NO_PROD_MUTATION",
  "human_approval_required": false
}
```

### 6.2 Evidence identity requirements

- Every accepted test has a stable test ID and explicit requirement mapping; a line count or green suite alone is not sufficient.
- Every RED proof names baseline code SHA, test commit/hash, fixture hash, command, exit code and expected assertion failure.
- Every GREEN proof names the current PR head SHA, same test identity, full guard result and run URL.
- Review verdict identifies GitHub reviewer, provider role if known, precise commit SHA, unresolved finding IDs and reviewed scope.
- Every production claim names deployed SHA, environment, observed period, Deming measurement version/cohort and Bayes replay state where relevant.
- CI artifacts must be generated in a trusted workflow with least-privileged permissions; committed markdown or JSON summaries are indexes, not cryptographic attestations.

## 7. Risk-tier routing and merge policy

| Tier / examples | Minimum evidence | Merge / production boundary |
| --- | --- | --- |
| R0: copy, markdown, non-executable design | Policy/path checks; source/copy review as relevant | Normal workflow; workflow/skills policy files never classified R0 |
| R1: UI, normal product logic | Contract, tests, targeted user journey, exact-head reviewer, normal CI | Standing routine merge authority after enforced gates |
| R2: data correctness, pipeline, analytics | Source-bound RED/GREEN, golden/adversarial, independent review, impact manifest, CI | Merge after gates; deployment effect remains unverified until measured |
| R3: security, auth, billing, permissions, migration, live mutation | R2 + threat review, isolated DB/prod dry-run, explicit owner authorization | No automatic protected action; sign-off required before sensitive effect |

Change-type classification must depend on the actual diff, not the issue label. A change to .github/workflows, policy scripts, agent instructions, skill files, credentials, authentication or deployment settings is always promoted to policy-sensitive review. The current CI optimization skips tests when PR changes are only Markdown/docs; acceptance contracts, AGENTS.md, CLAUDE.md and skills must be exceptions to that shortcut.

Required checks must run on the actual final PR head. Approval becomes stale on head change. Code-authored evidence cannot authorize protected settings changes. For a same-account Claude/Codex workflow, a separate reviewer token/identity or explicit human review is needed before calling the process independently enforced.

## 8. CI and GitHub implementation design

### 8.1 Proposed components

| Component | Location (proposed) | Behavior |
| --- | --- | --- |
| Contract schema/validator | src/lib/engineering-verification/* | Pure TypeScript reads/verifies requirements, identities, paths, risk/skills |
| Contract fixtures | docs/project/acceptance/engineering/* | Versioned contract JSON; code owners review changes |
| Evidence check | Existing .github/workflows/test.yml | In app-tests dependency graph, require gate check where applicable |
| RED proof job | Trusted GitHub Actions workflow or existing checks job | Run new test on base SHA with pinned fixture/test code; capture signature |
| Independent review check | GitHub API / required review settings | Reviewer author differs, decision addresses exact current SHA |
| Policy and permissions | GitHub ruleset + CODEOWNERS (approval controlled) | Protect contract, CI, skills, agent instructions, security paths |
| Evidence display | PR template + CI artifact/summary | Compact checklist linking actual runs, findings and production status |

### 8.2 Proposed deterministic gate algorithm

```text
on pull_request:
  require PR -> issue -> contract association
  classify risk from changed paths + contract (max severity)
  validate contract schema, ownership, frozen references
  if R1/R2/R3: verify requirement -> test mapping
  if R2/R3: verify RED baseline on base SHA and GREEN at head SHA
  run existing guard:legacy, typecheck, unit, quality and DB gates ONCE
  reject required SKIP, unknown evidence, altered protected expectation
  verify independent reviewer actor and reviewed SHA == PR head
  reject unresolved blocker or unauthorized sensitive action
  report pass/fail as trusted GitHub check
on deployment:
  link deploy SHA; collect Deming/Bayes evidence when measurable
  never label a merged PR production-verified merely for passing CI
```

A robust RED proof needs to use the new test code against the old implementation in a detached worktree or equivalent sandbox, without granting write credentials. A failure because the test does not compile, dependencies are absent or an external network call timed out is NOT a meaningful RED result. A proof must check an expected assertion and attach logs, exit code, baseline SHA and test hash.

### 8.3 Enforcement controls and known pitfalls

- Keep existing app-tests as the required aggregate and add the evidence job as a dependency only when its semantics are stable; do not mark a self-reported PR comment as a required check.
- Never run untrusted PR code under pull_request_target with secrets. For any two-stage artifact verification, trusted second-stage logic must parse data, not execute PR-authored scripts.
- Use read-only GITHUB_TOKEN where possible and separate approval for workflow, code ownership, ruleset and secrets changes; pin upstream Actions versions to approved SHA when doing security hardening.
- CODEOWNERS and required reviews must be configured and independently verified in GitHub settings; simply adding a CODEOWNERS file does not enforce approval.
- The existing published ruleset confirms app-tests plus branch deletion and non-fast-forward constraints; it does not by itself establish required pull-request reviews.
- A conventional builder/reviewer pair using one shared GitHub credential is not equivalent to independent enforcement.

## 9. Threat model and abuse-case controls

| Threat | Entry point | Prevent / detect |
| --- | --- | --- |
| Prompt injection from bank PDF | Untrusted source_documents/agent_source_texts | Treat as data; never promote instructions; adversarial fixture; source-hash lineage |
| Malicious instructions in skill or AGENTS.md | Agent policy / markdown changes | Sensitive path classification, independent CODEOWNER, review diff and behavior |
| CI exfiltration / arbitrary execution | Untrusted PR scripts / workflow edits | No secrets on PR runs; minimal permissions; trusted protected review for workflow changes |
| Acceptance criterion tampering | Builder changes contract/tests | Protected contract hash, base red proof, separate approver, test-diff scrutiny |
| False review from shared credential | AI reviewer posts under builder identity | Treat as advisory; enforce distinct GitHub review actor or owner signoff |
| Hidden skipped checks | Test framework / CI summary | Parse statuses; explicit NOT_TESTED; required skip blocks; fail closed |
| Deployment/result mismatch | Head SHA differs from deploy SHA | Signed GitHub/Vercel deployment receipt; compare SHAs; Deming/Bayes per deployment |
| Production damage from repair | Migration/takedown/paid work | Current explicit authorization, dry-run counts, limited permissions, no secret passing |

## 10. Runtime feedback: Deming, Bayes, Atlas

Deming remains the quality authority for observed bank-fee results, not the engineering approval actor. Its shadow lab replays frozen source text through selected pure stages; it explicitly does not reproduce all Rosetta conversion or all learned/provider paths. Its golden-set gate blocks certain regressions, but a partial replay cannot certify the whole pipeline. An independently designed acceptance case is therefore needed whenever the affected seam is outside Deming's replay reach.

Bayes owns replay manifests, replay_jobs and replay_job_checks. It must disclose affected, done, queued, excluded and not_counted states. Bayes never mutates fee rows; Magellan/Rosetta/Knox/Darwin/Hamilton retain reprocessing ownership and budgets. A code fix with 4,000 expected affected records and 3,800 processed is not complete by production criteria, even if the merge was clean.

Atlas retains operational run ledger and automation controls. It must expose a deployed fix's run events, blocked states, failure streaks and whether production work re-executed successfully. Engineering approval is outside Atlas and owned by GitHub.

### 10.1 Status and measurement contract

| Metric (proposed) | Definition | Caveat / source |
| --- | --- | --- |
| RED-proof coverage | R2/R3 merged changes with validated baseline RED / all R2/R3 merges | From trusted CI; target 100% |
| Independent exact-head coverage | Risk-eligible merges with valid separate review / all eligible merges | GitHub API; target 100% |
| Defect recurrence | Confirmed issue class repeats after merge and planned reprocessing | Deming cases/issue links; baseline to establish |
| Production verification lag | Elapsed time deployment → first sufficient measured outcome | Only measurable cohorts; report NOT_TESTED separately |
| Replay settlement | Affected done + authorized excluded / total affected | Bayes receipts; not_counted never treated as done |
| CI extra cost | Verification runtime/minutes versus existing baseline | Aim ≤ 15% incremental median; target, not current fact |

## 11. Exception, dispute and escalation policy

| Condition | Response | Authority |
| --- | --- | --- |
| Reviewer says FAIL | Builder fixes same PR, reviewer re-checks new SHA | Independent reviewer; no stale approval |
| RED cannot be reproduced | BLOCKED; record attempted seams and missing evidence | Issue owner selects new test seam or explicit lower-risk exception |
| Source evidence stale/missing | NOT_TESTED, not invented; source recapture or abstain | Magellan/Rosetta owner; no false bank claim |
| CI flake or infrastructure fault | Classify INFRA_BLOCKED; rerun bounded, log fingerprint | Trusted CI owner; never auto-convert to pass |
| Unmeasured production impact | PRODUCTION_UNVERIFIED with due/owner and access gap | Deming/Atlas/Bayes operational receipt |
| Security/production permission boundary | STOP, require explicit owner-authorized change | James / repository security administrator |

## 12. Implementation plan

| Milestone | Deliverable / engineering task | Acceptance / exit evidence |
| --- | --- | --- |
| M0 — Repository baseline | Inventory current rules, skills, existing red-proof coverage and workflow; choose one Knox/Darwin pilot | Published baseline + no production writes |
| M1 — Contracts | JSON schema, requirement/test IDs, risk classifier, PR template, skill routes | Schema tests pass; docs/contract paths no longer docs-only skip |
| M2 — Independent RED | Isolated baseline worktree, failure-signature parser, CI artifacts + retention | Known bug shows meaningful RED then GREEN; fake red rejected |
| M3 — Reviewer gate | Exact-head review validation, independent identity policy; protected paths | Forced stale approval rejected; sensitive path change blocked |
| M4 — Evidence/impact | Integrate deployment SHA with Deming & Bayes references in a read-only scorecard | At least one pilot issue has deploy + observed outcome or explicit unverified |
| M5 — Expand | Apply to data pipeline; then Hamilton and UX; measure cost and false blocks | No duplicate test execution; quality and time metrics reported |

Priority order: implement M0/M1 as an isolated code/document PR first. Test the proof loop manually before making new CI checks required. Enforcing GitHub settings is a separately approved security-setting change. Any database migration, paid-model activation, change to live fees or production reprocessing remains separately gated.

## 13. Formal acceptance test cases

| Case | Setup / action | Expected verdict |
| --- | --- | --- |
| AT-01 | Builder changes Knox rule; new test passes at both base and head | REJECT: not meaningful RED |
| AT-02 | New test fails on base with expected assertion and passes at current head | ACCEPT evidence, subject to rest of checks |
| AT-03 | Builder alters frozen contract / deletes negative test | BLOCK until authorized version change and independent review |
| AT-04 | Reviewer approves SHA A; builder pushes SHA B | REJECT stale attestation |
| AT-05 | PR modifies .claude/skills guidance only | Runs policy checks; must not take Markdown-only fast path |
| AT-06 | CI skips required database test without database | BLOCK/NOT_TESTED, never PASS |
| AT-07 | Data fix merged; production replay only partially done | DEPLOYED but PRODUCTION_UNVERIFIED |
| AT-08 | Prompt-injection phrase appears in bank PDF fixture | Treated as content; no shell/network/agent instruction executed |
| AT-09 | Builder & reviewer use the same GitHub approval actor | AI assessment advisory; not valid independent approval |
| AT-10 | PR changes security permissions or adds SQL migration | Explicit owner authorization remains required |

## 14. Alternatives, trade-offs and deferred decisions

| Alternative | Decision | Reason |
| --- | --- | --- |
| Install NMHP | Reject for present phase | Avoid new framework supply chain/runtime/permissions |
| Create new CTO runtime agent | Reject | Confuses software-delivery judgment with Atlas runtime; no need for extra platform |
| Add new Supabase verification tables now | Defer | GitHub and CI provide durable IDs and native storage for MVP |
| Single model reviews its own work | Reject for R2/R3 | Shared assumptions; independent test author and exact-head reviewer needed |
| Require every test on every docs change | Reject | Preserve efficiency while hardening policy-relevant docs paths |
| Human approval for all routine code | Not required if independent identities/gates enforceable | Preserve current clean-PR standing merge process; R3 remains explicitly gated |

- Decision to confirm before enforcement: which separate GitHub identity will authorize AI-reviewed changes, or whether James will personally approve all risk-qualified work.
- Decision to confirm before enforcement: exact minimum artifact-retention period and where evidence artifacts are stored for compliance/audits.
- Decision to confirm before operational scorecard: allowable lag for different production cohorts; no invented current SLO.
- Decision to confirm before any sensitive change: which GitHub ruleset/branch-protection permissions can be updated safely and by whom.

## 15. Reference registry and terminology

| Reference | Basis and significance |
| --- | --- |
| FeeInsight README | https://github.com/Gilmore3088/FeeInsight.com/blob/main/README.md — architecture, Node 22, named agent pipeline |
| Operating rules | .../blob/main/CLAUDE.md and .../blob/main/AGENTS.md — standing authorization and agent boundaries |
| Existing CI | .../blob/main/.github/workflows/test.yml — test topology and app-tests aggregation |
| Named skills | .../tree/main/.claude/skills — specialist skill sources |
| Deming/Bayes | .../blob/main/src/lib/agents/deming/AGENTS.md and .../bayes/AGENTS.md — quality/replay scope |
| GitHub ruleset | https://github.com/Gilmore3088/FeeInsight.com/rules/25335023 — active main, app-tests required |
| NMHP case study | User-supplied NMHP_WHITEPAPER.pdf (3 pp., Oct 30 2026) — motivation, not platform dependency |

> **Case-study caution** The NMHP paper reports 33 versus 10 confirmed findings on one application with one run each; this is not a general benchmark or evidence that FeeInsight already has those results. The proposed program must be evaluated against its own baseline.

