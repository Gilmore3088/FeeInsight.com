# 2026-11-01: most `*_LIVE` switches cannot be replayed on the golden set

**What happened:** plan step 4 (#2535) asks every `*_LIVE` switch to pass the golden set (#2533)
before it turns on. `src/` holds 109 distinct `*_LIVE` names, counted after main gained
`DASH_LIST_ROWS_LIVE` (#2834), `LINE_CONFLICT_OWN_UNIT_LIVE` (#2835) and `AUDIENCE_V5_LIVE` (#2843). 10 are not switches: test fixture names, a pattern, a numeric threshold, an alias
and a keep-live list. That leaves 99 switches:
- 86 are code constants (`export const X_LIVE = true`).
- 1 is a map of constants (`RETENTION_LIVE`).
- 12 are read from the environment.

Only 10 can be replayed on the golden set today: 2 fully, 1 fully on its shadow cases and 7 partly.
The other 89 get a "not replayable" receipt (`docs/project/switch-inventory.md`, generated Nov 1).

**Cause:** the golden set replays a fresh read of a frozen document through the free Knox read,
Darwin's per-row verify and Hamilton's publish gate (`shadow-lab/variants.ts`). A switch can be held
on or off there only when the function that reads it takes an override parameter. Two things block
the rest:
- Most switches gate a sweep over already-published rows (a takedown, re-file or restore), or a
  database step (Atlas, Magellan, Hoovie, retention). A fresh read never runs that code.
- A switch read inside its own module (`CLUB_WITHDRAWAL_LIVE` built into a pattern at load, the
  `RESEARCH_SPLIT_LIVE` split table, a constant read by an internal helper) has no override, so the
  replay cannot flip it without editing production code. Of the 10 replayable switches, 7 are
  partial: some reads on the path keep the PR head's code value. Each receipt names those reads.

The Nov 1 replay of all 10 ran each switch off, then on, with no model calls. None got worse, and
three improved recall:
- `KNOX_HELD_NAME_RULES_LIVE`: 74.29% to 74.86% (+10 expected fees).
- `DASH_LIST_ROWS_LIVE`: 74.86% to 75.14% (+5 fees at state key 10272).
- `DAILY_CAP_LINES_LIVE`: 74.86% to 75.08% (+4 daily caps).

`NON_CUSTOMER_CASHIERS_CHECK_LIVE` refused 1 more known-wrong fee (88.50% to 88.85%). The other 6
moved no golden-set member, so their pass shows only that nothing regressed. A unit test per mapped
switch still shows that its override changes the pipeline on at least one input. CI cannot block
flipping a not-replayable switch, or an environment switch, which changes no file. Those rest on
process (DECISIONS, 2026-11-01).

**Fix:** this PR. It adds the golden-set replay per switch (`src/lib/agents/deming/switch-replay.ts`),
a CI receipt for each switch a PR's diff names (`switch-gate.test.ts`, unit shard 1) and the generated
inventory with its check (`switch-inventory.test.ts`). No flag is removed or flipped. The CI step
diffs against the first parent of GitHub's PR merge commit, not the event's `base.sha`: once main
moves, the merge commit is built on the newer main, and a diff against the old `base.sha` showed
#2842's lines as this PR's, naming a 7th switch.

**Lesson:** a new switch should take its value as a parameter (default: the constant) at every read
the free read, verify and publish path makes, so the golden set can hold it on and off. A switch
that only gates a sweep over live rows still needs its own dry-run count and sample against the bank's
document; a "not replayable" receipt does not pass it.

**Guard:** `src/lib/agents/deming/switch-inventory.test.ts` (a new switch without an inventory row
fails) and `src/lib/agents/deming/switch-gate.test.ts` (the PR receipt gate).
