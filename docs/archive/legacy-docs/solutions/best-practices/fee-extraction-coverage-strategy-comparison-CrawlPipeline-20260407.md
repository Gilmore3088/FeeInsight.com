---
module: Crawl Pipeline
date: 2026-04-07
problem_type: best_practice
component: tooling
symptoms:
  - "Low fee extraction coverage across large institutions (>$1B assets)"
  - "Many crawl_targets had stale/missing fee_schedule_urls yielding 0 fees"
  - "No systematic approach to prioritize coverage improvement strategies"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: high
tags: [coverage, extraction, url-research, crawl-strategy, data-quality]
---

# Best Practice: Fee Extraction Coverage Strategy Comparison

## Problem

Large institutions (>$1B assets) had poor fee extraction coverage. Many had stale URLs, missing URLs, or JS-rendered pages that the standard crawler could not handle. No systematic comparison of strategies existed to guide coverage investment.

## Environment

- Module: Crawl Pipeline (fee_crawler + extraction agents)
- Stack: Python 3.12, Playwright, Anthropic Haiku for extraction
- Database: Supabase PostgreSQL with ~5,167 crawl_targets
- Date: 2026-04-07

## Symptoms

- Hundreds of institutions with >$1B assets had 0 extracted fees despite having fee_schedule_urls
- 490 URLs (9.5%) were completely dead (404/403/503) — inflating coverage metrics
- JS-rendered fee schedule pages were nearly impossible to extract at scale
- No prioritization framework for which coverage gaps to attack first

## Strategies Tested

Five strategies were run in parallel on 2026-04-07 across ~1,776 institutions total.

### Strategy 1: Google URL Research (BEST ROI)

**Approach:** For institutions that had a URL but 0 fees, use Google search to find the correct fee schedule URL, then extract.

| Metric | Value |
|--------|-------|
| Targets | 276 institutions (>$1B, had URL, 0 fees) |
| URLs Found | 188 (68% find rate) |
| Fees Extracted | 90 institutions (33% end-to-end conversion) |
| Top Wins | Fulton Bank (48), Banc of California (46), Bank OZK (32), PNC (26) |
| Runtime | ~70 minutes |

**Why it works:** Many institutions had stale URLs pointing to generic disclosure pages. Google finds the actual fee schedule PDF/page that the original discovery missed.

### Strategy 2: Pattern-Based URL Probing

**Approach:** For institutions with NO fee_schedule_url at all, try 24 common URL patterns via HTTP HEAD requests (e.g., `/fee-schedule`, `/personal/fees.pdf`, `/disclosures/schedule-of-fees`).

| Metric | Value |
|--------|-------|
| Targets | 500 institutions (largest by assets, no URL) |
| URLs Found | 78 (16% find rate) |
| Fees Extracted | 28 institutions (36% of found, 5.6% end-to-end) |
| Top Wins | Fairfield County Bank (56), Pentagon FCU (48), BankNewport (46) |
| Runtime | ~2 hours 45 minutes |

**Why it's moderate:** HEAD requests pass on many error pages (200 status but 404 content). High false positive rate (~64%). Needs content validation post-HEAD.

### Strategy 3: Re-extraction (Existing URLs)

**Approach:** For institutions with existing URLs but fewer than 6 fees, re-run extraction hoping for better results.

| Metric | Value |
|--------|-------|
| Targets | 250 institutions (>$1B, 1-5 fees) |
| Improved | 17 (7% improvement rate) |
| Failed | 116 (46% — bot-blocking/timeouts) |
| Unchanged | 117 (kept existing data) |
| Top Win | A large Texas bank: 1 to 14 fees |
| Runtime | ~43 minutes |

**Why it's low ROI:** If the URL was wrong the first time, re-extracting from the same URL rarely helps. The 46% failure rate confirms large banks actively block automated crawling.

### Strategy 4: JS-Rendered Batch (LOWEST ROI)

**Approach:** Use Playwright with `networkidle` wait for institutions flagged as JS-rendered pages.

| Metric | Value |
|--------|-------|
| Targets | 250 institutions |
| Extracted | 6 (2.4% success rate) |
| Total Fees | 9 |
| Top Win | Commonwealth One FCU: 4 fees |
| Runtime | ~92 minutes |

**Why it fails:** Banking SPA frameworks are heavy and don't settle for `networkidle`. Most pages timeout at 45s. The `accessibe.com` accessibility widget link is a recurring false positive that gets followed as a "fee-related sub-link."

### Strategy 5: URL Health Check (Cleanup)

**Approach:** HTTP HEAD check all 5,167 existing fee_schedule_urls. Clear dead URLs, reject associated fees.

| Metric | Value |
|--------|-------|
| Targets | 5,167 URLs |
| Alive | 4,676 (90.5%) |
| Dead (cleared) | 490 (9.5%) |
| Actions | URL nulled, fees rejected with validation_flags |
| Runtime | ~86 minutes |

**Why it matters:** Dead URLs inflate coverage metrics and pollute the fee index. The 490 cleared institutions become candidates for Google URL research.

## Strategy Ranking

| Rank | Strategy | End-to-End Rate | Best For |
|------|----------|----------------|----------|
| 1 | Google URL Research | 33% | Institutions with stale/wrong URLs |
| 2 | URL Pattern Probing | 5.6% | Institutions with no URL at all |
| 3 | Re-extraction | 7% | Institutions with existing URLs + few fees |
| 4 | JS-rendered Batch | 2.4% | Avoid at scale — too low ROI |
| -- | URL Health Check | N/A (cleanup) | Run periodically to maintain data hygiene |

## Why This Works

The key insight is that **URL quality is the bottleneck, not extraction quality**. When the crawler has the right URL, extraction succeeds ~50% of the time. When the URL is wrong or stale, no amount of re-extraction helps.

Google search finds correct URLs at 68% because it indexes the actual fee schedule documents that institutions publish, bypassing the need to navigate their websites. Pattern probing works for common URL structures but has a high false positive rate because many banks return 200 OK for error pages.

## Prevention

- **Prioritize Google URL research** over all other coverage strategies for maximum ROI
- **Run URL health checks monthly** to catch URL rot early (9.5% dead rate accumulates)
- **Blacklist `accessibe.com`** URLs in sub-link discovery to avoid false positives
- **Add content validation** after URL probing HEAD requests (check for fee-related text)
- **Don't invest in JS-rendered extraction at scale** — only for high-value individual targets
- **After health checks, feed cleared institutions** into Google URL research pipeline

## Related Issues

- See also: [v3-crawler-automation-milestone.md](../crawl-pipeline/v3-crawler-automation-milestone.md)
- See also: [state-agent-e2e-learnings-20260406.md](../crawl-pipeline/state-agent-e2e-learnings-20260406.md)
