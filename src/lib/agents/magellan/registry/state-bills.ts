import { sql } from "@/lib/data-store/connection";
import { type RegistryFetchOptions } from "@/lib/regulatory/http";
import { fetchStateFeeBills, STATE_BILL_JURISDICTIONS, type BillStage } from "@/lib/regulatory/open-states";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: read bank and credit union fee bills from Open States into
 * reg_tracker_items, so the regulation tracker can show which bills are moving and where
 * each one stands. The scheduler queues one partition, "current"; each run reads the
 * next STATES_PER_RUN states not checked in the last week and records each state under
 * its own partition row (refreshed weekly). One state per run took about four days to
 * cover all 52, since the registry runs one step every five minutes across all sources.
 *
 * Needs OPEN_STATES_API_KEY. Without it the step records the partition as waiting on
 * the key and checks again the next day. Shadow mode until STATE_BILLS_TRACKER_LIVE=true:
 * the step fetches and counts stages but writes no tracker rows.
 */

export const STATE_BILLS_SOURCE = "state-bills";
const STATE_BILLS_REFRESH_HOURS = 24 * 7;
const MISSING_KEY_RETRY_HOURS = 24;
/** Bills with any action in the last 400 days: this year's session and last year's. */
export const STATE_BILLS_LOOKBACK_DAYS = 400;

export const STATE_BILLS_PARTITION = "current";
/** About 5 Open States requests and 5 seconds a state, so a run stays near a minute. */
export const STATES_PER_RUN = 12;
const STATE_FAILED_RETRY_HOURS = 6;
const BATCH_BACKLOG_RETRY_HOURS = 1;
const BATCH_IDLE_RETRY_HOURS = 24;

export function stateBillsLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STATE_BILLS_TRACKER_LIVE === "true";
}

export interface RegistryStateBillsResult {
  source: string;
  partitionKey: string;
  since: string;
  missingKey: boolean;
  searched: number;
  requests: number;
  fetched: number;
  stored: number;
  stages: Record<BillStage, number>;
  shadow: boolean;
  dryRun: boolean;
}

