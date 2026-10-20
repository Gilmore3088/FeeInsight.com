# 2026-10-19: a changed category must not bypass a selected publication snapshot

**What happened:** Root's independent review found #2356 in the unreleased #2278
publication adapter. A caller retained an international verified row while the actual
verified category changed to domestic. The ordinary-category exit preceded the selected
snapshot check, allowing the actual publication callback to write the stale caller row.
The owned loopback PostgreSQL control reproduced `written` instead of `selected_changed`.
The adapter was unwired; no production exposure or historical mutation is claimed.

**Cause:** Applicability was checked before the optimistic selection expectation.
Current source facts cannot authorize a callback to publish a different selected tuple.

**Change:** Check the complete supplied verified snapshot before any applicability exit.
A legacy direct caller's international category is also a CAS expectation, never source
or classification evidence. Identity-only calls derive current actual lineage; they do not
gain a direction from caller metadata. Deferred inputs remain undecided.

**Lesson:** A narrow guard's ordinary exit must preserve the caller's selection contract.

**Guard:** The retained OLD-red and fixed actual PostgreSQL test use the full stale caller
and actual exported publication writer. Snapshot and legacy category controls both defer
without calling the writer or settling a primary publication attempt. Minimal actual-ID
source derivation remains a separate positive. No numeric matcher, category inference,
median, selector or replay version changes.
