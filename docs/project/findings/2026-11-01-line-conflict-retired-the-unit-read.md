# 2026-11-01: "One line, two reads" took down the correct read and kept the stale copy

**What happened:** The goal scorecard's wrong-after-publish rate (`goal.wrong_after_publish_7d`,
Nov 1 12:50 UTC snapshot) counted 59 of 165 take-downs of fees published in the last 7 days under
the reason `one line, two reads: kept #<id> (...)`, written by Darwin's live line-conflict re-check
(`src/lib/agents/darwin/line-conflict-check.ts`, check `darwin.line_conflict`). By 20:37 UTC the
same query found 68 (9 more in the afternoon).

**Cause, from read-only prod queries (Nov 1):** every one of the 68 is the same pattern. A newer
Knox read of a schedule line priced by a unit ("Photocopies | $.25 per page", "Statement or Check
Copy | $1/Document", "Paper Statement Mailed (Business) | $3 per Statement Cycle") carried the unit
the line prints (`per_page`, `per_document`, `per_statement`; Knox v139 and Hamilton's fill keep a
unit that its own line proves, #2248). The live copy of the same line, read before that, carried
`per_item`, `per_occurrence`, `monthly` or `quarterly`. Both copies stored the identical line.
Darwin's frequency step read the line with `frequencyFromLine`, which reads "per page" as per item,
so it kept the stale copy and retired the read that was right.

| Retired (newer read) vs kept (stale copy) | Rows |
|---|---|
| per_page vs per_item | 59 |
| per_page vs per_occurrence | 3 |
| per_statement vs monthly | 3 |
| per_document vs per_item | 2 |
| per_statement vs quarterly | 1 |

Why the two copies were both live (the document each came from):

| How the second read arrived | Rows |
|---|---|
| Newer capture of the same page; the stale copy's document is already marked superseded | 60 |
| A duplicate document copy (`duplicate_of_id`) re-read | 6 |
| The same document re-read | 1 |
| Another address for the same schedule | 1 |

None were two Knox strategies in one run (no pair shares an `agent_event_id`) and none were two
audience panels (two pairs differ in audience; both are frequency conflicts on one line). Hamilton's
publish did not stop the second copy, because each identity read compares frequency by class
(`selectLivePublishedFees`, `exactDuplicateDecision`), and `per_page` is not the class of
`per_item`. That is correct: the newer read is the right one, so the step to fix is the re-check
that chose between them.

**Fix:** line-conflict v2. Before the old frequency step, Darwin reads the unit each row's own
stored line prices the fee by (`specialUnitOnPriceLine`, the reader Knox and Hamilton's fill use).
When every line that names a unit names the same one and a row carries it, that unit is the line's
reading (`lineOwnUnit`):
- `LINE_CONFLICT_OWN_UNIT_LIVE` false (the default): the line is `own_unit`, kept apart and
  reported, and nothing on it is retired. The unit read stops being taken down at once.
- switched on: the row with the unit is kept and the rows without it are retired through the same
  12-hour second look (reason `one line, two reads: kept #<id> (frequency, unit: per_page)`).

- A row with no frequency stays, as in the old `line` step. A line where one copy's stored line
  names no unit, or another unit, while a row carries one is `undecided`: nothing on it is retired,
  switch on or off, so the old step can never take the unit read down again.
- The restore, same switch: the unit reads v1 already archived are brought back. Each step first
  reads every fee this check archived for its frequency (reason `... (frequency, ...`; a category
  takedown is never undone, or a unit read refused under one category would come back under it and
  loop) that carries a unit. One comes back when its own line and its kept twin's line read that
  unit, the twin is still live on the same line and category without it, and no other live copy
  carries it; one per line, the newest. In one write (all or none) it goes live again, its verified
  row is verified with `one_line_two_reads_restored`, its second look is cleared at weight 0, and
  the stale twin is retired (`one line, two reads: kept #<restored> (frequency, unit: per_page)`,
  verified row rejected with the flag), so the line never has two live copies; event
  `darwin.line_conflict_restored`.
- A restore can reverse a monthly read on a period category. 4862's "Paper Statement Fee (per
  statement cycle – minors and those over 65 exempt) | $3" comes back per_statement (165646, the
  newest of its two archived reads; 155279 stays down as the same line) over the monthly twin
  118815. That is right under #2248: the line prints the paper statement's own unit, "per
  statement cycle", and `settledFrequency` keeps `per_statement` on `paper_statement` when the line
  states it. The fee is charged for each statement the bank mails, which is a cycle, not a calendar
  month; three other per_statement restores (4779's two paper statement lines, 5280's returned
  quarterly statement) follow the same rule. They are the rows to look at before the switch goes on.

Darwin's own-unit re-file (`own-unit-check.ts`, `OWN_UNIT_REFILE_LIVE`, off) is the other way to
settle such a line: it moves the stale copy's frequency to the unit, after which the exact collapse
closes one of two identical copies.

**Dry run (prod read-only, Nov 1 20:30 UTC; 423 live rows on 210 conflicting lines, run through
`findLineConflicts` with no category model, so only the frequency lines are comparable):**
- v1 (today's code) would retire 23 more rows on its next steps: 20 per_page, 2 per_document,
  1 per_statement. Each is the correct unit read.
- v2, switch off: 25 lines are `own_unit`; 0 frequency-line rows retired.
- v2, switch on: 25 rows retired, each a stale per_item, per_occurrence or monthly copy beside the
  live unit read (20-row sample in the PR).

- Restore dry run (prod read-only, Nov 1 ~21:30 UTC, after the frequency-only and same-category
  rules): 139 archived frequency takedowns carry a unit (none of this check's category takedowns
  does); 127 would come back, each retiring its stale twin in the same write (113 per_page over
  per_item, 6 per_document over per_item, 4 per_page over per_occurrence, 3 per_statement over
  monthly, 1 per_statement over quarterly), 12 stay down (9 a second archived read of a line already
  restored, 2 with a live copy that already carries the unit, 1 whose lines do not read the unit).
  These include reads published before the 7-day window, so the count is larger than the 68.

**Secondary cause, not fixed here:** 60 of the 68 stale copies came from a document already marked
superseded by the newer capture, yet stayed live. Retiring a superseded edition's rows is the
current-copy check's job (PR #2809).

**Guard:** `src/lib/agents/darwin/line-conflict-check.test.ts` ("lineConflictVerdict v2: the line's
own unit"). Agent lesson: `darwin/line-conflict-keeps-the-unit-its-line-prints`.
