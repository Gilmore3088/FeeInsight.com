# 2026-10-18: public data grew the database with no limit
**What happened:** on Oct 17 Supabase grew the disk twice, from 8 GB to 12 GB and then to 18 GB. The log trims (`2026-10-17-unbounded-log-growth.md`) covered the first jump. The second came from the public-data back-fill: `institution_call_report_items` reached about 3.6 GB and 8.7 million rows (7.2 million from the NCUA 5300 extras, 1.5 million from FFIEC call detail), and `area_statistics` about 1 GB. The database is now about 10 GB.
**Cause:** registry loaders upsert on natural keys, so reading a partition again overwrites its rows. Nothing limited how much a new source or a back-fill to 2010 could add. The storage alert sat at 9,000 MB, below the new size, so it warned every day and meant nothing. Its warning stayed in a run summary, so it never reached James.
**Fix:**
- The alert is now 13,000 MB (the 300 MB a day growth alert stays).
- Every table a Hoovie source writes has a size budget (`src/lib/agents/hoovie/size-budgets.ts`): 7,000 MB for call report items, 2,000 MB for `area_statistics` and a warning-only 1,000 MB default for the rest.
- Atlas's daily storage step measures each budgeted table and records which are over budget.
- A table over the 1,000 MB default is a warning only. The registry scheduler schedules nothing for a source that writes a table over its own budget until the table is measured back under budget or a PR raises the budget. With no measurement, it holds nothing.
- The morning brief email carries the storage warnings, only on a day with one.
- No data is deleted.
**Lesson:** a loader that can back-fill years of history needs a size limit before its first run, and a warning has to reach someone to count. Most budgets are not based on a measured size yet; tighten them once Atlas has recorded a week of sizes.
- The call-report back-fill was not finished: NCUA 5300 extras ran back to 2020 and FFIEC call detail to 2015, about 4.9 GB more. Both now stop at the quarters already loaded (`NCUA_EXTRAS_FIRST` 2023 Q2; `FFIEC_CALL_DETAIL_FIRST` 2023 Q1, so 2023 Q4 still loads to finish that year).
