import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import type { AgentRunTriggerSource } from "@/lib/agents/types";
import { FDIC_FINANCIALS_SOURCE, FDIC_FILING_LAG_DAYS } from "@/lib/agents/magellan/registry/fdic-financials";
import { FDIC_UNIVERSE_PARSER_VERSION, FDIC_UNIVERSE_SOURCE } from "@/lib/agents/magellan/registry/fdic-universe";
import { FFIEC_OVERDRAFT_PARSER_VERSION, FFIEC_OVERDRAFT_SOURCE, ffiecOverdraftPartitions } from "@/lib/agents/magellan/registry/ffiec-overdraft";
import { FDIC_SOD_SOURCE, SOD_FIRST_YEAR, latestSodYear } from "@/lib/agents/magellan/registry/fdic-sod";
import { BEIGE_BOOK_SOURCE, beigeBookCandidates } from "@/lib/agents/magellan/registry/fed";
import { NCUA_FILING_LAG_DAYS, NCUA_FINANCIALS_SOURCE, NCUA_PARSER_VERSION } from "@/lib/agents/magellan/registry/ncua-financials";
import { CFPB_PARSER_VERSION, CFPB_SOURCE } from "@/lib/agents/magellan/registry/cfpb";
import { CENSUS_ACS_PARSER_VERSION, CENSUS_ACS_SOURCE, censusAcsPartitions } from "@/lib/agents/magellan/registry/census-acs";
import { IRS_ZIP_INCOME_SOURCE, irsZipIncomePartitions } from "@/lib/agents/magellan/registry/irs-zip-income";
import { NCUA_BRANCHES_SOURCE, ncuaBranchPartitions } from "@/lib/agents/magellan/registry/ncua-branches";
import { SEC_FILINGS_SOURCE, SEC_LINKS_PARSER_VERSION, SEC_LINKS_SOURCE, secBatchPartitions } from "@/lib/agents/magellan/registry/sec";
import { REGISTRY_SOURCES } from "@/lib/agents/magellan/registry";
import { isProviderStep } from "@/lib/agents/types";
import { STATE_BILLS_PARTITION, STATE_BILLS_SOURCE } from "@/lib/agents/magellan/registry/state-bills";
import { FEDERAL_BILLS_PARTITION, FEDERAL_BILLS_SOURCE } from "@/lib/agents/magellan/registry/federal-bills";
import { ENFORCEMENT_MATCHER_VERSION, ENFORCEMENT_SOURCE } from "@/lib/agents/magellan/registry/enforcement";
import { STATE_ENFORCEMENT_PARSER_VERSION, STATE_ENFORCEMENT_SOURCE } from "@/lib/agents/magellan/registry/state-enforcement";
import { STATE_NEWS_PARSER_VERSION, STATE_REG_NEWS_SOURCE } from "@/lib/agents/magellan/registry/state-reg-news";
import { STATE_BILL_NEWS_SOURCE } from "@/lib/agents/magellan/registry/state-bill-news";
import { CFPB_FIRST_YEAR } from "@/lib/regulatory/cfpb";
import {
  latestPublishableQuarter,
  parseQuarterKey,
  quarterKey,
  quartersNewestFirst,
  type Quarter,
} from "@/lib/regulatory/quarters";

/**
 * Schedules Magellan regulatory-registry runs from the cron tick.
 *
 * One registry run is in flight at a time and each run processes exactly one
 * partition (a universe sync or one call-report quarter). That keeps every tick
 * well inside the function time limit, leaves room for state lanes, and turns a
 * multi-year backfill into a visible sequence of small runs that resumes on its
 * own after any failure.
 *
 * Order: round-robin across sources, newest partitions first, then history
 * back to REGISTRY_BACKFILL_FROM (default 2010Q1).
 */

export const REGISTRY_RUN_SOURCE = "magellan.registry";
export const DEFAULT_BACKFILL_FROM: Quarter = { year: 2010, quarter: 1 };
/** If a scheduled run dies without recording an outcome, retry after this long. */
const CLAIM_RETRY_HOURS = 6;

/**
 * Sources whose parser has read new accounts since some partitions were pulled. A
 * succeeded or empty partition recorded under an older `detail.parser_version` (missing = 1) is due
 * again, so new fields fill in through ordinary, visible registry runs, newest first.
 */
