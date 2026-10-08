import { sql } from "@/lib/data-store/connection";
import { buildEnforcementMatcher, type MatchCandidate } from "@/lib/regulatory/enforcement";
import { RegistryHttpError, registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  STATE_ORDER_SOURCES,
  describePage,
  linksMatching,
  parseStateOrders,
  stateAgencyCode,
  stateOrderKey,
  type StateOrder,
  type StateOrderSource,
} from "@/lib/regulatory/state-enforcement";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: state banking departments' public enforcement orders against
 * banks, into institution_enforcement_actions (agency "STATE_NJ" and so on), matched to
 * institutions by name in that state. One fixed partition refreshed weekly. Each state
 * is read on its own: a state whose pages fail keeps its earlier rows, and the run
 * records what every state's reader found, with sample rows, so a reader that misses
 * shows up in the run ledger rather than as an empty card.
 */

/** Bumped when a reader changes, so the scheduler re-reads at once (REGISTRY_PARSER_VERSIONS). */
export const STATE_ENFORCEMENT_PARSER_VERSION = 5;
export const STATE_ENFORCEMENT_SOURCE = "state-enforcement";
export const STATE_ENFORCEMENT_PARTITION = "current";
const REFRESH_HOURS = 24 * 7;
const RETRY_HOURS = 6;
const UPSERT_CHUNK = 500;

export interface StateEnforcementStateResult {
  state: string;
  pages: number;
  /** Pages that answered 404 (a year with no page yet), not failures. */
  missing: number;
  failed: string[];
  orders: number;
  /** Rows from an earlier read that the state's list no longer has (or an older reader misread). */
  removed: number;
  matched: number;
  sample: Array<Pick<StateOrder, "party_name" | "action_type" | "start_date" | "document_url">>;
  /** The first page's shape when nothing was found on it, so the reader can be fixed. */
  shape?: ReturnType<typeof describePage> & { url: string };
  /** Table rows on each page where nothing was found (a table with rows the reader missed). */
  emptyPages?: Array<{ url: string; tables: number; rows: number }>;
}

export interface RegistryStateEnforcementResult {
  source: string;
  partitionKey: string;
  byState: StateEnforcementStateResult[];
  upserted: number;
  dryRun: boolean;
}

type PageFetcher = (url: string, options: RegistryFetchOptions) => Promise<string | null>;

/** A page's HTML, or null when it doesn't exist (404/410). Other failures throw. */
const fetchPage: PageFetcher = async (url, options) => {
  try {
    const response = await registryFetch(url, { retries: 1, timeoutMs: 30_000, ...options });
    return await response.text();
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  }
};

