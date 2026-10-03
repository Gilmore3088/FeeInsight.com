import { sql } from "@/lib/data-store/connection";

/**
 * Bookkeeping for regulator-data partitions (one FDIC quarter, one universe
 * sync, ...). The scheduler claims a due partition; the worker records the
 * outcome and when it should be looked at again.
 */

export type RegistryDb = typeof sql;

export type RegistryPartitionStatus = "scheduled" | "succeeded" | "empty" | "failed";

export interface RegistryPartitionOutcome {
  source: string;
  partitionKey: string;
  status: Exclude<RegistryPartitionStatus, "scheduled">;
  rowCount: number;
  matchedCount?: number;
  unmatchedCount?: number;
  insertedCount?: number;
  sourceUrl?: string | null;
  runId?: number | null;
  /** Hours until the scheduler should refresh or retry this partition. */
  nextAttemptAfterHours: number;
  detail?: Record<string, unknown>;
  error?: string | null;
}

export async function recordRegistryPartition(
  db: RegistryDb,
  outcome: RegistryPartitionOutcome,
): Promise<void> {
  const hours = Math.max(1, Math.round(outcome.nextAttemptAfterHours));
  await db`
    INSERT INTO registry_ingest_partitions
      (source, partition_key, status, attempts, row_count, matched_count, unmatched_count,
       inserted_count, source_url, agent_run_id, last_error, detail, next_attempt_after,
       fetched_at, updated_at)
    VALUES
      (${outcome.source}, ${outcome.partitionKey}, ${outcome.status}, 1, ${outcome.rowCount},
       ${outcome.matchedCount ?? null}, ${outcome.unmatchedCount ?? null}, ${outcome.insertedCount ?? null},
       ${outcome.sourceUrl ?? null}, ${outcome.runId ?? null}, ${outcome.error ?? null},
       ${JSON.stringify(outcome.detail ?? {})}::jsonb, NOW() + (${hours} * INTERVAL '1 hour'),
       NOW(), NOW())
    ON CONFLICT (source, partition_key) DO UPDATE SET
      status = EXCLUDED.status,
      row_count = EXCLUDED.row_count,
      matched_count = EXCLUDED.matched_count,
      unmatched_count = EXCLUDED.unmatched_count,
      inserted_count = EXCLUDED.inserted_count,
      source_url = EXCLUDED.source_url,
      agent_run_id = COALESCE(EXCLUDED.agent_run_id, registry_ingest_partitions.agent_run_id),
      last_error = EXCLUDED.last_error,
      detail = EXCLUDED.detail,
      next_attempt_after = EXCLUDED.next_attempt_after,
      fetched_at = EXCLUDED.fetched_at,
      updated_at = NOW()
  `;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
