# FeeInsight engineering verification

This package implements the engineering verification mechanisms and records the complete M0–M5 plan. **Plan traceability, behavioral proof, existing CI, independent review and production outcomes are separate results.** Neither repository JSON nor a green local run authorizes a merge, deployment, security setting or production mutation.

The supplied [PRD](design-v1/prd-v1.md) and [technical design](design-v1/technical-design-v1.md) remain the source specifications. [program.json](program.json) maps all FR-01–22, SEC-01–08, AT-01–10 and UAT-01–10 requirements to implementation/test files, milestones and remaining activation dependencies. The [implementation plan](plan-validation.md) gives the current status, next actions, dependencies and exit evidence for M0–M5. `PLAN_TRACEABLE` checks that mapping; it does not mean the complete program is active.

## Commands

Run commands from the repository root with Node 22. Replace bracketed values with the actual issue/PR/commit identities. The CLI uses an authenticated read token from `GH_TOKEN` or `GITHUB_TOKEN`; do not put tokens in command arguments or committed files.

```sh
node src/lib/engineering-verification/cli.mjs validate
node src/lib/engineering-verification/cli.mjs inventory
node src/lib/engineering-verification/cli.mjs inventory --output test-results/engineering-verification/inventory
node src/lib/engineering-verification/cli.mjs prepare --pr <PR_NUMBER> --contract 1048-v2 --output test-results/engineering-verification/prepare
node src/lib/engineering-verification/cli.mjs audit --pr <PR_NUMBER> --output test-results/engineering-verification/audit
node src/lib/engineering-verification/cli.mjs scorecard --prs <PR_NUMBER>,<OTHER_PR_NUMBER> --output test-results/engineering-verification/scorecard
```

- `validate` checks source traceability and the finite registered revisions. Current execution checks the complete frozen chain; historical contracts retain their original raw identities and structure without being relabeled as current execution. Missing files, unknown requirements, altered source editions and changed current frozen inputs block validation.
- `inventory` reports available and missing skill routes plus the recorded [CI baseline](baseline.json). The three named UI skills now exist; their presence and routing do not establish adoption.
- `prepare` resolves the actual PR head through GitHub and checks the selected frozen contract before writing reviewable inputs.
- `audit` collects actual GitHub workflow, artifact, check, reviewer and deployment identities. It writes `audit.json` and `summary.md`; missing evidence remains blocked or unverified. It requires exactly one complete authenticated PR-body marker such as `<!-- engineering-contract: 1048-v2 -->`. An explicit flag must agree; unknown, duplicate, malformed or conflicting selectors block before execution. A historical pilot cannot substitute for that contract. Check publication is disabled while `policy.json` has `enforcement_enabled: false`.
- `scorecard` uses authenticated native GitHub collection for an explicit sample of up to twenty PRs. It reports proof/review coverage, latency and runner seconds with denominators, exclusions and missing evidence. It does not infer recurrence, billing cost, incremental CI overhead or production verification lag from those numbers. Imported JSON and injected test transports cannot establish authority.

For an approved, frozen operational policy, add `--operational-policy <PATH>` to `audit`. The file's SHA256 must match the reviewed contract. Supply the existing authenticated admin session through `ENGINEERING_ADMIN_COOKIE`, never through an argument or artifact. The collector reads only the fixed production admin evidence endpoint and never starts a run.

The proposed current deterministic adapter is selected explicitly:

```sh
node src/lib/engineering-verification/runner.mjs --head <EXACT_COMMIT_SHA> --contract 1048-v2 --output test-results/engineering-verification/financial-policy
```

The registry contains only `1048`, `2285` and `1048-v2`; there is no latest-version or caller-supplied path alias. `CURRENT` means the source supports that adapter, not that native acceptance exists. The v2 control-plane bootstrap still needs independent review, exact-head protected owner authorization and post-bootstrap trusted execution. Legacy selectors are historical-only and cannot start a new current proof.

It requires the approved digest-pinned Docker image, local source commits and the trusted dependency installation. It runs new, parent-owned assertions against the historical baseline and exact target. Containers have no network or credentials and use read-only mounts and resource caps. Setup failures and timeouts are invalid RED. Local receipts remain `LOCAL_SANDBOXED_UNTRUSTED` even when their behavioral assertions are correct. The hosted Actions runner, its ambient configuration (including Git info attributes), pinned Actions and the parent Node 22 installation remain platform trust; source binding does not make that host hermetic. Candidate snapshots use the frozen Git archive export, including the candidate commit’s attributes; this is not a claim that every exported byte equals the raw Git blob.

## Contract revisions

| Contract | Purpose | Risk and authority |
| --- | --- | --- |
| Historical `2285.json` / `EV-KNOX-2285` | Historical wire-clause extraction: preserve the incoming $5 / outgoing $10 pair and business eligibility, with negative controls | R2 synthetic issue-based fee-extraction evidence; no claim about current bank fees |
| Historical `1048.json` / `EV-FOUNDATION-1048` | Historical payment/provider/control risk routing and executable-document shortcut defects in the verifier itself | R3 verification-system bootstrap, independently asserted from PRD FR-02 / SEC-04; separate security approval required |
| Proposed `1048-v2.json` / `EV-FOUNDATION-1048-V2` | Source-backed financial risk and specialist routes, including paid-access precedence and conservative controls | R3 frozen classifier/runner/workflow version; native acceptance and trusted proof remain pending |

