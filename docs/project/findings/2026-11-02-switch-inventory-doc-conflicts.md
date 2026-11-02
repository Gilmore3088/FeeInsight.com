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
  records it; `DOCUMENTED_ENV_STATE` is now derived from it) and an optional `note`. All 116
  first-seen cells moved there from the old doc, and the two "unknown (shallow clone)" cells were
  filled from git (PUBLISH_REPOINT_CURRENT_COPY_LIVE 2026-11-02 83cb85531,
  STALE_COPY_RETIRE_LIVE 2026-11-01 2250e6305). A new switch needs no line there: its first commit
  is read from git at print time. The file is switch tooling (`isSwitchTooling`), so naming a
  switch there does not count as defining or turning it on. So is the old page: the switch gate
  reads every changed file, docs included, and removing its 116 rows made this PR name all 116
  switches and fail "too many" until the page was added (`switch-gate.test.ts` covers both paths).
- `switch-inventory.test.ts` checks invariants against the code instead of a golden file. Every
  `*_LIVE` name gets one rendered row. The counts are computed from the rows. Every switch has a
  replay or a stated reason. The facts file has one entry per line, no duplicate (a line two PRs
  each changed and a union merge kept twice), no line for a name that is no longer a switch, and
  `prod` only on an environment switch. The explainer doc holds no table row and no "Switches: N"
  line.
- `.gitattributes` merges the facts file with git's union driver, as LESSONS.md does, so two PRs
  that add facts lines at the same spot keep both on a local merge. GitHub's server-side merge is
  assumed not to honour it.
- `docs/project/switch-inventory.md` is now a hand-written page: how to print the table, what is
  committed, and how each column is read.

**Proof:** two scratch switch PRs cut from one base, each adding a new constant switch in its own
file plus its `NOT_REPLAYABLE_REASONS` line (one at the top of the map, one further down), merged
with `git merge-tree --write-tree`:
- on main (e31a4313b), with each PR regenerating the doc as it had to: exit 1, `CONFLICT (content):
  Merge conflict in docs/project/switch-inventory.md`; `switch-replay.ts` auto-merged;
- on this branch: exit 0, and on the merged tree `switch-inventory.test.ts` passes (7 of 7) and
  `npm run switch-inventory` prints both new rows with first-seen read from git, and
  "Switches: 118".
All 116 printed switch rows match the old committed rows cell for cell, except the two first-seen
cells filled above.

**Not fixed here:** a switch PR still adds a line to `NOT_REPLAYABLE_REASONS` (or `SWITCH_REPLAYS`)
in `switch-replay.ts`, and new lines usually go at the top of the map. Two PRs that both insert
there still conflict, a smaller and separate hotspot; it is a checklist line on #1048.

**Lesson:** never commit a table the code can compute; print it on demand and test its invariants
against the code. Commit only the facts the code cannot give, one line per item, so parallel PRs
touch different lines.

**Guard:** `src/lib/agents/deming/switch-inventory.test.ts` ("commits no derived table or counts in
the explainer doc", "keeps the facts file to one well-formed line per current switch", "reads a
facts entry spread over lines, and both versions of a line a union merge kept").

**Agent lesson:** deming/derived-tables-are-printed-not-committed
