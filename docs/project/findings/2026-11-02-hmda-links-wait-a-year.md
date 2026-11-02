# 2026-11-02: HMDA lenders from 2024 on were never linked, and new LEI links waited a year
**What happened:** Prod, read-only, 2026-11-02. `hmda_lenders` holds 39,068 lender-years and 5,190
are linked to an institution we track, all by RSSD from the 2021-2023 Reporter Panel. 2024 and 2025
(4,869 and 4,734 lenders) have none. On the same day the GLEIF lei-match partitions, fixed in #2850,
linked 3,703 institutions to the LEI GLEIF lists under their FDIC cert or NCUA charter. 3,292 of the
6,504 HMDA LEIs are among them. Every HMDA partition still refreshes only once a year (2024's next run
is 2027-10-19), so those links would not have reached a single HMDA row for about a year.
**Cause:** the FFIEC Reporter Panel, which gave each HMDA lender an RSSD, stopped after 2023, so 2024
on has no RSSD to match. The LEI route needs an institution's LEI, which we didn't have until the
GLEIF partitions worked. And identity was applied only while a state's LAR was re-read, so a better
identity source reached HMDA only at the next annual download.
**Fix:** new `relink-YYYY` partitions under the HMDA source (`magellan/registry/hmda-relink.ts`)
apply `matchHmdaIdentities` to the stored lenders of one year, with no download. They only fill:
an LEI match to exactly one institution, never RSSD alone, never a name+state proposal, never a held,
shared or contradicted identity, never a row that already has an institution or came from the panel.
Each run fills up to 300 lenders and copies the institution to that year's origination and loan-cost
cells. The switch `HMDA_RELINK_LIVE` is off: until it is on, each partition records weekly what it
would link and writes no HMDA row. Dry run against prod on 2026-11-02, by the same matcher: 2,957 of
2024's lenders and 2,923 of 2025's would link, 0 ambiguous.
**Open before switching on:** a filled link has no correction path yet. While ordinary identity
writes are off, the state loader keeps a stored `institution_id`, the relink only fills, and the
scoped repair plans only unlinked lenders. If GLEIF later moves or withdraws the LEI behind a fill,
the HMDA rows keep the old institution; if a hold is raised on it, every state partition of that
year with the lender stops on the loader's hold check. Turning the switch on should come with a
clear-when-withdrawn rule, or accept that limit knowingly.
**Lesson:** when a matching key's source improves, re-apply it to the rows already stored, as its
own step, rather than waiting for the next download of the data being matched.

**Agent lesson:** hoovie/issue-2232-relink-when-identity-improves