The two original contracts remain byte-for-byte unchanged. The changed shared execution chain makes their existing proofs historical-only for current decisions; authenticated historical behavioral proof never implies current `CODE_VERIFIED` or accepted review. Their native run, attempt, artifact, digest, frozen-source and retention checks still apply. Each legacy revision separately pins its reviewed historical workflow bytes and exact retained source commits; this binds the complete old preparation code and dependencies without claiming historical approval. V2 freezes its proof workflow, complete preparer/import closure, npm manifest/lock and local package archive. Extra npm configuration and nested package/module-resolution inputs block; canonical Git modes are checked before reading frozen execution bytes. A later workflow cannot redefine execution for the same accepted contract. The successor freezes new identities and does not rewrite old receipts. The Knox pilot cannot stand in for proof of changes to the verifier itself. Expected values live in trusted parent fixtures; candidate processes return values only. Changing a contract, fixture, adapter, execution file or approved toolchain invalidates affected proof.

## Trusted Actions and review

The manual workflow is `.github/workflows/engineering-verification.yml`, job `historical-proof`. The proposed version accepts `pr_number` and the explicit current key `1048-v2`, runs only from `main`, uses read permissions and retains artifacts for **90 days**. Artifact names include PR, head SHA and exact contract key so the pilots cannot mask each other. The trusted collector corroborates the actual run, attempt, job, workflow source, dependency identity and artifact contents. Setting `GITHUB_ACTIONS=true` locally cannot establish provenance. Orchestration must first land on the default branch; pre-bootstrap development runs remain untrusted.

Existing `test.yml` suites run once. The read-only audit workflow checks out trusted `main` and reads PR metadata; it never executes PR code. On proof completion, its authenticated `resolve-run` path resolves the artifact's PR and exact contract key, then rechecks the actual current PR head and contract marker. The audit is not a new prerequisite of `app-tests` during bootstrap. Check publication and separately controlled GitHub ruleset/reviewer activation remain disabled until authorized; [activation-proposal.md](activation-proposal.md) records the concrete proposal.

Contract reads reject nonregular files and escaping/symlink paths. Native reads walk bounded authenticated Git trees before reading Contents and bind the resulting blob identity; local reads check canonical components and the opened file. The selected raw identity and native PR contract marker are reread before final decisions; changing a declaration at the same head blocks the old selection. Registration alone cannot create acceptance or revive a superseded/revoked review.

Artifact availability ends at the earlier of the native API's `expires_at` and ninety days
from original workflow creation. An upload or later attempt does not restart that age.
The collector checks the configured retention against this original run epoch, while
still requiring the artifact to belong to the exact successful attempt. A request for
ninety-day retention does not promise ninety additional days after a delayed upload.

If GitHub omits a merged PR from a historical CI run's association list, a separate
`historical_head_identity` result requires native commit-to-PR association and identical
head/merge trees, alongside the existing repository, workflow, run/attempt and check/job
checks. It corroborates historical CI associated with that exact head and its identical
final merge tree. The historical checkout SHA/tree and triggering PR remain unknown;
this result cannot certify their identities or relax an open PR's merge gates.

For each required database group, CI points both database clients at the same loopback fixture and checks that configuration before testing. The `required-database-tests.mjs` guard checks Vitest's actual JSON assertion inventory against every selected file; missing files, empty inventories and skipped, pending, todo or nonpassing assertions block the job. Fixture catch-up and the pipeline use separate databases and reports. Actions retains those reports for ninety days, bound to the native run and attempt. This applies to the required database groups and does not certify optional unit cases or replace historical proof and review.

A human may include this marker in an actual GitHub review/comment, replacing every value with the frozen identity and listing **all actual changed files**:

```html
<!-- engineering-verification: {"head_sha":"<PR_HEAD_SHA>","contract_sha256":"<CONTRACT_SHA256>","policy_sha256":"<POLICY_SHA256>","reviewed_scope":["<CHANGED_FILE>"],"findings":[],"owner_signoff":true} -->
```

The marker has authority only through its authenticated GitHub actor/event. Claude or Codex is the selected independent engineering-agent reviewer; a distinct authorized GitHub reviewer principal is still unconfigured. Owner sign-off is reported separately. An approval from the PR author's account, including James's account when he authored the PR, cannot count as independent GitHub approval. Findings require severity, reproduction, owner, root-cause issue and disposition; fixed findings also name the resolved head and resolution reference. A new head or changed frozen policy invalidates prior binding.

## Source security and UI evidence

