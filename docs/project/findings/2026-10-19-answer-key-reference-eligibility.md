# 2026-10-19: confirmed keys need document eligibility before measurement or teaching

**What happened:** #1862/#629 identified business-only, legacy closed-to-new and unpriced rates-hub
documents in confirmed answer keys. Independent readers also consumed those keys and old labels
without a common provenance boundary. Frozen Darwin fixtures mapped a historical text ID to today's
institution and could judge another document, although the original document mapping was absent.

**Cause:** human confirmation, reference applicability, source identity and scorer identity were
treated as interchangeable. A passing stored-text check cannot establish current consumer scope.

**Fix:** canonical #1862 adds bounded safe-source checks recorded as real-run ledger receipts,
atomic final identity guards and a shared fail-closed snapshot across scoring, feedback, training,
replay, caches and projections. Exact expected-fee changes start a distinct measurement cohort.
Legacy/unbound history remains stored and labelled; all-excluded is no measurement, not a pass.
The original frozen fixtures lack document mappings, so their runtime judgments/teaching are
explicitly unbound; offline history remains intact and holdout never teaches. See the
[reference contract](../../../src/lib/agents/deming/REFERENCE-ELIGIBILITY.md).

**Guard:** `src/lib/data-store/answer-key-eligibility-policy.test.ts`,
`src/lib/data-store/answer-key-eligibility.test.ts`,
`src/lib/data-store/answer-key-eligibility.db.test.ts`,
`src/lib/agents/answer-key-eligibility.test.ts`,
`src/lib/agents/rosetta/pdf-document-text.test.ts` and
`src/lib/agents/darwin/verdict-score.test.ts` cover policy, immutable provenance, actual SQL,
bounded cancellation, cohort projections and absent original frozen bindings. The three historical
regressions use issue-derived synthetic fixtures, not new live bank verification.

**Lesson:** preserve unknowns, the exact reference and its original receipt across every consumer.
A manifest describes available evidence; it cannot manufacture missing history. This change does
not establish live correctness or repair keys. James's weekly 50-institution workflow stays complete;
#2061/#1063 and the separate launch measurement remain outstanding, with no extra confirmations.

Verification also exercised the existing pipeline E2E fixture through the new bounded transport
factory. Its old mock covered only the standard fetch export, and its old key lacked byte/line
bindings; those test seams and synthetic source evidence were made explicit. The first factory
run may have attempted DNS resolution for synthetic test-bank hostnames; its recorded HTTP
observations were unsuccessful. Final E2E source calls use in-memory fixtures exclusively.
The SQL suites require the ordinary full-schema loopback fixture; a clear precondition now
prevents mistaking a missing public readiness table for a category-model regression.