export async function runRegistryStateBills(
  options: {
    partitionKey: string;
    runId?: number | null;
    dryRun?: boolean;
    db?: RegistryDb;
    fetchOptions?: RegistryFetchOptions;
    now?: Date;
    live?: boolean;
    apiKey?: string | null;
  },
): Promise<RegistryStateBillsResult> {
  const db = options.db ?? sql;
  const now = options.now ?? new Date();
  const stateCode = options.partitionKey.toUpperCase();
  const since = new Date(now.getTime() - STATE_BILLS_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const apiKey = options.apiKey === undefined ? process.env.OPEN_STATES_API_KEY?.trim() : options.apiKey?.trim();
  const shadow = !(options.live ?? stateBillsLive());
  const stages: Record<BillStage, number> = {
    introduced: 0,
    in_committee: 0,
    passed_chamber: 0,
    passed_legislature: 0,
    signed: 0,
    vetoed: 0,
    failed: 0,
  };
  const result: RegistryStateBillsResult = {
    source: STATE_BILLS_SOURCE,
    partitionKey: stateCode,
    since,
    missingKey: !apiKey,
    searched: 0,
    requests: 0,
    fetched: 0,
    stored: 0,
    stages,
    shadow,
    dryRun: Boolean(options.dryRun),
  };

  if (!apiKey) {
    if (!options.dryRun) {
      await recordRegistryPartition(db, {
        source: STATE_BILLS_SOURCE,
        partitionKey: stateCode,
        status: "empty",
        rowCount: 0,
        runId: options.runId ?? null,
        nextAttemptAfterHours: MISSING_KEY_RETRY_HOURS,
        detail: { missing_key: true },
      });
    }
    return result;
  }

  const { items, searched, requests } = await fetchStateFeeBills(stateCode, since, apiKey, options.fetchOptions);
  for (const item of items) stages[item.stage] += 1;
  result.searched = searched;
  result.requests = requests;
  result.fetched = items.length;
  if (options.dryRun) return result;

  if (!shadow && items.length > 0) {
    const payload = JSON.stringify(items);
    const stored = await db<Array<{ external_id: string }>>`
      INSERT INTO reg_tracker_items (
        source, external_id, kind, title, jurisdiction, published_on, url, topics,
        identifier, session, stage, stage_on
      )
      SELECT 'open_states', r.id, 'state_bill', r.title, r.state_code,
             COALESCE(r.first_action_date, r.latest_action_date, CURRENT_DATE::text)::date, r.url,
             ARRAY(SELECT jsonb_array_elements_text(r.topics)),
             r.identifier, r.session, r.stage, r.stage_date::date
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          id text, state_code text, session text, identifier text, title text, url text,
          first_action_date text, latest_action_date text, stage text, stage_date text, topics jsonb
        )
      ON CONFLICT (source, external_id) DO UPDATE SET
        title = EXCLUDED.title,
        url = EXCLUDED.url,
        topics = EXCLUDED.topics,
        stage = EXCLUDED.stage,
        stage_on = EXCLUDED.stage_on,
        updated_at = now()
      RETURNING external_id
    `;
    result.stored = stored.length;
  }
  await recordRegistryPartition(db, {
    source: STATE_BILLS_SOURCE,
    partitionKey: stateCode,
    status: items.length > 0 ? "succeeded" : "empty",
    rowCount: result.fetched,
    insertedCount: result.stored,
    sourceUrl: null,
    runId: options.runId ?? null,
    nextAttemptAfterHours: STATE_BILLS_REFRESH_HOURS,
    detail: {
      since,
      stages,
      searched,
      requests,
      shadow,
      bills: items.slice(0, 25).map((item) => `${item.identifier} (${item.stage})`),
    },
  });
  return result;
}

export interface RegistryStateBillsBatchResult {
  source: string;
  partitionKey: string;
  missingKey: boolean;
  states: string[];
  failedStates: string[];
  remaining: number;
  fetched: number;
  stored: number;
  stages: Record<BillStage, number>;
  shadow: boolean;
  dryRun: boolean;
}

/** One scheduled run: the next STATES_PER_RUN states whose weekly check is due. */
export async function runRegistryStateBillsBatch(
  options: {
    runId?: number | null;
    dryRun?: boolean;
    db?: RegistryDb;
    fetchOptions?: RegistryFetchOptions;
    now?: Date;
    live?: boolean;
    apiKey?: string | null;
    statesPerRun?: number;
  } = {},
): Promise<RegistryStateBillsBatchResult> {
  const db = options.db ?? sql;
  const apiKey = options.apiKey === undefined ? process.env.OPEN_STATES_API_KEY?.trim() : options.apiKey?.trim();
  const stages: Record<BillStage, number> = {
    introduced: 0,
    in_committee: 0,
    passed_chamber: 0,
    passed_legislature: 0,
    signed: 0,
    vetoed: 0,
    failed: 0,
  };
  const result: RegistryStateBillsBatchResult = {
    source: STATE_BILLS_SOURCE,
    partitionKey: STATE_BILLS_PARTITION,
    missingKey: !apiKey,
    states: [],
    failedStates: [],
    remaining: 0,
    fetched: 0,
    stored: 0,
    stages,
    shadow: !(options.live ?? stateBillsLive()),
    dryRun: Boolean(options.dryRun),
  };
  if (!apiKey) {
    if (!options.dryRun) {
      await recordRegistryPartition(db, {
        source: STATE_BILLS_SOURCE,
        partitionKey: STATE_BILLS_PARTITION,
        status: "empty",
        rowCount: 0,
        runId: options.runId ?? null,
        nextAttemptAfterHours: MISSING_KEY_RETRY_HOURS,
        detail: { missing_key: true },
      });
    }
    return result;
  }

  const fresh = await db<Array<{ partition_key: string }>>`
    SELECT partition_key FROM registry_ingest_partitions
     WHERE source = ${STATE_BILLS_SOURCE} AND partition_key <> ${STATE_BILLS_PARTITION}
       AND next_attempt_after > NOW()
  `;
  const notDue = new Set(fresh.map((row) => row.partition_key));
  const due = STATE_BILL_JURISDICTIONS.filter((code) => !notDue.has(code));
  const batch = due.slice(0, options.statesPerRun ?? STATES_PER_RUN);
  result.states = batch;
  result.remaining = due.length - batch.length;

  const errors: string[] = [];
  for (const stateCode of batch) {
    try {
      const one = await runRegistryStateBills({ ...options, partitionKey: stateCode, apiKey, db });
      result.fetched += one.fetched;
      result.stored += one.stored;
      for (const key of Object.keys(stages) as BillStage[]) stages[key] += one.stages[key];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failedStates.push(stateCode);
      errors.push(`${stateCode}: ${message}`);
      if (!options.dryRun) {
        await recordRegistryPartition(db, {
          source: STATE_BILLS_SOURCE,
          partitionKey: stateCode,
          status: "failed",
          rowCount: 0,
          runId: options.runId ?? null,
          nextAttemptAfterHours: STATE_FAILED_RETRY_HOURS,
          error: message.slice(0, 500),
        });
      }
    }
  }
  if (batch.length > 0 && result.failedStates.length === batch.length) {
    throw new Error(`Every state in this run failed: ${errors.slice(0, 3).join("; ")}`);
  }
  if (options.dryRun) return result;

  await recordRegistryPartition(db, {
    source: STATE_BILLS_SOURCE,
    partitionKey: STATE_BILLS_PARTITION,
    status: batch.length > 0 ? "succeeded" : "empty",
    rowCount: result.fetched,
    insertedCount: result.stored,
    unmatchedCount: result.failedStates.length,
    runId: options.runId ?? null,
    // Come back within the hour while states are still due; otherwise check daily.
    nextAttemptAfterHours: result.remaining > 0 ? BATCH_BACKLOG_RETRY_HOURS : BATCH_IDLE_RETRY_HOURS,
    detail: { states: batch, failed: errors, remaining: result.remaining, stages, shadow: result.shadow },
  });
  return result;
}