Frozen synthetic [PDF, HTML and plain-text fixtures](../../../../src/lib/engineering-verification/__fixtures__/source-injection/manifest.json) exercise actual normalization and the actual Knox/Rosetta paid-request builders with stubbed providers. The tests check trusted system instructions, unchanged source bytes, no exposed tools, unexpected shell/network/file/provider side effects and rejection of fabricated extraction rows. The shared source-data instruction boundary, strategy versions and role lessons record the process fix. This is deterministic offline coverage; it does not measure live-model obedience, establish universal injection immunity or validate current bank fees. Bootstrap CI and historical proofs executed; independent source-security acceptance and live-model obedience scoring remain pending.

The `buyer-journey-mapper`, `ux-ui-auditor` and `playwright-ux-simulator` skills now exist and are routed. The browser harness records successful screenshots and bounded sanitized diagnostics, requires a clean committed exact candidate and fresh production build in verification mode, and prevents server reuse. Capture assessment remains `LOCAL_BROWSER_UNTRUSTED` without authenticated workflow corroboration. The extended desktop/mobile journeys still require actual execution and independent review; file presence is not a journey receipt.

## Operational evidence and remaining activation

Operational policy separates `headSha` (reviewed PR code) from `deployedSha` (the authenticated production merge SHA). The read-only admin endpoint joins existing Atlas steps, Deming fixed-cohort observations and Bayes checks. A server-owned `step.execution` event supplies the historical deployment/environment binding. The API server's current build SHA and caller-supplied run parameters are insufficient. Historical steps without that event stay unverified.

An operational policy must also freeze `requiredExecution`: owning agent/step, strategy/version, one to fifty institution/source-document pairs and the supported output witness. The first adapter is `knox-extraction-attempt-v1` for `extract`/`extract-paid`. It checks native same-step extraction attempts, source-text/fingerprint lineage, actual inserted output, non-dry-run completion and deployment identity. Unsupported roles or insufficient native output stay unverified. Measurement rows, input parameters, aggregate counts and capped samples cannot replace this evidence.

The owning inventory includes failed/incomplete steps without output rows. Free extraction's global tails mean a different institution intent cannot prove nonoverlap. First complete coverage starts the outcome window; later relevant failure requires actual recovery. Native pre-call Deming/Bayes executor events must follow completion, and native persisted measurement timestamps determine duration/cadence. Pre-completion samples are explicitly ineligible; worker timestamps cannot stretch the verified interval. No threshold, live rerun or provider activation is granted by this reader.

The proposed default is **seven days**, with explicit frozen sample thresholds and cadence. A separately reviewed per-change window may differ. The initial policy requires the exact deployment SHA throughout observation; frequent releases can reset or prevent a seven-day window. Descendants are not silently accepted. Missing/stale samples, changed cohorts/scorers, queued/not-counted replay, unreconciled counts or unauthorized exclusions remain `PRODUCTION_UNVERIFIED`.

GitHub deployment/status labels `Production` and `production` refer to the policy's
canonical `production` environment. The adapter preserves their native spelling; it does
not normalize policy values, server-owned execution envelopes, preview environments or
other aliases. A successful deployment supplies lineage, not the required outcome window.

Remaining activation includes concrete owner security approval, a distinct reviewer identity, authentic post-bootstrap Actions proof, deployment/outcome observations and any separately authorized reruns. Broader UI/Hamilton contract adoption, actual browser evidence, independent private holdouts and corroborated multi-change scorecard acceptance remain explicit work in `program.json`. The native scorecard sampled two merged changes and remains partial; it does not complete M5. Current and authenticated historical behavioral proof coverage have separate denominators.

The Hamilton functional diagnostics now run desktop and phone report/research flows, including picker selection and the same saved artifact across contexts. Strict browser acceptance still blocks uncorroborated request cancellations; native same-document/action completion evidence remains M5 work. All failed requests are retained, and only the reviewed, explicitly corroborated prefetch case is classified as expected. The private sample is a separate local diagnostic whose expected values and case results stay outside builder tuning.

No command automatically rolls back, reprocesses live fees, changes GitHub protections, activates a paid provider, sends outreach or creates production tables.


## Optional native browser diagnostics

`ENGINEERING_PROTOCOL_CAPTURE=1` adds a separate `journey-browser-protocol` attachment to Hamilton journeys. The observer reads metadata from a caller-owned CDP session; it does not intercept requests, wrap fetch, drain bodies or change the strict v1 classification/gate. It obtains the actual protocol version and retains only generated local identities, explicit route templates, fixed protocol classes and ordered events. Header values, native IDs, action IDs, request/response bodies and raw protocol events remain transient.

These local attachments report `BLOCKED` or `LOCAL_PROTOCOL_UNTRUSTED`, with acceptance `NOT_ASSESSED`. Completeness is confined to registered sessions; workers, out-of-process frames and other unobserved targets remain unknown. Native EOF is transport evidence only. All action settlement and effects remain unknown, and cancellations stay blocking. A setup failure or incomplete capture is recorded with fixed safe codes. Expanded frozen contracts and real exact-build product execution are still required for M5 acceptance; neither the old historical pilot nor a minimal Chromium fixture supplies that acceptance.
