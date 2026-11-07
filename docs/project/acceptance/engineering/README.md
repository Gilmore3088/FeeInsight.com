# Fee Insight Engineering Verification — first implementation slice (M0/M1)

**Status:** scoped, non-enforcing engineering proposal. This directory is not a declaration of CI success, independent sign-off, bank-fee accuracy, deployment or reprocessing. No NMHP, external agent runtime, database tables, new production credentials or live-data operations.

## What is source of truth

- **Issue / PR:** existing GitHub issues and PRs. One fix, one owner, one branch, one PR; respect #1026 and existing tracker ownership.
- **Acceptance:** versioned JSON in this directory; its exact bytes are hashed when a contract is frozen. Test labels and expectations originate in a confirmed issue and source evidence, not the builder's narrative.
- **Engineering tests:** existing Vitest / Playwright, CI `app-tests`, test artifacts and distinct reviewer GitHub events. `STRUCTURALLY_VALID_UNTRUSTED` is not permission to merge.
- **Bank-data impact:** Deming independently measures a fixed cohort and regression outcome; Atlas identifies the actual run; Bayes reconciles affected/done/queued/excluded/not_counted when replay applies. Code GREEN never implies production verification.
- **Logical ERD:** GitHub issues/PRs, JSON, test IDs, GitHub Actions, review events, deployment receipts and existing Atlas/Deming/Bayes runtime data. No migration needed for these links.

## Phase M0/M1 contract API

`src/lib/engineering-verification/contract.mjs` exports `validateContract`, `classifyChange`, `routeSkills`, `assessProofPair`, `assessProductionEvidence` (structural readiness only), `contractDigest` and `mayUseDocsOnlyFastPath`. Import it from a trusted test/check context, not from a live fee-writing agent.

1. Risk is highest actual changed path, never a lower author label. Workflow, agent instructions, skills and acceptance contracts are **policy-sensitive even if Markdown/docs-only**. R3 requires separate authorization before sensitive operations.
2. Each R2/R3 requirement has a stable ID, source/issue authority, a test file and named test ID, plus expected behavioral failure signature. Unknowns, missing tests, duplicate IDs and unsafe scope fail validation.
3. RED means the **new test against the old defective code** failed on the named assertion, not missing imports, a network timeout or missing Postgres. GREEN means the *same test hash and fixture* passed at the current PR head; required skips block. For robust proof, run in an isolated detached worktree with the new tests copied from the proposal, using the current repository's trusted runner and retained artifacts. Do not execute PR-authored shell as a trusted workflow.
4. The proof parser only decides whether an evidence receipt is structurally usable. A *separate trusted check* must read the actual GitHub Actions run, immutable artifacts, base/head SHAs and independent reviewer actor. Author-submitted JSON cannot certify its own authenticity.
5. After merge, require deployed SHA + environment, observed Deming result + Atlas run, and, where relevant, Bayes count reconciliation before a *trusted*, separately authorized `OPERATIONALLY_VERIFIED` determination.

## Pilot: historical Knox issue #2285

- Confirmed synthetic defect: `Business Wire Fees` followed by `Wire Transfer Fee | $5 on Incoming Wires / $10 on Outgoing Domestic` previously admitted an incoming $10 with unknown audience. The original issue provides baseline `eee142d7c8289aad52f977e489e6b6d00ef2a07b`.
- Current regression test: `src/lib/agents/knox/wire-clause-prices.test.ts`, suite `a declined wire line keeps each price's own direction and its business heading (#2285)`.
- Target behavior: retain incoming $5 and outgoing $10 with explicit commercial eligibility in held observations; do not borrow the adjacent fee or assert unproven consumer eligibility.
- **Pilot status:** contract has been reconstructed and validator tests are part of this proposal. Detached **baseline RED has not been run or attested** by trusted CI in this work, and current-head GREEN, GitHub exact-head independent review, any deployment receipt, Deming result and Bayes settlement are **NOT_TESTED / PRODUCTION_UNVERIFIED**. The existing test's presence is not a fresh proof receipt.

## Controlled next stages — not enabled by this slice

- **M2:** trusted isolated baseline/test worktree runner; capture code SHA, contract/test/fixture hash, actual assertion log, GREEN + CI check receipts. Reject wrong/test-only RED. Measure before/after cost.
- **M3 (separately authorized):** reviewer actor and SHA gate, protected policy paths, ruleset enforcement; no shared-credential self-approval. Until enabled, this package does **not** prevent merging.
- **M4:** read-only deployment/Deming/Atlas/Bayes operational scoreboard; explicit `PRODUCTION_UNVERIFIED` for partial/missing cohorts.
- **M5:** expand only after one end-to-end pilot with independently verified evidence. No parallel testing farm, no new database tables, no NMHP install.
