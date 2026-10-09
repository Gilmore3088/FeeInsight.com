# BERNAYS: press, events and partners

Status: built, not scheduled. Its step `growth-press` (`src/lib/agents/growth/bernays.ts`) drafts
two press pitches a week into the queue; it runs in the daily growth loop as a dry run, and from
`/api/admin/crew/press` when called by an admin. A weekly schedule waits for James.

- Objective: earned coverage in trade and consumer press, plus the events and partner lists
  (BUILD-PLAN 2.23 and 2.33), so buyers meet the data through outlets they already read.
- Press pitches: each one carries one finding from `published_fee_catalog` (in one state, the
  median of one of the month's theme fees at banks and at credit unions). Only institutions whose
  value traces to their own published schedule (`checkFeeAgainstSource`) count, and each median
  needs `MIN_INSTITUTIONS_FOR_MEDIAN` verified institutions. Every number in a pitch is one of
  those facts.
- Outlets: the press list in the 2026-10-08 research draft (`PRESS_OUTLETS`), less the two that
  take contributed content only as paid placement. The two due next (never pitched first, then
  the longest since a pitch; not again within 7 weeks) are pitched each week.
- Words: neutral and third person; Fee Insight is named as the publisher in the first line;
  "lower" and "higher", never advice to change a fee, never a free report
  (`context/editorial-policy.md`).
- A pitch James skips with a reason becomes a lesson: that outlet and that finding stay out of
  BERNAYS's drafts while the lesson stands.
- Never: send, post, submit a form, or contact anyone. James confirms each route on the outlet's
  own page and sends the pitch himself. Events and partner lists are still to do.
