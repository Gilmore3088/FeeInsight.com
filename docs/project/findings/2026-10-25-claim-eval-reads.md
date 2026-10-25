# 2026-10-25: Hamilton's paid eval took a written answer's filing figures as stated

**Lesson:** An eval that scores what a reader gets must use the gate that decides what the reader
gets, and must re-read each supported claim from its source row. A check that only asks whether the
tools saw a figure passes a filing that has since been refiled.

**What happened (#1077, claim contract step 7):** the paid answer eval's written sample (one of the
five a day) scored form with `writtenAnswerCheck` alone, not the one output gate (`gateAnswer`,
step 4). So the sentence binding, the account rule and the cause rule never touched the score.
Correctness tied the text's dollar figures to the live fee catalog. Every filing figure the tools
read (call-report income, assets, deposits, the filed peer median) went into `extra` and was
accepted as stated (`answer-correctness.ts` header limit; `paid-answer-eval.ts` header). A
credit union that refiled a quarter, or a row that left the table, still scored as correct. The
Simulate sample also did not pass `onGateShadow` to `writeSimulateRead`, so the `simulate_read`
shadow path (step 4) never wrote a record.

**Fix (no new provider call; sample size and cadence unchanged):**
- `paid-answer-eval.ts`: the written sample runs `gateAnswer` over the same reads, briefing
  evidence (`WrittenAnswerResult.briefingEvidence`, new) and identity the route uses. A `held`
  verdict fails form, and so does any problem in the verdict's own `check`, so form is never looser
  than before: an answer whose failing sentence the gate would only cut still fails. The sample
  keeps `gate: { status, critical, checkPassed }` so the run detail shows where the gate and
  today's check differ.
- `answer-correctness.ts`: `supportedFilingClaims` takes each sentence the binding supports and
  collects its `filing:` facts. For a derived quarter or a filed peer median it collects the
  input filings. `reconcileWrittenText` takes them with their live values: a changed value fails,
  and a row no longer on file fails. When there are claims and the re-read cannot run, the answer
  is unchecked, the same as when the catalog cannot be read.
- `src/lib/data-store/filing-reread.ts`: `readFilingValues` makes the re-read with plain selects:
  one on `institution_financial_records` for all keys, plus one per NCUA call line on
  `institution_call_report_items`. Values come back on the claim facts' terms: dollars from stored
  thousands, and the NCUA standalone quarter as year to date minus the prior quarter (the
  `QUARTER_SC` rule).
- The Simulate sample passes `onGateShadow`. Its record is written as its own
  `pro.answer_gate_shadow` run once the read is back. A recording that fails is logged and dropped,
  and the score does not change.

**How a score can move:** form on the written sample can now fail where it passed before (a gate
hold: wrong-institution "your", a nothing-left answer, an uncut stated cause). It can never pass
where it failed before. Correctness can now fail on a filing figure that was accepted before. No
threshold or baseline is stored in code for this eval; the run summary's counts are the record, so
the first runs after merge are the new baseline.

**Left open:** a filed peer median whose peer list was shortened names no input rows, so only
its stated value is known. A call-report quarter pruned to a cold file (#1870, waiting on James) is
not read and so reads as missing. Filing sentences the binding keeps as Hamilton's reading are
still accepted as stated.

**Guard:** `src/lib/hamilton/answer-correctness-filings.test.ts` (fake reader: unchanged passes,
changed fails, missing row fails, failed re-read is unchecked, a derived quarter re-reads its
inputs, a left-out sentence re-reads nothing), `src/lib/data-store/filing-reread.test.ts` (units,
NCUA quarter split, plain selects keyed by fact ID) and the step 7 cases in
`src/lib/hamilton/paid-answer-eval.test.ts` (same provider calls, gate-held form, Simulate shadow
recorded).
