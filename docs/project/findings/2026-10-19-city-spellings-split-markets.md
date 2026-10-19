# 2026-10-19: one city under several spellings counted as several markets
**What happened:** James saw Saint Petersburg, St Petersburg, St. Petersburg and St. Petersberg as
four Florida cities on the city explorer (#1780), and the same for Port St. Lucie. The state
directory, the state report's local markets and the city page each grouped branches by
`UPPER(city)` exactly as the FDIC Summary of Deposits and NCUA branch records spell it, so one
market split into several, an institution with branches under two spellings counted in both, and
"View all M" overstated M. How many cities and institutions this touches on prod was not measured
in this PR (no database access from the session); the count is still to be read.
**Cause:** the branch records are the regulators' own text: Saint/St/St., punctuation, case and
the odd misspelling vary by filer. No read folded them.
**Fix:** this PR. `src/lib/geo/city-names.ts` folds spellings to one key (Saint/St, Sainte/Ste,
Fort/Ft, Mount/Mt, punctuation, case, and a short list of known misspellings), read side only.
`getStateMarketCities` unions each city's institutions across its spellings before counting;
`getStateMarketFees` and `getCityMarket` read every spelling of their city; a second spelling's
city address redirects to the one the directory links to. Stored records are unchanged.
**Lesson:** any count by place name must fold spellings first. The same variation is likely in
`institution_sources.city` (headquarters), which the institution directory and headquarters
counts read without a fold; that is not checked here and is worth a read-only count before
anyone relies on headquarters-city totals (tracked as #2092).
