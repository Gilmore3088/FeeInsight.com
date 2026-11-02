# Switch inventory

Every `*_LIVE` name in `src/`, with its kind, file, code default, prod state, first commit, golden-set
replay and retire flag. Print it:

```sh
npm run switch-inventory                 # the full table and its counts (Markdown, on stdout)
npm run switch-inventory -- --missing    # facts lines to add for switches with no first commit recorded
```

The table is computed from the code each time and is not committed. Until 2026-11-02 it was
committed here, and every PR that added or flipped a switch regenerated it, so each switch PR
conflicted with the next one and main went red when two merged with stale counts
([finding](findings/2026-11-02-switch-inventory-doc-conflicts.md)).

What is committed:
- `src/lib/agents/deming/switch-inventory-facts.ts`: the facts the code cannot give, one line per
  switch. These are the first commit, an environment switch's prod value as a committed document
  records it, and an optional note. A new switch needs no line. To record its first commit later,
  add the line `--missing` prints.
- `src/lib/agents/deming/switch-inventory.test.ts`: the checks. Every `*_LIVE` name gets one row.
  Every switch has a golden-set replay or a stated reason (`NOT_REPLAYABLE_REASONS` in
  `switch-replay.ts`). The facts file has one line per entry, no duplicate, no line for a name
  that is no longer a switch, and prod state only on environment switches. This page holds no
  table or counts.

Plan step 4 (#2535): a switch turns on only after its golden-set receipt passes
(`src/lib/agents/deming/switch-gate.test.ts`; rule in `docs/project/DECISIONS.md`, 2026-11-01).

## How the columns are read

- **On in prod** comes from the code and committed docs only. A code constant is what `main`
  deploys. An environment switch is unknown unless the facts file records a committed document
  showing it set; Vercel is never read.
- **First seen in src** is the first commit whose diff adds the name under `src/` (`git log -S`).
  It comes from the facts file, or from git at print time for a switch with no line there. A
  shallow clone prints "unknown (shallow clone)".
- **Golden-set replay**: `full` (every read on the replay path takes the override), `full on
  shadow cases` (the regression members replay the PR head's own checks), `partial` (some reads
  keep the PR head's code value; the receipt names them), `sweep` (a database sweep's decision
  function runs over the golden set's publications, `src/lib/agents/deming/sweep-replay.ts`),
  `sweep, partial` (the sweep reads something the golden set lacks; the receipt names it) or
  `no: <reason>` (`NOT_REPLAYABLE_REASONS` in `switch-replay.ts`). A switch with neither a replay
  nor a reason fails the check. A `no` switch's receipt says "not replayable" with its reason; the
  switch gate fails a PR that turns it on unless that PR adds or rewords its reason line. It still
  needs its dry-run count and sample per the switch rule.
- **Retire candidate**: the code default is on, or the facts file records it on for 14+ days. Under
  the 14-day rule (DECISIONS, 2026-11-01) a switch on 14 days with no regression has its flag removed.
- **Note**: the facts file's note for that switch, if any.
- **Names that are not switches**: names that match `*_LIVE` but hold no on/off state (a test
  fixture, a pattern, a threshold, an alias). They are listed so the check covers every name.
