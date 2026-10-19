# 2026-10-19: A held twin must block newer-copy restoration

**What happened.** Existing issue #1674 identified a newer-copy restoration path around an
account-type hold. A fee retired as `newer_copy_drops_fee:` could become live again when a
later copy stated it, despite an identical fee already held as `account_type_hold:`. The next
hold pass could remove it again; source recognition alone does not authorize bypassing the hold.

**Cause.** The final duplicate guard counted only `other.rolled_back_at IS NULL`. It preserved
the complete represented fee identity but ignored an equivalent account-type-held row. The
planning path did not read this blocker at all, so a dry run could also label a blocked
source-stated fee as restored. Analogous cross-page and business-schedule restores already
counted account-type-held replacements as present.

**Evidence.** Read-only current main `d1dc0f0c34856444a499a4b831c4e0bf7f55538f` had the same
affected implementation as `53cc0a7a7`. A production SELECT at 2026-10-19 08:47:23 UTC found
zero retired targets, zero exact held-twin pairs and zero institutions, using the full current
identity predicate. An isolated 11-case SELECT changed only the exact held-twin case when the
presence test included `account_type_hold:%`. This is a dated candidate-pool count and a code
reproduction, not evidence that an actual production fee was wrongly restored.

On implementation base `616ea5977c0b8f2d997e64ef618fe02dac752164`, the first pure/real-SQL
regressions failed five cases while 50 existing tests passed. They demonstrated an actual held
twin being bypassed, the same incorrect dry-run count, and a held twin committed after selection
being bypassed at the final write.

**Fix (#1674, Hamilton tracker #975).** One controlled SQL fragment supplies the complete
institution/category/name/amount, audience, frequency, variant, amount kind, rate basis/value
and bounds identity to planning and the final UPDATE. A live equivalent or an
`account_type_hold:` equivalent is present. Unknown/null normalization remains equality, never
a wildcard. Unrelated closure reasons and distinct identities remain separate. Source-stated
rows still count toward schedule recognition; blocked restore intent is recorded separately.
The existing target quarantine, exact selected lineage/closure, timestamp precision, source
recognition and historical v1 fingerprint guards remain in place.

Returned `proposedRestores`, planned `blockedRestores`/reason counts and final-guard
`notUpdatedRestores` are distinct from actual `restored`. Dry-run and shadow results report
zero actual restorations; preview text names proposals. A guarded no-op is not fabricated into
a restore, a verification update or a source-check receipt. The no-op counter does not identify
which selected-state/twin guard changed.

Review also found that a failed write returned zero actual changes without a returned failure
state. The receipt now carries `writeFailed`/`failedRestores`, separate from guarded no-ops,
and the parent publish summary makes the pending retry visible. An actual enclosing PostgreSQL
transaction/savepoint test forces an error after restoration and its source-check receipt,
then proves rollback preserves the retirement/rejected lineage and removes all restoration/
pair receipts. A normal retry in the same enclosing transaction can then succeed. This is a
mutation-savepoint guarantee, not a new retry subsystem.

Real PostgreSQL controls include exact held/live twins, different audience/amount/kind/frequency/
variant, legacy equivalent unknowns, defensive rate/bounds identity, unrelated closure reasons,
an interstatement committed held twin, dry/shadow behavior and a mixed batch where only the
actual updated lineage is verified. Existing source recognition, target holds, lineage changes,
newer closure reasons and full-precision timestamps remain covered. These are interstatement
guards; no broader concurrent-transaction or phantom-insertion guarantee is claimed.

**Boundary.** v1 fingerprints remain closed; Bayes's existing no-replay contract covers this
future/pending-pair safety restriction. No production write, historical replay, migration,
provider activation, switch change or blanket hold clearing is included. The observed affected
cohort is zero, so no measurable current scorecard movement or live recovery is claimed.
Relates to #1945 and #1911; their broader same-account/new-edition provenance work remains open.

**Lesson.** A publication hold is continuing intent, not evidence that a fee disappeared. Share
the exact blocker identity between previews and mutation, then report actual UPDATE RETURNING
rows separately from planned or blocked work.

**Guard:** `src/lib/agents/hamilton/newer-copy-retire.db.test.ts` exercises held/live twins,
identity boundaries, final-guard no-ops and real savepoint rollback/retry;
`src/lib/agents/hamilton/newer-copy-retire.test.ts` checks pure planning and parent receipt
wording; `src/lib/agents/run-store.test.ts` covers the parent publish runtime.