export const REGISTRY_PARSER_VERSIONS: Record<string, number> = {
  [NCUA_FINANCIALS_SOURCE]: NCUA_PARSER_VERSION,
  [FDIC_UNIVERSE_SOURCE]: FDIC_UNIVERSE_PARSER_VERSION,
  [ENFORCEMENT_SOURCE]: ENFORCEMENT_MATCHER_VERSION,
  [STATE_ENFORCEMENT_SOURCE]: STATE_ENFORCEMENT_PARSER_VERSION,
  [STATE_REG_NEWS_SOURCE]: STATE_NEWS_PARSER_VERSION,
  [STATE_BILL_NEWS_SOURCE]: STATE_NEWS_PARSER_VERSION,
  [CENSUS_ACS_SOURCE]: CENSUS_ACS_PARSER_VERSION,
  [CFPB_SOURCE]: CFPB_PARSER_VERSION,
  [SEC_LINKS_SOURCE]: SEC_LINKS_PARSER_VERSION,
  [FFIEC_OVERDRAFT_SOURCE]: FFIEC_OVERDRAFT_PARSER_VERSION,
};

/**
 * True when a partition should run again now because the parser changed: a succeeded or empty
 * partition recorded by an older parser, or a claimed partition (still "scheduled" after a failed
 * run) claimed under an older parser. The second case means a code fix retries its failures on
 * the next tick instead of waiting out the claim's retry hours.
 */
export function isParserStale(
  source: string,
  status: string | null,
  parserVersion: number | null,
  claimedParserVersion: number | null = null,
): boolean {
  const current = REGISTRY_PARSER_VERSIONS[source];
  if (current === undefined) return false;
  if (status === "succeeded" || status === "empty") return (parserVersion ?? 1) < current;
  if (status === "scheduled") return (claimedParserVersion ?? 1) < current;
  return false;
}

/**
 * A Census vintage skipped because no CENSUS_API_KEY was set is due as soon as a key is set,
 * instead of waiting out its daily re-check. A vintage Census rejected with a key stays put.
 */
export function isKeylessSkipNowKeyed(keylessSkip: boolean, key: string | undefined = process.env.CENSUS_API_KEY): boolean {
  return keylessSkip && Boolean(key?.trim());
}

/** SQL test for a partition recorded as skipped because no Census key was set. */
const KEYLESS_SKIP_REASON = "No CENSUS_API_KEY set%";

export interface RegistryPartitionCandidate {
  source: string;
  partitionKey: string;
}

export interface RegistryScheduleResult {
  scheduled: boolean;
  reason: "scheduled" | "active_run" | "nothing_due" | "schema_missing" | "claim_lost";
  source?: string;
  partitionKey?: string;
  runId?: number;
  reused?: boolean;
}

export function backfillStart(env: string | undefined = process.env.REGISTRY_BACKFILL_FROM): Quarter {
  return (env && parseQuarterKey(env)) || DEFAULT_BACKFILL_FROM;
}

function years(from: number, to: number): string[] {
  const out: string[] = [];
  for (let year = to; year >= from; year -= 1) out.push(String(year));
  return out;
}

/** Each source's partitions, newest first. Fixed-partition sources come from REGISTRY_SOURCES. */
export function registryPartitionsBySource(
  now: Date,
  from: Quarter = backfillStart(),
  env: NodeJS.ProcessEnv = process.env,
): Array<{ source: string; partitions: string[] }> {
  const quarters = (lagDays: number) =>
    quartersNewestFirst(from, latestPublishableQuarter(now, lagDays)).map(quarterKey);
  const dynamic: Record<string, string[]> = {
    [FDIC_FINANCIALS_SOURCE]: quarters(FDIC_FILING_LAG_DAYS),
    [NCUA_FINANCIALS_SOURCE]: quarters(NCUA_FILING_LAG_DAYS),
    [FFIEC_OVERDRAFT_SOURCE]: ffiecOverdraftPartitions(now),
    [NCUA_BRANCHES_SOURCE]: ncuaBranchPartitions(now),
    [FDIC_SOD_SOURCE]: years(Math.max(SOD_FIRST_YEAR, from.year), latestSodYear(now)),
    [CENSUS_ACS_SOURCE]: censusAcsPartitions(now),
    [IRS_ZIP_INCOME_SOURCE]: irsZipIncomePartitions(now),
    [CFPB_SOURCE]: years(Math.max(CFPB_FIRST_YEAR, from.year), now.getUTCFullYear()),
    [SEC_FILINGS_SOURCE]: secBatchPartitions(),
    [BEIGE_BOOK_SOURCE]: beigeBookCandidates(now),
    // No key, no runs: state bills wait for OPEN_STATES_API_KEY rather than queue skips.
    // One partition; each run works through the states that are due (state-bills.ts).
    [STATE_BILLS_SOURCE]: env.OPEN_STATES_API_KEY?.trim() ? [STATE_BILLS_PARTITION] : [],
    [FEDERAL_BILLS_SOURCE]: env.CONGRESS_GOV_API_KEY?.trim() ? [FEDERAL_BILLS_PARTITION] : [],
  };
  return REGISTRY_SOURCES.map((definition) => ({
    source: definition.source,
    partitions: definition.fixedPartition ? [definition.fixedPartition] : dynamic[definition.source] ?? [],
  }));
}

