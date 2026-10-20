# 2026-10-19: saved simulations could borrow another institution's context

**Tasks:** #975 / #976, H01-T04, H01-T06, H01-T09. Partial implementation;
H01 acceptance and release remain open.

**Implementer:** ChatGPT/Codex, this workspace session. Branch
`fix/975-hamilton-identity-peer-reliability`, based on main
`3d8b79308432b14b01d8a9e877e976e8f6685aa6`.

**What happened:** `/pro/simulate?scenario_id=saved-a&instId=303&fee=overdraft`
could load an authorized scenario saved for institution 101's NSF fee, then apply its
proposed price to institution 303's overdraft fee. The page gave URL institution and
fee parameters precedence over the saved record. The shared artifact lookup also
skipped the scenario whenever an institution was named in the URL, so the shell
could show the substituted institution too. A missing/private scenario or a failed
scenario read silently became a new simulation. An older scenario without a
canonical institution could borrow the current workspace preference.

**Fix:** saved simulations use the existing artifact precedence contract, after
the user-scoped scenario lookup. Both supported scenario URL aliases keep the
recorded institution and fee. The layout resolves the same artifact, even with a
conflicting URL institution. Missing/private records return not found; a read
failure propagates to the error boundary. Unscoped legacy records and unavailable
recorded institutions show a notice and a link to start a new simulation, with no
model form or private-figure lookup. New simulations retain their URL controls.

**Guard:** `src/app/pro/(hamilton)/simulate/page.test.tsx` checks saved-subject
and fee precedence, both aliases, rendered institution/price/form context,
missing/private records, failed reads, legacy IDs, unavailable or unexpectedly
different resolved subjects, new simulations and sign-in. The scenario cases in
`layout.context.test.tsx` and `src/lib/hamilton/artifact-context.test.ts` check that
the shell follows the same subject and cannot borrow the URL/workspace on failure.

**Evidence:** synthetic route/component tests only; exact commands and final
counts are in the draft PR. The initial page regression run reproduced eight
failures in ten cases before the fix (one unavailable-subject fixture was then
completed to exercise the actual fallback instead of an incomplete mock). Final
coverage adds a separate unexpected-subject case. Broader initial checks found
stale installed dependencies and stale generated Next.js route types; those
initial failed/aborted checks are retained in the local verification logs.

Local verification after `npm ci` and `next typegen`:
- Focused identity, navigation and saved-scenario suite: 11 files, 154 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run guard:legacy`: passed.
- `npm run lint`: no errors, 68 warnings.
- `npm run test:agentic`: 1,735 passed, 3 skipped.
- `npx vitest run`: 14,948 passed, 67 failed, 12 expected failures, 943 skipped;
  35 unhandled errors. This is a failed full-suite run, not a green gate.
  Subprocess `spawnSync` and loopback `listen` operations hit sandbox `EPERM`.
  Untouched base `3d8b7930` independently reproduced the 15 failures in the SDK
  and browser-security checks and the 3 tooling-dependency failures, using the
  same installed dependencies. The remaining full-suite failures have not all
  been independently rerun on base. Logs are under `/tmp/hamilton-975/` in this
  workspace; they are not hosted CI evidence.

**Malformed ids (growthOS review, 2026-10-20):** saved scenario, analysis and
report ids are Postgres `uuid` columns, so a non-uuid link made the query throw
and the page showed Hamilton's outage screen. `isSavedArtifactId` now checks the
format first: `/pro/simulate` returns not found, and the shell's artifact lookup
returns no institution without querying. Real read failures still surface.

**Limits:** this patch preserves institution/fee identity when restoring a
scenario. It still recomputes against current published fees and comparison
layers; it does not establish historical cohort/result/export parity. No SQL,
migration, production data edits, account changes or paid provider runs. No live
browser, preview acceptance, release or independent review is claimed.

**Next in order:** finish H01's remaining current-build acceptance and record its
evidence; then H02-T01's peer-request matrix and the remaining H02-T08 list/export
and paging gaps. Re-read main and open PRs first. #2399 already owns the #2170
journey-schema repair; its billing-action inventory failure and the subsequent
H07-T05 CI wiring remain separate. No task checkbox is accepted by this patch.
