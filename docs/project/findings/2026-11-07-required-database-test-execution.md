# Required database cases must execute before CI can pass

**Cause (#1048):** the pipeline CI step supplied `E2E_DATABASE_URL` but left the app's
`DATABASE_URL` unset. Two selected report-run cases require both clients to address the same
loopback fixture. Vitest could skip those cases and still return exit zero, so the green
`e2e` and `app-tests` jobs did not prove that every required database case ran.

**Evidence:** the fresh pipeline sweep at `286a16a8c` passed 1,479 cases and skipped two.
A separate local report-run invocation with matching URLs passed all eleven cases. That
follow-up covered the behavior locally; it did not repair the CI process or prove the
AT-06/UAT-05 missing-database gate. The completion audit of `4183574e7` identified the gap.

**Fix:** each required database group sets both URLs to its own throwaway database and
checks the configuration before running. Vitest writes a JSON execution report. A guard
requires every selected file exactly once, a nonempty executed assertion inventory, and
passing results for every required assertion. Missing reports, missing files, unknown
statuses and skipped, pending or todo assertions block the job. Fixture catch-up and
pipeline suites retain separate databases and run once. Their reports are retained as
run/attempt-bound Actions artifacts; authored local JSON alone grants no provenance.

**Scope:** this guard applies to the explicitly selected required database groups. It does
not claim that every optional or platform-specific unit case must execute, nor does a
database report establish independent review, trusted historical proof or production
acceptance.

**Guard:** `src/lib/engineering-verification/required-database-tests.test.ts` exercises
environment and real Vitest report semantics, including an actual skipped-case run.
`src/lib/engineering-verification/workflows.test.ts` executes the workflow shell with
intercepted commands to check matching clients, preflight/results guards and selected
inventories. Fresh PostgreSQL execution and final CI receipts remain the delivery evidence.
