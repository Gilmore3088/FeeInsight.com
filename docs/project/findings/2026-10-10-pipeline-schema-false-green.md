# A green pipeline test was hiding missing database columns

R09 follow-up / #983. During combined release validation, all three pipeline
result assertions passed while six caught PostgreSQL errors were printed. The
snapshot fixture lacked `source_documents.superseded_by_id` and the fee-change
pairing columns from canonical migrations 20270110000004 and 20270110000030.
This is a test-coverage defect; it is not evidence that production lacks them.

The disposable schema now mirrors those migrations' additive columns, reference,
and current-copy index. No live migration, data backfill, pipeline runtime change,
or weakened production TLS setting is included. The pipeline test preserves its
console output but fails teardown on logged PostgreSQL missing-column (42703) or
missing-table (42P01) errors, even when its result assertions otherwise pass.

Regression evidence: the stricter test against a fresh copy of the old fixture
failed for the new schema-error assertion. The same test against a fresh aligned
fixture passed all three cases with no missing-object errors. The local database
was configured for TLS to match the unchanged application connection contract.
Fresh fixture databases matter: this suite is intentionally not a replay against
shared, previously populated data. Never run it against production or a shared DB.

This does not establish that every historical migration is represented by the
snapshot or that all caught runtime errors now fail tests. It closes the two
observed column gaps and adds an explicit missing-object failure gate.
