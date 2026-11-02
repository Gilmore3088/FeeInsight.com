# 2026-11-02: every public page chose the sample report again just to link to it

**Lesson:** A yes/no that many pages ask should be cached as its own small answer. It should not
be derived each time from the large object it describes. `sampleReportAvailable()` returned
`loadSampleReport() !== null`. So every institution, fee-category, research, methodology and
check page had to do two things just to decide whether to show a "see a sample report" link:
- load the demo bank's whole custom-report market data, a cached read of one large entry;
- run `analyzeMarket` over it in the render.

When the demo bank's market did not pass the readiness bar, the page also loaded and analysed up
to 12 more candidate markets.

**What we saw:**
- "sample report" is the institution page's most frequent fallback: 639 misses of the
  15-second budget in the 24 hours to Nov 2 14:00 UTC (Vercel runtime errors).
- It runs last on the page, so part of that count is time other reads had already used.
- Its own cost per render has not been measured.
- James's Nov 1 site check also found the sample report page showing an empty skeleton for
  over 20 s on a cold load.

**Fix (`src/lib/custom-report/sample-report.ts`):**
- The chosen institution id (or none) is one cached public read, `sample-report-institution-v1`,
  with the same tag and lifetime as the other public reads.
- `sampleReportAvailable()` reads only that id.
- `loadSampleReport()` builds the report for the remembered id. It chooses again only when that
  market no longer passes.

**Guard:** `src/lib/custom-report/sample-report.test.ts`: availability is true when a market
passes and false when none does. The existing choice tests are unchanged.

**Still open:**
- A cold build of the demo bank's market data is still slow for the sample report page itself.
- `/research/market-concentration` is also over 15 s cold.
