# The second look rewrote a fee's first-look row in place

**Date:** 2026-10-09. **Where:** `src/lib/agents/hamilton/second-look.ts`.

## What happened

The second look kept one `pipeline_feedback` row per fee and check (dedupe key
`hamilton.second_look:<check>:pub:<id>`) and upserted its kind as the fee moved from
`takedown_pending` to `takedown_confirmed` or `takedown_cleared`. When eval verdict v5 (PR 823)
cleared the 378 flags v4 had overfired, each first-look row was rewritten in place as
`takedown_cleared` at 04:13 UTC. UAT read that as the per-fee flag history gone: the clear kept
the first look's run, time and reason inside its evidence, but the original row, its kind and its
weight were overwritten, which the archive-and-log rule forbids.

## Why the state row cannot simply keep its kind

Every reader of "is this fee under a pending takedown" tests `kind = 'takedown_pending'` on
`pipeline_feedback` for the fee: custom reports, fee-change feeds, local market and competitor
alerts, the monthly pulse, outreach drafts, Magellan's refetch queue and the state lane
scheduler. Knox's lessons count `kind = 'takedown_confirmed'`. Leaving a cleared fee's row as
`takedown_pending` would hide 378 correct fees from reports and keep their banks in the refetch
queue, so the state row must change kind.

## Fix

- The state row stays one per fee and check and still carries the current kind.
- Every event also appends one row keyed by the run, never rewritten: `flag_recorded` at the
  first look, `flag_cleared` at a clear, `flag_confirmed` at a confirmation, each naming the first
  look's run, time and reason and the key of the first-look row it resolves.
- `reconstructFirstLooks` rebuilds the missing `flag_recorded` row for every state row a clear
  rewrote before the trail existed, from the evidence the clear kept, marked `reconstructed_from`
  with the original kind and why it was cleared. It is idempotent (a fee whose first look is on
  record is skipped) and runs inside the eval-verdict step, so it has run-ledger visibility. On
  Oct 9 it matches exactly the 378 rows the v5 clear rewrote.

## Rule going forward

A log row that records an event is never upserted into a different event. A row that carries
current state may change, but each change appends its own row first.
