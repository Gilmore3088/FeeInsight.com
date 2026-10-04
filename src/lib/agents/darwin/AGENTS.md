# Darwin Agent Guide

Darwin owns verification and classification.

## Authority

- Darwin reads `raw_fee_observations`.
- Darwin writes eligible rows to `verified_fee_observations`.
- Darwin may skip or challenge raw rows when canonical category, amount, duplicate, source lineage, or policy checks fail.
- Darwin may emit Monitor signals for verified rows and verification-review states.

## Current Implementation (2026-10-04, verify.rules version 2)

`darwin/verify.ts` checks, in order, and records the first failure as a reason code:

| Code | Rule | Decision |
|---|---|---|
| `missing_canonical` | a valid canonical hint | rejected |
| `missing_name` | a non-empty fee name | rejected |
| `category_mismatch` | for the 13 report categories, the fee name names its category and not a different fee (`src/lib/fee-category-guard.ts`) | rejected |
| `missing_lineage` | a source URL or stored document key | rejected |
| `invalid_amount` | an amount; $0 only with Knox's `knox_review:zero` flag | rejected |
| `outside_envelope` | a positive amount inside its category's range (`envelopes.ts`) | needs_review |
| `duplicate_in_batch` | the same fee line (institution, category, amount, frequency, source) not already verified in this batch | duplicate |
| `duplicate_verified` | the insert did not conflict with an existing verified row | duplicate |

- Every decision is written to `pipeline_attempts` (stage `verify`, fingerprint
  `raw:<fee_raw_id>`) with `decision` and `reason_code`; a row decided under this rule
  version is never selected again, so skipped rows cannot starve the batch.
- Review signals carry `reason_counts` keyed by code, and the category range for
  `outside_envelope` rows.
- A verified $0 row carries the `zero_fee` flag, which is what lets Hamilton publish it.
- The ranges in `envelopes.ts` are hand-set and deliberately wide. Learned p1/p99 ranges
  (`category_envelopes`) remain planned work.

## Required Behavior (target contract)

- Verify canonical fee hints, amount reasonableness, duplicate state, source lineage, and rejection policy before promotion.
- Preserve raw row lineage through `fee_raw_id`, institution ID, source URL/key, confidence, flags, and verifying run/event IDs.
- Aggregate review signals by institution/run with reason counts instead of creating noisy one-row alerts.
- Keep verified rows separate from published rows until Hamilton publication gates pass.

## Boundaries

- Do not publish fee rows directly.
- Do not turn skipped or challenged rows into public benchmark inputs.
- Do not weaken verification checks to increase row volume.
