# 2026-10-09: A fixed check never re-judged what it had already seen
**What happened:** after PR 471 changed Hamilton's current-copy verdict (2026-10-08 02:25 UTC), the
check flagged only 8 distinct fees in about 22 hours, and the hand check found none of them stale.
MFCU's $5 non-member cashier's check stayed live beside the bank's new $10 price. The check had
already looked at that copy before PR 471, so it never looked at it again.
**Cause:** each judged copy is recorded in `pipeline_attempts` with the fingerprint
`v<CURRENT_COPY_STRATEGY.version>:<older doc>:<current doc>`, and copies with a recorded fingerprint
are skipped. PR 471 changed the verdict but kept version 1, so attempts recorded under the old
verdict still matched.
**Fix:** PR 767 moved `CURRENT_COPY_STRATEGY` to version 2, so every superseded copy is judged again.
**Lesson:** when a fix changes how a fingerprinted check judges its input, bump that strategy's
version in the same PR, or the fix only reaches input the check has never seen.
