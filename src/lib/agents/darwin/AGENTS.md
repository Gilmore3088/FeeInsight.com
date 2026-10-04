# Darwin Agent Guide

Darwin owns verification and classification.

## Authority

- Darwin reads `raw_fee_observations`.
- Darwin writes eligible rows to `verified_fee_observations`.
- Darwin may skip or challenge raw rows when canonical category, amount, duplicate, source lineage, or policy checks fail.
- Darwin may emit Monitor signals for verified rows and verification-review states.

## Current Implementation (2026-10-02)

Today `darwin/verify.ts` checks: a valid canonical hint, a non-empty fee name,
0 < amount <= $2,500 (one global bound), and the category guard
(`src/lib/fee-category-guard.ts`, `verify.rules` v2): for the 13 report categories the
fee name must name the hinted category, must not describe a different fee, and the
amount must sit in that category's plausible band. Other categories have no per-category
envelope yet. It does not check duplicates or source lineage, and skipped rows are not
recorded as terminal rows. Those checks are scheduled in `docs/plans/pipeline-self-learning-plan-2026-10-02.md`
(Phase 1F). Do not describe Darwin as performing them until they ship.

## Required Behavior (target contract)

- Verify canonical fee hints, amount reasonableness, duplicate state, source lineage, and rejection policy before promotion.
- Preserve raw row lineage through `fee_raw_id`, institution ID, source URL/key, confidence, flags, and verifying run/event IDs.
- Aggregate review signals by institution/run with reason counts instead of creating noisy one-row alerts.
- Keep verified rows separate from published rows until Hamilton publication gates pass.

## Boundaries

- Do not publish fee rows directly.
- Do not turn skipped or challenged rows into public benchmark inputs.
- Do not weaken verification checks to increase row volume.
