import { sql } from "@/lib/data-store/connection";
import { loadMarketLeaderIds } from "@/lib/data-store/market-leaders";
import { startAgentRun } from "@/lib/agents/run-store";
import type { AgentRunStepDefinition } from "@/lib/agents/types";
import { DARWIN_VERIFY_MAX_LIMIT } from "@/lib/agents/darwin/verify";
import { HAMILTON_PUBLISH_MAX_LIMIT } from "@/lib/agents/hamilton/publish";

type SqlTag = typeof sql;

/**
 * The direct path for institutions that must not wait on their state's lane (James,
 * 2026-10-07: "A lot idle"; Chase and Citi first). Each gets its own run that fetches,
 * reads, extracts, verifies and publishes that one institution, so a schedule found by
 * hand goes live within a tick or two instead of after its state's next pass. Only free
 * steps run: the paid steps take a whole state, never one institution.
 *
 * The executor (`executeQueuedAgentRuns`) runs these right after runs already under way.
 */
export const PRIORITY_INSTITUTION_SOURCE = "atlas.priority_institution";
/** Priority runs queued or running at once; the rest wait for the next tick. */
export const PRIORITY_MAX_ACTIVE = 2;
/** A requested or hand-found institution runs again at most this often. */
export const PRIORITY_RETRY_HOURS = 24;
/** A large bank or market leader with no live overdraft fee runs again at most this often. */
export const PRIORITY_GAP_RETRY_DAYS = 7;
/** $10B in assets; `asset_size` is in thousands. */
export const PRIORITY_MIN_ASSETS_THOUSANDS = 10_000_000;

export interface PriorityInstitutionRequest {
  institutionId: number;
  institutionName: string;
  reason: string;
}

const REPORT_GAP_MISREAD = "report-ready gap: schedule on file but fees misread (funnel/report-rule-gaps-2026-10-07.md)";

/**
 * Institutions a person asked to have read now. Names are prod's, for review only; the id
 * is what counts. An institution leaves the direct path on its own once it has run.
 */
export const PRIORITY_INSTITUTION_REQUESTS: readonly PriorityInstitutionRequest[] = [
  // Tennessee report (2026-10-07 06:50): 6 of the 7 largest TN deposit holders had no live
  // overdraft fee, so only 26% of TN branch deposits had one.
  ...([
    [37, "First Horizon Bank"],
    [47, "Pinnacle Bank"],
    [27, "Regions Bank"],
    [122, "FirstBank"],
    [5, "U.S. Bank National Association"],
    [251, "Wilson Bank and Trust"],
  ] as const).map(([institutionId, institutionName]) => ({
    institutionId,
    institutionName,
    reason: "Tennessee report: largest deposit holder with no live overdraft fee",
  })),
  {
    institutionId: 393,
    institutionName: "ACNB Bank",
    reason: "Adams County, PA market study: 61% of county deposits, no fee schedule on file",
  },
  { institutionId: 8109, institutionName: "Space Coast Federal Credit Union", reason: "Hamilton answer had only 5 fees; full schedule needed" },
  ...([
    [51, "First National Bank of Pennsylvania"],
    [156, "Amarillo National Bank"],
    [243, "Five Star Bank"],
    [278, "Alerus Financial, National Association"],
    [337, "Spencer Savings Bank, SLA"],
    [433, "NEXTIER BANK, NATIONAL ASSOCIATION"],
    [528, "Texas First Bank"],
    [563, "Think Mutual Bank"],
    [565, "Opportunity Bank of Montana"],
    [641, "FirstBank Southwest"],
    [724, "Community Bank"],
    [749, "CorTrust Bank National Association"],
    [757, "Pathfinder Bank"],
    [927, "Liberty Savings Bank, F.S.B."],
    [1037, "First Federal Savings and Loan Association of Greene Co"],
    [1068, "First National Bank and Trust Company of Weatherford"],
    [1104, "Colonial Savings, F.A."],
    [1195, "Mechanics Bank"],
    [1200, "Titan Bank, N.A."],
    [1411, "American State Bank"],
    [1680, "Coulee Bank"],
    [1718, "Cross County Savings Bank"],
    [1779, "The St. Henry Bank"],
    [1784, "Merchants Commercial Bank"],
    [1841, "Fulton Savings Bank"],
    [2279, "Farmers & Merchants Bank"],
    [2334, "Bank of Montana"],
    [2580, "Security First Bank of North Dakota"],
    [2606, "Cayuga Lake National Bank"],
    [2756, "BANKWEST"],
    [3005, "Gouverneur Savings and Loan Association"],
    [3262, "Bank of South Texas"],
    [5058, "Trunorth Federal Credit Union"],
    [5998, "Explorers Federal Credit Union"],
    [6358, "Minnesota Valley Federal Credit Union"],
    [6775, "St. Paul Federal Credit Union"],
    [6788, "Building Trades Federal Credit Union"],
    [7096, "City & County Federal Credit Union"],
    [7503, "Northwoods Federal Credit Union"],
    [8078, "Superior Choice Federal Credit Union"],
  ] as const).map(([institutionId, institutionName]) => ({ institutionId, institutionName, reason: REPORT_GAP_MISREAD })),
];

