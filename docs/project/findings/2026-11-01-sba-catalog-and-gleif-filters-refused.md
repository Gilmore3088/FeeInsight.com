# 2026-11-01: SBA catalog moved off CKAN and GLEIF refuses two filters
**What happened:** Prod partition receipts read 2026-11-01. The three `sba:*` partitions
(industry-events) returned HTTP 404 on every attempt since 2026-10-17 (21 attempts). The GLEIF
`lei-match-rssd`, `lei-match-fdic` and `lei-match-ncua` partitions returned HTTP 400 on page 1 of
every run since 2026-10-18 (19 attempts); `lei-match-name` waited on the RSSD pass and never ran.
The agent container could not reach either host until James allowed data.sba.gov and
api.gleif.org on 2026-11-01, so the loaders had never been checked against the live services.
**Cause:** SBA: data.sba.gov moved from CKAN to Drupal 11. `/api/3/action/package_show?id=7-a-504-foia`
is gone (404); the catalog is now DCAT-US at `https://data.sba.gov/data.json`, where the FOIA files are
the distributions of dataset `SBA-OHA-2016-08-001`, "7(a) & 504 FOIA" (files as of 2026-06-30). The
same files rename the required year column `ApprovalFiscalYear` to `ApprovalFY`, so a fixed address
alone would have loaded no rows. GLEIF: the lei-records filters are an allow-list.
`filter[entity.registeredAt.id]` and `filter[entity.legalAddress.region]` answer 400 "Filter should
contain only allowed values"; `filter[entity.registeredAt]=RA000744` and
`filter[entity.legalAddress.country]=US` are accepted (RA000744 FDIC 3,396 records, RA000745 NCUA
1,874, RA000748 NIC 130, checked live).
**Fix:** the SBA loader reads `data.json`, finds the dataset by identifier (title as fallback) and
names the gap if it is gone; the 7(a) and 504 aggregators accept `ApprovalFY` or
`ApprovalFiscalYear`. Live dry run of the parser on 2026-11-01: the 504 FY2010-present file read
117,983 rows into 37,206 lender groups and the 7(a) FY2020-present file 388,338 rows into 33,177
groups, no required column missing. The GLEIF walk uses `filter[entity.registeredAt]`; the name
search asks for the legal name in the US and keeps only records in the institution's state, which
`proposeByNameState` already checked.
**Lesson:** find a publisher's files through the catalog it publishes now, by a stable identifier,
and try every filter and header against the live service before calling a loader fixed. A loader
that fails the same way for two weeks needs its first failure looked at, not its twentieth.

**Agent lessons:** hoovie/sba-catalog-moved-off-ckan, hoovie/gleif-filter-allow-list
