import { sql } from "@/lib/data-store/connection";
import {
  FED_ENFORCEMENT_URL,
  OCC_ENFORCEMENT_URL,
  buildEnforcementMatcher,
  fetchFedActions,
  fetchOccActions,
  type EnforcementAction,
  type EnforcementAgency,
  type MatchCandidate,
} from "@/lib/regulatory/enforcement";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: public OCC and Federal Reserve enforcement actions into
 * institution_enforcement_actions, matched to institutions by name and state (or to
 * a holding company). One fixed partition refreshed weekly. If one agency's file
 * fails, the other still loads and the failure is recorded on the run.
 */

/**
 * Bumped when the matcher changes, so the scheduler re-runs the partition at once
 * (REGISTRY_PARSER_VERSIONS) instead of waiting for the weekly refresh. 2: DBA names,
 * holding companies by name alone. 3: name-alone holding-company matches withdrawn
 * (they tied generic names to unrelated companies).
 */
export const ENFORCEMENT_MATCHER_VERSION = 3;

export const ENFORCEMENT_SOURCE = "enforcement";
export const ENFORCEMENT_PARTITION = "current";
const REFRESH_HOURS = 24 * 7;
const RETRY_HOURS = 6;
const UPSERT_CHUNK = 1_000;
/** A file this short is a broken download, not the list. */
const MIN_ACTIONS: Record<EnforcementAgency, number> = { OCC: 500, FRB: 300 };

export interface RegistryEnforcementResult {
  source: string;
  partitionKey: string;
  byAgency: Record<EnforcementAgency, { actions: number; matched: number; holdingCompany: number }>;
  upserted: number;
  failed: string[];
  dryRun: boolean;
}

type Fetchers = Record<EnforcementAgency, (options: RegistryFetchOptions) => Promise<EnforcementAction[]>>;

const DEFAULT_FETCHERS: Fetchers = { OCC: fetchOccActions, FRB: fetchFedActions };
const URLS: Record<EnforcementAgency, string> = { OCC: OCC_ENFORCEMENT_URL, FRB: FED_ENFORCEMENT_URL };

async function loadCandidates(db: RegistryDb): Promise<MatchCandidate[]> {
  const rows = await db<
    { id: number; institution_name: string; state_code: string | null; city: string | null; holding_company_name: string | null; active: boolean }[]
  >`
    SELECT id, institution_name, state_code, city, holding_company_name,
           (regulatory_status IS DISTINCT FROM 'inactive') AS active
      FROM institution_sources
     WHERE charter_type = 'bank' AND institution_name IS NOT NULL
  `;
  return [...rows].map((r) => ({
    id: Number(r.id),
    name: r.institution_name,
    state_code: r.state_code ? String(r.state_code).trim() : null,
    city: r.city,
    holding_company_name: r.holding_company_name,
    active: Boolean(r.active),
  }));
}

export async function runRegistryEnforcement(
  options: { runId?: number | null; dryRun?: boolean; db?: RegistryDb; fetchers?: Partial<Fetchers>; fetchOptions?: RegistryFetchOptions } = {},
): Promise<RegistryEnforcementResult> {
  const db = options.db ?? sql;
  const fetchers = { ...DEFAULT_FETCHERS, ...options.fetchers };
  const result: RegistryEnforcementResult = {
    source: ENFORCEMENT_SOURCE,
    partitionKey: ENFORCEMENT_PARTITION,
    byAgency: { OCC: { actions: 0, matched: 0, holdingCompany: 0 }, FRB: { actions: 0, matched: 0, holdingCompany: 0 } },
    upserted: 0,
    failed: [],
    dryRun: Boolean(options.dryRun),
  };

  const matcher = buildEnforcementMatcher(await loadCandidates(db));
  const rows: Array<EnforcementAction & { institution_id: number | null; holding_company: string | null; match_method: string | null; agent_run_id: number | null }> = [];
  for (const agency of ["OCC", "FRB"] as const) {
    let actions: EnforcementAction[];
    try {
      actions = await fetchers[agency](options.fetchOptions ?? {});
      if (actions.length < MIN_ACTIONS[agency]) throw new Error(`only ${actions.length} actions in the file`);
    } catch (error) {
      result.failed.push(`${agency}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const stats = result.byAgency[agency];
    stats.actions = actions.length;
    for (const action of actions) {
      const m = matcher.match(action);
      if (m.institution_id !== null) stats.matched += 1;
      if (m.holding_company !== null) stats.holdingCompany += 1;
      rows.push({ ...action, institution_id: m.institution_id, holding_company: m.holding_company, match_method: m.method, agent_run_id: options.runId ?? null });
    }
  }

  if (!result.dryRun) {
    for (const part of chunk(rows, UPSERT_CHUNK)) {
      const payload = JSON.stringify(part);
      const written = await db`
        INSERT INTO institution_enforcement_actions
          (agency, source_key, institution_id, holding_company, match_method, party_name, party_city, party_state,
           action_type, subject, start_date, termination_date, penalty_amount, document_url, agent_run_id, fetched_at)
        SELECT r.agency, r.source_key, r.institution_id, r.holding_company, r.match_method, r.party_name, r.party_city,
               r.party_state, r.action_type, r.subject, r.start_date, r.termination_date, r.penalty_amount, r.document_url,
               r.agent_run_id, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            agency text, source_key text, institution_id bigint, holding_company text, match_method text,
            party_name text, party_city text, party_state text, action_type text, subject text,
            start_date date, termination_date date, penalty_amount numeric, document_url text, agent_run_id bigint
          )
        ON CONFLICT (source_key) DO UPDATE SET
          institution_id = EXCLUDED.institution_id,
          holding_company = EXCLUDED.holding_company,
          match_method = EXCLUDED.match_method,
          party_name = EXCLUDED.party_name,
          party_city = EXCLUDED.party_city,
          party_state = EXCLUDED.party_state,
          action_type = EXCLUDED.action_type,
          subject = EXCLUDED.subject,
          start_date = EXCLUDED.start_date,
          termination_date = EXCLUDED.termination_date,
          penalty_amount = EXCLUDED.penalty_amount,
          document_url = EXCLUDED.document_url,
          agent_run_id = EXCLUDED.agent_run_id,
          fetched_at = NOW()
        RETURNING id
      `;
      result.upserted += [...written].length;
    }

    const loaded = result.failed.length < 2;
    await recordRegistryPartition(db, {
      source: ENFORCEMENT_SOURCE,
      partitionKey: ENFORCEMENT_PARTITION,
      status: loaded ? "succeeded" : "failed",
      rowCount: rows.length,
      matchedCount: result.byAgency.OCC.matched + result.byAgency.FRB.matched,
      unmatchedCount: rows.length - result.byAgency.OCC.matched - result.byAgency.FRB.matched,
      insertedCount: result.upserted,
      sourceUrl: URLS.OCC,
      runId: options.runId ?? null,
      nextAttemptAfterHours: result.failed.length === 0 ? REFRESH_HOURS : RETRY_HOURS,
      detail: { by_agency: result.byAgency, failed: result.failed, parser_version: ENFORCEMENT_MATCHER_VERSION },
      error: result.failed.length > 0 ? result.failed.join("; ") : null,
    });
  }
  return result;
}
