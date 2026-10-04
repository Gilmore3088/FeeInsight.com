# Fee data API brainstorm (2026-10-04)

Exploration only, not a build plan. Visual version: https://claude.ai/artifact/Bdefq2BrSJ9wt9NMVdic7w

Goal: let an outside publisher (betteranalyst.com) pull Bank Fee Index data.

## Already in the repo
- `src/app/api/v1/fees` — per-category medians, p25/p75, min/max, institution count.
- `src/app/api/v1/index` — same benchmarks filtered by state, charter, Fed district.
- `src/app/api/v1/institutions` — institution list, or one institution's published fees.
- `src/app/api/v1/openapi.json`, public docs at `/api-docs`.
- `src/lib/api-auth.ts` — `bfi_` keys (hashed in `api_keys`), issued manually.
- `src/lib/api-rate-limit.ts` — monthly limits: free 100, pro 10,000, enterprise unlimited.
- All reads go through `published_fee_catalog`.

## Proposed additions for a publisher
1. Receipts: `source_url` and read/publish date on every institution fee (both exist in `published_fee_catalog`, not returned today).
2. Sample size next to every median so weak state cells can be hidden.
3. Coverage feed: institutions and fees per state.
4. Monthly bulk file.
5. "Changed since" feed, once the re-check cadence stores prior values.

## Data readiness (live, read-only, 2026-10-04)
- 1,500 of 8,775 institutions have published fees (17%).
- Median 2 published fees per institution; 969 under 3; 179 with 10+.
- 3,252 of 5,957 published fees carry a source URL (55%).
- Most-covered category (counter_check) spans 323 institutions; overdraft 232.
- 0 API keys issued.

## Open decisions (James)
- Summaries only, or institution-level fees too?
- Attribution and/or payment terms.
- Freshness expectation (monthly matches the crawl cadence).