export type PriorityTier = "hand_found" | "requested" | "overdraft_gap";

export interface PriorityInstitutionRow {
  id: number;
  institution_name: string;
  state_code: string | null;
  tier: PriorityTier;
  /** Newest unfetched hand-found link (tier hand_found only); keys the run so a link added later the same day still runs. */
  hand_link_id: number | null;
}

/**
 * Institutions due for a direct run, best first:
 *  1. a fee schedule found by hand (Magellan's operator list) not yet fetched;
 *  2. an institution on PRIORITY_INSTITUTION_REQUESTS;
 *  3. a $10B+ institution or state market leader with a fee link but no live overdraft fee.
 * Requests run in list order; otherwise larger institutions first within a tier. An institution with a priority run in flight,
 * or one started inside its retry window, is skipped, unless a hand-found link was added after that run started.
 */
export async function selectPriorityInstitutions(
  db: SqlTag,
  options: { limit: number; leaderIds: readonly number[] },
): Promise<PriorityInstitutionRow[]> {
  const limit = Math.max(0, Math.floor(options.limit));
  if (limit === 0) return [];
  const requested = PRIORITY_INSTITUTION_REQUESTS.map((request) => request.institutionId);
  const leaders = [...options.leaderIds].map(Number);
  const rows = await db<
    Array<{
      id: number | string;
      institution_name: string;
      state_code: string | null;
      tier: number | string;
      hand_link_id: number | string | null;
    }>
  >`
    WITH candidates AS (
      SELECT inst.id, inst.institution_name, inst.state_code, inst.asset_size,
             hand_new.hand_link_id, hand_new.hand_found_at,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM institution_additional_sources hand
                  WHERE hand.institution_id = inst.id
                    AND hand.found_by_strategy = 'discover.operator_schedule'
                    AND hand.status = 'found'
                    AND hand.last_fetched_at IS NULL
               ) THEN 1
               WHEN inst.id = ANY(${requested}::bigint[]) THEN 2
               WHEN (COALESCE(inst.asset_size, 0) >= ${PRIORITY_MIN_ASSETS_THOUSANDS}::bigint
                     OR inst.id = ANY(${leaders}::bigint[]))
                AND (inst.fee_schedule_url IS NOT NULL OR EXISTS (
                      SELECT 1 FROM institution_additional_sources ias
                       WHERE ias.institution_id = inst.id
                         AND ias.status IN ('found', 'fetched')
                         AND ias.document_role <> 'business'
                    ))
                AND NOT EXISTS (
                      SELECT 1 FROM published_fee_catalog live
                       WHERE live.institution_id = inst.id
                         AND live.canonical_fee_key = 'overdraft'
                    ) THEN 3
             END AS tier
        FROM institution_sources inst
        LEFT JOIN LATERAL (
          SELECT MAX(hand.id) AS hand_link_id, MAX(hand.found_at) AS hand_found_at
            FROM institution_additional_sources hand
           WHERE hand.institution_id = inst.id
             AND hand.found_by_strategy = 'discover.operator_schedule'
             AND hand.status = 'found'
             AND hand.last_fetched_at IS NULL
        ) hand_new ON TRUE
       WHERE COALESCE(inst.status, 'active') = 'active'
    )
    SELECT c.id, c.institution_name, c.state_code, c.tier, c.hand_link_id
      FROM candidates c
     WHERE c.tier IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM agent_runs r
          WHERE r.params_json->>'source' = ${PRIORITY_INSTITUTION_SOURCE}::text
            AND r.params_json->>'institution_id' = c.id::text
            AND (
              r.status IN ('queued', 'running', 'cancel_requested')
              OR (
                r.started_at > NOW() - CASE
                  WHEN c.tier = 3 THEN make_interval(days => ${PRIORITY_GAP_RETRY_DAYS}::int)
                  ELSE make_interval(hours => ${PRIORITY_RETRY_HOURS}::int)
                END
                -- A hand-found link added after the last run is new work, not a retry.
                AND (c.tier <> 1 OR c.hand_found_at IS NULL OR r.started_at >= c.hand_found_at)
              )
            )
       )
     ORDER BY c.tier ASC,
              CASE WHEN c.tier = 2 THEN array_position(${requested}::bigint[], c.id::bigint) END ASC NULLS LAST,
              COALESCE(c.asset_size, 0) DESC, c.id ASC
     LIMIT ${limit}::int
  `;
  const tiers: Record<number, PriorityTier> = { 1: "hand_found", 2: "requested", 3: "overdraft_gap" };
  return rows.map((row) => ({
    id: Number(row.id),
    institution_name: String(row.institution_name),
    state_code: row.state_code ? String(row.state_code).trim().toUpperCase() : null,
    tier: tiers[Number(row.tier)] ?? "requested",
    hand_link_id: Number(row.tier) === 1 && row.hand_link_id != null ? Number(row.hand_link_id) : null,
  }));
}

