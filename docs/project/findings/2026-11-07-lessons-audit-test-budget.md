# The complete lessons audit needs a repository-sized test budget

**Cause:** the test invoking the real `lessons-index-kill` audit used Vitest's default five-second budget. That audit checks the complete growing lessons, findings and decisions corpus. Its synchronous subprocess can finish successfully after the test budget expires.

**Evidence:** the full candidate suite failed only this test after 5,508 ms, explicitly with a timeout rather than an exit-status assertion failure. A focused unchanged rerun also timed out after 5,291 ms. Direct audit execution returned exit 0. The first run overlapped a production build; the focused failure shows that overlap is not its only reproducer.

**Fix:** give only this complete-corpus subprocess test a thirty-second budget. Its real command, complete input and exit-zero requirement remain intact. Synthetic failure and refusal cases keep their existing budgets; there is no global timeout increase or skipped test.

**Guard:** `scripts/ci-guards.test.ts` still requires the actual `lessons-index-kill` command to succeed. The direct command and full suite remain delivery checks. Tracked with Foundation #1048 in PR #2995.
