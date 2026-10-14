# 2026-10-14: Darwin rows due again after a rule change never woke a quiet state's lane

**What happened:** I re-measured #1052 on production with read-only SQL on 14 Oct. "Knox fees with
no Darwin result" turned out to be mostly rows Knox never sent to Darwin. Darwin's own gap was
small, and nothing counted it.
- **Never decided:** 0 Knox rows flagged `needs_darwin_verification` lack a Darwin decision.
  Every one of the 16,154 flagged rows that are not verified has a `verify.rules` v3 decision.
- **Due again and not re-judged:** 26 rows. Darwin's selection re-reads a category rejection
  once after a guard bump, but these rows sit in Puerto Rico (17) and Guam (9), and no lane ran
  to re-read them. Puerto Rico's lane last ran on Oct 10. Guam's last verify step ran on Oct 13
  at 23:26 UTC, before guard v61. Example: raw 262766, Puerto Rico FCU, "Sobregiros" $10.
- **Never sent to Darwin:** 41,363 Knox rows at 4,872 institutions. 20,198 of them are older
  than 7 days.
  - 40,281 are Knox holds (`knox_review:*`): 27,374 unclassified (16,661 of them set aside),
    7,505 range, 2,762 percentage, 2,519 untraced, and 121 others (taken-down repeats and
    retired $0 rows).
  - 911 are April–July rows at 12 institutions with no flags and no stored document. They came
    before the agentic pipeline, and the source check cannot read them.
  - 171 are rows a later read retired.
- **Institutions:** 261 have Knox rows and no Darwin-verified row (1,032 rows).
  - 892 of those rows are Knox holds, at 239 institutions.
  - 80 rows are Darwin rejections and 32 are Darwin holds.
  - 28 rows are retired. None is undecided.

**Cause:** Three queries decide what "waiting for Darwin" means: the verify step's selection
(`selectRawFees`), the state-lane scheduler's backlog check (`stateHasDocumentBacklog`) and the
daily health count (`readDarwinNumbers`). Only the selection knew the re-read exceptions: guard,
source-check, envelope and batch-key changes. The other two counted only rows with no decision.
A due row in a state with no other work never woke that state's lane, and the health count read 0.

**Fix:** PR for #1052. `darwinDueSql` in `darwin/verify.ts` is the one test, and all three
queries read it. The health check also adds a rule: no row sent to Darwin waits more than 7 days
for its first decision (`waitingOver7d`, 0 today).

**Lesson:** When a step's "what is due" test has exceptions, the scheduler and the health count
must read the same test. A copy that drops the exceptions hides the work in exactly the quiet
places where nothing else wakes the lane.
