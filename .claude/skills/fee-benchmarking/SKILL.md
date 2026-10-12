---
name: fee-benchmarking
description: Peer comparison methodology for benchmarking bank and credit union fee schedules
triggers: benchmark, compare, peer, percentile, how does X compare, fee comparison, competitive pricing
---

# Fee Benchmarking Analysis

## Purpose
Evaluate an institution's fee schedule against peer and national benchmarks to identify competitive advantages, premium pricing, and outlier fees.

## Methodology

### Step 1: Define the Peer Group
Construct a peer cohort using three dimensions:
- **Charter type**: bank or credit_union (never mix)
- **Asset tier**: micro (<100M), small (100M-500M), community (500M-1B), mid (1B-10B), regional (10B-50B), large (50B+)
- **Fed district**: 1-12 (optional, use when geographic context matters)

Minimum viable peer group is 10 institutions. If the initial filter yields fewer than 10, relax the district constraint first, then widen the asset tier by one bracket in each direction.

### Step 2: Pull Benchmark Data
For each fee category in scope, retrieve:
- `national_median` (P50 across all institutions of same charter type)
- `peer_median` (P50 within the defined peer group)
- `peer_p25` and `peer_p75` (interquartile range)
- `peer_min` and `peer_max`
- `institution_count` (number of peers with data for that category)

Default to the 15 featured categories. Expand to all 49 if the user requests comprehensive analysis or specifies extended/comprehensive tier fees.

### Step 3: Compute Percentile Position
For each fee the target institution charges, calculate its percentile rank within the peer distribution. Use interpolated percentile (not nearest-rank) when the peer group exceeds 30 institutions.

### Step 4: Flag Outliers and Anomalies
Apply these rules:
- Fee > 2x peer_median: flag as **extreme outlier**
- Fee > peer_p75 + 1.5 * IQR: flag as **statistical outlier**
- Fee = $0.00 when peer_median > $0: flag as **waived/promotional**
- Missing fee when >80% of peers report it: flag as **data gap**

### Step 5: Generate Assessment
Classify each fee into a pricing band based on peer percentile rank.

## Statistical checks

Apply these to every benchmark before it is shown or written up (James, 2026-10-12, #1028 and
#1064). Deming runs the same checks every day (`src/lib/agents/deming/benchmark-health.ts`, the
`deming-benchmark-health` step), so the numbers below can be read from that step's detail
instead of recomputed.

- **Sample size.** State the number of institutions behind every median: one value per
  institution, as `src/lib/data-store/fee-stats.ts` computes it. Show a benchmark from 10
  institutions; mark it "limited sample" below 30.
- **Range around the median.** Give the 95% range by order statistics. With 10 institutions it
  runs from the 2nd to the 9th lowest value; with 30, from the 10th to the 21st
  (`medianRangeRanks`).
- **Coverage share** of the group. Covering most of a small group is close to a census, so say so.
- **Fallback level.** Use the state × size group from 10 covered institutions. Below that, use the
  Federal Reserve district at the same size, then the whole state across all sizes. Name the level
  used. Institutions over $10B are compared nationally and by district, never by state.
- **Coverage bias.** Compare covered and uncovered institutions in the group on assets (and
  charter type where it matters). Flag a group whose covered banks are clearly larger: Deming
  flags median covered assets at 2× the uncovered ones or more.
- **Collapse.** If a benchmark's institution count fell sharply since the last check (Deming
  alarms below 70% of the previous count), stop and find out why before using it. The
  2026-10-10 regression cut national medians to about 60 institutions.

## Output Template

### Fee Benchmark Scorecard: [Institution Name]
**Peer group**: [charter_type] | [asset_tier] | [district or "National"] | N=[institution_count]

| Category | Institution Fee | Peer P25 | Peer Median | Peer P75 | National Median | Percentile | Assessment |
|----------|----------------|----------|-------------|----------|-----------------|------------|------------|
| monthly_maintenance | $12.00 | $8.00 | $10.00 | $12.00 | $10.00 | P72 | Market Rate |
| overdraft | $35.00 | $30.00 | $33.00 | $35.00 | $34.00 | P76 | Premium |
| nsf | $35.00 | $28.00 | $32.00 | $35.00 | $33.00 | P78 | Premium |
| atm_non_network | $3.00 | $2.50 | $3.00 | $3.00 | $2.75 | P55 | Market Rate |
| wire_domestic_outgoing | $30.00 | $25.00 | $30.00 | $35.00 | $30.00 | P50 | Market Rate |
| card_foreign_txn | $0.00 | $1.00 | $2.00 | $3.00 | $2.00 | P0 | Waived |

**Summary**: X of Y fees at market rate, Z premium, W competitive, V waived/promotional.

### Flags
- List any outlier or anomaly flags with brief context.

## Interpretation Guide

| Percentile Range | Assessment | Meaning |
|------------------|------------|---------|
| P0 - P10 | Highly Competitive | Well below peers; possible loss leader or promotional |
| P10 - P25 | Competitive | Below most peers; consumer-friendly positioning |
| P25 - P75 | Market Rate | Within the interquartile range; standard pricing |
| P75 - P90 | Premium | Above most peers; may face competitive pressure |
| P90 - P100 | High Premium | Near top of market; risk of consumer attrition |
| >2x median | Extreme Outlier | Verify data accuracy before drawing conclusions |

## Caveats
- Maturity matters: only categories with `institution_count >= 10` produce reliable benchmarks. Note maturity level (strong/provisional/insufficient) for each row.
- Fee waivers and conditions (e.g., waived with direct deposit) are not captured in raw amounts. Note this limitation when overdraft or monthly_maintenance shows $0.
- Credit union fees trend 15-25% lower than bank fees for the same categories. Never benchmark across charter types.
- Asset tier is the strongest predictor of fee levels. District adds geographic context but explains less variance.