/**
 * Every partition the registry should hold, in priority order: round-robin
 * across sources (each source's newest partition first), so one source's long
 * backfill never starves the others. Within a round, REGISTRY_SOURCES order
 * applies, which puts identity syncs (FDIC universe, SEC links) ahead of the
 * data that depends on them.
 */
export function registryCandidates(now: Date, from: Quarter = backfillStart()): RegistryPartitionCandidate[] {
  const lists = registryPartitionsBySource(now, from);
  const longest = Math.max(0, ...lists.map((list) => list.partitions.length));
  const out: RegistryPartitionCandidate[] = [];
  for (let round = 0; round < longest; round += 1) {
    for (const list of lists) {
      const partitionKey = list.partitions[round];
      if (partitionKey) out.push({ source: list.source, partitionKey });
    }
  }
  return out;
}

interface PartitionStateRow {
  source: string;
  partition_key: string;
  due: boolean;
}

/** First candidate that has never been attempted or whose next attempt is due. */
export function pickDueCandidate(
  candidates: RegistryPartitionCandidate[],
  rows: PartitionStateRow[],
): RegistryPartitionCandidate | null {
  const state = new Map(rows.map((row) => [`${row.source}:${row.partition_key}`, row.due]));
  for (const candidate of candidates) {
    const due = state.get(`${candidate.source}:${candidate.partitionKey}`);
    if (due === undefined || due) return candidate;
  }
  return null;
}

function isMissingSchemaError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("registry_ingest_partitions") && message.includes("does not exist");
}

