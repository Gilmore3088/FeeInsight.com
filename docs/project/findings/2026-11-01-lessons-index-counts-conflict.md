# 2026-11-01: LESSONS.md's hand-kept counts made parallel PRs conflict, and drifted anyway

**What happened:** `docs/project/LESSONS.md` kept totals by hand: "N entries" under Decisions,
"N findings from `findings/`", a count on each of the 13 theme headings, and a per-agent role-lesson
table with "(N in all)". Adding one finding meant editing its line plus two count lines, so any two
PRs that each added a finding touched the same lines. PR #2842 has 5 commits that merge `origin/main`
into its branch (`gh pr view 2842 --json commits`); the builder reported every round as a conflict on
those count lines. The counts were also wrong: at `b6695f19d` (main just before #2842) the file said
"379 findings" with 386 files in `findings/`, and "Verification and publication (72)" over 73 lines.
At `92bb4e23e`, `findings/2026-10-30-no-fee-sentence-and-od-transfer-unit.md` was linked on two
lines (388 finding links for 387 files), and `lessons-index-kill` did not notice.

**Cause:** a derived number was stored next to the data it summarises, in a file every PR edits.
The guard checked that each finding had a line, not that it had only one, and nothing checked the
counts, so they were both a merge hotspot and unverified.

**Fix:** the counts are gone from LESSONS.md (the agent table keeps only each agent's file).
`lessons-index-kill` prints the finding and decision-entry counts it computes, fails a finding linked
on more than one line, and fails any hand-kept count that comes back (a heading ending "(N)", a line
opening "N findings" or "N entries", "(N in all)", or a count column in the agent table).
`lesson-kill` prints each agent's role-lesson count. The doubly linked finding now has one line
naming both of its lessons. Removing the counts alone still left a conflict when two PRs add a
line at the top of the same theme (both insert at one spot), so `.gitattributes` merges LESSONS.md
with git's built-in union driver, which keeps both lines. Union is safe only because the file now
has no counts (it would keep both "388" and "389") and because the guard fails a finding linked
twice, which is what a union of two edits to one line leaves behind. Simulated with `git merge-tree`
on two scratch branches (one adds a finding, one adds two, all in one theme): main conflicted, this
fix merges cleanly and the guard passes on the merged tree. Whether GitHub's own conflict check
honours the union driver was not tested; sessions merge `origin/main` locally before pushing, and
local git does.

**Lesson:** never hand-keep a total in a file that parallel PRs append to; let the guard compute it
and print it, and check that each indexed item appears exactly once.

**Guard:** `scripts/ci-guards.sh lessons-index-kill` and its tests in `scripts/ci-guards.test.ts`
("fails a hand-kept count", "fails a finding linked on two lines", "merges the repo's LESSONS.md
with git's union driver").
