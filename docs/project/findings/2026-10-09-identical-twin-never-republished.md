# 2026-10-09: A fee's second copy stayed unpublished after the first came down
**What happened:** AllSouth (institution 5886) showed no early closure fee. Its $10 "closed
within 90 days" fee was published from one document as 16807 and taken down on Oct 5 as
`rules_recheck_unreproduced`. A second document's copy (verified 13856, which a second source
agrees with) had been skipped at 08:35 that day as "Identical fee already published", and
publish never selected it again.
**Cause:** publish's learning filter never re-selects a row this rule version already decided on.
An "unchanged" decision pointed at a live twin, and stayed in force after the twin came down.
409 verified rows are in this state behind a rules re-check takedown; in 150 of them the
institution has no live fee left in that category (read-only query).
**Fix:** publish selects such a row again when the twin it matched was rolled back by the rules
re-check, which judged one document's read and not the fee itself. Publish's own checks still
apply. Twins of takedowns for other reasons stay skipped. This PR.
**Lesson:** a "skipped as duplicate" decision depends on the row it matched. When that row goes,
the decision has to be made again.
