# 2026-11-01: Darwin found the line behind every fee, then threw it away

**What happened:** All 88,144 live fees (prod, Nov 1, read-only) have a `source_document_id`, but
none stores the line of that document it was read from. Each fee's line had already been found:
Darwin's verify (`verify.rules`) and its verified recheck (`verify.recheck`) both ask the shared
source check (`checkFeeAgainstSource`, through `sourceLineFor`) for the fee's line, then use it for
their checks and drop it. A verify attempt kept the line only when a check after the source check
failed (`detail.source_line`). So nobody could point at the text behind a live fee, and no number
said how many fees could be traced.

**Second problem:** the recheck reads a fee once per recheck version. On Nov 1, 88,143 of the
88,144 live fees already had a `verify.recheck` v5 attempt, so keeping the line on the recheck
alone would fill only newly verified fees (about 4,800 in the last 7 days); the other 83,000 would
never be read again.

**Fix:** `src/lib/source-line-trace.ts` builds a trace: the `agent_source_texts` id and the SHA-256
of the text the check read, the quoted line, and, when the line is printed verbatim, its
code-point span and line number (the evidence pilot's `locateQuote`, PR #2833). Darwin stores it as
`pipeline_attempts.detail.source_trace` on its verify and recheck attempts, with no new table and no
migration. A trace-only pass (`src/lib/agents/darwin/line-trace.ts`, `verify.line_trace` v1) runs
in each Darwin verify step that is not institution-scoped. It takes the next window of 200 live
fees below a cursor kept on the run ledger, skips fees already traced, and stops after 10 s, so it
never probes more than 200 fees a step however many are traced. It holds, rejects or takes down
nothing. The goal scorecard shows "line-traced" (`goal.line_traced`) on a fixed sample of 500 live
fees with its 95% range, because probing every live fee took 20-40 s on prod. The admin category
view shows the stored line under each fee.

**Measured:** 0 of 88,144 live fees had a stored line on Nov 1. On a read-only sample of 7 stored
texts under 9,000 characters (116 live fees), the check traced all 116, and 115 lines were printed
verbatim (with a span). The recheck ran 67 to 86 steps a day from Oct 25 to Oct 31, so at 200 a
step the trace pass reads all live fees in about 6 to 7 days.

**Lesson:** when a check finds the evidence for a decision, store that evidence with the decision.
A value that only lived inside the check can never be audited, counted or shown. A re-check that
reads each row once per version never revisits old rows unless something selects them, and a
"skip what is done" selection must be bounded by a cursor, or it walks past every finished row
each step.

**Guard:** `src/lib/source-line-trace.test.ts`, `src/lib/agents/darwin/line-trace.test.ts`, and the
`goal.line_traced` case in `src/lib/agents/goal-scorecard.test.ts`
