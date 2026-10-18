# Hoovie Agent Guide

Hoovie owns public data: the regulator, government and survey datasets that reach Hamilton and
the public pages as context beside the fee data. James created the agent and named it on
2026-10-17; the name is internal only and never shown to customers (`docs/project/DECISIONS.md`). Magellan keeps bank fee schedules.

## The contract

Every registry source (`REGISTRY_SOURCES`, `src/lib/agents/magellan/registry/index.ts`) has one
contract in `sources.ts` (type in `contract.ts`) that records:

- publisher and licence;
- connection kind, plus the env key when one is needed, and any optional keys;
- cadence and grain;
- link keys and the tables it writes.

`sources.test.ts` fails when a source has no contract or names a table no migration creates.
To add a source: write the parser and the run module, then add its contract.

Each fact comes from the loader's own code. A fact the code doesn't state is marked
unconfirmed, never guessed.

## Size budgets

Every table a source writes has a size budget in MB (`size-budgets.ts`): 7,000 for
`institution_call_report_items` and 2,000 for `area_statistics` (about double their Oct 17, 2026
sizes after the back-fill), and 1,000 for every other
table until a measured size says otherwise. Atlas's daily storage step measures each one. While a
table with its own budget is over it, the registry scheduler starts no partition for any source
that writes it; a table over the unmeasured 1,000 MB default is only warned about, until a PR
gives it a budget from a real measurement;
the storage step's summary names the held sources and the morning brief warns James. A hold ends
when the table is measured back under budget or a PR raises the budget. Never delete data to get
under a budget. A new table in a contract gets the default budget unless one is set.

## Rules

- Free, public sources only. Use no proxies and no spoofed user agents.
- No non-commercial data (James, 2026-10-17). A source whose terms allow only non-commercial,
  academic, personal or research use is not loaded at all; its loader is removed. Read the terms
  before building a loader.
- Never fill a gap: a missing file, field or row is recorded as missing (`empty_reason`,
  `missing_fields`).
- A `held` licence is not loaded or shown until James confirms the terms. A `terms-unconfirmed`
  licence is not shown to customers until the terms are checked.
- Every run writes a visible run, step and event, and honours the pipeline pause.

## Order of work

James's rule (2026-10-17): "Let's get the data first." The order follows the public data pipeline map (#1783):

1. Contract (this guide).
2. Unblock the failing sources: CRA, NIC, Y-9C and UBPR (#1805, #1806).
3. Faster collection, still within the pipeline pause.
4. One health report, with alerts when a load fails or comes back empty.
5. One read door for Hamilton and the site.
6. Shared roll-ups by peer, state, metro and size (`src/lib/peer-set-dimensions.ts`).

Until the `hoovie` row exists in `agent_registry`, runs keep the ledger name `magellan`. Adding
that row is a migration and needs James's yes.
