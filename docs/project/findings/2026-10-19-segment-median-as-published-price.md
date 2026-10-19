# Named segment rows quote an institution median as a published fee

2026-10-19 · Hamilton #1993 / tracker #975

`getSegmentFeeValues` reduced several fees to one institution value, but omitted their
names and source-price records. Segment rows and narratives, the Intelligence institution
table and board/PDF input then quoted that number as the bank's fee. The market-study
query had the same loss before its named dot tooltip. For example, synthetic $1.65/$5
source prices produced a $3.325 statistic displayed as a $3.33 charge.

The readers now retain the existing `SeveralFees` representation and source prices.
Named rows, shared exhibits and board/PDF exports use the stated range and named fees;
prose quotes the range and points to the named table. They keep all recorded schedule
links; a range is not attributed to an arbitrarily
chosen first document. Segment range bars stay neutral instead of implying their median
is a price below the subject. The market-study dot positions still use institution values,
with labelled statistical meaning and source-price tooltips/details; ambiguous range
comparisons do not produce a highest/lowest-charge headline. Latest publication is labelled
as the newest record among the listed charges, not a schedule applicability/recheck date.
Mixed-range narrative comparisons and shared key-figure captions explicitly describe
institution values in group statistics. A zero median from source rows $0/$0/$5 is not
described as a bank charging only $0, and another bank's $4 is not named highest while
that range reaches $5. The original zero counts and comparison numbers remain intact;
ordinary one-price and true-zero prose is preserved.

Aggregate scalar amounts, populations, percentiles, schedule counting, zero handling and
overdraft's highest-tier policy are unchanged. Existing own-price NULL/range/no-rank
protections remain. This is read-time representation work: no extraction/verification/
publish version, statistics method version, cache policy, migration, provider, production
fee or standing decision is changed. Relates to #1911, where equal-price product-context
propagation and existing NULL ownership recovery remain open; this outcome does not
assign products or establish current source applicability. Old saved payloads with only
a single link remain readable.

**Guard:** `src/lib/data-store/segment-stated-prices.db.test.ts` executes the actual segment
and market-study SQL against connection-local copies of the production-schema fixture,
without public sequence consumption. It covers source prices, eligible/empty populations,
zero, duplicate-line numerical weighting, shared schedules, subject exclusion and the
existing overdraft rule. The SQL suite is in CI's E2E_TESTS inventory.
`src/lib/hamilton/segment-stated-prices.test.tsx` checks actual named rendering, claim/exhibit/
board projections, ordinary/zero/legacy controls and unchanged statistical fields.
It also executes `buildFeeAnswer` for mixed/zero-median ranges, equal-to-current medians,
both sides of a comparison and ordinary true-zero/single-price controls.
`src/components/hamilton/memo/answer-memo.test.tsx` preserves shared statistical key-figure
values while distinguishing them from named charges.
`src/lib/hamilton/segment-stated-prices.pdf.test.tsx` renders the actual board PDF and reads
its text. `src/lib/hamilton/intelligence-data.test.ts` guards the intermediary projection;
`src/lib/hamilton/studies-exhibits/market.test.ts` checks stated-price tooltips while keeping
the scalar, and `src/lib/own-fee.test.ts` checks the bounded schedule-link helper.

Before runtime edits, five rendering/wording regressions and three actual SQL regressions
failed, while three controls passed, on baseline1eb35b905. Their logs are preserved with
the review receipt. This demonstrates the code defect and its local correction, not a
measured production error count or global benchmark/accuracy improvement.
Independent review then found the remaining actual-answer narrative cases; seven
permanent controls failed before their wording correction. Their red/green receipt is
retained alongside the original SQL/rendering evidence.

Overlap review: #2172 owns active-institution filter hunks in fee-index (76f62950); #1779
owns optional peer conditions/filter options (53e89b0d); #1011's historical Intelligence
preview/source-evidence hunks (bd335d67) do not implement this correction. Their contracts
and unrelated scope are retained; exact patch receipts accompany the PR review.
