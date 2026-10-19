# Preserve applicability in exact duplicate publishing and collapse

Issue #2131, under Hamilton #975; related #1059/#1069. This change fixes the exact
publish/collapse cause demonstrated while reviewing #2121. It does not recover old
decisions, execute production repairs, change a switch or add a migration.

## Reproduction and resulting behavior

The actual runtime SELECT treated two synthetic live Coin Counting $5 rows as one fee
when one was business and the other consumer. The earlier publication was selected for
closure; reversing only the dates reversed which audience would disappear. The actual
pure publish helper likewise replaced or refused one audience beside the other. This
means a later exact-collapse pass could undo the distinct sibling restored correctly
by #2121. The proof used loopback-only temporary fixtures and dry-run SELECTs; it was
not evidence of a current production wrong-fee count.

The exact identity now includes normalized audience at every boundary: live-copy SQL,
pure decisions, sweep partition, batch ordering key and in-step copies. Consumer,
business, both and unknown are four separate applicability values. Legacy null means
unknown. Unknown never supplies another audience and both never acts as an exact
consumer/business wildcard. The old known-over-unknown preference is intentionally
removed for exact copies; uncertain applicability stays uncertain. An equivalent
unknown/null twin can still collapse, and true same-audience twins are still refused.

Variant, amount kind, dollar/rate value, rate basis and rate floor/cap remain part of
the represented exact identity. Existing per-event frequency aliases, the preference
for a stated frequency and conflicts between stated frequency classes remain in force.
Quarantined rows are excluded as collapse targets/keepers and exact-copy witnesses;
the final UPDATE rechecks hold/closure state before counting any actual change. The
separate insert-time operator hold continues to protect overlapping applicability.
Unrelated near-name and page-copy policies have not been expanded.

## Read-only impact

The full, uncapped before/after sweep predicates were compared with SELECT on
**2026-10-19 07:34:52 UTC**, using main `9d2feb55e` as baseline and the final identity
predicate. The current database contained **84,520 live publication rows**.

| Planned outcome | Before | After |
|---|---:|---:|
| Exact-collapse candidates |0|0|
| Additional removals |—|0|
| Prevented removals |—|0|
| Changed keepers |—|0|

There was no current target to retire under either predicate at that snapshot. Refining
partitions can otherwise expose true same-audience twins previously masked by another
audience's frequency conflict, so the comparison checked additional candidates as well
as prevented cross-audience closures. No candidate list was executed. The receipt is
`/tmp/feeinsight-audit-2026-10-18/exact-duplicate-impact-summary.json`, containing the
query and raw result. Future live cohorts can differ.

Publish stays at v3. Existing decided/skipped verified rows and historical duplicate
closures remain settled; the Bayes no-replay contract makes this explicit. No historical
loss count, automatic recovery or improved production accuracy rate is claimed.

## Verification

Pure and publish-level tests cover every distinct audience pair in both orders,
unknown/null equivalence, true in-step twins, dry runs, unrelated audience frequency
conflicts and variant/rate applicability in the step-copy map. Real PostgreSQL tests
run the actual live-copy selector and collapse SELECT/UPDATE, with audience matrix,
true-duplicate controls, represented value/frequency/variant/basis/bounds and held rows.
Two-connection regressions wait for an actual blocked UPDATE, commit a hold or closure
on its target, and verify that the resumed statement changes/counts nothing. These
tests are explicitly listed in CI's `E2E_TESTS`.

No new provider call, runtime surface, production write or replay was used for validation.
