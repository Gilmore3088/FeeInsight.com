# Hoovie Agent Guide

Hoovie owns public data: the regulator, government and survey datasets that reach Hamilton and
the public pages as context beside the fee data. James created the agent and named it on
2026-10-17; the name is internal only and never shown to customers (`docs/project/DECISIONS.md`). Magellan keeps bank fee schedules.

## The contract

Every registry source (`REGISTRY_SOURCES`, `src/lib/agents/magellan/registry/index.ts`) has one
contract in `sources.ts` (type in `contract.ts`) that records:

- the registry module that runs it (`loader`);
- publisher and licence;
- connection kind, plus the env key when one is needed, and any optional keys;
- cadence and grain;
- link keys and the tables it writes;
- `missingSource`, when the publisher's host refuses production: the host, what it answered,
  the official fallback (or none) and the issue. The loader then records an empty partition with
  `detail.missing_source` instead of failing. Today: `nic-structure` and `fr-y9c` (#1806).

`sources.test.ts` fails when a source has no contract, names a table no migration creates, names
a table that no INSERT, UPDATE or DELETE in its loader writes, or names a key its loader never
reads. The loader check also reads the registry modules the loader imports (shared writers such as
`economy.ts`), so it catches a table that left the write path, not one that moved between
functions of a shared module.
To add a source: write the parser and the run module, then add its contract.

Each fact comes from the loader's own code. A fact the code doesn't state is marked
unconfirmed, never guessed.

## Size budgets

Every table a source writes has a size budget in MB (`size-budgets.ts`): 7,000 for
`institution_call_report_items` and 2,000 for `area_statistics` (about double their Oct 17, 2026
sizes after the back-fill), 1,600 for `institution_financial_records` (Oct 19 measured history,
eight more quarters and 25% headroom; `docs/plans/financial-records-budget-2026-10-19.md`), and 1,000 for every other
table until a measured size says otherwise. Atlas's daily storage step measures each one. While a
table with its own budget is over it, the registry scheduler starts no partition for any source
that writes it; a table over the unmeasured 1,000 MB default is only warned about, until a PR
gives it a budget from a real measurement;
the storage step's summary names the held sources and the morning brief warns James. A hold ends
when the table is measured back under budget or a PR raises the budget. Never delete data to get
under a budget. A new table in a contract gets the default budget unless one is set.

## Storage tiers (#1870)

Hot data stays in Postgres; older periods can live in compressed files in R2 (the document
vault's account and bucket, under `public-data-cold/`, or `R2_COLD_BUCKET`). The policy is in
`storage-tiers.ts`:

| Table | Hot | Cold |
|---|---|---|
| `institution_call_report_items` | newest 8 report dates per source (`ffiec`, `ncua`) | every older report date, one file per source and date |
| `area_statistics` | all of it | not tiered yet: 29 sources, three period shapes and struck-row rules need a per-source policy first |

- **Plan (runs daily).** In Atlas's storage step, on its one connection with a 10 s statement
  timeout: lists each source's report dates (a loose index scan), counts at most
  `PLAN_COUNTS_PER_RUN` uncounted cold dates a run (counts carry over in the step's
  `detail.cold_tier.counts`) and estimates the MB a prune would free. Read-only.
- **Export (off).** `COLD_EXPORT_LIVE` writes the oldest cold date without a file to
  `cold-files.ts`'s `jsonl.gz` format, reads it back, checks the SHA-256 and row count, and records
  one verified row in `public_data_cold_files`. At most one date a run. It writes no existing row.
  Turned on by PR after James's yes.
- **Prune (not built).** Removing the hot rows of a verified file is a production data change and
  waits for James's yes, with the plan's dry-run count and size. Before it, the loaders' first
  quarters must sit at or after the cold boundary, or a re-read loads the pruned rows again.
- **Read.** `src/lib/data-catalog/cold-reads.ts`: `queryData`'s `call:` measures read a date from its
  file only when its index row has `pruned_at` set, behind the hot rows, through the same citation,
  at most four files a question, each checked against its index row first.

## Rules

- Free, public sources only. Use no proxies and no spoofed user agents.
- No non-commercial data (James, 2026-10-17). A source whose terms allow only non-commercial,
  academic, personal or research use is not loaded at all; its loader is removed. Read the terms
  before building a loader.
- Never fill a gap: a missing file, field or row is recorded as missing (`empty_reason`,
  `missing_fields`).
- A `held` licence is not loaded or shown until James confirms the terms. A `terms-unconfirmed`
  licence is not shown to customers until the terms are checked.
- An open licence that requires attribution (World Bank RPW, CC BY 4.0; Urban Institute Debt in
  America, ODC-By 1.0) carries its attribution on every stored row and every read.
- Struck sources and parts, and the rows they loaded before they were struck, are listed in
  `src/lib/data-store/struck-sources.ts`; every reader excludes them.
- Every run writes a visible run, step and event, and honours the pipeline pause.
- The shared registry dispatcher records unhandled loader errors against the owning partition
  claim. Failures retain their attempt count and parser version; a late or repeated writer
  cannot replace a newer or finished claim. HTTP 401/403 records an unavailable publisher and
  waits a week, other permanent 4xx waits a day, transient/parser errors at least six hours.
  A deployed parser change can retry a failed partition immediately. Dry runs write no receipt.

## Order of work

James's rule (2026-10-17): "Let's get the data first." The order follows the public data pipeline map (#1783):

1. Contract (this guide).
2. Unblock the failing sources: CRA, NIC, Y-9C and UBPR (#1805, #1806).
3. Faster collection, still within the pipeline pause.
4. One health report, with alerts when a load fails or comes back empty: `source-health.ts` (#1866), below.
5. One read door for Hamilton and the site: `src/lib/data-catalog/`. `catalog.ts` lists every
   dataset (one entry per contract, plus published fees and institution financials) with a
   customer-facing label (publisher and dataset, never an agent name) and `servable`: the licence
   is public domain or a named open licence and the source is not struck or held.
   `series.ts` lists each source's area_statistics series, cached for a day (a loader that writes
   full series objects to `detail.series` skips the GROUP BY). `query-data.ts` is the one query:
   a zod-checked measure and scope, bound parameters only, and a refusal with a plain reason for
   anything not servable. Wiring it into Hamilton's chat tools is a separate PR.
6. Shared roll-ups by peer, state, metro and size (`src/lib/peer-set-dimensions.ts`).

## Offers Zelle, from each institution's own documents (#1875)

Zelle's participant list was struck on 2026-10-17 (#1840): its terms allow only personal,
non-commercial use. `registry-bank-zelle` (`magellan/registry/bank-zelle.ts`) reads the fact
from each institution's own documents the pipeline already stores (the current copy in
`source_documents`, its text in `agent_source_texts`) and fetches nothing. A document on
Zelle's own sites (`ZELLE_LIST_HOSTS`, `struck-sources.ts`) is never read or cited.

- Rules (`bank-zelle-match.ts`, `BANK_ZELLE_MATCHER_VERSION`): deterministic text, no model call.
  Each sentence that names Zelle is read as offers (a fee or limit line, "send money with Zelle",
  enrolling, Zelle in "our" app, the brand notice a participant prints), does not offer (only a
  plain, unconditional "not offered": any condition or scope such as "until", "on weekends", "to
  recipients outside the U.S." or "at this time" makes it a mention) or a mention (scam and safety
  warnings such as "never send money with Zelle to someone you don't know"; "only" and "trust" count only as "only send ... to" and "know and trust"; app lists). "Send
  money with Zelle" counts as offers only beside "our app", "your account" or enrolling. Offers only
  is `offers`; does-not-offer only is `does_not_offer`; both, or mentions only, is `unclear`. No
  mention means no row: silence is never "does not offer".
- Rows (`institution_payment_features`, feature `zelle`) carry the evidence sentence and the
  link to the institution's own document.
- Bounded: one partition (`current`) walks institutions in id order, 300 per run, every query
  under a 30 s statement timeout; the next batch runs an hour later, and a finished pass waits a
  week. A new matcher version restarts the pass.
- Read through `queryData` as `fact:offers_zelle`, one institution at a time (yes, no or unclear,
  with the document link). The catalog licence is `fee-insight`, as for the published fees.

## Daily health check (contract)

`agent-health.ts` runs with the daily scoreboard step and stores these numbers in
`pipeline_scoreboard_snapshots.detail.agent_health`, next to yesterday's. A broken rule, or any
number that moved more than 25% since yesterday, is named in the scoreboard step's summary.
Change this table and `agent-health.ts` in the same PR. Registry steps written under Magellan's
name before #1865 count as Hoovie's.

| Rule | Number | Holds when |
|---|---|---|
| Steps do not fail | `stepsFailed` (24 h) | 0 |

Also recorded, without a rule: `stepsCompleted`, `spendUsd`.

## Source health report (#1866)

`source-health.ts` gives every contract one status, a reason and its last success date, from one
read over `registry_ingest_partitions` (`getRegistryFeedFreshness`) and the scheduler's own plan
(`registryPartitionsBySource`, with Atlas's newest table sizes for size holds). First match wins:

| Status | When |
|---|---|
| skipped | the scheduler plans no partition: held licence, a table over its own size budget, or the API key not set |
| empty | nothing loaded yet; the host refused production since the last success (`missing_source`); or every load came back empty |
| failed | a partition failed after the last success (newest error is the reason) |
| stale | the last success is older than the cadence allows: daily 3, weekly 14, monthly 45, quarterly 120, annual 400, irregular 90 days; one-time never |
| fresh | otherwise |

A success is the registry's own: a partition that loaded rows, or an unblocked empty check.
Deming records the report every day (`deming-source-health` in Atlas's scoreboard run). The
morning brief reads it when it runs (the scoreboard runs after the brief) and lists only the
sources that are not fresh: every failed and empty source by name with its reason, stale and
skipped ones up to 25 lines. Read-only; internal only.

## Run ledger name

Registry runs and steps are written as `hoovie` (#1865; the `agent_registry` row is migration
`20270110000061_hoovie_agent.sql`). Rows written before the switch keep the name `magellan` and
are never relabelled; readers that group the ledger by agent file a `registry-*` step under
Magellan's name as Hoovie's (`names.ts`). The run marker `params_json.source = 'magellan.registry'`
and the idempotency key prefix `magellan:registry:` are unchanged, so the registry tick finds old
and new runs alike and a run queued before the switch is reused, not doubled.

`agent_runs.agent_name` references `agent_registry`, so before it writes `hoovie` the scheduler
reads the `hoovie` row once per process (`registryLedgerAgent` in `registry-scheduler.ts`). While
the row is missing, or the read fails, runs keep the name `magellan` and record why in
`params_json.ledger_agent_fallback`.

## LEI links (#1868)

The `gleif` source's `lei-match-*` partitions (`magellan/registry/gleif-lei-match.ts`) link each
tracked bank and credit union to its GLEIF LEI in `institution_lei_links`, with the basis:
the institution's own LEI, then the record GLEIF holds under the Fed's National Information
Center (RSSD), the FDIC (cert) or the NCUA (charter), each authority found by name in GLEIF's
list, then one record with the exact legal name in the institution's state. A name alone never
links; two candidates are never settled by picking one. Rows with status `ambiguous` or
`unmatched` are the one review queue. A key link replaces a name link; two keys that disagree go
to review. `getLeiLinkCoverage` gives the share linked; Hamilton reads a family through
`queryData` with measure `family:lei`.

Database load: every statement runs under a 15 s statement timeout, writes go in chunks of 250,
and one run writes at most 1,000 changed rows (key partitions) or 60 institutions (name search,
one GLEIF call a second). Leftover work waits for the next run of the partition, an hour or two
later; a register longer than 75 pages is walked over several runs (`detail.walk_resume`), and
only a walk that read every page in one run may clear a link its key no longer finds.