/** Free steps only, each scoped to the one institution through the run's params. */
export function priorityInstitutionSteps(institutionId: number): AgentRunStepDefinition[] {
  return [
    { key: "fetch", agent: "magellan", title: "Fetch the institution's fee documents", input: { institution_id: institutionId } },
    { key: "read", agent: "rosetta", title: "Read and normalize the fee documents" },
    { key: "extract", agent: "knox", title: "Extract fee observations" },
    { key: "classify", agent: "darwin", title: "Classify and verify extracted fees", input: { verify_limit: DARWIN_VERIFY_MAX_LIMIT } },
    { key: "publish", agent: "hamilton", title: "Publish verified fees", input: { publish_limit: HAMILTON_PUBLISH_MAX_LIMIT } },
  ];
}

const TIER_REASON: Record<PriorityTier, string> = {
  hand_found: "fee schedule found by hand, not yet fetched",
  requested: "asked for by name",
  overdraft_gap: "$10B+ or market leader with no live overdraft fee",
};

export interface SchedulePriorityInstitutionRunsResult {
  active: number;
  selected: number;
  scheduled: number;
  reused: number;
  failed: Array<{ institutionId: number; error: string }>;
  runs: Array<{ institutionId: number; runId: number; tier: PriorityTier }>;
}

/** Fills free direct-path slots (up to PRIORITY_MAX_ACTIVE). Called once per tick. */
export async function schedulePriorityInstitutionRuns(
  options: { db?: SqlTag; now?: Date; maxActive?: number } = {},
): Promise<SchedulePriorityInstitutionRunsResult> {
  const db = options.db ?? sql;
  const maxActive = options.maxActive ?? PRIORITY_MAX_ACTIVE;
  const [{ active }] = await db<Array<{ active: number | string }>>`
    SELECT COUNT(*)::int AS active
      FROM agent_runs
     WHERE params_json->>'source' = ${PRIORITY_INSTITUTION_SOURCE}::text
       AND status IN ('queued', 'running', 'cancel_requested')
  `;
  const activeCount = Number(active);
  const result: SchedulePriorityInstitutionRunsResult = {
    active: activeCount,
    selected: 0,
    scheduled: 0,
    reused: 0,
    failed: [],
    runs: [],
  };
  const open = maxActive - activeCount;
  if (open <= 0) return result;

  const leaderIds = await loadMarketLeaderIds(db);
  const picks = await selectPriorityInstitutions(db, { limit: open, leaderIds });
  result.selected = picks.length;
  const day = (options.now ?? new Date()).toISOString().slice(0, 10);
  for (const pick of picks) {
    try {
      const started = await startAgentRun({
        agent: "atlas",
        kind: "manual_repair",
        title: `Read now: ${pick.institution_name}`,
        stateCode: pick.state_code ?? undefined,
        params: {
          source: PRIORITY_INSTITUTION_SOURCE,
          institution_id: pick.id,
          tier: pick.tier,
          reason:
            PRIORITY_INSTITUTION_REQUESTS.find((request) => request.institutionId === pick.id)?.reason ??
            TIER_REASON[pick.tier],
        },
        triggeredBy: "api.admin.agents.tick",
        triggerSource: "schedule",
        idempotencyKey:
          pick.hand_link_id != null
            ? `atlas:priority:${pick.id}:hand:${pick.hand_link_id}`
            : `atlas:priority:${pick.id}:${day}`,
        steps: priorityInstitutionSteps(pick.id),
        summary: `Direct run for one institution (${TIER_REASON[pick.tier]}).`,
      });
      if (started.reused) result.reused += 1;
      else result.scheduled += 1;
      result.runs.push({ institutionId: pick.id, runId: started.run.id, tier: pick.tier });
    } catch (error) {
      result.failed.push({ institutionId: pick.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
