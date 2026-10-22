# Pipeline Shadow Lab — First implementation (spec)

Given by James, 2026-10-21. Verbatim.

Build a deterministic, test-only replay harness within the existing Fee Insight repository under
pipeline tracker #1026.

Use existing Deming fixtures and six source-backed historical failure scenarios. Execute current
extraction and verification logic and a separately configurable experimental path against
identical frozen inputs.

Record stage-level outputs, source attribution, expected versus actual fees, missing-fee recall,
false publication, duplicate prevention, reprocessing stability and execution cost.

Use existing pure TypeScript functions and an isolated disposable PostgreSQL database where
needed. Do not modify production, trigger existing scheduled jobs, use paid AI providers,
introduce migrations, or add another agent or owner.

Deliver: One reproducible test command, one machine-readable comparison and one human-readable
report explaining which stages fail and what changes would address them.

Existing owner retains implementation responsibility. No replacement of production functionality
until independent evidence supports it.

## Why (James, same message)

"We're focused on fixing the data and not the reasons the data is wrong and we're fixing like
fifteen fees at a time and I don't think we have a solid foundation to continue building."
