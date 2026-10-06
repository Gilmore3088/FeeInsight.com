# Darwin Agent Guide

Darwin owns verification and classification.

## Authority

- Darwin reads `raw_fee_observations`.
- Darwin writes eligible rows to `verified_fee_observations`.
- Darwin may skip or challenge raw rows when canonical category, amount, duplicate, source lineage, or policy checks fail.
- Darwin may emit Monitor signals for verified rows and verification-review states.

## Current Implementation (2026-10-06, verify.rules version 3)

`darwin/verify.ts` checks, in order, and records the first failure as a reason code:

| Code | Rule | Decision |
|---|---|---|
| `missing_canonical` | a valid canonical hint | rejected |
| `missing_name` | a non-empty fee name | rejected |
| `category_mismatch` | for the 13 report categories, the fee name names its category and not a different fee (`src/lib/fee-category-guard.ts`) | rejected |
| `missing_lineage` | a source URL or stored document key | rejected |
| `invalid_amount` | an amount; $0 only with Knox's `knox_review:zero` flag | rejected |
| `outside_envelope` | a positive amount inside its category's range (`envelopes.ts`) | needs_review |
| `not_in_source` | the fee is stated in the stored text of the document Knox read it from (`checkFeeAgainstSource`, the shared accuracy check; a tiered price counts) | rejected |
| `peer_outlier` | pass 2: not far outside the state's peer range (below) | needs_review |
| `duplicate_in_batch` | the same fee line (institution, category, amount, frequency, source) not already verified in this batch | duplicate |
| `duplicate_verified` | the insert did not conflict with an existing verified row | duplicate |

- `not_in_source` (2026-10-06) runs the same check Hamilton's live-fee source check runs, so a
  fee the bank's schedule does not state is stopped before it is verified instead of being
  published and then taken down. It joined version 3 without a bump: a bump re-selects every
  decided row, and rows once held as `duplicate_in_batch` would be verified as second copies.
- Every decision is written to `pipeline_attempts` (stage `verify`, fingerprint
  `raw:<fee_raw_id>`) with `decision` and `reason_code`; a row decided under this rule
  version is never selected again, so skipped rows cannot starve the batch.
- Review signals carry `reason_counts` keyed by code, and the category range for
  `outside_envelope` rows.
- A verified $0 row carries the `zero_fee` flag, which is what lets Hamilton publish it.
- Pass 2 (`peer-checks.ts`, free, rows the rules accept), each its own strategy in
  `pipeline_attempts` (stage `verify`, fingerprint `raw:<fee_raw_id>`):
  - `verify.peer_range` v1: a positive amount below p25 / 3 or above p75 * 3 of its
    state peers (asset-size tier level when it has 8+ institutions, else the state-wide
    level; none with fewer than 8) is held as `needs_review` with reason code
    `peer_outlier` and the range in the reason and in the review signal's
    `peer_outliers`. Outcome `evidence_mismatch` when flagged, `ok` when inside.
  - `verify.second_source` v1: the same fee in another stored document of the same
    bank (an older copy or a sister document). Same amount: outcome `ok` and the
    verified row gets the `second_source_agrees` flag. Different amount only:
    `evidence_mismatch`, recorded as evidence, never blocking.
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
