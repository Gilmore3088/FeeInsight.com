# 2026-10-12: benchmarks built on about 60 institutions after a consumer-only filter

**What happened:** On 2026-10-12 at 04:36 UTC, `fee_index_cache` (`stats_method_version` 6)
computed the national overdraft median from 13 institutions and monthly maintenance from 10;
institution counts across all 25 categories summed to 81, while 3,860 institutions had live fees.
Commit `e6e4b2fa` (2026-10-10) had changed `statsRowFilter` in `src/lib/data-store/fee-stats.ts`
to count only `fee_audience IN ('consumer','both')`, but 74,710 of 74,933 live fees (99.7%) were
`unknown`, because migration `20270110000040_fee_audience_integrity.sql` left existing rows
unknown and no backfill followed. Every reader of `statsRowFilter` was affected: national and
state benchmarks, state expert peer levels, Darwin peer checks, fee alerts, the Pro digest and
Hamilton studies.

**Cause:** A stricter rule went live before the data it depends on existed. Knox's classifier
(`src/lib/fee-audience.ts`) only reads the fee's own line, so new rows stay mostly unknown too.

**Fix:** #1058 (James chose option A). `statsRowFilter` counts `unknown` as personal again,
keeps `business` rows and business-only schedules out, and `STATS_METHOD_VERSION` is 7, so
version-6 cache rows are ignored. Pages mark a figure an unknown row contributes to with an
asterisk and the footnote James approved, and the methodology page explains it. Still to come:
#1059 (Knox labels audience from document, section and line evidence, and relabels existing
rows), #1062 (Personal and Business tabs on the institution page), and the asterisk on the
surfaces #1058's PR lists as not yet covered.

**Lesson:** Before a rule narrows what counts, measure how much data passes it. A benchmark whose
sample collapses should fail loudly on the scorecard (#1040), not quietly turn "insufficient".
