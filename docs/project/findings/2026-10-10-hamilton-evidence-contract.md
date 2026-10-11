# Hamilton needs record-bound evidence, not numerical-pool confidence

Related: #975, #981 (H06). Current-main base:
`a22efb7896772735e57f7dde59f070d304389ca6`.

## Reproduced gaps

The existing figure checker accepts a narrative number when its magnitude matches any
eligible payload value or arithmetic difference. It does not bind that number to the
institution, fee category, unit, reporting period, source record or direction expressed
by the sentence. PR #974 correctly contained the confidence language but was based on
an older main and did not address a separate unconditional high-confidence assignment
in `workspace/analysis-record.ts`.

A deterministic storyline can therefore be saved as `high` even though its saved
artifact contains no claim-level record bindings. A later model-written memo uses the
figure checker, creating two incompatible confidence semantics in the same saved-answer
path.

## This branch

- Carries #974's figure-only containment onto current main: numerical matches never
  earn high confidence; unmatched values stay low; qualitative prose stays explicitly
  unverified.
- Removes the independent unconditional high rating from deterministic storyline
  persistence. A storyline is medium-confidence and names whether structured evidence
  records were attached.
- Introduces an additive, typed evidence snapshot DTO. It reuses canonical
  `published_fee_catalog` / workspace provenance rather than creating a new source of
  truth. Facts bind institution, fee category, value/unit and source identity. The
  catalog publication timestamp is stored as the source `asOf` value; it is **not**
  mislabeled as a fee reporting/effective period. `reportingDate` remains null when
  the underlying workspace row does not prove one.
  Derived differences and percent changes are separate records with input fact IDs and
  a denominator where applicable.
- The Ask server now attaches a FeeResearch evidence snapshot when it files a storyline.
  Existing storage is JSON, so this requires no migration. The optional extra field is
  preserved by object spread when a memo updates the saved response.
- Comparison helpers reject mismatched category/unit/currency and unknown or mixed
  reporting periods. Percent change rejects a zero denominator. Signed differences are
  preserved; a $25 difference is not represented as Bank A's observed $25 fee.
- Null amounts do not become fee facts; genuine $0 amounts remain known values.

## Boundaries

This is H06-T01 containment and an H06-T02/T03 foundation, not semantic verification of
all Hamilton prose. Written free-form answers still need tool-output-to-fact binding,
and rendering/export must consume these IDs before H06-T04/T06/T08 can be accepted.
Account applicability is currently `unknown` where the existing workspace record does
not expose a safe audience field; it is not guessed. Likewise, a fee's publication/as-of
timestamp is not promoted to an effective/reporting period without source evidence.

Historical saved answers are not rewritten. The new medium-confidence policy applies to
newly produced artifacts on this branch. A future compatibility renderer can identify
older high ratings that lack structured evidence, but this patch does not mutate them.

No production data, schema, permissions, provider settings or model calls are changed.
No whole-dataset accuracy or consulting-readiness claim follows from these tests.
