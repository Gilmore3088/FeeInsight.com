# 2026-10-19: the public "institutions monitored" count includes closed institutions
**What happened:** rewriting /about to explain what "monitored" means (James, Oct 19), the code
that computes it, `countMonitoredInstitutions` in `src/lib/public-stats.ts`, is
`SELECT COUNT(*) FROM institution_sources` with no filter. It counts rows the FDIC and NCUA
registry sync has marked `regulatory_status = 'inactive'` (closed), so "N% of monitored
institutions have fees in the index" on /about, the homepage and /methodology is computed over a
denominator that includes closed institutions. How many rows that is was not read (no database
access from this session).
**Cause:** the count predates the lesson in `../FINDINGS.md` (large-bank overdraft count, Oct 9):
"any coverage count over `institution_sources` excludes `regulatory_status = 'inactive'`".
**Fix:** #2144 (#1980, tracked here as #2091) counts only institutions the regulator has not
marked inactive, through `activeInstitutionFilter`. /about now says inactive institutions are left
out.
**Lesson:** read the query behind a public count before writing what the count means.
**Guard:** `src/lib/public-stats.test.ts` ("counts monitored and fee-publishing institutions only
where the regulator has not marked them inactive", added by #2144) fails if the count drops
`activeInstitutionFilter`.
