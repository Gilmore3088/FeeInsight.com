import { sql } from "@/lib/data-store/connection";
import { RegistryHttpError, type RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  fetchStateFeeBills,
  OPEN_STATES_REQUEST_INTERVAL_MS,
  STATE_BILL_JURISDICTIONS,
  type BillStage,
} from "@/lib/regulatory/open-states";
import { recordRegistryPartition, type RegistryDb } from "./partitions";
import { flagOn } from "./live-flag";

/**
 * Magellan registry step: read bank and credit union fee bills from Open States into
 * reg_tracker_items, so the regulation tracker can show which bills are moving and where
 * each one stands. The scheduler queues one partition, "current"; each run reads the
 * next STATES_PER_RUN states not checked in the last week and records each state under
 * its own partition row (refreshed weekly). Open States allows about ten requests a
 * minute, so requests are paced and a run starts no new state after STATE_START_CUTOFF_MS;
 * a 429 stops the run and leaves the remaining states due.
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
/** Most states a run reads. In practice the time cutoff below stops a run first. */
export const STATES_PER_RUN = 12;
/**
 * A run starts no new state after this long. Requests are paced to about ten a minute
 * (OPEN_STATES_REQUEST_INTERVAL_MS) and a state takes up to six, so a run reads about
 * three or four states and ends within about two minutes.
 */
export const STATE_START_CUTOFF_MS = 60_000;
const STATE_FAILED_RETRY_HOURS = 6;
const BATCH_BACKLOG_RETRY_HOURS = 1;
const BATCH_IDLE_RETRY_HOURS = 24;
/**
 * Version of the bill tagging rules, recorded on each state read. A state with stored bills
 * read under an older version is due again, so a tagging fix reaches bills already stored.
 * 2: groundwater "overdraft" is no longer an overdraft fee (2026-10-08).
 * 3: any "overdraft" in a water bill that never mentions banking is dropped (2026-10-08).
 * 4: overdraft and insufficient funds count only in a sentence about banking or fees (2026-10-08).
 * 5: a fee or penalty sentence about taxes or a state agency no longer counts (NC HB 1164, 2026-10-09).
 */
export const STATE_BILLS_TAGGING_VERSION = 5;

export function stateBillsLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagOn(env.STATE_BILLS_TRACKER_LIVE);
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
  /** Stored bills that no longer pass the bank fee test and had their topics cleared. */
  untagged: number;
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
    requestIntervalMs?: number;
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
    untagged: 0,
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

  const { items, rejectedIds, rejectedSample, searched, requests, anyDateHits } = await fetchStateFeeBills(
    stateCode,
    since,
    apiKey,
    options.fetchOptions,
    options.requestIntervalMs ?? OPEN_STATES_REQUEST_INTERVAL_MS,
  );
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
  if (!shadow && rejectedIds.length > 0) {
    // A bill an earlier tagging rule stored as a fee bill but the current rule rejects: clear its
    // topics so the Wire stops listing it. The row stays, logged here, and is never deleted.
    const untagged = await db<Array<{ external_id: string }>>`
      UPDATE reg_tracker_items SET topics = '{}', updated_at = now()
       WHERE source = 'open_states' AND jurisdiction = ${stateCode}
         AND external_id = ANY(${rejectedIds}::text[]) AND cardinality(topics) > 0
      RETURNING external_id
    `;
    result.untagged = untagged.length;
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
      // Only when nothing matched in the lookback (PR, SD, DE, CT, DC, IN, VA and ME on Oct 8 2026):
      // 0 points to Open States holding no searchable bill text for the state, not a quiet year.
      ...(anyDateHits === null ? {} : { any_date_overdraft_hits: anyDateHits }),
      shadow,
      tagging_version: STATE_BILLS_TAGGING_VERSION,
      untagged: result.untagged,
      bills: items.slice(0, 25).map((item) => `${item.identifier} (${item.stage})`),
      matches: Object.fromEntries(items.slice(0, 25).map((item) => [item.identifier, item.match])),
      rejected_sample: rejectedSample,
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
  /** True when Open States answered 429: the run stopped and the rest stay due. */
  rateLimited: boolean;
  remaining: number;
  fetched: number;
  stored: number;
  untagged: number;
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
    requestIntervalMs?: number;
    startCutoffMs?: number;
    clock?: () => number;
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
    rateLimited: false,
    remaining: 0,
    fetched: 0,
    stored: 0,
    untagged: 0,
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

  // A live run treats a state last read in shadow mode as due: those reads stored nothing, so
  // waiting out their weekly date would leave the bills unstored for up to a week after going live.
  // A state with bills read under older tagging rules is due too, so a tagging fix reaches them.
  const fresh = await db<Array<{ partition_key: string }>>`
    SELECT partition_key FROM registry_ingest_partitions
     WHERE source = ${STATE_BILLS_SOURCE} AND partition_key <> ${STATE_BILLS_PARTITION}
       AND next_attempt_after > NOW()
       AND (${result.shadow}::boolean OR COALESCE(detail->>'shadow', 'false') <> 'true')
       AND (row_count = 0 OR COALESCE((detail->>'tagging_version')::int, 1) >= ${STATE_BILLS_TAGGING_VERSION})
  `;
  const notDue = new Set(fresh.map((row) => row.partition_key));
  const due = STATE_BILL_JURISDICTIONS.filter((code) => !notDue.has(code));
  const candidates = due.slice(0, options.statesPerRun ?? STATES_PER_RUN);
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const cutoffMs = options.startCutoffMs ?? STATE_START_CUTOFF_MS;
  const batch: string[] = [];

  const errors: string[] = [];
  for (const stateCode of candidates) {
    if (batch.length > 0 && clock() - startedAt >= cutoffMs) break;
    try {
      const one = await runRegistryStateBills({ ...options, partitionKey: stateCode, apiKey, db });
      result.fetched += one.fetched;
      result.stored += one.stored;
      result.untagged += one.untagged;
      for (const key of Object.keys(stages) as BillStage[]) stages[key] += one.stages[key];
      batch.push(stateCode);
    } catch (error) {
      // Rate limited: stop here and leave this state due rather than marking it failed for hours.
      if (error instanceof RegistryHttpError && error.status === 429) {
        result.rateLimited = true;
        errors.push(`${stateCode}: rate limited (HTTP 429), left for the next run`);
        break;
      }
      batch.push(stateCode);
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
  result.states = batch;
  result.remaining = due.length - batch.length;
  if (batch.length === 0 && result.rateLimited) {
    throw new Error(`Open States rate limited the first request of this run: ${errors[0]}`);
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
    detail: {
      states: batch,
      failed: errors,
      rate_limited: result.rateLimited,
      remaining: result.remaining,
      untagged: result.untagged,
      stages,
      shadow: result.shadow,
    },
  });
  return result;
}
