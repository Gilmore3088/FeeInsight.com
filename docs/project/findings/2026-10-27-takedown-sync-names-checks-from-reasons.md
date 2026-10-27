# 2026-10-27: The takedown sync names a takedown's check from its reason

**What happened:** Issue #2062 asked why limit-guard takedowns reached the learning store under
`hamilton.limit_as_fee`. On prod (read-only, Oct 27) the guard's 25 takedowns were 50 sync rows
(kind `not_a_fee`, extract and verify) under `hamilton.limit_as_fee`, while the guard's own 25
confirmed second looks sat under `hamilton.limit_guard`. One guard showed up as two checks. The same
look found a second gap. Knox's takedown lessons load the 423 confirmed business-schedule takedowns
but act only on the limit guard's. So the wrong audience was learned nowhere: every re-read of those
documents read the fee with no audience again. And none of the 25 confirmed limit-guard rows carries
a `takedown_witness`, so the takedown lessons act on none of them today either.
**Cause:** `takedownCheck` (`src/lib/agents/learning/feedback.ts`) names a takedown's check
`hamilton.<reason prefix>`. That is right only when a check names its reason after itself. The limit
guard writes `limit_as_fee:<code>: ...` and files its second look under `LIMIT_GUARD_CHECK`. Several
Darwin re-checks also write `hamilton.<x>` sync rows beside `darwin.<x>` second looks (rate_floor,
banded_zero, card_program_section, translated_copy, document_owner, non_deposit_document,
product_page_repeat, late_charge_bound, release_repair): 1,262 rows on Oct 27. Those are not fixed here.
**Fix:** this PR (#2062). `TAKEDOWN_REASON_CHECKS` maps `limit_as_fee` to `hamilton.limit_guard`,
so new sync rows go under the guard's own check. The 50 old rows are relabelled by
`relabelMisfiledTakedowns` behind `MISFILED_TAKEDOWN_RELABEL_ON` (off): a dry run counts them, and
switching it on is a production-data change that needs James's yes. Knox's audience lessons
(`src/lib/agents/knox/audience-lessons.ts`) read the business-schedule takedowns, behind
`KNOX_AUDIENCE_LESSONS_LIVE` (off).
**Lesson:** a reason and a check are two names. A check whose reason prefix is not its own name maps
it in `TAKEDOWN_REASON_CHECKS`, with a test that pins it to the check's constant. A reader is
registered for the producer whose rows it acts on, not for every producer whose rows it loads.
**Guard:** `src/lib/agents/learning/feedback.test.ts` (the map equals `LIMIT_GUARD_CHECK`; the sync's
limit rows carry it). `src/lib/agents/deming/planted-errors.test.ts`: the wrong-audience read link now
holds, and the gap count falls from 13 to 12. The Darwin mismatches above are a line on #2062.
**Agent lesson:** knox/issue-2062-takedown-readers-get-their-own-check,
hamilton/issue-2062-reason-prefix-is-not-the-check
