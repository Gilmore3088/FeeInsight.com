# 2026-10-19: paid review retained admission locks across later model calls

**What happened:** Local controls against released main `40e2086602` reproduced
three failures: review batch two observed 25 first-batch admissions and attempts; the
adjudicator observed an already-settled review; a changed ordinary source body still
received a paid row attempt. No live provider was called for these controls.

**Cause:** Each review batch settled before collecting the next batch, and the combined
pass settled review before adjudication. The paid response was not bound to its complete
actual used source and selected raw/upstream-attempt state at final settlement.

**Fix:** Existing #2285 checklist, with #1915's shared external-call/lock boundary.
Stage review and shadow responses first, capture their returned usage/timing immediately,
then settle exactly once in review→shadow order. Before every ordinary paid outcome,
compare actual current locked document/artifact/full body and complete selected
raw/upstream attempt. Defer a mismatch or unavailable input without ordinary settlement.
The factual lock wrapper uses savepoints/NOWAIT and a rejected row releases its prefix.
The original selector's standing predicates are repeated for the selected identity;
immutable tuple comparison alone cannot detect an appended completion or a newer
qualifying model attempt. State fallback scope and transient/version exceptions remain.
No date feature, Business policy, original-Knox-header requirement, selector/epoch or
provider activation is included. Paid calls that already returned retain their usage
even if later source changes prevent row settlement.

**Lesson:** Moving a provider call outside a row's own write block is insufficient when
an earlier batch in the same outer transaction already retained source/raw locks. Test
the entire review→adjudication call order and actual currentness after the last call.

**Guard:** `paid-two-phase.test.ts` covers stop/malformed/failure/finally order and
`paid-two-phase.db.test.ts` covers two real connections acquiring NOWAIT document,
artifact and raw locks during a later synthetic call; ordinary→ordinary positive,
negative, failed and shadow body races; complete raw/attempt CAS; missing factual source;
source-prefix release while the outer transaction stays open; exact cost/duration;
one-time settlement; actual positive release/raw preservation; and a healthy legacy raw
without a generated original header. Three retained actual append-only OLD-red controls
catch stale selector standing, with new-rel/nonqualifying-CM/transient/prior-disagreement
and state fallback positives. Only guarded paid settlers share raw locking; arbitrary
attempt append phantoms remain outside this boundary. The native suite is registered
in serial CI.
