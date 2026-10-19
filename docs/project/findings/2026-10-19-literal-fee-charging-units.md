# Literal charging units must survive the pipeline and the comparison boundary (#2248)

**Finding:** Source-grounded prices such as Milaca's `$1/page` and Oakwood's hourly,
page, image and statement charges reached raw and published rows with `per_item` or
blank frequency and no readable unit conditions. Merely restoring a note would still let
unlike prices enter category medians. A quarter-hour prefix could also become quarterly.

**Fix:** Newly inserted free and accepted paid rows bind a literal unit to their own exact
name and price, preserve the complete own clause as customer conditions, and keep that unit
through Darwin, Hamilton and frequency fill. Equal-price neighbors, incompatible repeated
owners, minima, delays and conflicting units supply no witness. Unit annotation supplies no
category or price authority; existing per-event and category-period guards stay in force.
Paper statements may retain literal `per_statement`, without inferring a calendar month.

Known special-unit rows remain visible but leave legacy mixed-unit comparisons. Shared SQL
and client predicates cover hourly, page, document, image, statement, half-hour, quarter-hour
and minute codes. Reports and local-competitor subject prices use the same boundary; cache
keys and dataset stamps carry statistics method 17/18. The measured current impact was 915
existing hourly rows at 735 distinct institutions, not 735 removed deduplicated market values.

Historical raw insert conflicts and direct held/superseded rechecks preserve their IDs,
conditions, frequencies and holds rather than silently recovering metadata. Blank and legacy
`per_item` values are not reinterpreted. No price conversion, database migration, historical
hourly switch, provider activation or production data patch is part of this code phase.

**Guard:** `own-fee-unit.test.ts` binds the hash-checked Milaca source and negative ownership
controls; `wrapped-fee-bullets.db.test.ts` runs fresh and accepted-paid raw→Darwin→Hamilton
stages, frequency fills, historical conflict/recheck preservation and actual PostgreSQL/client
normalization parity. `comparable-market-index.test.ts`, `report-evidence.test.ts`,
`tool-local-competitors.test.ts`, `fee-cache.test.ts` and `fee-stats.test.ts` protect subject,
population, cache and stamp parity. Independent tests additionally check all transport
whitespace; a separate code-path review maps the remaining numeric consumer families.
