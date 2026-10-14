# 2026-10-09: the same-line re-decide published duplicates

**What happened:** PR 887 decided once more about 2,092 rows that had been skipped as identical to a
same-document line under another name. Within its first four publish runs (09:06 to 09:18 UTC) it
put 325 of them live. A live 10-row check found three that repeat a fee already live: 104684 "Wire
Transfers - Outgoing: Outgoing Wire Fee" beside 23698 "Outgoing Wire Fee", 104796 beside 35916, and
104784. A read-only pass over all 325 found 174 that repeat an older live line under the corrected
rule. A source spot check of 10 of the 174 found 10 true duplicates.

**Cause:** `selectLivePublishedFees` matches live lines on institution, category, variant and
frequency. Since their first skip, many of these rows had had their frequency re-read (for example
"per_item" became none). The live line each had been identical to no longer matched the frequency key,
so the identical check never saw it, and the row went live as a new fee. The 20-row source samples
before merge tested the page-text rule against the old twin directly, so they could not catch this.

**Fix:** PR 895 (merged 6be529d6): a re-decided row (`same_line_reselect`) runs its identical check
against every live line of its category, whatever the frequency or variant. This PR adds
`same-line-duplicates.ts`: a live fee published by the re-decide that repeats an older live line
(`sameLineDuplicateOf`) is flagged and comes down on its 12-hour second look. It is archived and its
verified row rejected, never deleted. If the older line is no longer live, the duplicate comes back.

**Lesson:** a re-decision of old rows must be checked against the live catalog with the keys
the rows have now, not the ones they had when first decided. Before a backlog re-select ships, take a
spot check of what it would publish under the live keys, not only of the rule on the old pair.
