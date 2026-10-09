# Release acceptance requires real, current evidence

R10 / issue #983. The read-only `scripts/audit-launch-readiness.mjs` checks a
manifest against an explicit full commit and catalog snapshot. All ten required
checks need a reviewer, current timestamp, zero blocking issues, and a nonempty
local evidence file with a matching SHA-256 digest. Source-sensitive checks also
need the matching catalog snapshot. Owner approval must cover that exact commit.
The default release evidence window is 24 hours, with five minutes of clock skew.

Run:

```
node scripts/audit-launch-readiness.mjs docs/launch/acceptance.json --commit FULL_COMMIT_SHA --catalog-snapshot CATALOG_SNAPSHOT_ID
```

Exit 0 means the evidence record is complete and intact; exit 1 means blocked;
exit 2 means invalid invocation or unreadable evidence. This does not verify the
truth of a human assessment, certify fee accuracy, connect to production, or
replace a browser/Stripe/database integration test. A digest is not a signature.
The committed example is deliberately incomplete and must fail. Passing fixtures
exist only in tests and are explicitly synthetic. Do not copy them as live evidence.

Required evidence covers source-backed amounts and categories/units, institution
isolation, signup/checkout/access, duplicate requests/events, billing recovery and
cancellation, durable report delivery, an operator-led fee correction, build/tests/
security, and rollback/monitoring. Use the existing fee verification/accuracy
contract rather than inventing an accuracy metric here. Every evidence file must
state its test conditions, results, unresolved issues, and reviewer.

No actual launch evidence has been supplied by this implementation. R10 remains
blocked for launch acceptance until those real checks and approval exist.
