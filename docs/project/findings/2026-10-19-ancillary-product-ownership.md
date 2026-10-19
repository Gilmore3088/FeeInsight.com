# 2026-10-19: Ancillary fees need their product applicability throughout the pipeline

**Problem (#1911 code phase).** U.S. Bank's Safe Debit pricing document gives explicit exceptions
to its general Consumer Pricing Information: money orders $1.65 and non-U.S.-Bank ATM transactions
$2.50. The general guide gives $5 and $3 respectively and delegates Safe Debit to its separate
guide. The official checking page still links that guide. Separate product applicability is not
supersession, even though the product document has the older printed date. The original issue's
blanket takedown premise was superseded by the source decision in
[the applicability receipt](https://github.com/Gilmore3088/FeeInsight.com/issues/1911#issuecomment-6264126683).

**Cause.** Knox assigned account names only to monthly-maintenance/minimum-balance rows. The
ancillary exceptions retained their prices but lost product ownership. Catalog already joins
`raw_fee_observations.product_name`; metadata missing at extraction cannot appear downstream.
Darwin's batch/second-source identity and Hamilton's prior, exact, in-step, same-line, near-name,
page-copy and copy-refresh/source witnesses also omitted or inconsistently compared this field.
Merely filling metadata would still leave cross-product skipping/closure paths.

**Initial regression evidence.** Before runtime edits on `ea5f99b0bd5b4fc919b0d7b8fa1ee7356f1d813b`,
three actual-schema SQL cases failed while 69 existing exact/refresh SQL controls passed: the
actual Safe Debit PDF's ancillary rows had no product, equal-priced represented products published
only one money-order line, and exact collapse closed a different-product line. The first source
witness correction was independently bounded by generic/mixed/column/budget and wrong-price
controls. No institution aliases or one-off row corrections were introduced.

**Source fixture.** Official bytes were captured with the reviewed bounded connection-pinned fee
source client on 2026-10-19 09:22:02–04 UTC and match the stored source bytes. The Safe Debit PDF
SHA256 is `553045b35ff39d4ebd18124dd744be7f4a59583c0930f0573bc1bea9748c288e` (one page; printed May12,2025).
The general guide SHA256 is `427392956ddc39068635e3f99111ac5fdf0df638fc5e52fee77314574da6082b`
(13 pages; printed Aug2026). Immutable fixtures exercise Rosetta's actual layout extraction.
This source applicability evidence authorizes no blanket retirement or historical mutation.

**Code phase.** `ANCILLARY_PRODUCT_VERSION` v1 (`ancillary_product:v1`) requires exactly one early
primary deposit-product document title and a bounded ACCOUNT TERMS AND FEES block, with the fee's
own label/price witnessed inside it. Independent product headings/columns, generic/non-deposit
headings, ambiguity, wrong prices and exceeded budgets remain unassigned. Literal title and
applicability clause are bank conditions; the own price excerpt remains frequency evidence.
Actual raw→Darwin→Hamilton/catalog tests retain both Safe Debit exceptions and the general
unassigned $3/$5 rows, show the existing public profile context, and repeat idempotently.
A separate generic product fixture passes without a bank-specific alias.

Ownership is **new raw lineage only**. Same-document insert conflicts—including ordinary due
re-reads, held takeovers and existing verified rows—retain the previous raw observation. Monthly
maintenance/minimum-balance lineup behavior, raw uniqueness and `line_share` are unchanged.
Simply rerunning the four current rows therefore cannot recover their missing product metadata.

Shared identity folds ASCII case and explicit transport whitespace, including NBSP, consistently
in JavaScript/PostgreSQL. Non-ASCII case/unsupported separators remain conservatively distinct.
Null/blank/unassigned is its own identity, never every product. Distinct represented products and
represented/unassigned pairs stay separate through the inventoried duplicate/classification,
publish, refresh, near-name/page-copy and current/newer-copy paths. Source-only approval of an
owned fee requires a compatible positive primary-document witness. Darwin checks new v1 ownership
again before verification. Operator hold, admin correction and restore-twin blockers retain their
conservative broader applicability; metadata cannot be used to bypass them.

Planned destructive/refresh pairs lock only their selected published members, verified lineage and
raw rows in stable ID order. After waits, the write checks the selected full published state,
exact raw lineage and normalized raw product; new refresh lineage/scalars are rechecked too.
Changed pairs are visible guard skips and actual counts come from RETURNING. Existing holds,
selected exact closure and full-precision timestamps remain protected. Two-session SQL controls
change raw product or lineage on either duplicate member while the writer waits. These selected-row
Read Committed guards do not claim serializable phantom-insertion isolation.

**Dated exposure, not recovery.** A SELECT-only snapshot at 2026-10-19 10:05:01.797495 UTC found
84,560 live/unheld rows, 2,201 represented-product rows, zero old exact-collapse candidates and zero
product-safe candidates under the complete final partition/frequency predicate. The four issue
rows (75916 $3,75925 $5,142603 $1.65,142604 $2.50) still had NULL product. The code prevents recurrence
on new v1 rows and restricts future matching; it does not repair those rows or change any pooled
numeric value. The local ownership fixture improves from 0/2 to 2/2, with general-price controls
unchanged; no current global scorecard increase or end-to-end historical recovery is claimed.

**Version/authorization boundary.** Extract83, stale-read78, verify3, batch-key4, publish3,
refresh2, current-copy2, newer-copy1 and source-check2 remain unchanged. Bayes records the v1
ownership evidence/no-replay exception; no selector, old fingerprint or rejudge floor reopens.
No migration, production write, provider work, switch, backfill, blanket takedown or numeric
benchmark policy change is included. Mixed sections/columns, exact metadata/rejudge recovery and
numeric aggregation policy remain explicit work in #1911, which stays open. Code PR relates to
that umbrella; only its bounded code checkbox can be completed after merge.

**Overlap.** PR1736 at `15b0340b38ff20c7303f604d1829a8f22d3af2dc` separately owns report-only category-context
options in the shared source checker. Its option contract is not absorbed here; this phase uses
the existing default checker signature and does not edit that module. PR2172's active-institution
readers remain with their owner; no catalog/stat/read-model policy edits are made here.

**Lesson.** Applicability is part of fee identity. Preserve the source-grounded product through
every actual consumer and final mutation, distinguish unknown from all-products, and separate
future correctness from a separately reviewed recovery of settled observations.

**Guard:** `src/lib/agents/knox/ancillary-product.test.ts` and
`src/lib/agents/knox/ancillary-product-ownership.db.test.ts` cover actual-source ownership,
raw conflicts, public catalog/profile projection, precision and actual SQL consumers;
`src/lib/agents/hamilton/product-identity.test.ts`, `exact-duplicate.db.test.ts`,
`refresh-copy.db.test.ts` and `newer-copy-retire.db.test.ts` cover identity, actual updates,
selected-state races and rollback/hold controls. The new SQL suite is in CI's `E2E_TESTS`.
