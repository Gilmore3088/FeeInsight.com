# 2026-11-02: The golden set gated only PRs that named a switch, and most switches could not be replayed

**Lesson:** A measurement that runs only when a PR names a switch does not gate the pipeline. Most
pipeline changes flip no switch: a new Knox reader, a Darwin rule or a category fix ships on code
alone. The golden set must run on every PR that changes code it replays, compare the PR to main's
committed baseline, and fail on any drop. A switch it cannot replay must say why in the inventory,
or the PR that turns it on fails.

**What happened:** the Nov 2 read-only audit found four gaps in the Nov 1 gate (#2533, #2535):
- The CI step ran only on PRs whose diff names a `*_LIVE` switch, so a reader or rule change with
  no switch never ran the golden set.
- Only 10 of 106 switches could be replayed (2 full, 1 full on shadow cases, 7 partial). Every
  Darwin database sweep was "not replayable".
- A not-replayable switch counted as a pass in the receipt (#2886 turned one on that way).
- The audit put recall at 75.4% and precision at 95.5%. The committed baseline, on main as of
  #2890, measures recall 75.37% (1331/1766), precision 95.49% (1375/1440) and known-wrong refused
  88.50% (254/287), on 377 of 381 members (the 4 answer-key banks are not loaded offline).

**Cause:** the gate was built as a switch receipt, not as a regression gate. It had no baseline to
compare against, so it could only measure a switch off against on. Sweeps were left out because
they read the database, although each one's decision is a pure function of a fee row and its text.
The shadow lab's `currentVariant` is a comparison arm that has carried pins (until #2885 it read
daily caps with `dailyCapLines` off while the code had it on), so the gate measures its own
`headVariant`: every switch at its code value, no pins.

**Fix:**
- `src/lib/agents/deming/golden-gate.ts` measures the head at two stages, as published and after
  every sweep, and compares each member to the committed baseline
  `src/lib/agents/deming/__fixtures__/golden-gate-baseline.json`. The tolerance is zero: any lost
  expected fee, any new known-wrong fee, any member that let more through, or any drop in recall,
  precision or known-wrong refused fails. The committed baseline must equal the head, so a PR that
  improves the numbers commits the new baseline and the next PR is held to it.
- The path filter is the static import closure of the gate, plus the golden set, the baseline, the
  fixtures, `src/lib/agents/` and `src/lib/custom-report/source-check.ts`. CI computes it from the
  PR's changed files; a PR outside it skips the measure.
- `src/lib/agents/deming/sweep-replay.ts` runs 15 Darwin sweeps' decision functions over the
  golden set's published fees, so 24 more switches replay (14 sweep, 10 sweep partial).
- Every switch that still cannot be replayed has its reason in `NOT_REPLAYABLE_REASONS`, shown in
  the inventory's replay cell as `no: <reason>`. A switch with no reason shows `NO REASON`; the
  inventory test fails on one, and the switch gate fails a PR that turns on such a switch without
  stating its reason in `switch-replay.ts` in the same diff.

**Coverage:** before, 10 of 106 switches replayable and 96 "not replayable" with no reason. After,
34 of 106 replayable (2 full, 1 full on shadow cases, 7 partial, 14 sweep, 10 sweep partial) and
72 not replayable, each with a stated reason (`docs/project/switch-inventory.md`).

**What the sweeps showed:** run over the golden set's publications, most sweeps move no member.
Own unit (on) changed 5 members' frequencies with no change in score, and hourly changed one fee,
already its code value. With every sweep at its code value, the after-sweeps numbers equal the
published ones. A sweep pass is therefore mostly evidence that nothing regressed, and the receipt
says so. The set needs cases that each sweep would change.

**Still open:**
- 72 switches remain unreplayable. Most need Magellan, Rosetta or Atlas inputs that the frozen set
  does not hold (discovery, document capture, provider reads), or a database read with no pure
  decision function yet.
- The 4 answer-key banks are not measured offline.

**Guard:** `src/lib/agents/deming/golden-gate.test.ts` (compare, tolerance, path filter, and the
gate itself in CI), `src/lib/agents/deming/switch-gate.test.ts` (sweep probes, no-reason and
turned-on verdicts), `src/lib/agents/deming/switch-inventory.test.ts` (every unreplayable switch
states its reason).

**Agent lesson:** deming/golden-set-gates-every-pipeline-change
