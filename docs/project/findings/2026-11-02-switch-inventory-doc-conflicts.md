# 2026-11-02: the committed switch inventory made every switch PR conflict, and main went red

**What happened:** `docs/project/switch-inventory.md` was generated from the code but committed,
and `switch-inventory.test.ts` failed unless the committed file matched the code byte for byte.
Every PR that added or flipped a `*_LIVE` switch regenerated the file on its own base, so:
- every other open switch PR conflicted as soon as one merged, because each had rewritten the same
  summary line ("Switches: N ... Retire candidates: N") and often neighbouring rows;
- a reviewed, green PR kept losing the race to main (#2892 needed 4 re-merges in one evening);
- main went red at dc18b3196 / e24be0d48. Two PRs merged with no textual conflict, but each had
  regenerated the counts on its own base, so the combined file said "On by code default: 83,
  Retire candidates: 86" while the code gave 82 and 85 (tracker line on #1048).

**Cause:** a table computed entirely from the code was stored next to the code, in a file every
switch PR edits. It is the same class as LESSONS.md's hand-kept counts
([finding](2026-11-01-lessons-index-counts-conflict.md)). The only cells the code could not
recompute cheaply were each switch's first commit (`git log -S` over full history, slow, and CI
checks out shallow) and the two environment switches' documented prod state, already a TS map.

**Fix:** the table is no longer committed.
- `npm run switch-inventory` (`scripts/switch-inventory.mjs`, a read-only audit: working tree plus
  `git log -S`, no network, no database, no environment values) prints the full table and its
  counts on demand. `-- --missing` prints facts lines for switches with no recorded first commit.
- `src/lib/agents/deming/switch-inventory-facts.ts` holds only what the code cannot give, one line
  per switch keyed by name: `firstSeen`, `prod` (an environment switch's value as a committed doc
  records it; `DOCUMENTED_ENV_STATE` is now derived from it) and an optional `note`. All 117
  first-seen cells moved there from the old doc, and the two "unknown (shallow clone)" cells were
  filled from git (PUBLISH_REPOINT_CURRENT_COPY_LIVE 2026-11-02 83cb85531,
  STALE_COPY_RETIRE_LIVE 2026-11-01 2250e6305). A new switch needs no line there: its first commit
  is read from git at print time. The file is switch tooling (`isSwitchTooling`), so naming a
  switch there does not count as defining or turning it on. So is the old page: the switch gate
  reads every changed file, docs included, and removing its rows made this PR name every
  switch and fail "too many" until the page was added (`switch-gate.test.ts` covers both paths).
- `switch-inventory.test.ts` checks invariants against the code instead of a golden file. Every
  `*_LIVE` name gets one rendered row. The counts are computed from the rows. Every switch has a
  replay or a stated reason. The facts file has one entry per line, no duplicate (a line two PRs
  each changed and a union merge kept twice), no line for a name that is no longer a switch, and
  `prod` only on an environment switch. The explainer doc holds no table row and no "Switches: N"
  line.
- `NOT_REPLAYABLE_REASONS` moved out of `switch-replay.ts` into
  `src/lib/agents/deming/switch-replay-reasons.ts`, together with its `SYSTEM`, `ONE_DOCUMENT` and
  `DATABASE()` helpers. Each switch PR adds a reason line, and before this every one inserted it
  at the top of an unsorted map, so any two switch PRs conflicted there too (review of #2922). The
  entries are now sorted by name, one per line. `switch-replay.ts` re-exports the map,
  `reasonsStatedInDiff` reads stated reasons from the new file (`NOT_REPLAYABLE_REASONS_PATH`),
  and the file is switch tooling.
- Both the facts and the reasons file are sorted by name, so a new switch's lines land at its own
  place in the alphabet. The test fails an unsorted entry, an entry spread over lines and a
  duplicate in either file (`mapEntryLines`), as well as a switch tooling file that defines a
  `*_LIVE` constant, which the scan would never see.
- The 16 recorded first commits that differed from `git log -S` on main were corrected from git.
  Those commits had been recorded on PR branches, and squash merges replaced them (for example
  HOLD_SOURCE_REREAD_LIVE, c068a6f827e to ea9a3dc3d). A recorded value is kept over git when the
  two differ, because git is slow on full history and CI is shallow. `npm run switch-inventory --
  --verify` lists any disagreements and exits 1, and it reported 0 after the correction.
- `.gitattributes` merges both files with git's union driver, as LESSONS.md does, so two PRs that
  insert at the same spot keep both lines on a local merge. GitHub's server-side merge is assumed
  not to honour it. The explainer page lists the union caveats: the order of two lines added at
  one spot, an edit kept in two versions, and a deletion that a parallel edit undoes.
- `docs/project/switch-inventory.md` is now a hand-written page: how to print the table, what is
  committed, how to merge the two files, and how each column is read.

**Proof:** scratch switch PRs cut from one base, merged with `git merge-tree --write-tree` and
also with a plain three-way `git merge-file`, which has no union and stands in for GitHub:
- Old design, main e31a4313b. Each PR adds a constant switch and its reason line, and regenerates
  the doc as it had to. Result: exit 1, `CONFLICT (content): Merge conflict in
  docs/project/switch-inventory.md`.
- This branch at 42b19bb4c, ALPHA_PROOF_LIVE and ZULU_PROOF_LIVE. Each PR adds the constant plus a
  reason line and a facts line at their sorted places. Result: merge-tree exit 0, and the plain
  merge has 0 conflicts in both files. On the merged tree, tsc passes (only the expected
  `@sparticuz/chromium` error), and the inventory, switch-gate (with the merged diff) and
  golden-gate tests pass (64 passed, 1 skipped). Both switches get not-replayable receipts and
  print as rows, with "Switches: 120".
- Same spot, PROOF_ONE_LIVE and PROOF_TWO_LIVE (both sort just before PROTECTION_ITEM_REFILE_LIVE).
  The plain merge has 1 conflict per file, which is what GitHub would show. Union (merge-tree)
  merges cleanly. With ONE as the branch, the merged tree passes all 64 tests. With TWO as the
  branch, union puts TWO first, and the two sort checks fail on the branch, as the explainer says.
  This stays on the branch and never reaches main.
- After merging main at f74a37eae (#2892 added FOOTNOTED_ATM_HEADING_LIVE, and this branch hit the
  same conflict on the old page), all 117 printed switch rows matched main's committed rows cell
  for cell. The exceptions were the two first-seen cells filled above, and the printed summary
  line matched main's.

**Lesson:** never commit a table the code can compute. Print it on demand and test its invariants
against the code. Commit only the facts the code cannot give, one sorted line per item, so
parallel PRs touch different lines.

**Guard:** `src/lib/agents/deming/switch-inventory.test.ts`:
- "commits no derived table or counts in the explainer doc";
- "keeps the facts file to one well-formed line per current switch";
- "keeps NOT_REPLAYABLE_REASONS to one line per switch, sorted by name, in its own file";
- "no switch tooling file defines a *_LIVE constant, so no switch hides from the scan";
- "reads a facts entry spread over lines, and both versions of a line a union merge kept".

**Agent lesson:** deming/derived-tables-are-printed-not-committed
