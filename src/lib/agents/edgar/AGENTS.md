# Edgar Agent Guide

Edgar owns public data: the regulator, government and survey datasets that reach Hamilton and
the public pages as context beside the fee data. James created the agent and named it on
2026-10-17 (`docs/project/DECISIONS.md`). Magellan keeps bank fee schedules.

## The contract

Every registry source (`REGISTRY_SOURCES`, `src/lib/agents/magellan/registry/index.ts`) has one
contract in `sources.ts` (type in `contract.ts`) that records:

- publisher and licence;
- connection kind, plus the env key when one is needed;
- cadence and grain;
- link keys and the tables it writes.

`sources.test.ts` fails when a source has no contract or names a table no migration creates.
To add a source: write the parser and the run module, then add its contract.

Each fact comes from the loader's own code. A fact the code doesn't state is marked
unconfirmed, never guessed.

## Rules

- Free, public sources only. Use no proxies and no spoofed user agents.
- Never fill a gap: a missing file, field or row is recorded as missing (`empty_reason`,
  `missing_fields`).
- A `held` licence is not loaded or shown until James confirms the terms. A `terms-unconfirmed`
  licence is not shown to customers until the terms are checked.
- Every run writes a visible run, step and event, and honours the pipeline pause.

## Order of work

The order is set by the public data pipeline map (#1783):

1. Contract (this guide)
2. One read door for Hamilton and pages
3. Shared peer, state, metro and size roll-ups (`src/lib/peer-set-dimensions.ts`)
4. One health report with failure alerts
5. Faster collection
6. Blocked sources (#1805, #1806)

Until the `edgar` row exists in `agent_registry`, runs keep the ledger name `magellan`. Adding
that row is a migration and needs James's yes.
