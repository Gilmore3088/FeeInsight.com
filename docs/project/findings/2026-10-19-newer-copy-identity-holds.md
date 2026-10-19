# Newer-copy fee identity and operator holds

Issues: #2117, #2118, #2121 (Hamilton tracker #975). Code/test changes only: no migration,
production mutation, provider work, manual rerun, switch change or historical replay.

## Result

An unrelated fee with the same price can no longer witness survival of an older fee.
The positive raw-row witness now requires the same institution, nonempty normalized
name, audience, frequency, amount kind/rate basis and available raw product scope.
Missing legacy audience means `unknown`, not a wildcard. Unstated frequency/product
matches only the same unstated value. Raw rows carry no canonical category or variant
field; this check does not invent one. Without a compatible witness, the existing
stored-source verdict decides. The same-URL pairing, Knox-read text, source grounding,
word-survival and two-shared-fee/50% schedule-recognition safeguards remain in force.

Operator quarantine wins at document selection, fee selection, defensive planning and
the final retirement/restoration writes. Final writes also preserve selected lineage.
A hold, closure or lineage change committed between selection and mutation cannot
retire the changed row or reject its verified lineage. Only the rows returned by the
guarded publication update can reject verified rows. Returned results and ledger
counts reflect actual updates; attempt detail retains `planned_retired` and
`planned_restored` to explain skipped writes. Dry runs write nothing.

Restoration additionally requires the exact selected closure reason and timestamp, so a
newer closure in the same `newer_copy_drops_fee:` family cannot be cleared using an old
decision. Timestamps are selected and bound as text, then cast to `timestamptz` on the server
to preserve full PostgreSQL microsecond precision; the driver's timestamp-array serializer
would otherwise truncate through Date. A legitimate restore at `.123456` is a regression case.

The restore duplicate guard also preserves audience, frequency, variant, amount kind,
rate basis and rate value distinctions (#2121). A live consumer fee cannot suppress a
source-stated business sibling. An equivalent live twin still prevents a duplicate
restoration; missing applicability is normalized equality, never a wildcard. The
unchanged dollar-only planner does not plan percentage-fee retirements or restorations;
the rate-value comparisons remain defensive identity checks.

## Fresh impact of the final witness predicate

Read-only production cohort recheck: **2026-10-19 07:08:11 UTC** (reference aggregate
snapshot: **06:59:02 UTC**). Baseline is current
main after #2112; the final SQL witness predicate is the one in this change, including
all identity dimensions above. This replaces the earlier name-only comparison of five
pending pairs/eight fees, which was insufficient to assess the final predicate.

| Measure | Before | After |
|---|---:|---:|
| Reference same-URL document pairs, including settled pairs |720|not replayed|
| Pending document pairs |7|7|
| Published rows in pending pairs |27|27|
| Pending quarantined rows |0|0|
| Pending positive raw-row witnesses |27|0|
| Pending planned retirements |0|0|
| Pending planned restores |0|0|

Fetched every pending pair's latest completed old/new normalized texts and every
eligible published fee, rather than only the amount-only subset. Replayed the existing
pure source/recognition planner with the old name-or-amount witness and with the final
identity witness. All **27 fees are `still_stated`** in their newer stored sources;
therefore no fee depends on the removed witness to survive. The selector/hold change
does not alter this snapshot because no pending row is quarantined. These are captured
official-source texts, not fresh bank-site checks of every applicable product/column.
Future copies may produce different decisions and still need the existing safeguards.

The **705 already-settled amount-only rows remain unreviewed**. They were counted to
make the boundary explicit, not replayed or approved for takedown. Existing v1 pair
fingerprints remain unchanged, so they stay closed. The deliberate no-replay contract
is recorded in Hamilton's guide and Bayes's `VERSIONS_WITHOUT_REPLAY`; tightening the
witness can retire more and does not use the old "only retire less" rationale.

Different-URL editions in #1945/#1911 remain outside this exact-URL sweep. Source edition,
effective date and product-column provenance must be verified separately; these issues
are not resolved by this change. Issue #1674's held-twin restore guard is also separate.

## Verification and reproduction

`newer-copy-retire.db.test.ts` runs the runtime SQL against loopback-only PostgreSQL
temporary tables and is explicitly included in CI's `E2E_TESTS`, alongside the existing
refresh-copy and accuracy-history database tests. It covers an unrelated same-priced
fee, positive identity despite a price difference, incompatible audience/basis/product
or institution, ambiguity, existing source safeguards, held rows, committed changes
between reads and writes, mixed updated/skipped rows, actual ledger counts, legitimate
restoration and closed v1 decisions. Pure tests cover defensive planning with held rows.
Interstatement test hooks simulate changes committed before the final statement; they
are not a claim of exhaustive concurrent correction or transaction stress coverage.

Assessment artifacts (SQL, captured rows/texts, per-fee source witness lines and replay
harness) are stored outside the checkout under `/tmp/feeinsight-audit-2026-10-18/`:
`retirement-final-impact-summary.json`, `retirement-finalized-pending-cohort.json` and
`retirement-final-pending-verdicts.json`. The final snapshot was gathered only with
SELECT; the replay called pure functions and performed no production writes.
