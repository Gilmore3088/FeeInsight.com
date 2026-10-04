import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import type { AgentRunTriggerSource } from "@/lib/agents/types";
import { FDIC_FINANCIALS_SOURCE, FDIC_FILING_LAG_DAYS } from "@/lib/agents/magellan/registry/fdic-financials";
import { FDIC_SOD_SOURCE, SOD_FIRST_YEAR, latestSodYear } from "@/lib/agents/magellan/registry/fdic-sod";
import { BEIGE_BOOK_SOURCE, beigeBookCandidates } from "@/lib/agents/magellan/registry/fed";
import { NCUA_FILING_LAG_DAYS, NCUA_FINANCIALS_SOURCE } from "@/lib/agents/magellan/registry/ncua-financials";
import { CFPB_SOURCE } from "@/lib/agents/magellan/registry/cfpb";
import { SEC_FILINGS_SOURCE, secBatchPartitions } from "@/lib/agents/magellan/registry/sec";
import { REGISTRY_SOURCES } from "@/lib/agents/magellan/registry";
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
export function registryPartitionsBySource(now: Date, from: Quarter = backfillStart()): Array<{ source: string; partitions: string[] }> {
  const quarters = (lagDays: number) =>
    quartersNewestFirst(from, latestPublishableQuarter(now, lagDays)).map(quarterKey);
  const dynamic: Record<string, string[]> = {
    [FDIC_FINANCIALS_SOURCE]: quarters(FDIC_FILING_LAG_DAYS),
    [NCUA_FINANCIALS_SOURCE]: quarters(NCUA_FILING_LAG_DAYS),
    [FDIC_SOD_SOURCE]: years(Math.max(SOD_FIRST_YEAR, from.year), latestSodYear(now)),
    [CFPB_SOURCE]: years(Math.max(CFPB_FIRST_YEAR, from.year), now.getUTCFullYear()),
    [SEC_FILINGS_SOURCE]: secBatchPartitions(),
    [BEIGE_BOOK_SOURCE]: beigeBookCandidates(now),
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
  const rows = await sql`
    INSERT INTO registry_ingest_partitions (source, partition_key, status, attempts, next_attempt_after)
    VALUES (${candidate.source}, ${candidate.partitionKey}, 'scheduled', 1,
            NOW() + (${CLAIM_RETRY_HOURS} * INTERVAL '1 hour'))
    ON CONFLICT (source, partition_key) DO UPDATE SET
      status = 'scheduled',
      attempts = registry_ingest_partitions.attempts + 1,
      next_attempt_after = EXCLUDED.next_attempt_after,
      updated_at = NOW()
    WHERE registry_ingest_partitions.next_attempt_after <= NOW()
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
    summary: `Magellan registry run for ${input.source} ${input.partitionKey}. Deterministic: published regulator data only, no provider calls.`,
  });
}

export async function scheduleDueRegistryRuns({
  now = new Date(),
  triggeredBy = "atlas.scheduler",
}: { now?: Date; triggeredBy?: string } = {}): Promise<RegistryScheduleResult> {
  try {
    if (await hasActiveRegistryRun()) return { scheduled: false, reason: "active_run" };

    const candidates = registryCandidates(now);
    const rows = await sql<PartitionStateRow[]>`
      SELECT source, partition_key, (next_attempt_after <= NOW()) AS due
        FROM registry_ingest_partitions
       WHERE source IN ${sql([...new Set(candidates.map((c) => c.source))])}
    `;
    const candidate = pickDueCandidate(candidates, [...rows]);
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
