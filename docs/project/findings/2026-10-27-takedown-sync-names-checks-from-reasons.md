# 2026-10-27: The takedown sync names a takedown's check from its reason

**What happened:** Issue #2062 asked why limit-guard takedowns reached the learning store under
`hamilton.limit_as_fee`. On prod (read-only, Oct 27) the guard's 25 takedowns were 50 sync rows (kind
`not_a_fee`, extract and verify) under `hamilton.limit_as_fee`. Its 25 confirmed second looks were
under `hamilton.limit_guard`, so one guard showed up as two checks. Darwin's live re-checks had the
same fault: 1,670 sync rows under `hamilton.<x>` beside their `darwin.<x>` second looks. The rows were
document_owner 654, "one line, two reads" 232 (`darwin.line_conflict`), product_page_repeat 204,
non_deposit_document and its other reasons 284, rate_floor 108, darwin_recheck 74
(`darwin.verified_recheck`), translated_copy 70, card_program_section 24, late_charge_bound 10,
banded_zero 8 and release_repair 2. In all, 1,720 rows for 860 fees.

The same look found two more gaps. Knox's takedown lessons load the 423 confirmed business-schedule
takedowns but act only on the limit guard's, so the wrong audience was learned nowhere. And none of
the 25 confirmed limit-guard rows carries a `takedown_witness`, so the takedown lessons act on none
of them today.
**Cause:** `takedownCheck` (`src/lib/agents/learning/feedback.ts`) names a takedown's check
`hamilton.<reason prefix>`. That is right only for a Hamilton check that names its reason after
itself. Nothing tied a producer's reason prefix to its check constant, so every new check whose reason
differs, and every Darwin re-check, repeated the bug.
**Fix:** this PR (#2062).
- `TAKEDOWN_REASON_CHECKS` maps every such prefix to its producer's check, so new sync rows go under
  the check that made them.
- `takedown-reason-checks.test.ts` finds every module that calls `secondLook(`. It fails unless each
  one is in its producer table, with every reason prefix pinned to that module's own check constant.
- Prefixes that several checks write (`same_line_duplicate`, the eval verdict kinds) keep the sync's
  name and are listed as shared.
- The 1,720 old rows are relabelled by `relabelMisfiledTakedowns` behind `MISFILED_TAKEDOWN_RELABEL_ON`
  (off). Its dry run counts them; switching it on changes production data and needs James's yes.
- Knox's audience lessons (`src/lib/agents/knox/audience-lessons.ts`) read the business-schedule
  takedowns, behind `KNOX_AUDIENCE_LESSONS_LIVE` (off).

The witness gap is a follow-up on #2062.
**Lesson:** a reason and a check are two names. Map a check's reason prefix to its check in
`TAKEDOWN_REASON_CHECKS` and list the module in the producer table, so the test pins it. Register a
reader for the producer whose rows it acts on, not for every producer whose rows it loads.
**Guard:** `src/lib/agents/learning/takedown-reason-checks.test.ts`, `src/lib/agents/learning/feedback.test.ts`.
In `src/lib/agents/deming/planted-errors.test.ts` the wrong-audience read link now holds, and the gap
count falls from 13 to 12.
**Agent lesson:** knox/issue-2062-takedown-readers-get-their-own-check,
hamilton/issue-2062-reason-prefix-is-not-the-check, darwin/issue-2062-reason-prefix-maps-to-its-check