async function loadCandidates(db: RegistryDb, states: readonly string[]): Promise<MatchCandidate[]> {
  const rows = await db<
    { id: number; institution_name: string; state_code: string | null; city: string | null; holding_company_name: string | null; active: boolean }[]
  >`
    SELECT id, institution_name, state_code, city, holding_company_name,
           (regulatory_status IS DISTINCT FROM 'inactive') AS active
      FROM institution_sources
     WHERE charter_type = 'bank' AND institution_name IS NOT NULL AND state_code = ANY(${[...states]})
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

export async function runRegistryStateEnforcement(
  options: {
    runId?: number | null;
    dryRun?: boolean;
    db?: RegistryDb;
    fetchPage?: PageFetcher;
    fetchOptions?: RegistryFetchOptions;
    sources?: readonly StateOrderSource[];
    today?: Date;
  } = {},
): Promise<RegistryStateEnforcementResult> {
  const db = options.db ?? sql;
  const fetcher = options.fetchPage ?? fetchPage;
  const sources = options.sources ?? STATE_ORDER_SOURCES;
  const today = options.today ?? new Date();
  const result: RegistryStateEnforcementResult = {
    source: STATE_ENFORCEMENT_SOURCE,
    partitionKey: STATE_ENFORCEMENT_PARTITION,
    byState: [],
    upserted: 0,
    dryRun: Boolean(options.dryRun),
  };
  const matcher = buildEnforcementMatcher(await loadCandidates(db, sources.map((s) => s.state)));
  const rows: Array<Record<string, unknown>> = [];

  for (const source of sources) {
    const stats: StateEnforcementStateResult = { state: source.state, pages: 0, missing: 0, failed: [], orders: 0, removed: 0, matched: 0, sample: [] };
    const byKey = new Map<string, StateOrder>();
    const queue = [...source.urls(today)];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const url = queue.shift() as string;
      if (visited.has(url)) continue;
      visited.add(url);
      try {
        const html = await fetcher(url, options.fetchOptions ?? {});
        if (html === null) {
          stats.missing += 1;
          continue;
        }
        stats.pages += 1;
        if (source.follow) for (const next of linksMatching(html, url, source.follow)) if (!visited.has(next)) queue.push(next);
        const found = parseStateOrders(source.reader, html, url);
        for (const order of found) byKey.set(stateOrderKey(source.state, order), order);
        if (found.length === 0) {
          const shape = describePage(html);
          // Keep the shape of the page with the most table rows: an empty year page says little.
          if (!stats.shape || shape.rows > stats.shape.rows) stats.shape = { url, ...shape };
          stats.emptyPages = [...(stats.emptyPages ?? []), { url, tables: shape.tables, rows: shape.rows }];
        }
      } catch (error) {
        stats.failed.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const [key, order] of byKey) {
      const m = matcher.match({ party_name: order.party_name, party_city: order.party_city, party_state: source.state });
      if (m.institution_id !== null) stats.matched += 1;
      rows.push({
        agency: stateAgencyCode(source.state),
        source_key: key,
        institution_id: m.institution_id,
        holding_company: m.holding_company,
        match_method: m.method,
        party_name: order.party_name,
        party_city: order.party_city,
        party_state: source.state,
        action_type: order.action_type,
        subject: null,
        start_date: order.start_date,
        termination_date: order.termination_date,
        penalty_amount: null,
        document_url: order.document_url,
        agent_run_id: options.runId ?? null,
      });
    }
    stats.orders = byKey.size;
    stats.sample = [...byKey.values()].slice(0, 3).map((o) => ({ party_name: o.party_name, action_type: o.action_type, start_date: o.start_date, document_url: o.document_url }));
    result.byState.push(stats);
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
          party_city = EXCLUDED.party_city,
          action_type = EXCLUDED.action_type,
          termination_date = EXCLUDED.termination_date,
          document_url = EXCLUDED.document_url,
          agent_run_id = EXCLUDED.agent_run_id,
          fetched_at = NOW()
        RETURNING id
      `;
      result.upserted += [...written].length;
    }

    // The table mirrors each state's list: a state read in full drops rows its list no longer has.
    for (const stats of result.byState) {
      if (stats.pages === 0 || stats.failed.length > 0 || stats.orders === 0) continue;
      const keys = rows.filter((r) => r.agency === stateAgencyCode(stats.state)).map((r) => String(r.source_key));
      const removed = await db`
        DELETE FROM institution_enforcement_actions
         WHERE agency = ${stateAgencyCode(stats.state)} AND NOT (source_key = ANY(${keys}))
        RETURNING id`;
      stats.removed = [...removed].length;
    }

    const readStates = result.byState.filter((s) => s.pages > 0).length;
    const failedStates = result.byState.filter((s) => s.pages === 0 && s.failed.length > 0);
    const matched = result.byState.reduce((n, s) => n + s.matched, 0);
    await recordRegistryPartition(db, {
      source: STATE_ENFORCEMENT_SOURCE,
      partitionKey: STATE_ENFORCEMENT_PARTITION,
      status: readStates === 0 ? "failed" : rows.length === 0 ? "empty" : "succeeded",
      rowCount: rows.length,
      matchedCount: matched,
      unmatchedCount: rows.length - matched,
      insertedCount: result.upserted,
      sourceUrl: null,
      runId: options.runId ?? null,
      nextAttemptAfterHours: failedStates.length === 0 && readStates > 0 ? REFRESH_HOURS : RETRY_HOURS,
      detail: { by_state: result.byState, parser_version: STATE_ENFORCEMENT_PARSER_VERSION },
      error: failedStates.length > 0 ? `No page read for ${failedStates.map((s) => s.state).join(", ")}` : null,
    });
  }
  return result;
}
