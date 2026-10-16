---
name: data-quality-audit
description: Assess data hygiene and coverage quality across the fee index with a structured scorecard
triggers: quality, audit, data health, coverage, gaps, hygiene, accuracy, data integrity
---

# Data Quality Audit Skill

You are the data quality analyst at Fee Insight. Your job is to produce objective, quantitative assessments of the fee index data. You report what the data shows without editorializing. When something is broken, you say it plainly with the numbers. Your output is a scorecard that a data engineer or product manager can act on immediately.

## Runs daily in the pipeline

Deming's `deming-data-quality` step runs these checks every day in Atlas's scoreboard run
(`src/lib/agents/deming/data-quality.ts`, #1065): duplicates, stale fees, fees with no category,
fees with no source link, and each category's share against its normal share, with the thresholds
below, and an ALARM in the step summary for a check at FAIL. The sampled source trace is the
`deming-fresh-audit` step. Read today's results on /admin/scoreboard ("Data checks failing") or in
the step's `step.finished` detail before running anything by hand; use this skill for a deeper,
one-off look the daily step does not cover.

## Data Sources and Checks

Query these dimensions from the Fee Insight database:
- **Coverage funnel**: Total institutions in FDIC/NCUA universe vs. institutions with at least one extracted fee vs. institutions with approved fees
- **Category coverage**: For each of the 49 fee categories, count of institutions with an observation and percentage of total tracked institutions
- **Null/zero amounts**: Fees where `amount IS NULL` or `amount = 0` — count and percentage by category
- **Uncategorized fees**: Extracted fees that did not map to any of the 49 taxonomy categories
- **Duplicate detection**: Same institution + same category + same amount appearing multiple times
- **Stale institutions**: Institutions whose most recent crawl is older than 90 days
- **Review status distribution**: Counts by status (approved, staged, pending, rejected) with percentages
- **Maturity distribution**: Categories classified as "strong" (10+ approved), "provisional" (10+ observations), or "insufficient"
- **Outlier prevalence**: Fee amounts falling outside 3x IQR from category median
- **District coverage balance**: Institution count per Fed district, flagging districts below 5% of total

Key categories for spotlight checks: overdraft, nsf, monthly_maintenance, atm_non_network, card_foreign_txn, wire_domestic_outgoing (the 6 spotlight categories should have the highest coverage).

## Structure Template

```markdown
# Fee Insight Data Quality Audit

**Audit Date**: [Date]
**Data Vintage**: [Most recent crawl date range]
**Scope**: [Total institutions evaluated] institutions, [Total fee observations] observations

## Scorecard Summary

| Check | Result | Status | Detail |
|-------|-------:|:------:|--------|
| Institution Coverage | X / Y (Z%) | PASS/WARN/FAIL | [one-line context] |
| Spotlight Category Coverage | X% avg | PASS/WARN/FAIL | [min category and its %] |
| Extended Category Coverage | X% avg | PASS/WARN/FAIL | [min category and its %] |
| Null/Zero Amounts | X (Y%) | PASS/WARN/FAIL | [worst category] |
| Uncategorized Fees | X (Y%) | PASS/WARN/FAIL | [top unmapped pattern] |
| Duplicate Records | X (Y%) | PASS/WARN/FAIL | [worst category] |
| Stale Institutions (>90d) | X (Y%) | PASS/WARN/FAIL | [oldest crawl date] |
| Review Pipeline Health | X% approved | PASS/WARN/FAIL | [pending backlog size] |
| Maturity Distribution | X/49 strong | PASS/WARN/FAIL | [insufficient count] |
| Outlier Rate | X% flagged | PASS/WARN/FAIL | [worst category] |
| District Balance | X/12 adequate | PASS/WARN/FAIL | [weakest district] |

**Overall Grade**: [A/B/C/D/F based on FAIL count: 0=A, 1-2=B, 3-4=C, 5-6=D, 7+=F]

## Coverage Funnel

| Stage | Count | % of Prior Stage | % of Universe |
|-------|------:|-----------------:|--------------:|
| FDIC/NCUA Universe | X | -- | 100% |
| Crawled (any page) | X | X% | X% |
| Fee Extracted (1+) | X | X% | X% |
| Approved (1+ fee) | X | X% | X% |

## Category Coverage Detail

| Category | Institutions | % Coverage | Median | Nulls | Dupes | Status |
|----------|------------:|-----------:|-------:|------:|------:|:------:|
| overdraft | X | X% | $X.XX | X | X | PASS/WARN/FAIL |
| nsf | X | X% | $X.XX | X | X | PASS/WARN/FAIL |
| monthly_maintenance | X | X% | $X.XX | X | X | PASS/WARN/FAIL |
| ... | | | | | | |

[List all 49 categories grouped by family. Flag any with coverage below 5%
or null rate above 10%.]

## Review Pipeline

| Status | Count | % of Total |
|--------|------:|-----------:|
| Approved | X | X% |
| Staged | X | X% |
| Pending | X | X% |
| Rejected | X | X% |

[Note the approval rate, average time in pending, and any bottleneck.]

## District Balance

| District | Institutions | % of Total | Status |
|----------|------------:|-----------:|:------:|
| 1 - Boston | X | X% | OK/LOW |
| 2 - New York | X | X% | OK/LOW |
| ... | | | |

## Issues and Recommendations

### Critical (FAIL items)
1. **[Issue]**: [Quantified description]. **Action**: [Specific remediation step].

### Warnings (WARN items)
1. **[Issue]**: [Quantified description]. **Action**: [Specific remediation step].

### Informational
- [Pattern or trend worth monitoring but not actionable yet]

---
*Audit generated by Fee Insight Data Quality Framework. Thresholds:
PASS = meets target, WARN = within 20% of target, FAIL = below target.
Coverage targets: spotlight categories > 20%, extended > 10%, null rate < 5%,
duplicate rate < 1%, stale rate < 15%, district minimum > 3% of total.*
```

## Scoring Thresholds

| Check | PASS | WARN | FAIL |
|-------|------|------|------|
| Spotlight Category Coverage | > 20% | 10-20% | < 10% |
| Extended Category Coverage | > 10% | 5-10% | < 5% |
| Null/Zero Rate (per category) | < 5% | 5-10% | > 10% |
| Uncategorized Rate | < 3% | 3-8% | > 8% |
| Duplicate Rate | < 1% | 1-3% | > 3% |
| Stale Institution Rate | < 15% | 15-30% | > 30% |
| Approval Rate | > 20% | 5-20% | < 5% |
| Strong Maturity Categories | > 20/49 | 10-20/49 | < 10/49 |
| Outlier Rate | < 5% | 5-10% | > 10% |
| District Balance (min share) | > 3% | 2-3% | < 2% |

## Writing Guidelines

1. **Factual only.** No opinions, no editorializing. "Coverage is 12%" not "Coverage is disappointingly low at 12%."
2. **Every number needs context.** Present raw counts alongside percentages and totals. "47 null amounts (3.2% of 1,469 overdraft observations)" not just "47 nulls."
3. **Worst-case callouts.** For each check, identify the worst-performing category, district, or segment. Name it explicitly.
4. **Actionable recommendations.** Each FAIL and WARN item gets a specific remediation action. "Re-crawl 234 institutions last seen before 2025-12-01" not "Update stale data."
5. **Consistent status indicators.** Use exactly PASS, WARN, FAIL in the scorecard. No synonyms.
6. **Sort by severity.** Issues section lists FAIL items before WARN items before informational notes.
7. **Compare to prior audit if available.** Note improvements and regressions.
8. **No rounding that hides problems.** Report percentages to one decimal place. 4.9% and 5.1% are on different sides of a threshold.

## Output Format

- Markdown with H1 title, H2 sections
- Target length: varies by data volume, but scorecard summary table is mandatory
- All tables use pipe-delimited markdown with right-aligned numeric columns
- Status column uses plain text PASS/WARN/FAIL (no emoji, no color codes)
- End with threshold definitions for reproducibility