async function hasActiveRegistryRun(): Promise<boolean> {
  const [row] = await sql<{ active: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM agent_runs
       WHERE status IN ('queued', 'running', 'cancel_requested')
         AND params_json->>'source' = ${REGISTRY_RUN_SOURCE}
    ) AS active
  `;
  return Boolean(row?.active);
}

/** Atomically claim a partition so two ticks never schedule the same one. */
async function claimPartition(candidate: RegistryPartitionCandidate): Promise<boolean> {
  const parserVersion = REGISTRY_PARSER_VERSIONS[candidate.source] ?? 0;
  const censusKeySet = isKeylessSkipNowKeyed(true);
  const rows = await sql`
    INSERT INTO registry_ingest_partitions (source, partition_key, status, attempts, next_attempt_after, detail)
    VALUES (${candidate.source}, ${candidate.partitionKey}, 'scheduled', 1,
            NOW() + (${CLAIM_RETRY_HOURS} * INTERVAL '1 hour'),
            jsonb_build_object('claimed_parser_version', ${parserVersion}::int))
    ON CONFLICT (source, partition_key) DO UPDATE SET
      status = 'scheduled',
      attempts = registry_ingest_partitions.attempts + 1,
      next_attempt_after = EXCLUDED.next_attempt_after,
      detail = COALESCE(registry_ingest_partitions.detail, '{}'::jsonb)
               || jsonb_build_object('claimed_parser_version', ${parserVersion}::int),
      updated_at = NOW()
    WHERE registry_ingest_partitions.next_attempt_after <= NOW()
       OR (registry_ingest_partitions.status IN ('succeeded', 'empty')
           AND COALESCE((registry_ingest_partitions.detail->>'parser_version')::int, 1) < ${parserVersion})
       OR (registry_ingest_partitions.status = 'scheduled'
           AND COALESCE((registry_ingest_partitions.detail->>'claimed_parser_version')::int, 1) < ${parserVersion})
       OR (${censusKeySet}::boolean
           AND registry_ingest_partitions.status = 'empty'
           AND registry_ingest_partitions.detail->>'reason' LIKE ${KEYLESS_SKIP_REASON})
    RETURNING id
  `;
  return [...rows].length > 0;
}

export async function startRegistryRun(input: {
  source: string;
  partitionKey: string;
  triggeredBy: string;
  triggerSource?: AgentRunTriggerSource;
  dryRun?: boolean;
}) {
  const definition = REGISTRY_SOURCES.find((entry) => entry.source === input.source);
  if (!definition) throw new Error(`Unknown registry source: ${input.source}`);
  const label = input.partitionKey === definition.fixedPartition ? "" : ` ${input.partitionKey}`;
  return startAgentRun({
    agent: "magellan",
    kind: input.dryRun ? "dry_run" : "workflow",
    title: `Magellan registry: ${definition.title}${label}`,
    params: {
      source: REGISTRY_RUN_SOURCE,
      registry_source: input.source,
      partition_key: input.partitionKey,
    },
    triggeredBy: input.triggeredBy,
    triggerSource: input.triggerSource ?? "schedule",
    idempotencyKey: `magellan:registry:${input.source}:${input.partitionKey}${input.dryRun ? ":dry" : ""}`,
    steps: [
      {
        key: definition.stepKey,
        agent: "magellan",
        title: `${definition.title}${label}`,
        input: { partition_key: input.partitionKey },
      },
    ],
    summary: isProviderStep(definition.stepKey)
      ? `Magellan registry run for ${input.source} ${input.partitionKey}. Provider step: budget-checked model calls, each logged with its cost.`
      : `Magellan registry run for ${input.source} ${input.partitionKey}. Deterministic: published regulator data only, no provider calls.`,
  });
}

export async function scheduleDueRegistryRuns({
  now = new Date(),
  triggeredBy = "atlas.scheduler",
}: { now?: Date; triggeredBy?: string } = {}): Promise<RegistryScheduleResult> {
  try {
    if (await hasActiveRegistryRun()) return { scheduled: false, reason: "active_run" };

    const candidates = registryCandidates(now);
    const rows = await sql<(PartitionStateRow & { status: string | null; parser_version: string | null; claimed_parser_version: string | null; keyless_skip: boolean })[]>`
      SELECT source, partition_key, (next_attempt_after <= NOW()) AS due, status,
             detail->>'parser_version' AS parser_version,
             detail->>'claimed_parser_version' AS claimed_parser_version,
             (status = 'empty' AND COALESCE(detail->>'reason', '') LIKE ${KEYLESS_SKIP_REASON}) AS keyless_skip
        FROM registry_ingest_partitions
       WHERE source IN ${sql([...new Set(candidates.map((c) => c.source))])}
    `;
    const states = [...rows].map((row) => ({
      source: row.source,
      partition_key: row.partition_key,
      due: row.due || isKeylessSkipNowKeyed(Boolean(row.keyless_skip)) || isParserStale(
        row.source,
        row.status,
        row.parser_version === null ? null : Number(row.parser_version),
        row.claimed_parser_version === null ? null : Number(row.claimed_parser_version),
      ),
    }));
    const candidate = pickDueCandidate(candidates, states);
    if (!candidate) return { scheduled: false, reason: "nothing_due" };
    if (!(await claimPartition(candidate))) return { scheduled: false, reason: "claim_lost" };

    const started = await startRegistryRun({ ...candidate, triggeredBy });
    await sql`
      UPDATE registry_ingest_partitions
         SET agent_run_id = ${started.run.id}, updated_at = NOW()
       WHERE source = ${candidate.source} AND partition_key = ${candidate.partitionKey}
    `;
    return {
      scheduled: true,
      reason: "scheduled",
      source: candidate.source,
      partitionKey: candidate.partitionKey,
      runId: started.run.id,
      reused: started.reused,
    };
  } catch (error) {
    if (isMissingSchemaError(error)) return { scheduled: false, reason: "schema_missing" };
    throw error;
  }
}

/** The oldest queued registry run, if any (one is normally in flight at a time). */
export async function findQueuedRegistryRunId(): Promise<number | null> {
  const [row] = await sql<{ id: number }[]>`
    SELECT id FROM agent_runs
     WHERE status = 'queued' AND params_json->>'source' = ${REGISTRY_RUN_SOURCE}
     ORDER BY started_at ASC
     LIMIT 1
  `;
  return row ? Number(row.id) : null;
}
