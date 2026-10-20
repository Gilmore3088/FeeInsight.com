# 2026-10-20: Agent checks could take down a fee an admin had corrected

**What happened.** The #978 audit found that an admin correction does not hold against the
scheduled checks. A correction publishes a new row with the corrected values, but that row keeps
the original raw and verified lineage (migration 20270110000066), so it still reads as a Knox
fee. Every check that picks live Knox rows (the rules re-check, taxonomy fold, duplicate checks
and about 40 takedown paths in all) re-reads it against the old document and can close it. Only
Darwin's re-check left corrected rows alone (`src/lib/agents/darwin/verified-recheck.ts:440`). How
many corrected fees agents have already closed on prod was not measured from here; the PR gives
the read-only query.

**Cause.** The protection lived in one check instead of at the one write every takedown shares,
so each new check had to remember it, and none but Darwin did.

**Fix (#978).** Migration 20270110000068 adds a trigger on `published_fee_records`: an update
that would close a live row with a current correction is skipped unless the correction workflow
itself is replacing it (batch prefix `admin-correction-`). Holds (`quarantined_at`) and restores
are untouched. The Hamilton guide now states the rule for new checks.

**Guard:** `src/lib/fee-corrections.db.test.ts`
("should_keep_a_corrected_fee_live_when_an_agent_check_takes_it_down...") runs in the e2e job and
fails when an agent-style takedown closes a corrected fee; it fails on a schema without the trigger.
