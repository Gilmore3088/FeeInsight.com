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
naming both of its lessons.

With the counts gone, two PRs that add entries in different themes merge cleanly with no help.
Two PRs that add a line at the top of the same theme still clash, because both insert at one spot,
so `.gitattributes` merges LESSONS.md with git's built-in union driver, which keeps both lines.
GitHub's server-side merge is assumed not to honour `merge=union` (not tested), so the PR page
still shows that same-theme case as a conflict. A conflict GitHub reports is when CLAUDE.md allows
merging `main` into the branch; that local merge does honour union and resolves it with no hand
edit. Union saves the hand resolution, not the extra merge and CI round. A branch cut before this
fix has no `.gitattributes` in its working tree, so its first catch-up merge gets no union and
conflicts on the old count lines; after that merge union applies.

Union is safe for entry lines (finding and decision lines): two versions of one finding line leave
it linked twice, and two of one decision line leave its anchor with more lines than entries, and
the guard fails both. For the other lines (headings, preamble and section prose, the agent table)
the guard adds cheap shape checks: a heading twice, a `###` theme with no entries, a prose line
twice, and two adjacent prose lines whose first five words match (two rewordings of one line kept
side by side). A rewording that changes the first five words, or a prose line one side deleted
and the other edited, which union brings back, is not caught; the "To add one" paragraph asks a PR
that edits LESSONS.md prose to re-read the merged prose.

Simulated with `git merge-tree` on two scratch branches (one adds a finding, one adds two, all in
one theme): main conflicted; this fix merges cleanly and the guard passes on the merged tree.

**Lesson:** never hand-keep a total in a file that parallel PRs append to; let the guard compute it
and print it, and check that each indexed item appears exactly once.

**Guard:** `scripts/ci-guards.sh lessons-index-kill` and its tests in `scripts/ci-guards.test.ts`
("fails a hand-kept count", "fails a finding linked on two lines", "merges the repo's LESSONS.md
with git's union driver", "fails a union merge where both sides reworded the prose line", and
"cannot catch a deleted prose line that a parallel edit brings back", which pins the limit).
