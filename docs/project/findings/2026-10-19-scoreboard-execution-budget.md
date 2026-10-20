# Daily scoreboard execution exceeds its request budget

2026-10-19 · Foundation #1048 / Atlas #2177 · related #1579 item1 and #1063

The daily scoreboard route allowed 60 seconds but executed its complete workflow inline.
After #1862, its first reference-score step can observe sources for 120 seconds and is
priced at 150 seconds. `executeAgentRunToEnd` also permits the first-step progress override,
so passing a shorter deadline alone would still start work that cannot fit the route.
The reused-run response said “already ran” even when the run was still pending.

The route now only creates or reuses the UTC day's existing 12-step ledger workflow and
returns its actual queued/running/terminal state. It executes no steps inline and keeps
its 60-second function limit, signed-cron/operator authorization and step order. Opt-in
whole-key idempotency serializes lookup/create and step inserts in one short transaction,
with no HTTP or execution while locked. Concurrent requests reuse the same run. Terminal
failed/cancelled history stays terminal; the earliest pre-existing duplicate is canonical,
without deleting or rewriting later history. Other callers retain active-only reuse.

The existing tick consumes the workflow across bounded passes. This workflow respects an
explicit deadline even when selected first; its 150-second score cannot take the ordinary
first-run progress override. Other workflows keep their existing execution behavior.
When both pipeline and marketing are paused, recovery and selection are restricted to
Atlas `workflow` runs whose source is exactly `atlas.scoreboard`. Only their already
pause-exempt measurement steps execute. No new runs, provider budget, outreach, unrelated
alerts/digests or other sources run on this path. Its city-repair/storage tail remains
held until the pipeline permits it. An opt-in execution ceiling checks the unchanged
exemption list in selection, before each step and on the actual earliest step inside
the existing claim transaction. A control flip or another executor advancing between
peek and claim cannot carry this narrow continuation into its data tail. Backend
disabled remains a hard no-op. No pause
exemption list, automation setting, provider policy, migration or fee data is changed.

**Guard:** `src/app/api/admin/crew/scoreboard/route.test.ts` keeps the real policy wrapper
and timing-safe cron helper; its initial run failed 12 regressions on the old route while
one control passed. `src/app/api/admin/agents/tick/route.test.ts` checks the exact scoped
drain, control matrix and absence of scheduling/provider paths.
`src/lib/agents/scoreboard-execution.db.test.ts` uses copied current ledger columns/checks
with independent local identities in a random schema in an owned loopback TLS database.
It exercises the real routes, selector and run/step/event transactions: six concurrent
requests, terminal/canonical/default reuse, all 12 steps over ticks, ordered snapshot,
paused tail/resumption, unrelated queued/stale/orphan negative controls, backend stop and
insufficient/sufficient first-score budget, control flips and actual interleaved claims.
Removing only the locked claim guard through an external test transform makes that
race regression fail by executing the held tail; application source is untouched by
the negative probe. Only step effects are injected; the snapshot
effect writes a synthetic fixture receipt. It does not execute bank/provider/email/data
repair logic. The suite is included in the real PostgreSQL CI inventory.

Focused verification passed five suites / 107 tests, including all 23 PostgreSQL
cases, with zero skips. Full repository checks and exact-head independent review/CI are
release gates; their exact receipts are recorded with the PR. These tests demonstrate
execution and control semantics, not an observed production run duration or fee-accuracy
increase. Database availability and scheduler backlog can still delay a queued run; its
ledger/pending state makes that delay visible. No production execution was used here.

The other #1579 category-share/no-source-threshold items, live-source audit #2061 and
broader automation #1063 remain outstanding. James's weekly 50 whole institutions in
five packets of ten remains his complete launch-accuracy/missing-fee workflow. No extra
manual verification or answer-key repair is introduced by this integration correction.
