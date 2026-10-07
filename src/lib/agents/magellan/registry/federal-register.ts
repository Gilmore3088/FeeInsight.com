import { sql } from "@/lib/data-store/connection";
import { type RegistryFetchOptions } from "@/lib/regulatory/http";
import { fetchFederalRegisterRules, trackerStage, type TrackerStage } from "@/lib/regulatory/federal-register";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: pull the banking regulators' proposed and final rules from
 * the Federal Register once a day into reg_tracker_items (partition "current"), so the
 * regulation tracker can show what is open for comment and what takes effect when.
 *
 * Shadow mode until FEDERAL_REGISTER_TRACKER_LIVE=true: the step fetches and counts
 * stages but writes no tracker rows, so prod can prove the fields before rows land.
 */

export const FEDERAL_REGISTER_SOURCE = "federal-register";
export const FEDERAL_REGISTER_PARTITION = "current";
const FEDERAL_REGISTER_REFRESH_HOURS = 24;
/** Look back far enough to hold every comment period still open and every final rule not yet in effect. */
export const FEDERAL_REGISTER_LOOKBACK_DAYS = 400;

export function federalRegisterLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FEDERAL_REGISTER_TRACKER_LIVE === "true";
}

export interface RegistryFederalRegisterResult {
  source: string;
  partitionKey: string;
  since: string;
  fetched: number;
  reported_total: number | null;
  pages: number;
  stored: number;
  stages: Record<TrackerStage, number>;
  /** Rules per agency short name; a joint rule counts once for each agency. */
  agencies: Record<string, number>;
  fee_related: number;
  shadow: boolean;
  dryRun: boolean;
}

export async function runRegistryFederalRegister(
  options: { runId?: number | null; dryRun?: boolean; db?: RegistryDb; fetchOptions?: RegistryFetchOptions; now?: Date; live?: boolean } = {},
): Promise<RegistryFederalRegisterResult> {
  const db = options.db ?? sql;
  const now = options.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - FEDERAL_REGISTER_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { items, total, pages } = await fetchFederalRegisterRules(since, options.fetchOptions);

  const stages: Record<TrackerStage, number> = { comment_open: 0, comment_closed: 0, final_not_yet_effective: 0, in_effect: 0 };
  const agencies: Record<string, number> = {};
  for (const item of items) {
    stages[trackerStage(item, today)] += 1;
    for (const agency of item.agencies) agencies[agency] = (agencies[agency] ?? 0) + 1;
  }
  const shadow = !(options.live ?? federalRegisterLive());
  const result: RegistryFederalRegisterResult = {
    source: FEDERAL_REGISTER_SOURCE,
    partitionKey: FEDERAL_REGISTER_PARTITION,
    since,
    fetched: items.length,
    reported_total: total,
    pages,
    stored: 0,
    stages,
    agencies,
    fee_related: items.filter((item) => item.topics.length > 0).length,
    shadow,
    dryRun: Boolean(options.dryRun),
  };
  if (options.dryRun) return result;

  if (!shadow && items.length > 0) {
    const payload = JSON.stringify(items);
    const stored = await db<Array<{ external_id: string }>>`
      INSERT INTO reg_tracker_items (
        source, external_id, kind, title, abstract, agencies, published_on, comments_close_on,
        effective_on, url, rins, dockets, cfr_parts, topics
      )
      SELECT 'federal_register', r.document_number, r.kind, r.title, r.abstract,
             ARRAY(SELECT jsonb_array_elements_text(r.agencies)), r.publication_date::date,
             r.comments_close_on::date, r.effective_on::date, r.url,
             ARRAY(SELECT jsonb_array_elements_text(r.rins)), ARRAY(SELECT jsonb_array_elements_text(r.dockets)),
             ARRAY(SELECT jsonb_array_elements_text(r.cfr_parts)), ARRAY(SELECT jsonb_array_elements_text(r.topics))
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          document_number text, kind text, title text, abstract text, agencies jsonb, publication_date text,
          comments_close_on text, effective_on text, url text, rins jsonb, dockets jsonb, cfr_parts jsonb, topics jsonb
        )
      ON CONFLICT (source, external_id) DO UPDATE SET
        title = EXCLUDED.title,
        abstract = EXCLUDED.abstract,
        agencies = EXCLUDED.agencies,
        comments_close_on = EXCLUDED.comments_close_on,
        effective_on = EXCLUDED.effective_on,
        url = EXCLUDED.url,
        rins = EXCLUDED.rins,
        dockets = EXCLUDED.dockets,
        cfr_parts = EXCLUDED.cfr_parts,
        topics = EXCLUDED.topics,
        updated_at = now()
      RETURNING external_id
    `;
    result.stored = stored.length;
  }
  await recordRegistryPartition(db, {
    source: FEDERAL_REGISTER_SOURCE,
    partitionKey: FEDERAL_REGISTER_PARTITION,
    status: items.length > 0 ? "succeeded" : "empty",
    rowCount: result.fetched,
    insertedCount: result.stored,
    sourceUrl: null,
    runId: options.runId ?? null,
    nextAttemptAfterHours: FEDERAL_REGISTER_REFRESH_HOURS,
    detail: { since, stages, agencies, fee_related: result.fee_related, shadow, reported_total: total },
  });
  return result;
}
