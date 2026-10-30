# 2026-10-27: The takedown sync names a takedown's check from its reason

**What happened:** Issue #2062 asked why limit-guard takedowns reached the learning store under
`hamilton.limit_as_fee`. On prod (read-only, Oct 27) the guard's 25 takedowns were 50 sync rows (kind
`not_a_fee`, extract and verify) under `hamilton.limit_as_fee`. Its 25 confirmed second looks were
under `hamilton.limit_guard`, so one guard showed up as two checks.

The same fault ran across other producers, 4,656 rows for 2,328 fees in all:
- **Hand takedowns:** 382 rows under `hamilton.source_mismatch` (`hamilton.hand_takedown`).
- **Darwin's live re-checks:** 4,224 rows under `hamilton.<x>` beside their `darwin.<x>` checks.
  - older_edition 2,208 and not_yet_effective 334 (`darwin.edition_effective_check`).
  - document_owner 654.
  - "one line, two reads" 232 (`darwin.line_conflict`).
  - product_page_repeat 204.
  - non_deposit_document and its other reasons 284.
  - rate_floor 108.
  - darwin_recheck 74 (`darwin.verified_recheck`).
  - translated_copy 70.
  - card_program_section 24.
  - "fragment name" 12 (`darwin.live_fragment_check`).
  - late_charge_bound 10.
  - banded_zero 8.
  - release_repair 2.

The first drift test looked only at modules that call `secondLook(`. Review found the edition and
fragment checks, which archive fees directly, so the test now covers every takedown writer.

The same look found two more gaps. Knox's takedown lessons load the 423 confirmed business-schedule
takedowns but act only on the limit guard's, so the wrong audience was learned nowhere. And none of
the 25 confirmed limit-guard rows carries a `takedown_witness`, so the takedown lessons act on none of
them today.
**Cause:** `takedownCheck` (`src/lib/agents/learning/feedback.ts`) names a takedown's check
`hamilton.<reason prefix>`. That is right only for a Hamilton check that names its reason after
itself. Nothing tied a producer's reason prefix to its check constant.
**Fix:** this PR (#2062).
- `TAKEDOWN_REASON_CHECKS` maps every such prefix to its producer's check.
- `takedown-reason-checks.test.ts` finds every module under `src/lib` that takes live fees down: it
  calls `secondLook(`, or sets `rolled_back_at` to a time. The test fails unless the module is in its
  producer table, with every reason pinned to its own check constant.
- Some reasons keep the sync's name, marked as such in the table:
  - prefixes several checks write (`same_line_duplicate`, `duplicate of #`, the eval verdict kinds);
  - modules with no check of their own (closed institution, companion page, newer copy, outlier and
    off-taxonomy rollbacks, publish's supersede);
  - names readers match (`hamilton.category_outside_taxonomy`, `hamilton.admin_correction`).
- `relabelMisfiledTakedowns` relabels the 4,656 old rows behind `MISFILED_TAKEDOWN_RELABEL_ON` (off).
  Its dry run counts them; switching it on changes production data and needs James's yes.
- Knox's audience lessons (`src/lib/agents/knox/audience-lessons.ts`) read the business-schedule
  takedowns, behind `KNOX_AUDIENCE_LESSONS_LIVE` (off). A name lesson is scoped to the same document
  and the same amount.

The witness gap is a follow-up on #2062.
**Lesson:** a reason and a check are two names. Map a check's reason prefix to its check in
`TAKEDOWN_REASON_CHECKS`, and list every module that takes fees down in the producer table, so the test
pins it. Register a reader for the producer whose rows it acts on, not for every producer whose rows it
loads.
**Guard:** `src/lib/agents/learning/takedown-reason-checks.test.ts` and
`src/lib/agents/learning/feedback.test.ts`. `src/lib/agents/deming/planted-errors.test.ts` keeps the
wrong-audience read gap until the lessons are switched on.
**Agent lesson:** knox/issue-2062-takedown-readers-get-their-own-check,
hamilton/issue-2062-reason-prefix-is-not-the-check, darwin/issue-2062-reason-prefix-maps-to-its-check
