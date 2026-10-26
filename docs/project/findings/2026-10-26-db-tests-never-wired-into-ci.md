# 2026-10-26: eight DB test suites never ran in CI
**What happened:** the #2717 review found that `src/lib/agents/knox/extract-findings.db.test.ts` passed CI without running. A sweep found eight `*.db.test.ts` files that `.github/workflows/test.yml` never names:
- `darwin/same-line-read-check`
- `darwin/verify-misses`
- `deming/error-fixes`
- `knox/extract-findings`
- `data-store/hamilton-peer-fees`
- `data-store/institution-unpublished`
- `data-store/saved-output-fee-refs`
- `tests/e2e/hamilton/fixtures`

Two of them (`same-line-read-check`, `verify-misses`) are cited in LESSONS.md or a PR as the guard for a fix.

**Cause:** a DB suite skips itself when `E2E_DATABASE_URL` is unset (`describe.skipIf`). The unit shards run every test file not excluded, so an unlisted DB suite is reported as skipped and the job stays green. Only the e2e job sets the database URL, and it runs exactly the files in `E2E_TESTS` and a few named variables. Nothing checked that a new DB suite was added to that list.

**Fix:**
- All eight files now run in the e2e job. Two were added in #2717 and six here. All of them passed locally against the e2e schema before they were wired in.
- `scripts/ci-guards.sh db-test-wiring-kill`, run in `guard:legacy`, fails a PR that adds a `*.db.test.ts` the workflow does not name.

**Guard:** `scripts/ci-guards.sh db-test-wiring-kill`.
