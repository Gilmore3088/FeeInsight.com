import { sql } from "@/lib/data-store/connection";
import { currentCongress, fetchFederalFeeBills } from "@/lib/regulatory/congress-gov";
import { type RegistryFetchOptions } from "@/lib/regulatory/http";
import type { BillStage } from "@/lib/regulatory/open-states";
import { recordRegistryPartition, type RegistryDb } from "./partitions";
import { flagOn, flagState } from "./live-flag";

/**
 * Magellan registry step: scan the current Congress's bills on Congress.gov once a day
 * and keep the bank and credit union fee bills in reg_tracker_items (partition "current"),
 * so the regulation tracker shows federal bills beside state bills and federal rules.
 *
 * Needs CONGRESS_GOV_API_KEY; the scheduler only queues it once the key is set. Shadow
 * mode until FEDERAL_BILLS_TRACKER_LIVE=true: the step fetches and counts stages but
 * writes no tracker rows.
 */

export const FEDERAL_BILLS_SOURCE = "federal-bills";
export const FEDERAL_BILLS_PARTITION = "current";
const FEDERAL_BILLS_REFRESH_HOURS = 24;
const MISSING_KEY_RETRY_HOURS = 24;

export function federalBillsLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagOn(env.FEDERAL_BILLS_TRACKER_LIVE);
}

export interface RegistryFederalBillsResult {
  source: string;
  partitionKey: string;
  congress: number;
  missingKey: boolean;
  scanned: number;
  reported_total: number | null;
  requests: number;
  fetched: number;
  stored: number;
  stages: Record<BillStage, number>;
  shadow: boolean;
  dryRun: boolean;
}

export async function runRegistryFederalBills(
  options: {
    runId?: number | null;
    dryRun?: boolean;
    db?: RegistryDb;
    fetchOptions?: RegistryFetchOptions;
    now?: Date;
    live?: boolean;
    apiKey?: string | null;
  } = {},
): Promise<RegistryFederalBillsResult> {
  const db = options.db ?? sql;
  const congress = currentCongress(options.now ?? new Date());
  const apiKey = options.apiKey === undefined ? process.env.CONGRESS_GOV_API_KEY?.trim() : options.apiKey?.trim();
  const stages: Record<BillStage, number> = {
    introduced: 0,
    in_committee: 0,
    passed_chamber: 0,
    passed_legislature: 0,
    signed: 0,
    vetoed: 0,
    failed: 0,
  };
  const result: RegistryFederalBillsResult = {
    source: FEDERAL_BILLS_SOURCE,
    partitionKey: FEDERAL_BILLS_PARTITION,
    congress,
    missingKey: !apiKey,
    scanned: 0,
    reported_total: null,
    requests: 0,
    fetched: 0,
    stored: 0,
    stages,
    shadow: !(options.live ?? federalBillsLive()),
    dryRun: Boolean(options.dryRun),
  };

  if (!apiKey) {
    if (!options.dryRun) {
      await recordRegistryPartition(db, {
        source: FEDERAL_BILLS_SOURCE,
        partitionKey: FEDERAL_BILLS_PARTITION,
        status: "empty",
        rowCount: 0,
        runId: options.runId ?? null,
        nextAttemptAfterHours: MISSING_KEY_RETRY_HOURS,
        detail: { missing_key: true },
      });
    }
    return result;
  }

  const { items, scanned, total, requests } = await fetchFederalFeeBills(congress, apiKey, options.fetchOptions);
  for (const item of items) stages[item.stage] += 1;
  Object.assign(result, { scanned, reported_total: total, requests, fetched: items.length });
  if (options.dryRun) return result;

  if (!result.shadow && items.length > 0) {
    const payload = JSON.stringify(items);
    const stored = await db<Array<{ external_id: string }>>`
      INSERT INTO reg_tracker_items (
        source, external_id, kind, title, jurisdiction, published_on, url, topics,
        identifier, session, stage, stage_on
      )
      SELECT 'congress_gov', r.id, 'federal_bill', r.title, 'US',
             COALESCE(r.latest_action_date, CURRENT_DATE::text)::date, r.url,
             ARRAY(SELECT jsonb_array_elements_text(r.topics)),
             r.identifier, r.congress::text, r.stage, r.stage_date::date
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          id text, congress int, identifier text, title text, url text,
          latest_action_date text, stage text, stage_date text, topics jsonb
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
    source: FEDERAL_BILLS_SOURCE,
    partitionKey: FEDERAL_BILLS_PARTITION,
    status: items.length > 0 ? "succeeded" : "empty",
    rowCount: result.fetched,
    insertedCount: result.stored,
    sourceUrl: null,
    runId: options.runId ?? null,
    nextAttemptAfterHours: FEDERAL_BILLS_REFRESH_HOURS,
    detail: {
      congress,
      scanned,
      reported_total: total,
      requests,
      stages,
      shadow: result.shadow,
      live_flag: options.live === undefined ? flagState(process.env.FEDERAL_BILLS_TRACKER_LIVE) : "override",
      bills: items.slice(0, 25).map((item) => `${item.identifier} (${item.stage})`),
    },
  });
  return result;
}
