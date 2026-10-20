# 2026-10-19: rules-version churn starved Knox's stale re-read backlog
**What happened:** 254 fees in the W43 weekly live check were missing from the index. Read-only
prod queries on Oct 19 traced 198 of them to pages Knox never extracted, and 130 of those 198 sat
on pages whose last read used a rules version below v78. In the six hours before the check,
779 of Knox's 854 extract reads repeated a page already read at v78 or later. Only 17 reads
reached the stale backlog, and 12,449 of the 17,674 current pages were still last read below v78.

**Cause:** the Knox rules version moved from v80 to v88 in 18 hours. Each bump put the 722 texts
from $10B+ banks back at the front of `textArtifactQuery` (`src/lib/agents/knox/extract.ts`),
because they are re-read once per rules version and their ordering key ranked above everything
else. Stale and never-read pages only got the reads left over after them.

**Fix:** `staleReadFirstOrder` puts a current page with no read at v78 or later ahead of a large
bank's once-per-version repeat. The PR that adds this finding; tracked as a line on #2069.

**Lesson:** a queue that re-reads on every version bump needs a guarantee that untouched work
still drains. When versions move faster than one pass over the priority set, a strict priority
key starves everything below it. The fix is itself a strict key, which is safe only because the
stale set is finite: it refills only when `KNOX_STALE_READ_BELOW_VERSION` is raised. Until it
drains, re-reads of texts already read at v78+ (thin text, Hamilton rules-recheck misses, v82
twins, large-bank repeats) wait behind it; watch the rules-recheck re-reads first.

**Guard:** `extract.test.ts`, "reads a stale or unread current copy before a large bank's
once-per-version repeat", fails if the stale-first key leaves the ORDER BY or drops below the
asset key.
