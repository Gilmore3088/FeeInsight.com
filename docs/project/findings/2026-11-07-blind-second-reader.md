# 2026-11-07: A blind second reader for the fees Knox never reads

**What happened:** answer-key score run 117 (`answer_key_score_runs` id 117, scored 2026-11-06 12:40
UTC) lists 45 hand-keyed fees on James's 8-bank cohort that Knox never read (`by_bank[].knox_missed`:
institution 395 17, 2267 3, 4888 6, 5410 3, 6109 8, 7229 6, 7815 2; 7723 is not in `by_bank`).
Knox is the deterministic rules extractor, so nothing in the pipeline reads a text a second way
and says which fees the rules skipped, except where the paid pass happens to run. James approved
(2026-11-07 04:30 UTC, "Yeah let's build it into the pipeline") a blind second reader: a model
reads the same stored text without seeing Knox's output and lists every fee with its exact line.

**What already existed, and what was reused:**
- `knox/paid-extract.ts` (the paid pass, `extract-paid`) already sends a stored text to a model and
  grounds each returned row (`groundPaidRow`, which uses `checkFeeAgainstSource`). It is not blind
  enough and not scoped: its request carries Knox's role and category lessons, it only selects texts
  the free read read thin (fewer than `KNOX_REEXTRACT_MAX_FEES` fees) and never re-reads a text hash
  it read before, and it writes every kept row as a raw candidate. The second reader reuses its
  instructions and fee list (`paidExtractInstructions`, `paidExtractPrompt`) and its grounding, and
  leaves its selection, lessons and writes alone.
- `knox/paid-find-misses.ts` already files each model find against today's free team on the same
  text (`free_read`, `free_other_category`, `free_held`, `free_missed`). The second reader's diff is
  this classifier unchanged; `free_missed` is the never-read flag.
- `deming/answer-key-rekey.ts` already ran a capped one-off paid batch with run-ledger events; the
  second reader follows its shape (provider step, tick scheduler, per-batch cap) but books under
  Knox's existing budget line, so no migration.
- `deming/shadow-lab` and `deming/knox-misses.ts` replay Knox against frozen texts and the answer
  key; neither reads a text with a model, so neither was extended.

**What was built** (`knox/second-reader.ts`, `knox/second-reader-schedule.ts`,
`knox/never-read-lessons.ts`):
- Step `knox-second-reader`, in PROVIDER_STEP_KEYS: the global provider stop and the tick's provider
  budget hold it, and each call goes through `paidModelCall` under `agent:knox`. Switch
  `KNOX_SECOND_READER_LIVE`, off by default: off, the step reads nothing and calls nothing, and the
  tick queues no run.
- The request is the paid pass's fixed instructions (cached block) and the text, nothing else: no
  Knox row, lesson or key.
- A returned row is grounded (`groundPaidRow`), then traced: its quoted line must be in the text and
  `checkFeeAgainstSource` must find the amount stated as that fee. An untraceable row is dropped and
  counted, never flagged.
- A traced find that today's free team misses (`free_missed`) is a never-read: one `never_read` row
  in `pipeline_feedback` (signal `missed`, check `knox.second_reader`, about `extract.rules`), the
  text's attempt (`extract.second_reader` v1) and the step's `knox.second_reader` event.
- Lesson pathway: `never-read-lessons.ts` reads the `never_read` rows back and groups them by the
  text's layout and the line's shape into lesson drafts (`knox.never_read_lessons` event), marked
  `repeats` at two banks or more. A builder writes the role lesson in `knox/role-lessons.ts` with the
  rule that fixes the shape; nothing edits source at runtime.
- Scope: a run reads only its batch's institutions (`SECOND_READER_BATCHES`, filtered in SQL and again
  in code) and only current texts (completed, `superseded_by_id IS NULL`). Batch
  `2026-11-07-cohort8` is the 8 banks, `writeCandidates: false` (flags and lesson rows only, no fee
  row), capped at $1.50 of logged spend (`ai_api_usage_events`, operation `knox_second_read`,
  `metadata.batch_id`). A batch with `writeCandidates: true` writes each never-read as a raw candidate
  (`needs_darwin_verification`, flags `knox_second_reader`, `knox_never_read`) for Darwin to verify
  against the document; nothing is published on the second reader's word.
- A step reads at most 5 texts, one after another; the tick queues one run at a time until the
  batch has no text left or reaches its cap, so the cohort's 15 texts take three runs.

**Dry-run cost estimate** (no provider call made;
`/mnt/project-files/data-quality/blind-second-reader-2026-11-07/cost-estimate.json`):
- Texts: 15 current texts on the 8 banks, 101,750 characters, none over the 60,000-character cut.
- Model: `claude-sonnet-5-5` (the paid extract default), priced $2 / $10 per million input / output
  tokens by the `claude-sonnet-5` row of `ANTHROPIC_PRICES_USD_PER_MTOK`.
- Calibration: 4,110 `paid_extract` calls, Oct 5 - Nov 7, same instructions: input tokens fit
  2,269 + 0.3254 per document character (r2 0.936); output mean 1,106, p95 2,756, cap 8,000.
- Expected $0.27 (49,910 input, 16,590 output tokens); p95 output $0.51; worst case $1.30 (3
  characters a token, all 8,000 output tokens on all 15 calls). No cache discount counted. Cap $1.50.

**What stops a repeat:** **Guard** `src/lib/agents/knox/second-reader.test.ts` (blind request, trace
drops, diff, switch off makes no call and no read, scoping, cap, lesson rows and drafts, the cost
numbers above); `src/lib/agents/dispatch-readiness.test.ts` maps the new caller to its provider
step; `feedback-kinds.ts` registers `never_read` with its reader.

**Not done:** no run, no provider call, no database write. Another model vendor as the second reader
would need a new SDK dependency, a new API key and James's yes; the reader uses the existing
Anthropic provider only.
